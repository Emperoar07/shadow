import type { NextApiRequest, NextApiResponse } from "next";
import {
  findTradingPair,
  getReferenceProviders,
  type ReferenceDepthSnapshot,
  type ReferenceLevel,
  type ReferenceProviderConfig,
  type ReferenceStats24h,
  type ReferenceTrade,
} from "../../lib/reference-depth";

type ErrorResponse = {
  error: string;
  fetchedAt: number;
};

const CACHE_TTL_MS = 3_000;
const DEPTH_LIMIT = 120;
const TRADE_LIMIT = 60;

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
  stats24h: ReferenceStats24h | null
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

function parsePositive(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseFinite(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchProviderStats(provider: ReferenceProviderConfig): Promise<ReferenceStats24h | null> {
  const symbol = encodeURIComponent(provider.symbol);

  try {
    if (provider.provider === "binance") {
      const ticker = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
      if (!ticker) return null;
      return {
        last: parsePositive(ticker.lastPrice),
        change24h: parseFinite(ticker.priceChangePercent),
        volume24h: parseFinite(ticker.quoteVolume),
        high24h: parsePositive(ticker.highPrice),
        low24h: parsePositive(ticker.lowPrice),
      };
    }

    if (provider.provider === "bybit") {
      const payload = await fetchJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`);
      const ticker = payload?.result?.list?.[0];
      if (!ticker) return null;
      const pct = parseFinite(ticker.price24hPcnt);
      return {
        last: parsePositive(ticker.lastPrice),
        change24h: pct !== null ? pct * 100 : null,
        volume24h: parseFinite(ticker.turnover24h),
        high24h: parsePositive(ticker.highPrice24h),
        low24h: parsePositive(ticker.lowPrice24h),
      };
    }

    if (provider.provider === "mexc") {
      const ticker = await fetchJson(`https://api.mexc.com/api/v3/ticker/24hr?symbol=${symbol}`);
      if (!ticker) return null;
      return {
        last: parsePositive(ticker.lastPrice),
        change24h: parseFinite(ticker.priceChangePercent),
        volume24h: parseFinite(ticker.quoteVolume),
        high24h: parsePositive(ticker.highPrice),
        low24h: parsePositive(ticker.lowPrice),
      };
    }

    if (provider.provider === "coinbase") {
      const baseUrl = `https://api.exchange.coinbase.com/products/${encodeURIComponent(provider.symbol)}`;
      const [ticker, stats] = await Promise.all([
        fetchJson(`${baseUrl}/ticker`),
        fetchJson(`${baseUrl}/stats`),
      ]);
      if (!ticker || !stats) return null;
      const last = parsePositive(ticker.price);
      const open = parsePositive(stats.open);
      return {
        last,
        change24h:
          last !== null && open !== null && open > 0 ? ((last - open) / open) * 100 : null,
        volume24h: (() => {
          const volume = parseFinite(stats.volume);
          return volume !== null && last !== null ? volume * last : null;
        })(),
        high24h: parsePositive(stats.high),
        low24h: parsePositive(stats.low),
      };
    }

    if (provider.provider === "kraken") {
      const payload = await fetchJson(`https://api.kraken.com/0/public/Ticker?pair=${symbol}`);
      const ticker = payload?.result && typeof payload.result === "object"
        ? Object.values(payload.result)[0] as any
        : null;
      if (!ticker) return null;
      const last = parsePositive(ticker.c?.[0]);
      const open = parsePositive(ticker.o);
      return {
        last,
        change24h:
          last !== null && open !== null && open > 0 ? ((last - open) / open) * 100 : null,
        volume24h: (() => {
          const volume = parseFinite(ticker.v?.[1]);
          return volume !== null && last !== null ? volume * last : null;
        })(),
        high24h: parsePositive(ticker.h?.[1]),
        low24h: parsePositive(ticker.l?.[1]),
      };
    }

    if (provider.provider === "gateio") {
      const payload = await fetchJson(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${symbol}`);
      const ticker = Array.isArray(payload) ? payload[0] : null;
      if (!ticker) return null;
      return {
        last: parsePositive(ticker.last),
        change24h: parseFinite(ticker.change_percentage),
        volume24h: parseFinite(ticker.quote_volume),
        high24h: parsePositive(ticker.high_24h),
        low24h: parsePositive(ticker.low_24h),
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
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
  const [book, trades, stats24h] = await Promise.all([
    fetchJson(`${baseUrl}/book?level=2`),
    fetchJson(`${baseUrl}/trades`),
    fetchProviderStats(provider),
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

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades, stats24h);
}

async function fetchBinance(pairLabel: string, provider: ReferenceProviderConfig): Promise<ReferenceDepthSnapshot | null> {
  const symbol = encodeURIComponent(provider.symbol);
  const [book, trades, stats24h] = await Promise.all([
    fetchJson(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=${DEPTH_LIMIT}`),
    fetchJson(`https://api.binance.com/api/v3/trades?symbol=${symbol}&limit=${TRADE_LIMIT}`),
    fetchProviderStats(provider),
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

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades, stats24h);
}

async function fetchBybit(pairLabel: string, provider: ReferenceProviderConfig): Promise<ReferenceDepthSnapshot | null> {
  const symbol = encodeURIComponent(provider.symbol);
  const [book, trades, stats24h] = await Promise.all([
    fetchJson(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${symbol}&limit=${DEPTH_LIMIT}`),
    fetchJson(`https://api.bybit.com/v5/market/recent-trade?category=spot&symbol=${symbol}&limit=${TRADE_LIMIT}`),
    fetchProviderStats(provider),
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

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades, stats24h);
}

async function fetchMexc(pairLabel: string, provider: ReferenceProviderConfig): Promise<ReferenceDepthSnapshot | null> {
  const symbol = encodeURIComponent(provider.symbol);
  const [book, trades, stats24h] = await Promise.all([
    fetchJson(`https://api.mexc.com/api/v3/depth?symbol=${symbol}&limit=${DEPTH_LIMIT}`),
    fetchJson(`https://api.mexc.com/api/v3/trades?symbol=${symbol}&limit=${TRADE_LIMIT}`),
    fetchProviderStats(provider),
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

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades, stats24h);
}

async function fetchGateIo(pairLabel: string, provider: ReferenceProviderConfig): Promise<ReferenceDepthSnapshot | null> {
  const symbol = encodeURIComponent(provider.symbol);
  const [book, trades, stats24h] = await Promise.all([
    fetchJson(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${symbol}&limit=${DEPTH_LIMIT}&with_id=false`),
    fetchJson(`https://api.gateio.ws/api/v4/spot/trades?currency_pair=${symbol}&limit=${TRADE_LIMIT}`),
    fetchProviderStats(provider),
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

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades, stats24h);
}

async function fetchKraken(pairLabel: string, provider: ReferenceProviderConfig): Promise<ReferenceDepthSnapshot | null> {
  const symbol = encodeURIComponent(provider.symbol);
  const [book, trades, stats24h] = await Promise.all([
    fetchJson(`https://api.kraken.com/0/public/Depth?pair=${symbol}&count=${DEPTH_LIMIT}`),
    fetchJson(`https://api.kraken.com/0/public/Trades?pair=${symbol}`),
    fetchProviderStats(provider),
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

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades, stats24h);
}

async function fetchReferenceDepth(pairLabel: string): Promise<ReferenceDepthSnapshot | null> {
  const pair = findTradingPair(pairLabel);
  if (!pair) return null;

  const providers = getReferenceProviders(pair);
  for (const provider of providers) {
    let snapshot: ReferenceDepthSnapshot | null = null;
    if (provider.provider === "coinbase") snapshot = await fetchCoinbase(pairLabel, provider);
    if (provider.provider === "binance") snapshot = await fetchBinance(pairLabel, provider);
    if (provider.provider === "bybit") snapshot = await fetchBybit(pairLabel, provider);
    if (provider.provider === "mexc") snapshot = await fetchMexc(pairLabel, provider);
    if (provider.provider === "gateio") snapshot = await fetchGateIo(pairLabel, provider);
    if (provider.provider === "kraken") snapshot = await fetchKraken(pairLabel, provider);
    if (snapshot) return snapshot;
  }

  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ReferenceDepthSnapshot | ErrorResponse>
) {
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
    res.status(502).json({ error: "Reference depth unavailable", fetchedAt: now });
    return;
  }

  cache.set(pairLabel, { expiresAt: now + CACHE_TTL_MS, payload: snapshot });
  res.setHeader("Cache-Control", "private, max-age=2");
  res.status(200).json(snapshot);
}
