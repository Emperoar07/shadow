import { TRADING_PAIRS } from "./tokens";

export interface PriceData {
  price: number;
  change24h: number;
}

// In-memory cache shared across all components
let priceCache: Record<string, PriceData> = {};
let lastFetchTime = 0;
const CACHE_TTL = 30_000; // 30 seconds
let inflightRequest: Promise<Record<string, PriceData>> | null = null;

/**
 * Fetch live prices from CoinGecko free API for all trading pairs.
 * Deduplicates concurrent calls and caches results for 30s.
 * Falls back to mockPrice on any failure.
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
  // Collect all coingecko IDs
  const idMap: Record<string, string[]> = {}; // coingeckoId -> [pairLabel, ...]
  for (const pair of TRADING_PAIRS) {
    const cgId = pair.base.coingeckoId;
    if (cgId) {
      if (!idMap[cgId]) idMap[cgId] = [];
      idMap[cgId].push(pair.label);
    }
  }

  const ids = Object.keys(idMap).join(",");
  if (!ids) return _fallbackPrices();

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) {
      // Rate-limited or error — use fallback
      return _fallbackPrices();
    }

    const data = await res.json();
    const result: Record<string, PriceData> = {};

    for (const pair of TRADING_PAIRS) {
      const cgId = pair.base.coingeckoId;
      if (cgId && data[cgId]) {
        result[pair.label] = {
          price: data[cgId].usd ?? pair.mockPrice,
          change24h: data[cgId].usd_24h_change ?? pair.mockPriceChange,
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
    return result;
  } catch {
    return _fallbackPrices();
  }
}

function _fallbackPrices(): Record<string, PriceData> {
  // If we have a previous cache, keep it (stale > mock)
  if (Object.keys(priceCache).length > 0) return priceCache;

  const result: Record<string, PriceData> = {};
  for (const pair of TRADING_PAIRS) {
    result[pair.label] = {
      price: pair.mockPrice,
      change24h: pair.mockPriceChange,
    };
  }
  return result;
}

/** Get cached price synchronously (returns mockPrice if not yet fetched) */
export function getCachedPrice(pairLabel: string): PriceData | null {
  return priceCache[pairLabel] ?? null;
}
