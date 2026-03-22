import { useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Wallet } from "lucide-react";
import { WALLET_DISPLAY_TOKENS } from "../lib/tokens";

interface TokenBalance {
  symbol: string;
  balance: number;
  color: string;
}

interface WalletPopupProps {
  marginBalance: number | null;
  onOpenCollateral?: () => void;
}

function formatBalance(bal: number, symbol: string): string {
  if (bal < 0.001) return "<0.001";
  if (bal >= 1_000_000) return `${(bal / 1_000_000).toFixed(1)}M`;
  if (bal >= 1_000) return `${(bal / 1_000).toFixed(1)}K`;
  return bal.toFixed(bal < 1 ? 4 : 2);
}

export default function WalletPopup({ marginBalance, onOpenCollateral }: WalletPopupProps) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

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

  const hasBalances = connected && (solBalance !== null || tokenBalances.length > 0);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="trade-header-control inline-flex items-center justify-center border border-shadow-500/50 bg-shadow-800/80 w-8 h-8 text-gray-400 transition-all hover:text-gray-200 hover:border-shadow-400/60 hover:bg-shadow-700/80"
        title="Wallet"
      >
        <Wallet className="w-4 h-4" />
      </button>

      {open && (
        <div className="trade-header-popover absolute right-0 top-full mt-2 w-64 border border-shadow-500 bg-shadow-900 shadow-2xl z-[400]">
          {/* Header */}
          <div className="px-3 py-2.5 border-b border-shadow-600">
            <p className="text-[11px] font-semibold text-gray-200">Wallet</p>
          </div>

          {/* Wallet Balances */}
          {hasBalances ? (
            <div className="px-3 py-2">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1.5 font-semibold">
                Balances
              </p>
              {solBalance !== null && (
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: "linear-gradient(135deg, #9945FF, #14F195)" }} />
                    <span className="text-[12px] text-gray-400">SOL</span>
                  </div>
                  <span className="text-[12px] font-semibold text-gray-200">{formatBalance(solBalance, "SOL")}</span>
                </div>
              )}
              {tokenBalances.map((tb) => (
                <div key={tb.symbol} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tb.color }} />
                    <span className="text-[12px] text-gray-400">{tb.symbol}</span>
                  </div>
                  <span className="text-[12px] font-semibold text-gray-200">{formatBalance(tb.balance, tb.symbol)}</span>
                </div>
              ))}
            </div>
          ) : connected ? (
            <div className="px-3 py-3">
              <p className="text-[11px] text-gray-500">No balances found</p>
            </div>
          ) : (
            <div className="px-3 py-3">
              <p className="text-[11px] text-gray-500">Connect wallet to view balances</p>
            </div>
          )}

          {/* Margin Balance */}
          <div className="border-t border-shadow-600 px-3 py-2">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1.5 font-semibold">
              Trading Account
            </p>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-[12px] text-gray-400">Margin Balance</span>
              <span className="text-[12px] font-semibold text-gray-200">
                {marginBalance !== null ? `$${marginBalance.toFixed(2)}` : "--"}
              </span>
            </div>
          </div>

          {/* Deposit/Manage button */}
          {onOpenCollateral && (
            <div className="border-t border-shadow-600 p-2">
              <button
                type="button"
                onClick={() => {
                  onOpenCollateral();
                  setOpen(false);
                }}
                className="w-full py-1.5 text-[11px] font-medium text-accent-purple border border-accent-purple/30 bg-accent-purple/10 hover:bg-accent-purple/20 transition-colors"
              >
                {marginBalance === 0 || marginBalance === null ? "Deposit Collateral" : "Manage Collateral"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
