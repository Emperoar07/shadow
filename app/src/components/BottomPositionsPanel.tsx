import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BN from "bn.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import toast from "react-hot-toast";
import { createShadowPerpClient } from "../lib/create-client";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";
import { getExplorerTxUrl } from "../lib/explorer";
import { TRADING_DISABLED } from "../lib/feature-flags";
import {
  PendingLimitOrder,
  OwnerPositionView,
  getLimitOrders,
  getOwnerPositionViews,
  PositionProtectionRule,
  getPositionRule,
  getPositionRules,
  removeLimitOrder,
  removePositionRule,
  setPositionRule,
  subscribeAutomationUpdates,
  updateLimitOrder,
} from "../lib/trade-automation";

type UiStatus = "open" | "closing" | "closed" | "pending" | "liquidated" | "settling";

interface UiPosition {
  address: string;
  index: BN;
  status: UiStatus;
  margin: number;
  openedAt: Date;
  realizedPnl: number;
  hasEncryptedData: boolean;
}

type Direction = "long" | "short";
type RuleDraft = {
  side: Direction;
  takeProfit: string;
  stopLoss: string;
};

function parseStatus(status: unknown): UiStatus {
  if (typeof status === "number") {
    if (status === 0) return "pending";
    if (status === 1) return "open";
    if (status === 2) return "closing";
    if (status === 3) return "closed";
    if (status === 5 || status === 6) return "settling";
    return "liquidated";
  }
  if (status && typeof status === "object") {
    const key = Object.keys(status as Record<string, unknown>)[0]?.toLowerCase();
    if (key === "pending") return "pending";
    if (key === "open") return "open";
    if (key === "closing") return "closing";
    if (key === "closed") return "closed";
    if (key === "closedpendingsettlement" || key === "liquidatedpendingsettlement") {
      return "settling";
    }
    if (key === "liquidated") return "liquidated";
  }
  return "open";
}

const STATUS_COLORS: Record<UiStatus, string> = {
  pending: "text-yellow-400 bg-yellow-400/15",
  open: "text-accent-green bg-accent-green/15",
  closing: "text-yellow-400 bg-yellow-400/15",
  settling: "text-cyan-300 bg-cyan-400/15",
  closed: "text-gray-400 bg-gray-400/15",
  liquidated: "text-accent-red bg-accent-red/15",
};

const STATUS_LABELS: Record<UiStatus, string> = {
  pending: "MPC Processing",
  open: "Open",
  closing: "Closing",
  settling: "Settling",
  closed: "Settled",
  liquidated: "Liquidated",
};

