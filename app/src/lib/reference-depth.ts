import { TRADING_PAIRS, type TradingPair } from "./tokens";
import {
  getMarketFeed,
  getOrderedReferenceProviders,
  type ReferenceProviderConfig,
  type MarketFeedProvider,
} from "./market-feeds";

export type { ReferenceProviderConfig } from "./market-feeds";

export type ReferenceDepthProvider = MarketFeedProvider;

export interface ReferenceLevel {
  price: number;
  size: number;
}

export interface ReferenceTrade {
  price: number;
  size: number;
  side: "buy" | "sell";
  timestamp: number;
}

export interface ReferenceStats24h {
  last: number | null;
  change24h: number | null;
  volume24h: number | null;
  high24h: number | null;
  low24h: number | null;
}

export interface ReferenceDepthSnapshot {
  pairLabel: string;
  provider: ReferenceDepthProvider;
  symbol: string;
  quoteSymbol: string;
  bids: ReferenceLevel[];
  asks: ReferenceLevel[];
  trades: ReferenceTrade[];
  lastTrade: ReferenceTrade | null;
  spread: number | null;
  spreadBps: number | null;
  stats24h: ReferenceStats24h | null;
  fetchedAt: number;
  external: true;
}

export interface GroupedReferenceLevel extends ReferenceLevel {
  total: number;
}

export function getReferenceProviders(pair: TradingPair): ReferenceProviderConfig[] {
  return getOrderedReferenceProviders(pair);
}

export function getDepthPresentation(pair: TradingPair): {
  preferredGrouping: number;
  minVisibleLevels: number;
} {
  const feed = getMarketFeed(pair);
  return {
    preferredGrouping: feed.preferredGrouping,
    minVisibleLevels: feed.minVisibleLevels,
  };
}

export function findTradingPair(label: string): TradingPair | null {
  return TRADING_PAIRS.find((pair) => pair.label === label) ?? null;
}

export function getGroupingOptions(referencePrice: number | null | undefined): number[] {
  if (!referencePrice || referencePrice <= 0) {
    return [0.01, 0.1, 1, 10, 50, 100];
  }

  if (referencePrice < 0.001) return [0.0000001, 0.000001, 0.00001, 0.0001, 0.001, 0.01];
  if (referencePrice < 0.01) return [0.000001, 0.00001, 0.0001, 0.001, 0.01, 0.1];
  if (referencePrice < 0.1) return [0.0001, 0.001, 0.01, 0.1, 1, 10];
  if (referencePrice < 1) return [0.001, 0.01, 0.1, 0.25, 0.5, 1];
  if (referencePrice < 100) return [0.01, 0.05, 0.1, 0.25, 0.5, 1];
  if (referencePrice < 10000) return [0.1, 0.5, 1, 5, 10, 25];
  return [1, 10, 50, 100, 500, 1000];
}

export function getDefaultGrouping(referencePrice: number | null | undefined): number {
  const options = getGroupingOptions(referencePrice);

  if (!referencePrice || referencePrice <= 0) {
    return options[1] ?? options[0] ?? 1;
  }

  if (referencePrice < 0.001) return options[1] ?? options[0] ?? 0.000001;
  if (referencePrice < 0.01) return options[1] ?? options[0] ?? 0.00001;
  if (referencePrice < 0.1) return options[1] ?? options[0] ?? 0.001;
  if (referencePrice < 1) return options[1] ?? options[0] ?? 0.01;
  if (referencePrice < 100) return options[0] ?? 0.01;
  if (referencePrice < 10000) return options[0] ?? 0.1;
  return options[1] ?? options[0] ?? 10;
}

export function formatPrice(value: number): string {
  if (value >= 10000) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 1000) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 100) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (value >= 0.01) return value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  if (value >= 0.0001) return value.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 });
  return value.toLocaleString(undefined, { minimumFractionDigits: 8, maximumFractionDigits: 8 });
}

export function formatSize(value: number): string {
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (value >= 1) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

export function groupLevels(
  levels: ReferenceLevel[],
  grouping: number,
  side: "bids" | "asks",
  limit = 24
): GroupedReferenceLevel[] {
  const buckets = new Map<number, number>();

  for (const level of levels) {
    if (!Number.isFinite(level.price) || !Number.isFinite(level.size)) continue;
    const groupedPrice =
      side === "bids"
        ? Math.floor(level.price / grouping) * grouping
        : Math.ceil(level.price / grouping) * grouping;
    const next = (buckets.get(groupedPrice) ?? 0) + level.size;
    buckets.set(Number(groupedPrice.toFixed(12)), next);
  }

  const sorted = Array.from(buckets.entries())
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => (side === "bids" ? b.price - a.price : a.price - b.price))
    .slice(0, limit);

  let runningTotal = 0;
  return sorted.map((level) => {
    runningTotal += level.size;
    return {
      ...level,
      total: runningTotal,
    };
  });
}

export function groupLevelsAdaptive(
  levels: ReferenceLevel[],
  groupingOptions: number[],
  preferredGrouping: number,
  side: "bids" | "asks",
  limit = 24,
  minRows = 12
): GroupedReferenceLevel[] {
  const uniqueOptions = Array.from(
    new Set(
      [...groupingOptions, preferredGrouping]
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b)
    )
  );

  let best = groupLevels(levels, preferredGrouping, side, limit);
  if (best.length >= minRows || uniqueOptions.length === 0) {
    return best;
  }

  for (const option of uniqueOptions) {
    const candidate = groupLevels(levels, option, side, limit);
    if (candidate.length > best.length) {
      best = candidate;
    }
    if (candidate.length >= minRows) {
      return candidate;
    }
  }

  const rawLevels = levels
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size))
    .sort((a, b) => (side === "bids" ? b.price - a.price : a.price - b.price))
    .slice(0, limit);

  if (rawLevels.length > best.length) {
    let runningTotal = 0;
    return rawLevels.map((level) => {
      runningTotal += level.size;
      return {
        ...level,
        total: runningTotal,
      };
    });
  }

  return best;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
