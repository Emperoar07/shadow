import {
  Commitment,
  Connection,
  Keypair,
  SendOptions,
  Signer,
  Transaction,
} from "@solana/web3.js";

type RpcResolveOptions = {
  preferred?: string;
  commitment?: Commitment;
  timeoutMs?: number;
  requireHealthy?: boolean;
};

type RpcAttempt = {
  url: string;
  ok: boolean;
  error?: string;
};

export type RpcResolveResult = {
  rpcUrl: string;
  candidates: string[];
  attempts: RpcAttempt[];
};

export type PollingConfirmOptions = {
  commitment?: Commitment;
  timeoutMs?: number;
  pollMs?: number;
  sendOptions?: SendOptions;
  signers?: Signer[];
};

type RetryRpcOptions = {
  attempts?: number;
  delayMs?: number;
};

const DEFAULT_RPC = "https://api.devnet.solana.com";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function normalizeRpcUrl(raw?: string): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;

  // Accept user input like SOLANA_RPC_URL=<https://...>
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

function parseRpcList(raw?: string): string[] {
  const normalized = normalizeRpcUrl(raw);
  if (!normalized) return [];
  return normalized
    .split(/[\n,]+/)
    .map((item) => normalizeRpcUrl(item))
    .filter((item): item is string => Boolean(item));
}

export function collectRpcCandidates(preferred?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (url: string | null) => {
    if (!url) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  push(normalizeRpcUrl(preferred));

  for (const url of parseRpcList(process.env.SOLANA_RPC_URLS)) push(url);
  for (const url of parseRpcList(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS)) push(url);

  push(normalizeRpcUrl(process.env.SOLANA_RPC_URL));
  push(normalizeRpcUrl(process.env.NEXT_PUBLIC_SOLANA_RPC_URL));
  push(DEFAULT_RPC);

  return out;
}

export async function resolveRpcEndpoint(
  options: RpcResolveOptions = {}
): Promise<RpcResolveResult> {
  const commitment = options.commitment ?? "confirmed";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const requireHealthy = options.requireHealthy ?? true;
  const candidates = collectRpcCandidates(options.preferred);
  const attempts: RpcAttempt[] = [];

  for (const url of candidates) {
    const connection = new Connection(url, commitment);
    try {
      await withTimeout(connection.getLatestBlockhash("processed"), timeoutMs, url);
      attempts.push({ url, ok: true });
      return { rpcUrl: url, candidates, attempts };
    } catch (error: any) {
      attempts.push({
        url,
        ok: false,
        error: String(error?.message || error).slice(0, 220),
      });
    }
  }

  if (!requireHealthy) {
    return {
      rpcUrl: candidates[0] ?? DEFAULT_RPC,
      candidates,
      attempts,
    };
  }

  const details = attempts
    .map((a) => `- ${a.url} :: ${a.error ?? "unknown error"}`)
    .join("\n");
  throw new Error(`No healthy RPC endpoint found.\n${details}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientRpcError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("socket") ||
    message.includes("timed out") ||
    message.includes("429") ||
    message.includes("too many requests") ||
    message.includes("und_err_")
  );
}

export async function retryRpcCall<T>(
  label: string,
  fn: () => Promise<T>,
  options: RetryRpcOptions = {}
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientRpcError(error)) {
        throw error;
      }
      console.warn(`${label} transient RPC failure (attempt ${attempt}/${attempts}), retrying...`);
      await sleep(delayMs * attempt);
    }
  }

  throw lastError;
}

export async function sendAndConfirmWithPolling(
  connection: Connection,
  payer: Keypair,
  tx: Transaction,
  options: PollingConfirmOptions = {}
): Promise<string> {
  const commitment = options.commitment ?? "confirmed";
  const timeoutMs = options.timeoutMs ?? 90_000;
  const pollMs = options.pollMs ?? 1_500;

  tx.feePayer = tx.feePayer ?? payer.publicKey;

  const latestBlockhash = await retryRpcCall("getLatestBlockhash", () =>
    connection.getLatestBlockhash(commitment)
  );
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.sign(payer, ...(options.signers ?? []));

  const signature = await retryRpcCall("sendRawTransaction", () =>
    connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: commitment,
      ...(options.sendOptions ?? {}),
    })
  );

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const statuses = await retryRpcCall("getSignatureStatuses", () =>
        connection.getSignatureStatuses([signature], {
          searchTransactionHistory: false,
        })
      );
      const status = statuses.value[0];
      if (status?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      }
      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      ) {
        return signature;
      }
    } catch (error: any) {
      const message = String(error?.message || error);
      if (message.includes("Transaction failed:")) throw error;
    }

    const currentBlockHeight = await retryRpcCall("getBlockHeight", () =>
      connection.getBlockHeight(commitment)
    );
    if (currentBlockHeight > latestBlockhash.lastValidBlockHeight) {
      throw new Error(
        `Transaction expired before confirmation: ${signature}`
      );
    }

    await sleep(pollMs);
  }

  throw new Error(
    `Transaction was not confirmed in ${(timeoutMs / 1000).toFixed(2)} seconds. Check signature ${signature}.`
  );
}

