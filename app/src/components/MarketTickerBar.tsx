import { useCallback, useEffect, useState } from "react";
import { TRADING_PAIRS, TradingPair } from "../lib/tokens";
import { fetchPrices, PriceData } from "../lib/prices";

interface TickerItem {
  pair: TradingPair;
  price: number;
  change24h: number;
}

interface MarketTickerBarProps {
  activePair: TradingPair;
  onSelect: (pair: TradingPair) => void;
}

export default function MarketTickerBar({ activePair, onSelect }: MarketTickerBarProps) {
  const [tickers, setTickers] = useState<TickerItem[]>(() =>
    TRADING_PAIRS.map((pair) => ({
      pair,
      price: pair.mockPrice,
      change24h: pair.mockPriceChange,
    }))
  );

  const refresh = useCallback(async () => {
    const prices = await fetchPrices().catch(() => null);
    if (!prices) return;
    setTickers(
      TRADING_PAIRS.map((pair) => {
        const pd: PriceData | undefined = prices[pair.label];
        return {
          pair,
          price: pd?.price ?? pair.mockPrice,
          change24h: pd?.change24h ?? pair.mockPriceChange,
        };
      })
    );
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="border-b border-shadow-600 bg-shadow-900/60 backdrop-blur-sm overflow-hidden">
      <div
        className="flex items-center gap-0 overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: "none" }}
      >
        {tickers.map(({ pair, price, change24h }) => {
          const isActive = pair.label === activePair.label;
          const isUp = change24h >= 0;
          return (
            <button
              key={pair.label}
              onClick={() => onSelect(pair)}
              className={`flex items-center gap-2.5 px-4 py-2 border-r border-shadow-700 flex-shrink-0 transition-colors group ${
                isActive
                  ? "bg-accent-purple/10 border-b-2 border-b-accent-purple"
                  : "hover:bg-shadow-700/50"
              }`}
            >
              {/* Pair symbol */}
              <span
                className={`text-xs font-semibold whitespace-nowrap ${
                  isActive ? "text-accent-purple" : "text-gray-300 group-hover:text-white"
                }`}
              >
                {pair.base.symbol}
                <span className="text-gray-500 font-normal">-USD</span>
              </span>

              {/* Price */}
              <span className="text-xs font-medium text-white whitespace-nowrap">
                {price < 0.001
                  ? `$${price.toFixed(8)}`
                  : price < 1
                  ? `$${price.toFixed(4)}`
                  : `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              </span>

              {/* 24h change */}
              <span
                className={`text-[10px] font-medium whitespace-nowrap ${
                  isUp ? "text-accent-green" : "text-accent-red"
                }`}
              >
                {isUp ? "+" : ""}
                {change24h.toFixed(2)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
