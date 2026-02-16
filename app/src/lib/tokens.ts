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
  label: string; // e.g. "SOL-PERP"
}

// Well-known Solana devnet token mints
export const DEVNET_TOKENS: Record<string, TokenInfo> = {
  SOL: {
    symbol: "SOL",
    name: "Solana",
    mint: new PublicKey("So11111111111111111111111111111111111111112"),
    decimals: 9,
    color: "#9945FF",
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
  },
  WIF: {
    symbol: "WIF",
    name: "dogwifhat",
    mint: new PublicKey("EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"),
    decimals: 6,
    color: "#B8860B",
  },
  JUP: {
    symbol: "JUP",
    name: "Jupiter",
    mint: new PublicKey("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"),
    decimals: 6,
    color: "#59C29F",
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
  {
    base: DEVNET_TOKENS.SOL,
    quote: DEVNET_TOKENS.USDC,
    label: "SOL-PERP",
  },
  {
    base: DEVNET_TOKENS.BONK,
    quote: DEVNET_TOKENS.USDC,
    label: "BONK-PERP",
  },
  {
    base: DEVNET_TOKENS.WIF,
    quote: DEVNET_TOKENS.USDC,
    label: "WIF-PERP",
  },
  {
    base: DEVNET_TOKENS.JUP,
    quote: DEVNET_TOKENS.USDC,
    label: "JUP-PERP",
  },
  {
    base: DEVNET_TOKENS.BTC,
    quote: DEVNET_TOKENS.USDC,
    label: "BTC-PERP",
  },
  {
    base: DEVNET_TOKENS.ETH,
    quote: DEVNET_TOKENS.USDC,
    label: "ETH-PERP",
  },
  {
    base: DEVNET_TOKENS.PYTH,
    quote: DEVNET_TOKENS.USDC,
    label: "PYTH-PERP",
  },
  {
    base: DEVNET_TOKENS.RAY,
    quote: DEVNET_TOKENS.USDC,
    label: "RAY-PERP",
  },
  {
    base: DEVNET_TOKENS.ORCA,
    quote: DEVNET_TOKENS.USDC,
    label: "ORCA-PERP",
  },
  {
    base: DEVNET_TOKENS.W,
    quote: DEVNET_TOKENS.USDC,
    label: "W-PERP",
  },
  {
    base: DEVNET_TOKENS.JTO,
    quote: DEVNET_TOKENS.USDC,
    label: "JTO-PERP",
  },
  {
    base: DEVNET_TOKENS.RENDER,
    quote: DEVNET_TOKENS.USDC,
    label: "RENDER-PERP",
  },
  {
    base: DEVNET_TOKENS.HNT,
    quote: DEVNET_TOKENS.USDC,
    label: "HNT-PERP",
  },
];

// Tokens to display in wallet balance bar
export const WALLET_DISPLAY_TOKENS = [
  DEVNET_TOKENS.USDC,
  DEVNET_TOKENS.USDT,
  DEVNET_TOKENS.BONK,
];


