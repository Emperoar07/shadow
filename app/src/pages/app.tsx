import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import Head from "next/head";
import Link from "next/link";
import toast from "react-hot-toast";
import MarketInfo from "../components/MarketInfo";
import PrivateOrderbook from "../components/PrivateOrderbook";
import TradingPanel from "../components/TradingPanel";
import NetworkIndicator from "../components/NetworkIndicator";
import {
  RELAY_SESSION_RENEW_BEFORE_SECONDS,
  useArciumPrivacy,
} from "../hooks/useArcium";
import { useMarketSnapshot } from "../hooks/useMarketSnapshot";
import { TRADING_PAIRS, TradingPair } from "../lib/tokens";

const NeuralShadowBackground = dynamic(
  () => import("../components/NeuralShadowBackground"),
  { ssr: false }
);
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
  const [marginBalance, setMarginBalance] = useState<number | null>(null);
  const [openCollateralModal, setOpenCollateralModal] = useState<(() => void) | null>(null);
  const [mobileMarketTab, setMobileMarketTab] = useState<"chart" | "book" | "trades">("chart");
  const { snapshot: marketSnapshot } = useMarketSnapshot(selectedPair);

  const handleMarginReady = useCallback((balance: number | null, openModal: () => void) => {
    setMarginBalance(balance);
    setOpenCollateralModal(() => openModal);
  }, []);

  const handlePairChange = useCallback((pair: TradingPair) => {
    setSelectedPair(pair);
    setMobileMarketTab("chart");
  }, []);

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
          <header className="trade-header border-b border-shadow-600 shrink-0 bg-shadow-900 relative z-[200]">
            <div className="max-w-[1600px] mx-auto px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center justify-between gap-3 sm:justify-start">
                <Link
                  href="/"
                  className="flex items-center gap-2 text-xl font-bold bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-transparent"
                >
                  <ShadowLogo className="h-7 w-7 shrink-0 header-logo-animate" />
                  Shadow
                </Link>
                <NetworkIndicator mode="network" />
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <div className="basis-full sm:basis-auto">
                  <SessionTimerChip />
                </div>
                <NetworkIndicator mode="wallet" />
                {marginBalance !== null && openCollateralModal && (
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-gray-500 leading-none">Margin Balance</span>
                      <span className="text-xs font-semibold text-gray-200 leading-tight">${marginBalance.toFixed(2)}</span>
                    </div>
                    <button
                      onClick={openCollateralModal}
                      className="rounded-lg border border-accent-purple/35 bg-accent-purple/15 px-3 py-1.5 text-[11px] font-medium text-accent-purple transition-colors hover:bg-accent-purple/25"
                    >
                      {marginBalance === 0 ? "Deposit" : "Manage"}
                    </button>
                  </div>
                )}
                <ConnectWalletButton />
              </div>
            </div>
          </header>

          {/* ── Terminal body ── */}
          <main className="trade-main flex-1 max-w-[1600px] w-full mx-auto flex flex-col min-h-0">

            {/* Market info bar: pair selector + stats + portfolio stats */}
            <MarketInfo
              pair={selectedPair}
              snapshot={marketSnapshot}
              onPairChange={handlePairChange}
              onMarginReady={handleMarginReady}
            />

            {/* Terminal body: separated chart/orderbook and trading panel */}
            <div className="min-h-[560px] shrink-0 border-b border-shadow-600 p-2 lg:h-[64vh] lg:max-h-[720px]">
              <div className="mb-2 flex rounded-xl border border-shadow-600 bg-shadow-900 p-1 lg:hidden">
                {([
                  ["chart", "Chart"],
                  ["book", "Order Book"],
                  ["trades", "Trades"],
                ] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setMobileMarketTab(tab)}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      mobileMarketTab === tab
                        ? "bg-cyan-500/10 text-cyan-300"
                        : "text-gray-400"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex h-full min-h-0 flex-col gap-2 lg:flex-row lg:items-stretch">
                {/* Chart + Orderbook block */}
                <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-shadow-600">
                  <div className="trade-terminal-grid h-[420px] min-w-0 min-h-0 flex-1 grid grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1fr)_340px]">
                    {/* Chart */}
                    <div
                      className={`min-w-0 min-h-0 lg:border-r lg:border-shadow-600 ${
                        mobileMarketTab === "chart" ? "block" : "hidden lg:block"
                      }`}
                    >
                      <PriceChart
                        selectedPair={selectedPair}
                        chartSymbol={marketSnapshot.chartSymbol}
                      />
                    </div>

                    {/* Orderbook */}
                    <div
                      className={`min-h-0 ${
                      mobileMarketTab === "book" || mobileMarketTab === "trades"
                          ? "block"
                          : "hidden lg:block"
                      }`}
                    >
                      <PrivateOrderbook
                        pair={selectedPair}
                        marketSnapshot={marketSnapshot}
                        activeTab={mobileMarketTab === "trades" ? "trades" : "book"}
                        onTabChange={(tab) => setMobileMarketTab(tab)}
                      />
                    </div>
                  </div>
                </div>

                {/* Standalone TradingPanel outside chart/orderbook block */}
                <div className="h-full w-full shrink-0 min-h-0 overflow-y-auto rounded-xl border border-shadow-600 bg-shadow-900 lg:w-[360px]">
                  <TradingPanel pair={selectedPair} layout="vertical" />
                </div>
              </div>
            </div>


            {/* Positions panel */}
            <div>
              <BottomPositionsPanel activePairLabel={selectedPair.label} />
            </div>

          </main>

          {/* ── Footer ── */}
          <footer className="border-t border-shadow-600 shrink-0">
            <div className="max-w-[1600px] mx-auto px-4 py-4 flex flex-col gap-2 text-center text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between sm:text-left">
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
            </div>
          </footer>
        </div>
      </div>

    </>
  );
}

