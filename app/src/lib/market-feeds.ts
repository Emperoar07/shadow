import type { TradingPair } from "./tokens";

export type MarketFeedProvider =
  | "binance"
  | "bybit"
  | "mexc"
  | "coinbase"
  | "kraken"
  | "gateio";

export interface MarketFeedConfig {
  tvCandidates: string[];
  primaryProvider: MarketFeedProvider;
  primarySymbol: string;
}

const MARKET_FEEDS: Record<string, MarketFeedConfig> = {
  "SOL-PERP": {
    tvCandidates: ["BINANCE:SOLUSDT"],
    primaryProvider: "binance",
    primarySymbol: "SOLUSDT",
  },
  "BONK-PERP": {
    tvCandidates: ["BINANCE:1000BONKUSDT", "MEXC:BONKUSDT"],
    primaryProvider: "binance",
    primarySymbol: "1000BONKUSDT",
  },
  "WIF-PERP": {
    tvCandidates: ["BINANCE:WIFUSDT", "BYBIT:WIFUSDT"],
    primaryProvider: "binance",
    primarySymbol: "WIFUSDT",
  },
  "JUP-PERP": {
    tvCandidates: ["BYBIT:JUPUSDT", "MEXC:JUPUSDT"],
    primaryProvider: "bybit",
    primarySymbol: "JUPUSDT",
  },
  "BTC-PERP": {
    tvCandidates: ["BINANCE:BTCUSDT"],
    primaryProvider: "binance",
    primarySymbol: "BTCUSDT",
  },
  "ETH-PERP": {
    tvCandidates: ["BINANCE:ETHUSDT"],
    primaryProvider: "binance",
    primarySymbol: "ETHUSDT",
  },
  "PYTH-PERP": {
    tvCandidates: ["BYBIT:PYTHUSDT", "MEXC:PYTHUSDT"],
    primaryProvider: "bybit",
    primarySymbol: "PYTHUSDT",
  },
  "RAY-PERP": {
    tvCandidates: ["BINANCE:RAYUSDT", "GATEIO:RAYUSDT"],
    primaryProvider: "binance",
    primarySymbol: "RAYUSDT",
  },
  "ORCA-PERP": {
    tvCandidates: ["MEXC:ORCAUSDT", "GATEIO:ORCA_USDT"],
    primaryProvider: "mexc",
    primarySymbol: "ORCAUSDT",
  },
  "W-PERP": {
    tvCandidates: ["BINANCE:WUSDT", "BYBIT:WUSDT"],
    primaryProvider: "binance",
    primarySymbol: "WUSDT",
  },
  "JTO-PERP": {
    tvCandidates: ["BYBIT:JTOUSDT", "MEXC:JTOUSDT"],
    primaryProvider: "bybit",
    primarySymbol: "JTOUSDT",
  },
  "RENDER-PERP": {
    tvCandidates: ["BINANCE:RENDERUSDT"],
    primaryProvider: "binance",
    primarySymbol: "RENDERUSDT",
  },
  "HNT-PERP": {
    tvCandidates: ["COINBASE:HNTUSD", "KRAKEN:HNTUSD", "MEXC:HNTUSDT"],
    primaryProvider: "coinbase",
    primarySymbol: "HNT-USD",
  },
};

export function getMarketFeed(pair: TradingPair): MarketFeedConfig {
  return (
    MARKET_FEEDS[pair.label] ?? {
      tvCandidates: [`BINANCE:${pair.base.symbol}USDT`],
      primaryProvider: "binance",
      primarySymbol: `${pair.base.symbol}USDT`,
    }
  );
}
