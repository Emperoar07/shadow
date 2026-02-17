import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { TRADING_PAIRS, TradingPair } from "../lib/tokens";

// Use explicit TradingView symbol candidates so we can quickly fall back
// to another exchange feed for pairs that are intermittently unavailable.
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
  const [activePair, setActivePair] = useState<TradingPair>(selectedPair ?? TRADING_PAIRS[0]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedIndex, setFeedIndex] = useState(0);

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

  // Auto-advance to next feed if the current one doesn't render in time
  useEffect(() => {
    if (!canSwitchFeed) return;
    const timeout = setTimeout(() => {
      // If still loading after 8s, try next feed
      if (isLoading) {
        setFeedIndex((prev) => (prev + 1) % symbolCandidates.length);
      }
    }, 8000);
    return () => clearTimeout(timeout);
  }, [tvSymbol, isLoading, canSwitchFeed, symbolCandidates.length]);

  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams({
      symbol: tvSymbol,
      interval: "60",
      theme: "dark",
      style: "1",
      timezone: "Etc/UTC",
      withdateranges: "1",
      allow_symbol_change: "0",
      hide_side_toolbar: "0",
      saveimage: "0",
    });
    return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
  }, [tvSymbol]);

  return (
    <div className="position-card rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-shadow-600">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-shadow-500 pr-4">
          {TRADING_PAIRS.map((pair) => (
            <PairButton
              key={pair.label}
              pair={pair}
              isActive={activePair.label === pair.label}
              onClick={() => {
                setIsLoading(true);
                handlePairChange(pair);
              }}
            />
          ))}
        </div>

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

        {canSwitchFeed && (
          <button
            onClick={() => {
              setIsLoading(true);
              setFeedIndex((prev) => (prev + 1) % symbolCandidates.length);
            }}
            className="ml-2 px-2.5 py-1 text-xs rounded border border-shadow-500 text-gray-300 hover:text-white hover:border-shadow-400 transition-colors"
            title={`Switch data feed (${feedIndex + 1}/${symbolCandidates.length})`}
          >
            Feed {feedIndex + 1}/{symbolCandidates.length}
          </button>
        )}
      </div>

      <div className="relative">
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

        <iframe
          key={tvSymbol}
          src={iframeSrc}
          className="w-full h-[560px] xl:h-[640px]"
          frameBorder="0"
          allowFullScreen
          title={`${activePair.label} chart`}
          onLoad={() => setIsLoading(false)}
        />

        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-shadow-800/90 backdrop-blur-sm border border-accent-purple/20">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-purple animate-pulse" />
          <span className="text-xs text-gray-400">
            Price is public - your positions are <span className="text-accent-purple font-medium">MPC encrypted</span> via Arcium.
          </span>
        </div>
      </div>
    </div>
  );
}
