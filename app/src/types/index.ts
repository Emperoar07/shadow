import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// Position status enum matching on-chain state
export enum PositionStatus {
  Pending = 0,
  Open = 1,
  Closing = 2,
  Closed = 3,
  Liquidated = 4,
  ClosedPendingSettlement = 5,
  LiquidatedPendingSettlement = 6,
}

// Position direction
export type PositionDirection = "long" | "short";
export type MarginMode = "cross" | "isolated";

// Position input for opening a new position
export interface OpenPositionInput {
  size: BN; // Position size in base units
  entryPrice: BN; // Entry price in quote units
  leverage: number; // 1-100
  direction: PositionDirection;
  margin: BN; // Collateral amount
  marginMode?: MarginMode;
}

// Encrypted position data (as stored on-chain)
export interface EncryptedPosition {
  owner: PublicKey;
  market: PublicKey;
  encryptedData: Uint8Array; // 256 bytes of encrypted position data
  status: PositionStatus;
  openedAt: BN;
  closedAt: BN;
  margin: BN; // Deprecated compatibility field; new active positions keep this as 0
  realizedPnl: BN; // Only set after close
  nonce: Uint8Array;
  clientPubkey: Uint8Array;
  index: BN;
}

// Market state
export interface Market {
  authority: PublicKey;
  collateralMint: PublicKey;
  vault: PublicKey;
  oraclePrice: BN;
  lastPriceUpdate: BN;
  maxLeverage: number;
  liquidationThreshold: number; // basis points
  tradingFee: number; // basis points
  activePositions: BN;
  totalFeesCollected: BN;
  priceFeeder: PublicKey;
  mxeCluster: PublicKey;
  openPositionCompDef: PublicKey;
  closePositionCompDef: PublicKey;
  liquidationCompDef: PublicKey;
  seedOpenInterestCompDef: PublicKey;
}

// Margin account state
export interface MarginAccount {
  owner: PublicKey;
  market: PublicKey; // Legacy compatibility field; shared-collateral migration uses owner-scoped PDAs.
  balance: BN;
  lockedBalance: BN;
  totalDeposited: BN;
  totalWithdrawn: BN;
  positionsOpened: BN;
  positionsClosed: BN;
  totalRealizedPnl: BN;
}

export interface TradeSession {
  owner: PublicKey;
  market: PublicKey;
  relayer: PublicKey;
  sessionId: BN;
  maxActions: number;
  usedActions: number;
  maxMarginPerAction: BN;
  expiresAt: BN;
  revoked: boolean;
  bump: number;
}

export interface TradeSessionV2 {
  owner: PublicKey;
  relayer: PublicKey;
  sessionId: BN;
  maxActions: number;
  usedActions: number;
  maxMarginPerAction: BN;
  expiresAt: BN;
  revoked: boolean;
  scopeAllMarkets: boolean;
  bump: number;
}

// Close position result (revealed data)
export interface ClosePositionResult {
  realizedPnl: BN;
  settlementAmount: BN;
  fee: BN;
  lockedMargin: BN;
}

// Events
export interface PositionOpenedEvent {
  owner: PublicKey;
  position: PublicKey;
  market: PublicKey;
  timestamp: BN;
}

export interface PositionClosedEvent {
  owner: PublicKey;
  position: PublicKey;
  timestamp: BN;
}

export interface PositionLiquidatedEvent {
  owner: PublicKey;
  position: PublicKey;
  timestamp: BN;
}

// SDK Configuration
export interface ShadowPerpConfig {
  programId: PublicKey;
  arciumProgramId: PublicKey;
  mxeProgramId: PublicKey;
  clusterOffset: number;
  clusterAddress: PublicKey;
  /** Default market (SOL-USD) — kept for backwards compat */
  marketAddress: PublicKey;
  /** Per-pair market addresses: label → PDA (e.g. "BTC-USD" → PublicKey) */
  marketRegistry: Record<string, PublicKey>;
  mempoolAccount: PublicKey;
  executingPool: PublicKey;
  poolAccount: PublicKey;
  signPdaAccount: PublicKey;
  idl: any;
}
