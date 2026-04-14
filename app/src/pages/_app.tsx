import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppProps } from "next/app";
import { useRouter } from "next/router";
import { Buffer } from "buffer";
import { Connection } from "@solana/web3.js";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { PrivyProvider } from "@privy-io/react-auth";
import { Toaster } from "react-hot-toast";
import ShadowLoader from "../components/ShadowLoader";
import {
  getRpcTransport,
  getRpcTransports,
  RPC_CHANGED_EVENT,
  setPreferredRpcIndex,
} from "../lib/runtime";

import "@solana/wallet-adapter-react-ui/styles.css";
import "../styles/globals.css";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "cmnxlswsv00570bldco9er2py";

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
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
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

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#7c3aed",
          logo: "/favicon.svg",
          landingHeader: "Log in to Shadow",
        },
        // wallet login method triggers wallet-adapter modal via our ConnectWalletButton
        loginMethods: ["email", "google", "twitter"],
        embeddedWallets: {
          createOnLogin: "all-users",
          noPromptOnSignature: true,
        },
        solanaClusters: [{ name: "devnet", rpcUrl: transport.rpc }],
      }}
    >
      <ConnectionProvider
        endpoint={transport.rpc}
        config={{ commitment: "confirmed", wsEndpoint: transport.ws }}
      >
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
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
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </PrivyProvider>
  );
}
