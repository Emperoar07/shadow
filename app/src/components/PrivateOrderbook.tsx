import { useMemo, useState } from "react";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";

interface PrivateOrderbookProps {
  pair?: TradingPair;
  referencePrice?: number | null;
  className?: string;
}

interface BookLevel {
  side: "bid" | "ask";
  price: number;
  size: number;
  total: number;
  blurred: boolean;
  depthPct: number;
}

const LEVELS_PER_SIDE = 12;

function getPriceDecimals(price: number): number {
  if (price < 0.01) return 8;
  if (price < 1) return 5;
  return 3;
}

function pseudoRand(seed: number, offset: number): number {
  const x = Math.sin(seed * 997.3 + offset * 13.7) * 43758.5453;
  return x - Math.floor(x);
}

export default function PrivateOrderbook({
  pair,
  referencePrice,
  className = "",
}: PrivateOrderbookProps) {
  const [activeTab, setActiveTab] = useState<"book" | "trades">("book");
  const activePair = pair ?? TRADING_PAIRS[0];
  const centerPrice =
    typeof referencePrice === "number" && Number.isFinite(referencePrice) && referencePrice > 0
      ? referencePrice
      : activePair.mockPrice;

  const { asks, bids, decimals, spreadAbs, spreadPct } = useMemo(() => {
    const dec = getPriceDecimals(centerPrice);
    const step = centerPrice * 0.0008;
    const maxSize = centerPrice > 100 ? 800 : centerPrice > 1 ? 400 : 12000;

    // Build asks from closest→furthest, then reverse for display (furthest at top)
    const askRaw: BookLevel[] = [];
    let askCum = 0;
    for (let i = 0; i < LEVELS_PER_SIDE; i++) {
      const price = centerPrice + step * (i + 1);
      const r = pseudoRand(Math.round(price * 1000), i);
      const size = Math.round((20 + r * maxSize) * 100) / 100;
      askCum += size;
      askRaw.push({
        side: "ask",
        price,
        size,
        total: askCum,
        blurred: i < 5, // closest 5 to center are blurred (will appear at bottom after reverse)
        depthPct: 12 + r * 72,
      });
    }
    const asks = [...askRaw].reverse().map((l, displayIdx) => ({
      ...l,
      // After reverse: displayIdx 0 = furthest (top), displayIdx 11 = closest (bottom)
      // Bottom rows (closest to spread) are blurred
      blurred: displayIdx >= LEVELS_PER_SIDE - 5,
    }));

    const bids: BookLevel[] = [];
    let bidCum = 0;
    for (let i = 0; i < LEVELS_PER_SIDE; i++) {
      const price = Math.max(0, centerPrice - step * (i + 1));
      const r = pseudoRand(Math.round(price * 1000), i + 50);
      const size = Math.round((20 + r * maxSize) * 100) / 100;
      bidCum += size;
      bids.push({
        side: "bid",
        price,
        size,
        total: bidCum,
        blurred: i >= 4, // first 4 rows visible
        depthPct: 12 + r * 72,
      });
    }

    const sAbs = Math.max(0, centerPrice + step - (centerPrice - step));
    const sPct = centerPrice > 0 ? (sAbs / centerPrice) * 100 : 0;

    return { asks, bids, decimals: dec, spreadAbs: sAbs, spreadPct: sPct };
  }, [activePair.label, centerPrice]);

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

          {/* Ask rows — push to bottom with justify-end */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col justify-end">
            {asks.map((level, idx) => (
              <BookRow key={`ask-${idx}`} level={level} decimals={decimals} />
            ))}
          </div>

          {/* Spread row — Hyperliquid style: 3 columns */}
          <div className="grid grid-cols-3 px-2 py-[3px] border-y border-shadow-600 shrink-0 bg-shadow-800">
            <span className="text-[9px] font-semibold text-gray-400">Spread</span>
            <span className="text-[9px] font-semibold text-gray-200 text-center tabular-nums">
              {spreadAbs.toFixed(decimals)}
            </span>
            <span className="text-[9px] text-gray-500 text-right tabular-nums">
              {spreadPct.toFixed(3)}%
            </span>
          </div>

          {/* Bid rows */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {bids.map((level, idx) => (
              <BookRow key={`bid-${idx}`} level={level} decimals={decimals} />
            ))}
          </div>

          {/* MPC footer */}
          <div className="shrink-0 px-2 py-[3px] border-t border-shadow-600 flex items-center gap-1">
            <svg className="w-2.5 h-2.5 text-accent-purple/60 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            <span className="text-[8px] text-gray-600 italic">some rows MPC-encrypted</span>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-600">
          No recent trades
        </div>
      )}
    </div>
  );
}

function BookRow({ level, decimals }: { level: BookLevel; decimals: number }) {
  const isBid = level.side === "bid";

  return (
    <div className="relative grid grid-cols-3 items-center px-2 py-[1px] text-[10px] hover:bg-shadow-700/30 cursor-default">
      {/* Depth bar anchored to right */}
      <span
        className={`absolute inset-y-0 right-0 pointer-events-none ${
          isBid ? "bg-accent-green/10" : "bg-accent-red/10"
        }`}
        style={{ width: `${level.depthPct}%` }}
      />
      <span
        className={`relative font-medium tabular-nums ${
          isBid ? "text-accent-green" : "text-accent-red"
        }`}
      >
        {level.price.toFixed(decimals)}
      </span>
      <span
        className="relative text-right tabular-nums text-gray-300"
        style={level.blurred ? { filter: "blur(3px)", userSelect: "none" } : {}}
      >
        {level.size.toFixed(2)}
      </span>
      <span
        className="relative text-right tabular-nums text-gray-500"
        style={level.blurred ? { filter: "blur(3px)", userSelect: "none" } : {}}
      >
        {level.total.toFixed(2)}
      </span>
    </div>
  );
}
