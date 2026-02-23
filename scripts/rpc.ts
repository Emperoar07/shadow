import { clusterApiUrl, Commitment, Connection } from "@solana/web3.js";

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

const DEFAULT_RPC = clusterApiUrl("devnet");

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

