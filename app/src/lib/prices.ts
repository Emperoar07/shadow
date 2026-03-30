import { TRADING_PAIRS } from "./tokens";

export interface PriceData {
  price: number;
  change24h: number;
  volume24h?: number;
  high24h?: number;
  low24h?: number;
}

export type PriceQuality = "live" | "cached" | "mock";

interface PriceMeta {
  quality: PriceQuality;
  provider: string;
  fetchedAt: number;
}

interface ApiPriceResponse {
  prices: Record<string, PriceData>;
  provider:
    | "binance"
    | "bybit"
    | "mexc"
    | "coinbase"
    | "kraken"
    | "gateio"
    | "mixed"
    | "pyth"
    | "cache"
    | "mock";
  fetchedAt: number;
}

// Pyth Hermes REST API — returns latest price for each feed ID (no API key needed).
// Feed IDs are defined per trading pair in tokens.ts.
const PYTH_HERMES_URL = "https://hermes.pyth.network/v2/updates/price/latest";

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveFiniteOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

// In-memory cache shared across all components
let priceCache: Record<string, PriceData> = {};
let lastFetchTime = 0;
const CACHE_TTL = 30_000; // 30 seconds
let inflightRequest: Promise<Record<string, PriceData>> | null = null;
let lastMeta: PriceMeta = {
  quality: "mock",
  provider: "mock",
  fetchedAt: 0,
};

/**
 * Fetch prices for all trading pairs.
 * Preferred source: backend API route (/api/prices).
 * Emergency source: direct CoinGecko browser call.
 * Final fallback: stale cache, then static mock prices.
 */
export async function fetchPrices(): Promise<Record<string, PriceData>> {
  const now = Date.now();

  // Return cache if fresh
  if (now - lastFetchTime < CACHE_TTL && Object.keys(priceCache).length > 0) {
    return priceCache;
  }

  // Deduplicate concurrent calls
  if (inflightRequest) return inflightRequest;

  inflightRequest = _doFetch().finally(() => {
    inflightRequest = null;
  });

  return inflightRequest;
}

async function _doFetch(): Promise<Record<string, PriceData>> {
  const backendResult = await _fetchFromBackendApi();
  if (backendResult) return backendResult;

  const pythResult = await _fetchFromPythHermes();
  if (pythResult) return pythResult;

  const directResult = await _fetchCoinGeckoDirect();
  if (directResult) return directResult;

  return _fallbackPrices();
}

