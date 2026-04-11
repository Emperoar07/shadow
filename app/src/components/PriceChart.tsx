import { useEffect, useMemo, useRef, useState } from "react";
import type { TradingPair } from "../lib/tokens";

interface PriceChartProps {
  selectedPair: TradingPair;
  chartSymbol: string;
}

// Shadow colour palette exposed to the TradingView widget.
// Dark values mirror tailwind.config.js shadow-*/accent-* tokens.
const DARK_COLORS = {
  // Backgrounds
  paneBackground: "#0a0a0f",
  backgroundColor: "#0a0a0f",
  // Grid / axes
  gridColor: "#1a1a25",
  vertLineColor: "#252530",
  horzLineColor: "#252530",
  // Candles
  upColor: "#00e676",
  downColor: "#ff1744",
  borderUpColor: "#00e676",
  borderDownColor: "#ff1744",
  wickUpColor: "#00e676",
  wickDownColor: "#ff1744",
  // Text / axes labels
  textColor: "#9ca3af",
  scalesLineColor: "#252530",
  // Crosshair
  crosshairColor: "#8b5cf6",
  // Toolbar / top bar
  toolbarBg: "#12121a",
};

const LIGHT_COLORS = {
  paneBackground: "#f7f9fc",
  backgroundColor: "#f7f9fc",
  gridColor: "#e8ebf4",
  vertLineColor: "#d8dce8",
  horzLineColor: "#d8dce8",
  upColor: "#00b248",
  downColor: "#d50000",
  borderUpColor: "#00b248",
  borderDownColor: "#d50000",
  wickUpColor: "#00b248",
  wickDownColor: "#d50000",
  textColor: "#374151",
  scalesLineColor: "#d8dce8",
  crosshairColor: "#8b5cf6",
  toolbarBg: "#f1f4fa",
};

export default function PriceChart({ selectedPair, chartSymbol }: PriceChartProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [showSoftLoading, setShowSoftLoading] = useState(false);
  const [tvTheme, setTvTheme] = useState<"dark" | "light">("dark");
  const [isMobile, setIsMobile] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  // Track theme from <html class="light">
  useEffect(() => {
    const readTheme = (): "dark" | "light" =>
      document.documentElement.classList.contains("light") ? "light" : "dark";
    setTvTheme(readTheme());
    const observer = new MutationObserver(() => setTvTheme(readTheme()));
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sync = () => setIsMobile(window.innerWidth < 640);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // Soft loading indicator after 4.5 s
  useEffect(() => {
    if (!isLoading) { setShowSoftLoading(false); return; }
    const t = window.setTimeout(() => setShowSoftLoading(true), 4500);
    return () => window.clearTimeout(t);
  }, [isLoading, chartSymbol]);

  // Build & inject the TradingView Advanced Chart widget script
  useEffect(() => {
    if (!containerRef.current) return;

    // Remove previous widget
    if (scriptRef.current) { scriptRef.current.remove(); scriptRef.current = null; }
    if (widgetRef.current) { try { widgetRef.current.remove(); } catch { /* noop */ } widgetRef.current = null; }
    containerRef.current.innerHTML = "";

    setIsLoading(true);
    setShowSoftLoading(false);

    const colors = tvTheme === "light" ? LIGHT_COLORS : DARK_COLORS;

    const config = {
      autosize: true,
      symbol: chartSymbol,
      interval: isMobile ? "1" : "15",
      timezone: "Etc/UTC",
      theme: tvTheme,
      style: "1", // candlestick
      locale: "en",
      toolbar_bg: colors.toolbarBg,
      enable_publishing: false,
      allow_symbol_change: false,
      save_image: false,
      hide_top_toolbar: isMobile,
      hide_side_toolbar: isMobile,
      withdateranges: !isMobile,
      // Custom palette overrides — supported by Advanced Chart widget
      overrides: {
        "paneProperties.background": colors.paneBackground,
        "paneProperties.backgroundType": "solid",
        "paneProperties.vertGridProperties.color": colors.gridColor,
        "paneProperties.horzGridProperties.color": colors.gridColor,
        "paneProperties.crossHairProperties.color": colors.crosshairColor,
        "scalesProperties.textColor": colors.textColor,
        "scalesProperties.lineColor": colors.scalesLineColor,
        // Candle colours
        "mainSeriesProperties.candleStyle.upColor": colors.upColor,
        "mainSeriesProperties.candleStyle.downColor": colors.downColor,
        "mainSeriesProperties.candleStyle.borderUpColor": colors.borderUpColor,
        "mainSeriesProperties.candleStyle.borderDownColor": colors.borderDownColor,
        "mainSeriesProperties.candleStyle.wickUpColor": colors.wickUpColor,
        "mainSeriesProperties.candleStyle.wickDownColor": colors.wickDownColor,
        "mainSeriesProperties.candleStyle.drawWick": true,
        "mainSeriesProperties.candleStyle.drawBorder": true,
        // Bar chart (fallback style)
        "mainSeriesProperties.barStyle.upColor": colors.upColor,
        "mainSeriesProperties.barStyle.downColor": colors.downColor,
      },
    };

    const div = document.createElement("div");
    div.className = "tradingview-widget-container";
    div.style.cssText = "width:100%;height:100%;";
    containerRef.current.appendChild(div);

    const innerDiv = document.createElement("div");
    innerDiv.id = `tv_chart_${Date.now()}`;
    innerDiv.style.cssText = "width:100%;height:100%;";
    div.appendChild(innerDiv);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => {
      if (!(window as any).TradingView) return;
      try {
        widgetRef.current = new (window as any).TradingView.widget({
          ...config,
          container_id: innerDiv.id,
        });
        widgetRef.current.onChartReady?.(() => setIsLoading(false));
        // Fallback: mark loaded after 8 s even if callback doesn't fire
        setTimeout(() => setIsLoading(false), 8000);
      } catch {
        setIsLoading(false);
      }
    };
    script.onerror = () => setIsLoading(false);
    document.head.appendChild(script);
    scriptRef.current = script;

    return () => {
      if (scriptRef.current) { scriptRef.current.remove(); scriptRef.current = null; }
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartSymbol, tvTheme, isMobile]);

  return (
    <div className="trade-price-chart flex flex-col h-full min-h-0">
      <div className="relative flex-1 min-h-0">
        {isLoading && !showSoftLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-shadow-800">
            <svg className="animate-spin h-8 w-8 text-accent-purple" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
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

        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
