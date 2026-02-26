import { useState, useCallback, useEffect, useRef } from "react";
import BN from "bn.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import toast from "react-hot-toast";
import { createShadowPerpClient } from "../lib/create-client";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";
import { fetchPrices, getLastPriceMeta } from "../lib/prices";
import TradeConfirmationModal, { TradeStep } from "./TradeConfirmationModal";
import CollateralModal from "./CollateralModal";
import {
  RELAY_SESSION_RENEW_BEFORE_SECONDS,
  useArciumPrivacy,
} from "../hooks/useArcium";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";
import {
  disableEncryptedAutomationPersistence,
  enableEncryptedAutomationPersistence,
  createLimitOrderId,
  getLimitOrders,
  setOwnerPositionView,
  setPositionRule,
  updateLimitOrder,
  upsertLimitOrder,
} from "../lib/trade-automation";

type Direction = "long" | "short";
type SizeUnit = "base" | "usd";
type OrderType = "market" | "limit";
type MarginMode = "cross" | "isolated";

const LEVERAGE_MARKERS = [1, 5, 10, 25, 50] as const;
const MIN_LEVERAGE = LEVERAGE_MARKERS[0];
const MAX_LEVERAGE = LEVERAGE_MARKERS[LEVERAGE_MARKERS.length - 1];
const TP_SL_MIN_GAP_BPS = 10; // 0.10%
const MAX_POSITION_SIZE_BASE = 1_000_000;
const MAX_POSITION_NOTIONAL_USDC = 5_000_000;

interface TradingPanelProps {
  pair?: TradingPair;
  layout?: "vertical" | "horizontal";
}

function parseOptionalPositive(value: string): number | null {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return value < 0.01 ? `$${value.toFixed(8)}` : `$${value.toFixed(2)}`;
}

function hasAllowedPrecision(value: string, maxDecimals: number): boolean {
  const normalized = value.trim();
  if (!normalized.includes(".")) return true;
  const [, decimals = ""] = normalized.split(".");
  return decimals.length <= maxDecimals;
}

function validateTpSl(
  side: Direction,
  entryPrice: number,
  takeProfit: number | null,
  stopLoss: number | null
): string | null {
  if (takeProfit === null && stopLoss === null) return null;

  if (side === "long") {
    if (takeProfit !== null && takeProfit <= entryPrice) {
      return "For long orders, take-profit must be above entry.";
    }
    if (stopLoss !== null && stopLoss >= entryPrice) {
      return "For long orders, stop-loss must be below entry.";
    }
  } else {
    if (takeProfit !== null && takeProfit >= entryPrice) {
      return "For short orders, take-profit must be below entry.";
    }
    if (stopLoss !== null && stopLoss <= entryPrice) {
      return "For short orders, stop-loss must be above entry.";
    }
  }

  if (takeProfit !== null && stopLoss !== null && takeProfit === stopLoss) {
    return "TP and SL cannot be identical.";
  }

  const minGap = TP_SL_MIN_GAP_BPS / 10_000;
  const minGapPct = (TP_SL_MIN_GAP_BPS / 100).toFixed(2);
  if (takeProfit !== null) {
    const tpGap = Math.abs(takeProfit - entryPrice) / entryPrice;
    if (tpGap < minGap) {
      return `Take-profit must be at least ${minGapPct}% away from entry.`;
    }
  }
  if (stopLoss !== null) {
    const slGap = Math.abs(stopLoss - entryPrice) / entryPrice;
    if (slGap < minGap) {
      return `Stop-loss must be at least ${minGapPct}% away from entry.`;
    }
  }

  return null;
}