function ConnectWalletButton() {
  const { publicKey } = useWallet();
  return publicKey
    ? <WalletMultiButton />
    : <WalletMultiButton>Connect Wallet</WalletMultiButton>;
}

const SESSION_DURATION_OPTIONS = [
  { label: "12h", seconds: 12 * 60 * 60 },
  { label: "24h", seconds: 24 * 60 * 60 },
  { label: "48h", seconds: 48 * 60 * 60 },
] as const;

function SessionTimerChip() {
  const { publicKey } = useWallet();
  const { relaySession, relayAvailable, ensureRelaySession } = useArciumPrivacy();
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  const [isTimerHovered, setIsTimerHovered] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNowTs(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setDurationMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleStartSession = useCallback(async (durationSeconds: number) => {
    if (isCreatingSession) return;
    setIsCreatingSession(true);
    setDurationMenuOpen(false);
    try {
      const session = await ensureRelaySession({ reason: "trade", userInitiated: true, durationSeconds });
      if (!session) throw new Error("Session creation failed.");
      toast.success("Delegated session active.");
    } catch (error: any) {
      const message =
        typeof error?.message === "string" && error.message.trim().length > 0
          ? error.message
          : "Failed to start delegated session.";
      toast.error(message);
    } finally {
      setIsCreatingSession(false);
    }
  }, [ensureRelaySession, isCreatingSession]);

  if (!publicKey) return null;

  const isActive =
    !!relaySession &&
    relaySession.owner === publicKey.toBase58() &&
    relaySession.expiresAt - nowTs > RELAY_SESSION_RENEW_BEFORE_SECONDS &&
    relaySession.usedActions < relaySession.maxActions;

  const totalSecs = isActive && relaySession ? Math.max(0, relaySession.expiresAt - nowTs) : 0;
  const hh = Math.floor(totalSecs / 3600);
  const mm = Math.floor((totalSecs % 3600) / 60);
  const ss = totalSecs % 60;

  if (isActive) {
    return (
      <>
        <div className="flex w-full items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 sm:hidden">
          <span
            className="shrink-0 rounded-full bg-emerald-400"
            style={{ width: 8, height: 8, animation: "pulse-dot 2s ease-in-out infinite" }}
          />
          <span className="uppercase tracking-[0.12em] text-emerald-200/80">Session Active</span>
          <span className="ml-auto tabular-nums text-emerald-200">
            {hh > 0 && `${hh}h `}{String(mm).padStart(2, "0")}m {String(ss).padStart(2, "0")}s
          </span>
        </div>
        <div
          className="hidden sm:flex items-center justify-center overflow-hidden whitespace-nowrap cursor-default shrink-0"
          style={{
            height: 32,
            width: isTimerHovered ? "auto" : 32,
            minWidth: 32,
            borderRadius: isTimerHovered ? 20 : 9999,
            background: isTimerHovered ? "rgba(16,185,129,0.15)" : "rgba(16,185,129,0.12)",
            border: `1px solid ${isTimerHovered ? "rgba(16,185,129,0.5)" : "rgba(16,185,129,0.3)"}`,
            padding: isTimerHovered ? "0 12px 0 10px" : 0,
            transition: "border-radius 0.35s cubic-bezier(.4,0,.2,1), padding 0.35s cubic-bezier(.4,0,.2,1), background 0.35s, border-color 0.35s",
          }}
          onMouseEnter={() => setIsTimerHovered(true)}
          onMouseLeave={() => setIsTimerHovered(false)}
        >
          <span
            className="shrink-0 rounded-full bg-emerald-400"
            style={{ width: 8, height: 8, animation: "pulse-dot 2s ease-in-out infinite" }}
          />
          <span
            className="overflow-hidden text-[12px] font-semibold text-emerald-300 tracking-[0.04em] leading-none"
            style={{
              maxWidth: isTimerHovered ? 120 : 0,
              marginLeft: isTimerHovered ? 7 : 0,
              opacity: isTimerHovered ? 1 : 0,
              transition: "max-width 0.35s cubic-bezier(.4,0,.2,1), opacity 0.25s ease, margin-left 0.35s ease",
            }}
          >
            {hh > 0 && <><span>{hh}</span><span style={{ color: "rgba(52,211,153,0.5)", fontSize: 11 }}>h </span></>}
            <span>{String(mm).padStart(2, "0")}</span>
            <span style={{ color: "rgba(52,211,153,0.5)", fontSize: 11 }}>m </span>
            <span>{String(ss).padStart(2, "0")}</span>
            <span style={{ color: "rgba(52,211,153,0.5)", fontSize: 11 }}>s</span>
          </span>
        </div>
      </>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <div
        className={`hidden sm:inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs ${
          relayAvailable
            ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-200"
            : "border-yellow-500/35 bg-yellow-500/10 text-yellow-300"
        }`}
      >
        <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
          <circle
            cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeDasharray="37.7" strokeDashoffset="37.7" transform="rotate(-90 8 8)"
          >
            <animate attributeName="stroke-dashoffset" from="37.7" to="0" dur="3s" repeatCount="indefinite" />
          </circle>
        </svg>
        {relayAvailable ? (
          <button
            type="button"
            onClick={() => setDurationMenuOpen((o) => !o)}
            disabled={isCreatingSession}
            className="underline-offset-2 hover:underline disabled:opacity-60"
          >
            {isCreatingSession ? "Starting session..." : "Start session"}
          </button>
        ) : (
          <span>Relay unavailable</span>
        )}
      </div>

      <div
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm sm:hidden ${
          relayAvailable
            ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-200"
            : "border-yellow-500/35 bg-yellow-500/10 text-yellow-300"
        }`}
      >
        <div className="flex items-center gap-2">
          <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="37.7"
              strokeDashoffset="37.7"
              transform="rotate(-90 8 8)"
            >
              <animate attributeName="stroke-dashoffset" from="37.7" to="0" dur="3s" repeatCount="indefinite" />
            </circle>
          </svg>
          <span className="font-medium">{relayAvailable ? "Delegated session" : "Relay unavailable"}</span>
        </div>
        {relayAvailable && (
          <button
            type="button"
            onClick={() => setDurationMenuOpen((o) => !o)}
            disabled={isCreatingSession}
            className="rounded-md border border-cyan-300/20 bg-black/10 px-3 py-1 text-xs font-semibold text-cyan-100 disabled:opacity-60"
          >
            {isCreatingSession ? "Starting..." : "Start"}
          </button>
        )}
      </div>

      {durationMenuOpen && relayAvailable && (
        <div className="absolute left-0 right-0 top-full mt-1.5 rounded-lg border border-shadow-600 bg-shadow-800 shadow-xl z-[300] py-1.5 sm:left-auto sm:right-0 sm:w-36">
          <p className="px-3 pb-1 text-[9px] uppercase tracking-widest text-gray-500">Session Duration</p>
          {SESSION_DURATION_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => handleStartSession(opt.seconds)}
              disabled={isCreatingSession}
              className="w-full text-left px-3 py-1.5 text-[11px] font-semibold text-gray-300 hover:text-white hover:bg-shadow-700/60 transition-colors disabled:opacity-40"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
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