async function _fetchFromBackendApi(): Promise<Record<string, PriceData> | null> {
  try {
    const res = await fetch("/api/prices", {
      signal: AbortSignal.timeout(6000),
      headers: {
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;

    const payload = (await res.json()) as ApiPriceResponse;
    if (!payload?.prices) return null;

    const result: Record<string, PriceData> = {};
    for (const pair of TRADING_PAIRS) {
      const live = payload.prices[pair.label];
      if (live && Number.isFinite(live.price) && live.price > 0) {
        result[pair.label] = {
          price: live.price,
          change24h: Number.isFinite(live.change24h)
            ? live.change24h
            : pair.mockPriceChange,
          volume24h: finiteOrUndefined(live.volume24h),
          high24h: positiveFiniteOrUndefined(live.high24h),
          low24h: positiveFiniteOrUndefined(live.low24h),
        };
      } else {
        result[pair.label] = {
          price: pair.mockPrice,
          change24h: pair.mockPriceChange,
        };
      }
    }

    priceCache = result;
    lastFetchTime = Date.now();
    lastMeta = {
      quality:
        payload.provider === "mock"
          ? "mock"
          : payload.provider === "cache"
          ? "cached"
          : "live",
      provider: payload.provider,
      fetchedAt: payload.fetchedAt || Date.now(),
    };

    return result;
  } catch {
    return null;
  }
}

async function _fetchFromPythHermes(): Promise<Record<string, PriceData> | null> {
  const pairs = TRADING_PAIRS.filter((p) => p.pythFeedId);
  if (pairs.length === 0) return null;

  const params = new URLSearchParams();
  for (const pair of pairs) {
    params.append("ids[]", pair.pythFeedId);
  }

  try {
    const res = await fetch(`${PYTH_HERMES_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;

    const payload = await res.json() as {
      parsed?: Array<{
        id: string;
        price: { price: string; expo: number; conf: string; publish_time: number };
        ema_price: { price: string; expo: number };
      }>;
    };
    if (!Array.isArray(payload?.parsed) || payload.parsed.length === 0) return null;

    // Build lookup: strip leading zeros/0x from feed ID for comparison
    const byId = new Map<string, number>();
    for (const entry of payload.parsed) {
      const price = parseFloat(entry.price.price);
      const exp = entry.price.expo; // negative, e.g. -8
      const usdPrice = price * Math.pow(10, exp);
      if (usdPrice > 0) {
        // Hermes returns id without 0x prefix
        byId.set(entry.id.toLowerCase().replace(/^0x/, ""), usdPrice);
      }
    }

    const result: Record<string, PriceData> = {};
    let liveCount = 0;

    for (const pair of TRADING_PAIRS) {
      const feedKey = pair.pythFeedId.toLowerCase().replace(/^0x/, "");
      const usdPrice = byId.get(feedKey);
      if (usdPrice && usdPrice > 0) {
        liveCount++;
        result[pair.label] = {
          price: usdPrice,
          change24h: pair.mockPriceChange, // Hermes latest doesn't return 24h change; use existing cache or mock
        };
        // Preserve 24h change from stale cache if available
        const cached = priceCache[pair.label];
        if (cached) result[pair.label].change24h = cached.change24h;
      } else {
        result[pair.label] = { price: pair.mockPrice, change24h: pair.mockPriceChange };
      }
    }

    if (liveCount === 0) return null;

    priceCache = result;
    lastFetchTime = Date.now();
    lastMeta = { quality: "live", provider: "pyth", fetchedAt: Date.now() };
    return result;
  } catch {
    return null;
  }
}

async function _fetchCoinGeckoDirect(): Promise<Record<string, PriceData> | null> {
  const ids = Array.from(
    new Set(
      TRADING_PAIRS.map((pair) => pair.base.coingeckoId).filter(
        (id): id is string => Boolean(id)
      )
    )
  ).join(",");
  if (!ids) return null;

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h&per_page=250&page=1&sparkline=false`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;

    const payload = (await res.json()) as Array<{
      id?: string;
      current_price?: number;
      price_change_percentage_24h?: number;
      total_volume?: number;
      high_24h?: number;
      low_24h?: number;
    }>;
    if (!Array.isArray(payload)) return null;
    const byId = new Map<string, (typeof payload)[number]>();
    for (const row of payload) {
      if (typeof row?.id !== "string") continue;
      byId.set(row.id, row);
    }
    const result: Record<string, PriceData> = {};
    let liveCount = 0;

    for (const pair of TRADING_PAIRS) {
      const cgId = pair.base.coingeckoId;
      const source = cgId ? byId.get(cgId) : null;
      const price = source?.current_price;
      const change24h = source?.price_change_percentage_24h;
      if (typeof price === "number" && Number.isFinite(price) && price > 0) {
        liveCount += 1;
        result[pair.label] = {
          price,
          change24h:
            typeof change24h === "number" && Number.isFinite(change24h)
              ? change24h
              : pair.mockPriceChange,
          volume24h: finiteOrUndefined(source?.total_volume),
          high24h: positiveFiniteOrUndefined(source?.high_24h),
          low24h: positiveFiniteOrUndefined(source?.low_24h),
        };
      } else {
        result[pair.label] = {
          price: pair.mockPrice,
          change24h: pair.mockPriceChange,
        };
      }
    }

    if (liveCount === 0) return null;

    priceCache = result;
    lastFetchTime = Date.now();
    lastMeta = {
      quality: "live",
      provider: "coingecko-direct",
      fetchedAt: Date.now(),
    };
    return result;
  } catch {
    return null;
  }
}

function _fallbackPrices(): Record<string, PriceData> {
  // If we have previous cache, keep it (stale cache is better than mock constants).
  if (Object.keys(priceCache).length > 0) {
    lastMeta = {
      quality: "cached",
      provider: "stale-cache",
      fetchedAt: lastFetchTime,
    };
    return priceCache;
  }

  const result: Record<string, PriceData> = {};
  for (const pair of TRADING_PAIRS) {
    result[pair.label] = {
      price: pair.mockPrice,
      change24h: pair.mockPriceChange,
    };
  }
  lastMeta = {
    quality: "mock",
    provider: "mock",
    fetchedAt: Date.now(),
  };
  return result;
}

/** Get cached price synchronously (returns null if no cache yet). */
export function getCachedPrice(pairLabel: string): PriceData | null {
  return priceCache[pairLabel] ?? null;
}

/** Last fetch diagnostics for UI logic (without exposing noisy warning banners). */
export function getLastPriceMeta(): PriceMeta {
  return lastMeta;
}
