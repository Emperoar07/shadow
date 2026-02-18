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

type Direction = "long" | "short";
type SizeUnit = "base" | "usd";

const LEVERAGE_PRESETS = [2, 5, 10, 25, 50] as const;

interface TradingPanelProps {
  pair?: TradingPair;
}

export default function TradingPanel({ pair }: TradingPanelProps) {
  const activePair = pair ?? TRADING_PAIRS[0];
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWalletCompat();
  const { connection } = useConnection();
  const [direction, setDirection] = useState<Direction>("long");
  const [size, setSize] = useState("");
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>("base");
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
  const clientRef = useRef<ReturnType<typeof createShadowPerpClient> | null>(null);
  const {
    submitPrivateOrder,
    status: privacyStatus,
    setError: setPrivacyError,
    resetStatus: resetPrivacyStatus,
  } = useArciumPrivacy();

  const sizeInBase =
    size && marketPrice
      ? sizeUnit === "usd"
        ? parseFloat(size) / marketPrice
        : parseFloat(size)
      : 0;

  const positionValue = sizeInBase && marketPrice ? sizeInBase * marketPrice : 0;
  const margin = positionValue > 0 ? positionValue / leverage : 0;

  const estimatedLiqPrice =
    marketPrice && sizeInBase > 0
      ? direction === "long"
        ? marketPrice * (1 - (1 - liqThreshold / 100) / leverage)
        : marketPrice * (1 + (1 - liqThreshold / 100) / leverage)
      : null;

  const getClient = useCallback(() => {
    if (!anchorWallet) return null;
    if (!clientRef.current) {
      try {
        clientRef.current = createShadowPerpClient(connection, anchorWallet);
      } catch {
        return null;
      }
    }
    return clientRef.current;
  }, [anchorWallet, connection]);

  useEffect(() => {
    clientRef.current = null;
  }, [anchorWallet]);

  useEffect(() => {
    setSize("");
  }, [activePair.label, sizeUnit]);

  const refreshMarketData = useCallback(async () => {
    const livePrices = await fetchPrices().catch(() => null);
    const livePrice = livePrices?.[activePair.label]?.price ?? activePair.mockPrice;

    if (!anchorWallet) {
      setMarketPrice(livePrice);
      setMarginBalance(null);
      return;
    }
    const ctx = getClient();
    if (!ctx) {
      setMarketPrice(livePrice);
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
      if (marketResult.status === "fulfilled") {
        const oraclePrice =
          new BN(marketResult.value.oraclePrice.toString()).toNumber() / 1_000_000;
        if (Number.isFinite(oraclePrice) && oraclePrice > 0) {
          setMarketPrice(oraclePrice);
        } else {
          setMarketPrice(livePrice);
        }
        const thresh = marketResult.value.liquidationThreshold;
        if (thresh != null) {
          setLiqThreshold(Number(thresh) / 100);
        }
      } else {
        setMarketPrice(livePrice);
      }
      if (marginResult.status === "fulfilled") {
        const bal =
          new BN(marginResult.value.balance.toString()).toNumber() / 1_000_000;
        setMarginBalance(bal);
      } else {
        setMarginBalance(0);
      }
    } catch {
      setMarketPrice(livePrice);
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
            href={`https://explorer.solana.com/tx/${tx}?cluster=devnet`}
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

  const handleSubmit = useCallback(async () => {
    if (!size || parseFloat(size) <= 0 || sizeInBase <= 0) {
      toast.error("Please enter a valid size");
      return;
    }
    if (!publicKey) { toast.error("Please connect your wallet"); return; }
    if (!anchorWallet) { toast.error("Wallet does not support signing transactions"); return; }
    if (marginBalance !== null && marginBalance <= 0) {
      toast.error("Deposit collateral first before opening a position");
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
        toast.error("Trading unavailable in demo mode.", { id: "trade" });
        return;
      }

      setTradeStep("encrypting");
      await new Promise((r) => setTimeout(r, 800));
      setTradeStep("submitting");

      const { txSignature } = await submitPrivateOrder(
        { side: direction, sizeUi: sizeInBase, leverage },
        true
      );

      setTradeTxSig(txSignature);
      setTradeStep("confirmed");
      setSize("");
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
    direction,
    leverage,
    publicKey,
    anchorWallet,
    getClient,
    marginBalance,
    refreshMarketData,
    submitPrivateOrder,
    setPrivacyError,
    resetPrivacyStatus,
  ]);

  // Keyboard shortcuts — MUST be after handleSubmit to avoid TDZ error
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
        void handleSubmit();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, isSubmitting, size, sizeInBase, handleSubmit]);

  return (
    <div className="position-card rounded-xl p-6">
      <h2 className="text-xl font-semibold mb-6">Open Position</h2>

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
      <div className="flex justify-between text-[10px] text-gray-600 mb-5 px-0.5">
        <span>
          Hotkey:{" "}
          <kbd className="px-1 py-0.5 rounded bg-shadow-600 text-gray-500">L</kbd> Long
        </span>
        <span>
          <kbd className="px-1 py-0.5 rounded bg-shadow-600 text-gray-500">S</kbd> Short
          {" · "}
          <kbd className="px-1 py-0.5 rounded bg-shadow-600 text-gray-500">↵</kbd> Submit
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
            {marketPrice
              ? `$${marketPrice.toFixed(marketPrice < 0.01 ? 8 : 2)}`
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
              $
              {estimatedLiqPrice < 0.01
                ? estimatedLiqPrice.toFixed(8)
                : estimatedLiqPrice.toFixed(2)}
            </span>
          ) : (
            <span className="text-gray-500">—</span>
          )}
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Health Factor</span>
          <span className="encrypted-blur text-accent-purple">Encrypted</span>
        </div>
      </div>

      {/* Privacy Strip */}
      <div className="bg-accent-purple/10 border border-accent-purple/30 rounded-lg p-3 mb-6">
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-accent-purple flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                clipRule="evenodd"
              />
            </svg>
            <p className="font-medium text-accent-purple leading-tight">MPC Privacy: On</p>
          </div>
          <span
            className={`text-[11px] px-2 py-1 rounded border ${
              privacyStatus === "error"
                ? "text-red-400 border-red-500/30 bg-red-500/10"
                : "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
            }`}
          >
            Status: {privacyStatus === "error" ? "Degraded" : "Active"}
          </span>
        </div>
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={isSubmitting || !size || sizeInBase <= 0}
        className={`w-full py-4 rounded-lg font-semibold text-lg transition-all btn-press ${
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
          `Open ${direction.charAt(0).toUpperCase() + direction.slice(1)}`
        )}
      </button>

      <TradeConfirmationModal
        isOpen={modalOpen}
        step={tradeStep}
        direction={direction}
        size={size || "0"}
        leverage={leverage}
        entryPrice={marketPrice ?? activePair.mockPrice}
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
