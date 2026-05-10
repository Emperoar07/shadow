import { PrivyClient } from "@privy-io/server-auth";
import type { NextApiRequest } from "next";
import { getRequestIp } from "./request-ip";

let privyClient: PrivyClient | null = null;

function resolvePrivyAppId(): string {
  const appId =
    process.env.PRIVY_APP_ID?.trim() ||
    process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ||
    "";
  if (!appId) {
    throw new Error("Missing PRIVY_APP_ID");
  }
  return appId;
}

function resolvePrivyAppSecret(): string {
  const appSecret = process.env.PRIVY_APP_SECRET?.trim() || "";
  if (!appSecret) {
    throw new Error("Missing PRIVY_APP_SECRET");
  }
  return appSecret;
}

export function getPrivyServerClient(): PrivyClient {
  if (privyClient) return privyClient;
  privyClient = new PrivyClient(resolvePrivyAppId(), resolvePrivyAppSecret());
  return privyClient;
}

export function extractBearerToken(authorization?: string | null): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token;
}

export async function requirePrivyUser(req: NextApiRequest): Promise<{
  userId: string;
  user: Awaited<ReturnType<PrivyClient["getUser"]>>;
}> {
  const authorization = req.headers.authorization;
  const token = extractBearerToken(Array.isArray(authorization) ? authorization[0] : authorization);
  if (!token) {
    throw new Error("Missing Privy bearer token.");
  }

  const privy = getPrivyServerClient();
  const claims = await privy.verifyAuthToken(token);
  const user = await privy.getUser(claims.userId);
  return { userId: claims.userId, user };
}

export async function requirePrivySolanaWallet(
  req: NextApiRequest,
  walletAddress: string
): Promise<{ userId: string }> {
  const { userId, user } = await requirePrivyUser(req);
  const hasLinkedWallet = user.linkedAccounts.some((account) => {
    if (account.type !== "wallet") return false;
    const wallet = account as { chainType?: string; address?: string };
    if (wallet.chainType && wallet.chainType !== "solana") return false;
    return wallet.address === walletAddress;
  });

  if (!hasLinkedWallet) {
    throw new Error("Requested wallet does not match the authenticated Privy user.");
  }

  return { userId };
}
