import type { TradingPair } from "./tokens";

export type MarketFeedProvider =
  | "binance"
  | "bybit"
  | "mexc"
  | "coinbase"
  | "kraken"
  | "gateio";

export interface ReferenceProviderConfig {
  provider: MarketFeedProvider;
  symbol: string;
  quoteSymbol: string;
}

export interface MarketFeedConfig {
  primaryChartSymbol: string;
  primaryDepthProvider: MarketFeedProvider;
  secondaryDepthProvider?: MarketFeedProvider;
  minVisibleLevels: number;
  preferredGrouping: number;
  referenceProviders: ReferenceProviderConfig[];
}

const MARKET_FEEDS: Record<string, MarketFeedConfig> = {
  "SOL-USD": {
    primaryChartSymbol: "BINANCE:SOLUSDT.P",
    primaryDepthProvider: "binance",
    secondaryDepthProvider: "coinbase",
    minVisibleLevels: 16,
    preferredGrouping: 0.1,
    referenceProviders: [
      { provider: "binance", symbol: "SOLUSDT", quoteSymbol: "USDT" },
      { provider: "coinbase", symbol: "SOL-USD", quoteSymbol: "USD" },
      { provider: "bybit", symbol: "SOLUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "SOL_USDT", quoteSymbol: "USDT" },
    ],
  },
  "WIF-USD": {
    primaryChartSymbol: "BINANCE:WIFUSDT.P",
    primaryDepthProvider: "binance",
    secondaryDepthProvider: "bybit",
    minVisibleLevels: 14,
    preferredGrouping: 0.001,
    referenceProviders: [
      { provider: "binance", symbol: "WIFUSDT", quoteSymbol: "USDT" },
      { provider: "bybit", symbol: "WIFUSDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "WIFUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "WIF_USDT", quoteSymbol: "USDT" },
    ],
  },
  "JUP-USD": {
    primaryChartSymbol: "BINANCE:JUPUSDT.P",
    primaryDepthProvider: "bybit",
    secondaryDepthProvider: "mexc",
    minVisibleLevels: 14,
    preferredGrouping: 0.001,
    referenceProviders: [
      { provider: "bybit", symbol: "JUPUSDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "JUPUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "JUP_USDT", quoteSymbol: "USDT" },
    ],
  },
  "BTC-USD": {
    primaryChartSymbol: "BINANCE:BTCUSDT.P",
    primaryDepthProvider: "binance",
    secondaryDepthProvider: "coinbase",
    minVisibleLevels: 16,
    preferredGrouping: 1,
    referenceProviders: [
      { provider: "binance", symbol: "BTCUSDT", quoteSymbol: "USDT" },
      { provider: "coinbase", symbol: "BTC-USD", quoteSymbol: "USD" },
      { provider: "bybit", symbol: "BTCUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "BTC_USDT", quoteSymbol: "USDT" },
    ],
  },
  "ETH-USD": {
    primaryChartSymbol: "BINANCE:ETHUSDT.P",
    primaryDepthProvider: "binance",
    secondaryDepthProvider: "coinbase",
    minVisibleLevels: 16,
    preferredGrouping: 0.5,
    referenceProviders: [
      { provider: "binance", symbol: "ETHUSDT", quoteSymbol: "USDT" },
      { provider: "coinbase", symbol: "ETH-USD", quoteSymbol: "USD" },
      { provider: "bybit", symbol: "ETHUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "ETH_USDT", quoteSymbol: "USDT" },
    ],
  },
  "PYTH-USD": {
    primaryChartSymbol: "BINANCE:PYTHUSDT.P",
    primaryDepthProvider: "bybit",
    secondaryDepthProvider: "mexc",
    minVisibleLevels: 14,
    preferredGrouping: 0.001,
    referenceProviders: [
      { provider: "bybit", symbol: "PYTHUSDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "PYTHUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "PYTH_USDT", quoteSymbol: "USDT" },
    ],
  },
  "RAY-USD": {
    primaryChartSymbol: "BINANCE:RAYUSDT.P",
    primaryDepthProvider: "binance",
    secondaryDepthProvider: "gateio",
    minVisibleLevels: 14,
    preferredGrouping: 0.001,
    referenceProviders: [
      { provider: "binance", symbol: "RAYUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "RAY_USDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "RAYUSDT", quoteSymbol: "USDT" },
    ],
  },
  "ORCA-USD": {
    primaryChartSymbol: "BYBIT:ORCAUSDT.P",
    primaryDepthProvider: "mexc",
    secondaryDepthProvider: "gateio",
    minVisibleLevels: 14,
    preferredGrouping: 0.001,
    referenceProviders: [
      { provider: "mexc", symbol: "ORCAUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "ORCA_USDT", quoteSymbol: "USDT" },
    ],
  },
  "W-USD": {
    primaryChartSymbol: "BINANCE:WUSDT.P",
    primaryDepthProvider: "binance",
    secondaryDepthProvider: "bybit",
    minVisibleLevels: 14,
    preferredGrouping: 0.001,
    referenceProviders: [
      { provider: "binance", symbol: "WUSDT", quoteSymbol: "USDT" },
      { provider: "bybit", symbol: "WUSDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "WUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "W_USDT", quoteSymbol: "USDT" },
    ],
  },
  "JTO-USD": {
    primaryChartSymbol: "BINANCE:JTOUSDT.P",
    primaryDepthProvider: "bybit",
    secondaryDepthProvider: "mexc",
    minVisibleLevels: 14,
    preferredGrouping: 0.001,
    referenceProviders: [
      { provider: "bybit", symbol: "JTOUSDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "JTOUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "JTO_USDT", quoteSymbol: "USDT" },
    ],
  },
  "RENDER-USD": {
    primaryChartSymbol: "BINANCE:RENDERUSDT.P",
    primaryDepthProvider: "binance",
    secondaryDepthProvider: "gateio",
    minVisibleLevels: 14,
    preferredGrouping: 0.001,
    referenceProviders: [
      { provider: "binance", symbol: "RENDERUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "RENDER_USDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "RENDERUSDT", quoteSymbol: "USDT" },
    ],
  },
};

export function getMarketFeed(pair: TradingPair): MarketFeedConfig {
  return (
    MARKET_FEEDS[pair.label] ?? {
      primaryChartSymbol: `BINANCE:${pair.base.symbol}USDT.P`,
      primaryDepthProvider: "binance",
      secondaryDepthProvider: undefined,
      minVisibleLevels: 12,
      preferredGrouping: 0.01,
      referenceProviders: [
        { provider: "binance", symbol: `${pair.base.symbol}USDT`, quoteSymbol: "USDT" },
      ],
    }
  );
}

export function getOrderedReferenceProviders(pair: TradingPair): ReferenceProviderConfig[] {
  const feed = getMarketFeed(pair);
  const providerOrder = [feed.primaryDepthProvider, feed.secondaryDepthProvider].filter(
    (provider): provider is MarketFeedProvider => Boolean(provider)
  );
  const seen = new Set<string>();
  const ordered: ReferenceProviderConfig[] = [];

  for (const provider of providerOrder) {
    const match = feed.referenceProviders.find((candidate) => candidate.provider === provider);
    if (!match) continue;
    const key = `${match.provider}:${match.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(match);
  }

  for (const candidate of feed.referenceProviders) {
    const key = `${candidate.provider}:${candidate.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(candidate);
  }

  return ordered;
}
