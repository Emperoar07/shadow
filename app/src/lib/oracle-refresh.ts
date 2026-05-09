import type { PublicKey } from "@solana/web3.js";

type OracleRefreshPayload = {
  success?: boolean;
  error?: string;
  refreshed?: boolean;
};

export async function ensureFreshMarketOracle({
  market,
  pairLabel,
  getAccessToken,
  operation = "using this market",
}: {
  market: PublicKey;
  pairLabel?: string;
  getAccessToken: () => Promise<string | null>;
  operation?: string;
}): Promise<void> {
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
      maxAgeSeconds: 240,
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
