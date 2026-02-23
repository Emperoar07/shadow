import type { NextApiRequest, NextApiResponse } from "next";
import { TRADING_PAIRS } from "../../lib/tokens";

type PriceData = {
  price: number;
  change24h: number;
};

type PriceResponse = {
  prices: Record<string, PriceData>;
  provider: "binance" | "mixed" | "coingecko" | "coinmarketcap" | "cache" | "mock";
  fetchedAt: number;
};

const CACHE_TTL_MS = 20_000;

type PairConfig = {
  label: string;
  symbol: string;
  coingeckoId?: string;
  binanceSymbol?: string;
  mockPrice: number;
  mockPriceChange: number;
};

const BINANCE_SYMBOL_BY_PAIR: Record<string, string> = {
  "SOL-PERP": "SOLUSDT",
  "BONK-PERP": "1000BONKUSDT",
  "WIF-PERP": "WIFUSDT",
  "BTC-PERP": "BTCUSDT",
  "ETH-PERP": "ETHUSDT",
  "PYTH-PERP": "PYTHUSDT",
  "RAY-PERP": "RAYUSDT",
  "W-PERP": "WUSDT",
  "RENDER-PERP": "RENDERUSDT",
};

const PAIRS: PairConfig[] = TRADING_PAIRS.map((pair) => ({
  label: pair.label,
  symbol: pair.base.symbol,
  coingeckoId: pair.base.coingeckoId,
  binanceSymbol: BINANCE_SYMBOL_BY_PAIR[pair.label],
  mockPrice: pair.mockPrice,
  mockPriceChange: pair.mockPriceChange,
}));

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

