import { memo, useCallback, useEffect, useRef, useState } from "react";
import { TradingPair, TRADING_PAIRS } from "../lib/tokens";
import { fetchPrices, PriceData } from "../lib/prices";

interface PairSelectorProps {
  activePair: TradingPair;
  onSelect: (pair: TradingPair) => void;
  displayPrice?: number | null;
  displayChange24h?: number | null;
}

export default function PairSelector({
  activePair,
  onSelect,
  displayPrice,
  displayChange24h,
}: PairSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshPrices = useCallback(() => {
    fetchPrices().then(setPrices).catch(() => {});
  }, []);

  // Keep dropdown previews fresh enough without letting fallback prices override
  // the active chart-driven pair display.
  useEffect(() => {
    refreshPrices();
    const id = window.setInterval(refreshPrices, isOpen ? 10_000 : 30_000);
    return () => window.clearInterval(id);
  }, [isOpen, refreshPrices]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const filtered = search
    ? TRADING_PAIRS.filter(
        (p) =>
          p.label.toLowerCase().includes(search.toLowerCase()) ||
          p.base.symbol.toLowerCase().includes(search.toLowerCase())
      )
    : TRADING_PAIRS;

  const handleSelect = useCallback(
    (pair: TradingPair) => {
      onSelect(pair);
      setIsOpen(false);
      setSearch("");
    },
    [onSelect]
  );

  const activeLivePrice = prices[activePair.label];
  const activeDisplayPrice =
    typeof displayPrice === "number" && Number.isFinite(displayPrice) && displayPrice > 0
      ? displayPrice
      : activeLivePrice?.price;
  const activeDisplayChange =
    typeof displayChange24h === "number" && Number.isFinite(displayChange24h)
      ? displayChange24h
      : activeLivePrice?.change24h;

  return (
    <div className="relative z-[130]" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="pair-btn flex items-center gap-2 px-3 py-1.5 rounded-lg bg-shadow-600 border border-shadow-500 hover:border-shadow-400 transition-all btn-press"
      >
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: activePair.base.color }}
        />
        <span className="font-medium text-sm text-white">{activePair.label}</span>

        <svg
          className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 z-[140] rounded-xl border border-shadow-500 overflow-hidden pair-dropdown bg-shadow-800 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
          {/* Search */}
          <div className="p-2 border-b border-shadow-600">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pairs..."
              className="w-full bg-shadow-700 border border-shadow-500 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-purple transition-colors"
            />
          </div>

          {/* List */}
          <div className="max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-shadow-500 py-1">
            {filtered.length === 0 ? (
              <p className="text-center text-gray-500 text-sm py-4">No pairs found</p>
            ) : (
              filtered.map((pair) => {
                const isActive = pair.label === activePair.label;
                const activeChartPrice =
                  isActive &&
                  typeof displayPrice === "number" &&
                  Number.isFinite(displayPrice) &&
                  displayPrice > 0
                    ? displayPrice
                    : null;
                const activeChartChange =
                  isActive &&
                  typeof displayChange24h === "number" &&
                  Number.isFinite(displayChange24h)
                    ? displayChange24h
                    : null;
                const rowPrice =
                  activeChartPrice !== null
                    ? {
                        price: activeChartPrice,
                        change24h: activeChartChange ?? prices[pair.label]?.change24h ?? 0,
                      }
                    : prices[pair.label];

                return (
                  <PairRow
                    key={pair.label}
                    pair={pair}
                    price={rowPrice}
                    isActive={isActive}
                    onSelect={() => handleSelect(pair)}
                  />
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const PairRow = memo(function PairRow({
  pair,
  price,
  isActive,
  onSelect,
}: {
  pair: TradingPair;
  price?: PriceData;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-shadow-600/50 transition-colors ${
        isActive ? "bg-shadow-600/50" : ""
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: pair.base.color }}
        />
        <div>
          <span className="text-sm font-medium text-white">{pair.label}</span>
          <span className="text-xs text-gray-500 ml-2">{pair.base.symbol}/USDC</span>
        </div>
      </div>
      <div className="text-right">
        {price ? (
          <>
            <p className="text-sm text-gray-200">
              ${price.price < 0.01 ? price.price.toFixed(6) : price.price.toFixed(2)}
            </p>
            <p
              className={`text-xs ${
                price.change24h >= 0 ? "text-accent-green" : "text-accent-red"
              }`}
            >
              {price.change24h >= 0 ? "+" : ""}
              {price.change24h.toFixed(2)}%
            </p>
          </>
        ) : (
          <p className="text-xs text-gray-500">${pair.mockPrice.toFixed(2)}</p>
        )}
      </div>
    </button>
  );
});
