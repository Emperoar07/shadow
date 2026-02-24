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
import { getExplorerTxUrl } from "../lib/explorer";
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

const LEVERAGE_MARKERS = [1, 5, 10, 25, 50] as const;
const MIN_LEVERAGE = LEVERAGE_MARKERS[0];
const MAX_LEVERAGE = LEVERAGE_MARKERS[LEVERAGE_MARKERS.length - 1];
const TP_SL_MIN_GAP_BPS = 10; // 0.10%
const MAX_POSITION_SIZE_BASE = 1_000_000;
const MAX_POSITION_NOTIONAL_USDC = 5_000_000;
const AUTO_SESSION_BASE_COOLDOWN_MS = 30_000;
const AUTO_SESSION_ERROR_COOLDOWN_MS = 5 * 60_000;

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
  const [size, setSize] = useState("");
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>("base");
  const [limitPrice, setLimitPrice] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [leverage, setLeverage] = useState(10);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [marketPrice, setMarketPrice] = useState<number | null>(null);
  const [marginBalance, setMarginBalance] = useState<number | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [isDepositing, setIsDepositing] = useState(false);
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
  const autoSessionInFlightRef = useRef(false);
  const autoSessionCooldownUntilRef = useRef(0);
  const {
    submitPrivateOrder,
    setError: setPrivacyError,
    resetStatus: resetPrivacyStatus,
    relayAvailable,
    relaySession,
    relaySessionHydrated,
    ensureRelaySession,
    refreshRelaySession,
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
    let cancelled = false;
    const owner = publicKey?.toBase58();

    if (!owner || !signMessage) {
      disableEncryptedAutomationPersistence();
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        await enableEncryptedAutomationPersistence({
          owner,
          signMessage,
        });
        if (cancelled) return;
      } catch (error: any) {
        disableEncryptedAutomationPersistence();
        if (cancelled) return;
        const message =
          typeof error?.message === "string" && error.message.trim().length > 0
            ? error.message
            : "Encrypted persistence unlock failed. Keeping automation in memory only.";
        toast.error(message, { id: "automation-persistence" });
      }
    })();

    return () => {
      cancelled = true;
    };
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

  useEffect(() => {
    const owner = publicKey?.toBase58() ?? null;
    if (!owner) {
      autoSessionInFlightRef.current = false;
      autoSessionCooldownUntilRef.current = 0;
      toast.dismiss("relay-auto-session");
      return;
    }
    if (isRelaySessionActive) {
      toast.dismiss("relay-auto-session");
      return;
    }
    if (!relaySessionHydrated) return;
    if (!relayAvailable) return;
    if (autoSessionInFlightRef.current) return;
    const nowMs = Date.now();
    if (nowMs < autoSessionCooldownUntilRef.current) return;
    autoSessionInFlightRef.current = true;
    autoSessionCooldownUntilRef.current = nowMs + AUTO_SESSION_BASE_COOLDOWN_MS;

    let cancelled = false;
    void (async () => {
      try {
        toast.loading("Initializing delegated session...", {
          id: "relay-auto-session",
        });
        const session = await ensureRelaySession();
        if (cancelled || !session) {
          toast.dismiss("relay-auto-session");
          return;
        }
        const remainingMinutes = Math.max(
          1,
          Math.floor((session.expiresAt - Math.floor(Date.now() / 1000)) / 60)
        );
        toast.success(`Delegated session active (${remainingMinutes}m)`, {
          id: "relay-auto-session",
          duration: 5000,
        });
      } catch (error: any) {
        if (cancelled) return;
        autoSessionCooldownUntilRef.current = Date.now() + AUTO_SESSION_ERROR_COOLDOWN_MS;
        const message =
          typeof error?.message === "string" && error.message.trim().length > 0
            ? error.message
            : "Failed to initialize delegated session.";
        toast.error(message, { id: "relay-auto-session", duration: 7000 });
      } finally {
        autoSessionInFlightRef.current = false;
        if (cancelled) {
          toast.dismiss("relay-auto-session");
        }
      }
    })();

    return () => {
      cancelled = true;
      toast.dismiss("relay-auto-session");
    };
  }, [ensureRelaySession, isRelaySessionActive, publicKey, relayAvailable, relaySessionHydrated]);

  const handleDeposit = useCallback(async () => {
    const amt = parseFloat(depositAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid deposit amount"); return; }
    if (!anchorWallet || !publicKey) { toast.error("Please connect your wallet"); return; }
    setIsDepositing(true);
    try {
      const ctx = getClient();
      if (!ctx) {
        toast.error(clientInitError || "Deposits unavailable. Check runtime configuration.", { id: "deposit" });
        return;
      }
      const { client, runtime } = ctx;
      const amountBN = new BN(Math.round(amt * 1_000_000));
      toast.loading("Depositing collateral...", { id: "deposit" });
      const tx = await client.depositCollateral(runtime.marketAddress, amountBN);
      toast.success(
        <div>
          <p className="font-medium">Deposited ${amt.toFixed(2)} USDC</p>
          <a
            href={getExplorerTxUrl(tx)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent-purple underline"
          >
            View transaction
          </a>
        </div>,
        { id: "deposit", duration: 8000 }
      );
      setDepositAmount("");
      void refreshMarketData();
    } catch (error: any) {
      const msg = error?.message || "Deposit failed";
      if (msg.includes("env var")) {
        const matched = msg.match(/env var:\s*([A-Z0-9_]+)/i);
        const detail = matched?.[1]
          ? `Deposits unavailable: missing ${matched[1]}. Set it in app/.env.local and restart Next.js.`
          : "Deposits unavailable. Check app/.env.local and restart Next.js.";
        toast.error(detail, { id: "deposit" });
      } else {
        toast.error(msg, { id: "deposit" });
      }
    } finally {
      setIsDepositing(false);
    }
  }, [depositAmount, anchorWallet, publicKey, getClient, refreshMarketData, clientInitError]);

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
    if (!isRelaySessionActive) {
      toast.error("Delegated session required. Please sign a new session.");
      return;
    }
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
            <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-gray-500">Leverage</label>
            <div className="rounded-xl border border-shadow-500 bg-shadow-700/70 p-2.5">
              <div className="mb-2 flex items-center justify-end">
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

          <div className="flex items-center gap-1 text-[9px] text-gray-600 px-0.5 -mt-1">
            <svg className="w-2.5 h-2.5 text-accent-purple/60" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            <span>encrypted</span>
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
              !isRelaySessionActive ||
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
              "Session Required"
            ) : orderType === "limit" ? (
              `Place Limit ${direction.charAt(0).toUpperCase() + direction.slice(1)}`
            ) : (
              `Open ${direction.charAt(0).toUpperCase() + direction.slice(1)} Position`
            )}
          </button>
        </div>

        {!isHorizontal && (
          <div className="space-y-4">
            <div className="space-y-2 rounded-lg border border-shadow-500 bg-shadow-700 p-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Order Type</span>
                <span className="uppercase">{orderType}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Position Value</span>
                <span>${positionValue.toFixed(2)} USDC</span>
              </div>
              {sizeUnit === "usd" && sizeInBase > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Size ({activePair.base.symbol})</span>
                  <span>
                    {sizeInBase.toFixed(sizeInBase < 0.01 ? 6 : 4)} {activePair.base.symbol}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Required Margin</span>
                <span>${margin.toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Entry Price</span>
                <span>
                  {orderType === "limit"
                    ? formatPrice(parsedLimitPrice)
                    : marketPrice
                    ? formatPrice(marketPrice)
                    : "From oracle at execution"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Trading Fee</span>
                <span>0.1%</span>
              </div>
              <div className="my-2 border-t border-shadow-500" />
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">
                  Est. Liq. Price
                  <span className="ml-1 text-[10px] text-gray-600">(approx)</span>
                </span>
                {estimatedLiqPrice ? (
                  <span className={direction === "long" ? "text-accent-red" : "text-accent-green"}>
                    {formatPrice(estimatedLiqPrice)}
                  </span>
                ) : (
                  <span className="text-gray-500">--</span>
                )}
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Health Factor</span>
                <span className="encrypted-blur text-accent-purple">Encrypted</span>
              </div>
            </div>
          </div>
        )}
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

    </div>
  );
}
