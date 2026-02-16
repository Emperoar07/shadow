import { useEffect, useRef, useState, useCallback, memo } from "react";
import { TRADING_PAIRS, TradingPair } from "../lib/tokens";

// Verified TradingView symbol mappings (PYTH and BINANCE feeds are most reliable)
const TV_SYMBOLS: Record<string, string> = {
  "SOL-PERP": "PYTH:SOLUSD",
  "BONK-PERP": "BYBIT:BONKUSDT",
  "WIF-PERP": "BYBIT:WIFUSDT",
  "JUP-PERP": "BYBIT:JUPUSDT",
  "BTC-PERP": "PYTH:BTCUSD",
  "ETH-PERP": "PYTH:ETHUSD",
  "PYTH-PERP": "BYBIT:PYTHUSDT",
  "RAY-PERP": "BYBIT:RAYUSDT",
  "ORCA-PERP": "BYBIT:ORCAUSDT",
  "W-PERP": "BYBIT:WUSDT",
  "JTO-PERP": "BYBIT:JTOUSDT",
  "RENDER-PERP": "BINANCE:RENDERUSDT",
  "HNT-PERP": "BINANCE:HNTUSDT",
};

// Preload the TradingView script into browser cache on module load
if (typeof window !== "undefined") {
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "script";
  link.href = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  document.head.appendChild(link);
}

interface PriceChartProps {
  selectedPair?: TradingPair;
  onPairChange?: (pair: TradingPair) => void;
}

const PairButton = memo(function PairButton({
  pair,
  isActive,
  onClick,
}: {
  pair: TradingPair;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
        isActive
          ? "bg-shadow-600 text-white border border-shadow-400"
          : "text-gray-500 hover:text-gray-300 hover:bg-shadow-700"
      }`}
    >
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: pair.base.color }}
      />
      {pair.label}
    </button>
  );
});

export default function PriceChart({ selectedPair, onPairChange }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activePair, setActivePair] = useState<TradingPair>(selectedPair ?? TRADING_PAIRS[0]);
  const [isLoading, setIsLoading] = useState(true);
  const pendingSymbolRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync with parent
  useEffect(() => {
    if (selectedPair) setActivePair(selectedPair);
  }, [selectedPair]);

  const handlePairChange = useCallback(
    (pair: TradingPair) => {
      setActivePair(pair);
      onPairChange?.(pair);
    },
    [onPairChange]
  );

  const tvSymbol = TV_SYMBOLS[activePair.label] ?? "PYTH:SOLUSD";

  // Debounced widget injection - avoids rapid destroy/create cycles when clicking through pairs
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    // If the symbol we want is already rendering, skip
    if (pendingSymbolRef.current === tvSymbol) return;
    pendingSymbolRef.current = tvSymbol;

    // Clear any pending debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);

    setIsLoading(true);

    debounceRef.current = setTimeout(() => {
      // Double-check this is still the symbol we want
      if (pendingSymbolRef.current !== tvSymbol) return;

      container.innerHTML = "";

      const widgetDiv = document.createElement("div");
      widgetDiv.className = "tradingview-widget-container__widget";
      widgetDiv.style.height = "100%";
      widgetDiv.style.width = "100%";
      container.appendChild(widgetDiv);

      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
      script.type = "text/javascript";
      script.async = true;
      script.innerHTML = JSON.stringify({
        autosize: true,
        symbol: tvSymbol,
        interval: "60",
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "en",
        allow_symbol_change: false,
        backgroundColor: "rgba(13, 13, 20, 1)",
        gridColor: "rgba(139, 92, 246, 0.04)",
        hide_top_toolbar: false,
        hide_legend: false,
        save_image: false,
        calendar: false,
        hide_volume: false,
        support_host: "https://www.tradingview.com",
        studies: [],
        withdateranges: true,
        details: false,
        hotlist: false,
        show_popup_button: false,
      });

      script.onload = () => setIsLoading(false);
      // Fallback - widget renders inside an iframe; give it a reasonable window
      setTimeout(() => setIsLoading(false), 3000);

      container.appendChild(script);
    }, 150); // 150ms debounce

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [tvSymbol]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (containerRef.current) containerRef.current.innerHTML = "";
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="position-card rounded-xl overflow-hidden">
      {/* Custom header bar with pair selector + privacy badge */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-shadow-600">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-shadow-500 pr-4">
          {TRADING_PAIRS.map((pair) => (
            <PairButton
              key={pair.label}
              pair={pair}
              isActive={activePair.label === pair.label}
              onClick={() => handlePairChange(pair)}
            />
          ))}
        </div>

        {/* Privacy badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent-purple/15 border border-accent-purple/30 flex-shrink-0">
          <svg className="w-3 h-3 text-accent-purple" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-xs text-accent-purple">Positions Encrypted</span>
        </div>
      </div>

      {/* TradingView widget */}
      <div className="relative">
        {/* Loading skeleton */}
        {isLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-shadow-800">
            <div className="flex flex-col items-center gap-3">
              <svg className="animate-spin h-8 w-8 text-accent-purple" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-sm text-gray-400">Loading {activePair.label} chart...</span>
            </div>
          </div>
        )}

        <div ref={containerRef} className="w-full h-[500px]" />

        {/* Privacy overlay at bottom */}
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-shadow-800/90 backdrop-blur-sm border border-accent-purple/20">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-purple animate-pulse" />
          <span className="text-xs text-gray-400">
            Price is public - your positions are <span className="text-accent-purple font-medium">MPC encrypted</span> via Arcium
          </span>
        </div>
      </div>
    </div>
  );
}

