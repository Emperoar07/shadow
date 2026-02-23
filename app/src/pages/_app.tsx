import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppProps } from "next/app";
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
import { Toaster } from "react-hot-toast";
import {
  getRpcEndpoint,
  getRpcEndpoints,
  RPC_CHANGED_EVENT,
  setPreferredRpcIndex,
} from "../lib/runtime";

import "@solana/wallet-adapter-react-ui/styles.css";
import "../styles/globals.css";

if (typeof window !== "undefined" && !(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}

export default function App({ Component, pageProps }: AppProps) {
  const endpoints = useMemo(() => getRpcEndpoints(), []);
  const [endpoint, setEndpoint] = useState<string>(() => getRpcEndpoint());
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
      if (endpoints.length < 2) return;

      const checks = await Promise.all(
        endpoints.map(async (url, idx) => {
          try {
            const latencyMs = await probeEndpoint(url);
            return { idx, url, ok: true as const, latencyMs };
          } catch {
            return { idx, url, ok: false as const, latencyMs: Number.POSITIVE_INFINITY };
          }
        })
      );

      const healthy = checks.filter((c) => c.ok);
      if (healthy.length === 0) return;

      healthy.sort((a, b) => a.latencyMs - b.latencyMs);
      const best = healthy[0];
      const currentIndex = Math.max(0, endpoints.indexOf(endpoint));
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
      setEndpoint(best.url);
      lastSwitchAtRef.current = now;
    },
    [endpoints, endpoint, probeEndpoint]
  );

  useEffect(() => {
    const handleRpcChange = () => setEndpoint(getRpcEndpoint());
    window.addEventListener(RPC_CHANGED_EVENT, handleRpcChange as EventListener);
    return () => window.removeEventListener(RPC_CHANGED_EVENT, handleRpcChange as EventListener);
  }, []);

  useEffect(() => {
    if (endpoints.length === 0) return;
    setEndpoint(getRpcEndpoint());
  }, [endpoints]);

  useEffect(() => {
    if (endpoints.length < 2) return;
    void autoSelectBestRpc("startup");
    const interval = setInterval(() => {
      void autoSelectBestRpc("interval");
    }, 45_000);
    return () => clearInterval(interval);
  }, [autoSelectBestRpc, endpoints.length]);

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
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
          <Component {...pageProps} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
