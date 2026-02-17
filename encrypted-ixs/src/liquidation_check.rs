//! Liquidation Check Circuit
//!
//! This circuit checks if a position should be liquidated based on its health factor.
//! CRITICAL: The health factor itself is NEVER revealed - only a boolean decision.
//! This prevents targeted liquidation attacks where adversaries could see
//! exactly how close a position is to liquidation.

use arcis_imports::*;

use crate::types::{LiquidationResult, MarketParams, Position};

#[encrypted]
mod liquidation_check_circuit {
    use super::*;

    /// Check if a position should be liquidated
    ///
    /// Privacy: The health factor and all position details remain encrypted.
    /// ONLY the boolean liquidation decision is revealed.
    ///
    /// This is critical for preventing:
    /// - Targeted liquidation hunting
    /// - Position size inference from liquidation proximity
    /// - Copy-trading based on health factor monitoring
    #[instruction]
    pub fn check_liquidation(
        // The encrypted position data
        position: Enc<Mxe, Position>,
        // Current mark price from oracle
        mark_price: u64,
        // Market parameters including liquidation threshold
        market_params: MarketParams,
    ) -> LiquidationResult {
        // Decrypt position into secret shares
        let pos = position.to_arcis();

        // === CALCULATE UNREALIZED PNL (in MPC) ===

        let entry = pos.1 as i64;
        let mark = mark_price as i64;
        let price_delta = mark - entry;

        // Calculate unrealized PnL based on direction
        let unrealized_pnl = if pos.3 {
            price_delta * (pos.0 as i64)
        } else {
            -price_delta * (pos.0 as i64)
        };

        // Apply leverage
        let leveraged_pnl = unrealized_pnl * (pos.2 as i64);

        // Normalize
        let pnl = leveraged_pnl / entry;

        // === CALCULATE HEALTH FACTOR (in MPC) ===

        // Equity = margin + unrealized PnL
        let margin_i64 = pos.4 as i64;
        let equity = margin_i64 + pnl;

        // Position value at current price
        let position_value = pos.0 * mark_price;

        // Maintenance margin = position_value * threshold / 10000
        let maintenance_margin =
            (position_value * market_params.1 as u64) / 10000;

        // === LIQUIDATION DECISION (in MPC) ===

        // Position should be liquidated if equity < maintenance margin
        // Note: We compare equity (which can be negative) with maintenance margin
        let should_liquidate = equity < (maintenance_margin as i64);

        // Calculate liquidation price (for logging purposes only)
        // This is revealed only if liquidation occurs
        let liquidation_price = if should_liquidate { mark_price } else { 0 };

        // === BUILD RESULT ===
        // NOTE: Only should_liquidate boolean is meaningful
        // The health factor (equity / maintenance_margin) is NEVER revealed
        (should_liquidate, liquidation_price)
    }

    /// Batch check liquidations for multiple positions
    /// More efficient for liquidation bots scanning many positions
    #[instruction]
    pub fn batch_check_liquidations(
        positions: Vec<Enc<Mxe, Position>>,
        mark_price: u64,
        market_params: MarketParams,
    ) -> Vec<LiquidationResult> {
        positions
            .into_iter()
            .map(|pos: Enc<Mxe, Position>| {
                let p = pos.to_arcis();

                let entry = p.1 as i64;
                let mark = mark_price as i64;
                let price_delta = mark - entry;

                let unrealized_pnl = if p.3 {
                    price_delta * (p.0 as i64) * (p.2 as i64) / entry
                } else {
                    -price_delta * (p.0 as i64) * (p.2 as i64) / entry
                };

                let equity = (p.4 as i64) + unrealized_pnl;
                let position_value = p.0 * mark_price;
                let maintenance_margin =
                    (position_value * market_params.1 as u64) / 10000;

                let should_liquidate = equity < (maintenance_margin as i64);

                (should_liquidate, if should_liquidate { mark_price } else { 0 })
            })
            .collect()
    }
}
