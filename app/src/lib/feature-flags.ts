export const TRADING_DISABLED = process.env.NEXT_PUBLIC_TRADING_DISABLED === "1";

/** Base URL for the relay server. Defaults to "" (same origin) so existing
 *  Next.js API routes continue to work until NEXT_PUBLIC_RELAY_URL is set. */
const RELAY_BASE = (process.env.NEXT_PUBLIC_RELAY_URL ?? "").replace(/\/$/, "");

/** Resolve a relay path to a full URL (or keep it as a relative path when
 *  NEXT_PUBLIC_RELAY_URL is not configured). */
export function relayUrl(path: string): string {
  return RELAY_BASE ? `${RELAY_BASE}${path}` : path;
}

