import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Wallet, Clock, ExternalLink, ChevronDown, ArrowDownToLine, ArrowUpFromLine, Zap, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { WALLET_DISPLAY_TOKENS } from "../lib/tokens";

const EXPLORER_BASE = "https://explorer.solana.com/tx";
const INITIAL_TX_COUNT = 5;
const LOAD_MORE_COUNT = 10;
const SHADOWPERP_PROGRAM_ID = process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ?? "ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4";


interface RecentTx {
  sig: string;
  slot: number;
  err: boolean;
  blockTime: number | null;
  memo: string | null;
  txType?: TxType;
}

interface TxType {
  label: string;
  color: string;
  icon: "down" | "up" | "open" | "close" | "ref" | "generic";
  amount?: number;
  symbol?: string;
}

interface TokenBalance {
  symbol: string;
  balance: number;
  color: string;
}

interface WalletPopupProps {
  marginBalance: number | null;
  onOpenCollateral?: () => void;
}

function TxIcon({ icon, className }: { icon: TxType["icon"]; className?: string }) {
  const cls = `w-3.5 h-3.5 ${className ?? ""}`;
  if (icon === "down") return <ArrowDownToLine className={cls} />;
  if (icon === "up") return <ArrowUpFromLine className={cls} />;
  if (icon === "open") return <TrendingUp className={cls} />;
  if (icon === "close") return <TrendingDown className={cls} />;
  if (icon === "ref") return <RefreshCw className={cls} />;
  return <ExternalLink className={cls} />;
}

function formatBalance(bal: number, symbol: string): string {
  if (bal < 0.001) return "<0.001";
  if (bal >= 1_000_000) return `${(bal / 1_000_000).toFixed(1)}M`;
  if (bal >= 1_000) return `${(bal / 1_000).toFixed(1)}K`;
  return bal.toFixed(bal < 1 ? 4 : 2);
}

function formatAmount(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
  if (amount >= 1) return amount.toFixed(2);
  return amount.toFixed(4);
}

