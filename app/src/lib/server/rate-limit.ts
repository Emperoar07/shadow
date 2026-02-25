/**
 * Simple in-memory sliding-window rate limiter for API routes.
 * Keyed by owner public key. Resets on server restart (acceptable for devnet).
 */

interface WindowEntry {
  count: number;
  windowStart: number;
}

const windows = new Map<string, WindowEntry>();

/** Remove stale entries older than 2x the window to prevent unbounded growth. */
function evict(windowMs: number): void {
  const cutoff = Date.now() - windowMs * 2;
  for (const [key, entry] of windows) {
    if (entry.windowStart < cutoff) windows.delete(key);
  }
}

/**
 * Returns true if the request is allowed, false if rate-limited.
 *
 * @param key Unique key (e.g. owner pubkey + endpoint name)
 * @param limit Maximum requests per window
 * @param windowMs Window duration in milliseconds
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = windows.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    windows.set(key, { count: 1, windowStart: now });
    evict(windowMs);
    return true;
  }

  if (entry.count >= limit) return false;

  entry.count += 1;
  return true;
}
