//! Liquidation Check Circuit
//!
//! This circuit checks if a position should be liquidated based on its health factor.
//! CRITICAL: The health factor itself is NEVER revealed - only a boolean decision.

use arcis_imports::*;

#[encrypted]
mod liquidation_check_circuit {
    use arcis_imports::*;

    /// Check if a position should be liquidated
    ///
    /// Privacy: The health factor and all position details remain encrypted.
    /// We reveal:
    /// - boolean liquidation decision
    /// - locked margin only if liquidation is true (0 otherwise)
    /// - current mark/liquidation price marker
    #[instruction]
    pub fn check_liquidation(
        position: Enc<Mxe, (u64, u64, u8, bool, u64, u128, u128)>,
        mark_price: u64,
        market_params: (u8, u16, u16, u64),
    ) -> (bool, u64, u64) {
        let pos = position.to_arcis();

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

        // Equity = margin + unrealized PnL
        let margin_i64 = pos.4 as i64;
        let equity = margin_i64 + pnl;

        // Position value at current price
        let position_value = pos.0 * mark_price;

        // Maintenance margin = position_value * threshold / 10000
        let maintenance_margin = (position_value * market_params.1 as u64) / 10000;

        // Position should be liquidated if equity < maintenance margin
        let should_liquidate = equity < (maintenance_margin as i64);

        let revealed_margin = if should_liquidate { pos.4 } else { 0 };
        let liquidation_price = if should_liquidate { mark_price } else { 0 };

        (
            should_liquidate.reveal(),
            revealed_margin.reveal(),
            liquidation_price.reveal(),
        )
    }
}