async function fetchCoinGecko(): Promise<Record<string, PriceData> | null> {
  const ids = Array.from(
    new Set(PAIRS.map((pair) => pair.coingeckoId).filter((id): id is string => Boolean(id)))
  );
  if (ids.length === 0) return null;

  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`,
    { signal: AbortSignal.timeout(8_000) }
  );
  if (!response.ok) return null;

  const data = (await response.json()) as Record<
    string,
    { usd?: number; usd_24h_change?: number }
  >;
  const prices: Record<string, PriceData> = {};

  for (const pair of PAIRS) {
    const source = pair.coingeckoId ? data[pair.coingeckoId] : undefined;
    const price = source?.usd;
    const change = source?.usd_24h_change;
    if (isFinitePositive(price)) {
      prices[pair.label] = {
        price,
        change24h: Number.isFinite(change) ? Number(change) : pair.mockPriceChange,
      };
    }
  }

  return Object.keys(prices).length > 0 ? prices : null;
}

async function fetchCoinMarketCap(): Promise<Record<string, PriceData> | null> {
  const apiKey = process.env.COINMARKETCAP_API_KEY?.trim();
  if (!apiKey) return null;

  const symbols = Array.from(new Set(PAIRS.map((pair) => pair.symbol))).join(",");
  const response = await fetch(
    `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${symbols}&convert=USD`,
    {
      signal: AbortSignal.timeout(8_000),
      headers: {
        "X-CMC_PRO_API_KEY": apiKey,
      },
    }
  );
  if (!response.ok) return null;

  const payload = (await response.json()) as {
    data?: Record<
      string,
      {
        quote?: {
          USD?: { price?: number; percent_change_24h?: number };
        };
      }
    >;
  };
  if (!payload.data) return null;

  const prices: Record<string, PriceData> = {};
  for (const pair of PAIRS) {
    const entry = payload.data[pair.symbol];
    const quote = entry?.quote?.USD;
    const price = quote?.price;
    const change = quote?.percent_change_24h;
    if (isFinitePositive(price)) {
      prices[pair.label] = {
        price,
        change24h: Number.isFinite(change) ? Number(change) : pair.mockPriceChange,
      };
    }
  }

  return Object.keys(prices).length > 0 ? prices : null;
}

async function fetchBinance(): Promise<Record<string, PriceData> | null> {
  const symbols = Array.from(
    new Set(
      PAIRS.map((pair) => pair.binanceSymbol).filter(
        (symbol): symbol is string => Boolean(symbol)
      )
    )
  );
  if (symbols.length === 0) return null;

  const encodedSymbols = encodeURIComponent(JSON.stringify(symbols));
  const response = await fetch(
    `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodedSymbols}`,
    { signal: AbortSignal.timeout(7_000) }
  );
  if (!response.ok) return null;

  const payload = (await response.json()) as Array<{
    symbol?: string;
    lastPrice?: string;
    priceChangePercent?: string;
  }>;
  if (!Array.isArray(payload)) return null;

  const bySymbol = new Map<string, { lastPrice?: string; priceChangePercent?: string }>();
  for (const ticker of payload) {
    if (typeof ticker?.symbol !== "string") continue;
    bySymbol.set(ticker.symbol, ticker);
  }

  const prices: Record<string, PriceData> = {};
  for (const pair of PAIRS) {
    if (!pair.binanceSymbol) continue;
    const ticker = bySymbol.get(pair.binanceSymbol);
    if (!ticker) continue;
    const price = Number.parseFloat(ticker.lastPrice ?? "");
    const change24h = Number.parseFloat(ticker.priceChangePercent ?? "");
    if (!isFinitePositive(price)) continue;
    prices[pair.label] = {
      price,
      change24h: Number.isFinite(change24h) ? change24h : pair.mockPriceChange,
    };
  }

  return Object.keys(prices).length > 0 ? prices : null;
}

function mergeMissingPrices(
  target: Record<string, PriceData>,
  source: Record<string, PriceData>
): number {
  let mergedCount = 0;
  for (const [label, row] of Object.entries(source)) {
    const current = target[label];
    const currentIsMock =
      current?.price === undefined ||
      current.price === PAIRS.find((pair) => pair.label === label)?.mockPrice;
    if (!currentIsMock) continue;
    target[label] = row;
    mergedCount += 1;
  }
  return mergedCount;
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

  const now = Date.now();
  if (priceCache && now < priceCache.expiresAt) {
    res.setHeader("Cache-Control", "private, max-age=5");
    res.status(200).json({ ...priceCache.payload, provider: "cache" });
    return;
  }

  const mergedPrices = buildMockPrices();
  let provider: PriceResponse["provider"] = "mock";
  let hasLiveSource = false;
  let usedBinance = false;
  let usedCoinGecko = false;
  let usedCoinMarketCap = false;

  const binancePrices = await fetchBinance().catch(() => null);
  if (binancePrices) {
    mergeMissingPrices(mergedPrices, binancePrices);
    hasLiveSource = true;
    usedBinance = true;
  }

  const coinGeckoPrices = await fetchCoinGecko().catch(() => null);
  if (coinGeckoPrices) {
    mergeMissingPrices(mergedPrices, coinGeckoPrices);
    hasLiveSource = true;
    usedCoinGecko = true;
  }

  if (!coinGeckoPrices) {
    const coinMarketCapPrices = await fetchCoinMarketCap().catch(() => null);
    if (coinMarketCapPrices) {
      mergeMissingPrices(mergedPrices, coinMarketCapPrices);
      hasLiveSource = true;
      usedCoinMarketCap = true;
    }
  }

  if (!hasLiveSource) {
    if (priceCache) {
      res.status(200).json({ ...priceCache.payload, provider: "cache" });
      return;
    }
    res.status(200).json(buildPayload(buildMockPrices(), "mock"));
    return;
  }

  if (usedBinance && (usedCoinGecko || usedCoinMarketCap)) {
    provider = "mixed";
  } else if (usedBinance) {
    provider = "binance";
  } else if (usedCoinGecko) {
    provider = "coingecko";
  } else {
    provider = "coinmarketcap";
  }

  const payload = buildPayload(mergedPrices, provider);
  priceCache = {
    expiresAt: now + CACHE_TTL_MS,
    payload,
  };
  res.status(200).json(payload);
}
