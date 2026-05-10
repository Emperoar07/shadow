import type { PublicKey } from "@solana/web3.js";

type OracleRefreshPayload = {
  success?: boolean;
  error?: string;
  refreshed?: boolean;
};

const warmupAttempts = new Map<string, number>();

type OracleRefreshRequest = {
  market: PublicKey;
  pairLabel?: string;
  getAccessToken: () => Promise<string | null>;
  operation?: string;
  maxAgeSeconds?: number;
  force?: boolean;
};

async function refreshMarketOracle({
  market,
  pairLabel,
  getAccessToken,
  operation = "using this market",
  maxAgeSeconds = 240,
  force = false,
}: OracleRefreshRequest): Promise<void> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error("Sign in again before refreshing the market oracle.");
  }

  const response = await fetch("/api/oracle-refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      market: market.toBase58(),
      pairLabel: pairLabel ?? "SOL-USD",
      maxAgeSeconds,
      force,
    }),
  });

  let payload: OracleRefreshPayload | null = null;
  try {
    payload = (await response.json()) as OracleRefreshPayload;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.success) {
    const detail = payload?.error ? ` ${payload.error}` : "";
    throw new Error(`Unable to refresh market oracle before ${operation}.${detail}`);
  }
}

export async function ensureFreshMarketOracle(request: OracleRefreshRequest): Promise<void> {
  await refreshMarketOracle(request);
}

export async function warmMarketOracle({
  minIntervalMs = 90_000,
  ...request
}: OracleRefreshRequest & { minIntervalMs?: number }): Promise<boolean> {
  const key = `${request.market.toBase58()}:${request.pairLabel ?? "SOL-USD"}`;
  const now = Date.now();
  const lastAttempt = warmupAttempts.get(key) ?? 0;
  if (now - lastAttempt < minIntervalMs) return false;
  warmupAttempts.set(key, now);

  try {
    await refreshMarketOracle({
      ...request,
      operation: request.operation ?? "warming market oracle",
      maxAgeSeconds: request.maxAgeSeconds ?? 180,
    });
    return true;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[Shadow][oracle-warmup] skipped", error);
    }
    return false;
  }
}
