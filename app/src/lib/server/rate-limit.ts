/**
 * API route rate limiting.
 *
 * The synchronous limiter below is intentionally kept for low-risk read routes.
 * Public signer/faucet routes should call `checkRateLimitAsync`, which uses a
 * durable Redis-compatible REST backend when configured and falls back to the
 * same in-memory limiter for local/devnet runs.
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

type DurableRateLimitConfig = {
  url: string;
  token: string;
};

function getDurableConfig(): DurableRateLimitConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

function requireDurableRateLimitInProduction(): boolean {
  const raw = process.env.REQUIRE_DURABLE_RATE_LIMITS?.trim().toLowerCase();
  if (raw && ["0", "false", "no", "off"].includes(raw)) return false;
  return process.env.NODE_ENV === "production";
}

function makeDurableKey(key: string, windowMs: number): string {
  const bucket = Math.floor(Date.now() / windowMs);
  return `shadowperp:rl:${key}:${bucket}`;
}

function makeDurableStateKey(key: string): string {
  return `shadowperp:state:${key}`;
}

async function runRedisCommand(config: DurableRateLimitConfig, command: unknown[]): Promise<unknown> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) {
    throw new Error(`durable rate limit failed: ${response.status}`);
  }
  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload.result;
}

/**
 * Durable fixed-window limiter for public mutation/signer routes.
 *
 * Configure one of:
 * - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 * - KV_REST_API_URL + KV_REST_API_TOKEN
 */
export async function checkRateLimitAsync(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const config = getDurableConfig();
  if (!config) {
    if (requireDurableRateLimitInProduction()) return false;
    return checkRateLimit(key, limit, windowMs);
  }

  const durableKey = makeDurableKey(key, windowMs);
  try {
    const countRaw = await runRedisCommand(config, ["INCR", durableKey]);
    const count = Number(countRaw);
    if (count === 1) {
      await runRedisCommand(config, ["PEXPIRE", durableKey, windowMs * 2]);
    }
    return Number.isFinite(count) && count <= limit;
  } catch {
    // Fail closed for production signer endpoints; fall back locally so devnet
    // work is not blocked by missing/temporary KV plumbing.
    if (process.env.NODE_ENV === "production") return false;
    return checkRateLimit(key, limit, windowMs);
  }
}

export async function readDurableValue(key: string): Promise<string | null> {
  const config = getDurableConfig();
  if (!config) return null;

  try {
    const value = await runRedisCommand(config, ["GET", makeDurableStateKey(key)]);
    return typeof value === "string" ? value : null;
  } catch {
    if (process.env.NODE_ENV === "production") throw new Error("durable store read failed");
    return null;
  }
}

export async function writeDurableValue(
  key: string,
  value: string,
  ttlMs?: number
): Promise<void> {
  const config = getDurableConfig();
  if (!config) return;

  const command =
    ttlMs && ttlMs > 0
      ? ["SET", makeDurableStateKey(key), value, "PX", ttlMs]
      : ["SET", makeDurableStateKey(key), value];
  try {
    await runRedisCommand(config, command);
  } catch {
    if (process.env.NODE_ENV === "production") throw new Error("durable store write failed");
  }
}
