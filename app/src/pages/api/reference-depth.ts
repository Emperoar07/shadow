import type { NextApiRequest, NextApiResponse } from "next";
import { checkRateLimit } from "../../lib/server/rate-limit";
import { getRequestIp } from "../../lib/server/request-ip";
import {
  findTradingPair,
  getReferenceProviders,
  type ReferenceDepthSnapshot,
  type ReferenceLevel,
  type ReferenceProviderConfig,
  type ReferenceTrade,
} from "../../lib/reference-depth";

type ErrorResponse = {
  error: string;
  fetchedAt: number;
};

const CACHE_TTL_MS = 3_000;
const DEPTH_LIMIT = 120;
const TRADE_LIMIT = 60;
const RATE_LIMIT = 240;
const RATE_WINDOW_MS = 60_000;

let cache = new Map<string, { expiresAt: number; payload: ReferenceDepthSnapshot }>();

function parseLevels(rows: unknown, limit: number): ReferenceLevel[] {
  if (!Array.isArray(rows)) return [];

  const parsed: ReferenceLevel[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const price = Number.parseFloat(String(row[0]));
    const size = Number.parseFloat(String(row[1]));
    if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) continue;
    parsed.push({ price, size });
    if (parsed.length >= limit) break;
  }
  return parsed;
}

function buildSnapshot(
  pairLabel: string,
  provider: ReferenceProviderConfig,
  bids: ReferenceLevel[],
  asks: ReferenceLevel[],
  trades: ReferenceTrade[],
  stats24h: ReferenceDepthSnapshot["stats24h"]
): ReferenceDepthSnapshot | null {
  if (bids.length === 0 && asks.length === 0) return null;

  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
  const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const spreadBps = spread !== null && mid && mid > 0 ? (spread / mid) * 10_000 : null;
  const lastTrade = trades[0] ?? null;

  return {
    pairLabel,
    provider: provider.provider,
    symbol: provider.symbol,
    quoteSymbol: provider.quoteSymbol,
    bids,
    asks,
    trades,
    lastTrade,
    spread,
    spreadBps,
    stats24h,
    fetchedAt: Date.now(),
    external: true,
  };
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveFiniteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

async function fetchJson(url: string, timeoutMs = 4_000): Promise<any | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "application/json",
        "User-Agent": "shadowperp-reference-depth",
      },
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchCoinbase(pairLabel: string, provider: ReferenceProviderConfig): Promise<ReferenceDepthSnapshot | null> {
  const baseUrl = `https://api.exchange.coinbase.com/products/${encodeURIComponent(provider.symbol)}`;
  const [book, trades, stats] = await Promise.all([
    fetchJson(`${baseUrl}/book?level=2`),
    fetchJson(`${baseUrl}/trades`),
    fetchJson(`${baseUrl}/stats`),
  ]);

  if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks)) return null;

  const bids = parseLevels(book.bids, DEPTH_LIMIT);
  const asks = parseLevels(book.asks, DEPTH_LIMIT);
  const normalizedTrades: ReferenceTrade[] = Array.isArray(trades)
    ? trades
        .map((trade: any) => {
          const price = Number.parseFloat(String(trade?.price ?? ""));
          const size = Number.parseFloat(String(trade?.size ?? ""));
          const side: ReferenceTrade["side"] = trade?.side === "sell" ? "sell" : "buy";
          const timestamp = Date.parse(String(trade?.time ?? ""));
          if (!Number.isFinite(price) || !Number.isFinite(size) || !Number.isFinite(timestamp)) {
            return null;
          }
          return { price, size, side, timestamp };
        })
        .filter((trade: ReferenceTrade | null): trade is ReferenceTrade => trade !== null)
        .slice(0, TRADE_LIMIT)
    : [];

  const stats24h = stats
    ? {
        changePct: null,
        volume: positiveFiniteOrNull(Number.parseFloat(String(stats?.volume ?? ""))),
        high: positiveFiniteOrNull(Number.parseFloat(String(stats?.high ?? ""))),
        low: positiveFiniteOrNull(Number.parseFloat(String(stats?.low ?? ""))),
      }
    : null;

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades, stats24h);
}

