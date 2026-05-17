import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BN from "bn.js";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { useConnection } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import toast from "react-hot-toast";
import { createShadowPerpClient } from "../lib/create-client";
import { fetchWalletHistory } from "../lib/history";
import type { IndexedRecentTx } from "../lib/history";
import {
  useAnchorWalletCompat,
  useWalletConnectionState,
  useWalletExecutionMode,
} from "../lib/use-anchor-wallet";
import { getExplorerTxUrl } from "../lib/explorer";
import { TRADING_DISABLED } from "../lib/feature-flags";
import { classifyArciumError } from "../lib/arcium-errors";
import { requestPanelRefresh, subscribePanelRefresh } from "../lib/panel-refresh";
import { ensureFreshMarketOracle, warmMarketOracle } from "../lib/oracle-refresh";
import OrderConfirmModal from "./OrderConfirmModal";
import CollateralModal from "./CollateralModal";
import {
  PendingLimitOrder,
  OwnerPositionView,
  PendingOpenPosition,
  getLimitOrders,
  getOwnerPositionViews,
  getPendingOpenPositions,
  PositionProtectionRule,
  getPositionRule,
  getPositionRules,
  removePendingOpenPosition,
  removeLimitOrder,
  removePositionRule,
  setPositionRule,
  setPositionViewsOwner,
  subscribeAutomationUpdates,
  updateLimitOrder,
} from "../lib/trade-automation";
import { fetchPrices, getLastPriceMeta } from "../lib/prices";
import { WALLET_DISPLAY_TOKENS } from "../lib/tokens";

type UiStatus = "open" | "closing" | "closed" | "pending" | "liquidated" | "settling";
type DirectionFilter = "all" | "active" | "long" | "short";
type BottomTab =
  | "positions"
  | "openOrders"
  | "balances"
  | "orderHistory"
  | "positionHistory";

interface UiPosition {
  address: string;
  marketAddress: string;
  pairLabel: string;
  index: BN;
  status: UiStatus;
  margin: number;
  openedAt: Date;
  realizedPnl: number;
  hasEncryptedData: boolean;
}

type Direction = "long" | "short";
type TpSlMode = "price" | "yield" | "percentage";
type TpSlDraft = {
  takeProfitMode: TpSlMode;
  takeProfitValue: string;
  stopLossMode: TpSlMode;
  stopLossValue: string;
};

interface TokenBalance {
  symbol: string;
  balance: number;
  color: string;
}

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
  pending: "Queued",
  open: "Open",
  closing: "Closing",
  settling: "Settle",
  closed: "Resolved",
  liquidated: "Liquidated",
};

function getStatusDetail(status: UiStatus, isClosing: boolean): string | null {
  if (isClosing || status === "closing") return "Closing the trade";
  if (status === "pending") return "Waiting for trade confirmation";
  if (status === "settling") return "Settlement ready; retry close when ready";
  if (status === "closed") return "Close settled on-chain";
  return null;
}

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

function formatOptionalPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return value < 0.01 ? value.toFixed(8) : value.toFixed(2);
}

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return value < 0.01 ? `$${value.toFixed(8)}` : `$${value.toFixed(2)}`;
}

function calculateTriggerPrice(
  mode: TpSlMode,
  valueRaw: string,
  trigger: "takeProfit" | "stopLoss",
  side: Direction,
  entryPrice: number | null,
  leverage: number | null
): number | null {
  const value = parseOptionalPositive(valueRaw);
  if (value === null) return null;
  if (mode === "price") return value;
  if (!entryPrice || entryPrice <= 0) return null;

  const bounded = Math.min(value, 100);
  const isLong = side === "long";
  const shouldIncrease =
    trigger === "takeProfit"
      ? isLong
      : !isLong;
  const movePct =
    mode === "yield" && leverage && leverage > 0
      ? bounded / leverage
      : bounded;
  const multiplier = shouldIncrease ? 1 + movePct / 100 : 1 - movePct / 100;
  return entryPrice * Math.max(0.000001, multiplier);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatAssetBalance(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  if (value < 0.001) return "<0.001";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value < 1 ? value.toFixed(4) : value.toFixed(2);
}

function formatDollarAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `$${value.toFixed(2)}`;
}

