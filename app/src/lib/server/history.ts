import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { ShadowPerpClient } from "../client";
import { getRuntimeConfig } from "../runtime";
import { DEVNET_TOKENS } from "../tokens";
import type {
  HistoryTxType,
  IndexedHistoryPosition,
  IndexedRecentTx,
  WalletHistorySnapshot,
} from "../history";

const DEFAULT_RPC_ENDPOINT = "https://api.devnet.solana.com";
const HISTORY_CACHE_TTL_MS = 20_000;
const HISTORY_PAGE_SIZE = 12;
const PARSED_TX_BATCH_SIZE = 3;
const PARSED_TX_RETRIES = 2;
const MINT_SYMBOLS = new Map<string, string>(
  Object.values(DEVNET_TOKENS).map((token) => [token.mint.toBase58(), token.symbol])
);

const INSTRUCTION_TYPE_MAP: Record<string, HistoryTxType> = {
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

type HistoryCacheEntry = {
  expiresAt: number;
  payload: WalletHistorySnapshot;
};

const historyCache = new Map<string, HistoryCacheEntry>();

function normalizeRpcUrl(raw?: string): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  if (value.startsWith("<") && value.endsWith(">")) {
    value = value.slice(1, -1).trim();
  }
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

function resolveHistoryRpcUrl(): string {
  return collectRpcCandidates()[0] ?? DEFAULT_RPC_ENDPOINT;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimited(error: unknown): boolean {
  const message = String((error as { message?: string } | undefined)?.message ?? error ?? "");
  return message.includes("429") || message.toLowerCase().includes("too many requests");
}

function normalizePositionStatus(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object") {
    const key = Object.keys(raw as Record<string, unknown>)[0];
    if (!key) return -1;
    const normalized = key.toLowerCase();
    if (normalized === "pending") return 0;
    if (normalized === "open") return 1;
    if (normalized === "closing") return 2;
    if (normalized === "closed") return 3;
    if (normalized === "liquidated") return 4;
    if (normalized === "closedpendingsettlement") return 5;
    if (normalized === "liquidatedpendingsettlement") return 6;
  }
  return -1;
}

function extractInstructionName(ptx: ParsedTransactionWithMeta): string | null {
  const logs = ptx.meta?.logMessages ?? [];
  for (const line of logs) {
    const match = line.match(/Instruction:\s+([A-Za-z0-9_]+)/);
    if (match?.[1]) return match[1];
  }
  return null;
}

function getWalletTokenDelta(
  ptx: ParsedTransactionWithMeta,
  walletPk: PublicKey,
  symbolByMint: Map<string, string>
): { amount: number; symbol: string } | null {
  const wallet = walletPk.toBase58();
  const deltas = new Map<string, number>();

  const addBalance = (entry: any, direction: -1 | 1): void => {
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
    symbol: symbolByMint.get(bestMint) ?? "tokens",
  };
}

async function fetchParsedTransactionsResilient(
  connection: Connection,
  signatures: string[]
): Promise<(ParsedTransactionWithMeta | null)[]> {
  const results: (ParsedTransactionWithMeta | null)[] = new Array(signatures.length).fill(null);

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

function buildTxType(ptx: ParsedTransactionWithMeta, walletPk: PublicKey): HistoryTxType {
  const instructionName = extractInstructionName(ptx);
  const normalizedInstruction = instructionName?.replace(/_/g, "").toLowerCase() ?? "";
  const walletDelta = getWalletTokenDelta(ptx, walletPk, MINT_SYMBOLS);

  if (normalizedInstruction && INSTRUCTION_TYPE_MAP[normalizedInstruction]) {
    const txType = { ...INSTRUCTION_TYPE_MAP[normalizedInstruction] };
    if ((txType.icon === "down" || txType.icon === "up") && walletDelta) {
      txType.amount = walletDelta.amount;
      txType.symbol = walletDelta.symbol;
    }
    return txType;
  }

  return {
    label: instructionName ?? "Transaction",
    color: "text-gray-500",
    icon: "generic",
  };
}

function getDummyWallet(owner: PublicKey): Wallet {
  return {
    publicKey: owner,
    signTransaction: async <T>(tx: T) => tx,
    signAllTransactions: async <T>(txs: T[]) => txs,
  } as unknown as Wallet;
}

async function loadHistorySnapshot(
  owner: PublicKey,
  options: { limit: number; before?: string; includePositions: boolean }
): Promise<WalletHistorySnapshot> {
  const rpcUrl = resolveHistoryRpcUrl();
  const connection = new Connection(rpcUrl, "confirmed");
  const cacheKey = `${owner.toBase58()}:${options.limit}:${options.before ?? ""}:${options.includePositions ? 1 : 0}`;
  const cached = historyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  const sigs = await connection.getSignaturesForAddress(owner, {
    limit: options.limit,
    before: options.before,
  });
  const activityBase: IndexedRecentTx[] = sigs.map((s) => ({
    sig: s.signature,
    slot: s.slot,
    err: s.err !== null,
    blockTime: s.blockTime ?? null,
    memo: s.memo ?? null,
  }));

  const parsed = await fetchParsedTransactionsResilient(
    connection,
    activityBase.map((tx) => tx.sig)
  );
  const activity = activityBase.map((tx, index) => {
    const ptx = parsed[index];
    if (!ptx) return tx;
    return { ...tx, txType: buildTxType(ptx, owner) };
  });

  const historyPositions: IndexedHistoryPosition[] = [];
  if (options.includePositions) {
    const runtime = getRuntimeConfig();
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
  }

  const snapshot: WalletHistorySnapshot = {
    activity,
    historyPositions,
    nextBefore: sigs.at(-1)?.signature ?? null,
    hasMore: sigs.length >= options.limit,
    fetchedAt: Date.now(),
  };
  historyCache.set(cacheKey, {
    expiresAt: Date.now() + HISTORY_CACHE_TTL_MS,
    payload: snapshot,
  });
  return snapshot;
}

export async function getHistorySnapshot(
  wallet: string,
  options: { limit?: number; before?: string; includePositions?: boolean } = {}
): Promise<WalletHistorySnapshot> {
  const owner = new PublicKey(wallet);
  const limit = Math.max(1, Math.min(options.limit ?? HISTORY_PAGE_SIZE, 100));
  return loadHistorySnapshot(owner, {
    limit,
    before: options.before,
    includePositions: options.includePositions ?? false,
  });
}
