//! Shared types for ShadowPerp circuits

use arcis::*;

/// Position data structure - all fields are encrypted in MPC
#[derive(ArcisType, Clone)]
pub struct Position {
    /// Position size in base units (e.g., 1 SOL = 1_000_000_000)
    pub size: u64,

    /// Entry price in quote units (e.g., $100 = 100_000_000)
    pub entry_price: u64,

    /// Leverage multiplier (1-100)
    pub leverage: u8,

    /// True = long, False = short
    pub is_long: bool,

    /// Margin deposited for this position
    pub margin: u64,

    /// Owner pubkey lower 128 bits
    pub owner_lo: u128,

    /// Owner pubkey upper 128 bits
    pub owner_hi: u128,
}

/// Result of opening a position
#[derive(ArcisType, Clone)]
pub struct OpenPositionResult {
    /// Whether the position was successfully opened
    pub success: bool,

    /// The validated position data (encrypted)
    pub position: Position,

    /// Required margin that was validated
    pub required_margin: u64,
}

/// Result of closing a position
#[derive(ArcisType, Clone)]
pub struct ClosePositionResult {
    /// Realized profit/loss (THIS IS REVEALED)
    pub realized_pnl: i64,

    /// Settlement amount to return to user
    pub settlement_amount: u64,

    /// Trading fee collected
    pub fee: u64,
}

/// Result of liquidation check
#[derive(ArcisType, Clone)]
pub struct LiquidationResult {
    /// Whether position should be liquidated
    /// Note: This is the ONLY thing revealed - not the health factor itself
    pub should_liquidate: bool,

    /// Liquidation price (only meaningful if should_liquidate is true)
    pub liquidation_price: u64,
}

/// Market parameters passed to circuits
#[derive(ArcisType, Clone)]
pub struct MarketParams {
    /// Maximum allowed leverage
    pub max_leverage: u8,

    /// Liquidation threshold in basis points
    pub liquidation_threshold: u16,

    /// Trading fee in basis points
    pub trading_fee: u16,

    /// Current oracle price
    pub oracle_price: u64,
}

/// Encrypted state accumulator for open interest tracking
#[derive(ArcisType, Clone, Default)]
pub struct OpenInterest {
    /// Total long open interest (encrypted)
    pub total_long: u64,

    /// Total short open interest (encrypted)
    pub total_short: u64,
}
