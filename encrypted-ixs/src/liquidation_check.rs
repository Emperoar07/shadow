//! Liquidation Check Circuit
//!
//! This circuit checks if a position should be liquidated based on its health factor.
//! CRITICAL: The health factor itself is NEVER revealed - only a boolean decision.

use arcis::*;

#[encrypted]
mod liquidation_check_circuit {
    use arcis::*;

    /// Check if a position should be liquidated
    ///
    /// Privacy: The health factor and all position details remain encrypted.
    /// We reveal:
    /// - boolean liquidation decision
    /// - locked margin only if liquidation is true (0 otherwise)
    /// - current mark/liquidation price marker
    #[instruction]
    pub fn check_liquidation_v5(
        position: Enc<Shared, (u64, u64, u8, u8, u64)>,
        mark_price: u64,
        liquidation_threshold_bps: u64,
    ) -> (bool, u64, u64) {
        let pos = position.to_arcis();

        let size = pos.0 as u128;
        let entry = pos.1 as i128;
        let mark_price_i128 = mark_price as i128;
        let price_delta = mark_price_i128 - entry;
        let direction: i128 = if pos.3 != 0 { 1 } else { -1 };

        // size is stored at 1e9 precision and prices at 1e6 precision.
        // Multiplying in 128-bit space preserves the full 1e6-scaled PnL.
        let realized_pnl_i128 =
            (size as i128 * price_delta * direction) / 1_000_000_000i128;

        let margin_i128 = pos.4 as i128;
        let equity_i128 = margin_i128 + realized_pnl_i128;
        let equity = if equity_i128 <= 0 {
            0u128
        } else {
            equity_i128 as u128
        };

        let notional = size * (mark_price as u128);
        let maintenance_u128 =
            (notional * (liquidation_threshold_bps as u128)) / 10_000_000_000_000u128;
        let should_liquidate = equity < maintenance_u128;
        let revealed_margin = if should_liquidate { pos.4 } else { 0 };
        let liquidation_price = if should_liquidate { mark_price } else { 0 };

        (
            should_liquidate.reveal(),
            revealed_margin.reveal(),
            liquidation_price.reveal(),
        )
    }
}
