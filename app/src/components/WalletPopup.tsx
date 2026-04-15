import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Wallet, Clock, ExternalLink, ChevronDown, ArrowDownToLine, ArrowUpFromLine, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { fetchWalletHistory } from "../lib/history";
import { DEVNET_TOKENS, WALLET_DISPLAY_TOKENS } from "../lib/tokens";

const EXPLORER_BASE = "https://explorer.solana.com/tx";
const INITIAL_TX_COUNT = 5;
const LOAD_MORE_COUNT = 10;
const SHADOWPERP_PROGRAM_ID = process.env.NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID ?? "ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4";
const TX_ACTIVITY_CACHE_PREFIX = "shadowperp:ui:activity:v2";
const PARSED_TX_BATCH_SIZE = 3;
const PARSED_TX_RETRIES = 2;


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
  detail?: string;
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

function formatBalance(bal: number): string {
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

const MINT_SYMBOLS = new Map<string, string>(
  Object.values(DEVNET_TOKENS).map((token) => [token.mint.toBase58(), token.symbol])
);

const INSTRUCTION_TYPE_MAP: Record<string, TxType> = {
  depositcollateral: { label: "Deposit Collateral", color: "text-accent-green", icon: "down" },
  depositcollateralwithsession: { label: "Deposit Collateral", color: "text-accent-green", icon: "down" },
  withdrawcollateral: { label: "Withdraw Collateral", color: "text-accent-red", icon: "up" },
  withdrawcollateralwithsession: { label: "Withdraw Collateral", color: "text-accent-red", icon: "up" },
  createtradesession: { label: "Start Session", color: "text-cyan-300", icon: "ref", detail: "Trading session approved" },
  revoketradesession: { label: "Revoke Session", color: "text-yellow-300", icon: "ref", detail: "Trading session closed" },
  openposition: { label: "Open Position", color: "text-accent-purple", icon: "open" },
  openpositionwithsession: { label: "Open Position", color: "text-accent-purple", icon: "open" },
  closeposition: { label: "Close Position", color: "text-yellow-400", icon: "close" },
  closepositionwithsession: { label: "Close Position", color: "text-yellow-400", icon: "close" },
  addprivateorder: { label: "Order Submitted", color: "text-accent-purple", icon: "ref", detail: "Submitted through the private flow" },
  settleprivateposition: { label: "Position Settled", color: "text-yellow-300", icon: "close" },
  liquidateposition: { label: "Liquidation", color: "text-accent-red", icon: "close" },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimited(error: unknown): boolean {
  const message = String((error as { message?: string } | undefined)?.message ?? error ?? "");
  return message.includes("429") || message.toLowerCase().includes("too many requests");
}

function getActivityCacheKey(walletPk: PublicKey): string {
  return `${TX_ACTIVITY_CACHE_PREFIX}:${walletPk.toBase58()}`;
}

function readTxTypeCache(walletPk: PublicKey): Record<string, TxType> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(getActivityCacheKey(walletPk));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TxType>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeTxTypeCache(walletPk: PublicKey, entries: Record<string, TxType>): void {
  if (typeof window === "undefined") return;
  try {
    const existing = readTxTypeCache(walletPk);
    const merged = { ...existing, ...entries };
    const recentEntries = Object.entries(merged).slice(-100);
    window.localStorage.setItem(
      getActivityCacheKey(walletPk),
      JSON.stringify(Object.fromEntries(recentEntries))
    );
  } catch {
    // ignore cache failures
  }
}

function extractInstructionName(
  ptx: import("@solana/web3.js").ParsedTransactionWithMeta
): string | null {
  const logs = ptx.meta?.logMessages ?? [];
  for (const line of logs) {
    const match = line.match(/Instruction:\s+([A-Za-z0-9_]+)/);
    if (match?.[1]) return match[1];
  }

  for (const ix of ptx.transaction.message.instructions) {
    const programId = "programId" in ix && ix.programId ? ix.programId.toBase58() : null;
    if (programId !== SHADOWPERP_PROGRAM_ID) continue;

    const parsedType = (ix as { parsed?: { type?: string } }).parsed?.type;
    if (parsedType) return parsedType;
  }

  return null;
}

function getWalletTokenDelta(
  ptx: import("@solana/web3.js").ParsedTransactionWithMeta,
  walletPk: PublicKey
): { amount: number; symbol: string } | null {
  const wallet = walletPk.toBase58();
  const deltas = new Map<string, number>();

  const addBalance = (
    entry: any,
    direction: -1 | 1
  ) => {
    const owner = (entry as any)?.owner;
    if (owner !== wallet) return;
    const uiAmount = entry.uiTokenAmount.uiAmount ?? 0;
    deltas.set(entry.mint, (deltas.get(entry.mint) ?? 0) + uiAmount * direction);
  };

  (ptx.meta?.preTokenBalances ?? []).forEach((entry) => addBalance(entry, -1));
  (ptx.meta?.postTokenBalances ?? []).forEach((entry) => addBalance(entry, 1));

  let bestMint: string | null = null;
  let bestAmount = 0;
  for (const [mint, amount] of deltas.entries()) {
    if (Math.abs(amount) <= Math.abs(bestAmount)) continue;
    bestMint = mint;
    bestAmount = amount;
  }

  if (!bestMint || Math.abs(bestAmount) < 0.000001) return null;
  return {
    amount: Math.abs(bestAmount),
    symbol: MINT_SYMBOLS.get(bestMint) ?? "tokens",
  };
}

async function fetchParsedTransactionsResilient(
  connection: import("@solana/web3.js").Connection,
  signatures: string[]
): Promise<(import("@solana/web3.js").ParsedTransactionWithMeta | null)[]> {
  const results: (import("@solana/web3.js").ParsedTransactionWithMeta | null)[] = new Array(signatures.length).fill(null);

  for (let start = 0; start < signatures.length; start += PARSED_TX_BATCH_SIZE) {
    const batch = signatures.slice(start, start + PARSED_TX_BATCH_SIZE);

    try {
      const parsedBatch = await connection.getParsedTransactions(batch, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      for (let i = 0; i < parsedBatch.length; i += 1) {
        results[start + i] = parsedBatch[i];
      }
      continue;
    } catch (error) {
      if (batch.length > 1 && isRateLimited(error)) {
        await sleep(300);
      }
    }

    for (let i = 0; i < batch.length; i += 1) {
      const sig = batch[i];
      for (let attempt = 0; attempt <= PARSED_TX_RETRIES; attempt += 1) {
        try {
          results[start + i] = await connection.getParsedTransaction(sig, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
          });
          break;
        } catch (error) {
          if (attempt >= PARSED_TX_RETRIES || !isRateLimited(error)) {
            break;
          }
          await sleep(400 * (attempt + 1));
        }
      }
    }
  }

  return results;
}

async function enrichTxTypes(
  connection: import("@solana/web3.js").Connection,
  txs: RecentTx[],
  walletPk: PublicKey
): Promise<RecentTx[]> {
  const cached = readTxTypeCache(walletPk);
  const baseTxs = txs.map((tx) => (cached[tx.sig] ? { ...tx, txType: cached[tx.sig] } : tx));
  const unenriched = baseTxs.filter((t) => !t.txType);
  if (unenriched.length === 0) return baseTxs;

  const parsed = await fetchParsedTransactionsResilient(
    connection,
    unenriched.map((t) => t.sig)
  );

  const enriched = new Map<string, TxType>();
  const cacheUpdates: Record<string, TxType> = {};

  for (let i = 0; i < unenriched.length; i++) {
    const tx = unenriched[i];
    const ptx = parsed[i];
    if (!ptx) continue;

    let txType: TxType | null = null;
    const instructionName = extractInstructionName(ptx);
    const normalizedInstruction = instructionName?.replace(/_/g, "").toLowerCase() ?? "";
    const walletDelta = getWalletTokenDelta(ptx, walletPk);

    if (normalizedInstruction && INSTRUCTION_TYPE_MAP[normalizedInstruction]) {
      txType = { ...INSTRUCTION_TYPE_MAP[normalizedInstruction] };
      if ((txType.icon === "down" || txType.icon === "up") && walletDelta) {
        txType.amount = walletDelta.amount;
        txType.symbol = walletDelta.symbol;
      }
    }

    // Fallback: memo-based
    if (!txType) {
      const lower = (tx.memo ?? "").toLowerCase();
      if (lower.includes("deposit") || lower.includes("collateral")) {
        txType = {
          label: "Deposit Collateral",
          color: "text-accent-green",
          icon: "down",
          amount: walletDelta?.amount,
          symbol: walletDelta?.symbol,
        };
      } else if (lower.includes("withdraw")) {
        txType = {
          label: "Withdraw Collateral",
          color: "text-accent-red",
          icon: "up",
          amount: walletDelta?.amount,
          symbol: walletDelta?.symbol,
        };
      } else if (instructionName) {
        txType = {
          label: instructionName.replace(/([A-Z])/g, " $1").trim(),
          color: "text-gray-400",
          icon: "ref",
        };
      } else {
        txType = { label: "Transaction", color: "text-gray-500", icon: "generic" };
      }
    }

    enriched.set(tx.sig, txType);
    cacheUpdates[tx.sig] = txType;
  }

  if (Object.keys(cacheUpdates).length > 0) {
    writeTxTypeCache(walletPk, cacheUpdates);
  }

  return baseTxs.map((t) => enriched.has(t.sig) ? { ...t, txType: enriched.get(t.sig)! } : t);
}

export default function WalletPopup({ marginBalance, onOpenCollateral }: WalletPopupProps) {
  const { connection } = useConnection();
  const { publicKey: adapterPublicKey, connected } = useWallet();
  const { authenticated } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  // Embedded wallet for email/social users
  const privyWallet = solanaWallets.find((w) => w.walletClientType === "privy");
  const privyPublicKey = privyWallet?.address ? (() => { try { return new PublicKey(privyWallet.address); } catch { return null; } })() : null;
  const publicKey = adapterPublicKey ?? (authenticated ? privyPublicKey : null);
  const isConnected = connected || (authenticated && !!privyPublicKey);
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
  const tradingAccountLabel =
    marginBalance !== null && marginBalance > 0
      ? "Collateral is ready for trading."
      : "Deposit mUSDC to start trading.";

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
    if (!publicKey || !isConnected || !open) {
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
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void fetchBalances();
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publicKey, isConnected, connection, open]);

  const loadRecentTxsDirect = async (limit: number, before?: string) => {
    if (!publicKey) return { txs: [] as RecentTx[], hasMore: false };
    const sigs = await connection.getSignaturesForAddress(publicKey, {
      limit,
      before,
    });
    const base: RecentTx[] = sigs.map((s) => ({
      sig: s.signature,
      slot: s.slot,
      err: s.err !== null,
      blockTime: s.blockTime ?? null,
      memo: s.memo ?? null,
    }));
    const enriched = await enrichTxTypes(connection, base, publicKey);
    return { txs: enriched, hasMore: sigs.length >= limit };
  };

  // Fetch recent transactions when activity tab is opened
  useEffect(() => {
    if (activeTab !== "activity" || !publicKey || !isConnected) return;
    let cancelled = false;
    setTxsLoading(true);
    setRecentTxs([]);
    setTxsHasMore(true);
    void (async () => {
      try {
        const snapshot = await fetchWalletHistory({
          wallet: publicKey.toBase58(),
          limit: INITIAL_TX_COUNT,
          includePositions: false,
        });
        if (!cancelled) {
          setRecentTxs(snapshot.activity as RecentTx[]);
          setTxsHasMore(snapshot.hasMore);
        }
      } catch {
        try {
          const fallback = await loadRecentTxsDirect(INITIAL_TX_COUNT);
          if (!cancelled) {
            setRecentTxs(fallback.txs);
            setTxsHasMore(fallback.hasMore);
          }
        } catch {
          // ignore
        }
      } finally {
        if (!cancelled) setTxsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, publicKey, isConnected, connection]);

  const loadMoreTxs = async () => {
    if (!publicKey || txsLoadingMore || recentTxs.length === 0) return;
    setTxsLoadingMore(true);
    try {
      const lastSig = recentTxs[recentTxs.length - 1].sig;
      try {
        const snapshot = await fetchWalletHistory({
          wallet: publicKey.toBase58(),
          limit: LOAD_MORE_COUNT,
          before: lastSig,
          includePositions: false,
        });
        setRecentTxs((prev) => [...prev, ...(snapshot.activity as RecentTx[])]);
        setTxsHasMore(snapshot.hasMore);
      } catch {
        const fallback = await loadRecentTxsDirect(LOAD_MORE_COUNT, lastSig);
        setRecentTxs((prev) => [...prev, ...fallback.txs]);
        setTxsHasMore(fallback.hasMore);
      }
    } catch {
      // ignore
    } finally {
      setTxsLoadingMore(false);
    }
  };

  const hasBalances = isConnected && (solBalance !== null || tokenBalances.length > 0);

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
                    <span className="text-[12px] font-semibold text-gray-200">{formatBalance(solBalance)}</span>
                  </div>
              )}
              {tokenBalances.map((tb) => (
                <div key={tb.symbol} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tb.color }} />
                    <span className="text-[12px] text-gray-400">{tb.symbol}</span>
                  </div>
                  <span className="text-[12px] font-semibold text-gray-200">{formatBalance(tb.balance)}</span>
                </div>
              ))}
            </div>
          ) : isConnected ? (
            <div className="px-3 py-3">
              <p className="text-[11px] leading-relaxed text-gray-500">No wallet balances detected yet.</p>
            </div>
          ) : (
            <div className="px-3 py-3">
              <p className="text-[11px] leading-relaxed text-gray-500">Connect your wallet to see balances and recent activity.</p>
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
            <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
              {tradingAccountLabel}
            </p>
          </div>

          {onOpenCollateral && (
            <div className="border-t border-shadow-600 p-2">
              <button
                type="button"
                onClick={() => {
                  onOpenCollateral();
                  setOpen(false);
                }}
                className="w-full rounded-xl border border-accent-purple/30 bg-accent-purple/10 py-2 text-[11px] font-medium text-accent-purple transition-colors hover:bg-accent-purple/20"
              >
                {marginBalance === 0 || marginBalance === null ? "Add Collateral" : "Manage Collateral"}
              </button>
            </div>
          )}
        </>
      )}

      {/* Activity tab */}
      {activeTab === "activity" && (
        <div className="flex flex-col">
          {!isConnected ? (
            <div className="px-3 py-3">
              <p className="text-[11px] leading-relaxed text-gray-500">Connect your wallet to see on-chain activity.</p>
            </div>
          ) : txsLoading ? (
            <div className="px-3 py-4 text-center">
              <Clock className="w-4 h-4 text-gray-600 mx-auto mb-1.5 animate-spin" />
              <p className="text-[11px] text-gray-500">Loading transactions...</p>
            </div>
          ) : recentTxs.length === 0 ? (
            <div className="px-3 py-3">
              <p className="text-[11px] leading-relaxed text-gray-500">No recent on-chain activity yet.</p>
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
                        <span className="text-[9px] text-gray-600 truncate">
                          {txType.detail ?? `${tx.sig.slice(0, 10)}...${tx.sig.slice(-6)}`}
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
                      Show older activity
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
          <div className="trade-header-popover absolute right-0 top-full mt-2 hidden w-72 overflow-hidden rounded-2xl border border-shadow-500 bg-shadow-900 shadow-2xl z-[400] sm:block">
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
