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
        position: Enc<Shared, (u64, u64, u8, u8, u64)>,
        mark_price: u64,
        liquidation_threshold_bps: u16,
    ) -> (bool, u64, u64) {
        let pos = position.to_arcis();

        let entry = pos.1 as i64;
        let price_delta = mark_price as i64 - entry;
        let direction: i64 = if pos.3 != 0 { 1 } else { -1 };
        const BASE_SCALE: i128 = 1_000_000_000;

        let pnl_num = (price_delta as i128)
            .wrapping_mul(pos.0 as i128)
            .wrapping_mul(direction as i128);
        let unrealized_pnl = (pnl_num / BASE_SCALE) as i64;

        let equity = (pos.4 as i64).saturating_add(unrealized_pnl);

        let maintenance_u128 = ((pos.0 as u128)
            .wrapping_mul(mark_price as u128)
            / BASE_SCALE as u128)
            .wrapping_mul(liquidation_threshold_bps as u128)
            / 10000;
        let maintenance_margin = if maintenance_u128 > i64::MAX as u128 {
            i64::MAX
        } else {
            maintenance_u128 as i64
        };

        let should_liquidate = equity < maintenance_margin;

        let revealed_margin = if should_liquidate { pos.4 } else { 0 };
        let liquidation_price = if should_liquidate { mark_price } else { 0 };

        (
            should_liquidate.reveal(),
            revealed_margin.reveal(),
            liquidation_price.reveal(),
        )
    }
}
