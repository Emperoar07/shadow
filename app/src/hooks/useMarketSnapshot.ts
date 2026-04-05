import { useEffect, useMemo, useState } from "react";
import { fetchPrices, type PriceData } from "../lib/prices";
import { getMarketFeed } from "../lib/market-feeds";
import type { ReferenceDepthSnapshot } from "../lib/reference-depth";
import type { TradingPair } from "../lib/tokens";

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

        const depthSnapshot = serverDepth;

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
