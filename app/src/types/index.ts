import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// Position status enum matching on-chain state
export enum PositionStatus {
  Pending = 0,
  Open = 1,
  Closing = 2,
  Closed = 3,
  Liquidated = 4,
}

// Position direction
export type PositionDirection = "long" | "short";

// Position input for opening a new position
export interface OpenPositionInput {
  size: BN; // Position size in base units
  entryPrice: BN; // Entry price in quote units
  leverage: number; // 1-100
  direction: PositionDirection;
  margin: BN; // Collateral amount
}

// Encrypted position data (as stored on-chain)
export interface EncryptedPosition {
  owner: PublicKey;
  market: PublicKey;
  encryptedData: Uint8Array; // 256 bytes of encrypted position data
  status: PositionStatus;
  openedAt: BN;
  closedAt: BN;
  margin: BN;
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
}

// Margin account state
export interface MarginAccount {
  owner: PublicKey;
  market: PublicKey;
  balance: BN;
  lockedBalance: BN;
  totalDeposited: BN;
  totalWithdrawn: BN;
  positionsOpened: BN;
  positionsClosed: BN;
  totalRealizedPnl: BN;
}

// Close position result (revealed data)
export interface ClosePositionResult {
  realizedPnl: BN;
  settlementAmount: BN;
  fee: BN;
}

// Events
export interface PositionOpenedEvent {
  owner: PublicKey;
  position: PublicKey;
  market: PublicKey;
  margin: BN;
  timestamp: BN;
}

export interface PositionClosedEvent {
  owner: PublicKey;
  position: PublicKey;
  realizedPnl: BN;
  settlementAmount: BN;
  timestamp: BN;
}

export interface PositionLiquidatedEvent {
  owner: PublicKey;
  position: PublicKey;
  liquidationPrice: BN;
  timestamp: BN;
}

// SDK Configuration
export interface ShadowPerpConfig {
  programId: PublicKey;
  arciumProgramId: PublicKey;
  mxeProgramId: PublicKey;
  clusterAddress: PublicKey;
  marketAddress: PublicKey;
  mempoolAccount: PublicKey;
  executingPool: PublicKey;
  poolAccount: PublicKey;
  signPdaAccount: PublicKey;
  idl: any;
}
