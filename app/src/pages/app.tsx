import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useConnection } from "@solana/wallet-adapter-react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  useAnchorWalletCompat,
  useWalletConnectionState,
  useWalletExecutionMode,
} from "../lib/use-anchor-wallet";
import { createShadowPerpClient } from "../lib/create-client";
import { getRuntimeConfig } from "../lib/runtime";
import { FAUCET_TRIGGER_USDC, FAUCET_CAP_USDC, MUSDC_DECIMALS } from "../lib/faucet-constants";
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
import { useMarketSnapshot } from "../hooks/useMarketSnapshot";
import { TRADING_PAIRS, TradingPair } from "../lib/tokens";

const DotGridBackground = dynamic(
  () => import("../components/NeuralShadowBackground"),
  { ssr: false }
);
const BottomPositionsPanel = dynamic(
  () => import("../components/BottomPositionsPanel"),
  { ssr: false, loading: () => <ShadowLoader size="sm" message="Loading positions..." /> }
);
const PriceChart = dynamic(() => import("../components/PriceChart"), {
  ssr: false,
  loading: () => <ShadowLoader size="sm" message="Loading chart..." />,
});
const TerminalGrid = dynamic(
  () => import("../components/layout/TerminalGrid"),
  { ssr: false, loading: () => <ShadowLoader size="lg" message="Initializing terminal..." /> }
);


/**
 * Full-screen onboarding gate shown when connected wallet has zero mUSDC.
 * Multi-step: Welcome → Funds Allocated → Enter. Cannot be dismissed without claiming.
 */
