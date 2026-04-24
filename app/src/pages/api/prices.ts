import type { NextApiRequest, NextApiResponse } from "next";
import { getOrderedReferenceProviders, type MarketFeedProvider } from "../../lib/market-feeds";
import { TRADING_PAIRS } from "../../lib/tokens";
import { checkRateLimit } from "../../lib/server/rate-limit";
import { getRequestIp } from "../../lib/server/privy-auth";

type PriceData = {
  price: number;
  change24h: number;
  volume24h?: number;
  high24h?: number;
  low24h?: number;
};

type PriceResponse = {
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
};

type PairConfig = {
  label: string;
  provider: MarketFeedProvider;
  symbol: string;
  mockPrice: number;
  mockPriceChange: number;
};

const CACHE_TTL_MS = 20_000;
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

const PAIRS: PairConfig[] = TRADING_PAIRS.map((pair) => {
  const primaryReference = getOrderedReferenceProviders(pair)[0];
  return {
    label: pair.label,
    provider: primaryReference?.provider ?? "binance",
    symbol: primaryReference?.symbol ?? `${pair.base.symbol}USDT`,
    mockPrice: pair.mockPrice,
    mockPriceChange: pair.mockPriceChange,
  };
});

let priceCache: { expiresAt: number; payload: PriceResponse } | null = null;

