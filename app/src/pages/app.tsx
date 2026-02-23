import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Head from "next/head";
import Link from "next/link";
import TradingPanel from "../components/TradingPanel";
import MarketInfo from "../components/MarketInfo";
import PrivateOrderbook from "../components/PrivateOrderbook";
import PrivacyBadge from "../components/PrivacyBadge";
import NetworkIndicator from "../components/NetworkIndicator";
import V2Panel from "../components/ui-v2/V2Panel";
import V2SectionMotion from "../components/ui-v2/V2SectionMotion";
import { TRADING_PAIRS, TradingPair } from "../lib/tokens";

const NeuralShadowBackground = dynamic(
  () => import("../components/NeuralShadowBackground"),
  { ssr: false }
);
const PortfolioSummary = dynamic(() => import("../components/PortfolioSummary"), {
  ssr: false,
});
const BottomPositionsPanel = dynamic(
  () => import("../components/BottomPositionsPanel"),
  { ssr: false }
);

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton
    ),
  { ssr: false }
);
const PriceChart = dynamic(() => import("../components/PriceChart"), {
  ssr: false,
});

const TOP_RIGHT_INFO_PANEL_HEIGHT = 315;
const BOTTOM_RIGHT_ORDERBOOK_PANEL_HEIGHT = 315;

export default function TradingAppPage() {
  const [selectedPair, setSelectedPair] = useState<TradingPair>(TRADING_PAIRS[0]);
  const [displayPrice, setDisplayPrice] = useState<number | null>(null);
  const [displayChange24h, setDisplayChange24h] = useState<number | null>(null);
  const [chartPanelHeight, setChartPanelHeight] = useState<number | null>(null);
  const chartPanelRef = useRef<HTMLDivElement | null>(null);
  const uiV2Enabled =
    process.env.NEXT_PUBLIC_UI_V2 === "1" ||
    process.env.NEXT_PUBLIC_SAFE_UI_ADAPT === "1";

  const handlePairChange = useCallback((pair: TradingPair) => {
    setSelectedPair(pair);
    setDisplayPrice(null);
    setDisplayChange24h(null);
  }, []);

  const handlePriceUpdate = useCallback(
    (update: { pairLabel: string; price: number; change24h: number | null }) => {
      if (update.pairLabel !== selectedPair.label) return;
      setDisplayPrice(update.price);
      setDisplayChange24h(update.change24h);
    },
    [selectedPair.label]
  );

  const rightRailRowsStyle = {
    gridTemplateRows: `${TOP_RIGHT_INFO_PANEL_HEIGHT}px ${BOTTOM_RIGHT_ORDERBOOK_PANEL_HEIGHT}px`,
  };

  useEffect(() => {
    const target = chartPanelRef.current;
    if (!target || typeof ResizeObserver === "undefined") return;

    const applyHeight = (height: number) => {
      if (!Number.isFinite(height) || height <= 0) return;
      setChartPanelHeight(Math.round(height));
    };

    applyHeight(target.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        applyHeight(entry.contentRect.height);
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [selectedPair.label]);

  return (
    <>
      <Head>
        <title>Shadow - Private Perpetuals on Solana</title>
        <meta
          name="description"
          content="Shadow private perpetual futures trading terminal powered by Arcium MPC."
        />
      </Head>

      <div className="relative min-h-screen gradient-bg overflow-hidden">
        <style jsx>{`
          @keyframes header-logo-glow {
            0%,
            100% {
              filter: drop-shadow(0 0 10px rgba(109, 82, 255, 0.32));
            }
            50% {
              filter: drop-shadow(0 0 18px rgba(56, 189, 248, 0.3));
            }
          }
          .header-logo-animate {
            animation: header-logo-glow 4s infinite ease-in-out;
          }
        `}</style>
        <NeuralShadowBackground />

        <div className="relative z-10 flex flex-col min-h-screen">
          {/* Header */}
          <header className="border-b border-shadow-600 shrink-0">
            <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  className="flex items-center gap-2 text-xl font-bold bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-transparent"
                >
                  <ShadowLogo className="h-7 w-7 shrink-0 header-logo-animate" />
                  Shadow
                </Link>
                <PrivacyBadge />
              </div>

              <div className="flex items-center gap-2">
                <NetworkIndicator />
                <WalletMultiButton />
              </div>
            </div>
          </header>

          {/* Main terminal */}
          <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 py-3 flex flex-col gap-3">
            <V2SectionMotion enabled={uiV2Enabled} delay={0.02}>
              <PortfolioSummary />
            </V2SectionMotion>

            {/* Top row: chart + market info */}
            <V2SectionMotion
              enabled={uiV2Enabled}
              delay={0.07}
              className="grid gap-3 grid-cols-1 lg:grid-cols-[1fr_340px]"
            >
              <div ref={chartPanelRef} className="min-w-0">
                <V2Panel enabled={uiV2Enabled} className="min-w-0">
                  <PriceChart
                    selectedPair={selectedPair}
                    onPairChange={handlePairChange}
                    displayPrice={displayPrice}
                    displayChange24h={displayChange24h}
                  />
                </V2Panel>
              </div>
              <div
                className="min-h-0"
                style={chartPanelHeight ? { height: `${chartPanelHeight}px` } : undefined}
              >
                <V2Panel
                  enabled={uiV2Enabled}
                  className="h-full min-h-0 overflow-hidden"
                >
                  <div
                    className="flex h-full min-h-0 flex-col gap-2 lg:grid lg:gap-0"
                    style={rightRailRowsStyle}
                  >
                    <MarketInfo
                      pair={selectedPair}
                      className="h-full min-h-0 shrink-0 overflow-hidden"
                      onPriceUpdate={handlePriceUpdate}
                    />
                    <PrivateOrderbook
                      pair={selectedPair}
                      referencePrice={displayPrice}
                      className="h-full min-h-0 overflow-hidden"
                    />
                  </div>
                </V2Panel>
              </div>
            </V2SectionMotion>

            {/* Open position panel under chart */}
            <V2SectionMotion
              enabled={uiV2Enabled}
              delay={0.12}
            >
              <V2Panel enabled={uiV2Enabled}>
                <TradingPanel pair={selectedPair} layout="horizontal" />
              </V2Panel>
            </V2SectionMotion>

            <V2SectionMotion
              enabled={uiV2Enabled}
              delay={0.16}
            >
              <V2Panel enabled={uiV2Enabled} className="p-1.5">
                <BottomPositionsPanel />
              </V2Panel>
            </V2SectionMotion>
          </main>

          {/* Footer */}
          <footer className="border-t border-shadow-600 shrink-0">
            <div className="max-w-[1600px] mx-auto px-4 py-4 flex items-center justify-between text-xs text-gray-500">
              <p>
                Powered by{" "}
                <a
                  href="https://arcium.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-purple hover:underline"
                >
                  Arcium MPC
                </a>{" "}
                | Built on Solana
              </p>
              <p>Your trades are encrypted end-to-end. Only PnL is ever revealed.</p>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

function ShadowLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="trade-shadow-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#8b5cf6", stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: "#3b82f6", stopOpacity: 1 }} />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="40" fill="url(#trade-shadow-logo-grad)" />
      <circle cx="62" cy="38" r="41" fill="#05081a" />
    </svg>
  );
}
