import { useEffect, useMemo, useState } from "react";
import { fetchPrices, type PriceData } from "../lib/prices";
import { getMarketFeed } from "../lib/market-feeds";
import type { ReferenceDepthSnapshot, ReferenceLevel, ReferenceTrade } from "../lib/reference-depth";
import type { TradingPair } from "../lib/tokens";

// Client-side Gate.io fallback — runs in the browser, bypasses server-side DNS blocks.
async function fetchGateIoDirect(pair: TradingPair): Promise<ReferenceDepthSnapshot | null> {
  const feed = getMarketFeed(pair);
  const gateio = feed.referenceProviders.find((p) => p.provider === "gateio");
  if (!gateio) return null;

  const sym = encodeURIComponent(gateio.symbol);
  try {
    const [book, trades, ticker] = await Promise.all([
      fetch(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${sym}&limit=50&with_id=false`, { signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`https://api.gateio.ws/api/v4/spot/trades?currency_pair=${sym}&limit=30`, { signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${sym}`, { signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks)) return null;

    const parseLevel = (row: unknown): ReferenceLevel | null => {
      if (!Array.isArray(row) || row.length < 2) return null;
      const price = parseFloat(String(row[0]));
      const size = parseFloat(String(row[1]));
      return Number.isFinite(price) && Number.isFinite(size) && price > 0 && size > 0 ? { price, size } : null;
    };

    const bids = (book.bids as unknown[]).map(parseLevel).filter((x): x is ReferenceLevel => x !== null);
    const asks = (book.asks as unknown[]).map(parseLevel).filter((x): x is ReferenceLevel => x !== null);
    if (bids.length === 0 && asks.length === 0) return null;

    const normalizedTrades: ReferenceTrade[] = Array.isArray(trades) ? trades.map((t: any) => {
      const price = parseFloat(String(t?.price ?? ""));
      const size = parseFloat(String(t?.amount ?? ""));
      const side: ReferenceTrade["side"] = t?.side === "sell" ? "sell" : "buy";
      const timestamp = Number(t?.create_time_ms ?? t?.create_time) * (String(t?.create_time_ms ?? "").length > 10 ? 1 : 1000);
      return Number.isFinite(price) && Number.isFinite(size) ? { price, size, side, timestamp } : null;
    }).filter((x): x is ReferenceTrade => x !== null) : [];

    const tickerRow = Array.isArray(ticker) ? ticker[0] : null;
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
    const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;

    return {
      pairLabel: pair.label,
      provider: "gateio",
      symbol: gateio.symbol,
      quoteSymbol: gateio.quoteSymbol,
      bids,
      asks,
      trades: normalizedTrades,
      lastTrade: normalizedTrades[0] ?? null,
      spread,
      spreadBps: spread !== null && mid && mid > 0 ? (spread / mid) * 10_000 : null,
      stats24h: tickerRow ? {
        changePct: parseFloat(String(tickerRow?.change_percentage ?? "")) || null,
        volume: parseFloat(String(tickerRow?.quote_volume ?? "")) || null,
        high: parseFloat(String(tickerRow?.high_24h ?? "")) || null,
        low: parseFloat(String(tickerRow?.low_24h ?? "")) || null,
      } : null,
      fetchedAt: Date.now(),
      external: true,
    };
  } catch {
    return null;
  }
}

export interface MarketSnapshot {
  pairLabel: string;
  last: number;
  change24h: number | null;
  volume24h: number | null;
  high24h: number | null;
  low24h: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
  chartSymbol: string;
  depthProvider: string;
  depthSnapshot: ReferenceDepthSnapshot | null;
  fetchedAt: number;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveFiniteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function buildSnapshot(
  pair: TradingPair,
  livePrice: PriceData | undefined,
  depthSnapshot: ReferenceDepthSnapshot | null
): MarketSnapshot {
  const feed = getMarketFeed(pair);
  const bestBid = positiveFiniteOrNull(depthSnapshot?.bids?.[0]?.price);
  const bestAsk = positiveFiniteOrNull(depthSnapshot?.asks?.[0]?.price);
  const mid =
    bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const lastTradePrice = positiveFiniteOrNull(depthSnapshot?.lastTrade?.price);
  const liveLast = positiveFiniteOrNull(livePrice?.price);
  const last = lastTradePrice ?? mid ?? liveLast ?? pair.mockPrice;
  const depthStats = depthSnapshot?.stats24h ?? null;

  return {
    pairLabel: pair.label,
    last,
    change24h:
      finiteOrNull(livePrice?.change24h) ??
      finiteOrNull(depthStats?.changePct) ??
      pair.mockPriceChange,
    volume24h:
      finiteOrNull(livePrice?.volume24h) ??
      positiveFiniteOrNull(depthStats?.volume),
    high24h:
      positiveFiniteOrNull(livePrice?.high24h) ??
      positiveFiniteOrNull(depthStats?.high),
    low24h:
      positiveFiniteOrNull(livePrice?.low24h) ??
      positiveFiniteOrNull(depthStats?.low),
    bestBid,
    bestAsk,
    mid,
    chartSymbol: feed.primaryChartSymbol ?? `BINANCE:${pair.base.symbol}USDT`,
    depthProvider:
      depthSnapshot?.provider ??
      feed.referenceProviders[0]?.provider ??
      feed.primaryDepthProvider,
    depthSnapshot,
    fetchedAt: Date.now(),
  };
}

export function useMarketSnapshot(pair: TradingPair, refreshMs = 4_000) {
  const [snapshot, setSnapshot] = useState<MarketSnapshot>(() =>
    buildSnapshot(pair, undefined, null)
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset snapshot immediately when pair changes so stale data from previous pair is cleared
  const pairLabel = pair.label;
  useEffect(() => {
    setSnapshot(buildSnapshot(pair, undefined, null));
  }, [pairLabel]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [livePrices, serverDepth] = await Promise.all([
          fetchPrices().catch(() => null),
          fetch(`/api/reference-depth?pair=${encodeURIComponent(pair.label)}`, {
            signal: AbortSignal.timeout(6_000),
          })
            .then(async (res) =>
              res.ok ? ((await res.json()) as ReferenceDepthSnapshot) : null
            )
            .catch(() => null),
        ]);

        // If server-side fetch failed, try Gate.io directly from the browser.
        const depthSnapshot = serverDepth ?? await fetchGateIoDirect(pair).catch(() => null);

        if (cancelled) return;

        const livePrice = livePrices?.[pair.label];
        setSnapshot((prev) =>
          buildSnapshot(pair, livePrice, depthSnapshot ?? (prev.pairLabel === pair.label ? prev.depthSnapshot : null))
        );
        setError(null);
      } catch (loadError: any) {
        if (cancelled) return;
        setSnapshot((prev) => buildSnapshot(pair, undefined, prev.pairLabel === pair.label ? prev.depthSnapshot : null));
        setError(
          typeof loadError?.message === "string"
            ? loadError.message
            : "Market snapshot unavailable"
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    setIsLoading(true);
    void load();
    const id = window.setInterval(() => void load(), refreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pair, refreshMs]);

  return useMemo(
    () => ({ snapshot, isLoading, error }),
    [snapshot, isLoading, error]
  );
}
