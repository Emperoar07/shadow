import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import { Buffer } from "buffer";
import { Connection } from "@solana/web3.js";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { Toaster } from "react-hot-toast";
import ShadowLoader from "../components/ShadowLoader";
import {
  getRpcTransport,
  getRpcTransports,
  RPC_CHANGED_EVENT,
  setPreferredRpcIndex,
} from "../lib/runtime";

import "../styles/globals.css";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";

if (typeof window !== "undefined" && !(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}

export default function App({ Component, pageProps }: AppProps) {
  const transports = useMemo(() => getRpcTransports(), []);
  const [transport, setTransport] = useState(() => getRpcTransport());
  const lastSwitchAtRef = useRef<number>(0);

  const probeEndpoint = useCallback(async (url: string): Promise<number> => {
    const conn = new Connection(url, "confirmed");
    const started = Date.now();
    await Promise.race([
      conn.getLatestBlockhash("processed"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("rpc probe timeout")), 4_500)
      ),
    ]);
    return Date.now() - started;
  }, []);

  const autoSelectBestRpc = useCallback(
    async (reason: "startup" | "interval") => {
      if (transports.length < 2) return;
      const checks = await Promise.all(
        transports.map(async ({ rpc }, idx) => {
          try {
            const latencyMs = await probeEndpoint(rpc);
            return { idx, rpc, ok: true as const, latencyMs };
          } catch {
            return { idx, rpc, ok: false as const, latencyMs: Number.POSITIVE_INFINITY };
          }
        })
      );
      const healthy = checks.filter((c) => c.ok);
      if (healthy.length === 0) return;
      healthy.sort((a, b) => a.latencyMs - b.latencyMs);
      const best = healthy[0];
      const currentIndex = Math.max(
        0,
        transports.findIndex((entry) => entry.rpc === transport.rpc)
      );
      const current = checks[currentIndex];
      if (currentIndex === best.idx) return;
      const now = Date.now();
      const cooldownMs = 90_000;
      const inCooldown = now - lastSwitchAtRef.current < cooldownMs;
      const currentUnhealthy = !current?.ok;
      const significantlyBetter =
        current?.ok &&
        (current.latencyMs - best.latencyMs >= 250 ||
          current.latencyMs / Math.max(best.latencyMs, 1) >= 1.6);
      const shouldSwitch =
        reason === "startup" || currentUnhealthy || (!inCooldown && significantlyBetter);
      if (!shouldSwitch) return;
      setPreferredRpcIndex(best.idx);
      setTransport(transports[best.idx]);
      lastSwitchAtRef.current = now;
    },
    [transports, transport, probeEndpoint]
  );

  useEffect(() => {
    const handleRpcChange = () => setTransport(getRpcTransport());
    window.addEventListener(RPC_CHANGED_EVENT, handleRpcChange as EventListener);
    return () => window.removeEventListener(RPC_CHANGED_EVENT, handleRpcChange as EventListener);
  }, []);

  useEffect(() => {
    if (transports.length === 0) return;
    setTransport(getRpcTransport());
  }, [transports]);

  useEffect(() => {
    if (transports.length < 2) return;
    void autoSelectBestRpc("startup");
    const interval = setInterval(() => {
      void autoSelectBestRpc("interval");
    }, 45_000);
    return () => clearInterval(interval);
  }, [autoSelectBestRpc, transports.length]);

  const wallets = useMemo(
    () => [new SolflareWalletAdapter()],
    []
  );

  const router = useRouter();
  const [pageLoading, setPageLoading] = useState(false);
  const loadStartRef = useRef(0);

  useEffect(() => {
    const MIN_DISPLAY_MS = 600;
    const MAX_LOADER_MS = 10000;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    const clearSafety = () => {
      if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
    };
    const handleStart = (url: string) => {
      const targetPath = url.split("?")[0].split("#")[0];
      const currentPath = router.asPath.split("?")[0].split("#")[0];
      if (targetPath === currentPath) return;
      loadStartRef.current = Date.now();
      setPageLoading(true);
      clearSafety();
      safetyTimer = setTimeout(() => setPageLoading(false), MAX_LOADER_MS);
    };
    const handleDone = () => {
      clearSafety();
      const elapsed = Date.now() - loadStartRef.current;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
      setTimeout(() => setPageLoading(false), remaining);
    };
    router.events.on("routeChangeStart", handleStart);
    router.events.on("routeChangeComplete", handleDone);
    router.events.on("routeChangeError", handleDone);
    return () => {
      clearSafety();
      router.events.off("routeChangeStart", handleStart);
      router.events.off("routeChangeComplete", handleDone);
      router.events.off("routeChangeError", handleDone);
    };
  }, [router]);

  // Stable Privy config — memoize so the PrivyProvider never remounts its
  // iframe when the RPC auto-selector switches transports.
  const initialRpcUrl = useRef(transport.rpc);
  const privyConfig = useMemo<PrivyClientConfig>(
    () => ({
      appearance: {
        theme: "dark",
        accentColor: "#7c3aed",
        logo: "/favicon.svg",
        landingHeader: "Log in to Shadow",
        walletChainType: "solana-only",
        showWalletLoginFirst: true,
        walletList: [
          "detected_solana_wallets",
          "phantom",
          "wallet_connect",
        ],
      },
      walletConnectCloudProjectId:
        process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
      loginMethods: ["wallet", "email"],
      externalWallets: {
        solana: {
          // Auto-reconnect external wallets that Privy already has in its session.
          // This is scoped: Privy only auto-connects wallets the user previously linked,
          // not random detected extensions. Safe to keep true alongside email login.
          connectors: toSolanaWalletConnectors({
            shouldAutoConnect: true,
          }),
        },
      },
      embeddedWallets: {
        createOnLogin: "all-users",
        noPromptOnSignature: true,
        // Restrict to Solana only — prevents Privy from creating an Ethereum
        // embedded wallet first, which would resolve as the active wallet with
        // a 0x address (invalid base58) before the Solana wallet is ready.
        ethereum: { createOnLogin: "off" },
      },
      solanaClusters: [{ name: "devnet", rpcUrl: initialRpcUrl.current }],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally empty: config must stay stable for wallet proxy iframe
    []
  );

  if (!PRIVY_APP_ID) {
    return (
      <div className="min-h-screen bg-shadow-950 text-white">
        <div className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-6 py-12">
          <div className="w-full rounded-2xl border border-red-500/30 bg-shadow-900/95 p-6 shadow-2xl">
            <p className="text-[11px] uppercase tracking-[0.32em] text-red-300">
              Missing Hosted Config
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-white">
              Privy is not configured for this deployment
            </h1>
            <p className="mt-3 text-sm leading-6 text-gray-300">
              Shadow now expects a real Privy app ID for email and social sign-in.
              Set <code className="rounded bg-shadow-800 px-1.5 py-0.5 text-xs text-red-200">NEXT_PUBLIC_PRIVY_APP_ID</code>
              in this environment, then redeploy.
            </p>
            <p className="mt-4 text-sm leading-6 text-gray-400">
              This guard is intentional so the app does not silently boot against the wrong
              Privy tenant after the hosting move.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={privyConfig}
    >
      <ConnectionProvider
        endpoint={transport.rpc}
        config={{ commitment: "confirmed", wsEndpoint: transport.ws }}
      >
        <WalletProvider wallets={wallets} autoConnect={false}>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "#1a1a25",
                color: "#fff",
                border: "1px solid rgba(139, 92, 246, 0.3)",
              },
            }}
          />
          {pageLoading && <ShadowLoader fullScreen message="" />}
          <Component {...pageProps} />
        </WalletProvider>
      </ConnectionProvider>
    </PrivyProvider>
  );
}