function MockUsdcGate({ onOpenDeposit }: { onOpenDeposit?: () => void }) {
  const { connection } = useConnection();
  const { address: walletAddr } = useWalletConnectionState();
  const anchorWallet = useAnchorWalletCompat();
  const [step, setStep] = useState(0);
  const [showGate, setShowGate] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [mounted, setMounted] = useState(false);
  // null = first-time (no/zero balance), number = top-up (low balance, shows delta)
  const [currentBalanceRaw, setCurrentBalanceRaw] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState<number>(20_000);
  const isTopUpMode = currentBalanceRaw !== null && BigInt(currentBalanceRaw) > BigInt(0);

  const TRIGGER_RAW = BigInt(FAUCET_TRIGGER_USDC) * BigInt(10 ** MUSDC_DECIMALS);
  const CAP_USDC    = FAUCET_CAP_USDC;

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);
  useEffect(() => { setStep(0); setShowGate(false); setCurrentBalanceRaw(null); }, [walletAddr]);

  useEffect(() => {
    if (!walletAddr) return;

    let cancelled = false;

    const check = async (attempt = 0): Promise<void> => {
      try {
        const PROGRAM_ID = new PublicKey(
          process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ?? "ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4"
        );
        const [marginPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("margin"), new PublicKey(walletAddr).toBuffer()],
          PROGRAM_ID
        );
        const marginInfo = await connection.getAccountInfo(marginPda);
        if (cancelled) return;

        // Always check cooldown first — prevents re-showing gate after a
        // successful claim where the deposit tx or account may still be settling.
        try {
          const stored = localStorage.getItem(`mockusdc_faucet_${walletAddr}`);
          if (stored && parseInt(stored, 10) > Date.now()) return;
        } catch {}

        // No margin account — first-time user, show welcome flow
        if (!marginInfo || marginInfo.data.length < 80) {
          setCurrentBalanceRaw(null);
          setTopUpAmount(CAP_USDC);
          setShowGate(true);
          return;
        }

        // balance is u64 at byte offset 72 (8 discriminator + 32 owner + 32 market)
        const balance = marginInfo.data.readBigUInt64LE(72);

        if (balance < TRIGGER_RAW) {
          const balanceUsdc = Number(balance) / 10 ** 6;
          const delta = CAP_USDC - Math.floor(balanceUsdc);
          setCurrentBalanceRaw(balance.toString());
          setTopUpAmount(delta);
          setShowGate(true);
        }
      } catch {
        // RPC error — retry up to 3 times with backoff before giving up silently.
        // Never show the gate due to a transient network failure.
        if (cancelled) return;
        if (attempt < 3) {
          const delay = 2000 * (attempt + 1);
          await new Promise((r) => setTimeout(r, delay));
          if (!cancelled) return check(attempt + 1);
        }
        // All retries exhausted — skip gate rather than falsely trigger it.
        console.warn("[Shadow][faucet-gate] RPC failed after retries, skipping gate.");
      }
    };

    // Wait 2 s after wallet address settles before checking — avoids false
    // positives while Privy finishes initialising the wallet session.
    const timer = setTimeout(() => { void check(); }, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [walletAddr, connection]);

  const handleClaim = async () => {
    if (!walletAddr || isClaiming) return;
    setIsClaiming(true);
    try {
      const res = await fetch("/api/faucet-mock-usdc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: walletAddr }),
      });
      const data = await res.json() as {
        success: boolean;
        signature?: string;
        amount?: number;
        error?: string;
        nextClaimAt?: number;
      };

      if (!data.success) {
        if (data.nextClaimAt) {
          try { localStorage.setItem(`mockusdc_faucet_${walletAddr}`, String(data.nextClaimAt)); } catch {}
          setStep(2);
          return;
        }
        toast.error(data.error ?? "Claim failed. Try again.");
        return;
      }

      const claimedAmount = data.amount ?? topUpAmount;
      const nextAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
      try { localStorage.setItem(`mockusdc_faucet_${walletAddr}`, String(nextAt)); } catch {}

      // Auto-deposit into Shadow margin account
      if (anchorWallet) {
        try {
          const { client } = createShadowPerpClient(connection, anchorWallet);
          const runtime = getRuntimeConfig();
          const depositAmount = new BN(claimedAmount).mul(new BN(10 ** 6));
          await client.depositCollateral(runtime.marketAddress, depositAmount);
          toast.success(`${claimedAmount.toLocaleString()} mUSDC deposited into your Shadow margin!`);
        } catch (depositErr: any) {
          const msg = typeof depositErr?.message === "string"
            ? depositErr.message.split("\n")[0]
            : "Auto-deposit failed";
          toast.error(`mUSDC claimed but deposit failed: ${msg}. Use Manage Collateral to deposit manually.`);
        }
      } else {
        toast.success(`${claimedAmount.toLocaleString()} mUSDC sent to your wallet!`);
      }

      setStep(2);
    } catch (err: any) {
      const msg = typeof err?.message === "string" ? err.message.split("\n")[0] : "Claim failed";
      toast.error(msg);
    } finally {
      setIsClaiming(false);
    }
  };

  if (!mounted || !showGate || !walletAddr) return null;

  const steps = [
    // Step 0: Welcome / Low balance notice
    <div key="welcome" className="flex flex-col items-center text-center px-8 py-8">
      <div className="mb-5 relative">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-accent-purple/30 to-accent-blue/20 border border-accent-purple/40 flex items-center justify-center">
          <ShadowLogo className="w-14 h-14" />
        </div>
        <span className="absolute -top-1 -right-1 text-xs bg-accent-purple text-white px-2 py-0.5 rounded-full font-bold">Devnet</span>
      </div>
      {isTopUpMode ? (
        <>
          <h2 className="text-2xl font-bold text-white mb-2">Your margin is running low</h2>
          <p className="text-gray-400 text-sm leading-relaxed mb-1 font-medium">
            Balance below 10,000 mUSDC.
          </p>
          <p className="text-gray-500 text-[13px] leading-relaxed">
            Top up your Shadow margin to keep trading. We will send exactly what you need to reach 20,000 mUSDC.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-bold text-white mb-2">Welcome to Shadow</h2>
          <p className="text-gray-400 text-sm leading-relaxed mb-1 font-medium">You are early.</p>
          <p className="text-gray-500 text-[13px] leading-relaxed">
            Shadow is a private perpetual trading terminal on Solana with encrypted positions powered by Arcium MPC.
            Trade with full privacy. Your positions are never exposed on chain.
          </p>
        </>
      )}
      <button
        type="button"
        onClick={() => setStep(1)}
        className="mt-8 w-full py-3 rounded-xl font-bold text-sm bg-accent-purple hover:bg-accent-purple/85 text-white transition-colors flex items-center justify-center gap-2"
      >
        {isTopUpMode ? "Top Up Margin" : "Next"}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => setShowGate(false)}
        className="mt-2 w-full py-2 text-xs text-gray-500 hover:text-gray-400 transition-colors"
      >
        {isTopUpMode ? "Dismiss for now" : "Skip for now"}
      </button>
    </div>,

    // Step 1: Claim funds
    <div key="funds" className="flex flex-col items-center text-center px-8 py-8">
      <div className="mb-5">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-500/20 to-accent-purple/20 border border-emerald-500/30 flex items-center justify-center">
          <ShadowLogo className="w-14 h-14" />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">
        {isTopUpMode ? "Top Up Test Funds" : "Claim Test Funds"}
      </h2>
      <p className="text-gray-400 text-[13px] leading-relaxed mb-4">
        {isTopUpMode
          ? <>Top up <span className="text-white font-semibold">{topUpAmount.toLocaleString()} mUSDC</span> and we will auto deposit it straight into your Shadow margin.</>
          : <>Claim <span className="text-white font-semibold">20,000 mUSDC</span> and we will auto deposit it straight into your Shadow margin so you can start trading immediately.</>
        }
      </p>
      <div className="w-full rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3 flex items-center justify-between mb-6">
        <div className="text-left">
          <p className="text-[10px] uppercase tracking-widest text-gray-500">
            {isTopUpMode ? "Top-up amount" : "Free claim"}
          </p>
          <p className="text-xl font-bold text-white mt-0.5">
            {topUpAmount.toLocaleString()} <span className="text-emerald-400 text-sm font-semibold">mUSDC</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-gray-500">Cooldown</p>
          <p className="text-sm font-semibold text-gray-300">7 days</p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleClaim}
        disabled={isClaiming}
        className="w-full py-3 rounded-xl font-bold text-sm bg-accent-purple hover:bg-accent-purple/85 text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isClaiming ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            {isTopUpMode ? "Topping up..." : "Claiming and depositing..."}
          </>
        ) : isTopUpMode ? `Top Up ${topUpAmount.toLocaleString()} mUSDC` : "Claim & Deposit to Margin"}
      </button>
      <button
        type="button"
        onClick={() => setShowGate(false)}
        className="mt-2 w-full py-2 text-xs text-gray-500 hover:text-gray-400 transition-colors"
      >
        Skip for now
      </button>
      <p className="mt-1 text-[10px] text-gray-600">mUSDC is sent to your wallet and auto deposited into your Shadow margin.</p>
    </div>,

    // Step 2: Ready
    <div key="enter" className="flex flex-col items-center text-center px-8 py-8">
      <div className="mb-5">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-accent-purple/30 to-accent-blue/20 border border-accent-purple/40 flex items-center justify-center">
          <ShadowLogo className="w-14 h-14" />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">Ready When You Are</h2>
      <p className="text-gray-500 text-[13px] leading-relaxed mb-5">
        {isTopUpMode
          ? `Your margin has been topped up to 20,000 mUSDC. You are ready to keep trading.`
          : `20,000 mUSDC is now in your Shadow margin account. You are ready to open your first trade.`
        }
      </p>
      <div className="w-full space-y-2.5 mb-6 text-left">
        {[
          "Encrypted positions. No one sees your trades",
          "Arcium MPC protects your strategy on chain",
          "Up to 50x leverage with private margin",
        ].map((text) => (
          <div key={text} className="flex items-center gap-3 rounded-lg bg-shadow-800/60 px-3 py-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-purple shrink-0" />
            <p className="text-[12px] text-gray-300">{text}</p>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setShowGate(false)}
        className="w-full py-3 rounded-xl font-bold text-sm bg-accent-purple hover:bg-accent-purple/85 text-white transition-colors"
      >
        Enter Shadow
      </button>
    </div>,
  ];

  const dots = [0, 1, 2];

  return createPortal(
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4"
      style={{ background: "rgba(8,8,16,0.88)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-shadow-500 overflow-hidden relative"
        style={{ background: "linear-gradient(145deg, #1a1a28 0%, #10101a 100%)" }}
      >
        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 pt-5 pb-1">
          {dots.map((i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? "w-6 bg-accent-purple" : i < step ? "w-1.5 bg-accent-purple/40" : "w-1.5 bg-shadow-600"
              }`}
            />
          ))}
        </div>
        {steps[step]}
      </div>
    </div>,
    document.body
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
          content="Shadow is a private perpetual trading terminal on Solana with encrypted positions and Arcium MPC protection."
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
        <DotGridBackground />
        <MockUsdcGate onOpenDeposit={openCollateralModal ?? undefined} />

        <div className="relative z-10 flex h-screen flex-col overflow-hidden">

          {/* ── Header ── */}
          <header className="trade-header sticky top-0 border-b-[5px] border-shadow-600 shrink-0 bg-shadow-900 z-[200]">
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
            <div className="hidden lg:flex flex-1 min-h-0 relative">
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
            <div className="lg:hidden shrink-0 border-b border-shadow-600 p-1.5">
              <div className="mb-1.5 flex rounded-xl border border-shadow-600 bg-shadow-900 p-1">
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

              <div className="flex min-h-0 flex-col gap-1.5">
                <div className="flex min-h-0 min-w-0 overflow-hidden rounded-xl border border-shadow-600 bg-shadow-900">
                  <div className="trade-terminal-grid h-[280px] min-w-0 min-h-0 flex-1 grid grid-cols-1 sm:h-[360px]">
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

                <div className="w-full shrink-0 min-h-0 overflow-hidden rounded-xl border border-shadow-600 bg-shadow-900">
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
          <footer className="sticky bottom-0 border-t-[5px] border-shadow-600 shrink-0 bg-shadow-900 relative z-[190]">
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
  const { ready, authenticated, logout, login, user } = usePrivy();
  const { wallets } = useWallets();
  const { wallets: solanaWallets, exportWallet, createWallet } = useSolanaWallets();
  const { address: connectedAddress } = useWalletConnectionState();
  const walletExecutionMode = useWalletExecutionMode();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const ref = useRef<HTMLDivElement>(null);
  const walletCreateAttemptedForUserRef = useRef<string | null>(null);

  // Safety net for email logins: Privy auth can settle before the embedded
  // Solana wallet is surfaced to the app. Only create a wallet when the
  // authenticated user truly has no linked Solana wallet yet.
  useEffect(() => {
    if (!ready || !authenticated || !user) {
      walletCreateAttemptedForUserRef.current = null;
      return;
    }

    const hasLinkedSolanaWallet = user.linkedAccounts?.some(
      (account) => account.type === "wallet" && account.chainType === "solana"
    );
    if (hasLinkedSolanaWallet) {
      walletCreateAttemptedForUserRef.current = null;
      return;
    }

    if (walletCreateAttemptedForUserRef.current === user.id) return;
    walletCreateAttemptedForUserRef.current = user.id;

    createWallet().catch((error) => {
      console.error("[Shadow] createWallet failed:", error);
      walletCreateAttemptedForUserRef.current = null;
    });
  }, [authenticated, createWallet, ready, user]);

  // Notify once when wallet first becomes connected this session.
  const prevConnectedRef = useRef(false);
  useEffect(() => {
    const addr = connectedAddress ?? (authenticated ? solanaWallets.find((w) => w.walletClientType === "privy")?.address ?? null : null);
    const isNowConnected = !!addr;
    if (isNowConnected && !prevConnectedRef.current) {
      const short = `${addr!.slice(0, 4)}...${addr!.slice(-4)}`;
      toast.success(`Wallet connected: ${short}`, { duration: 3500 });
    }
    prevConnectedRef.current = isNowConnected;
  }, [connectedAddress, authenticated, solanaWallets]);

  const handlePrivyLogin = useCallback(() => {
    setOpen(false);
    try {
      login();
    } catch (error) {
      console.error("[Shadow][Privy connect]", error);
      toast.error("Privy sign-in could not open. Check the configured app ID, allowed origins, and the wallet/email methods in the Privy dashboard.", {
        duration: 7000,
      });
    }
  }, [login]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!mounted) return null;
  if (!ready) return (
    <div className="h-8 w-24 animate-pulse rounded border border-shadow-500/40 bg-shadow-800/60" />
  );

  const embeddedAddr = solanaWallets.find((w) => w.walletClientType === "privy")?.address;
  // Fall back to linkedAccounts so the connected state shows immediately while
  // useSolanaWallets() is still hydrating after email/social login.
  const linkedSolanaAddr = authenticated
    ? (user?.linkedAccounts?.find(
        (a: { type: string; chainType?: string; address?: string }) =>
          a.type === "wallet" && a.chainType === "solana"
      ) as { address?: string } | undefined)?.address ?? null
    : null;
  const addr = connectedAddress ?? embeddedAddr ?? linkedSolanaAddr ?? null;
  const isConnected = !!addr;

  if (isConnected) {
    const short = `${addr!.slice(0, 4)}...${addr!.slice(-4)}`;

    const handleCopy = () => {
      navigator.clipboard.writeText(addr!).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    };

    const explorerUrl = `https://explorer.solana.com/address/${addr}?cluster=devnet`;

    const handleDisconnect = () => {
      setOpen(false);
      const activeWallet =
        wallets.find((wallet) => wallet.address === addr) ??
        solanaWallets.find((wallet) => wallet.address === addr);
      activeWallet?.disconnect?.();
      if (authenticated) logout();
    };

    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 px-3 py-1.5 rounded border border-shadow-500/60 bg-shadow-800/80 text-[12px] font-medium text-gray-200 hover:border-accent-purple/50 hover:bg-shadow-700/80 transition-colors"
        >
          <span
            className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"
            style={{ boxShadow: "0 0 6px rgba(52,211,153,0.7)" }}
          />
          {short}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-shadow-500 bg-shadow-900 shadow-2xl z-[400] overflow-hidden">
            <div className="px-4 py-3 border-b border-shadow-700/60">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Wallet</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-white font-mono">
                  {`${addr!.slice(0, 8)}...${addr!.slice(-6)}`}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 text-gray-500 hover:text-gray-200 transition-colors"
                  title="Copy address"
                >
                  {copied ? (
                    <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                      <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M3 11V3h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="py-1">
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-[12px] text-gray-300 hover:bg-shadow-800/80 hover:text-white transition-colors"
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M9 2h5m0 0v5m0-5L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Open in Explorer
              </a>
              {/* Export key — only for embedded wallet users (email/social login) */}
              {embeddedAddr && walletExecutionMode === "embedded" && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    exportWallet({ address: embeddedAddr }).catch(() => {});
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-[12px] text-gray-300 hover:bg-shadow-800/80 hover:text-white transition-colors"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2v8m0 0l-3-3m3 3l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Export Private Key
                </button>
              )}
              <button
                type="button"
                onClick={handleDisconnect}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-[12px] text-red-400 hover:bg-shadow-800/80 hover:text-red-300 transition-colors"
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none">
                  <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={handlePrivyLogin}
          className="px-4 py-1.5 rounded border border-accent-purple/60 bg-accent-purple/15 text-[12px] font-semibold text-accent-purple hover:bg-accent-purple/25 hover:border-accent-purple/80 transition-colors"
        >
          Sign in
        </button>
      </div>
    );
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
