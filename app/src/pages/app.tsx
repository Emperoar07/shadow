import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useConnection } from "@solana/wallet-adapter-react";
import { useWallet } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import Head from "next/head";
import Link from "next/link";
import toast from "react-hot-toast";
import SettingsPanel, { useVisibility, useLayoutLocked } from "../components/layout/SettingsPanel";
import { useTradingSettings } from "../hooks/useTradingSettings";
import ShadowLoader from "../components/ShadowLoader";
import MarketInfo from "../components/MarketInfo";
import PrivateOrderbook from "../components/PrivateOrderbook";
import TradingPanel from "../components/TradingPanel";
import NetworkIndicator from "../components/NetworkIndicator";
import WalletPopup from "../components/WalletPopup";
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
  { ssr: false, loading: () => <ShadowLoader size="sm" message="Loading positions..." /> }
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
  loading: () => <ShadowLoader size="sm" message="Loading chart..." />,
});
const TerminalGrid = dynamic(
  () => import("../components/layout/TerminalGrid"),
  { ssr: false, loading: () => <ShadowLoader size="lg" message="Initializing terminal..." /> }
);

function FaucetsDropdown() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (typeof window !== "undefined" && window.innerWidth < 640) return;
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const panelContent = (
    <div className="py-1">
      <a
        href="https://faucet.solana.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-3 py-2 text-[11px] text-gray-300 hover:bg-shadow-700/60 transition-colors"
        onClick={() => setOpen(false)}
      >
        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: "linear-gradient(135deg, #9945FF, #14F195)" }} />
        SOL Faucet
      </a>
      <a
        href="https://faucet.circle.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-3 py-2 text-[11px] text-gray-300 hover:bg-shadow-700/60 transition-colors"
        onClick={() => setOpen(false)}
      >
        <div className="w-3 h-3 rounded-full shrink-0 bg-[#2775CA]" />
        USDC Faucet
      </a>
    </div>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="trade-header-control inline-flex items-center gap-1 border border-shadow-500/50 bg-shadow-800/80 px-3 py-1.5 text-[11px] font-medium text-gray-400 transition-all hover:text-gray-200 hover:border-shadow-400/60 hover:bg-shadow-700/80"
      >
        Faucets
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`text-gray-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          <div className="trade-header-popover absolute right-0 top-full mt-2 hidden w-44 border border-shadow-500 bg-shadow-900 shadow-2xl z-[400] sm:block">
            {panelContent}
          </div>
          {mounted && createPortal(
            <div
              className="fixed inset-0 z-[450] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm sm:hidden"
              onClick={() => setOpen(false)}
            >
              <div
                className="w-full max-w-xs overflow-hidden rounded-2xl border border-shadow-500 bg-shadow-900 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                {panelContent}
              </div>
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  );
}

export default function TradingAppPage() {
  const [selectedPair, setSelectedPair] = useState<TradingPair>(TRADING_PAIRS[0]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("shadowperp-selected-pair");
      const found = TRADING_PAIRS.find((p) => p.label === saved);
      if (found) setSelectedPair(found);
    } catch {}
  }, []);
  const [marginBalance, setMarginBalance] = useState<number | null>(null);
  const [openCollateralModal, setOpenCollateralModal] = useState<(() => void) | null>(null);
  const [mobileMarketTab, setMobileMarketTab] = useState<"chart" | "book">("chart");
  const resetLayoutRef = useRef<(() => void) | null>(null);
  const { snapshot: marketSnapshot } = useMarketSnapshot(selectedPair, 3_000);
  const { visibility: panelVisibility, update: updateVisibility } = useVisibility();
  const { locked: layoutLocked, toggle: toggleLayoutLock } = useLayoutLocked();
  const { settings: tradingSettings, update: updateTradingSettings, reset: resetTradingSettings } = useTradingSettings();
  const { publicKey } = useWallet();
  const { relaySession, revokeRelaySession } = useArciumPrivacy();
  const isRelaySessionActive =
    !!relaySession &&
    relaySession.owner === (publicKey?.toBase58() ?? "") &&
    relaySession.usedActions < relaySession.maxActions &&
    relaySession.expiresAt - Math.floor(Date.now() / 1000) > RELAY_SESSION_RENEW_BEFORE_SECONDS;

  const handleMarginReady = useCallback((balance: number | null, openModal: () => void) => {
    setMarginBalance(balance);
    setOpenCollateralModal(() => openModal);
  }, []);

  const handlePairChange = useCallback((pair: TradingPair) => {
    setSelectedPair(pair);
    setMobileMarketTab("chart");
    try { localStorage.setItem("shadowperp-selected-pair", pair.label); } catch {}
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
          @keyframes protocol-pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.6; transform: scale(0.85); }
          }
        `}</style>
        <NeuralShadowBackground />

        <div className="relative z-10 flex h-screen flex-col overflow-hidden">

          {/* ── Header ── */}
          <header className="trade-header sticky top-0 border-b border-shadow-600 shrink-0 bg-shadow-900 z-[200]">
            <div className="max-w-[1600px] mx-auto px-3 py-1.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center justify-between gap-3 sm:justify-start">
                <Link
                  href="/"
                  className="flex items-center gap-1 text-xl font-bold bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-transparent"
                >
                  <ShadowLogo className="h-11 w-11 shrink-0 header-logo-animate" />
                  <span className="text-lg font-extrabold tracking-wide bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">SHADOW</span>
                </Link>
                <NetworkIndicator mode="network" />
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <div className="basis-full sm:basis-auto">
                  <SessionTimerChip />
                </div>
                <FaucetsDropdown />
                <WalletPopup
                  marginBalance={marginBalance}
                  onOpenCollateral={openCollateralModal ?? undefined}
                />
                <SettingsPanel
                  onResetLayout={() => resetLayoutRef.current?.()}
                  onVisibilityChange={updateVisibility}
                  tradingSettings={tradingSettings}
                  onTradingSettingsChange={updateTradingSettings}
                  onResetTradingSettings={resetTradingSettings}
                  layoutLocked={layoutLocked}
                  onToggleLayoutLock={toggleLayoutLock}
                  relaySession={relaySession}
                  isRelaySessionActive={isRelaySessionActive}
                  revokeRelaySession={revokeRelaySession}
                />
                <ConnectWalletButton />
              </div>
            </div>
          </header>

          {/* ── Terminal body ── */}
          <main className="trade-main flex-1 max-w-[1600px] w-full mx-auto flex flex-col min-h-0 overflow-y-auto">

            {/* Mobile: market info bar (always visible) */}
            <div className="lg:hidden">
              <MarketInfo
                pair={selectedPair}
                snapshot={marketSnapshot}
                onPairChange={handlePairChange}
                onMarginReady={handleMarginReady}
              />
            </div>

            {/* Desktop: modular drag-and-drop grid layout */}
            <div className="hidden lg:flex flex-1 min-h-0">
              <TerminalGrid
                selectedPair={selectedPair}
                marketSnapshot={marketSnapshot}
                marketInfoComponent={
                  <MarketInfo
                    pair={selectedPair}
                    snapshot={marketSnapshot}
                    onPairChange={handlePairChange}
                    onMarginReady={handleMarginReady}
                  />
                }
                chartComponent={
                  <PriceChart
                    selectedPair={selectedPair}
                    chartSymbol={marketSnapshot.chartSymbol}
                  />
                }
                orderbookComponent={
                  <PrivateOrderbook
                    pair={selectedPair}
                    marketSnapshot={marketSnapshot}
                    animate={tradingSettings.animateOrderBook}
                  />
                }
                tradingPanelComponent={
                  <TradingPanel
                    pair={selectedPair}
                    layout="vertical"
                    confirmOpen={tradingSettings.confirmOpenOrder}
                    showNotifications={tradingSettings.showNotifications}
                    depthSnapshot={marketSnapshot.depthSnapshot}
                  />
                }
                positionsComponent={
                  <BottomPositionsPanel
                    activePairLabel={selectedPair.label}
                    hidePnl={tradingSettings.hidePnl}
                    confirmClose={tradingSettings.confirmCloseOrder}
                    showNotifications={tradingSettings.showNotifications}
                  />
                }
                panelVisibility={panelVisibility}
                layoutLocked={layoutLocked}
                onResetRef={(fn) => { resetLayoutRef.current = fn; }}
              />
            </div>

            {/* Mobile: stacked tab layout */}
            <div className="lg:hidden min-h-[560px] shrink-0 border-b border-shadow-600 p-2">
              <div className="mb-2 flex border border-shadow-600 bg-shadow-900 p-1">
                {([
                  ["chart", "Chart"],
                  ["book", "Order Book"],
                ] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setMobileMarketTab(tab)}
                    className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                      mobileMarketTab === tab
                        ? "bg-cyan-500/10 text-cyan-300"
                        : "text-gray-400"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex h-full min-h-0 flex-col gap-0">
                <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden border border-shadow-600">
                  <div className="trade-terminal-grid h-[420px] min-w-0 min-h-0 flex-1 grid grid-cols-1">
                    <div className={`min-w-0 min-h-0 ${mobileMarketTab === "chart" ? "block" : "hidden"}`}>
                      <PriceChart selectedPair={selectedPair} chartSymbol={marketSnapshot.chartSymbol} />
                    </div>
                    <div className={`min-h-0 ${mobileMarketTab === "book" ? "block" : "hidden"}`}>
                      <PrivateOrderbook
                        pair={selectedPair}
                        marketSnapshot={marketSnapshot}
                      />
                    </div>
                  </div>
                </div>

                <div className="h-full w-full shrink-0 min-h-0 overflow-y-auto border border-shadow-600 bg-shadow-900">
                  <TradingPanel
                    pair={selectedPair}
                    layout="vertical"
                    confirmOpen={tradingSettings.confirmOpenOrder}
                    showNotifications={tradingSettings.showNotifications}
                    depthSnapshot={marketSnapshot.depthSnapshot}
                  />
                </div>
              </div>
            </div>

            {/* Mobile positions */}
            <div className="lg:hidden">
              <BottomPositionsPanel activePairLabel={selectedPair.label} />
            </div>

          </main>

          {/* ── Footer ── */}
          <footer className="sticky bottom-0 border-t border-shadow-600 shrink-0 bg-shadow-900 relative z-[190]">
            <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex flex-col gap-2 text-center text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between sm:text-left">
              {/* Status indicator */}
              <div className="flex items-center justify-center gap-4 sm:justify-start">
                <ProtocolStatusDot />
                <span className="hidden sm:inline text-[10px] text-gray-600">
                  Powered by{" "}
                  <a href="https://arcium.com" target="_blank" rel="noopener noreferrer" className="text-accent-purple/70 hover:text-accent-purple">
                    Arcium MPC
                  </a>
                </span>
              </div>
              <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:gap-4">
                <a
                  href="https://x.com/emperoar007"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-gray-300 transition-colors text-[10px]"
                >
                  Built with love by 0xb for the decentralized world.
                </a>
                <Link href="/docs#privacy-policy" className="text-gray-500 hover:text-gray-300 transition-colors text-[10px]">
                  Privacy Policy
                </Link>
              </div>
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

function ProtocolStatusDot() {
  const { connection } = useConnection();
  const [status, setStatus] = useState<"live" | "degraded" | "offline">("live");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const probe = async () => {
      const start = Date.now();
      try {
        await Promise.race([
          connection.getSlot("processed"),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5_000)),
        ]);
        if (cancelled) return;
        const ms = Date.now() - start;
        setLatencyMs(ms);
        setStatus(ms > 3_000 ? "degraded" : "live");
      } catch {
        if (cancelled) return;
        setLatencyMs(null);
        setStatus("offline");
      }
    };

    void probe();
    const id = window.setInterval(probe, 15_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [connection]);

  const cfg = {
    live: {
      dot: "bg-emerald-400",
      glow: "shadow-[0_0_6px_rgba(20,241,149,0.6),0_0_12px_rgba(20,241,149,0.25)]",
      text: "text-emerald-400",
      label: "Operational",
      pulse: true,
    },
    degraded: {
      dot: "bg-amber-400",
      glow: "shadow-[0_0_6px_rgba(245,158,11,0.6),0_0_12px_rgba(245,158,11,0.25)]",
      text: "text-amber-400",
      label: "Degraded",
      pulse: true,
    },
    offline: {
      dot: "bg-red-500",
      glow: "shadow-[0_0_6px_rgba(239,68,68,0.6),0_0_12px_rgba(239,68,68,0.25)]",
      text: "text-red-400",
      label: "Offline",
      pulse: false,
    },
  }[status];

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot} ${cfg.glow}`}
        style={cfg.pulse ? { animation: "protocol-pulse 2s ease-in-out infinite" } : undefined}
      />
      <span className={`text-[10px] font-semibold ${cfg.text}`}>
        {cfg.label}
      </span>
      {latencyMs !== null && (
        <span className="text-[9px] text-gray-500 tabular-nums">{latencyMs}ms</span>
      )}
    </div>
  );
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
        className={`hidden sm:inline-flex items-center gap-1.5 border px-3 py-1.5 text-[11px] font-medium ${
          relayAvailable
            ? "border-shadow-500/50 bg-shadow-800/80 text-gray-400 hover:text-gray-200 hover:border-shadow-400/60 hover:bg-shadow-700/80"
            : "border-yellow-500/35 bg-yellow-500/10 text-yellow-300"
        } transition-all`}
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
      <path d="M50 15 L85 35 L50 55 L15 35 Z" fill="url(#trade-shadow-logo-grad)" opacity={0.4} />
      <path d="M50 25 L85 45 L50 65 L15 45 Z" fill="url(#trade-shadow-logo-grad)" opacity={0.65} />
      <path d="M50 35 L85 55 L50 75 L15 55 Z" fill="url(#trade-shadow-logo-grad)" />
    </svg>
  );
}
