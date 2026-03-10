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
    | "cache"
    | "mock";
  fetchedAt: number;
}

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
