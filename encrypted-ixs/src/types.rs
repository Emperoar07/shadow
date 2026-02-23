//! Shared type aliases for ShadowPerp circuits.
//!
//! Arcis supports tuples as ArcisType natively, so we use type aliases
//! for readability. These are used across all circuits.

/// Position payload: (size, entry_price, leverage, is_long, margin)
pub type Position = (u64, u64, u8, bool, u64);

/// Open interest payload: (total_long, total_short)
pub type OpenInterest = (u64, u64);

/// Close result plaintext portion: (realized_pnl, settlement_amount, fee, locked_margin)
pub type ClosePositionResult = (i64, u64, u64, u64);

/// Liquidation result: (should_liquidate, revealed_margin_if_liquidated, liquidation_price)
pub type LiquidationResult = (bool, u64, u64);

/// Market params: (max_leverage, liquidation_threshold_bps, trading_fee_bps, oracle_price)
pub type MarketParams = (u8, u16, u16, u64);