export default function TradingPanel({ pair, layout = "vertical" }: TradingPanelProps) {
  const activePair = pair ?? TRADING_PAIRS[0];
  const isHorizontal = layout === "horizontal";
  const { publicKey, signMessage } = useWallet();
  const anchorWallet = useAnchorWalletCompat();
  const { connection } = useConnection();
  const [direction, setDirection] = useState<Direction>("long");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [marginMode, setMarginMode] = useState<MarginMode>("cross");
  const [size, setSize] = useState("");
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>("base");
  const [limitPrice, setLimitPrice] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [leverage, setLeverage] = useState(10);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [marketPrice, setMarketPrice] = useState<number | null>(null);
  const [marginBalance, setMarginBalance] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [collateralModalOpen, setCollateralModalOpen] = useState(false);
  const [liqThreshold, setLiqThreshold] = useState(80);
  const [tradeStep, setTradeStep] = useState<TradeStep>("signing");
  const [tradeTxSig, setTradeTxSig] = useState<string | undefined>();
  const [tradeError, setTradeError] = useState<string | undefined>();
  const [clientInitError, setClientInitError] = useState<string | null>(null);
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);
  const refreshSeqRef = useRef(0);
  const handleSubmitRef = useRef<() => void>(() => undefined);
  const limitExecutorRunningRef = useRef(false);
  const processingOrderIdsRef = useRef<Set<string>>(new Set());
  const {
    submitPrivateOrder,
    setError: setPrivacyError,
    resetStatus: resetPrivacyStatus,
    relayAvailable,
    relaySession,
    refreshRelaySession,
    ensureRelaySession,
    invalidateRelaySession,
  } = useArciumPrivacy();

  const isRelaySessionActive =
    !!relaySession &&
    relaySession.owner === publicKey?.toBase58() &&
    relaySession.usedActions < relaySession.maxActions &&
    relaySession.expiresAt - Math.floor(Date.now() / 1000) >
      RELAY_SESSION_RENEW_BEFORE_SECONDS;

  const parsedLimitPrice = parseOptionalPositive(limitPrice);
  const entryPrice = orderType === "limit" ? parsedLimitPrice ?? marketPrice : marketPrice;

  const sizeInBase =
    size && entryPrice
      ? sizeUnit === "usd"
        ? parseFloat(size) / entryPrice
        : parseFloat(size)
      : 0;

  const positionValue = sizeInBase && entryPrice ? sizeInBase * entryPrice : 0;
  const margin = positionValue > 0 ? positionValue / leverage : 0;
  const activeMarginBalance = marginBalance ?? 0;
  const unrealizedPnl = 0;
  const accountEquity = Math.max(0, activeMarginBalance + unrealizedPnl);
  const maintenanceMargin = positionValue * 0.05;
  const riskEquity =
    marginMode === "cross"
      ? accountEquity
      : margin > 0
      ? margin
      : 0;
  const marginRatio = maintenanceMargin > 0 ? (riskEquity / maintenanceMargin) * 100 : 0;
  const accountLeverage = riskEquity > 0 ? positionValue / riskEquity : 0;

  const estimatedLiqPrice =
    entryPrice && sizeInBase > 0
      ? direction === "long"
        ? entryPrice * (1 - (1 - liqThreshold / 100) / leverage)
        : entryPrice * (1 + (1 - liqThreshold / 100) / leverage)
      : null;

  const getClient = useCallback(() => {
    if (!anchorWallet) return null;
    if (!clientRef.current) {
      try {
        clientRef.current = createShadowPerpClient(connection, anchorWallet);
        setClientInitError(null);
      } catch (error: any) {
        const reason =
          typeof error?.message === "string" && error.message.trim().length > 0
            ? error.message
            : "Unknown client initialization error";
        setClientInitError(`Client init failed: ${reason}`);
        return null;
      }
    }
    return clientRef.current;
  }, [anchorWallet, connection]);

  useEffect(() => {
    clientRef.current = null;
    refreshSeqRef.current += 1;
  }, [anchorWallet, publicKey]);

  useEffect(() => {
    setSize("");
    setLimitPrice("");
    setTakeProfit("");
    setStopLoss("");
  }, [activePair.label, sizeUnit]);

  useEffect(() => {
    if (!publicKey || !signMessage) {
      disableEncryptedAutomationPersistence();
    }
  }, [publicKey, signMessage]);

  const ensureAutomationPersistenceUnlocked = useCallback(async () => {
    const owner = publicKey?.toBase58();
    if (!owner || !signMessage) return;
    try {
      await enableEncryptedAutomationPersistence({
        owner,
        signMessage,
      });
    } catch (error: any) {
      disableEncryptedAutomationPersistence();
      const message =
        typeof error?.message === "string" && error.message.trim().length > 0
          ? error.message
          : "Encrypted persistence unlock failed. Keeping automation in memory only.";
      toast.error(message, { id: "automation-persistence" });
    }
  }, [publicKey, signMessage]);

  const refreshMarketData = useCallback(async () => {
    const requestSeq = ++refreshSeqRef.current;
    const fallbackWarning = "Live price feed unavailable. Showing cached market data.";
    const setWarning = (message: string | null) => {
      // Price-source warnings are intentionally hidden in the UI.
      // Keep this hook as a placeholder for internal logging/debug channels.
      void requestSeq;
      void message;
    };

    const livePrices = await fetchPrices().catch(() => null);
    const livePairPrice = livePrices?.[activePair.label]?.price ?? null;
    const fallbackPrice = livePairPrice ?? activePair.mockPrice;
    const priceMeta = getLastPriceMeta();
    const hasLivePrice = priceMeta.quality === "live";

    if (!anchorWallet) {
      if (requestSeq !== refreshSeqRef.current) return;
      setMarketPrice(fallbackPrice);
      setMarginBalance(null);
      setWarning(hasLivePrice ? null : fallbackWarning);
      return;
    }

    const ctx = getClient();
    if (!ctx) {
      if (requestSeq !== refreshSeqRef.current) return;
      setMarketPrice(fallbackPrice);
      setMarginBalance(null);
      setWarning(hasLivePrice ? null : fallbackWarning);
      return;
    }

    try {
      const { client, runtime } = ctx;
      const [marketResult, marginResult] = await Promise.allSettled([
        client.getMarket(runtime.marketAddress),
        publicKey
          ? client.getMarginAccount(
              client.getMarginAccountAddress(runtime.marketAddress, publicKey)
            )
          : Promise.reject("no wallet"),
      ]);

      if (requestSeq !== refreshSeqRef.current) return;

      let usedFallbackPrice = livePairPrice === null;
      if (marketResult.status === "fulfilled") {
        const oraclePrice =
          new BN(marketResult.value.oraclePrice.toString()).toNumber() / 1_000_000;
        if (Number.isFinite(oraclePrice) && oraclePrice > 0) {
          setMarketPrice(oraclePrice);
          usedFallbackPrice = false;
        } else {
          setMarketPrice(fallbackPrice);
        }
        const thresh = marketResult.value.liquidationThreshold;
        if (thresh != null) {
          setLiqThreshold(Number(thresh) / 100);
        }
      } else {
        setMarketPrice(fallbackPrice);
      }

      if (marginResult.status === "fulfilled") {
        const bal =
          new BN(marginResult.value.balance.toString()).toNumber() / 1_000_000;
        setMarginBalance(bal);
      } else {
        setMarginBalance(0);
      }

      setWarning(usedFallbackPrice && !hasLivePrice ? fallbackWarning : null);
    } catch {
      if (requestSeq !== refreshSeqRef.current) return;
      setMarketPrice(fallbackPrice);
      setWarning(hasLivePrice ? null : fallbackWarning);
    }
  }, [anchorWallet, publicKey, getClient, activePair]);

  useEffect(() => {
    void refreshMarketData();
    const interval = setInterval(() => void refreshMarketData(), 15_000);
    return () => clearInterval(interval);
  }, [refreshMarketData]);

  useEffect(() => {
    if (!publicKey) return;
    void refreshRelaySession();
    const interval = setInterval(() => void refreshRelaySession(), 30_000);
    return () => clearInterval(interval);
  }, [publicKey, refreshRelaySession]);

  const submitEncryptedOrder = useCallback(
    async (input: {
      side: Direction;
      sizeBase: number;
      leverage: number;
      entryPrice: number;
      pairLabel: string;
      takeProfit: number | null;
      stopLoss: number | null;
    }) => {
      const { txSignature, positionAddress } = await submitPrivateOrder(
        {
          side: input.side,
          sizeUi: input.sizeBase,
          leverage: input.leverage,
          entryPriceUi: input.entryPrice,
        },
        true
      );

      if (input.takeProfit !== null || input.stopLoss !== null) {
        setPositionRule({
          positionAddress,
          pairLabel: input.pairLabel,
          side: input.side,
          takeProfit: input.takeProfit,
          stopLoss: input.stopLoss,
          updatedAt: Date.now(),
        });
      }

      setOwnerPositionView({
        positionAddress,
        pairLabel: input.pairLabel,
        side: input.side,
        sizeBase: input.sizeBase,
        entryPrice: input.entryPrice,
        leverage: input.leverage,
      });

      return { txSignature, positionAddress };
    },
    [submitPrivateOrder]
  );

  const handleSubmit = useCallback(async () => {
    const trimmedSize = size.trim();
    const parsedSize = parseFloat(trimmedSize);
    if (
      !trimmedSize ||
      !Number.isFinite(parsedSize) ||
      parsedSize <= 0 ||
      !Number.isFinite(sizeInBase) ||
      sizeInBase <= 0
    ) {
      toast.error("Please enter a valid size");
      return;
    }
    const sizeDecimals = sizeUnit === "base" ? activePair.base.decimals : activePair.quote.decimals;
    if (!hasAllowedPrecision(trimmedSize, sizeDecimals)) {
      toast.error(`Size supports up to ${sizeDecimals} decimals in ${sizeUnit.toUpperCase()} mode`);
      return;
    }
    if (!Number.isFinite(positionValue) || positionValue <= 0) {
      toast.error("Invalid position value");
      return;
    }
    if (sizeInBase > MAX_POSITION_SIZE_BASE) {
      toast.error(`Position size exceeds max ${MAX_POSITION_SIZE_BASE.toLocaleString()} ${activePair.base.symbol}`);
      return;
    }
    if (positionValue > MAX_POSITION_NOTIONAL_USDC) {
      toast.error(`Position value exceeds max $${MAX_POSITION_NOTIONAL_USDC.toLocaleString()} USDC`);
      return;
    }
    if (!Number.isInteger(leverage) || leverage < 1 || leverage > 50) {
      toast.error("Invalid leverage selected");
      return;
    }
    if (!publicKey) { toast.error("Please connect your wallet"); return; }
    if (!anchorWallet) { toast.error("Wallet does not support signing transactions"); return; }
    if (marginBalance !== null) {
      if (marginBalance <= 0) {
        toast.error("Deposit collateral first before opening a position");
        return;
      }
      if (!Number.isFinite(margin) || margin <= 0 || margin > marginBalance) {
        toast.error("Insufficient margin balance for this order size");
        return;
      }
    }

    if (!entryPrice || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      toast.error(orderType === "limit" ? "Please enter a valid limit price" : "Price unavailable");
      return;
    }

    const tp = parseOptionalPositive(takeProfit);
    const sl = parseOptionalPositive(stopLoss);
    const validationError = validateTpSl(direction, entryPrice, tp, sl);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (orderType === "limit") {
      await ensureAutomationPersistenceUnlocked();
      const orderId = createLimitOrderId();
      upsertLimitOrder({
        id: orderId,
        pairLabel: activePair.label,
        side: direction,
        sizeBase: sizeInBase,
        leverage,
        limitPrice: entryPrice,
        takeProfit: tp,
        stopLoss: sl,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "pending",
      });
      const queued = getLimitOrders().some((order) => order.id === orderId);
      if (!queued) {
        toast.error("Failed to queue limit order. Please retry.");
        return;
      }
      setSize("");
      setLimitPrice("");
      setTakeProfit("");
      setStopLoss("");
      toast.success(`Limit order queued at ${formatPrice(entryPrice)}`);
      return;
    }

    setIsSubmitting(true);
    setTradeStep("signing");
    setTradeTxSig(undefined);
    setTradeError(undefined);
    resetPrivacyStatus();
    setModalOpen(true);

    try {
      const ctx = getClient();
      if (!ctx) {
        setModalOpen(false);
        toast.error(clientInitError || "Trading client unavailable. Check runtime config.", { id: "trade" });
        return;
      }

      setTradeStep("encrypting");
      await new Promise((r) => setTimeout(r, 800));
      setTradeStep("submitting");

      const { txSignature } = await submitEncryptedOrder({
        side: direction,
        sizeBase: sizeInBase,
        leverage,
        entryPrice,
        pairLabel: activePair.label,
        takeProfit: tp,
        stopLoss: sl,
      });

      setTradeTxSig(txSignature);
      setTradeStep("confirmed");
      setSize("");
      setTakeProfit("");
      setStopLoss("");
      void refreshMarketData();
    } catch (error: any) {
      const msg = error?.message || "Failed to open position";
      setPrivacyError(msg);
      if (msg.includes("env var")) {
        setModalOpen(false);
      } else {
        setTradeError(msg);
        setTradeStep("error");
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    size,
    sizeInBase,
    sizeUnit,
    direction,
    orderType,
    leverage,
    publicKey,
    anchorWallet,
    getClient,
    clientInitError,
    entryPrice,
    activePair.label,
    activePair.base.decimals,
    activePair.base.symbol,
    activePair.quote.decimals,
    marginBalance,
    margin,
    isRelaySessionActive,
    positionValue,
    takeProfit,
    stopLoss,
    refreshMarketData,
    submitEncryptedOrder,
    ensureAutomationPersistenceUnlocked,
    setPrivacyError,
    resetPrivacyStatus,
  ]);

  useEffect(() => {
    handleSubmitRef.current = () => {
      void handleSubmit();
    };
  }, [handleSubmit]);

  // Keyboard shortcuts - MUST be after handleSubmit to avoid TDZ error
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "l" || e.key === "L") setDirection("long");
      if (e.key === "s" || e.key === "S") setDirection("short");
      if (e.key === "Escape" && modalOpen) setModalOpen(false);
      if (e.key === "Enter" && !isSubmitting && size && sizeInBase > 0)
        handleSubmitRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, isSubmitting, size, sizeInBase]);

  const runLimitExecutor = useCallback(async () => {
    if (!publicKey || !anchorWallet) return;
    if (!isRelaySessionActive) return;
    if (limitExecutorRunningRef.current) return;
    limitExecutorRunningRef.current = true;

    try {
      const orders = getLimitOrders().filter((o) => o.status === "pending");
      if (!orders.length) return;
      const prices = await fetchPrices().catch(() => null);

      for (const order of orders) {
        if (processingOrderIdsRef.current.has(order.id)) continue;

        const currentPrice =
          prices?.[order.pairLabel]?.price ??
          (order.pairLabel === activePair.label ? marketPrice : null);
        if (!currentPrice) continue;

        const shouldTrigger =
          order.side === "long"
            ? currentPrice <= order.limitPrice
            : currentPrice >= order.limitPrice;
        if (!shouldTrigger) continue;

        processingOrderIdsRef.current.add(order.id);
        updateLimitOrder(order.id, { status: "triggered", error: undefined });

        try {
          const { txSignature, positionAddress } = await submitEncryptedOrder({
            side: order.side,
            sizeBase: order.sizeBase,
            leverage: order.leverage,
            entryPrice: order.limitPrice,
            pairLabel: order.pairLabel,
            takeProfit: order.takeProfit,
            stopLoss: order.stopLoss,
          });
          updateLimitOrder(order.id, {
            status: "filled",
            txSignature,
            positionAddress,
            error: undefined,
          });
          toast.success(`${order.pairLabel} ${order.side} limit filled`);
          void refreshMarketData();
        } catch (error: any) {
          const msg = error?.message || "Limit execution failed";
          updateLimitOrder(order.id, { status: "failed", error: msg });
          if (!msg.includes("env var")) toast.error(msg);
        } finally {
          processingOrderIdsRef.current.delete(order.id);
        }
      }
    } finally {
      limitExecutorRunningRef.current = false;
    }
  }, [activePair.label, anchorWallet, isRelaySessionActive, marketPrice, publicKey, refreshMarketData, submitEncryptedOrder]);

  useEffect(() => {
    const id = setInterval(() => void runLimitExecutor(), 4_000);
    return () => clearInterval(id);
  }, [runLimitExecutor]);

  return (
    <div className="trade-trading-panel flex flex-col bg-shadow-900 p-2.5 h-full overflow-y-auto">
      <div className={isHorizontal ? "grid grid-cols-1 items-start gap-2 lg:grid-cols-12" : "space-y-1.5"}>
        <div className={isHorizontal ? "space-y-1.5 lg:col-span-12" : "space-y-1.5"}>
          {/* Market / Limit — underlined text tabs */}
          <div className="flex items-center gap-3 border-b border-shadow-600 pb-0">
            <button
              onClick={() => setOrderType("market")}
              className={`pb-1 text-[11px] font-semibold transition-colors border-b-2 -mb-px ${
                orderType === "market"
                  ? "text-white border-accent-purple"
                  : "text-gray-500 border-transparent hover:text-gray-300"
              }`}
            >
              Market
            </button>
            <button
              onClick={() => setOrderType("limit")}
              className={`pb-1 text-[11px] font-semibold transition-colors border-b-2 -mb-px ${
                orderType === "limit"
                  ? "text-white border-accent-purple"
                  : "text-gray-500 border-transparent hover:text-gray-300"
              }`}
            >
              Limit
            </button>
          </div>

          {/* Long / Short — direction buttons */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => setDirection("long")}
              className={`rounded-lg py-1.5 text-xs font-bold transition-all btn-press ${
                direction === "long"
                  ? "bg-accent-green text-white"
                  : "bg-accent-green/10 text-accent-green border border-accent-green/25 hover:bg-accent-green/20"
              }`}
            >
              Long
            </button>
            <button
              onClick={() => setDirection("short")}
              className={`rounded-lg py-1.5 text-xs font-bold transition-all btn-press ${
                direction === "short"
                  ? "bg-accent-red text-white"
                  : "bg-accent-red/8 text-accent-red border border-accent-red/25 hover:bg-accent-red/15"
              }`}
            >
              Short
            </button>
          </div>


          {/* Hotkeys */}
          <div className="flex justify-between px-0.5 text-[9px] text-gray-600">
            <span>
              Hotkey:{" "}
              <kbd className="rounded bg-shadow-600 px-1 py-0.5 text-gray-500">L</kbd> Long
            </span>
            <span>
              <kbd className="rounded bg-shadow-600 px-1 py-0.5 text-gray-500">S</kbd> Short
              {" | "}
              <kbd className="rounded bg-shadow-600 px-1 py-0.5 text-gray-500">Enter</kbd> Submit
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            <button
              type="button"
              onClick={() => setMarginMode("cross")}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                marginMode === "cross"
                  ? "border-accent-purple/50 bg-accent-purple/10"
                  : "border-shadow-500 bg-shadow-700/50 hover:border-accent-purple/35"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-sm border ${
                    marginMode === "cross"
                      ? "border-accent-purple bg-accent-purple/20 text-accent-purple"
                      : "border-shadow-500 text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="text-sm font-semibold text-white">Cross</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                All positions share account collateral.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setMarginMode("isolated")}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                marginMode === "isolated"
                  ? "border-accent-purple/50 bg-accent-purple/10"
                  : "border-shadow-500 bg-shadow-700/50 hover:border-accent-purple/35"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-sm border ${
                    marginMode === "isolated"
                      ? "border-accent-purple bg-accent-purple/20 text-accent-purple"
                      : "border-shadow-500 text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="text-sm font-semibold text-white">Isolated</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Margin is scoped to this position sizing flow.
              </p>
            </button>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Size</label>
              <div className="flex overflow-hidden rounded-md border border-shadow-500 text-[10px]">
                <button
                  onClick={() => setSizeUnit("base")}
                  className={`px-2 py-0.5 transition-colors ${
                    sizeUnit === "base"
                      ? "bg-accent-purple/35 text-white"
                      : "bg-shadow-700 text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {activePair.base.symbol}
                </button>
                <button
                  onClick={() => setSizeUnit("usd")}
                  className={`px-2 py-0.5 transition-colors ${
                    sizeUnit === "usd"
                      ? "bg-accent-purple/35 text-white"
                      : "bg-shadow-700 text-gray-400 hover:text-gray-200"
                  }`}
                >
                  USD
                </button>
              </div>
            </div>
            <div className="relative">
              <input
                type="number"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-shadow-500 bg-shadow-700 px-3 py-2 text-xl leading-none text-white transition-colors focus:border-accent-purple focus:outline-none pr-14"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                {sizeUnit === "usd" ? "USDC" : activePair.base.symbol}
              </span>
            </div>
            <div className="mt-1.5">
              {(() => {
                const maxNotional = marginBalance && marginBalance > 0 ? marginBalance * leverage : null;
                const currentNotional = sizeUnit === "usd"
                  ? parseFloat(size) || 0
                  : ((parseFloat(size) || 0) * (marketPrice ?? 0));
                const sliderPct = maxNotional && maxNotional > 0
                  ? Math.min(100, Math.round((currentNotional / maxNotional) * 100))
                  : 0;
                const handleSlider = (pct: number) => {
                  if (!maxNotional) return;
                  const notional = (pct / 100) * maxNotional;
                  if (sizeUnit === "usd") {
                    setSize(notional.toFixed(2));
                  } else {
                    const price = marketPrice ?? 0;
                    if (price > 0) setSize((notional / price).toFixed(4));
                  }
                };
                return (
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-end mb-1">
                      <span className="text-[9px] font-semibold text-accent-purple">{sliderPct}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={sliderPct}
                      onChange={(e) => handleSlider(Number(e.target.value))}
                      className="h-1 w-full cursor-pointer appearance-none rounded-full accent-accent-purple"
                      style={{
                        background: `linear-gradient(to right, #8b5cf6 ${sliderPct}%, var(--range-track-empty) ${sliderPct}%)`,
                      }}
                    />
                    <div className="flex justify-between text-[9px] text-gray-600">
                      {[0, 25, 50, 75, 100].map((tick) => (
                        <button
                          key={tick}
                          onClick={() => handleSlider(tick)}
                          className="hover:text-accent-purple transition-colors"
                        >
                          {tick}%
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {orderType === "limit" && (
            <div className="mt-2 mb-2">
              <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-gray-500">
                Limit Price
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-shadow-500 bg-shadow-700 px-3 py-2 text-lg text-white transition-colors focus:border-accent-purple focus:outline-none pr-14"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                  USDC
                </span>
              </div>
            </div>
          )}

          <div>
            <div className="rounded-xl border border-shadow-500 bg-shadow-700/70 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Leverage</span>
                <span className="text-xl font-semibold text-accent-purple">{leverage}x</span>
              </div>
              <input
                type="range"
                min={MIN_LEVERAGE}
                max={MAX_LEVERAGE}
                value={leverage}
                onChange={(e) => setLeverage(Number.parseInt(e.target.value, 10))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg accent-accent-purple"
                style={{
                  background: `linear-gradient(to right, #8b5cf6 ${((leverage - MIN_LEVERAGE) / (MAX_LEVERAGE - MIN_LEVERAGE)) * 100}%, var(--range-track-empty) ${((leverage - MIN_LEVERAGE) / (MAX_LEVERAGE - MIN_LEVERAGE)) * 100}%)`,
                }}
              />
              <div className="mt-1.5 flex justify-between text-[9px] text-gray-600">
                {LEVERAGE_MARKERS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setLeverage(m)}
                    className="hover:text-accent-purple transition-colors"
                  >
                    {m}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-gray-500">
              Take Profit / Stop Loss
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="relative">
                <input
                  type="number"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-shadow-500 bg-shadow-700 px-3 py-1.5 pr-10 text-xs text-white transition-colors focus:border-accent-green focus:outline-none"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent-green">
                  TP
                </span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-shadow-500 bg-shadow-700 px-3 py-1.5 pr-10 text-xs text-white transition-colors focus:border-accent-red focus:outline-none"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent-red">
                  SL
                </span>
              </div>
            </div>
          </div>

<div className="flex items-stretch divide-x divide-shadow-600 rounded-xl border border-shadow-500 bg-shadow-700/40 overflow-hidden">
            <div className="flex-1 px-3 py-2">
              <p className="text-[9px] uppercase tracking-[0.12em] text-gray-500 mb-0.5">Margin</p>
              <p className="text-sm font-semibold text-gray-200">${margin.toFixed(2)}</p>
            </div>
            <div className="flex-1 px-3 py-2">
              <p className="text-[9px] uppercase tracking-[0.12em] text-gray-500 mb-0.5">Notional</p>
              <p className="text-sm font-semibold text-gray-200">${positionValue.toFixed(2)}</p>
            </div>
            <div className="flex-1 px-3 py-2">
              <p className="text-[9px] uppercase tracking-[0.12em] text-gray-500 mb-0.5">Liq. Price</p>
              <p className={`text-sm font-semibold ${estimatedLiqPrice ? (direction === "long" ? "text-accent-red" : "text-accent-green") : "text-gray-500"}`}>
                {estimatedLiqPrice ? formatPrice(estimatedLiqPrice) : "--"}
              </p>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              !size ||
              sizeInBase <= 0 ||
              (orderType === "limit" && !parsedLimitPrice)
            }
            className={`mb-1 w-full rounded-lg py-2.5 text-base font-semibold transition-all btn-press ${
              direction === "long"
                ? "bg-gradient-to-r from-accent-green to-emerald-600 hover:from-emerald-600 hover:to-accent-green"
                : "bg-gradient-to-r from-accent-red to-rose-600 hover:from-rose-600 hover:to-accent-red"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Processing via MPC...
              </span>
            ) : !isRelaySessionActive ? (
              `Sign Session & ${orderType === "limit"
                ? `Place Limit ${direction.charAt(0).toUpperCase() + direction.slice(1)}`
                : `Open ${direction.charAt(0).toUpperCase() + direction.slice(1)} Position`}`
            ) : orderType === "limit" ? (
              `Place Limit ${direction.charAt(0).toUpperCase() + direction.slice(1)}`
            ) : (
              `Open ${direction.charAt(0).toUpperCase() + direction.slice(1)} Position`
            )}
          </button>

          <div className="rounded-xl border border-shadow-500 bg-shadow-700/35 p-2.5 space-y-2">
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Liquidation Price</span>
                <span className="font-semibold text-white">
                  {estimatedLiqPrice ? formatPrice(estimatedLiqPrice) : "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Order Value</span>
                <span className="font-semibold text-white">
                  {positionValue > 0 ? `$${positionValue.toFixed(2)}` : "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Margin Required</span>
                <span className="font-semibold text-white">
                  {margin > 0 ? `$${margin.toFixed(2)}` : "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Margin Mode</span>
                <span className="font-semibold text-white capitalize">{marginMode}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Slippage</span>
                <span className="font-semibold text-teal-300">Est: 0% / Max: 8.00%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Fees</span>
                <span className="font-semibold text-white">0.0450% / 0.0150%</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setCollateralModalOpen(true)}
              className="w-full rounded-lg bg-accent-green/30 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-green/40"
            >
              Deposit
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="rounded-lg border border-shadow-500 py-2 text-sm font-medium text-gray-300/80"
                title="Perps and spot balances are separated in this build."
              >
                Perps {"<->"} Spot
              </button>
              <button
                type="button"
                onClick={() => setCollateralModalOpen(true)}
                className="rounded-lg border border-shadow-500 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-accent-purple"
              >
                Withdraw
              </button>
            </div>

            <div className="border-t border-shadow-600 pt-2">
              <h4 className="mb-1 text-sm font-semibold text-white">Account Equity</h4>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Spot</span>
                  <span className="font-semibold text-white">$0.00</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Perps</span>
                  <span className="font-semibold text-white">${activeMarginBalance.toFixed(2)}</span>
                </div>
              </div>

              <h5 className="mt-2 mb-1 text-sm font-semibold text-white">Perps Overview</h5>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Balance</span>
                  <span className="font-semibold text-white">${activeMarginBalance.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Unrealized PNL</span>
                  <span className="font-semibold text-white">${unrealizedPnl.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">
                    {marginMode === "cross" ? "Cross Margin Ratio" : "Isolated Margin Ratio"}
                  </span>
                  <span className="font-semibold text-teal-300">{marginRatio.toFixed(2)}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Maintenance Margin</span>
                  <span className="font-semibold text-white">${maintenanceMargin.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">
                    {marginMode === "cross" ? "Cross Account Leverage" : "Isolated Leverage"}
                  </span>
                  <span className="font-semibold text-white">{accountLeverage.toFixed(2)}x</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <TradeConfirmationModal
        isOpen={modalOpen}
        step={tradeStep}
        direction={direction}
        size={size || "0"}
        leverage={leverage}
        entryPrice={entryPrice ?? activePair.mockPrice}
        errorMessage={tradeError}
        txSignature={tradeTxSig}
        onClose={() => setModalOpen(false)}
      />

      <CollateralModal
        isOpen={collateralModalOpen}
        marginBalance={marginBalance}
        onClose={() => setCollateralModalOpen(false)}
        onSuccess={() => void refreshMarketData()}
        relayAvailable={relayAvailable}
        relaySession={relaySession}
        isRelaySessionActive={isRelaySessionActive}
        ensureRelaySession={ensureRelaySession}
        invalidateRelaySession={invalidateRelaySession}
        refreshRelaySession={refreshRelaySession}
      />

    </div>
  );
}
