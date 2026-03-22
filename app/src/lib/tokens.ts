import { PublicKey } from "@solana/web3.js";

export interface TokenInfo {
  symbol: string;
  name: string;
  mint: PublicKey;
  decimals: number;
  color: string;
  coingeckoId?: string;
}

export interface TradingPair {
  base: TokenInfo;
  quote: TokenInfo;
  label: string; // e.g. "SOL-USD"
  mockPrice: number; // fallback price when oracle/market data is unavailable
  mockPriceChange: number; // fallback 24h change %
}

// Well-known Solana devnet token mints
export const DEVNET_TOKENS: Record<string, TokenInfo> = {
  SOL: {
    symbol: "SOL",
    name: "Solana",
    mint: new PublicKey("So11111111111111111111111111111111111111112"),
    decimals: 9,
    color: "#9945FF",
    coingeckoId: "solana",
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    mint: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
    decimals: 6,
    color: "#2775CA",
  },
  USDT: {
    symbol: "USDT",
    name: "Tether USD",
    mint: new PublicKey("EJwZgeZrdC8TXTQbQBoL6bfuAnFUQYWooPadoaGETMgk"),
    decimals: 6,
    color: "#50AF95",
  },
  BONK: {
    symbol: "BONK",
    name: "Bonk",
    mint: new PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"),
    decimals: 5,
    color: "#F5A623",
    coingeckoId: "bonk",
  },
  WIF: {
    symbol: "WIF",
    name: "dogwifhat",
    mint: new PublicKey("EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"),
    decimals: 6,
    color: "#B8860B",
    coingeckoId: "dogwifcoin",
  },
  JUP: {
    symbol: "JUP",
    name: "Jupiter",
    mint: new PublicKey("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"),
    decimals: 6,
    color: "#59C29F",
    coingeckoId: "jupiter-exchange-solana",
  },
  BTC: {
    symbol: "BTC",
    name: "Bitcoin (Wrapped)",
    mint: new PublicKey("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh"),
    decimals: 8,
    color: "#F7931A",
    coingeckoId: "bitcoin",
  },
  ETH: {
    symbol: "ETH",
    name: "Ethereum (Wrapped)",
    mint: new PublicKey("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"),
    decimals: 8,
    color: "#627EEA",
    coingeckoId: "ethereum",
  },
  PYTH: {
    symbol: "PYTH",
    name: "Pyth Network",
    mint: new PublicKey("HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3"),
    decimals: 6,
    color: "#E6DAFE",
    coingeckoId: "pyth-network",
  },
  RAY: {
    symbol: "RAY",
    name: "Raydium",
    mint: new PublicKey("4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"),
    decimals: 6,
    color: "#4F67FF",
    coingeckoId: "raydium",
  },
  ORCA: {
    symbol: "ORCA",
    name: "Orca",
    mint: new PublicKey("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE"),
    decimals: 6,
    color: "#FFD15C",
    coingeckoId: "orca",
  },
  W: {
    symbol: "W",
    name: "Wormhole",
    mint: new PublicKey("85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ"),
    decimals: 6,
    color: "#fff",
    coingeckoId: "wormhole",
  },
  JTO: {
    symbol: "JTO",
    name: "Jito",
    mint: new PublicKey("jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL"),
    decimals: 9,
    color: "#78DCB8",
    coingeckoId: "jito-governance-token",
  },
  RENDER: {
    symbol: "RENDER",
    name: "Render",
    mint: new PublicKey("rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof"),
    decimals: 8,
    color: "#E02020",
    coingeckoId: "render-token",
  },
  HNT: {
    symbol: "HNT",
    name: "Helium",
    mint: new PublicKey("hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux"),
    decimals: 8,
    color: "#474DFF",
    coingeckoId: "helium",
  },
};

// Trading pairs available on ShadowPerp
export const TRADING_PAIRS: TradingPair[] = [
  { base: DEVNET_TOKENS.SOL, quote: DEVNET_TOKENS.USDC, label: "SOL-USD", mockPrice: 178.45, mockPriceChange: 3.12 },
  { base: DEVNET_TOKENS.WIF, quote: DEVNET_TOKENS.USDC, label: "WIF-USD", mockPrice: 0.68, mockPriceChange: 12.34 },
  { base: DEVNET_TOKENS.JUP, quote: DEVNET_TOKENS.USDC, label: "JUP-USD", mockPrice: 0.92, mockPriceChange: 1.45 },
  { base: DEVNET_TOKENS.BTC, quote: DEVNET_TOKENS.USDC, label: "BTC-USD", mockPrice: 97250.00, mockPriceChange: 0.87 },
  { base: DEVNET_TOKENS.ETH, quote: DEVNET_TOKENS.USDC, label: "ETH-USD", mockPrice: 2715.30, mockPriceChange: -1.23 },
  { base: DEVNET_TOKENS.PYTH, quote: DEVNET_TOKENS.USDC, label: "PYTH-USD", mockPrice: 0.37, mockPriceChange: 8.91 },
  { base: DEVNET_TOKENS.RAY, quote: DEVNET_TOKENS.USDC, label: "RAY-USD", mockPrice: 5.42, mockPriceChange: 4.56 },
  { base: DEVNET_TOKENS.ORCA, quote: DEVNET_TOKENS.USDC, label: "ORCA-USD", mockPrice: 3.18, mockPriceChange: -2.34 },
  { base: DEVNET_TOKENS.W, quote: DEVNET_TOKENS.USDC, label: "W-USD", mockPrice: 0.58, mockPriceChange: 6.78 },
  { base: DEVNET_TOKENS.JTO, quote: DEVNET_TOKENS.USDC, label: "JTO-USD", mockPrice: 3.45, mockPriceChange: -0.45 },
  { base: DEVNET_TOKENS.RENDER, quote: DEVNET_TOKENS.USDC, label: "RENDER-USD", mockPrice: 7.82, mockPriceChange: 2.10 },
];

// Tokens to display in wallet balance bar
export const WALLET_DISPLAY_TOKENS = [
  DEVNET_TOKENS.USDC,
  DEVNET_TOKENS.USDT,
  DEVNET_TOKENS.WIF,
  DEVNET_TOKENS.JUP,
  DEVNET_TOKENS.PYTH,
  DEVNET_TOKENS.RAY,
  DEVNET_TOKENS.ORCA,
  DEVNET_TOKENS.W,
  DEVNET_TOKENS.JTO,
  DEVNET_TOKENS.RENDER,
  DEVNET_TOKENS.BTC,
  DEVNET_TOKENS.ETH,
];

