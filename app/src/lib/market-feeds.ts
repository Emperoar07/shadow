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
  tvCandidates: string[];
  primaryProvider: MarketFeedProvider;
  primarySymbol: string;
  referenceProviders: ReferenceProviderConfig[];
}

const MARKET_FEEDS: Record<string, MarketFeedConfig> = {
  "SOL-PERP": {
    tvCandidates: ["BINANCE:SOLUSDT"],
    primaryProvider: "binance",
    primarySymbol: "SOLUSDT",
    referenceProviders: [
      { provider: "binance", symbol: "SOLUSDT", quoteSymbol: "USDT" },
      { provider: "coinbase", symbol: "SOL-USD", quoteSymbol: "USD" },
      { provider: "bybit", symbol: "SOLUSDT", quoteSymbol: "USDT" },
    ],
  },
  "WIF-PERP": {
    tvCandidates: ["BINANCE:WIFUSDT", "BYBIT:WIFUSDT"],
    primaryProvider: "binance",
    primarySymbol: "WIFUSDT",
    referenceProviders: [
      { provider: "binance", symbol: "WIFUSDT", quoteSymbol: "USDT" },
      { provider: "bybit", symbol: "WIFUSDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "WIFUSDT", quoteSymbol: "USDT" },
    ],
  },
  "JUP-PERP": {
    tvCandidates: ["BYBIT:JUPUSDT", "MEXC:JUPUSDT"],
    primaryProvider: "bybit",
    primarySymbol: "JUPUSDT",
    referenceProviders: [
      { provider: "bybit", symbol: "JUPUSDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "JUPUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "JUP_USDT", quoteSymbol: "USDT" },
    ],
  },
  "BTC-PERP": {
    tvCandidates: ["BINANCE:BTCUSDT"],
    primaryProvider: "binance",
    primarySymbol: "BTCUSDT",
    referenceProviders: [
      { provider: "binance", symbol: "BTCUSDT", quoteSymbol: "USDT" },
      { provider: "coinbase", symbol: "BTC-USD", quoteSymbol: "USD" },
      { provider: "bybit", symbol: "BTCUSDT", quoteSymbol: "USDT" },
    ],
  },
  "ETH-PERP": {
    tvCandidates: ["BINANCE:ETHUSDT"],
    primaryProvider: "binance",
    primarySymbol: "ETHUSDT",
    referenceProviders: [
      { provider: "binance", symbol: "ETHUSDT", quoteSymbol: "USDT" },
      { provider: "coinbase", symbol: "ETH-USD", quoteSymbol: "USD" },
      { provider: "bybit", symbol: "ETHUSDT", quoteSymbol: "USDT" },
    ],
  },
  "PYTH-PERP": {
    tvCandidates: ["BYBIT:PYTHUSDT", "MEXC:PYTHUSDT"],
    primaryProvider: "bybit",
    primarySymbol: "PYTHUSDT",
    referenceProviders: [
      { provider: "bybit", symbol: "PYTHUSDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "PYTHUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "PYTH_USDT", quoteSymbol: "USDT" },
    ],
  },
  "RAY-PERP": {
    tvCandidates: ["BINANCE:RAYUSDT", "GATEIO:RAYUSDT"],
    primaryProvider: "binance",
    primarySymbol: "RAYUSDT",
    referenceProviders: [
      { provider: "binance", symbol: "RAYUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "RAY_USDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "RAYUSDT", quoteSymbol: "USDT" },
    ],
  },
  "ORCA-PERP": {
    tvCandidates: ["MEXC:ORCAUSDT", "GATEIO:ORCA_USDT"],
    primaryProvider: "mexc",
    primarySymbol: "ORCAUSDT",
    referenceProviders: [
      { provider: "mexc", symbol: "ORCAUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "ORCA_USDT", quoteSymbol: "USDT" },
    ],
  },
  "W-PERP": {
    tvCandidates: ["BINANCE:WUSDT", "BYBIT:WUSDT"],
    primaryProvider: "binance",
    primarySymbol: "WUSDT",
    referenceProviders: [
      { provider: "binance", symbol: "WUSDT", quoteSymbol: "USDT" },
      { provider: "bybit", symbol: "WUSDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "WUSDT", quoteSymbol: "USDT" },
    ],
  },
  "JTO-PERP": {
    tvCandidates: ["BYBIT:JTOUSDT", "MEXC:JTOUSDT"],
    primaryProvider: "bybit",
    primarySymbol: "JTOUSDT",
    referenceProviders: [
      { provider: "bybit", symbol: "JTOUSDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "JTOUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "JTO_USDT", quoteSymbol: "USDT" },
    ],
  },
  "RENDER-PERP": {
    tvCandidates: ["BINANCE:RENDERUSDT"],
    primaryProvider: "binance",
    primarySymbol: "RENDERUSDT",
    referenceProviders: [
      { provider: "binance", symbol: "RENDERUSDT", quoteSymbol: "USDT" },
      { provider: "gateio", symbol: "RENDER_USDT", quoteSymbol: "USDT" },
      { provider: "mexc", symbol: "RENDERUSDT", quoteSymbol: "USDT" },
    ],
  },
  "HNT-PERP": {
    tvCandidates: ["MEXC:HNTUSDT", "COINBASE:HNTUSD", "KRAKEN:HNTUSD"],
    primaryProvider: "mexc",
    primarySymbol: "HNTUSDT",
    referenceProviders: [
      { provider: "mexc", symbol: "HNTUSDT", quoteSymbol: "USDT" },
      { provider: "coinbase", symbol: "HNT-USD", quoteSymbol: "USD" },
      { provider: "kraken", symbol: "HNTUSD", quoteSymbol: "USD" },
    ],
  },
};

export function getMarketFeed(pair: TradingPair): MarketFeedConfig {
  return (
    MARKET_FEEDS[pair.label] ?? {
      tvCandidates: [`BINANCE:${pair.base.symbol}USDT`],
      primaryProvider: "binance",
      primarySymbol: `${pair.base.symbol}USDT`,
      referenceProviders: [
        { provider: "binance", symbol: `${pair.base.symbol}USDT`, quoteSymbol: "USDT" },
      ],
    }
  );
}
