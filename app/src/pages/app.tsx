import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import Head from "next/head";
import Link from "next/link";
import MarketInfo from "../components/MarketInfo";
import PrivateOrderbook from "../components/PrivateOrderbook";
import TradingPanel from "../components/TradingPanel";
import PrivacyBadge from "../components/PrivacyBadge";
import NetworkIndicator from "../components/NetworkIndicator";
import ThemeToggle from "../components/ThemeToggle";
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

export default function TradingAppPage() {
  const [selectedPair, setSelectedPair] = useState<TradingPair>(TRADING_PAIRS[0]);
  const [displayPrice, setDisplayPrice] = useState<number | null>(null);
  const [displayChange24h, setDisplayChange24h] = useState<number | null>(null);

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

  return (
    <>
      <Head>
        <title>Shadow - Private Perpetuals on Solana</title>
        <meta
          name="description"
          content="Shadow private perpetual futures trading terminal powered by Arcium MPC."
        />
      </Head>

      <div className="relative min-h-screen gradient-bg overflow-hidden trade-shell">
        <style jsx>{`
          @keyframes header-logo-glow {
            0%, 100% { filter: drop-shadow(0 0 10px rgba(109, 82, 255, 0.32)); }
            50%       { filter: drop-shadow(0 0 18px rgba(56, 189, 248, 0.3)); }
          }
          .header-logo-animate { animation: header-logo-glow 4s infinite ease-in-out; }
        `}</style>
        <NeuralShadowBackground />

        <div className="relative z-10 flex flex-col min-h-screen">

          {/* ── Header ── */}
          <header className="trade-header border-b border-shadow-600 shrink-0 bg-shadow-900">
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
                <ThemeToggle variant="header" />
                <WalletMultiButton />
              </div>
            </div>
          </header>

          {/* ── Terminal body ── */}
          <main className="trade-main flex-1 max-w-[1600px] w-full mx-auto flex flex-col min-h-0">

            {/* Market info bar: pair selector + stats + session chip */}
            <MarketInfo
              pair={selectedPair}
              onPairChange={handlePairChange}
              onPriceUpdate={handlePriceUpdate}
            />

            {/* Portfolio bar */}
            <div className="trade-portfolio-bar shrink-0 border-b border-shadow-600">
              <PortfolioSummary />
            </div>

            {/* Main grid — chart | orderbook | trading panel */}
            <div className="trade-terminal-grid flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px_360px] border-b border-shadow-600">

              {/* Chart */}
              <div className="min-w-0 min-h-0 lg:border-r lg:border-shadow-600">
                <PriceChart
                  selectedPair={selectedPair}
                  onPairChange={handlePairChange}
                  displayPrice={displayPrice}
                  displayChange24h={displayChange24h}
                />
              </div>

              {/* Orderbook — standalone column */}
              <div className="min-h-0 lg:border-r lg:border-shadow-600">
                <PrivateOrderbook
                  pair={selectedPair}
                  referencePrice={displayPrice}
                />
              </div>

              {/* Trading panel — standalone column */}
              <div className="min-h-0 overflow-y-auto">
                <TradingPanel pair={selectedPair} layout="vertical" />
              </div>

            </div>

            {/* Positions panel */}
            <div className="shrink-0">
              <BottomPositionsPanel />
            </div>

          </main>

          {/* ── Footer ── */}
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
