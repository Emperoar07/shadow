import { useEffect, useMemo, useRef, useState } from "react";
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

function snapshotSignature(snapshot: MarketSnapshot): string {
  const bids = snapshot.depthSnapshot?.bids ?? [];
  const asks = snapshot.depthSnapshot?.asks ?? [];
  const trades = snapshot.depthSnapshot?.trades ?? [];
  const stats = snapshot.depthSnapshot?.stats24h ?? null;
  const bidHead = bids[0];
  const askHead = asks[0];
  const tradeHead = trades[0];

  return JSON.stringify({
    pairLabel: snapshot.pairLabel,
    last: snapshot.last,
    change24h: snapshot.change24h,
    volume24h: snapshot.volume24h,
    high24h: snapshot.high24h,
    low24h: snapshot.low24h,
    bestBid: snapshot.bestBid,
    bestAsk: snapshot.bestAsk,
    mid: snapshot.mid,
    chartSymbol: snapshot.chartSymbol,
    depthProvider: snapshot.depthProvider,
    bidHead,
    askHead,
    tradeHead,
    bidCount: bids.length,
    askCount: asks.length,
    tradeCount: trades.length,
    stats,
  });
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
  const depthStats = depthSnapshot?.stats24h ?? null;
  const last = lastTradePrice ?? mid ?? liveLast ?? pair.mockPrice;

  return {
    pairLabel: pair.label,
    last,
    change24h:
      finiteOrNull(livePrice?.change24h) ??
      finiteOrNull(depthStats?.change24h) ??
      pair.mockPriceChange,
    volume24h:
      finiteOrNull(livePrice?.volume24h) ??
      finiteOrNull(depthStats?.volume24h),
    high24h:
      positiveFiniteOrNull(livePrice?.high24h) ??
      positiveFiniteOrNull(depthStats?.high24h),
    low24h:
      positiveFiniteOrNull(livePrice?.low24h) ??
      positiveFiniteOrNull(depthStats?.low24h),
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
  const lastGoodSnapshotRef = useRef<MarketSnapshot>(buildSnapshot(pair, undefined, null));
  const lastSignatureRef = useRef<string>(snapshotSignature(lastGoodSnapshotRef.current));

  useEffect(() => {
    const initial = buildSnapshot(pair, undefined, null);
    lastGoodSnapshotRef.current = initial;
    lastSignatureRef.current = snapshotSignature(initial);
    setSnapshot(initial);
    setError(null);
    setIsLoading(true);
  }, [pair]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const depthSnapshot = await fetch(
          `/api/reference-depth?pair=${encodeURIComponent(pair.label)}`,
          {
            signal: AbortSignal.timeout(6_000),
          }
        )
          .then(async (res) =>
            res.ok ? ((await res.json()) as ReferenceDepthSnapshot) : null
          )
          .catch(() => null);

        let livePrice: PriceData | undefined;
        const needsPriceFallback =
          !depthSnapshot ||
          depthSnapshot.lastTrade == null ||
          depthSnapshot.stats24h == null;

        if (needsPriceFallback) {
          const livePrices = await fetchPrices().catch(() => null);
          livePrice = livePrices?.[pair.label];
        }

        if (cancelled) return;

        const nextSnapshot = buildSnapshot(pair, livePrice, depthSnapshot);
        const nextSignature = snapshotSignature(nextSnapshot);
        lastGoodSnapshotRef.current = nextSnapshot;
        if (nextSignature !== lastSignatureRef.current) {
          lastSignatureRef.current = nextSignature;
          setSnapshot(nextSnapshot);
        }
        setError(null);
      } catch (loadError: any) {
        if (cancelled) return;
        setSnapshot(lastGoodSnapshotRef.current);
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

    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void load();
    }, refreshMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pair, refreshMs]);

  return useMemo(
    () => ({ snapshot, isLoading, error }),
    [snapshot, isLoading, error]
  );
}
