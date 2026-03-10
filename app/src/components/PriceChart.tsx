import { useCallback, useEffect, useMemo, useState } from "react";
import { TRADING_PAIRS, TradingPair } from "../lib/tokens";
import { getMarketFeed } from "../lib/market-feeds";

interface PriceChartProps {
  selectedPair?: TradingPair;
  onPairChange?: (pair: TradingPair) => void;
  displayPrice?: number | null;
  displayChange24h?: number | null;
}

export default function PriceChart({
  selectedPair,
  onPairChange,
  displayPrice,
  displayChange24h,
}: PriceChartProps) {
  const [activePair, setActivePair] = useState<TradingPair>(selectedPair ?? TRADING_PAIRS[0]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedIndex, setFeedIndex] = useState(0);
  const [tvTheme, setTvTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const readTheme = () =>
      document.documentElement.classList.contains("light") ? "light" : "dark";
    setTvTheme(readTheme());
    const observer = new MutationObserver(() => setTvTheme(readTheme()));
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (selectedPair) setActivePair(selectedPair);
  }, [selectedPair]);

  const handlePairChange = useCallback(
    (pair: TradingPair) => {
      setActivePair(pair);
      setFeedIndex(0);
      onPairChange?.(pair);
    },
    [onPairChange]
  );

  const symbolCandidates = getMarketFeed(activePair).tvCandidates;
  const tvSymbol = symbolCandidates[feedIndex] ?? symbolCandidates[0];
  const canSwitchFeed = symbolCandidates.length > 1;

  useEffect(() => {
    if (!canSwitchFeed) return;
    const timeout = setTimeout(() => {
      if (isLoading) {
        setFeedIndex((prev) => (prev + 1) % symbolCandidates.length);
      }
    }, 8000);
    return () => clearTimeout(timeout);
  }, [tvSymbol, isLoading, canSwitchFeed, symbolCandidates.length]);

  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams({
      symbol: tvSymbol,
      interval: "15",
      theme: tvTheme,
      style: "1",
      toolbarbg: tvTheme === "light" ? "#f8f9fc" : "#0a0f1f",
      timezone: "Etc/UTC",
      withdateranges: "1",
      allow_symbol_change: "0",
      hide_side_toolbar: "0",
      saveimage: "0",
    });
    return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
  }, [tvSymbol, tvTheme]);

  return (
    <div className="trade-price-chart flex flex-col h-full min-h-0">
      {/* Chart — fills remaining height */}
      <div className="relative flex-1 min-h-0">
        {isLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-shadow-800">
            <div className="flex flex-col items-center gap-3">
              <svg className="animate-spin h-8 w-8 text-accent-purple" viewBox="0 0 24 24">
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
              <span className="text-sm text-gray-400">Loading {activePair.label} chart...</span>
            </div>
          </div>
        )}

        <iframe
          key={tvSymbol}
          src={iframeSrc}
          className="w-full h-full"
          frameBorder="0"
          allowFullScreen
          title={`${activePair.label} chart`}
          onLoad={() => setIsLoading(false)}
        />

      </div>
    </div>
  );
}

