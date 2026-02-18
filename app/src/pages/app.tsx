import { useState } from "react";
import dynamic from "next/dynamic";
import Head from "next/head";
import Link from "next/link";
import TradingPanel from "../components/TradingPanel";
import MarketInfo from "../components/MarketInfo";
import PrivacyBadge from "../components/PrivacyBadge";
import NetworkIndicator from "../components/NetworkIndicator";
import PortfolioSummary from "../components/PortfolioSummary";
import BottomPositionsPanel from "../components/BottomPositionsPanel";
import { TRADING_PAIRS, TradingPair } from "../lib/tokens";
import NeuralShadowBackground from "../components/NeuralShadowBackground";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false }
);
const PriceChart = dynamic(() => import("../components/PriceChart"), { ssr: false });

export default function TradingAppPage() {
  const [selectedPair, setSelectedPair] = useState<TradingPair>(TRADING_PAIRS[0]);

  return (
    <>
      <Head>
        <title>ShadowPerp — Private Perpetuals on Solana</title>
        <meta
          name="description"
          content="ShadowPerp private perpetual futures trading terminal powered by Arcium MPC."
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
          {/* ── Header ── */}
          <header className="border-b border-shadow-600 shrink-0">
            <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  className="flex items-center gap-2 text-xl font-bold bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-transparent"
                >
                  <ShadowLogo className="h-7 w-7 shrink-0 header-logo-animate" />
                  ShadowPerp
                </Link>
                <PrivacyBadge />
                <NetworkIndicator />
              </div>

              <WalletMultiButton />
            </div>
          </header>

          {/* ── Main terminal ── */}
          <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 py-3 flex flex-col gap-3">
            {/* Portfolio summary strip */}
            <PortfolioSummary />

            {/* Terminal grid: chart (flex-grow) | right column (fixed 360px) */}
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-[1fr_360px]">
              {/* Left – price chart */}
              <div className="min-w-0">
                <PriceChart selectedPair={selectedPair} onPairChange={setSelectedPair} />
              </div>

              {/* Right – market info + order form stacked */}
              <div className="flex flex-col gap-3">
                <MarketInfo pair={selectedPair} />
                <TradingPanel pair={selectedPair} />
              </div>
            </div>

            {/* Bottom – positions panel (always visible, Hyperliquid-style) */}
            <BottomPositionsPanel />
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
                · Built on Solana
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