function TpSlEditor({
  label,
  tone,
  mode,
  value,
  preview,
  onModeChange,
  onValueChange,
}: {
  label: string;
  tone: "tp" | "sl";
  mode: TpSlMode;
  value: string;
  preview: number | null;
  onModeChange: (mode: TpSlMode) => void;
  onValueChange: (value: string) => void;
}) {
  const isSliderMode = mode !== "price";
  const accent = tone === "tp" ? "text-cyan-300" : "text-accent-red";
  const suffix = mode === "price" ? "Price" : mode === "yield" ? "ROI %" : "Move %";

  return (
    <div className="rounded-lg border border-shadow-600 bg-shadow-800/50 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`text-[11px] font-semibold ${accent}`}>{label}</span>
        <span className="text-[10px] text-gray-500">{formatPrice(preview)}</span>
      </div>
      <div className="mb-2 grid grid-cols-[1fr_1.2fr] gap-2">
        <select
          value={mode}
          onChange={(event) => onModeChange(event.target.value as TpSlMode)}
          className="rounded border border-shadow-500 bg-shadow-900 px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-accent-purple/60"
        >
          <option value="price">By price</option>
          <option value="yield">By ROI</option>
          <option value="percentage">By percentage</option>
        </select>
        <div className="relative">
          <input
            type="number"
            value={value}
            min={0}
            max={isSliderMode ? 100 : undefined}
            step={mode === "price" ? "any" : 1}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={suffix}
            className="w-full rounded border border-shadow-500 bg-shadow-900 px-2 py-1.5 pr-12 text-right text-[11px] text-white outline-none focus:border-accent-purple/60"
          />
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-gray-500">
            {mode === "price" ? "USD" : "%"}
          </span>
        </div>
      </div>
      {isSliderMode ? (
        <div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.min(parseOptionalPositive(value) ?? 0, 100)}
            onChange={(event) => onValueChange(event.target.value)}
            className="h-1 w-full cursor-pointer appearance-none rounded-full accent-accent-purple"
          />
          <div className="mt-1 flex justify-between text-[9px] text-gray-600">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const PANEL_TABLE_CLASS = "w-full min-w-[800px] text-[11px]";
const PANEL_TABLE_STYLE = { borderCollapse: "separate" as const, borderSpacing: "0 6px" };
const LOCAL_ORDER_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
const PENDING_POSITION_VIEW_TTL_MS = 5 * 60 * 1000;

function referenceMarkFromDepth(snapshot: {
  bids?: Array<{ price?: number }>;
  asks?: Array<{ price?: number }>;
  lastTrade?: { price?: number } | null;
} | null): number | null {
  const last = snapshot?.lastTrade?.price;
  if (typeof last === "number" && Number.isFinite(last) && last > 0) return last;
  const bid = snapshot?.bids?.[0]?.price;
  const ask = snapshot?.asks?.[0]?.price;
  if (
    typeof bid === "number" &&
    Number.isFinite(bid) &&
    bid > 0 &&
    typeof ask === "number" &&
    Number.isFinite(ask) &&
    ask > 0
  ) {
    return (bid + ask) / 2;
  }
  return null;
}


export default function BottomPositionsPanel({
  activePairLabel,
  activePairPrice,
  onPairSelect,
  hidePnl = false,
  confirmClose = true,
  showNotifications = true,
}: {
  activePairLabel?: string;
  activePairPrice?: number | null;
  onPairSelect?: (pairLabel: string) => void;
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
  const anchorWallet = useAnchorWalletCompat();
  const { connected } = useWalletConnectionState();
  const walletExecutionMode = useWalletExecutionMode();
  const publicKey = anchorWallet?.publicKey ?? null;
  const { getAccessToken } = usePrivy();
  const { connection } = useConnection();
  const [positions, setPositions] = useState<UiPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [closingAddress, setClosingAddress] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BottomTab>("positions");
  const [limitOrders, setLimitOrders] = useState<PendingLimitOrder[]>([]);
  const [positionRules, setPositionRules] = useState<Record<string, PositionProtectionRule>>({});
  const [ownerPositionViews, setOwnerPositionViews] = useState<Record<string, OwnerPositionView>>(
    {}
  );
  const [pendingOpenPositions, setPendingOpenPositions] = useState<Record<string, PendingOpenPosition>>(
    {}
  );
  const [indexedHistoryPositions, setIndexedHistoryPositions] = useState<UiPosition[] | null>(
    null
  );
  const [indexedOrderActivity, setIndexedOrderActivity] = useState<IndexedRecentTx[] | null>(
    null
  );
  const [historyPositionsNotice, setHistoryPositionsNotice] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [tpSlModalAddress, setTpSlModalAddress] = useState<string | null>(null);
  const [tpSlDraft, setTpSlDraft] = useState<TpSlDraft>({
    takeProfitMode: "price",
    takeProfitValue: "",
    stopLossMode: "price",
    stopLossValue: "",
  });
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [closeConfirmPos, setCloseConfirmPos] = useState<UiPosition | null>(null);
  const [oraclePrice, setOraclePrice] = useState<number | null>(null);
  const [liqThreshold, setLiqThreshold] = useState(5);
  const [filterCurrentMarket, setFilterCurrentMarket] = useState(false);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const [pairPrices, setPairPrices] = useState<Record<string, number>>({});
  const [pairLiqThresholds, setPairLiqThresholds] = useState<Record<string, number>>({});
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [walletSolBalance, setWalletSolBalance] = useState<number | null>(null);
  const [walletTokenBalances, setWalletTokenBalances] = useState<TokenBalance[]>([]);
  const [accountTotal, setAccountTotal] = useState<number | null>(null);
  const [freeCollateral, setFreeCollateral] = useState<number | null>(null);
  const [lockedCollateral, setLockedCollateral] = useState<number | null>(null);
  const autoCloseInFlightRef = useRef<Set<string>>(new Set());
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);
  const [collateralModalOpen, setCollateralModalOpen] = useState(false);
  const [collateralModalTab, setCollateralModalTab] = useState<"deposit" | "withdraw">("deposit");
  const [balancesRefreshTick, setBalancesRefreshTick] = useState(0);
  const [panelRefreshTick, setPanelRefreshTick] = useState(0);

  // Reset cached client when wallet or wallet mode changes
  useEffect(() => {
    clientRef.current = null;
  }, [anchorWallet, walletExecutionMode]);

  const prevPublicKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const current = publicKey?.toBase58() ?? null;
    const prev = prevPublicKeyRef.current;
    const walletConnected = walletExecutionMode !== "none" || connected;
    if (current === null && !walletConnected) {
      // Wallet fully disconnected — clear everything
      setPositions([]);
      setIndexedHistoryPositions(null);
      setHistoryPositionsNotice(null);
      setWalletSolBalance(null);
      setWalletTokenBalances([]);
      setAccountTotal(null);
      setFreeCollateral(null);
      setLockedCollateral(null);
    } else if (current !== null && prev !== null && current !== prev) {
      // Different wallet connected — clear so we don't show stale data
      setPositions([]);
      setIndexedHistoryPositions(null);
      setHistoryPositionsNotice(null);
      setWalletSolBalance(null);
      setWalletTokenBalances([]);
      setAccountTotal(null);
      setFreeCollateral(null);
      setLockedCollateral(null);
    }
    prevPublicKeyRef.current = current;
  }, [publicKey, connected, walletExecutionMode]);

  // Seed from cache as soon as wallet key is known, before first fetch completes
  useEffect(() => {
    if (!publicKey) return;
    try {
      const raw = localStorage.getItem(`shadow:positions:v1:${publicKey.toBase58()}`);
      if (raw) {
        const cached = JSON.parse(raw) as UiPosition[];
        setPositions((prev) => (prev.length === 0 ? cached : prev));
      }
    } catch { /* ignore */ }
  }, [publicKey]);

  const loadPositions = useCallback(async () => {
    if (!publicKey || !anchorWallet) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    setLoading(true);
    try {
      if (!clientRef.current) {
        clientRef.current = createShadowPerpClient(connection, anchorWallet, walletExecutionMode);
      }
      const { client, runtime } = clientRef.current;
      const configuredMarkets = Array.from(
        new Map(
          Object.entries(runtime.marketRegistry).map(([label, address]) => [
            address.toBase58(),
            { label, address },
          ])
        ).values()
      );
      if (!configuredMarkets.some((entry) => entry.address.equals(runtime.marketAddress))) {
        configuredMarkets.unshift({
          label: activePairLabel ?? "SOL-USD",
          address: runtime.marketAddress,
        });
      }

      const labelByMarket = new Map(
        configuredMarkets.map(({ label, address }) => [address.toBase58(), label] as const)
      );
      const onchain = await client.getUserPositionAccountsAcrossMarkets(
        configuredMarkets.map(({ address }) => address),
        publicKey
      );
      const mapped: UiPosition[] = onchain.map((p) => {
        const account = p.account as any;
        const encData: number[] | Uint8Array = account.encryptedData ?? [];
        const marketAddress = new PublicKey(account.market).toBase58();
        return {
          address: p.publicKey.toBase58(),
          marketAddress,
          pairLabel: labelByMarket.get(marketAddress) ?? activePairLabel ?? "SOL-USD",
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
      for (const position of mapped) {
        removePendingOpenPosition(position.address);
      }
      // Persist so positions appear immediately on next refresh
      try {
        const walletKey = publicKey.toBase58();
        localStorage.setItem(`shadow:positions:v1:${walletKey}`, JSON.stringify(mapped));
        localStorage.setItem("shadow:positions:last", walletKey);
      } catch { /* storage quota — not fatal */ }
      try {
        const [livePrices, marketResults] = await Promise.all([
          fetchPrices().catch(() => null),
          Promise.allSettled(
            configuredMarkets.map(async ({ label, address }) => {
              const market = await client.getMarket(address);
              const threshold = Number(market.liquidationThreshold) / 100;
              return {
                label,
                oraclePrice: new BN(market.oraclePrice.toString()).toNumber() / 1_000_000,
                liqThreshold:
                  Number.isFinite(threshold) && threshold > 0 && threshold <= 100 ? threshold : 5,
              };
            })
          ),
        ]);

        const nextPairPrices: Record<string, number> = {};
        const nextPairLiqThresholds: Record<string, number> = {};
        for (const result of marketResults) {
          if (result.status !== "fulfilled") continue;
          nextPairLiqThresholds[result.value.label] = result.value.liqThreshold;
          if (
            Number.isFinite(result.value.oraclePrice) &&
            result.value.oraclePrice > 0
          ) {
            nextPairPrices[result.value.label] = result.value.oraclePrice;
          } else {
            const livePrice = livePrices?.[result.value.label]?.price;
            if (Number.isFinite(livePrice) && livePrice! > 0) {
              nextPairPrices[result.value.label] = livePrice!;
            }
          }
        }
        setPairPrices((previous) => ({
          ...nextPairPrices,
          ...previous,
        }));
        setPairLiqThresholds(nextPairLiqThresholds);
        const selectedPrice =
          nextPairPrices[activePairLabel ?? ""] ??
          nextPairPrices[mapped[0]?.pairLabel ?? ""] ??
          null;
        if (selectedPrice !== null) {
          setOraclePrice(selectedPrice);
        }
        const selectedThreshold =
          nextPairLiqThresholds[activePairLabel ?? ""] ??
          nextPairLiqThresholds[mapped[0]?.pairLabel ?? ""];
        if (selectedThreshold) {
          setLiqThreshold(selectedThreshold);
        }
      } catch {
        // keep previous oracle price
      }
    } catch {
      // silent on config/runtime fetch errors
    } finally {
      setLoading(false);
    }
  }, [activePairLabel, publicKey, anchorWallet, connection, walletExecutionMode]);

  const loadAutomationState = useCallback(() => {
    // Ensure owner is set before reading views so plain-text storage is loaded
    if (publicKey) {
      setPositionViewsOwner(publicKey.toBase58());
    }
    setPositionRules(getPositionRules());
    setLimitOrders(getLimitOrders());
    setOwnerPositionViews(getOwnerPositionViews());
    setPendingOpenPositions(getPendingOpenPositions());
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

  useEffect(() => subscribePanelRefresh(() => {
    setPanelRefreshTick((tick) => tick + 1);
    loadAutomationState();
    void loadPositions();
  }), [loadAutomationState, loadPositions]);

  useEffect(() => {
    if (!publicKey || positions.length === 0) return;
    const activePositions = positions.filter((pos) =>
      pos.status === "open" || pos.status === "pending" || pos.status === "closing"
    );
    const uniqueMarkets = Array.from(
      new Map(
        activePositions.map((pos) => [
          pos.marketAddress,
          { marketAddress: pos.marketAddress, pairLabel: pos.pairLabel },
        ])
      ).values()
    ).slice(0, 4);

    for (const { marketAddress, pairLabel } of uniqueMarkets) {
      try {
        void warmMarketOracle({
          market: new PublicKey(marketAddress),
          pairLabel,
          getAccessToken,
          operation: "monitoring open positions",
          maxAgeSeconds: 180,
          minIntervalMs: 90_000,
        });
      } catch {
        // Bad cached metadata should not break the panel.
      }
    }
  }, [getAccessToken, positions, publicKey]);

  const refreshDisplayMarks = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    const labels = Array.from(
      new Set(
        [
          activePairLabel,
          ...positions
            .filter((pos) => pos.status === "open" || pos.status === "pending" || pos.status === "closing")
            .map((pos) => pos.pairLabel),
        ].filter((label): label is string => Boolean(label))
      )
    );
    if (labels.length === 0) return;

    const [depthResults, fallbackPrices] = await Promise.all([
      Promise.allSettled(
        labels.map(async (pairLabel) => {
          const response = await fetch(`/api/reference-depth?pair=${encodeURIComponent(pairLabel)}`, {
            signal: AbortSignal.timeout(5_000),
          });
          if (!response.ok) return { pairLabel, price: null };
          const snapshot = await response.json();
          return { pairLabel, price: referenceMarkFromDepth(snapshot) };
        })
      ),
      fetchPrices().catch(() => null),
    ]);
    const priceMeta = getLastPriceMeta();

    setPairPrices((previous) => {
      const next = { ...previous };
      if (
        activePairLabel &&
        typeof activePairPrice === "number" &&
        Number.isFinite(activePairPrice) &&
        activePairPrice > 0
      ) {
        next[activePairLabel] = activePairPrice;
      }
      for (const result of depthResults) {
        if (result.status !== "fulfilled") continue;
        const { pairLabel, price } = result.value;
        if (typeof price === "number" && Number.isFinite(price) && price > 0) {
          next[pairLabel] = price;
        }
      }
      if (priceMeta.quality !== "mock" && fallbackPrices) {
        for (const pairLabel of labels) {
          if (Number.isFinite(next[pairLabel]) && next[pairLabel] > 0) continue;
          const fallback = fallbackPrices[pairLabel]?.price;
          if (typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0) {
            next[pairLabel] = fallback;
          }
        }
      }
      return next;
    });
  }, [activePairLabel, activePairPrice, positions]);

  useEffect(() => {
    void refreshDisplayMarks();
    const id = window.setInterval(() => void refreshDisplayMarks(), 5_000);
    return () => window.clearInterval(id);
  }, [refreshDisplayMarks]);

  const executeClose = useCallback(
    async (pos: UiPosition) => {
      if (!publicKey || !anchorWallet) return;
      setClosingAddress(pos.address);
      try {
        if (!clientRef.current) {
          clientRef.current = createShadowPerpClient(connection, anchorWallet, walletExecutionMode);
        }
        const { client } = clientRef.current;
        const marketAddress = new PublicKey(pos.marketAddress);
        const ownerTokenAccount = await client.getOwnerCollateralTokenAccount(
          marketAddress
        );
        try {
          await ensureFreshMarketOracle({
            market: marketAddress,
            pairLabel: pos.pairLabel,
            getAccessToken,
            operation: "closing position",
          });
        } catch (err: any) {
          void err;
          throw new Error(
            "Live pricing is currently synchronizing on the network. Please try again in a few seconds."
          );
        }
        let tx: string | null = null;
        if (pos.status !== "settling") {
          toastLoading("Submitting close...", { id: pos.address });
          tx = await client.closePosition(
            marketAddress,
            pos.index
          );
        }
        toastLoading("Finishing settlement...", { id: pos.address });
        const finalized = await client.finalizeClosePosition(
          marketAddress,
          publicKey,
          pos.index,
          ownerTokenAccount
        );
        toastSuccess(
          <div>
            <p className="font-medium">Position closed and settled</p>
            <p className="text-xs text-gray-400 mt-0.5">PnL finalized and settlement completed on-chain</p>
            {tx ? (
              <a
                href={getExplorerTxUrl(tx)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent-purple underline mt-1 block"
              >
                View close transaction
              </a>
            ) : null}
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
        requestPanelRefresh("position-closed");
      } catch (error: any) {
        const classified = error?.classified ?? classifyArciumError(error);
        const msg = classified.message || "Failed to close position";
        if (!msg.includes("env var")) {
          if (classified.isRetryable && showNotifications) {
            toast.error(
              (t) => (
                <div className="flex items-center gap-3">
                  <span>{msg}</span>
                  <button
                    type="button"
                    onClick={() => {
                      toast.dismiss(t.id);
                      void executeCloseRef.current?.(pos);
                    }}
                    className="rounded-md bg-accent-purple/20 px-2.5 py-1 text-xs font-medium text-accent-purple hover:bg-accent-purple/30"
                  >
                    Retry
                  </button>
                </div>
              ),
              { id: pos.address, duration: 12_000 }
            );
          } else {
            toast.error(msg, { id: pos.address });
          }
        }
      } finally {
        setClosingAddress(null);
      }
    },
    [publicKey, anchorWallet, connection, getAccessToken, loadPositions, toastSuccess, toastLoading, showNotifications, walletExecutionMode]
  );

  const executeCloseRef = useRef<typeof executeClose | null>(null);
  useEffect(() => {
    executeCloseRef.current = executeClose;
  }, [executeClose]);

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

  const openTpSlModal = useCallback((pos: UiPosition) => {
    const rule = positionRules[pos.address];
    setTpSlDraft({
      takeProfitMode: "price",
      takeProfitValue: rule?.takeProfit ? formatOptionalPrice(rule.takeProfit) : "",
      stopLossMode: "price",
      stopLossValue: rule?.stopLoss ? formatOptionalPrice(rule.stopLoss) : "",
    });
    setTpSlModalAddress(pos.address);
  }, [positionRules]);

  const visibleOpenPositions = useMemo(() => {
    const knownAddresses = new Set(positions.map((position) => position.address));
    const pendingViewCutoff = Date.now() - PENDING_POSITION_VIEW_TTL_MS;
    const syntheticPendingPositions = Object.values(pendingOpenPositions)
      .filter((pending) => !knownAddresses.has(pending.positionAddress))
      .filter((pending) => pending.updatedAt >= pendingViewCutoff)
      .map((pending) => ({
        address: pending.positionAddress,
        marketAddress: "",
        pairLabel: pending.pairLabel,
        index: new BN(0),
        status: "pending" as const,
        margin:
          pending.leverage > 0
            ? (pending.entryPrice * pending.sizeBase) / pending.leverage
            : 0,
        openedAt: new Date(pending.openedAt),
        realizedPnl: 0,
        hasEncryptedData: false,
      }));

    return [...syntheticPendingPositions, ...positions]
      .filter((position) => ["open", "pending", "closing", "settling"].includes(position.status))
      .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  }, [pendingOpenPositions, positions]);

  const clearTpSlRule = useCallback((address: string) => {
    removePositionRule(address);
    toastSuccess("TP/SL rule removed");
    setTpSlModalAddress(null);
  }, [toastSuccess]);

  const saveTpSlRule = useCallback((address: string, card: {
    side: Direction | null;
    entryPrice: number | null;
    leverage: number | null;
  }) => {
    const side = card.side ?? positionRules[address]?.side ?? "long";
    const tp = calculateTriggerPrice(
      tpSlDraft.takeProfitMode,
      tpSlDraft.takeProfitValue,
      "takeProfit",
      side,
      card.entryPrice,
      card.leverage
    );
    const sl = calculateTriggerPrice(
      tpSlDraft.stopLossMode,
      tpSlDraft.stopLossValue,
      "stopLoss",
      side,
      card.entryPrice,
      card.leverage
    );
    const existingRule = positionRules[address];
    const view = ownerPositionViews[address];
    const position = visibleOpenPositions.find((item) => item.address === address);
    const pairLabel =
      view?.pairLabel ?? existingRule?.pairLabel ?? position?.pairLabel ?? activePairLabel ?? "SOL-USD";
    if (tp === null && sl === null) {
      clearTpSlRule(address);
      return;
    }
    setPositionRule({
      positionAddress: address,
      pairLabel,
      side,
      takeProfit: tp,
      stopLoss: sl,
      updatedAt: Date.now(),
    });
    toastSuccess("TP/SL rule saved");
    setTpSlModalAddress(null);
  }, [activePairLabel, clearTpSlRule, ownerPositionViews, positionRules, toastSuccess, tpSlDraft, visibleOpenPositions]);

  const openPositions = useMemo(
    () => visibleOpenPositions,
    [visibleOpenPositions]
  );
  const openOrders = useMemo(
    () => limitOrders.filter((o) => ["pending", "triggered"].includes(o.status)),
    [limitOrders]
  );
  const orderHistory = useMemo(
    () => {
      const cutoff = Date.now() - LOCAL_ORDER_HISTORY_RETENTION_MS;
      return limitOrders.filter(
        (o) =>
          ["filled", "failed", "cancelled"].includes(o.status) &&
          (o.updatedAt >= cutoff || o.createdAt >= cutoff)
      );
    },
    [limitOrders]
  );
  const chainOrderActivity = indexedOrderActivity ?? [];
  const historyPositions = indexedHistoryPositions ?? [];

  const filterPositions = useCallback((list: UiPosition[]) => {
    let result = list;
    if (filterCurrentMarket && activePairLabel) {
      result = result.filter((p) => p.pairLabel === activePairLabel);
    }
    if (directionFilter === "active") {
      result = result.filter((p) => p.status === "open" || p.status === "pending" || p.status === "closing" || p.status === "settling");
    } else if (directionFilter === "long") {
      result = result.filter((p) => {
        const side = ownerPositionViews[p.address]?.side ?? positionRules[p.address]?.side ?? null;
        return side === "long";
      });
    } else if (directionFilter === "short") {
      result = result.filter((p) => {
        const side = ownerPositionViews[p.address]?.side ?? positionRules[p.address]?.side ?? null;
        return side === "short";
      });
    }
    return result;
  }, [filterCurrentMarket, activePairLabel, directionFilter, ownerPositionViews, positionRules]);

  const hasActiveFilters = filterCurrentMarket || directionFilter !== "all";

  const displayed = useMemo(() => {
    const base =
      activeTab === "positions"
        ? openPositions
        : activeTab === "positionHistory"
        ? historyPositions
        : [];
    return filterPositions(base);
  }, [activeTab, openPositions, historyPositions, filterPositions]);

  const getFreshPairPrice = useCallback(
    (pairLabel: string): number | null => {
      const liveActivePrice =
        pairLabel === activePairLabel &&
        typeof activePairPrice === "number" &&
        Number.isFinite(activePairPrice) &&
        activePairPrice > 0
          ? activePairPrice
          : null;
      const cachedPrice = pairPrices[pairLabel];
      return liveActivePrice ??
        (Number.isFinite(cachedPrice) && cachedPrice > 0 ? cachedPrice : null);
    },
    [activePairLabel, activePairPrice, pairPrices]
  );

  const derivePositionCard = useCallback(
    (position: UiPosition) => {
      const view = ownerPositionViews[position.address] ?? null;
      const rule = positionRules[position.address] ?? null;
      const side = view?.side ?? rule?.side ?? null;
      const marginMode = view?.marginMode ?? "cross";
      const leverage = view?.leverage ?? null;
      const entryPrice = view?.entryPrice ?? null;
      const pairLabel = view?.pairLabel ?? position.pairLabel ?? rule?.pairLabel ?? "SOL-USD";
      const sizeBase = view?.sizeBase ?? null;
      const baseSymbol = pairLabel.split("-")[0] ?? "USD";
      const pairOraclePrice = getFreshPairPrice(pairLabel);
      const pairLiqThreshold = pairLiqThresholds[pairLabel] ?? liqThreshold;

      let liqPrice: number | null = null;
      if (entryPrice !== null && leverage !== null && leverage > 0) {
        const liqFactor = (1 - pairLiqThreshold / 100) / leverage;
        liqPrice =
          side === "short"
            ? entryPrice * (1 + liqFactor)
            : entryPrice * (1 - liqFactor);
      }

      let unrealizedPnl: number | null = null;
      if (
        entryPrice !== null &&
        sizeBase !== null &&
        pairOraclePrice !== null &&
        Number.isFinite(pairOraclePrice)
      ) {
        const direction = side === "short" ? -1 : 1;
        unrealizedPnl = (pairOraclePrice - entryPrice) * sizeBase * direction;
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
        pairOraclePrice !== null &&
        side
      ) {
        if (side === "long") {
          const denominator = entryPrice - liqPrice;
          if (denominator > 0) {
            healthPercent = clampPercent(((pairOraclePrice - liqPrice) / denominator) * 100);
          }
        } else {
          const denominator = liqPrice - entryPrice;
          if (denominator > 0) {
            healthPercent = clampPercent(((liqPrice - pairOraclePrice) / denominator) * 100);
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
    [getFreshPairPrice, liqThreshold, ownerPositionViews, pairLiqThresholds, positionRules]
  );

  useEffect(() => {
    if (TRADING_DISABLED) return;
    if (activeTab !== "positions") return;
    for (const pos of openPositions) {
      if (pos.status !== "open") continue;
      if (autoCloseInFlightRef.current.has(pos.address)) continue;
      const rule = positionRules[pos.address];
      if (!rule) continue;
      const triggerPrice = getFreshPairPrice(rule.pairLabel);
      if (!triggerPrice || !Number.isFinite(triggerPrice)) continue;
      const hit =
        rule.side === "long"
          ? (rule.takeProfit !== null && triggerPrice >= rule.takeProfit) ||
            (rule.stopLoss !== null && triggerPrice <= rule.stopLoss)
          : (rule.takeProfit !== null && triggerPrice <= rule.takeProfit) ||
            (rule.stopLoss !== null && triggerPrice >= rule.stopLoss);

      if (!hit) continue;

      autoCloseInFlightRef.current.add(pos.address);
      toast(
        `TP/SL hit for #${pos.index.toString()} at ${formatPrice(triggerPrice)}. Closing position...`,
        { id: `tp-sl-${pos.address}` }
      );

      void executeClose(pos).finally(() => {
        autoCloseInFlightRef.current.delete(pos.address);
      });
    }
  }, [activeTab, executeClose, getFreshPairPrice, openPositions, positionRules]);

  useEffect(() => {
    if (activeTab !== "positionHistory" && activeTab !== "orderHistory") return;
    if (!publicKey || !anchorWallet) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }

    let cancelled = false;
    void (async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new Error("Sign in again to load wallet history.");
        }
        const snapshot = await fetchWalletHistory({
          wallet: publicKey.toBase58(),
          limit: 100,
          includePositions: activeTab === "positionHistory",
          accessToken,
        });
        if (!cancelled) {
          if (activeTab === "orderHistory") {
            setIndexedOrderActivity(snapshot.activity);
          } else {
            const mapped: UiPosition[] = snapshot.historyPositions.map((row) => ({
              address: row.address,
              marketAddress: row.marketAddress,
              pairLabel: row.pairLabel,
              index: new BN(row.index),
              status: parseStatus(row.status),
              margin: row.margin,
              openedAt: new Date(row.openedAt),
              realizedPnl: row.realizedPnl,
              hasEncryptedData: row.hasEncryptedData,
            }));
            setIndexedHistoryPositions(mapped);
            setHistoryPositionsNotice(snapshot.historyPositionsNotice ?? null);
          }
        }
      } catch (error: any) {
        if (!cancelled) {
          setHistoryError(
            typeof error?.message === "string" && error.message.trim().length > 0
              ? error.message
              : "Failed to load wallet history."
          );
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, anchorWallet, getAccessToken, panelRefreshTick, publicKey]);

  useEffect(() => {
    if (activeTab !== "balances") return;
    if (!publicKey || !anchorWallet) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }

    let cancelled = false;
    void (async () => {
      setBalancesLoading(true);
      try {
        if (!clientRef.current) {
          clientRef.current = createShadowPerpClient(connection, anchorWallet, walletExecutionMode);
        }
        const { client } = clientRef.current;
        const [solLamports, tokenResults, marginResult] = await Promise.all([
          connection.getBalance(publicKey),
          Promise.all(
            WALLET_DISPLAY_TOKENS.map(async (token) => {
              try {
                const ata = await getAssociatedTokenAddress(token.mint, publicKey);
                const info = await connection.getTokenAccountBalance(ata);
                const amount = info.value.uiAmount ?? 0;
                return amount > 0
                  ? { symbol: token.symbol, balance: amount, color: token.color }
                  : null;
              } catch {
                return null;
              }
            })
          ),
          client
            .getMarginAccount(client.getMarginAccountAddress(publicKey))
            .then((account) => {
              const total = new BN(account.balance.toString()).toNumber() / 1_000_000;
              const locked = new BN(account.lockedBalance.toString()).toNumber() / 1_000_000;
              return {
                total,
                locked,
                free: Math.max(0, total - locked),
              };
            })
            .catch(() => ({ total: 0, locked: 0, free: 0 })),
        ]);

        if (cancelled) return;
        setWalletSolBalance(solLamports / LAMPORTS_PER_SOL);
        setWalletTokenBalances(
          tokenResults.filter((entry): entry is TokenBalance => entry !== null)
        );
        setAccountTotal(marginResult.total);
        setFreeCollateral(marginResult.free);
        setLockedCollateral(marginResult.locked);
      } catch {
        // On error keep existing balance data — don't blank the display
      } finally {
        if (!cancelled) {
          setBalancesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, anchorWallet, balancesRefreshTick, connection, panelRefreshTick, publicKey, walletExecutionMode]);

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

  // Close filter dropdown on outside click
  useEffect(() => {
    if (!filterDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setFilterDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [filterDropdownOpen]);

  const tabs: { key: BottomTab; label: string; count?: number }[] = [
    { key: "positions", label: "Positions", count: openPositions.length },
    { key: "openOrders", label: "Open Orders", count: openOrders.length },
    { key: "balances", label: "Balances" },
    { key: "orderHistory", label: "Order History" },
    { key: "positionHistory", label: "Position History" },
  ];

  const tpSlModalPosition = tpSlModalAddress
  ? visibleOpenPositions.find((position) => position.address === tpSlModalAddress) ?? null
  : null;
  const tpSlModalCard = tpSlModalPosition ? derivePositionCard(tpSlModalPosition) : null;
  const tpSlModalRule =
    tpSlModalPosition ? positionRules[tpSlModalPosition.address] ?? null : null;
  const tpPreview = tpSlModalCard
    ? calculateTriggerPrice(
        tpSlDraft.takeProfitMode,
        tpSlDraft.takeProfitValue,
        "takeProfit",
        tpSlModalCard.side ?? "long",
        tpSlModalCard.entryPrice,
        tpSlModalCard.leverage
      )
    : null;
  const slPreview = tpSlModalCard
    ? calculateTriggerPrice(
        tpSlDraft.stopLossMode,
        tpSlDraft.stopLossValue,
        "stopLoss",
        tpSlModalCard.side ?? "long",
        tpSlModalCard.entryPrice,
        tpSlModalCard.leverage
      )
    : null;

  return (
    <div className="trade-bottom-panel position-card flex flex-col h-full">
      {/* Tab bar — sticky within the panel */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-shadow-600 pl-1 pr-3 bg-shadow-900 shrink-0">
        <div className="flex overflow-x-auto">
          {tabs.map((tab) => (
            <TabBtn key={tab.key} active={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}>
              {tab.label}
              {typeof tab.count === "number" ? (
                <span className="ml-1.5 px-1.5 py-0.5 rounded bg-shadow-600 text-[10px] text-gray-300">
                  {tab.count}
                </span>
              ) : null}
            </TabBtn>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {/* Current Market toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={filterCurrentMarket}
              onChange={(e) => setFilterCurrentMarket(e.target.checked)}
              className="w-3 h-3 accent-purple-500 cursor-pointer"
            />
            <span className="text-[11px] text-gray-400 group-hover:text-gray-200 transition-colors whitespace-nowrap">
              Current Market
            </span>
          </label>

          {/* Direction filter dropdown */}
          <div className="relative" ref={filterDropdownRef}>
            <button
              onClick={() => setFilterDropdownOpen((v) => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                directionFilter !== "all"
                  ? "bg-accent-purple/20 text-accent-purple"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Filter
              <svg
                className={`w-3 h-3 transition-transform ${filterDropdownOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {filterDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[100px] rounded-lg border border-shadow-600 bg-shadow-800 py-1 shadow-lg">
                {(["all", "active", "long", "short"] as DirectionFilter[]).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setDirectionFilter(opt);
                      setFilterDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-[11px] transition-colors capitalize ${
                      directionFilter === opt
                        ? "text-white bg-accent-purple/20"
                        : "text-gray-400 hover:text-white hover:bg-shadow-700"
                    }`}
                  >
                    {opt === "all" ? "All" : opt === "active" ? "Active" : opt === "long" ? "Long" : "Short"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear all filters */}
          {hasActiveFilters && (
            <button
              onClick={() => { setFilterCurrentMarket(false); setDirectionFilter("all"); }}
              className="text-[11px] text-gray-500 hover:text-gray-200 transition-colors px-1"
              title="Clear filters"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="overflow-x-auto flex-1 min-h-0">
      <div className="overflow-y-auto h-full">
        {activeTab === "balances" ? (
          !publicKey ? (
            <div className="py-6 text-center text-xs text-gray-500">Connect wallet to view balances.</div>
          ) : balancesLoading ? (
            <div className="py-6 text-center text-xs text-gray-500">Refreshing balances...</div>
          ) : (
            <div className="flex flex-wrap gap-6 px-4 py-3">
              {/* Wallet */}
              <div className="min-w-[200px]">
                <p className="mb-2 text-[10px] uppercase tracking-widest text-gray-500">Wallet</p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-8">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full" style={{ background: "linear-gradient(135deg, #9945FF, #14F195)" }} />
                      <span className="text-xs text-gray-400">SOL</span>
                    </div>
                    <span className="text-xs font-medium text-white">{formatAssetBalance(walletSolBalance)}</span>
                  </div>
                  {walletTokenBalances.length === 0 ? (
                    <p className="text-[11px] text-gray-600">No SPL tokens found.</p>
                  ) : (
                    walletTokenBalances.map((token) => (
                      <div key={token.symbol} className="flex items-center justify-between gap-8">
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: token.color }} />
                          <span className="text-xs text-gray-400">{token.symbol}</span>
                        </div>
                        <span className="text-xs font-medium text-white">{formatAssetBalance(token.balance)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="hidden w-px self-stretch bg-shadow-600/60 lg:block" />

              {/* Trading Account */}
              <div className="min-w-[260px]">
                <p className="mb-2 text-[10px] uppercase tracking-widest text-gray-500">Trading Account</p>
                <div className="flex items-end gap-6">
                  <div>
                    <p className="text-[10px] text-gray-500">Total</p>
                    <p className="text-base font-semibold text-white">{formatDollarAmount(accountTotal)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">Available</p>
                    <p className="text-base font-semibold text-accent-green">{formatDollarAmount(freeCollateral)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">Locked</p>
                    <p className="text-base font-semibold text-yellow-300">{formatDollarAmount(lockedCollateral)}</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-gray-600">Locked collateral is held by open positions.</p>
              </div>

              {/* Divider */}
              <div className="hidden w-px self-stretch bg-shadow-600/60 lg:block" />

              {/* Actions */}
              <div className="flex flex-col justify-center gap-2">
                <button
                  onClick={() => { setCollateralModalTab("deposit"); setCollateralModalOpen(true); }}
                  className="rounded-lg bg-accent-purple/20 px-4 py-1.5 text-xs font-medium text-accent-purple transition-colors hover:bg-accent-purple/30"
                >
                  Deposit
                </button>
                <button
                  onClick={() => { setCollateralModalTab("withdraw"); setCollateralModalOpen(true); }}
                  className="rounded-lg bg-shadow-700/60 px-4 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-shadow-600/60"
                >
                  Withdraw
                </button>
              </div>
            </div>
          )
        ) : activeTab === "orderHistory" ? (
          historyLoading && chainOrderActivity.length === 0 && orderHistory.length === 0 ? (
            <div className="py-6 text-center text-xs text-gray-500">Loading wallet history...</div>
          ) : historyError && chainOrderActivity.length === 0 && orderHistory.length === 0 ? (
            <div className="py-6 text-center text-xs text-accent-red">{historyError}</div>
          ) : chainOrderActivity.length === 0 && orderHistory.length === 0 ? (
            <div className="py-6 text-center text-xs text-gray-500">
              No wallet order history yet.
            </div>
          ) : (
            <div className="space-y-3 p-4">
              <p className="text-xs text-gray-500">
                Recent wallet activity plus this browser's last 24h of Shadow limit/TP-SL automation.
              </p>
              {historyError ? (
                <p className="rounded-lg border border-yellow-400/20 bg-yellow-400/10 px-3 py-2 text-xs text-yellow-200">
                  Showing cached history. Latest refresh failed: {historyError}
                </p>
              ) : null}
              {chainOrderActivity.map((tx) => {
                const txType = tx.txType;
                const label = txType?.label ?? "Transaction";
                const tone = tx.err
                  ? "text-accent-red"
                  : txType?.color ?? "text-gray-300";
                const when = tx.blockTime
                  ? new Date(tx.blockTime * 1000).toLocaleString()
                  : `Slot ${tx.slot}`;
                return (
                  <a
                    key={tx.sig}
                    href={getExplorerTxUrl(tx.sig)}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-shadow-600 bg-shadow-800/60 px-4 py-3 transition-colors hover:border-accent-purple/40"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className={`text-sm font-semibold ${tone}`}>
                          {tx.err ? `${label} failed` : label}
                        </p>
                        <p className="mt-1 max-w-2xl truncate text-xs text-gray-500">
                          {tx.memo ?? txType?.detail ?? "On-chain wallet activity"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-400">{when}</p>
                        <p className="mt-1 font-mono text-[10px] text-accent-purple">
                          {tx.sig.slice(0, 6)}...{tx.sig.slice(-6)}
                        </p>
                      </div>
                    </div>
                  </a>
                );
              })}
              {orderHistory.map((order) => (
                <div key={order.id} className="rounded-xl border border-shadow-600 bg-shadow-800/60 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{order.pairLabel}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          order.side === "long" ? "bg-accent-green/20 text-accent-green" : "bg-accent-red/20 text-accent-red"
                        }`}>
                          {order.side}
                        </span>
                        <span className="rounded bg-shadow-600 px-1.5 py-0.5 text-[10px] uppercase text-gray-400">
                          {order.marginMode}
                        </span>
                        <span className="rounded bg-accent-purple/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent-purple">
                          {order.leverage}x
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        Created {new Date(order.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className={`rounded px-2 py-1 text-[10px] font-semibold uppercase ${
                      order.status === "filled"
                        ? "bg-accent-green/15 text-accent-green"
                        : order.status === "failed"
                        ? "bg-accent-red/15 text-accent-red"
                        : "bg-shadow-600 text-gray-300"
                    }`}>
                      {order.status}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 text-xs text-gray-400 sm:grid-cols-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Size</p>
                      <p className="mt-1 text-sm text-white">{order.sizeBase.toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Limit</p>
                      <p className="mt-1 text-sm text-white">{formatPrice(order.limitPrice)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Take Profit</p>
                      <p className="mt-1 text-sm text-white">{formatPrice(order.takeProfit)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Stop Loss</p>
                      <p className="mt-1 text-sm text-white">{formatPrice(order.stopLoss)}</p>
                    </div>
                  </div>
                  {order.error ? (
                    <p className="mt-3 text-xs text-accent-red">{order.error}</p>
                  ) : null}
                  {order.txSignature ? (
                    <a
                      href={getExplorerTxUrl(order.txSignature)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex text-xs text-accent-purple hover:underline"
                    >
                      View transaction
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : activeTab === "openOrders" ? (
          openOrders.length === 0 ? (
            <div className="py-6 text-center text-xs text-gray-500">No active orders.</div>
          ) : (
            <table className={PANEL_TABLE_CLASS} style={PANEL_TABLE_STYLE}>
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
        ) : historyLoading && activeTab === "positionHistory" && displayed.length === 0 ? (
          <div className="py-6 text-center text-xs text-gray-500">Loading position history...</div>
        ) : historyError && activeTab === "positionHistory" && displayed.length === 0 ? (
          <div className="py-6 text-center text-xs text-accent-red">{historyError}</div>
        ) : displayed.length === 0 ? (
          <div className="py-6 text-center text-xs text-gray-500">
            {!publicKey
              ? "Connect wallet to view positions"
              : activeTab === "positions"
              ? "No open positions"
              : "No closed positions yet"}
          </div>
        ) : (
          <div className="space-y-2">
            {activeTab === "positionHistory" && historyError ? (
              <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/10 px-3 py-2 text-[11px] text-yellow-200">
                Showing cached position history. Latest refresh failed: {historyError}
              </div>
            ) : null}
            {activeTab === "positionHistory" && historyPositionsNotice ? (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/8 px-3 py-2 text-[11px] text-yellow-200/90">
                {historyPositionsNotice}
              </div>
            ) : null}
            <table className={PANEL_TABLE_CLASS} style={PANEL_TABLE_STYLE}>
            <thead className="sticky top-0 z-10 bg-shadow-900">
              <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-1.5 text-left font-medium">Pair</th>
                <th className="px-2 py-1.5 text-left font-medium">Side</th>
                <th className="px-2 py-1.5 text-left font-medium">Type</th>
                <th className="px-2 py-1.5 text-right font-medium">Entry</th>
                <th className="px-2 py-1.5 text-right font-medium">Liq. Price</th>
                <th className="px-2 py-1.5 text-right font-medium">Margin</th>
                <th className="px-2 py-1.5 text-right font-medium">PnL</th>
                {activeTab === "positions" && <th className="px-2 py-1.5 text-right font-medium">TP / SL</th>}
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
                const displaySide = card.side ?? rule?.side ?? "long";
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
                const statusDetail = getStatusDetail(pos.status, isClosing);
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

                const canSelectPair = activeTab === "positions" && !!onPairSelect;

                return (
                  <tr
                    key={pos.address}
                    onClick={() => {
                      if (canSelectPair) onPairSelect?.(card.pairLabel);
                    }}
                    className={`position-row group ${canSelectPair ? "cursor-pointer" : ""}`}
                    title={canSelectPair ? `Switch market to ${card.pairLabel}` : undefined}
                  >
                    {/* Pair */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="font-medium text-white">{card.pairLabel}</div>
                      {activeTab === "positionHistory" && (
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
                    {activeTab === "positions" && (
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {rule?.takeProfit ? (
                            <span className="rounded border border-accent-green/20 bg-accent-green/10 px-1.5 py-0.5 text-[9px] font-medium text-accent-green">
                              TP {formatPrice(rule.takeProfit)}
                            </span>
                          ) : null}
                          {rule?.stopLoss ? (
                            <span className="rounded border border-accent-red/20 bg-accent-red/10 px-1.5 py-0.5 text-[9px] font-medium text-accent-red">
                              SL {formatPrice(rule.stopLoss)}
                            </span>
                          ) : null}
                          <button onClick={(event) => {
                            event.stopPropagation();
                            openTpSlModal(pos);
                          }}
                            className="rounded bg-cyan-500/15 px-2 py-0.5 text-[9px] font-medium text-cyan-300 hover:bg-cyan-500/25">
                            TP/SL
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
                      {activeTab === "positionHistory" ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <StatusBadge status={pos.status} isClosing={isClosing} />
                          <span className="text-[10px] text-gray-500">{historyTimeLabel}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex min-h-[22px] items-center justify-end gap-1.5">
                            {pos.status !== "open" && !isClosing ? (
                              <StatusBadge status={pos.status} isClosing={isClosing} />
                            ) : null}
                            {!isPending && !isFinal ? (
                            <button onClick={(event) => {
                              event.stopPropagation();
                              void handleClose(pos);
                            }} disabled={TRADING_DISABLED || isClosing}
                              className="rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-40">
                              {TRADING_DISABLED ? "Off" : isClosing ? "Closing..." : "Close"}
                            </button>
                            ) : null}
                          </div>
                          <span className={`min-h-[14px] text-[10px] text-gray-500 ${statusDetail ? "" : "invisible"}`}>
                            {statusDetail ?? "Ready"}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>
          </div>
        )}
      </div>
      </div>

      <OrderConfirmModal
        isOpen={tpSlModalPosition !== null && tpSlModalCard !== null}
        title="TP/SL Settings"
        description="Set full-position trigger rules by price, ROI, or entry-price percentage."
        confirmLabel="Save TP/SL"
        details={tpSlModalPosition && tpSlModalCard ? [
          { label: "Pair", value: tpSlModalCard.pairLabel },
          { label: "Side", value: (tpSlModalCard.side ?? "long").toUpperCase() },
          { label: "Entry", value: formatPrice(tpSlModalCard.entryPrice) },
          { label: "Take profit trigger", value: formatPrice(tpPreview) },
          { label: "Stop loss trigger", value: formatPrice(slPreview) },
        ] : []}
        onConfirm={() => {
          if (tpSlModalPosition && tpSlModalCard) {
            saveTpSlRule(tpSlModalPosition.address, tpSlModalCard);
          }
        }}
        onCancel={() => setTpSlModalAddress(null)}
      >
        <div className="mb-3 space-y-3 rounded-xl border border-shadow-600 bg-shadow-900/60 p-3">
          <TpSlEditor
            label="Take Profit"
            tone="tp"
            mode={tpSlDraft.takeProfitMode}
            value={tpSlDraft.takeProfitValue}
            preview={tpPreview}
            onModeChange={(mode) =>
              setTpSlDraft((current) => ({ ...current, takeProfitMode: mode, takeProfitValue: "" }))
            }
            onValueChange={(value) =>
              setTpSlDraft((current) => ({ ...current, takeProfitValue: value }))
            }
          />
          <TpSlEditor
            label="Stop Loss"
            tone="sl"
            mode={tpSlDraft.stopLossMode}
            value={tpSlDraft.stopLossValue}
            preview={slPreview}
            onModeChange={(mode) =>
              setTpSlDraft((current) => ({ ...current, stopLossMode: mode, stopLossValue: "" }))
            }
            onValueChange={(value) =>
              setTpSlDraft((current) => ({ ...current, stopLossValue: value }))
            }
          />
          {tpSlModalPosition ? (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => clearTpSlRule(tpSlModalPosition.address)}
                disabled={!tpSlModalRule}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-35"
              >
                Delete TP/SL
              </button>
            </div>
          ) : null}
        </div>
      </OrderConfirmModal>

      <OrderConfirmModal
        isOpen={closeConfirmPos !== null}
        title="Close Position"
        description="This will send the close through Arcium MPC and finish settlement on-chain."
        confirmLabel="Close Position"
        details={closeConfirmPos ? [
          { label: "Opened", value: closeConfirmPos.openedAt.toLocaleDateString() },
          { label: "Position", value: closeConfirmPos.address.slice(0, 8) + "..." },
        ] : []}
        onConfirm={() => {
          if (closeConfirmPos) void executeClose(closeConfirmPos);
          setCloseConfirmPos(null);
        }}
        onCancel={() => setCloseConfirmPos(null)}
      />
      <CollateralModal
        isOpen={collateralModalOpen}
        initialTab={collateralModalTab}
        marginBalance={accountTotal}
        freeCollateral={freeCollateral}
        lockedCollateral={lockedCollateral}
        onClose={() => setCollateralModalOpen(false)}
        onBalanceChange={() => setBalancesRefreshTick((tick) => tick + 1)}
        onSuccess={() => {
          setCollateralModalOpen(false);
          setActiveTab("balances");
        }}
      />
    </div>
  );
}