async function fetchBinance(pairLabel: string, provider: ReferenceProviderConfig): Promise<ReferenceDepthSnapshot | null> {
  const symbol = encodeURIComponent(provider.symbol);
  const [book, trades, ticker] = await Promise.all([
    fetchJson(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=${DEPTH_LIMIT}`),
    fetchJson(`https://api.binance.com/api/v3/trades?symbol=${symbol}&limit=${TRADE_LIMIT}`),
    fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`),
  ]);

  if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks)) return null;

  const bids = parseLevels(book.bids, DEPTH_LIMIT);
  const asks = parseLevels(book.asks, DEPTH_LIMIT);
  const normalizedTrades: ReferenceTrade[] = Array.isArray(trades)
    ? trades
        .map((trade: any) => {
          const price = Number.parseFloat(String(trade?.price ?? ""));
          const size = Number.parseFloat(String(trade?.qty ?? ""));
          const side: ReferenceTrade["side"] = trade?.isBuyerMaker ? "sell" : "buy";
          const timestamp = Number(trade?.time);
          if (!Number.isFinite(price) || !Number.isFinite(size) || !Number.isFinite(timestamp)) {
            return null;
          }
          return { price, size, side, timestamp };
        })
        .filter((trade: ReferenceTrade | null): trade is ReferenceTrade => trade !== null)
        .slice(0, TRADE_LIMIT)
    : [];

  const stats24h = ticker
    ? {
        changePct: finiteOrNull(Number.parseFloat(String(ticker?.priceChangePercent ?? ""))),
        volume: positiveFiniteOrNull(Number.parseFloat(String(ticker?.quoteVolume ?? ""))),
        high: positiveFiniteOrNull(Number.parseFloat(String(ticker?.highPrice ?? ""))),
        low: positiveFiniteOrNull(Number.parseFloat(String(ticker?.lowPrice ?? ""))),
      }
    : null;

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades, stats24h);
}

async function fetchBybit(pairLabel: string, provider: ReferenceProviderConfig): Promise<ReferenceDepthSnapshot | null> {
  const symbol = encodeURIComponent(provider.symbol);
  const [book, trades, ticker] = await Promise.all([
    fetchJson(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${symbol}&limit=${DEPTH_LIMIT}`),
    fetchJson(`https://api.bybit.com/v5/market/recent-trade?category=spot&symbol=${symbol}&limit=${TRADE_LIMIT}`),
    fetchJson(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`),
  ]);

  const bookResult = book?.result;
  const tradeResult = trades?.result;
  if (!bookResult || !Array.isArray(bookResult.b) || !Array.isArray(bookResult.a)) return null;

  const bids = parseLevels(bookResult.b, DEPTH_LIMIT);
  const asks = parseLevels(bookResult.a, DEPTH_LIMIT);
  const normalizedTrades: ReferenceTrade[] = Array.isArray(tradeResult?.list)
    ? tradeResult.list
        .map((trade: any) => {
          const price = Number.parseFloat(String(trade?.price ?? ""));
          const size = Number.parseFloat(String(trade?.size ?? ""));
          const side: ReferenceTrade["side"] = trade?.side === "Sell" ? "sell" : "buy";
          const timestamp = Number(trade?.time);
          if (!Number.isFinite(price) || !Number.isFinite(size) || !Number.isFinite(timestamp)) {
            return null;
          }
          return { price, size, side, timestamp };
        })
        .filter((trade: ReferenceTrade | null): trade is ReferenceTrade => trade !== null)
        .slice(0, TRADE_LIMIT)
    : [];

  const tickerRow = Array.isArray(ticker?.result?.list) ? ticker.result.list[0] : null;
  const stats24h = tickerRow
    ? {
        changePct: finiteOrNull(Number.parseFloat(String(tickerRow?.price24hPcnt ?? "")) * 100),
        volume: positiveFiniteOrNull(Number.parseFloat(String(tickerRow?.turnover24h ?? ""))),
        high: positiveFiniteOrNull(Number.parseFloat(String(tickerRow?.highPrice24h ?? ""))),
        low: positiveFiniteOrNull(Number.parseFloat(String(tickerRow?.lowPrice24h ?? ""))),
      }
    : null;

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades, stats24h);
}

async function fetchMexc(pairLabel: string, provider: ReferenceProviderConfig): Promise<ReferenceDepthSnapshot | null> {
  const symbol = encodeURIComponent(provider.symbol);
  const [book, trades, ticker] = await Promise.all([
    fetchJson(`https://api.mexc.com/api/v3/depth?symbol=${symbol}&limit=${DEPTH_LIMIT}`),
    fetchJson(`https://api.mexc.com/api/v3/trades?symbol=${symbol}&limit=${TRADE_LIMIT}`),
    fetchJson(`https://api.mexc.com/api/v3/ticker/24hr?symbol=${symbol}`),
  ]);

  if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks)) return null;

  const bids = parseLevels(book.bids, DEPTH_LIMIT);
  const asks = parseLevels(book.asks, DEPTH_LIMIT);
  const normalizedTrades: ReferenceTrade[] = Array.isArray(trades)
    ? trades
        .map((trade: any) => {
          const price = Number.parseFloat(String(trade?.price ?? ""));
          const size = Number.parseFloat(String(trade?.qty ?? ""));
          const side: ReferenceTrade["side"] = trade?.isBuyerMaker ? "sell" : "buy";
          const timestamp = Number(trade?.time);
          if (!Number.isFinite(price) || !Number.isFinite(size) || !Number.isFinite(timestamp)) {
            return null;
          }
          return { price, size, side, timestamp };
        })
        .filter((trade: ReferenceTrade | null): trade is ReferenceTrade => trade !== null)
        .slice(0, TRADE_LIMIT)
    : [];

  const stats24h = ticker
    ? {
        changePct: finiteOrNull(Number.parseFloat(String(ticker?.priceChangePercent ?? ""))),
        volume: positiveFiniteOrNull(Number.parseFloat(String(ticker?.quoteVolume ?? ""))),
        high: positiveFiniteOrNull(Number.parseFloat(String(ticker?.highPrice ?? ""))),
        low: positiveFiniteOrNull(Number.parseFloat(String(ticker?.lowPrice ?? ""))),
      }
    : null;

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades, stats24h);
}