function buildMockPrices(): Record<string, PriceData> {
  const result: Record<string, PriceData> = {};
  for (const pair of PAIRS) {
    result[pair.label] = {
      price: pair.mockPrice,
      change24h: pair.mockPriceChange,
    };
  }
  return result;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function fetchProviderTicker(pair: PairConfig): Promise<PriceData | null> {
  const timeout = AbortSignal.timeout(8_000);

  try {
    if (pair.provider === "binance") {
      const response = await fetch(
        `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair.symbol)}`,
        { signal: timeout }
      );
      if (!response.ok) return null;
      const ticker = (await response.json()) as {
        lastPrice?: string;
        priceChangePercent?: string;
        quoteVolume?: string;
        highPrice?: string;
        lowPrice?: string;
      };
      const price = Number.parseFloat(ticker.lastPrice ?? "");
      if (!isFinitePositive(price)) return null;
      const change24h = Number.parseFloat(ticker.priceChangePercent ?? "");
      const volume24h = Number.parseFloat(ticker.quoteVolume ?? "");
      const high24h = Number.parseFloat(ticker.highPrice ?? "");
      const low24h = Number.parseFloat(ticker.lowPrice ?? "");
      return {
        price,
        change24h: Number.isFinite(change24h) ? change24h : pair.mockPriceChange,
        volume24h: Number.isFinite(volume24h) ? volume24h : undefined,
        high24h: isFinitePositive(high24h) ? high24h : undefined,
        low24h: isFinitePositive(low24h) ? low24h : undefined,
      };
    }

    if (pair.provider === "bybit") {
      const response = await fetch(
        `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(pair.symbol)}`,
        { signal: timeout }
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        result?: {
          list?: Array<{
            lastPrice?: string;
            price24hPcnt?: string;
            turnover24h?: string;
            highPrice24h?: string;
            lowPrice24h?: string;
          }>;
        };
      };
      const ticker = payload.result?.list?.[0];
      const price = Number.parseFloat(ticker?.lastPrice ?? "");
      if (!isFinitePositive(price)) return null;
      const pct = Number.parseFloat(ticker?.price24hPcnt ?? "");
      const volume24h = Number.parseFloat(ticker?.turnover24h ?? "");
      const high24h = Number.parseFloat(ticker?.highPrice24h ?? "");
      const low24h = Number.parseFloat(ticker?.lowPrice24h ?? "");
      return {
        price,
        change24h: Number.isFinite(pct) ? pct * 100 : pair.mockPriceChange,
        volume24h: Number.isFinite(volume24h) ? volume24h : undefined,
        high24h: isFinitePositive(high24h) ? high24h : undefined,
        low24h: isFinitePositive(low24h) ? low24h : undefined,
      };
    }

    if (pair.provider === "mexc") {
      const response = await fetch(
        `https://api.mexc.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair.symbol)}`,
        { signal: timeout }
      );
      if (!response.ok) return null;
      const ticker = (await response.json()) as {
        lastPrice?: string;
        priceChangePercent?: string;
        quoteVolume?: string;
        highPrice?: string;
        lowPrice?: string;
      };
      const price = Number.parseFloat(ticker.lastPrice ?? "");
      if (!isFinitePositive(price)) return null;
      const change24h = Number.parseFloat(ticker.priceChangePercent ?? "");
      const volume24h = Number.parseFloat(ticker.quoteVolume ?? "");
      const high24h = Number.parseFloat(ticker.highPrice ?? "");
      const low24h = Number.parseFloat(ticker.lowPrice ?? "");
      return {
        price,
        change24h: Number.isFinite(change24h) ? change24h : pair.mockPriceChange,
        volume24h: Number.isFinite(volume24h) ? volume24h : undefined,
        high24h: isFinitePositive(high24h) ? high24h : undefined,
        low24h: isFinitePositive(low24h) ? low24h : undefined,
      };
    }

    if (pair.provider === "coinbase") {
      const [tickerResponse, statsResponse] = await Promise.all([
        fetch(
          `https://api.exchange.coinbase.com/products/${encodeURIComponent(pair.symbol)}/ticker`,
          { signal: timeout }
        ),
        fetch(
          `https://api.exchange.coinbase.com/products/${encodeURIComponent(pair.symbol)}/stats`,
          { signal: timeout }
        ),
      ]);
      if (!tickerResponse.ok || !statsResponse.ok) return null;
      const ticker = (await tickerResponse.json()) as { price?: string };
      const stats = (await statsResponse.json()) as {
        open?: string;
        high?: string;
        low?: string;
        volume?: string;
      };
      const price = Number.parseFloat(ticker.price ?? "");
      if (!isFinitePositive(price)) return null;
      const open = Number.parseFloat(stats.open ?? "");
      const high24h = Number.parseFloat(stats.high ?? "");
      const low24h = Number.parseFloat(stats.low ?? "");
      const volume = Number.parseFloat(stats.volume ?? "");
      return {
        price,
        change24h:
          Number.isFinite(open) && open > 0 ? ((price - open) / open) * 100 : pair.mockPriceChange,
        volume24h: Number.isFinite(volume) ? volume * price : undefined,
        high24h: isFinitePositive(high24h) ? high24h : undefined,
        low24h: isFinitePositive(low24h) ? low24h : undefined,
      };
    }

    if (pair.provider === "kraken") {
      const response = await fetch(
        `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pair.symbol)}`,
        { signal: timeout }
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        result?: Record<
          string,
          {
            c?: string[];
            h?: string[];
            l?: string[];
            v?: string[];
            o?: string;
          }
        >;
      };
      const ticker = payload.result ? Object.values(payload.result)[0] : null;
      const price = Number.parseFloat(ticker?.c?.[0] ?? "");
      if (!isFinitePositive(price)) return null;
      const open = Number.parseFloat(ticker?.o ?? "");
      const high24h = Number.parseFloat(ticker?.h?.[1] ?? "");
      const low24h = Number.parseFloat(ticker?.l?.[1] ?? "");
      const volume = Number.parseFloat(ticker?.v?.[1] ?? "");
      return {
        price,
        change24h:
          Number.isFinite(open) && open > 0 ? ((price - open) / open) * 100 : pair.mockPriceChange,
        volume24h: Number.isFinite(volume) ? volume * price : undefined,
        high24h: isFinitePositive(high24h) ? high24h : undefined,
        low24h: isFinitePositive(low24h) ? low24h : undefined,
      };
    }

    if (pair.provider === "gateio") {
      const response = await fetch(
        `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(pair.symbol)}`,
        { signal: timeout }
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as Array<{
        last?: string;
        change_percentage?: string;
        quote_volume?: string;
        high_24h?: string;
        low_24h?: string;
      }>;
      const ticker = payload[0];
      const price = Number.parseFloat(ticker?.last ?? "");
      if (!isFinitePositive(price)) return null;
      const change24h = Number.parseFloat(ticker?.change_percentage ?? "");
      const volume24h = Number.parseFloat(ticker?.quote_volume ?? "");
      const high24h = Number.parseFloat(ticker?.high_24h ?? "");
      const low24h = Number.parseFloat(ticker?.low_24h ?? "");
      return {
        price,
        change24h: Number.isFinite(change24h) ? change24h : pair.mockPriceChange,
        volume24h: Number.isFinite(volume24h) ? volume24h : undefined,
        high24h: isFinitePositive(high24h) ? high24h : undefined,
        low24h: isFinitePositive(low24h) ? low24h : undefined,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function buildPayload(
  prices: Record<string, PriceData>,
  provider: PriceResponse["provider"]
): PriceResponse {
  return {
    prices,
    provider,
    fetchedAt: Date.now(),
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PriceResponse | { error: string }>
): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  if (!checkRateLimit(`prices:ip:${getRequestIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    res.status(429).json({ error: "Rate limit exceeded" });
    return;
  }

  const now = Date.now();
  if (priceCache && now < priceCache.expiresAt) {
    res.setHeader("Cache-Control", "private, max-age=5");
    res.status(200).json({ ...priceCache.payload, provider: "cache" });
    return;
  }

  const prices = buildMockPrices();
  const providersUsed = new Set<Exclude<PriceResponse["provider"], "mixed" | "cache" | "mock">>();

  const results = await Promise.all(
    PAIRS.map(async (pair) => ({
      pair,
      live: await fetchProviderTicker(pair),
    }))
  );

  for (const { pair, live } of results) {
    if (!live) continue;
    prices[pair.label] = live;
    providersUsed.add(pair.provider);
  }

  let provider: PriceResponse["provider"] = "mock";
  if (providersUsed.size === 1) {
    provider = Array.from(providersUsed)[0];
  } else if (providersUsed.size > 1) {
    provider = "mixed";
  } else if (priceCache) {
    res.status(200).json({ ...priceCache.payload, provider: "cache" });
    return;
  }

  const payload = buildPayload(prices, provider);
  priceCache = {
    expiresAt: now + CACHE_TTL_MS,
    payload,
  };

  res.setHeader("Cache-Control", "private, max-age=5");
  res.status(200).json(payload);
}
