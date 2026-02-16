import { useState, useCallback, useEffect } from "react";
import BN from "bn.js";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import toast from "react-hot-toast";
import { createShadowPerpClient } from "../lib/create-client";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";

type Direction = "long" | "short";

interface TradingPanelProps {
  pair?: TradingPair;
}

export default function TradingPanel({ pair }: TradingPanelProps) {
  const activePair = pair ?? TRADING_PAIRS[0];
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { connection } = useConnection();
  const [direction, setDirection] = useState<Direction>("long");
  const [size, setSize] = useState("");
  const [leverage, setLeverage] = useState(5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [marketPrice, setMarketPrice] = useState<number | null>(null);

  const margin = size && marketPrice ? (parseFloat(size) * marketPrice) / leverage : 0;
  const positionValue = size && marketPrice ? parseFloat(size) * marketPrice : 0;

  // Reset size when pair changes
  useEffect(() => {
    setSize("");
  }, [activePair.label]);

  const refreshMarketPrice = useCallback(async () => {
    if (!anchorWallet) {
      setMarketPrice(null);
      return;
    }
    try {
      const { client, runtime } = createShadowPerpClient(connection, anchorWallet);
      const market = await client.getMarket(runtime.marketAddress);
      const oraclePrice = new BN(market.oraclePrice.toString()).toNumber() / 1_000_000;
      if (Number.isFinite(oraclePrice) && oraclePrice > 0) {
        setMarketPrice(oraclePrice);
      }
    } catch {
      setMarketPrice(null);
    }
  }, [anchorWallet, connection]);

  useEffect(() => {
    void refreshMarketPrice();
    const interval = setInterval(() => void refreshMarketPrice(), 15_000);
    return () => clearInterval(interval);
  }, [refreshMarketPrice]);

  const handleSubmit = useCallback(async () => {
    if (!size || parseFloat(size) <= 0) {
      toast.error("Please enter a valid size");
      return;
    }

    if (!publicKey) {
      toast.error("Please connect your wallet");
      return;
    }
    if (!anchorWallet) {
      toast.error("Wallet does not support signing transactions");
      return;
    }

    setIsSubmitting(true);

    try {
      const { client, runtime } = createShadowPerpClient(connection, anchorWallet);
      const market = await client.getMarket(runtime.marketAddress);

      const sizeUi = Number(size);
      const baseDecimals = activePair.base.decimals;
      const sizeBase = new BN(Math.max(1, Math.round(sizeUi * 10 ** baseDecimals)));
      const oraclePrice = new BN(market.oraclePrice.toString());
      const entryPrice = oraclePrice.gt(new BN(0)) ? oraclePrice : new BN(1); // 1e6 scale
      const oraclePriceUi = Number(entryPrice.toString()) / 1_000_000;
      const requiredMarginUi = (sizeUi * oraclePriceUi) / leverage;
      const marginBase = new BN(Math.max(1, Math.round(requiredMarginUi * 1_000_000))); // USDC -> 1e6

      toast.loading("Submitting encrypted trade...", { id: "trade" });

      const { txSignature, positionAddress } = await client.openPosition(
        runtime.marketAddress,
        {
          size: sizeBase,
          entryPrice,
          leverage,
          direction,
          margin: marginBase,
        }
      );

      const txUrl = `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`;
      toast.success(
        <div>
          <p className="font-medium">Position queued</p>
          <p className="text-xs text-gray-400 break-all">{positionAddress.toBase58()}</p>
          <a
            href={txUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent-purple underline"
          >
            View transaction
          </a>
        </div>,
        { id: "trade", duration: 10000 }
      );
      setSize("");
    } catch (error: any) {
      toast.error(error?.message || "Failed to open position", { id: "trade" });
    } finally {
      setIsSubmitting(false);
    }
  }, [size, direction, leverage, publicKey, anchorWallet, connection, activePair.base.decimals]);

  return (
    <div className="position-card rounded-xl p-6">
      <h2 className="text-xl font-semibold mb-6">Open Position</h2>

      {/* Direction Toggle */}
      <div className="grid grid-cols-2 gap-2 mb-6">
        <button
          onClick={() => setDirection("long")}
          className={`py-3 rounded-lg font-medium transition-all ${
            direction === "long"
              ? "bg-accent-green text-white"
              : "bg-shadow-600 text-gray-400 hover:bg-shadow-500"
          }`}
        >
          Long
        </button>
        <button
          onClick={() => setDirection("short")}
          className={`py-3 rounded-lg font-medium transition-all ${
            direction === "short"
              ? "bg-accent-red text-white"
              : "bg-shadow-600 text-gray-400 hover:bg-shadow-500"
          }`}
        >
          Short
        </button>
      </div>

      {/* Size Input */}
      <div className="mb-6">
        <label className="block text-sm text-gray-400 mb-2">
          Position Size ({activePair.base.symbol})
        </label>
        <div className="relative">
          <input
            type="number"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder="0.00"
            className="w-full bg-shadow-700 border border-shadow-500 rounded-lg px-4 py-3 text-lg focus:outline-none focus:border-accent-purple transition-colors"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <button
              onClick={() => setSize("1")}
              className="text-xs text-gray-500 hover:text-accent-purple"
            >
              1
            </button>
            <button
              onClick={() => setSize("5")}
              className="text-xs text-gray-500 hover:text-accent-purple"
            >
              5
            </button>
            <button
              onClick={() => setSize("10")}
              className="text-xs text-accent-purple hover:text-accent-blue"
            >
              MAX
            </button>
          </div>
        </div>
      </div>

      {/* Leverage Slider */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <label className="text-sm text-gray-400">Leverage</label>
          <span className="text-lg font-semibold">{leverage}x</span>
        </div>
        <input
          type="range"
          min="1"
          max="20"
          value={leverage}
          onChange={(e) => setLeverage(parseInt(e.target.value))}
          className="w-full h-2 bg-shadow-600 rounded-lg appearance-none cursor-pointer accent-accent-purple"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>1x</span>
          <span>5x</span>
          <span>10x</span>
          <span>20x</span>
        </div>
      </div>

      {/* Order Summary */}
      <div className="bg-shadow-700 rounded-lg p-4 mb-6 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Position Value</span>
          <span>${positionValue.toFixed(2)} USDC</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Required Margin</span>
          <span>${margin.toFixed(2)} USDC</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Entry Price</span>
          <span>{marketPrice ? `$${marketPrice.toFixed(marketPrice < 0.01 ? 8 : 2)}` : "From oracle at execution"}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Trading Fee</span>
          <span>0.1%</span>
        </div>
        <div className="border-t border-shadow-500 my-2" />
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Liquidation Price</span>
          <span className="encrypted-blur text-accent-purple">Encrypted</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Health Factor</span>
          <span className="encrypted-blur text-accent-purple">Encrypted</span>
        </div>
      </div>

      {/* Privacy Notice */}
      <div className="bg-accent-purple/10 border border-accent-purple/30 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <svg
            className="w-5 h-5 text-accent-purple flex-shrink-0 mt-0.5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-accent-purple">
              Arcium MPC Privacy
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Position encrypted via x25519 + Rescue cipher. Data split into secret
              shares across MPC nodes - no single node sees your trade.
            </p>
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={isSubmitting || !size}
        className={`w-full py-4 rounded-lg font-semibold text-lg transition-all ${
          direction === "long"
            ? "bg-gradient-to-r from-accent-green to-emerald-600 hover:from-emerald-600 hover:to-accent-green"
            : "bg-gradient-to-r from-accent-red to-rose-600 hover:from-rose-600 hover:to-accent-red"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
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
        ) : (
          `Open ${direction.charAt(0).toUpperCase() + direction.slice(1)}`
        )}
      </button>
    </div>
  );
}
