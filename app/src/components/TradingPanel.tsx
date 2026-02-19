import { useState, useCallback, useEffect, useRef } from "react";
import BN from "bn.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import toast from "react-hot-toast";
import { createShadowPerpClient } from "../lib/create-client";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";
import { fetchPrices } from "../lib/prices";
import TradeConfirmationModal, { TradeStep } from "./TradeConfirmationModal";
import CollateralModal from "./CollateralModal";
import { useArciumPrivacy } from "../hooks/useArcium";
import { useAnchorWalletCompat } from "../lib/use-anchor-wallet";
import { getExplorerTxUrl } from "../lib/explorer";
import {
  PendingLimitOrder,
  disableEncryptedAutomationPersistence,
  enableEncryptedAutomationPersistence,
  createLimitOrderId,
  getLimitOrders,
  removeLimitOrder,
  setOwnerPositionView,
  setPositionRule,
  subscribeAutomationUpdates,
  updateLimitOrder,
  upsertLimitOrder,
} from "../lib/trade-automation";

type Direction = "long" | "short";
type SizeUnit = "base" | "usd";
type OrderType = "market" | "limit";

const LEVERAGE_PRESETS = [2, 5, 10, 25, 50] as const;
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
  const [size, setSize] = useState("");
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>("base");
  const [limitPrice, setLimitPrice] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [leverage, setLeverage] = useState(5);
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
  const [priceWarning, setPriceWarning] = useState<string | null>(null);
  const [limitOrders, setLimitOrders] = useState<PendingLimitOrder[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);
  const refreshSeqRef = useRef(0);
  const priceWarningToastOpenRef = useRef(false);
  const handleSubmitRef = useRef<() => void>(() => undefined);
  const limitExecutorRunningRef = useRef(false);
  const processingOrderIdsRef = useRef<Set<string>>(new Set());
  const {
    submitPrivateOrder,
    status: privacyStatus,
    setError: setPrivacyError,
    resetStatus: resetPrivacyStatus,
  } = useArciumPrivacy();

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

  const loadAutomationState = useCallback(() => {
    setLimitOrders(getLimitOrders());
  }, []);

  useEffect(() => {
    loadAutomationState();
    return subscribeAutomationUpdates(loadAutomationState);
  }, [loadAutomationState]);

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
        if (!cancelled) loadAutomationState();
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
  }, [publicKey, signMessage, loadAutomationState]);

  useEffect(() => {
    return () => {
      toast.dismiss("price-feed-warning");
    };
  }, []);

  const refreshMarketData = useCallback(async () => {
    const requestSeq = ++refreshSeqRef.current;
    const fallbackWarning = "Price feed degraded. Showing fallback market data.";
    const clientWarning = "Trading client unavailable. Price shown is fallback data.";
    const setWarning = (message: string | null) => {
      if (requestSeq !== refreshSeqRef.current) return;
      setPriceWarning(message);
      if (message) {
        toast.error(message, { id: "price-feed-warning" });
        priceWarningToastOpenRef.current = true;
      } else if (priceWarningToastOpenRef.current) {
        toast.dismiss("price-feed-warning");
        priceWarningToastOpenRef.current = false;
      }
    };

    const livePrices = await fetchPrices().catch(() => null);
    const livePairPrice = livePrices?.[activePair.label]?.price ?? null;
    const fallbackPrice = livePairPrice ?? activePair.mockPrice;

    if (!anchorWallet) {
      if (requestSeq !== refreshSeqRef.current) return;
      setMarketPrice(fallbackPrice);
      setMarginBalance(null);
      setWarning(livePairPrice === null ? fallbackWarning : null);
      return;
    }

    const ctx = getClient();
    if (!ctx) {
      if (requestSeq !== refreshSeqRef.current) return;
      setMarketPrice(fallbackPrice);
      setMarginBalance(null);
      setWarning(clientWarning);
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

      setWarning(usedFallbackPrice ? fallbackWarning : null);
    } catch {
      if (requestSeq !== refreshSeqRef.current) return;
      setMarketPrice(fallbackPrice);
      setWarning(fallbackWarning);
    }
  }, [anchorWallet, publicKey, getClient, activePair]);

  useEffect(() => {
    void refreshMarketData();
    const interval = setInterval(() => void refreshMarketData(), 15_000);
    return () => clearInterval(interval);
  }, [refreshMarketData]);

  const handleDeposit = useCallback(async () => {
    const amt = parseFloat(depositAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid deposit amount"); return; }
    if (!anchorWallet || !publicKey) { toast.error("Please connect your wallet"); return; }
    setIsDepositing(true);
    try {
      const ctx = getClient();
      if (!ctx) {
        toast.error("Deposits unavailable in demo mode.", { id: "deposit" });
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
      if (!msg.includes("env var")) toast.error(msg, { id: "deposit" });
    } finally {
      setIsDepositing(false);
    }
  }, [depositAmount, anchorWallet, publicKey, getClient, refreshMarketData]);

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
  }, [activePair.label, anchorWallet, marketPrice, publicKey, refreshMarketData, submitEncryptedOrder]);

  useEffect(() => {
    const id = setInterval(() => void runLimitExecutor(), 4_000);
    return () => clearInterval(id);
  }, [runLimitExecutor]);

  const updateOrderField = useCallback(
    (
      orderId: string,
      field: "limitPrice" | "takeProfit" | "stopLoss",
      raw: string
    ) => {
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

  return (
    <div className="position-card rounded-xl p-6">
      <h2 className="text-xl font-semibold mb-6">Open Position</h2>

      <div className={isHorizontal ? "grid grid-cols-1 lg:grid-cols-12 gap-4 items-start" : ""}>
        <div className={isHorizontal ? "lg:col-span-7" : ""}>
      {/* Margin Balance + Manage button */}
      {publicKey && (
        <div className="flex items-center justify-between bg-shadow-700 rounded-lg px-4 py-3 mb-6">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Margin Balance</p>
            <p
              className={`text-sm font-semibold ${
                marginBalance === 0 ? "text-yellow-400" : "text-white"
              }`}
            >
              {marginBalance !== null ? `$${marginBalance.toFixed(2)} USDC` : "--"}
            </p>
          </div>
          <button
            onClick={() => setCollateralModalOpen(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent-purple/20 text-accent-purple hover:bg-accent-purple/30 transition-colors border border-accent-purple/30"
          >
            {marginBalance === 0 ? "Deposit Collateral" : "Manage"}
          </button>
        </div>
      )}

      {/* Direction Toggle */}
      <div className="grid grid-cols-2 gap-2 mb-1">
        <button
          onClick={() => setDirection("long")}
          className={`py-3 rounded-lg font-medium transition-all btn-press ${
            direction === "long"
              ? "bg-accent-green text-white"
              : "bg-shadow-600 text-gray-400 hover:bg-shadow-500"
          }`}
        >
          Long
        </button>
        <button
          onClick={() => setDirection("short")}
          className={`py-3 rounded-lg font-medium transition-all btn-press ${
            direction === "short"
              ? "bg-accent-red text-white"
              : "bg-shadow-600 text-gray-400 hover:bg-shadow-500"
          }`}
        >
          Short
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 mb-1">
        <button
          onClick={() => setOrderType("market")}
          className={`py-2 rounded-lg text-xs border transition-colors ${
            orderType === "market"
              ? "bg-accent-purple/20 border-accent-purple/40 text-white"
              : "bg-shadow-700 border-shadow-500 text-gray-300 hover:text-white"
          }`}
        >
          Market
        </button>
        <button
          onClick={() => setOrderType("limit")}
          className={`py-2 rounded-lg text-xs border transition-colors ${
            orderType === "limit"
              ? "bg-accent-purple/20 border-accent-purple/40 text-white"
              : "bg-shadow-700 border-shadow-500 text-gray-300 hover:text-white"
          }`}
        >
          Limit
        </button>
      </div>

      <div className="flex justify-between text-[10px] text-gray-600 mb-5 px-0.5">
        <span>
          Hotkey:{" "}
          <kbd className="px-1 py-0.5 rounded bg-shadow-600 text-gray-500">L</kbd> Long
        </span>
        <span>
          <kbd className="px-1 py-0.5 rounded bg-shadow-600 text-gray-500">S</kbd> Short
          {" | "}
          <kbd className="px-1 py-0.5 rounded bg-shadow-600 text-gray-500">Enter</kbd> Submit
        </span>
      </div>
      {/* Size Input */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm text-gray-400">Position Size</label>
          <div className="flex rounded-md overflow-hidden border border-shadow-500 text-xs">
            <button
              onClick={() => setSizeUnit("base")}
              className={`px-2.5 py-1 transition-colors ${
                sizeUnit === "base"
                  ? "bg-accent-purple/30 text-white"
                  : "bg-shadow-700 text-gray-400 hover:text-gray-200"
              }`}
            >
              {activePair.base.symbol}
            </button>
            <button
              onClick={() => setSizeUnit("usd")}
              className={`px-2.5 py-1 transition-colors ${
                sizeUnit === "usd"
                  ? "bg-accent-purple/30 text-white"
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
            className="w-full bg-shadow-700 border border-shadow-500 rounded-lg px-4 py-3 text-lg focus:outline-none focus:border-accent-purple transition-colors pr-16"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">
            {sizeUnit === "usd" ? "USDC" : activePair.base.symbol}
          </span>
        </div>
        <div className="flex gap-2 mt-1.5">
          {sizeUnit === "base"
            ? ["0.1", "0.5", "1", "5"].map((v) => (
                <button
                  key={v}
                  onClick={() => setSize(v)}
                  className="text-[11px] px-2 py-0.5 rounded bg-shadow-600 text-gray-400 hover:text-accent-purple hover:bg-shadow-500 transition-colors"
                >
                  {v}
                </button>
              ))
            : ["10", "50", "100", "500"].map((v) => (
                <button
                  key={v}
                  onClick={() => setSize(v)}
                  className="text-[11px] px-2 py-0.5 rounded bg-shadow-600 text-gray-400 hover:text-accent-purple hover:bg-shadow-500 transition-colors"
                >
                  ${v}
                </button>
              ))}
        </div>
      </div>

      {orderType === "limit" && (
        <div className="mb-6">
          <label className="text-sm text-gray-400 block mb-2">Limit Price</label>
          <div className="relative">
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder="0.00"
              className="w-full bg-shadow-700 border border-shadow-500 rounded-lg px-4 py-3 text-lg focus:outline-none focus:border-accent-purple transition-colors pr-16"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
              USDC
            </span>
          </div>
        </div>
      )}

      <div className="mb-6">
        <label className="text-sm text-gray-400 block mb-2">Take Profit / Stop Loss</label>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            placeholder="Take Profit"
            className="bg-shadow-700 border border-shadow-500 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent-green"
          />
          <input
            type="number"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            placeholder="Stop Loss"
            className="bg-shadow-700 border border-shadow-500 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent-red"
          />
        </div>
      </div>

      {priceWarning && (
        <div className="mb-3 text-[11px] text-yellow-300 border border-yellow-500/30 bg-yellow-500/10 rounded px-2.5 py-1.5">
          {priceWarning}
        </div>
      )}

      {/* Hidden by default; only surface if privacy path degrades */}
      {privacyStatus === "error" && (
        <div className="mb-3 flex items-center gap-2 text-[11px] text-red-400">
          <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
          <span>Privacy degraded</span>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={isSubmitting || !size || sizeInBase <= 0 || (orderType === "limit" && !parsedLimitPrice)}
        className={`w-full py-3.5 rounded-lg font-semibold text-base transition-all btn-press mb-2 ${
          direction === "long"
            ? "bg-gradient-to-r from-accent-green to-emerald-600 hover:from-emerald-600 hover:to-accent-green"
            : "bg-gradient-to-r from-accent-red to-rose-600 hover:from-rose-600 hover:to-accent-red"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Processing via MPC...
          </span>
        ) : (
          orderType === "limit"
            ? `Place Limit ${direction.charAt(0).toUpperCase() + direction.slice(1)}`
            : `Open ${direction.charAt(0).toUpperCase() + direction.slice(1)}`
        )}
      </button>
      </div>

      <div className={isHorizontal ? "lg:col-span-5" : ""}>
      {/* Leverage */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <label className="text-sm text-gray-400">Leverage</label>
          <span className="text-lg font-semibold">{leverage}x</span>
        </div>
        <div className="flex gap-1.5 mb-3">
          {LEVERAGE_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => setLeverage(preset)}
              className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                leverage === preset
                  ? "bg-accent-purple text-white"
                  : "bg-shadow-600 text-gray-400 hover:bg-shadow-500 hover:text-white"
              }`}
            >
              {preset}x
            </button>
          ))}
        </div>
        <input
          type="range"
          min="1"
          max="50"
          value={leverage}
          onChange={(e) => setLeverage(parseInt(e.target.value))}
          className="w-full h-2 bg-shadow-600 rounded-lg appearance-none cursor-pointer accent-accent-purple"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>1x</span>
          <span>10x</span>
          <span>20x</span>
          <span>35x</span>
          <span>50x</span>
        </div>
      </div>

      {/* Order Summary */}
      <div className="bg-shadow-700 rounded-lg p-4 mb-6 space-y-2">
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
        <div className="border-t border-shadow-500 my-2" />
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

      </div>

      <div className="mt-5 border border-shadow-500 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-shadow-500 text-sm font-medium bg-shadow-700">
          Open Limit Orders
        </div>
        {limitOrders.filter((o) => ["pending", "triggered", "failed"].includes(o.status)).length === 0 ? (
          <p className="text-xs text-gray-500 p-3">No active limit orders.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto">
            {limitOrders
              .filter((o) => ["pending", "triggered", "failed"].includes(o.status))
              .map((order) => (
                <div key={order.id} className="p-3 border-b border-shadow-700 last:border-b-0">
                  <div className="flex justify-between gap-2">
                    <div className="text-xs">
                      <p className="font-medium">
                        {order.pairLabel} | {order.side.toUpperCase()} | {order.leverage}x
                      </p>
                      <p className="text-gray-400 mt-1">
                        Limit {formatPrice(order.limitPrice)} | TP {formatPrice(order.takeProfit)} | SL{" "}
                        {formatPrice(order.stopLoss)}
                      </p>
                      {order.error && <p className="text-red-400 mt-1">{order.error}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] px-2 py-0.5 rounded border border-shadow-500 text-gray-300">
                        {order.status}
                      </span>
                      <div className="flex gap-1">
                        {(order.status === "pending" || order.status === "failed") && (
                          <button
                            onClick={() => setEditingId(editingId === order.id ? null : order.id)}
                            className="text-[10px] px-2 py-1 rounded bg-shadow-600 text-gray-300"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          onClick={() => removeLimitOrder(order.id)}
                          className="text-[10px] px-2 py-1 rounded bg-red-500/15 text-red-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                  {editingId === order.id && (
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      <input
                        type="number"
                        defaultValue={order.limitPrice}
                        onBlur={(e) => updateOrderField(order.id, "limitPrice", e.target.value)}
                        placeholder="Limit"
                        className="bg-shadow-700 border border-shadow-500 rounded px-2 py-1 text-[11px]"
                      />
                      <input
                        type="number"
                        defaultValue={order.takeProfit ?? ""}
                        onBlur={(e) => updateOrderField(order.id, "takeProfit", e.target.value)}
                        placeholder="TP"
                        className="bg-shadow-700 border border-shadow-500 rounded px-2 py-1 text-[11px]"
                      />
                      <input
                        type="number"
                        defaultValue={order.stopLoss ?? ""}
                        onBlur={(e) => updateOrderField(order.id, "stopLoss", e.target.value)}
                        placeholder="SL"
                        className="bg-shadow-700 border border-shadow-500 rounded px-2 py-1 text-[11px]"
                      />
                    </div>
                  )}
                </div>
              ))}
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

      <CollateralModal
        isOpen={collateralModalOpen}
        marginBalance={marginBalance}
        onClose={() => setCollateralModalOpen(false)}
        onSuccess={() => {
          setCollateralModalOpen(false);
          void refreshMarketData();
        }}
      />
    </div>
  );
}
