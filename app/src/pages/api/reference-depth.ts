import type { NextApiRequest, NextApiResponse } from "next";
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
const DEPTH_LIMIT = 24;
const TRADE_LIMIT = 18;

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
  trades: ReferenceTrade[]
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
    fetchedAt: Date.now(),
    external: true,
  };
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
  const [book, trades] = await Promise.all([
    fetchJson(`${baseUrl}/book?level=2`),
    fetchJson(`${baseUrl}/trades`),
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

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades);
}

async function fetchBinance(pairLabel: string, provider: ReferenceProviderConfig): Promise<ReferenceDepthSnapshot | null> {
  const symbol = encodeURIComponent(provider.symbol);
  const [book, trades] = await Promise.all([
    fetchJson(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=${DEPTH_LIMIT}`),
    fetchJson(`https://api.binance.com/api/v3/trades?symbol=${symbol}&limit=${TRADE_LIMIT}`),
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

  return buildSnapshot(pairLabel, provider, bids, asks, normalizedTrades);
}

async function fetchReferenceDepth(pairLabel: string): Promise<ReferenceDepthSnapshot | null> {
  const pair = findTradingPair(pairLabel);
  if (!pair) return null;

  const providers = getReferenceProviders(pair);
  for (const provider of providers) {
    const snapshot =
      provider.provider === "coinbase"
        ? await fetchCoinbase(pairLabel, provider)
        : await fetchBinance(pairLabel, provider);
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
