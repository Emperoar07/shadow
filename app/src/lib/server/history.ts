import { AnchorProvider } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { ShadowPerpClient } from "../client";
import { getRuntimeConfig } from "../runtime";
import { normalizePositionStatus, getDummyWallet } from "../arcium-callback-diag";
import type {
  HistoryTxType,
  IndexedHistoryPosition,
  IndexedRecentTx,
  WalletHistorySnapshot,
} from "../history";

const DEFAULT_RPC_ENDPOINT = "https://api.devnet.solana.com";
const HISTORY_CACHE_TTL_MS = 20_000;
const HISTORY_PAGE_SIZE = 12;
const CURRENT_SCAN_NOTICE =
  "Position history is reconstructed from current closed and liquidated accounts. It is not a durable trade ledger yet.";

const INSTRUCTION_TYPE_MAP: Record<string, HistoryTxType> = {
  depositcollateral: { label: "Deposit Collateral", color: "text-accent-green", icon: "down" },
  withdrawcollateral: { label: "Withdraw Collateral", color: "text-accent-red", icon: "up" },
  openposition: { label: "Open Position", color: "text-accent-purple", icon: "open" },
  closeposition: { label: "Close Position", color: "text-yellow-400", icon: "close" },
  addprivateorder: { label: "Order Submitted", color: "text-accent-purple", icon: "ref", detail: "Submitted through the private flow" },
  settleprivateposition: { label: "Position Settled", color: "text-yellow-300", icon: "close" },
  liquidateposition: { label: "Liquidation", color: "text-accent-red", icon: "close" },
  updatefundingrate: { label: "Funding Rate Update", color: "text-blue-400", icon: "generic" },
  initfundingstate: { label: "Funding Initialized", color: "text-gray-400", icon: "generic" },
  setfundingpremium: { label: "Funding Premium Set", color: "text-gray-400", icon: "generic" },
  setoicaps: { label: "OI Cap Update", color: "text-gray-400", icon: "generic" },
  updatemarkprice: { label: "Mark Price Update", color: "text-gray-400", icon: "generic" },
};

// Helius Enhanced Transaction shape (subset we use)
interface HeliusTx {
  signature: string;
  slot: number;
  timestamp: number | null;
  transactionError: unknown | null;
  type: string;
  description: string;
  nativeTransfers?: { fromUserAccount: string; toUserAccount: string; amount: number }[];
  tokenTransfers?: { fromUserAccount: string; toUserAccount: string; tokenAmount: number; mint: string }[];
  instructions?: { programId: string; data: string; accounts: string[] }[];
  events?: Record<string, unknown>;
}

type HistoryCacheEntry = {
  expiresAt: number;
  payload: WalletHistorySnapshot;
};

const historyCache = new Map<string, HistoryCacheEntry>();

function normalizeRpcUrl(raw?: string): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value || null;
}

