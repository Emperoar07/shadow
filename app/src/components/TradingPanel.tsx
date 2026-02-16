import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import toast from "react-hot-toast";

type Direction = "long" | "short";

export default function TradingPanel() {
  const { publicKey } = useWallet();
  const [direction, setDirection] = useState<Direction>("long");
  const [size, setSize] = useState("");
  const [leverage, setLeverage] = useState(5);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!size || parseFloat(size) <= 0) {
      toast.error("Please enter a valid size");
      return;
    }

    setIsSubmitting(true);

    try {
      // Simulate encryption and submission
      toast.loading("Encrypting position data...", { id: "encrypt" });
      await new Promise((r) => setTimeout(r, 1500));

      toast.loading("Submitting to MPC network...", { id: "encrypt" });
      await new Promise((r) => setTimeout(r, 2000));

      toast.success(
        <div>
          <p className="font-medium">Position queued!</p>
          <p className="text-sm text-gray-400">
            Your {direction} position is being processed privately.
          </p>
        </div>,
        { id: "encrypt", duration: 5000 }
      );

      setSize("");
    } catch (error) {
      toast.error("Failed to open position", { id: "encrypt" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const margin = size ? (parseFloat(size) * 103.45) / leverage : 0;

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
          Position Size (SOL)
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
          <span className="text-gray-400">Required Margin</span>
          <span>${margin.toFixed(2)} USDC</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Entry Price</span>
          <span>$103.45</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Liquidation Price</span>
          <span className="encrypted-blur text-accent-purple">Hidden</span>
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
              Privacy Protected
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Your position size, leverage, and direction will be encrypted
              using MPC. Only you can see these details.
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
            Processing...
          </span>
        ) : (
          `Open ${direction.charAt(0).toUpperCase() + direction.slice(1)}`
        )}
      </button>
    </div>
  );
}
