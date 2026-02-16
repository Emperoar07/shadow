import { useState } from "react";
import Head from "next/head";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

import TradingPanel from "../components/TradingPanel";
import PositionsList from "../components/PositionsList";
import MarketInfo from "../components/MarketInfo";
import PrivacyBadge from "../components/PrivacyBadge";

export default function Home() {
  const { connected } = useWallet();
  const [activeTab, setActiveTab] = useState<"trade" | "positions">("trade");

  return (
    <>
      <Head>
        <title>ShadowPerp - Private Perpetual Futures</title>
        <meta
          name="description"
          content="Trade perpetual futures with complete privacy. Your positions, leverage, and strategy remain encrypted."
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen gradient-bg">
        {/* Header */}
        <header className="border-b border-shadow-600">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-transparent">
                ShadowPerp
              </h1>
              <PrivacyBadge />
            </div>

            <nav className="flex items-center gap-6">
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

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 py-8">
          {!connected ? (
            <div className="text-center py-20">
              <div className="mb-8">
                <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-r from-accent-purple to-accent-blue p-1">
                  <div className="w-full h-full rounded-full bg-shadow-900 flex items-center justify-center">
                    <svg
                      className="w-12 h-12 text-accent-purple"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                  </div>
                </div>
                <h2 className="text-3xl font-bold mb-4">
                  Trade in the Shadows
                </h2>
                <p className="text-gray-400 max-w-md mx-auto mb-8">
                  Your positions, leverage, and trading strategy are encrypted
                  using multi-party computation. Only you know your trades.
                </p>
                <WalletMultiButton />
              </div>

              {/* Features */}
              <div className="grid md:grid-cols-3 gap-6 mt-16">
                <FeatureCard
                  icon="🔒"
                  title="Private Positions"
                  description="Position size, leverage, and direction are encrypted. No one can copy your trades."
                />
                <FeatureCard
                  icon="🛡️"
                  title="Hidden Liquidations"
                  description="Your health factor is never revealed. No targeted liquidation attacks."
                />
                <FeatureCard
                  icon="💰"
                  title="Reveal Only PnL"
                  description="Only your final profit/loss is revealed when you close. Everything else stays private."
                />
              </div>
            </div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Market Info Sidebar */}
              <div className="lg:col-span-1">
                <MarketInfo />
              </div>

              {/* Main Panel */}
              <div className="lg:col-span-2">
                {activeTab === "trade" ? <TradingPanel /> : <PositionsList />}
              </div>
            </div>
          )}
        </main>

        {/* Footer */}
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
              • Built on Solana
            </p>
            <p className="mt-2">
              Your trades are encrypted using multi-party computation.
              No single party can see your position details.
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="position-card rounded-xl p-6 text-left">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-gray-400">{description}</p>
    </div>
  );
}
