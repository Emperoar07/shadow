export const TRADING_DISABLED = process.env.NEXT_PUBLIC_TRADING_DISABLED === "1";

/** Base URL for the standalone relay server. Hosted deployments should set
 *  NEXT_PUBLIC_RELAY_URL to the Railway relay. Local dev may still fall back
 *  to same-origin if you proxy relay routes through the app server. */
const RELAY_BASE = (process.env.NEXT_PUBLIC_RELAY_URL ?? "").replace(/\/$/, "");

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/** Resolve a relay path to a full URL.
 *  Hosted deployments are expected to use an explicit Railway relay base URL.
 *  Only localhost-style environments fall back to same-origin paths. */
export function relayUrl(path: string): string {
  if (RELAY_BASE) return `${RELAY_BASE}${path}`;

  if (typeof window === "undefined") return path;
  if (isLocalHostname(window.location.hostname)) return path;

  console.warn(
    `[Shadow] NEXT_PUBLIC_RELAY_URL is missing on hosted origin ${window.location.hostname}. Falling back to same-origin relay path ${path}.`
  );
  return path;
}
