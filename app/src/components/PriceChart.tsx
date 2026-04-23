import { useEffect, useRef, useState } from "react";
import type { TradingPair } from "../lib/tokens";
import ShadowLoader from "./ShadowLoader";

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
  // Axes
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

const TV_SCRIPT_SRC = "https://s3.tradingview.com/tv.js";
const TV_SCRIPT_ID = "__tv_js__";

/**
 * Ensures tv.js is injected exactly once across the lifetime of the page.
 * Returns a promise that resolves when window.TradingView is available.
 * Safe to call multiple times — subsequent calls share the same promise.
 */
let tvReadyPromise: Promise<void> | null = null;

function ensureTvScript(): Promise<void> {
  if (tvReadyPromise) return tvReadyPromise;

  tvReadyPromise = new Promise((resolve, reject) => {
    // Already loaded (e.g. preload hit)
    if ((window as any).TradingView) { resolve(); return; }

    // Already injected but still loading
    const existing = document.getElementById(TV_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("tv.js failed to load")));
      return;
    }

    const script = document.createElement("script");
    script.id = TV_SCRIPT_ID;
    script.src = TV_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("tv.js failed to load"));
    document.head.appendChild(script);
  });

  return tvReadyPromise;
}

export default function PriceChart({ selectedPair, chartSymbol }: PriceChartProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [showSoftLoading, setShowSoftLoading] = useState(false);
  // true only on first mount or full widget rebuild (theme/mobile change)
  const [isHardLoading, setIsHardLoading] = useState(true);
  const [tvTheme, setTvTheme] = useState<"dark" | "light">("dark");
  const [isMobile, setIsMobile] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  // Tracks the symbol the current widget was built with so we know when to
  // do a fast in-place swap vs a full rebuild.
  const builtSymbolRef = useRef<string>("");
  // Tracks theme+mobile used for the current widget — changes here need a rebuild.
  const builtThemeRef = useRef<string>("");
  const builtMobileRef = useRef<boolean | null>(null);

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

  // Main widget effect — handles both full rebuild and fast in-place symbol swap
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    const themeChanged = builtThemeRef.current !== tvTheme;
    const mobileChanged = builtMobileRef.current !== isMobile;
    const symbolChanged = builtSymbolRef.current !== chartSymbol;

    // Fast path: widget is alive, only the symbol changed — swap in-place.
    if (
      widgetRef.current &&
      !themeChanged &&
      !mobileChanged &&
      symbolChanged
    ) {
      try {
        widgetRef.current.onChartReady?.(() => {
          if (cancelled) return;
          widgetRef.current.chart().setSymbol(chartSymbol, () => {
            if (!cancelled) {
              builtSymbolRef.current = chartSymbol;
              setIsLoading(false);
              setShowSoftLoading(false);
            }
          });
        });
        setIsLoading(true);
        setShowSoftLoading(false);
        // Fallback: clear loader after 4s if setSymbol callback never fires
        const t = setTimeout(() => {
          if (!cancelled) {
            builtSymbolRef.current = chartSymbol;
            setIsLoading(false);
          }
        }, 4000);
        return () => { cancelled = true; clearTimeout(t); };
      } catch {
        // setSymbol failed — fall through to full rebuild below
      }
    }

    // Full rebuild path: theme, mobile breakpoint changed, or first mount.
    // Tear down existing widget but leave the DOM node intact.
    if (widgetRef.current) {
      try { widgetRef.current.remove(); } catch { /* noop */ }
      widgetRef.current = null;
    }
    if (containerRef.current) containerRef.current.innerHTML = "";
    builtSymbolRef.current = "";
    builtThemeRef.current = "";
    builtMobileRef.current = null;

    setIsLoading(true);
    setIsHardLoading(true);
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
      overrides: {
        "paneProperties.background": colors.paneBackground,
        "paneProperties.backgroundType": "solid",
        "paneProperties.vertGridProperties.color": colors.paneBackground,
        "paneProperties.vertGridProperties.style": 0,
        "paneProperties.horzGridProperties.color": colors.paneBackground,
        "paneProperties.horzGridProperties.style": 0,
        "paneProperties.crossHairProperties.color": colors.crosshairColor,
        "scalesProperties.textColor": colors.textColor,
        "scalesProperties.lineColor": colors.scalesLineColor,
        "mainSeriesProperties.candleStyle.upColor": colors.upColor,
        "mainSeriesProperties.candleStyle.downColor": colors.downColor,
        "mainSeriesProperties.candleStyle.borderUpColor": colors.borderUpColor,
        "mainSeriesProperties.candleStyle.borderDownColor": colors.borderDownColor,
        "mainSeriesProperties.candleStyle.wickUpColor": colors.wickUpColor,
        "mainSeriesProperties.candleStyle.wickDownColor": colors.wickDownColor,
        "mainSeriesProperties.candleStyle.drawWick": true,
        "mainSeriesProperties.candleStyle.drawBorder": true,
        "mainSeriesProperties.barStyle.upColor": colors.upColor,
        "mainSeriesProperties.barStyle.downColor": colors.downColor,
      },
      studies_overrides: {
        "volume.volume.color.0": colors.downColor,
        "volume.volume.color.1": colors.upColor,
        "volume.volume ma.color": colors.crosshairColor,
        "volume.volume ma.visible": false,
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

    // Use the cached script promise — won't re-inject tv.js if already loaded.
    const fallbackTimer = setTimeout(() => {
      if (!cancelled) { setIsLoading(false); setIsHardLoading(false); }
    }, 6000);

    ensureTvScript()
      .then(() => {
        if (cancelled || !(window as any).TradingView) return;
        try {
          const widget = new (window as any).TradingView.widget({
            ...config,
            container_id: innerDiv.id,
          });
          widgetRef.current = widget;
          widget.onChartReady?.(() => {
            if (!cancelled) {
              builtSymbolRef.current = chartSymbol;
              builtThemeRef.current = tvTheme;
              builtMobileRef.current = isMobile;
              clearTimeout(fallbackTimer);
              setIsLoading(false);
              setIsHardLoading(false);
            }
          });
        } catch {
          if (!cancelled) setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
      // Don't destroy the widget on symbol-only re-renders (fast path handles it).
      // Only wipe the DOM if the component fully unmounts.
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartSymbol, tvTheme, isMobile]);

  // Clean up widget on component unmount
  useEffect(() => {
    return () => {
      if (widgetRef.current) {
        try { widgetRef.current.remove(); } catch { /* noop */ }
        widgetRef.current = null;
      }
    };
  }, []);

  return (
    <div className="trade-price-chart flex flex-col h-full min-h-0">
      <div className="relative flex-1 min-h-0">
        {isHardLoading && !showSoftLoading && (
          <div className="absolute inset-0 z-20 bg-shadow-900">
            <ShadowLoader message="Loading chart..." />
          </div>
        )}

        {isHardLoading && showSoftLoading && (
          <div className="absolute inset-0 z-20 bg-shadow-900">
            <ShadowLoader message="Syncing live chart..." />
          </div>
        )}

        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
