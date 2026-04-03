import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BN from "bn.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import toast from "react-hot-toast";
import { createShadowPerpClient } from "../lib/create-client";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";
import { getExplorerTxUrl } from "../lib/explorer";
import { TRADING_DISABLED } from "../lib/feature-flags";
import { classifyArciumError } from "../lib/arcium-errors";
import OrderConfirmModal from "./OrderConfirmModal";
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
  setPositionViewsOwner,
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


export default function BottomPositionsPanel({
  activePairLabel,
  hidePnl = false,
  confirmClose = true,
  showNotifications = true,
}: {
  activePairLabel?: string;
  hidePnl?: boolean;
  confirmClose?: boolean;
  showNotifications?: boolean;
}) {
  const toastSuccess = useCallback((...args: Parameters<typeof toast.success>) => {
    if (!showNotifications) return "";
    return toast.success(...args);
  }, [showNotifications]) as typeof toast.success;
  const toastLoading = useCallback((...args: Parameters<typeof toast.loading>) => {
    if (!showNotifications) return "";
    return toast.loading(...args);
  }, [showNotifications]) as typeof toast.loading;
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
  const [closeConfirmPos, setCloseConfirmPos] = useState<UiPosition | null>(null);
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
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    setLoading(true);
    try {
      if (!clientRef.current) {
        clientRef.current = createShadowPerpClient(connection, anchorWallet);
      }
      const { client, runtime } = clientRef.current;
      const marketAddress =
        (activePairLabel ? runtime.marketRegistry[activePairLabel] : undefined) ??
        runtime.marketAddress;
      const onchain = await client.getUserPositionAccounts(marketAddress, publicKey);
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
        const market = await client.getMarket(marketAddress);
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
    // Ensure owner is set before reading views so plain-text storage is loaded
    if (publicKey) {
      setPositionViewsOwner(publicKey.toBase58());
    }
    setPositionRules(getPositionRules());
    setLimitOrders(getLimitOrders());
    setOwnerPositionViews(getOwnerPositionViews());
  }, [publicKey]);

  useEffect(() => {
    void loadPositions();
    const id = setInterval(() => void loadPositions(), 30_000);
    return () => clearInterval(id);
  }, [loadPositions]);

  // Load plain-text position views as soon as wallet is available
  useEffect(() => {
    if (publicKey) {
      setPositionViewsOwner(publicKey.toBase58());
    }
  }, [publicKey]);

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

  const executeClose = useCallback(
    async (pos: UiPosition) => {
      if (!publicKey || !anchorWallet) return;
      setClosingAddress(pos.address);
      try {
        if (!clientRef.current) {
          clientRef.current = createShadowPerpClient(connection, anchorWallet);
        }
        const { client, runtime } = clientRef.current;
        const marketAddress =
          (activePairLabel ? runtime.marketRegistry[activePairLabel] : undefined) ??
          runtime.marketAddress;
        const ownerTokenAccount = await client.getOwnerCollateralTokenAccount(
          marketAddress
        );
        toastLoading("Queuing close via Arcium MPC...", { id: pos.address });
        const tx = await client.closePosition(
          marketAddress,
          pos.index
        );
        toastLoading("Awaiting MPC callback and settlement...", { id: pos.address });
        const finalized = await client.finalizeClosePosition(
          marketAddress,
          publicKey,
          pos.index,
          ownerTokenAccount
        );
        toastSuccess(
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
        const classified = error?.classified ?? classifyArciumError(error);
        const msg = classified.message || "Failed to close position";
        if (!msg.includes("env var")) toast.error(msg, { id: pos.address });
      } finally {
        setClosingAddress(null);
      }
    },
    [activePairLabel, publicKey, anchorWallet, connection, loadPositions, toastSuccess, toastLoading]
  );

  const handleClose = useCallback(
    (pos: UiPosition) => {
      if (TRADING_DISABLED) {
        toast.error("Trading is temporarily disabled while Arcium devnet is being patched.");
        return;
      }
      if (confirmClose) {
        setCloseConfirmPos(pos);
        return;
      }
      void executeClose(pos);
    },
    [confirmClose, executeClose]
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
    const pairLabel = view?.pairLabel ?? existingRule?.pairLabel ?? activePairLabel ?? "USD";
    if (tp === null && sl === null) {
      removePositionRule(address);
      toastSuccess("TP/SL rule removed");
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
    toastSuccess("TP/SL rule saved");
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
  const hasEncryptedPositions = openPositions.some((position) => position.hasEncryptedData);

  const derivePositionCard = useCallback(
    (position: UiPosition) => {
      const view = ownerPositionViews[position.address] ?? null;
      const rule = positionRules[position.address] ?? null;
      const side = view?.side ?? rule?.side ?? null;
      const marginMode = view?.marginMode ?? "cross";
      const leverage = view?.leverage ?? null;
      const entryPrice = view?.entryPrice ?? null;
      const pairLabel = view?.pairLabel ?? rule?.pairLabel ?? "SOL-USD";
      const sizeBase = view?.sizeBase ?? null;
      const baseSymbol = pairLabel.split("-")[0] ?? "USD";

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
        baseSymbol,
        side,
        marginMode,
        leverage,
        sizeBase,
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

      void executeClose(pos).finally(() => {
        autoCloseInFlightRef.current.delete(pos.address);
      });
    }
  }, [activeTab, executeClose, openPositions, oraclePrice, positionRules]);

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
      toastSuccess("Removed failed order");
    }
  }, []);

  return (
    <div className="trade-bottom-panel position-card flex flex-col h-full">
      {/* Tab bar — sticky within the panel */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-shadow-600 pl-1 pr-3 bg-shadow-900 shrink-0">
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
            Trade History
            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-shadow-600 text-[10px] text-gray-300">
              {historyPositions.length}
            </span>
          </TabBtn>
        </div>
        <div className="flex items-center gap-2">
          {hasEncryptedPositions ? (
            <span className="rounded-full bg-accent-purple/20 px-2.5 py-0.5 text-[11px] font-semibold text-accent-purple">
              Encrypted
            </span>
          ) : null}
        </div>

      </div>

      {/* Content */}
      <div className="overflow-x-auto flex-1 min-h-0">
      <div className="overflow-y-auto h-full">
        {/* ── ORDERS TAB ── */}
        {activeTab === "orders" ? (
          openOrders.length === 0 ? (
            <div className="py-6 text-center text-xs text-gray-500">No active orders.</div>
          ) : (
            <table className="w-full min-w-[700px] text-[11px]" style={{ borderCollapse: "separate", borderSpacing: "0 6px" }}>
              <thead className="sticky top-0 z-10 bg-shadow-900">
                <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-1.5 text-left font-medium">Pair</th>
                  <th className="px-2 py-1.5 text-left font-medium">Side</th>
                  <th className="px-2 py-1.5 text-left font-medium">Type</th>
                  <th className="px-2 py-1.5 text-right font-medium">Size</th>
                  <th className="px-2 py-1.5 text-right font-medium">Limit Price</th>
                  <th className="px-2 py-1.5 text-right font-medium">TP</th>
                  <th className="px-2 py-1.5 text-right font-medium">SL</th>
                  <th className="px-2 py-1.5 text-center font-medium">Status</th>
                  <th className="px-3 py-1.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {openOrders.map((order) => {
                  const isEditing = editingOrderId === order.id;
                  return (
                    <tr key={order.id} className="position-row group">
                      <td className="px-3 py-2.5 font-medium text-white">{order.pairLabel}</td>
                      <td className="px-2 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          order.side === "long" ? "bg-accent-green/20 text-accent-green" : "bg-accent-red/20 text-accent-red"
                        }`}>
                          {order.side}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1">
                          <span className="rounded bg-shadow-600 px-1.5 py-0.5 text-[10px] uppercase text-gray-400">{order.marginMode}</span>
                          <span className="rounded bg-accent-purple/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent-purple">{order.leverage}x</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right text-gray-300">{order.sizeBase.toFixed(4)}</td>
                      <td className="px-2 py-2.5 text-right">
                        {isEditing ? (
                          <input type="number" defaultValue={order.limitPrice} onBlur={(e) => updateOrderField(order.id, "limitPrice", e.target.value)}
                            className="w-[72px] rounded border border-shadow-500 bg-shadow-800 px-1.5 py-0.5 text-[11px] text-white text-right focus:border-accent-purple/50 focus:outline-none" />
                        ) : (
                          <span className="text-white font-medium">{formatPrice(order.limitPrice)}</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {isEditing ? (
                          <input type="number" defaultValue={order.takeProfit ?? ""} onBlur={(e) => updateOrderField(order.id, "takeProfit", e.target.value)}
                            placeholder="--" className="w-[72px] rounded border border-shadow-500 bg-shadow-800 px-1.5 py-0.5 text-[11px] text-white text-right focus:border-cyan-400/50 focus:outline-none" />
                        ) : (
                          <span className="text-cyan-300">{formatPrice(order.takeProfit) || "--"}</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {isEditing ? (
                          <input type="number" defaultValue={order.stopLoss ?? ""} onBlur={(e) => updateOrderField(order.id, "stopLoss", e.target.value)}
                            placeholder="--" className="w-[72px] rounded border border-shadow-500 bg-shadow-800 px-1.5 py-0.5 text-[11px] text-white text-right focus:border-accent-red/50 focus:outline-none" />
                        ) : (
                          <span className="text-accent-red">{formatPrice(order.stopLoss) || "--"}</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          order.status === "failed" ? "bg-red-500/15 text-red-400"
                            : order.status === "triggered" ? "bg-yellow-400/15 text-yellow-400"
                            : "bg-shadow-600 text-gray-400"
                        }`}>
                          {order.status === "triggered" && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                          {order.status === "triggered" ? "Executing" : order.status === "failed" ? "Failed" : "Queued"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {(order.status === "pending" || order.status === "failed") && (
                            <button onClick={() => setEditingOrderId(isEditing ? null : order.id)}
                              className="rounded bg-shadow-600 px-2 py-0.5 text-[10px] text-gray-300 hover:bg-shadow-500">
                              {isEditing ? "Done" : "Edit"}
                            </button>
                          )}
                          {order.status === "failed" && (
                            <button onClick={() => removeFailedLimitOrder(order)}
                              className="rounded bg-red-500/15 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-500/25">
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {openOrders.some((o) => o.error) && (
                <tfoot>
                  <tr>
                    <td colSpan={9} className="px-3 py-1.5 text-[10px] text-red-400/80">
                      {openOrders.filter((o) => o.error).map((o) => (
                        <p key={o.id} className="truncate">{o.pairLabel}: {o.error}</p>
                      ))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )

        /* ── POSITIONS TAB ── */
        ) : displayed.length === 0 ? (
          <div className="py-6 text-center text-xs text-gray-500">
            {!publicKey
              ? "Connect wallet to view positions"
              : activeTab === "position"
              ? "No open positions"
              : "No closed positions yet"}
          </div>
        ) : (
          <table className="w-full min-w-[800px] text-[11px]" style={{ borderCollapse: "separate", borderSpacing: "0 6px" }}>
            <thead className="sticky top-0 z-10 bg-shadow-900">
              <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-1.5 text-left font-medium">Pair</th>
                <th className="px-2 py-1.5 text-left font-medium">Side</th>
                <th className="px-2 py-1.5 text-left font-medium">Type</th>
                <th className="px-2 py-1.5 text-right font-medium">Entry</th>
                <th className="px-2 py-1.5 text-right font-medium">Liq. Price</th>
                <th className="px-2 py-1.5 text-right font-medium">Margin</th>
                <th className="px-2 py-1.5 text-right font-medium">PnL</th>
                {activeTab === "position" && <th className="px-2 py-1.5 text-right font-medium">TP / SL</th>}
                <th className="px-2 py-1.5 text-center font-medium">Health</th>
                <th className="px-3 py-1.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((pos) => {
                const isPending = pos.status === "pending";
                const isClosing = closingAddress === pos.address || pos.status === "closing";
                const isSettling = pos.status === "settling";
                const isFinal = pos.status === "closed" || pos.status === "liquidated";
                const card = derivePositionCard(pos);
                const rule = positionRules[pos.address];
                const draft = ruleDrafts[pos.address] ?? {
                  side: card.side ?? rule?.side ?? "long",
                  takeProfit: rule?.takeProfit?.toString() ?? "",
                  stopLoss: rule?.stopLoss?.toString() ?? "",
                };
                const displaySide = card.side ?? draft.side;
                const pnlValue = card.unrealizedPnl;
                const pnlPercent = card.pnlPercent;
                const health = card.healthPercent;
                const healthBarWidth = `${Math.max(2, Math.round(health ?? 0))}%`;
                const healthTone =
                  health === null ? "bg-gray-500/60"
                    : health >= 70 ? "bg-accent-green"
                    : health >= 40 ? "bg-yellow-400"
                    : "bg-accent-red";
                const historyActionLabel = pos.status === "liquidated" ? "Liquidated" : "Closed";
                const historySideLabel = displaySide
                  ? `${historyActionLabel} ${displaySide}`
                  : historyActionLabel;
                const historySizeLabel =
                  card.sizeBase !== null
                    ? `${card.sizeBase.toFixed(4)} ${card.baseSymbol}`
                    : null;
                const historyTimeLabel = pos.openedAt.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });

                return (
                  <tr key={pos.address} className="position-row group">
                    {/* Pair */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="font-medium text-white">{card.pairLabel}</div>
                      {activeTab === "history" && (
                        <div className="mt-0.5 text-[10px] text-gray-500">
                          {historySideLabel}
                          {historySizeLabel ? ` • ${historySizeLabel}` : ""}
                        </div>
                      )}
                    </td>
                    {/* Side */}
                    <td className="px-2 py-2.5">
                      {displaySide ? (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          displaySide === "long" ? "bg-accent-green/20 text-accent-green" : "bg-accent-red/20 text-accent-red"
                        }`}>
                          {displaySide}
                        </span>
                      ) : <span className="text-gray-500">--</span>}
                    </td>
                    {/* Type: leverage + margin mode */}
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1">
                        {card.leverage ? (
                          <span className="rounded bg-accent-purple/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent-purple">{card.leverage}x</span>
                        ) : null}
                        <span className="rounded bg-shadow-600 px-1.5 py-0.5 text-[10px] uppercase text-gray-400">{card.marginMode}</span>
                      </div>
                    </td>
                    {/* Entry */}
                    <td className="px-2 py-2.5 text-right text-white font-medium">{formatPrice(card.entryPrice)}</td>
                    {/* Liq */}
                    <td className="px-2 py-2.5 text-right text-accent-red">{formatPrice(card.liqPrice)}</td>
                    {/* Margin */}
                    <td className="px-2 py-2.5 text-right text-gray-300">${(card.localMargin ?? pos.margin).toFixed(2)}</td>
                    {/* PnL */}
                    <td className={`px-2 py-2.5 text-right font-medium ${
                      hidePnl ? "text-gray-500"
                        : pnlValue === null ? "text-gray-500"
                        : pnlValue >= 0 ? "text-accent-green" : "text-accent-red"
                    }`}>
                      {hidePnl ? "***" : isFinal ? (
                        <>{pos.realizedPnl >= 0 ? "+" : ""}${pos.realizedPnl.toFixed(2)}</>
                      ) : pnlValue === null ? "--" : (
                        <>{pnlValue >= 0 ? "+" : ""}${Math.abs(pnlValue).toFixed(2)}
                          {pnlPercent !== null && <span className="text-[10px] ml-0.5 opacity-70">({pnlPercent >= 0 ? "+" : ""}{pnlPercent.toFixed(1)}%)</span>}
                        </>
                      )}
                    </td>
                    {/* TP/SL */}
                    {activeTab === "position" && (
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <div className="relative">
                            <input type="number" value={draft.takeProfit} onChange={(e) => updateRuleDraft(pos.address, "takeProfit", e.target.value)}
                              className="w-[60px] rounded border border-shadow-500 bg-shadow-800 px-1.5 py-0.5 pr-5 text-[10px] text-white text-right focus:border-cyan-400/50 focus:outline-none" />
                            <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center text-[9px] font-bold text-cyan-300">TP</span>
                          </div>
                          <div className="relative">
                            <input type="number" value={draft.stopLoss} onChange={(e) => updateRuleDraft(pos.address, "stopLoss", e.target.value)}
                              className="w-[60px] rounded border border-shadow-500 bg-shadow-800 px-1.5 py-0.5 pr-5 text-[10px] text-white text-right focus:border-accent-red/50 focus:outline-none" />
                            <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center text-[9px] font-bold text-accent-red">SL</span>
                          </div>
                          <button onClick={() => saveRule(pos.address)}
                            className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-medium text-cyan-300 hover:bg-cyan-500/25">
                            Save
                          </button>
                        </div>
                      </td>
                    )}
                    {/* Health */}
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className="w-10 h-1 rounded-full bg-shadow-600">
                          <div className={`h-full rounded-full transition-all ${healthTone}`} style={{ width: healthBarWidth }} />
                        </div>
                        <span className="text-[10px] font-semibold text-gray-300 w-7 text-right">
                          {health === null ? "--" : `${Math.round(health)}%`}
                        </span>
                      </div>
                    </td>
                    {/* Action */}
                    <td className="px-3 py-2.5 text-right">
                      {activeTab === "history" ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <StatusBadge status={pos.status} isClosing={isClosing} />
                          <span className="text-[10px] text-gray-500">{historyTimeLabel}</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <StatusBadge status={pos.status} isClosing={isClosing} />
                          {!isPending && !isSettling && !isFinal ? (
                          <button onClick={() => void handleClose(pos)} disabled={TRADING_DISABLED || isClosing}
                            className="rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-40">
                            {TRADING_DISABLED ? "Off" : isClosing ? "Closing..." : "Close"}
                          </button>
                          ) : null}
                        </div>
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

      <OrderConfirmModal
        isOpen={closeConfirmPos !== null}
        title="Close Position"
        description="This will queue a close via Arcium MPC and settle on-chain."
        variant="danger"
        confirmLabel="Close Position"
        details={closeConfirmPos ? [
          { label: "Status", value: closeConfirmPos.status.charAt(0).toUpperCase() + closeConfirmPos.status.slice(1) },
          { label: "Margin", value: `$${closeConfirmPos.margin.toFixed(2)}` },
          { label: "Opened", value: closeConfirmPos.openedAt.toLocaleDateString() },
          { label: "Position", value: closeConfirmPos.address.slice(0, 8) + "..." },
        ] : []}
        onConfirm={() => {
          if (closeConfirmPos) void executeClose(closeConfirmPos);
          setCloseConfirmPos(null);
        }}
        onCancel={() => setCloseConfirmPos(null)}
      />
    </div>
  );
}