async function enrichTxTypes(
  connection: import("@solana/web3.js").Connection,
  txs: RecentTx[],
  walletPk: PublicKey
): Promise<RecentTx[]> {
  const unenriched = txs.filter((t) => !t.txType);
  if (unenriched.length === 0) return txs;

  let parsed: (import("@solana/web3.js").ParsedTransactionWithMeta | null)[] = [];
  try {
    parsed = await connection.getParsedTransactions(
      unenriched.map((t) => t.sig),
      { maxSupportedTransactionVersion: 0, commitment: "confirmed" }
    );
  } catch {
    return txs;
  }

  const enriched = new Map<string, TxType>();

  for (let i = 0; i < unenriched.length; i++) {
    const tx = unenriched[i];
    const ptx = parsed[i];
    if (!ptx) continue;

    const allIxs = [
      ...(ptx.transaction.message.instructions ?? []),
      ...(ptx.meta?.innerInstructions?.flatMap((ii) => ii.instructions) ?? []),
    ] as any[];

    // Check if any ix targets the ShadowPerp program
    const shadowIxs = allIxs.filter((ix) => ix.programId?.toString() === SHADOWPERP_PROGRAM_ID);

    let txType: TxType | null = null;

    // Look for deposit/withdraw via SPL token transfers involving wallet
    const splTransfers = allIxs.filter(
      (ix) => ix.program === "spl-token" && ix.parsed?.type === "transfer" || ix.parsed?.type === "transferChecked"
    );

    // Detect by ShadowPerp ix data prefix (first few bytes after discriminator hint)
    // We check parsed instruction data or fall back to memo/SPL transfer direction
    for (const ix of shadowIxs) {
      const data: string = ix.data ?? "";
      // Discriminators are base58-encoded; we match by known ix names in accounts or data length heuristics
      // Instead, check SPL token flow direction relative to wallet to classify deposit vs withdraw
      const preBalances = ptx.meta?.preTokenBalances ?? [];
      const postBalances = ptx.meta?.postTokenBalances ?? [];

      for (const post of postBalances) {
        const pre = preBalances.find((p) => p.accountIndex === post.accountIndex && p.mint === post.mint);
        if (!pre) continue;
        const delta = (post.uiTokenAmount.uiAmount ?? 0) - (pre.uiTokenAmount.uiAmount ?? 0);
        if (Math.abs(delta) < 0.0001) continue;

        const acctKey = ptx.transaction.message.accountKeys[post.accountIndex];
        const acctPk = (acctKey as any)?.pubkey?.toString() ?? "";
        const isWalletAcct = acctPk === walletPk.toString();

        if (Math.abs(delta) > 0 && shadowIxs.length > 0) {
          const symbol = post.mint === "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" ? "USDC"
            : post.mint === "So11111111111111111111111111111111111111112" ? "SOL"
            : "tokens";

          if (delta > 0 && !isWalletAcct) {
            // vault received tokens = deposit
            txType = { label: "Deposit", color: "text-accent-green", icon: "down", amount: Math.abs(delta), symbol };
            break;
          } else if (delta < 0 && !isWalletAcct) {
            // vault lost tokens = withdraw
            txType = { label: "Withdrawal", color: "text-accent-red", icon: "up", amount: Math.abs(delta), symbol };
            break;
          } else if (delta > 0 && isWalletAcct) {
            // wallet received tokens from program = withdrawal
            txType = { label: "Withdrawal", color: "text-accent-red", icon: "up", amount: Math.abs(delta), symbol };
            break;
          } else if (delta < 0 && isWalletAcct) {
            // wallet sent tokens to program = deposit
            txType = { label: "Deposit", color: "text-accent-green", icon: "down", amount: Math.abs(delta), symbol };
            break;
          }
        }
      }

      if (txType) break;

      // If no token flow but shadow ix exists, classify by data length / account count
      if (!txType && shadowIxs.length > 0) {
        const accountCount = ix.accounts?.length ?? 0;
        if (accountCount >= 8) {
          txType = { label: "Open Position", color: "text-accent-purple", icon: "open" };
        } else if (accountCount >= 5) {
          txType = { label: "Close Position", color: "text-yellow-400", icon: "close" };
        } else {
          txType = { label: "Program Call", color: "text-gray-400", icon: "ref" };
        }
      }
    }

    // Fallback: memo-based
    if (!txType) {
      const lower = (tx.memo ?? "").toLowerCase();
      if (lower.includes("deposit") || lower.includes("collateral")) {
        txType = { label: "Deposit", color: "text-accent-green", icon: "down" };
      } else if (lower.includes("withdraw")) {
        txType = { label: "Withdrawal", color: "text-accent-red", icon: "up" };
      } else {
        txType = { label: "Transaction", color: "text-gray-500", icon: "generic" };
      }
    }

    enriched.set(tx.sig, txType);
  }

  return txs.map((t) => enriched.has(t.sig) ? { ...t, txType: enriched.get(t.sig)! } : t);
}

