import dynamic from "next/dynamic";
import Head from "next/head";
import Link from "next/link";
import PrivacyBadge from "../components/PrivacyBadge";
import NetworkIndicator from "../components/NetworkIndicator";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

export default function LandingPage() {
  return (
    <>
      <Head>
        <title>ShadowPerp - Private Perpetual Futures</title>
        <meta
          name="description"
          content="Private perpetual futures on Solana with Arcium MPC."
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen gradient-bg">
        <header className="border-b border-shadow-600">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-transparent">
                ShadowPerp
              </h1>
              <PrivacyBadge />
              <NetworkIndicator />
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/app"
                className="px-4 py-2 rounded-lg bg-shadow-600 text-white hover:bg-shadow-500 transition-colors"
              >
                Launch App
              </Link>
              <WalletMultiButton />
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-16">
          <section className="text-center">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">Trade In The Shadows</h2>
            <p className="text-gray-400 max-w-2xl mx-auto mb-10">
              Open and manage perp positions with encrypted size, direction, and leverage.
              Reveal only what is necessary at settlement.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link
                href="/app"
                className="px-6 py-3 rounded-lg bg-gradient-to-r from-accent-purple to-accent-blue text-white font-semibold"
              >
                Enter Trading Terminal
              </Link>
            </div>
          </section>

          <section className="grid md:grid-cols-3 gap-6 mt-16">
            <FeatureCard
              title="Private Positions"
              description="Position details stay encrypted throughout the lifecycle."
            />
            <FeatureCard
              title="Protected Liquidations"
              description="Liquidation checks run in MPC and expose only minimal outputs."
            />
            <FeatureCard
              title="Transparent Settlement"
              description="Realized settlement outputs can be revealed at close."
            />
          </section>
        </main>
      </div>
    </>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="position-card rounded-xl p-6 text-left">
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-gray-400">{description}</p>
    </div>
  );
}
