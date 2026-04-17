import { PrivyClient } from "@privy-io/server-auth";

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
