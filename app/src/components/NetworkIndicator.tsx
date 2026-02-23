import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { WALLET_DISPLAY_TOKENS } from "../lib/tokens";

interface TokenBalance {
  symbol: string;
  balance: number;
  color: string;
}

export default function NetworkIndicator() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([]);
  const [networkStatus, setNetworkStatus] = useState<"connected" | "checking" | "error">("checking");

  const rpcUrl = connection.rpcEndpoint;
  const networkName = rpcUrl.includes("devnet")
    ? "Devnet"
    : rpcUrl.includes("testnet")
    ? "Testnet"
    : rpcUrl.includes("mainnet") || rpcUrl.includes("api.mainnet")
    ? "Mainnet"
    : "Localnet";

  const isDevnet = networkName === "Devnet";

  // Fetch SOL + SPL token balances
  useEffect(() => {
    if (!publicKey || !connected) {
      setSolBalance(null);
      setTokenBalances([]);
      return;
    }

    let cancelled = false;

    const fetchBalances = async () => {
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
    const interval = setInterval(() => void fetchBalances(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publicKey, connected, connection]);

  // Check network health
  useEffect(() => {
    let cancelled = false;

    const checkNetwork = async () => {
      try {
        await connection.getSlot();
        if (!cancelled) setNetworkStatus("connected");
      } catch {
        if (!cancelled) setNetworkStatus("error");
      }
    };

    void checkNetwork();
    const interval = setInterval(() => void checkNetwork(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connection]);

  function formatBalance(bal: number, symbol: string): string {
    if (symbol === "BONK") {
      if (bal >= 1_000_000) return `${(bal / 1_000_000).toFixed(1)}M`;
      if (bal >= 1_000) return `${(bal / 1_000).toFixed(1)}K`;
      return bal.toFixed(0);
    }
    if (bal < 0.001) return "<0.001";
    if (bal >= 1_000_000) return `${(bal / 1_000_000).toFixed(1)}M`;
    if (bal >= 1_000) return `${(bal / 1_000).toFixed(1)}K`;
    return bal.toFixed(bal < 1 ? 4 : 2);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
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

      {/* SOL balance */}
      {connected && solBalance !== null && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-shadow-600/50 border border-shadow-500 text-xs">
          <div className="w-3 h-3 rounded-full" style={{ background: "linear-gradient(135deg, #9945FF, #14F195)" }} />
          <span className="text-gray-200 font-medium">
            {formatBalance(solBalance, "SOL")}
          </span>
          <span className="text-gray-500">SOL</span>
        </div>
      )}

      {/* SPL token balances */}
      {connected && tokenBalances.map((tb) => (
        <div
          key={tb.symbol}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-shadow-600/50 border border-shadow-500 text-xs"
        >
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tb.color }} />
          <span className="text-gray-200 font-medium">
            {formatBalance(tb.balance, tb.symbol)}
          </span>
          <span className="text-gray-500">{tb.symbol}</span>
        </div>
      ))}
    </div>
  );
}
