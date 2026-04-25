import { useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { useWalletConnectionState } from "../lib/use-anchor-wallet";
import { WALLET_DISPLAY_TOKENS } from "../lib/tokens";

interface TokenBalance {
  symbol: string;
  balance: number;
  color: string;
}

export default function NetworkIndicator({ mode = "all" }: { mode?: "all" | "network" | "wallet" }) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWalletConnectionState();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([]);
  const [networkStatus, setNetworkStatus] = useState<"connected" | "checking" | "error">("checking");
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Prefer the explicit cluster env var; fall back to inspecting the endpoint
  // (the endpoint may point to /api/rpc proxy and not contain the cluster name).
  const explicitCluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "").toLowerCase();
  const rpcUrl = connection.rpcEndpoint.toLowerCase();
  const networkName =
    explicitCluster === "devnet" ? "Devnet"
    : explicitCluster === "testnet" ? "Testnet"
    : explicitCluster === "mainnet-beta" ? "Mainnet"
    : rpcUrl.includes("devnet") ? "Devnet"
    : rpcUrl.includes("testnet") ? "Testnet"
    : rpcUrl.includes("mainnet") || rpcUrl.includes("api.mainnet") ? "Mainnet"
    : "Localnet";

  const isDevnet = networkName === "Devnet";

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Fetch SOL + SPL token balances
  useEffect(() => {
    if (mode === "network") {
      setSolBalance(null);
      setTokenBalances([]);
      return;
    }
    if (!publicKey || !connected) {
      setSolBalance(null);
      setTokenBalances([]);
      return;
    }

    let cancelled = false;

    const fetchBalances = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      try {
        const sol = await connection.getBalance(publicKey);
        if (!cancelled) setSolBalance(sol / LAMPORTS_PER_SOL);

        const results: TokenBalance[] = [];
        for (const token of WALLET_DISPLAY_TOKENS) {
          try {
            const ata = await getAssociatedTokenAddress(token.mint, publicKey);
            const info = await connection.getTokenAccountBalance(ata);
            const bal = info.value.uiAmount ?? 0;
            if (bal > 0) {
              results.push({ symbol: token.symbol, balance: bal, color: token.color });
            }
          } catch {
            // ATA doesn't exist = 0 balance
          }
        }
        if (!cancelled) setTokenBalances(results);
      } catch {
        if (!cancelled) {
          setSolBalance(null);
          setTokenBalances([]);
        }
      }
    };

    void fetchBalances();
    const interval = setInterval(() => void fetchBalances(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publicKey, connected, connection, mode]);

  // Check network health
  useEffect(() => {
    if (mode === "wallet") return;
    let cancelled = false;

    const checkNetwork = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      try {
        await connection.getSlot();
        if (!cancelled) setNetworkStatus("connected");
      } catch {
        if (!cancelled) setNetworkStatus("error");
      }
    };

    void checkNetwork();
    const interval = setInterval(() => void checkNetwork(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connection, mode]);

  function formatBalance(bal: number, symbol: string): string {
    if (bal < 0.001) return "<0.001";
    if (bal >= 1_000_000) return `${(bal / 1_000_000).toFixed(1)}M`;
    if (bal >= 1_000) return `${(bal / 1_000).toFixed(1)}K`;
    return bal.toFixed(bal < 1 ? 4 : 2);
  }

  const hasBalances = connected && (solBalance !== null || tokenBalances.length > 0);

  if (mode === "network") return (
    <div
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${
        isDevnet
          ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
          : networkName === "Mainnet"
          ? "bg-accent-green/10 border-accent-green/30 text-accent-green"
          : "bg-blue-500/10 border-blue-500/30 text-blue-400"
      }`}
    >
      <div
        className={`w-1 h-1 rounded-full ${
          networkStatus === "connected"
            ? isDevnet ? "bg-yellow-400" : "bg-accent-green"
            : networkStatus === "checking"
            ? "bg-gray-400 animate-pulse"
            : "bg-accent-red"
        }`}
      />
      {networkName}
    </div>
  );

  if (mode === "wallet") return (
    <div className="flex items-center gap-2">
      {hasBalances && (
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-shadow-600/50 border border-shadow-500 text-xs hover:border-shadow-400 transition-colors"
          >
            <span className="text-gray-300 font-medium">Wallet</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`text-gray-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {open && (
            <div className="absolute right-0 top-full mt-1.5 w-48 rounded-xl border border-shadow-500 bg-shadow-800 shadow-xl z-50 overflow-hidden py-1.5">
              {solBalance !== null && (
                <div className="flex items-center justify-between px-3 py-2 hover:bg-shadow-700/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: "linear-gradient(135deg, #9945FF, #14F195)" }} />
                    <span className="text-xs text-gray-400">SOL</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-200">{formatBalance(solBalance, "SOL")}</span>
                </div>
              )}
              {tokenBalances.map((tb) => (
                <div key={tb.symbol} className="flex items-center justify-between px-3 py-2 hover:bg-shadow-700/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tb.color }} />
                    <span className="text-xs text-gray-400">{tb.symbol}</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-200">{formatBalance(tb.balance, tb.symbol)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex items-center gap-2">
      {/* Network badge */}
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
          isDevnet
            ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
            : networkName === "Mainnet"
            ? "bg-accent-green/10 border-accent-green/30 text-accent-green"
            : "bg-blue-500/10 border-blue-500/30 text-blue-400"
        }`}
      >
        <div
          className={`w-1.5 h-1.5 rounded-full ${
            networkStatus === "connected"
              ? isDevnet ? "bg-yellow-400" : "bg-accent-green"
              : networkStatus === "checking"
              ? "bg-gray-400 animate-pulse"
              : "bg-accent-red"
          }`}
        />
        {networkName}
      </div>

      {/* Wallet balance dropdown */}
      {hasBalances && (
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-shadow-600/50 border border-shadow-500 text-xs hover:border-shadow-400 transition-colors"
          >
            <span className="text-gray-300 font-medium">Wallet</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className={`text-gray-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-1.5 w-48 rounded-xl border border-shadow-500 bg-shadow-800 shadow-xl z-50 overflow-hidden py-1.5">
              {solBalance !== null && (
                <div className="flex items-center justify-between px-3 py-2 hover:bg-shadow-700/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: "linear-gradient(135deg, #9945FF, #14F195)" }} />
                    <span className="text-xs text-gray-400">SOL</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-200">{formatBalance(solBalance, "SOL")}</span>
                </div>
              )}
              {tokenBalances.map((tb) => (
                <div key={tb.symbol} className="flex items-center justify-between px-3 py-2 hover:bg-shadow-700/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tb.color }} />
                    <span className="text-xs text-gray-400">{tb.symbol}</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-200">{formatBalance(tb.balance, tb.symbol)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
