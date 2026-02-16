import { useState } from "react";
import dynamic from "next/dynamic";
import Head from "next/head";
import Link from "next/link";
import TradingPanel from "../components/TradingPanel";
import PositionsList from "../components/PositionsList";
import MarketInfo from "../components/MarketInfo";
import PrivacyBadge from "../components/PrivacyBadge";
import NetworkIndicator from "../components/NetworkIndicator";
import { TRADING_PAIRS, TradingPair } from "../lib/tokens";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false }
);
const PriceChart = dynamic(() => import("../components/PriceChart"), { ssr: false });

export default function TradingAppPage() {
  const [activeTab, setActiveTab] = useState<"trade" | "positions">("trade");
  const [selectedPair, setSelectedPair] = useState<TradingPair>(TRADING_PAIRS[0]);

  return (
    <>
      <Head>
        <title>ShadowPerp App - Trading Terminal</title>
        <meta
          name="description"
          content="ShadowPerp private perpetual futures trading terminal."
        />
      </Head>

      <div className="min-h-screen gradient-bg">
        <header className="border-b border-shadow-600">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="text-2xl font-bold bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-transparent"
              >
                ShadowPerp
              </Link>
              <PrivacyBadge />
              <NetworkIndicator />
            </div>

            <nav className="flex items-center gap-3">
              <button
                onClick={() => setActiveTab("trade")}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  activeTab === "trade"
                    ? "bg-shadow-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Trade
              </button>
              <button
                onClick={() => setActiveTab("positions")}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  activeTab === "positions"
                    ? "bg-shadow-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Positions
              </button>
              <WalletMultiButton />
            </nav>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-6">
          {/* Chart - always visible */}
          <div className="mb-6">
            <PriceChart selectedPair={selectedPair} onPairChange={setSelectedPair} />
          </div>

          {/* Trading panel + Market info */}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <MarketInfo pair={selectedPair} />
            </div>
            <div className="lg:col-span-2">
              {activeTab === "trade" ? <TradingPanel pair={selectedPair} /> : <PositionsList />}
            </div>
          </div>
        </main>

        <footer className="border-t border-shadow-600 mt-auto">
          <div className="max-w-7xl mx-auto px-4 py-6 text-center text-gray-500 text-sm">
            <p>
              Powered by{" "}
              <a
                href="https://arcium.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-purple hover:underline"
              >
                Arcium
              </a>{" "}
              - Built on Solana
            </p>
            <p className="mt-2">
              Your trades are encrypted using multi-party computation.
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}