export default function WalletPopup({ marginBalance, onOpenCollateral }: WalletPopupProps) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([]);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"balances" | "activity">("balances");
  const [recentTxs, setRecentTxs] = useState<RecentTx[]>([]);
  const [txsLoading, setTxsLoading] = useState(false);
  const [txsLoadingMore, setTxsLoadingMore] = useState(false);
  const [txsHasMore, setTxsHasMore] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (typeof window !== "undefined" && window.innerWidth < 640) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

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

  // Fetch recent transactions when activity tab is opened
  useEffect(() => {
    if (activeTab !== "activity" || !publicKey || !connected) return;
    let cancelled = false;
    setTxsLoading(true);
    setRecentTxs([]);
    setTxsHasMore(true);
    void (async () => {
      try {
        const sigs = await connection.getSignaturesForAddress(publicKey, { limit: INITIAL_TX_COUNT });
        const base: RecentTx[] = sigs.map((s) => ({
          sig: s.signature,
          slot: s.slot,
          err: s.err !== null,
          blockTime: s.blockTime ?? null,
          memo: s.memo ?? null,
        }));
        const enriched = await enrichTxTypes(connection, base, publicKey);
        if (!cancelled) {
          setRecentTxs(enriched);
          setTxsHasMore(sigs.length >= INITIAL_TX_COUNT);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setTxsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, publicKey, connected, connection]);

  const loadMoreTxs = async () => {
    if (!publicKey || txsLoadingMore || recentTxs.length === 0) return;
    setTxsLoadingMore(true);
    try {
      const lastSig = recentTxs[recentTxs.length - 1].sig;
      const sigs = await connection.getSignaturesForAddress(publicKey, {
        limit: LOAD_MORE_COUNT,
        before: lastSig,
      });
      const base: RecentTx[] = sigs.map((s) => ({
        sig: s.signature,
        slot: s.slot,
        err: s.err !== null,
        blockTime: s.blockTime ?? null,
        memo: s.memo ?? null,
      }));
      const enriched = await enrichTxTypes(connection, base, publicKey);
      setRecentTxs((prev) => [...prev, ...enriched]);
      setTxsHasMore(sigs.length >= LOAD_MORE_COUNT);
    } catch {
      // ignore
    } finally {
      setTxsLoadingMore(false);
    }
  };

  const hasBalances = connected && (solBalance !== null || tokenBalances.length > 0);

  const panelContent = (
    <>
      {/* Header + tabs */}
      <div className="border-b border-shadow-600">
        <div className="px-3 pt-2.5 pb-0 flex gap-0">
          {(["balances", "activity"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={`px-3 pb-2 text-[11px] font-semibold capitalize border-b-2 transition-colors ${
                activeTab === t
                  ? "text-white border-accent-purple"
                  : "text-gray-500 border-transparent hover:text-gray-300"
              }`}
            >
              {t === "balances" ? "Wallet" : "Activity"}
            </button>
          ))}
        </div>
      </div>

      {/* Balances tab */}
      {activeTab === "balances" && (
        <>
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
        </>
      )}

      {/* Activity tab */}
      {activeTab === "activity" && (
        <div className="flex flex-col">
          {!connected ? (
            <div className="px-3 py-3">
              <p className="text-[11px] text-gray-500">Connect wallet to view activity</p>
            </div>
          ) : txsLoading ? (
            <div className="px-3 py-4 text-center">
              <Clock className="w-4 h-4 text-gray-600 mx-auto mb-1.5 animate-spin" />
              <p className="text-[11px] text-gray-500">Loading transactions...</p>
            </div>
          ) : recentTxs.length === 0 ? (
            <div className="px-3 py-3">
              <p className="text-[11px] text-gray-500">No recent transactions</p>
            </div>
          ) : (
            <>
              <div className="max-h-[260px] overflow-y-auto">
                {recentTxs.map((tx) => {
                  const date = tx.blockTime
                    ? new Date(tx.blockTime * 1000).toLocaleString(undefined, {
                        month: "short", day: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })
                    : "Pending";
                  const txType = tx.txType ?? { label: "Transaction", color: "text-gray-500", icon: "generic" as const };
                  const showAmount = (txType.icon === "down" || txType.icon === "up") && txType.amount != null;
                  return (
                    <a
                      key={tx.sig}
                      href={`${EXPLORER_BASE}/${tx.sig}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2.5 border-b border-shadow-700/40 last:border-0 hover:bg-shadow-800/60 transition-colors group"
                    >
                      {/* Type icon */}
                      <span className={`shrink-0 ${txType.color}`}>
                        <TxIcon icon={txType.icon as TxType["icon"]} />
                      </span>
                      {/* Label + sig */}
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className={`text-[11px] font-semibold ${txType.color}`}>{txType.label}</span>
                        <span className="text-[9px] text-gray-600 font-mono truncate">
                          {tx.sig.slice(0, 10)}…{tx.sig.slice(-6)}
                        </span>
                      </div>
                      {/* Amount (for deposit/withdraw) + date + status */}
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        {showAmount && (
                          <span className={`text-[11px] font-semibold ${txType.color}`}>
                            {txType.icon === "down" ? "+" : "-"}{formatAmount(txType.amount!)}{" "}
                            <span className="text-[10px] opacity-80">{txType.symbol}</span>
                          </span>
                        )}
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${tx.err ? "bg-accent-red" : "bg-accent-green"}`} />
                          <span className="text-[9px] text-gray-600">{date}</span>
                          <ExternalLink className="w-3 h-3 text-gray-700 group-hover:text-gray-400 transition-colors" />
                        </div>
                      </div>
                    </a>
                  );
                })}
              </div>
              {txsHasMore && (
                <button
                  type="button"
                  onClick={() => void loadMoreTxs()}
                  disabled={txsLoadingMore}
                  className="flex items-center justify-center gap-1 w-full py-2 text-[10px] font-medium text-gray-500 hover:text-gray-300 border-t border-shadow-700/40 transition-colors disabled:opacity-40"
                >
                  {txsLoadingMore ? (
                    <>
                      <Clock className="w-3 h-3 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3" />
                      Show More
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </>
  );

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
        <>
          <div className="trade-header-popover absolute right-0 top-full mt-2 hidden w-72 border border-shadow-500 bg-shadow-900 shadow-2xl z-[400] sm:block">
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
