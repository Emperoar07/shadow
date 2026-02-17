//! Shared Arcis-compatible tuple types for ShadowPerp circuits.
//!
//! Arcis 0.3 supports tuple ArcisType out of the box. We use tuples here so
//! encrypted payloads compile without custom trait derives.

/// Position payload: (size, entry_price, leverage, is_long, margin, owner_lo, owner_hi)
pub type Position = (u64, u64, u8, bool, u64, u128, u128);

/// Open interest payload: (total_long, total_short)
pub type OpenInterest = (u64, u64);

/// Close result: (realized_pnl, settlement_amount, fee)
pub type ClosePositionResult = (i64, u64, u64);

/// Liquidation result: (should_liquidate, liquidation_price)
pub type LiquidationResult = (bool, u64);

/// Market params: (max_leverage, liquidation_threshold_bps, trading_fee_bps, oracle_price)
pub type MarketParams = (u8, u16, u16, u64);
