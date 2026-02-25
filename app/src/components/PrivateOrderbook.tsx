import { useState } from "react";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";

interface PrivateOrderbookProps {
  pair?: TradingPair;
  referencePrice?: number | null;
  className?: string;
}

export default function PrivateOrderbook({
  pair,
  referencePrice,
  className = "",
}: PrivateOrderbookProps) {
  const [activeTab, setActiveTab] = useState<"book" | "trades">("book");
  const activePair = pair ?? TRADING_PAIRS[0];
  const baseSymbol = activePair.base.symbol;

  return (
    <div className={`trade-orderbook flex flex-col bg-shadow-900 h-full ${className}`}>
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-shadow-600 px-2 shrink-0">
        <button
          onClick={() => setActiveTab("book")}
          className={`mr-2 py-1 text-[11px] font-semibold transition-colors ${
            activeTab === "book"
              ? "border-b-2 border-accent-purple text-white"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Order Book
        </button>
        <button
          onClick={() => setActiveTab("trades")}
          className={`mr-2 py-1 text-[11px] font-semibold transition-colors ${
            activeTab === "trades"
              ? "border-b-2 border-accent-purple text-white"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Trades
        </button>
        <button className="ml-auto py-1 text-gray-500 hover:text-gray-300">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
          </svg>
        </button>
      </div>

      {activeTab === "book" ? (
        <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-3 px-2 py-[3px] text-[8px] uppercase tracking-[0.08em] text-gray-500 border-b border-shadow-600 shrink-0">
            <span>Price ({activePair.quote.symbol})</span>
            <span className="text-right">Size ({baseSymbol})</span>
            <span className="text-right">Total ({baseSymbol})</span>
          </div>

          {/* Asks (top half) */}
          <div className="flex-1 min-h-0" />

          {/* Spread row */}
          <SpreadRow referencePrice={referencePrice} />

          {/* Bids (bottom half) */}
          <div className="flex-1 min-h-0" />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-600">
          No recent trades
        </div>
      )}
    </div>
  );
}

function SpreadRow({ referencePrice }: { referencePrice?: number | null }) {
  // With no live book data, spread is unavailable - placeholder shown.
  void referencePrice;

  return (
    <div className="flex items-center gap-2 px-2 py-[5px] border-y border-shadow-600 shrink-0 bg-shadow-800/40">
      <span className="text-[9px] uppercase tracking-[0.08em] text-gray-500 shrink-0">Spread</span>
      <span className="text-[11px] font-semibold text-gray-300 tabular-nums">--</span>
      <span className="text-[10px] text-gray-500 tabular-nums ml-auto">--</span>
    </div>
  );
}