function StatusBadge({ status, isClosing }: { status: UiStatus; isClosing: boolean }) {
  const animated = status === "pending" || status === "closing" || isClosing;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[status]}`}
    >
      {animated && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse flex-shrink-0" />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? "border-accent-purple text-white"
          : "border-transparent text-gray-400 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

function parseOptionalPositive(value: string): number | null {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return value < 0.01 ? `$${value.toFixed(8)}` : `$${value.toFixed(2)}`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function MetricBlock({
  label,
  value,
  subtitle,
  valueClassName = "text-white",
}: {
  label: string;
  value: string;
  subtitle?: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-gray-500">{label}</p>
      <p className={`text-xl font-semibold leading-tight ${valueClassName}`}>{value}</p>
      {subtitle ? <p className={`text-lg font-semibold leading-tight ${valueClassName}`}>{subtitle}</p> : null}
    </div>
  );
}

export default function BottomPositionsPanel({
  activePairLabel,
}: {
  activePairLabel?: string;
}) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWalletCompat();
  const { connection } = useConnection();
  const [positions, setPositions] = useState<UiPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [closingAddress, setClosingAddress] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"position" | "orders" | "history">("position");
  const [limitOrders, setLimitOrders] = useState<PendingLimitOrder[]>([]);
  const [positionRules, setPositionRules] = useState<Record<string, PositionProtectionRule>>({});
  const [ownerPositionViews, setOwnerPositionViews] = useState<Record<string, OwnerPositionView>>(
    {}
  );
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, RuleDraft>>({});
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [oraclePrice, setOraclePrice] = useState<number | null>(null);
  const [liqThreshold, setLiqThreshold] = useState(5);
  const autoCloseInFlightRef = useRef<Set<string>>(new Set());
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);

  // Reset cached client when wallet changes
  useEffect(() => {
    clientRef.current = null;
  }, [anchorWallet]);

  const loadPositions = useCallback(async () => {
    if (!publicKey || !anchorWallet) return;
    setLoading(true);
    try {
      if (!clientRef.current) {
        clientRef.current = createShadowPerpClient(connection, anchorWallet);
      }
      const { client, runtime } = clientRef.current;
      const onchain = await client.getUserPositionAccounts(runtime.marketAddress, publicKey);
      const mapped: UiPosition[] = onchain.map((p) => {
        const account = p.account as any;
        const encData: number[] | Uint8Array = account.encryptedData ?? [];
        return {
          address: p.publicKey.toBase58(),
          index: new BN(account.index.toString()),
          status: parseStatus(account.status),
          margin: new BN(account.margin.toString()).toNumber() / 1_000_000,
          openedAt: new Date(new BN(account.openedAt.toString()).toNumber() * 1000),
          realizedPnl: new BN(account.realizedPnl.toString()).toNumber() / 1_000_000,
          hasEncryptedData: Array.from(encData).some((b: number) => b !== 0),
        };
      });
      mapped.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
      setPositions(mapped);
      try {
        const market = await client.getMarket(runtime.marketAddress);
        const price = new BN(market.oraclePrice.toString()).toNumber() / 1_000_000;
        setOraclePrice(Number.isFinite(price) && price > 0 ? price : null);
        const threshold = Number(market.liquidationThreshold) / 100;
        if (Number.isFinite(threshold) && threshold > 0 && threshold <= 100) {
          setLiqThreshold(threshold);
        }
      } catch {
        // keep previous oracle price
      }
    } catch {
      // silent on config/runtime fetch errors
    } finally {
      setLoading(false);
    }
  }, [publicKey, anchorWallet, connection]);

  const loadAutomationState = useCallback(() => {
    setPositionRules(getPositionRules());
    setLimitOrders(getLimitOrders());
    setOwnerPositionViews(getOwnerPositionViews());
  }, []);

  useEffect(() => {
    void loadPositions();
    const id = setInterval(() => void loadPositions(), 15_000);
    return () => clearInterval(id);
  }, [loadPositions]);

  useEffect(() => {
    loadAutomationState();
    return subscribeAutomationUpdates(loadAutomationState);
  }, [loadAutomationState]);

  useEffect(() => {
    setRuleDrafts((current) => {
      const next = { ...current };
      let changed = false;

      for (const position of positions) {
        if (next[position.address]) continue;
        const rule = positionRules[position.address];
        const view = ownerPositionViews[position.address];
        next[position.address] = {
          side: view?.side ?? rule?.side ?? "long",
          takeProfit: rule?.takeProfit?.toString() ?? "",
          stopLoss: rule?.stopLoss?.toString() ?? "",
        };
        changed = true;
      }

      for (const address of Object.keys(next)) {
        if (positions.some((position) => position.address === address)) continue;
        delete next[address];
        changed = true;
      }

      return changed ? next : current;
    });
  }, [ownerPositionViews, positionRules, positions]);

  const handleClose = useCallback(
    async (pos: UiPosition) => {
      if (TRADING_DISABLED) {
        toast.error("Trading is temporarily disabled while Arcium devnet is being patched.");
        return;
      }
      if (!publicKey || !anchorWallet) return;
      setClosingAddress(pos.address);
      try {
        if (!clientRef.current) {
          clientRef.current = createShadowPerpClient(connection, anchorWallet);
        }
        const { client, runtime } = clientRef.current;
        const ownerTokenAccount = await client.getOwnerCollateralTokenAccount(
          runtime.marketAddress
        );
        toast.loading("Queuing close via Arcium MPC...", { id: pos.address });
        const tx = await client.closePosition(
          runtime.marketAddress,
          pos.index
        );
        toast.loading("Awaiting MPC callback and settlement...", { id: pos.address });
        const finalized = await client.finalizeClosePosition(
          runtime.marketAddress,
          publicKey,
          pos.index,
          ownerTokenAccount
        );
        toast.success(
          <div>
            <p className="font-medium">Position closed and settled</p>
            <p className="text-xs text-gray-400 mt-0.5">PnL was revealed by MPC and settlement completed on-chain</p>
            <a
              href={getExplorerTxUrl(tx)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent-purple underline mt-1 block"
            >
              View close transaction
            </a>
            {finalized.settleTxSignature ? (
              <a
                href={getExplorerTxUrl(finalized.settleTxSignature)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent-purple underline mt-1 block"
              >
                View settlement transaction
              </a>
            ) : null}
          </div>,
          { id: pos.address, duration: 10_000 }
        );
        await loadPositions();
      } catch (error: any) {
        const msg = error?.message ?? "Failed to close position";
        if (!msg.includes("env var")) toast.error(msg, { id: pos.address });
      } finally {
        setClosingAddress(null);
      }
    },
    [publicKey, anchorWallet, connection, loadPositions]
  );

  const updateRuleDraft = useCallback(
    (address: string, field: "takeProfit" | "stopLoss", value: string) => {
      setRuleDrafts((current) => ({
        ...current,
        [address]: {
          ...(current[address] ?? { side: "long" as Direction, takeProfit: "", stopLoss: "" }),
          [field]: value,
        },
      }));
    },
    []
  );

  const saveRule = useCallback((address: string) => {
    const draft = ruleDrafts[address];
    if (!draft) return;
    const tp = parseOptionalPositive(draft.takeProfit);
    const sl = parseOptionalPositive(draft.stopLoss);
    const existingRule = positionRules[address];
    const view = ownerPositionViews[address];
    const pairLabel = view?.pairLabel ?? existingRule?.pairLabel ?? activePairLabel ?? "PERP";
    if (tp === null && sl === null) {
      removePositionRule(address);
      toast.success("TP/SL rule removed");
      return;
    }
    setPositionRule({
      positionAddress: address,
      pairLabel,
      side: draft.side,
      takeProfit: tp,
      stopLoss: sl,
      updatedAt: Date.now(),
    });
    toast.success("TP/SL rule saved");
  }, [activePairLabel, ownerPositionViews, positionRules, ruleDrafts]);

  const openPositions = useMemo(
    () => positions.filter((p) => ["open", "pending", "closing", "settling"].includes(p.status)),
    [positions]
  );
  const openOrders = useMemo(
    () => limitOrders.filter((o) => ["pending", "triggered", "failed"].includes(o.status)),
    [limitOrders]
  );
  const historyPositions = useMemo(
    () => positions.filter((p) => ["closed", "liquidated"].includes(p.status)),
    [positions]
  );
  const displayed =
    activeTab === "position" ? openPositions : activeTab === "history" ? historyPositions : [];
  const showActionCol = activeTab === "position";

  const derivePositionCard = useCallback(
    (position: UiPosition) => {
      const view = ownerPositionViews[position.address] ?? null;
      const rule = positionRules[position.address] ?? null;
      const side = view?.side ?? rule?.side ?? null;
      const marginMode = view?.marginMode ?? "cross";
      const leverage = view?.leverage ?? null;
      const entryPrice = view?.entryPrice ?? null;
      const pairLabel = view?.pairLabel ?? rule?.pairLabel ?? activePairLabel ?? "PERP";
      const sizeBase = view?.sizeBase ?? null;

      let liqPrice: number | null = null;
      if (entryPrice !== null && leverage !== null && leverage > 0) {
        const liqFactor = (1 - liqThreshold / 100) / leverage;
        liqPrice =
          side === "short"
            ? entryPrice * (1 + liqFactor)
            : entryPrice * (1 - liqFactor);
      }

      let unrealizedPnl: number | null = null;
      if (
        entryPrice !== null &&
        sizeBase !== null &&
        oraclePrice !== null &&
        Number.isFinite(oraclePrice)
      ) {
        const direction = side === "short" ? -1 : 1;
        unrealizedPnl = (oraclePrice - entryPrice) * sizeBase * direction;
      }

      // Do not use on-chain `position.margin` for active-position health/PnL calculations.
      // Active margin is privacy-hardened and expected to remain 0 on-chain.
      const localMargin =
        entryPrice !== null && sizeBase !== null && leverage !== null && leverage > 0
          ? (entryPrice * sizeBase) / leverage
          : null;

      const pnlPercent =
        unrealizedPnl !== null && localMargin !== null && localMargin > 0
          ? (unrealizedPnl / localMargin) * 100
          : null;

      let healthPercent: number | null = null;
      if (
        liqPrice !== null &&
        entryPrice !== null &&
        oraclePrice !== null &&
        side
      ) {
        if (side === "long") {
          const denominator = entryPrice - liqPrice;
          if (denominator > 0) {
            healthPercent = clampPercent(((oraclePrice - liqPrice) / denominator) * 100);
          }
        } else {
          const denominator = liqPrice - entryPrice;
          if (denominator > 0) {
            healthPercent = clampPercent(((liqPrice - oraclePrice) / denominator) * 100);
          }
        }
      }

      return {
        pairLabel,
        side,
        marginMode,
        leverage,
        localMargin,
        entryPrice,
        liqPrice,
        unrealizedPnl,
        pnlPercent,
        healthPercent,
      };
    },
    [activePairLabel, liqThreshold, oraclePrice, ownerPositionViews, positionRules]
  );

  useEffect(() => {
    if (TRADING_DISABLED) return;
    if (!oraclePrice || activeTab !== "position") return;
    for (const pos of openPositions) {
      if (pos.status !== "open") continue;
      if (autoCloseInFlightRef.current.has(pos.address)) continue;
      const rule = positionRules[pos.address];
      if (!rule) continue;
      const hit =
        rule.side === "long"
          ? (rule.takeProfit !== null && oraclePrice >= rule.takeProfit) ||
            (rule.stopLoss !== null && oraclePrice <= rule.stopLoss)
          : (rule.takeProfit !== null && oraclePrice <= rule.takeProfit) ||
            (rule.stopLoss !== null && oraclePrice >= rule.stopLoss);

      if (!hit) continue;

      autoCloseInFlightRef.current.add(pos.address);
      toast(
        `TP/SL hit for #${pos.index.toString()} at ${formatPrice(oraclePrice)}. Closing position...`,
        { id: `tp-sl-${pos.address}` }
      );

      void handleClose(pos).finally(() => {
        autoCloseInFlightRef.current.delete(pos.address);
      });
    }
  }, [activeTab, handleClose, openPositions, oraclePrice, positionRules]);

  const updateOrderField = useCallback(
    (orderId: string, field: "limitPrice" | "takeProfit" | "stopLoss", raw: string) => {
      const parsed = parseOptionalPositive(raw);
      const patch: Partial<PendingLimitOrder> = {
        status: "pending",
        error: undefined,
      };
      if (field === "limitPrice") {
        if (parsed === null) {
          toast.error("Limit price must be greater than 0");
          return;
        }
        patch.limitPrice = parsed;
      } else if (field === "takeProfit") {
        patch.takeProfit = parsed;
      } else {
        patch.stopLoss = parsed;
      }
      updateLimitOrder(orderId, patch);
    },
    []
  );

  const removeFailedLimitOrder = useCallback((order: PendingLimitOrder) => {
    if (order.status === "failed") {
      removeLimitOrder(order.id);
      toast.success("Removed failed order");
    }
  }, []);

  return (
    <div className="trade-bottom-panel position-card rounded-xl overflow-hidden h-full">
      {/* Tab bar */}
      <div className="flex items-center justify-between border-b border-shadow-600 pl-1">
        <div className="flex">
          <TabBtn active={activeTab === "position"} onClick={() => setActiveTab("position")}>
            Position
            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-shadow-600 text-[10px] text-gray-300">
              {openPositions.length}
            </span>
          </TabBtn>
          <TabBtn active={activeTab === "orders"} onClick={() => setActiveTab("orders")}>
            Orders
            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-shadow-600 text-[10px] text-gray-300">
              {openOrders.length}
            </span>
          </TabBtn>
          <TabBtn active={activeTab === "history"} onClick={() => setActiveTab("history")}>
            History
            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-shadow-600 text-[10px] text-gray-300">
              {historyPositions.length}
            </span>
          </TabBtn>
        </div>

      </div>

      {/* Table */}
      <div className="overflow-x-auto" style={{ maxHeight: 200, overflowY: "auto" }}>
        {activeTab === "orders" ? (
          openOrders.length === 0 ? (
            <div className="py-7 text-center text-sm text-gray-500">No active orders.</div>
          ) : (
            <div className="divide-y divide-shadow-700">
              {openOrders.map((order) => (
                <div key={order.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-xs">
                      <p className="font-medium text-gray-100">
                        {order.pairLabel} | {order.side.toUpperCase()} | {order.marginMode.toUpperCase()} | {order.leverage}x
                      </p>
                      <p className="mt-1 text-gray-400">
                        Limit {formatPrice(order.limitPrice)} | TP {formatPrice(order.takeProfit)} | SL{" "}
                        {formatPrice(order.stopLoss)}
                      </p>
                      {order.error && <p className="mt-1 text-red-400">{order.error}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="rounded border border-shadow-500 px-2 py-0.5 text-[10px] text-gray-300">
                        {order.status}
                      </span>
                      <div className="flex gap-1">
                        {(order.status === "pending" || order.status === "failed") && (
                          <button
                            onClick={() =>
                              setEditingOrderId(editingOrderId === order.id ? null : order.id)
                            }
                            className="rounded bg-shadow-600 px-2 py-1 text-[10px] text-gray-300"
                          >
                            Edit
                          </button>
                        )}
                        {order.status === "failed" ? (
                          <button
                            onClick={() => removeFailedLimitOrder(order)}
                            className="rounded bg-red-500/15 px-2 py-1 text-[10px] text-red-300"
                          >
                            Remove
                          </button>
                        ) : (
                          <span className="rounded bg-shadow-600 px-2 py-1 text-[10px] text-gray-400">
                            {order.status === "triggered" ? "In Flight" : "Queued"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {editingOrderId === order.id && (
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      <input
                        type="number"
                        defaultValue={order.limitPrice}
                        onBlur={(e) => updateOrderField(order.id, "limitPrice", e.target.value)}
                        placeholder="Limit"
                        className="rounded border border-shadow-500 bg-shadow-700 px-2 py-1 text-[11px]"
                      />
                      <input
                        type="number"
                        defaultValue={order.takeProfit ?? ""}
                        onBlur={(e) => updateOrderField(order.id, "takeProfit", e.target.value)}
                        placeholder="TP"
                        className="rounded border border-shadow-500 bg-shadow-700 px-2 py-1 text-[11px]"
                      />
                      <input
                        type="number"
                        defaultValue={order.stopLoss ?? ""}
                        onBlur={(e) => updateOrderField(order.id, "stopLoss", e.target.value)}
                        placeholder="SL"
                        className="rounded border border-shadow-500 bg-shadow-700 px-2 py-1 text-[11px]"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : displayed.length === 0 ? (
          <div className="py-7 text-center text-sm text-gray-500">
            {!publicKey
              ? "Connect wallet to view positions"
              : activeTab === "position"
              ? "No open positions - open a trade using the panel above"
              : "No closed positions yet"}
          </div>
        ) : activeTab === "position" ? (
          <div className="space-y-3 p-3">
            {displayed.map((pos) => {
              const isOpen = pos.status === "open";
              const isPending = pos.status === "pending";
              const isClosing = closingAddress === pos.address || pos.status === "closing";
              const isSettling = pos.status === "settling";
              const card = derivePositionCard(pos);
              const rule = positionRules[pos.address];
              const draft = ruleDrafts[pos.address] ?? {
                side: card.side ?? rule?.side ?? "long",
                takeProfit: rule?.takeProfit?.toString() ?? "",
                stopLoss: rule?.stopLoss?.toString() ?? "",
              };
              const pnlValue = card.unrealizedPnl;
              const pnlPercent = card.pnlPercent;
              const health = card.healthPercent;
              const healthBarWidth = `${Math.max(2, Math.round(health ?? 0))}%`;
              const healthTone =
                health === null
                  ? "bg-gray-500/60"
                  : health >= 70
                  ? "bg-gradient-to-r from-accent-green to-cyan-400"
                  : health >= 40
                  ? "bg-gradient-to-r from-yellow-400 to-orange-400"
                  : "bg-gradient-to-r from-accent-red to-rose-500";

              return (
                <div
                  key={pos.address}
                  className="rounded-xl border border-shadow-500 bg-shadow-700/55 p-4"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-2xl font-semibold tracking-tight text-white">
                        {card.pairLabel}
                      </p>
                      {card.side ? (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${
                            card.side === "long"
                              ? "bg-accent-green/20 text-accent-green"
                              : "bg-accent-red/20 text-accent-red"
                          }`}
                        >
                          {card.side}
                        </span>
                      ) : null}
                      {card.leverage ? (
                        <span className="rounded-full bg-accent-purple/20 px-2.5 py-0.5 text-[11px] font-semibold text-accent-purple">
                          {card.leverage}x
                        </span>
                      ) : null}
                      <span className="rounded-full bg-shadow-600 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-gray-300">
                        {card.marginMode}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {pos.hasEncryptedData ? (
                        <span className="rounded-full bg-accent-purple/20 px-2.5 py-0.5 text-[11px] font-semibold text-accent-purple">
                          Encrypted
                        </span>
                      ) : null}
                      <StatusBadge status={pos.status} isClosing={isClosing} />
                      <button
                        onClick={() => void handleClose(pos)}
                        disabled={TRADING_DISABLED || isClosing || isPending || isSettling}
                        className="rounded-lg border border-red-500/45 bg-red-500/10 px-3 py-1 text-[12px] font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {TRADING_DISABLED
                          ? "Disabled"
                          : isPending
                          ? "Waiting MPC"
                          : isSettling
                          ? "Settling..."
                          : isClosing
                          ? "Closing..."
                          : "Close"}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-[repeat(2,minmax(0,1fr))_minmax(280px,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <MetricBlock label="Entry Price" value={formatPrice(card.entryPrice)} />
                    <MetricBlock
                      label="Liq. Price"
                      value={formatPrice(card.liqPrice)}
                      valueClassName="text-accent-red"
                    />
                    <MetricBlock
                      label="Margin"
                      value={`$${(card.localMargin ?? pos.margin).toFixed(2)}`}
                    />
                    <div className="rounded-xl border border-shadow-600 bg-shadow-800/60 p-3">
                      <div className="mb-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-cyan-300">
                            Edit TP/SL
                          </p>
                          <p className="mt-1 text-[10px] text-gray-500">{card.pairLabel}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
                        <input
                          type="number"
                          value={draft.takeProfit}
                          onChange={(e) => updateRuleDraft(pos.address, "takeProfit", e.target.value)}
                          placeholder="Take Profit"
                          className="rounded-lg border border-shadow-500 bg-shadow-700 px-3 py-2 text-sm text-white focus:border-cyan-400/50 focus:outline-none"
                        />
                        <input
                          type="number"
                          value={draft.stopLoss}
                          onChange={(e) => updateRuleDraft(pos.address, "stopLoss", e.target.value)}
                          placeholder="Stop Loss"
                          className="rounded-lg border border-shadow-500 bg-shadow-700 px-3 py-2 text-sm text-white focus:border-cyan-400/50 focus:outline-none"
                        />
                        <button
                          onClick={() => saveRule(pos.address)}
                          className="rounded-lg bg-cyan-500/15 px-3 py-2 text-sm font-medium text-cyan-300 transition-colors hover:bg-cyan-500/25"
                        >
                          Save
                        </button>
                      </div>
                      {(rule || draft.takeProfit || draft.stopLoss) && (
                        <p className="mt-2 text-[10px] text-cyan-300">
                          Current: {draft.side.toUpperCase()} {formatPrice(rule?.takeProfit ?? parseOptionalPositive(draft.takeProfit))} /{" "}
                          {formatPrice(rule?.stopLoss ?? parseOptionalPositive(draft.stopLoss))}
                        </p>
                      )}
                    </div>
                    <MetricBlock
                      label="PnL"
                      value={
                        pnlValue === null
                          ? "Encrypted"
                          : `${pnlValue >= 0 ? "+" : ""}$${Math.abs(pnlValue).toFixed(2)}`
                      }
                      subtitle={
                        pnlPercent === null
                          ? undefined
                          : `(${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`
                      }
                      valueClassName={
                        pnlValue === null
                          ? "text-accent-purple encrypted-blur"
                          : pnlValue >= 0
                          ? "text-accent-green"
                          : "text-accent-red"
                      }
                    />
                  </div>

                  <div className="mt-3">
                    <div className="mb-1.5 flex items-center justify-between text-[11px] text-gray-400">
                      <span>Health</span>
                      <span className="font-semibold text-gray-300">
                        {health === null ? "--" : `${Math.round(health)}%`}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-shadow-600">
                      <div
                        className={`h-full rounded-full transition-all ${healthTone}`}
                        style={{ width: healthBarWidth }}
                      />
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-shadow-700 text-gray-500">
                <th className="px-4 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Opened</th>
                <th className="px-3 py-2 text-right font-medium">Margin</th>
                <th className="px-3 py-2 text-right font-medium">TP / SL</th>
                <th className="px-3 py-2 text-right font-medium">Realized PnL</th>
                {showActionCol && <th className="px-4 py-2 text-right font-medium">Action</th>}
              </tr>
            </thead>
            <tbody>
              {displayed.map((pos) => {
                const isClosing = closingAddress === pos.address || pos.status === "closing";
                const isFinal = pos.status === "closed" || pos.status === "liquidated";
                const rule = positionRules[pos.address];

                return (
                  <tr
                    key={pos.address}
                    className="border-b border-shadow-700 transition-colors hover:bg-shadow-700/30"
                  >
                    <td className="px-4 py-2.5 text-gray-400">#{pos.index.toString()}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={pos.status} isClosing={isClosing} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-gray-400">
                      {pos.openedAt.toLocaleDateString()}{" "}
                      {pos.openedAt.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">${pos.margin.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {rule ? (
                        <span className="text-[10px] text-cyan-300">
                          {rule.side.toUpperCase()} {formatPrice(rule.takeProfit)} /{" "}
                          {formatPrice(rule.stopLoss)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-500">Not set</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {isFinal ? (
                        <span
                          className={`font-medium ${
                            pos.realizedPnl >= 0 ? "text-accent-green" : "text-accent-red"
                          }`}
                        >
                          {pos.realizedPnl >= 0 ? "+" : ""}${pos.realizedPnl.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-500">--</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
