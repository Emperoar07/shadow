import { useCallback, useEffect, useMemo, useState } from "react";
import { TRADING_PAIRS, TradingPair } from "../lib/tokens";

const TV_SYMBOL_CANDIDATES: Record<string, string[]> = {
  "SOL-PERP": ["BINANCE:SOLUSDT"],
  "BONK-PERP": ["BINANCE:1000BONKUSDT", "MEXC:BONKUSDT"],
  "WIF-PERP": ["BINANCE:WIFUSDT", "BYBIT:WIFUSDT"],
  "JUP-PERP": ["BYBIT:JUPUSDT", "MEXC:JUPUSDT"],
  "BTC-PERP": ["BINANCE:BTCUSDT"],
  "ETH-PERP": ["BINANCE:ETHUSDT"],
  "PYTH-PERP": ["BYBIT:PYTHUSDT", "MEXC:PYTHUSDT"],
  "RAY-PERP": ["BINANCE:RAYUSDT", "GATEIO:RAYUSDT"],
  "ORCA-PERP": ["CRYPTO:ORCAUSD", "MEXC:ORCAUSDT"],
  "W-PERP": ["BINANCE:WUSDT", "BYBIT:WUSDT"],
  "JTO-PERP": ["BYBIT:JTOUSDT", "MEXC:JTOUSDT"],
  "RENDER-PERP": ["BINANCE:RENDERUSDT"],
  "HNT-PERP": ["COINBASE:HNTUSD", "KRAKEN:HNTUSD", "MEXC:HNTUSDT"],
};

// TradingView interval values
const TIMEFRAMES = [
  { label: "1m", value: "1" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "1H", value: "60" },
  { label: "4H", value: "240" },
  { label: "1D", value: "D" },
] as const;

type TFValue = (typeof TIMEFRAMES)[number]["value"];

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
  const [interval, setInterval] = useState<TFValue>("60");
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

  const symbolCandidates =
    TV_SYMBOL_CANDIDATES[activePair.label] ?? [`BINANCE:${activePair.base.symbol}USDT`];
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

  // Reload chart when interval or theme changes
  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams({
      symbol: tvSymbol,
      interval,
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
  }, [tvSymbol, interval, tvTheme]);

  const handleIntervalChange = (val: TFValue) => {
    setIsLoading(true);
    setInterval(val);
  };

  return (
    <div className="trade-price-chart flex flex-col h-full min-h-0">
      {/* Timeframe bar */}
      <div className="trade-price-chart-toolbar flex items-center gap-2 px-4 py-2 border-b border-shadow-600 shrink-0">
        <div className="flex items-center gap-0.5 bg-shadow-700 rounded-lg p-0.5">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => handleIntervalChange(tf.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                interval === tf.value
                  ? "bg-accent-purple text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {canSwitchFeed && (
          <button
            onClick={() => {
              setIsLoading(true);
              setFeedIndex((prev) => (prev + 1) % symbolCandidates.length);
            }}
            className="ml-auto px-2.5 py-1 text-xs rounded border border-shadow-500 text-gray-400 hover:text-white hover:border-shadow-400 transition-colors"
            title={`Switch data feed (${feedIndex + 1}/${symbolCandidates.length})`}
          >
            Feed {feedIndex + 1}/{symbolCandidates.length}
          </button>
        )}
      </div>

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
          key={`${tvSymbol}-${interval}`}
          src={iframeSrc}
          className="w-full h-full"
          frameBorder="0"
          allowFullScreen
          title={`${activePair.label} chart`}
          onLoad={() => setIsLoading(false)}
        />

        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-shadow-800/90 backdrop-blur-sm border border-accent-purple/20">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-purple animate-pulse" />
          <span className="text-xs text-gray-400">
            Price is public | positions are{" "}
            <span className="text-accent-purple font-medium">MPC encrypted</span> via Arcium
          </span>
        </div>
      </div>
    </div>
  );
}

