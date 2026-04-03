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
  /** Pyth price feed ID (hex, 0x-prefixed). Same feed ID on devnet and mainnet. */
  pythFeedId: string;
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
  JUP: {
    symbol: "JUP",
    name: "Jupiter",
    mint: new PublicKey("5eaWPHYLfSh4sVz9aMWWNyVL2HQ63jRey9LKqyps6jDE"),
    decimals: 6,
    color: "#59C29F",
    coingeckoId: "jupiter-exchange-solana",
  },
  BTC: {
    symbol: "BTC",
    name: "Bitcoin (Wrapped)",
    mint: new PublicKey("Fr78KdvjEzwoHUkZaxAyaEMet3j3rj1RrkRstAFrW7Mp"),
    decimals: 8,
    color: "#F7931A",
    coingeckoId: "bitcoin",
  },
  ETH: {
    symbol: "ETH",
    name: "Ethereum (Wrapped)",
    mint: new PublicKey("9RY2ZMuaFEGRobJouxoa4zB1rUodYHQDbdbvitm14i2J"),
    decimals: 8,
    color: "#627EEA",
    coingeckoId: "ethereum",
  },
  PYTH: {
    symbol: "PYTH",
    name: "Pyth Network",
    mint: new PublicKey("CLCViKbtR5odvYuNDJR9atLcLcGKFP1Gei5Vrzice9sU"),
    decimals: 6,
    color: "#E6DAFE",
    coingeckoId: "pyth-network",
  },
  ORCA: {
    symbol: "ORCA",
    name: "Orca",
    mint: new PublicKey("8SaPwVyKXSUwQ23xG56K7oVNVmN9YhJdhE6GB4pKKNKd"),
    decimals: 6,
    color: "#FFD15C",
    coingeckoId: "orca",
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

// Trading pairs available on ShadowPerp (6 live markets)
// Pyth feed IDs: https://pyth.network/developers/price-feed-ids#solana-mainnet (same for devnet)
export const TRADING_PAIRS: TradingPair[] = [
  {
    base: DEVNET_TOKENS.SOL, quote: DEVNET_TOKENS.USDC, label: "SOL-USD",
    mockPrice: 178.45, mockPriceChange: 3.12,
    pythFeedId: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  },
  {
    base: DEVNET_TOKENS.BTC, quote: DEVNET_TOKENS.USDC, label: "BTC-USD",
    mockPrice: 97250.00, mockPriceChange: 0.87,
    pythFeedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  },
  {
    base: DEVNET_TOKENS.ETH, quote: DEVNET_TOKENS.USDC, label: "ETH-USD",
    mockPrice: 2715.30, mockPriceChange: -1.23,
    pythFeedId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  },
  {
    base: DEVNET_TOKENS.JUP, quote: DEVNET_TOKENS.USDC, label: "JUP-USD",
    mockPrice: 0.92, mockPriceChange: 1.45,
    pythFeedId: "0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996",
  },
  {
    base: DEVNET_TOKENS.PYTH, quote: DEVNET_TOKENS.USDC, label: "PYTH-USD",
    mockPrice: 0.37, mockPriceChange: 8.91,
    pythFeedId: "0x0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff",
  },
  {
    base: DEVNET_TOKENS.ORCA, quote: DEVNET_TOKENS.USDC, label: "ORCA-USD",
    mockPrice: 3.18, mockPriceChange: -2.34,
    pythFeedId: "0x37505261e557e251290b8c8899453064e8d760ed5c65a779726f2490980da74c",
  },
];

// Tokens to display in wallet balance bar
export const WALLET_DISPLAY_TOKENS = [
  DEVNET_TOKENS.USDC,
  DEVNET_TOKENS.USDT,
  DEVNET_TOKENS.SOL,
  DEVNET_TOKENS.BTC,
  DEVNET_TOKENS.ETH,
  DEVNET_TOKENS.JUP,
  DEVNET_TOKENS.PYTH,
  DEVNET_TOKENS.ORCA,
];