async function fetchGateIo(pairLabel: string, provider: ReferenceProviderConfig): Promise<ReferenceDepthSnapshot | null> {
  const symbol = encodeURIComponent(provider.symbol);
  const [book, trades, ticker] = await Promise.all([
    fetchJson(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${symbol}&limit=${DEPTH_LIMIT}&with_id=false`),
    fetchJson(`https://api.gateio.ws/api/v4/spot/trades?currency_pair=${symbol}&limit=${TRADE_LIMIT}`),
    fetchJson(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${symbol}`),
  ]);

  if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks)) return null;

  const bids = parseLevels(book.bids, DEPTH_LIMIT);
  const asks = parseLevels(book.asks, DEPTH_LIMIT);
  const normalizedTrades: ReferenceTrade[] = Array.isArray(trades)
    ? trades
        .map((trade: any) => {
          const price = Number.parseFloat(String(trade?.price ?? ""));
          const size = Number.parseFloat(String(trade?.amount ?? ""));
          const side: ReferenceTrade["side"] = trade?.side === "sell" ? "sell" : "buy";
          const timestamp = Number(trade?.create_time_ms ?? trade?.create_time) * (String(trade?.create_time_ms ?? "").length > 10 ? 1 : 1000);
          if (!Number.isFinite(price) || !Number.isFinite(size) || !Number.isFinite(timestamp)) {
            return null;
          }
          return { price, size, side, timestamp };
        })
        .filter((trade: ReferenceTrade | null): trade is ReferenceTrade => trade !== null)
        .slice(0, TRADE_LIMIT)
    : [];

  const tickerRow = Array.isArray(ticker) ? ticker[0] : null;
  const stats24h = tickerRow
    ? {
        changePct: finiteOrNull(Number.parseFloat(String(tickerRow?.change_percentage ?? ""))),
        volume: positiveFiniteOrNull(Number.parseFloat(String(tickerRow?.quote_volume ?? ""))),
        high: positiveFiniteOrNull(Number.parseFloat(String(tickerRow?.high_24h ?? ""))),
        low: positiveFiniteOrNull(Number.parseFloat(String(tickerRow?.low_24h ?? ""))),
      }
    : null;

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades, stats24h);
}

async function fetchKraken(pairLabel: string, provider: ReferenceProviderConfig): Promise<ReferenceDepthSnapshot | null> {
  const symbol = encodeURIComponent(provider.symbol);
  const [book, trades, ticker] = await Promise.all([
    fetchJson(`https://api.kraken.com/0/public/Depth?pair=${symbol}&count=${DEPTH_LIMIT}`),
    fetchJson(`https://api.kraken.com/0/public/Trades?pair=${symbol}`),
    fetchJson(`https://api.kraken.com/0/public/Ticker?pair=${symbol}`),
  ]);

  const depthResult = book?.result && typeof book.result === "object" ? Object.values(book.result)[0] as any : null;
  const tradeResult = trades?.result && typeof trades.result === "object" ? Object.values(trades.result)[0] as any : null;
  if (!depthResult || !Array.isArray(depthResult.bids) || !Array.isArray(depthResult.asks)) return null;

  const bids = parseLevels(depthResult.bids, DEPTH_LIMIT);
  const asks = parseLevels(depthResult.asks, DEPTH_LIMIT);
  const normalizedTrades: ReferenceTrade[] = Array.isArray(tradeResult)
    ? tradeResult
        .map((trade: any[]) => {
          const price = Number.parseFloat(String(trade?.[0] ?? ""));
          const size = Number.parseFloat(String(trade?.[1] ?? ""));
          const timestamp = Number(trade?.[2]) * 1000;
          const side: ReferenceTrade["side"] = trade?.[3] === "s" ? "sell" : "buy";
          if (!Number.isFinite(price) || !Number.isFinite(size) || !Number.isFinite(timestamp)) {
            return null;
          }
          return { price, size, side, timestamp };
        })
        .filter((trade: ReferenceTrade | null): trade is ReferenceTrade => trade !== null)
        .slice(0, TRADE_LIMIT)
    : [];

  const tickerResult = ticker?.result && typeof ticker.result === "object" ? Object.values(ticker.result)[0] as any : null;
  const stats24h = tickerResult
    ? {
        changePct:
          finiteOrNull(
            (() => {
              const open = Number.parseFloat(String(tickerResult?.o ?? ""));
              const last = Number.parseFloat(String(tickerResult?.c?.[0] ?? ""));
              if (!Number.isFinite(open) || open <= 0 || !Number.isFinite(last)) return NaN;
              return ((last - open) / open) * 100;
            })()
          ),
        volume: positiveFiniteOrNull(Number.parseFloat(String(tickerResult?.v?.[1] ?? ""))),
        high: positiveFiniteOrNull(Number.parseFloat(String(tickerResult?.h?.[1] ?? ""))),
        low: positiveFiniteOrNull(Number.parseFloat(String(tickerResult?.l?.[1] ?? ""))),
      }
    : null;

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades, stats24h);
}

async function fetchReferenceDepth(pairLabel: string): Promise<ReferenceDepthSnapshot | null> {
  const pair = findTradingPair(pairLabel);
  if (!pair) return null;

  const providers = getReferenceProviders(pair);
  const tasks = providers.map(async (provider) => {
    let snapshot: ReferenceDepthSnapshot | null = null;
    if (provider.provider === "coinbase") snapshot = await fetchCoinbase(pairLabel, provider);
    if (provider.provider === "binance") snapshot = await fetchBinance(pairLabel, provider);
    if (provider.provider === "bybit") snapshot = await fetchBybit(pairLabel, provider);
    if (provider.provider === "mexc") snapshot = await fetchMexc(pairLabel, provider);
    if (provider.provider === "gateio") snapshot = await fetchGateIo(pairLabel, provider);
    if (provider.provider === "kraken") snapshot = await fetchKraken(pairLabel, provider);
    if (!snapshot) {
      throw new Error(`No depth from ${provider.provider}:${provider.symbol}`);
    }
    return snapshot;
  });

  try {
    return await Promise.any(tasks);
  } catch {
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ReferenceDepthSnapshot | ErrorResponse>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method Not Allowed", fetchedAt: Date.now() });
    return;
  }

  if (!checkRateLimit(`reference-depth:ip:${getRequestIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    res.status(429).json({ error: "Rate limit exceeded", fetchedAt: Date.now() });
    return;
  }

  const pairLabel = String(req.query.pair ?? "").trim();
  if (!pairLabel) {
    res.status(400).json({ error: "Missing pair", fetchedAt: Date.now() });
    return;
  }

  const cached = cache.get(pairLabel);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    res.setHeader("Cache-Control", "private, max-age=2");
    res.status(200).json(cached.payload);
    return;
  }

  const snapshot = await fetchReferenceDepth(pairLabel);
  if (!snapshot) {
    if (cached) {
      res.setHeader("Cache-Control", "private, max-age=1, stale-while-revalidate=30");
      res.status(200).json(cached.payload);
      return;
    }
    res.status(502).json({ error: "Reference depth unavailable", fetchedAt: now });
    return;
  }

  cache.set(pairLabel, { expiresAt: now + CACHE_TTL_MS, payload: snapshot });
  res.setHeader("Cache-Control", "private, max-age=2");
  res.status(200).json(snapshot);
}
