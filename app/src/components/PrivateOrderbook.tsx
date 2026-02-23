import { useMemo } from "react";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";

interface PrivateOrderbookProps {
  pair?: TradingPair;
  referencePrice?: number | null;
  className?: string;
}

interface BookLevel {
  side: "bid" | "ask";
  price: number;
}

const LEVELS_PER_SIDE = 5;

function getPriceDecimals(price: number): number {
  if (price < 0.01) return 8;
  if (price < 1) return 5;
  return 2;
}

export default function PrivateOrderbook({
  pair,
  referencePrice,
  className = "",
}: PrivateOrderbookProps) {
  const activePair = pair ?? TRADING_PAIRS[0];
  const centerPrice =
    typeof referencePrice === "number" && Number.isFinite(referencePrice) && referencePrice > 0
      ? referencePrice
      : activePair.mockPrice;

  const { asks, bids, decimals } = useMemo(() => {
    const decimalsLocal = getPriceDecimals(centerPrice);
    const step = centerPrice * 0.0008; // 8 bps level step

    const askLevels: BookLevel[] = Array.from({ length: LEVELS_PER_SIDE }, (_, i) => ({
      side: "ask",
      price: centerPrice + step * (i + 1),
    }));

    const bidLevels: BookLevel[] = Array.from({ length: LEVELS_PER_SIDE }, (_, i) => ({
      side: "bid",
      price: Math.max(0, centerPrice - step * (i + 1)),
    }));

    return {
      asks: askLevels.reverse(),
      bids: bidLevels,
      decimals: decimalsLocal,
    };
  }, [activePair.label, centerPrice]);

  const bestAsk = asks[asks.length - 1]?.price ?? centerPrice;
  const bestBid = bids[0]?.price ?? centerPrice;
  const spreadPercent =
    centerPrice > 0 ? Math.max(0, ((bestAsk - bestBid) / centerPrice) * 100) : 0;

  return (
    <div
      className={`position-card flex h-full min-h-0 flex-1 flex-col rounded-xl border border-accent-purple/20 bg-[#080d1c]/90 p-3 ${className}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Orderbook</h3>
        <span className="text-[10px] uppercase tracking-[0.14em] text-gray-500">
          {activePair.label}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto] border-b border-shadow-600 px-1 pb-1.5 text-[11px] uppercase tracking-[0.1em] text-gray-500">
        <span>Price</span>
        <span>Size</span>
      </div>

      <div className="mt-1.5 grid min-h-0 flex-1 grid-rows-[1fr_auto_1fr] gap-1">
        <div className="min-h-0 space-y-0.5 overflow-hidden">
          {asks.map((level, index) => (
            <BookRow key={`ask-${index}`} side={level.side} />
          ))}
        </div>

        <div className="border-y border-shadow-600 px-1 py-1.5">
          <div className="flex items-center justify-center gap-3 text-sm">
            <span className="font-semibold text-accent-purple">
              ${centerPrice.toFixed(decimals)}
            </span>
            <span className="text-gray-500">Spread {spreadPercent.toFixed(2)}%</span>
          </div>
        </div>

        <div className="min-h-0 space-y-0.5 overflow-hidden">
          {bids.map((level, index) => (
            <BookRow key={`bid-${index}`} side={level.side} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BookRow({ side }: { side: BookLevel["side"] }) {
  const isBid = side === "bid";

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2 px-1 py-0 text-xs">
      <span
        aria-hidden
        className={`inline-block h-2 rounded ${isBid ? "w-16 bg-accent-green/35" : "w-16 bg-accent-red/35"}`}
      />
      <span aria-hidden className="inline-block h-2 w-12 rounded bg-shadow-500/70" />
    </div>
  );
}
