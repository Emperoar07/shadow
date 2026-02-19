import Head from "next/head";
import Link from "next/link";
import NeuralShadowBackground from "../components/NeuralShadowBackground";

export default function LandingPage() {
  return (
    <>
      <Head>
        <title>Shadow | Private Perpetual Exchange</title>
        <meta
          name="description"
          content="The first confidential perpetual exchange on Solana, powered by Arcium."
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="relative min-h-screen overflow-x-hidden bg-[#05081a] text-slate-200">
        <style jsx>{`
          .bg-grid {
            background-image:
              linear-gradient(rgba(36, 56, 114, 0.24) 1px, transparent 1px),
              linear-gradient(90deg, rgba(36, 56, 114, 0.24) 1px, transparent 1px);
            background-size: 40px 40px;
            mask-image: radial-gradient(circle at center, black 40%, transparent 80%);
          }
          @keyframes pulse-glow {
            0%,
            100% {
              filter: drop-shadow(0 0 16px rgba(109, 82, 255, 0.35));
            }
            50% {
              filter: drop-shadow(0 0 28px rgba(56, 189, 248, 0.35));
            }
          }
          .logo-animate {
            animation: pulse-glow 4s infinite ease-in-out;
          }
          .text-gradient {
            background: linear-gradient(to right, #8b5cf6, #60a5fa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
        `}</style>

        <NeuralShadowBackground />
        <div className="pointer-events-none absolute inset-0 z-0 bg-grid" />
        <div className="relative z-10">
          <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
            <div className="flex items-center gap-3">
              <ShadowLogo className="h-8 w-8 logo-animate" />
              <span className="text-xl font-bold tracking-wide">SHADOW</span>
            </div>
          </nav>

          <header className="relative z-10 mt-20 mb-32 flex flex-col items-center justify-center px-4 text-center">
            <div className="logo-animate mb-10 h-48 w-48">
              <ShadowLogo className="h-full w-full" />
            </div>

            <h1 className="mb-6 text-6xl font-extrabold tracking-tight md:text-7xl">
              Trade in the <span className="text-gradient">Dark.</span>
            </h1>
            <p className="max-w-2xl text-xl font-light text-slate-400 md:text-2xl">
              A Confidential Perpetual Dex on Solana.
              <br />
              Powered by <span className="font-medium text-slate-200">Arcium</span>.
            </p>

            <div className="mt-10 flex">
              <Link
                href="/app"
                className="rounded-lg bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] px-8 py-3 font-bold text-white shadow-[0_0_20px_rgba(99,102,241,0.35)] transition hover:from-[#7c3aed] hover:to-[#2563eb]"
              >
                Start Trading
              </Link>
            </div>
          </header>

          <section className="relative z-10 mx-auto grid w-full max-w-5xl items-center gap-16 px-6 pb-24 md:grid-cols-2">
            <div className="space-y-6">
              <h2 className="mb-4 text-3xl font-bold text-white">Minimized Information Leakage.</h2>
              <p className="text-lg leading-relaxed text-slate-400">
                In traditional DeFi, every trade is public. Your liquidation price, position size,
                and stop-losses are visible to everyone, including predatory MEV bots.
              </p>
              <p className="text-lg leading-relaxed text-slate-400">
                <strong className="text-cyan-400">Shadow changes the game.</strong> Built on Solana
                for lightning speed and secured by Arcium Trusted Execution Environments (TEEs),
                Shadow ensures sensitive trade data remains encrypted even during processing.
              </p>
            </div>

            <div className="grid gap-4">
              <FeatureCard
                title="Dark Limit Orders"
                description="Place massive orders without signaling the market or moving the price before execution."
                borderHoverClass="hover:border-violet-500/30"
                titleHoverClass="group-hover:text-violet-400"
              />
              <FeatureCard
                title="Confidential Liquidations"
                description="Protect your liquidation points from hunters. Only the protocol knows when you're at risk."
                borderHoverClass="hover:border-indigo-500/30"
                titleHoverClass="group-hover:text-indigo-400"
              />
              <FeatureCard
                title="MEV Resistant"
                description="Encrypted order flow reduces exploitable signal and helps mitigate front-running."
                borderHoverClass="hover:border-sky-500/30"
                titleHoverClass="group-hover:text-sky-400"
              />
            </div>
          </section>

          <footer className="relative z-10 w-full border-t border-[#1b2348] bg-[#05081a] py-8 text-center text-sm text-slate-500">
            &copy; 2026 Shadow. Built on Solana &amp; Arcium.
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
        <linearGradient id="shadow-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#8b5cf6", stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: "#3b82f6", stopOpacity: 1 }} />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="40" fill="url(#shadow-logo-grad)" />
      <circle cx="62" cy="38" r="41" fill="#05081a" />
    </svg>
  );
}

function FeatureCard({
  title,
  description,
  borderHoverClass,
  titleHoverClass,
}: {
  title: string;
  description: string;
  borderHoverClass: string;
  titleHoverClass: string;
}) {
  return (
    <div
      className={`group rounded-xl border border-slate-800 bg-slate-900/50 p-6 transition ${borderHoverClass}`}
    >
      <h3 className={`mb-2 text-xl font-bold text-slate-200 transition ${titleHoverClass}`}>
        {title}
      </h3>
      <p className="text-sm text-slate-500">{description}</p>
    </div>
  );
}