function collectRpcCandidates(): string[] {
  const raw = [
    process.env.SOLANA_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    process.env.SOLANA_RPC_URLS,
    process.env.NEXT_PUBLIC_SOLANA_RPC_URLS,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const normalized = normalizeRpcUrl(item);
    if (!normalized) continue;
    for (const candidate of normalized.split(/[\n,]+/)) {
      const url = normalizeRpcUrl(candidate);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
  if (out.length === 0) out.push(DEFAULT_RPC_ENDPOINT);
  return out;
}

const RPC_CANDIDATES = collectRpcCandidates();
const RUNTIME_CONFIG = getRuntimeConfig();

function getHeliusApiKey(): string | null {
  return normalizeRpcUrl(process.env.HELIUS_API_KEY);
}

// Fetch parsed transactions from Helius Enhanced Transactions API
async function fetchHeliusTransactions(
  wallet: string,
  limit: number,
  before?: string
): Promise<HeliusTx[]> {
  const apiKey = getHeliusApiKey();
  if (!apiKey) return [];

  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set("before", before);

  const url = `https://api-devnet.helius-rpc.com/v0/addresses/${wallet}/transactions?api-key=${apiKey}&${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    if (res.status === 429) throw new Error("429 Helius rate limited");
    throw new Error(`Helius API error ${res.status}`);
  }
  return (await res.json()) as HeliusTx[];
}

function heliusTxToIndexed(tx: HeliusTx, wallet: string): IndexedRecentTx {
  const normalizedType = tx.type.replace(/_/g, "").toLowerCase();
  const txType = INSTRUCTION_TYPE_MAP[normalizedType] ?? inferTxTypeFromDescription(tx, wallet);

  return {
    sig: tx.signature,
    slot: tx.slot,
    err: tx.transactionError !== null,
    blockTime: tx.timestamp,
    memo: tx.description?.trim() || null,
    txType,
  };
}

function inferTxTypeFromDescription(tx: HeliusTx, wallet: string): HistoryTxType {
  const desc = tx.description.toLowerCase();

  const inbound = tx.tokenTransfers?.some((t) => t.toUserAccount === wallet && t.tokenAmount > 0);
  const outbound = tx.tokenTransfers?.some((t) => t.fromUserAccount === wallet && t.tokenAmount > 0);

  if (inbound && desc.includes("transfer")) return { label: "Token Received", color: "text-accent-green", icon: "down" };
  if (outbound && desc.includes("transfer")) return { label: "Token Sent", color: "text-accent-red", icon: "up" };

  return { label: tx.type || "Transaction", color: "text-gray-500", icon: "generic" };
}

async function withHistoryConnection<T>(
  fn: (connection: Connection, rpcUrl: string) => Promise<T>
): Promise<T> {
  const candidates = RPC_CANDIDATES;
  let lastError: unknown = null;
  for (const rpcUrl of candidates) {
    const connection = new Connection(rpcUrl, "confirmed");
    try {
      return await fn(connection, rpcUrl);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("No healthy history RPC endpoint available.");
}


async function loadHistorySnapshot(
  owner: PublicKey,
  options: { limit: number; before?: string; includePositions: boolean }
): Promise<WalletHistorySnapshot> {
  const cacheKey = `${owner.toBase58()}:${options.limit}:${options.before ?? ""}:${options.includePositions ? 1 : 0}`;
  const cached = historyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  const wallet = owner.toBase58();

  // Try Helius Enhanced API first — one call, pre-parsed, no rate limit risk
  let activity: IndexedRecentTx[] = [];
  let nextBefore: string | null = null;
  let hasMore = false;
  let usedHelius = false;

  try {
    const heliusTxs = await fetchHeliusTransactions(wallet, options.limit, options.before);
    if (heliusTxs.length > 0) {
      activity = heliusTxs.map((tx) => heliusTxToIndexed(tx, wallet));
      nextBefore = heliusTxs.at(-1)?.signature ?? null;
      hasMore = heliusTxs.length >= options.limit;
      usedHelius = true;
    }
  } catch {
    // fall through to RPC path
  }

  // Fallback: raw RPC getSignaturesForAddress (no parsed tx details, just sigs)
  if (!usedHelius) {
    await withHistoryConnection(async (connection) => {
      const sigs = await connection.getSignaturesForAddress(owner, {
        limit: options.limit,
        before: options.before,
      });
      activity = sigs.map((s) => ({
        sig: s.signature,
        slot: s.slot,
        err: s.err !== null,
        blockTime: s.blockTime ?? null,
        memo: s.memo ?? null,
      }));
      nextBefore = sigs.at(-1)?.signature ?? null;
      hasMore = sigs.length >= options.limit;
    });
  }

  // Position history still uses on-chain account scan (no Helius equivalent needed)
  const historyPositions: IndexedHistoryPosition[] = [];
  if (options.includePositions) {
    await withHistoryConnection(async (connection) => {
      const runtime = RUNTIME_CONFIG;
      const provider = new AnchorProvider(connection, getDummyWallet(owner), {
        commitment: "confirmed",
      });
      const client = new ShadowPerpClient(provider, runtime);
      const markets = Array.from(
        new Set(Object.values(runtime.marketRegistry).map((market) => market.toBase58()))
      ).map((address) => new PublicKey(address));
      const positions = await client.getUserPositionAccountsAcrossMarkets(markets, owner);
      const labelByMarket = new Map(
        Object.entries(runtime.marketRegistry).map(([label, address]) => [address.toBase58(), label] as const)
      );

      for (const entry of positions) {
        const account = entry.account as any;
        const status = normalizePositionStatus(account.status);
        if (status !== 3 && status !== 4) continue;
        const encData: number[] | Uint8Array = account.encryptedData ?? [];
        const marketAddress = new PublicKey(account.market).toBase58();
        historyPositions.push({
          address: entry.publicKey.toBase58(),
          marketAddress,
          pairLabel: labelByMarket.get(marketAddress) ?? "SOL-USD",
          index: account.index?.toString?.() ?? "0",
          status,
          margin: Number(account.margin.toString()) / 1_000_000,
          openedAt: Number(account.openedAt.toString()) * 1000,
          realizedPnl: Number(account.realizedPnl.toString()) / 1_000_000,
          hasEncryptedData: Array.from(encData).some((b: number) => b !== 0),
        });
      }
      historyPositions.sort((a, b) => b.openedAt - a.openedAt);
    });
  }

  const snapshot: WalletHistorySnapshot = {
    activity,
    historyPositions,
    historyPositionsSource: "current-scan",
    historyPositionsNotice: options.includePositions ? CURRENT_SCAN_NOTICE : undefined,
    nextBefore,
    hasMore,
    fetchedAt: Date.now(),
  };

  historyCache.set(cacheKey, { expiresAt: Date.now() + HISTORY_CACHE_TTL_MS, payload: snapshot });
  return snapshot;
}

export async function getHistorySnapshot(
  wallet: string,
  options: { limit?: number; before?: string; includePositions?: boolean } = {}
): Promise<WalletHistorySnapshot> {
  const owner = new PublicKey(wallet);
  const limit = Math.max(1, Math.min(options.limit ?? HISTORY_PAGE_SIZE, 40));
  return loadHistorySnapshot(owner, {
    limit,
    before: options.before,
    includePositions: options.includePositions ?? false,
  });
}
