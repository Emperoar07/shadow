import { useEffect, useMemo, useState } from "react";
import type { TradingPair } from "../lib/tokens";

interface PriceChartProps {
  selectedPair: TradingPair;
  chartSymbol: string;
}

export default function PriceChart({
  selectedPair,
  chartSymbol,
}: PriceChartProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [showSoftLoading, setShowSoftLoading] = useState(false);
  const [tvTheme, setTvTheme] = useState<"dark" | "light">("dark");
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const readTheme = () =>
      document.documentElement.classList.contains("light") ? "light" : "dark";
    setTvTheme(readTheme());
    const observer = new MutationObserver(() => setTvTheme(readTheme()));
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setShowSoftLoading(false);
  }, [chartSymbol]);

  useEffect(() => {
    if (!isLoading) {
      setShowSoftLoading(false);
      return;
    }
    const softTimer = window.setTimeout(() => {
      setShowSoftLoading(true);
    }, 4500);
    return () => {
      window.clearTimeout(softTimer);
    };
  }, [isLoading, chartSymbol]);

  useEffect(() => {
    const syncViewport = () => setIsMobile(window.innerWidth < 640);
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams({
      symbol: chartSymbol,
      interval: isMobile ? "1" : "15",
      theme: tvTheme,
      style: "1",
      toolbarbg: tvTheme === "light" ? "#f8f9fc" : "#0a0f1f",
      timezone: "Etc/UTC",
      withdateranges: isMobile ? "0" : "1",
      allow_symbol_change: "0",
      hide_top_toolbar: isMobile ? "1" : "0",
      hide_side_toolbar: isMobile ? "1" : "0",
      saveimage: "0",
    });
    return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
  }, [chartSymbol, tvTheme, isMobile]);

  return (
    <div className="trade-price-chart flex flex-col h-full min-h-0">
      <div className="relative flex-1 min-h-0">
        {isLoading && !showSoftLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-shadow-800">
            <div className="flex items-center justify-center">
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
            </div>
          </div>
        )}

        {isLoading && showSoftLoading && (
          <div className={`absolute z-20 ${isMobile ? "left-3 right-3 top-3" : "right-3 top-3"}`}>
            <div className="inline-flex items-center gap-2 rounded-full border border-shadow-500/80 bg-shadow-900/90 px-3 py-1.5 text-[11px] font-medium text-gray-300 backdrop-blur-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-accent-purple animate-pulse" />
              Syncing live chart...
            </div>
          </div>
        )}

        <iframe
          key={chartSymbol}
          src={iframeSrc}
          className="w-full h-full"
          frameBorder="0"
          allowFullScreen
          title={`${selectedPair.label} chart`}
          onLoad={() => setIsLoading(false)}
        />
      </div>
    </div>
  );
}
