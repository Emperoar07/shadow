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
  activePrice?: number | null;
  activeChange24h?: number | null;
}

export default function MarketTickerBar({
  activePair,
  onSelect,
  activePrice,
  activeChange24h,
}: MarketTickerBarProps) {
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

  const displayTickers = tickers.map((ticker) => {
    if (ticker.pair.label !== activePair.label) return ticker;
    const chartPrice =
      typeof activePrice === "number" && Number.isFinite(activePrice) && activePrice > 0
        ? activePrice
        : null;
    const chartChange =
      typeof activeChange24h === "number" && Number.isFinite(activeChange24h)
        ? activeChange24h
        : null;
    if (chartPrice === null && chartChange === null) return ticker;
    return {
      ...ticker,
      price: chartPrice ?? ticker.price,
      change24h: chartChange ?? ticker.change24h,
    };
  });

  const movers = displayTickers
    .filter(({ change24h }) => change24h > 0)
    .sort((a, b) => b.change24h - a.change24h)
    .slice(0, 5);
  const stripItems = movers.length > 0 ? [...movers, ...movers] : [];

  return (
    <div className="h-full min-h-[30px] overflow-hidden border-b border-shadow-600 bg-shadow-950/80 backdrop-blur-sm">
      <div className="flex h-full min-h-[30px] items-center gap-2 px-3 py-1">
        <div className="shrink-0 px-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
          Top movers
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          {stripItems.length > 0 ? (
            <div className="shadow-movers-strip flex w-max items-center gap-2">
              {stripItems.map(({ pair, price, change24h }, index) => {
          const isActive = pair.label === activePair.label;
          return (
            <button
              key={`${pair.label}-${index}`}
              onClick={() => onSelect(pair)}
              className={`flex items-center gap-2 rounded-full border px-2.5 py-1 transition-colors group ${
                isActive
                  ? "border-accent-purple/45 bg-accent-purple/15"
                  : "border-shadow-600/80 bg-shadow-800/60 hover:border-emerald-400/35 hover:bg-shadow-700/70"
              }`}
            >
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
                className="text-[10px] font-semibold whitespace-nowrap text-accent-green"
              >
                +
                {change24h.toFixed(2)}%
              </span>
            </button>
          );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-gray-500">No positive movers on the current feed yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
