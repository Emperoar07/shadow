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
    pub fn check_liquidation_v3(
        position: Enc<Shared, (u64, u64, u8, u8, u64)>,
        mark_price: u64,
        liquidation_threshold_bps: u64,
    ) -> (bool, u64, u64) {
        let pos = position.to_arcis();

        let size = pos.0 as u128;
        let entry = pos.1 as u128;
        let is_long = pos.3 != 0u8;
        let margin = pos.4;
        let mark_price_u128 = mark_price as u128;

        let price_above = mark_price_u128 > entry;
        let price_diff = if price_above {
            mark_price_u128 - entry
        } else {
            entry - mark_price_u128
        };
        let pnl_abs_u128 = (size * price_diff) / 1_000_000_000u128;
        let profitable = if is_long { price_above } else { !price_above };

        let margin_u128 = margin as u128;
        let equity_with_profit = margin_u128 + (if profitable { pnl_abs_u128 } else { 0u128 });
        let loss = if !profitable { pnl_abs_u128 } else { 0u128 };
        let equity_net = if loss > margin_u128 {
            0u128
        } else {
            margin_u128 - loss
        };
        let equity = if profitable { equity_with_profit } else { equity_net };

        let notional = size * mark_price_u128;
        let maintenance_u128 =
            (notional * (liquidation_threshold_bps as u128)) / 10_000_000_000_000u128;
        let should_liquidate = equity < maintenance_u128;
        let revealed_margin = if should_liquidate { margin } else { 0 };
        let liquidation_price = if should_liquidate { mark_price } else { 0 };

        (
            should_liquidate.reveal(),
            revealed_margin.reveal(),
            liquidation_price.reveal(),
        )
    }
}
