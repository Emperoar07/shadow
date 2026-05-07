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

        // pos = (size_scaled, entry_price, _, direction_flag, margin)
        // All prices use 6-decimal precision (scaled by 10^6).
        // Each operand pre-divided by 1000 keeps the product within u64 while
        // preserving 3-decimal precision on each side, so the combined / 10^6 is exact.
        let size = pos.0;
        let entry = pos.1;
        let is_long = pos.3 != 0u8;
        let margin = pos.4;

        // PnL direction: long profits if mark > entry
        let price_above = mark_price > entry;
        let price_diff = if price_above { mark_price - entry } else { entry - mark_price };
        // pnl_abs = size * price_diff / 10^6 â€” pre-divide each by 1000 to avoid u64 overflow.
        let pnl_abs = (size / 1000) * (price_diff / 1000);
        let profitable = if is_long { price_above } else { !price_above };

        // equity = margin Â± pnl
        let equity_with_profit = margin + (if profitable { pnl_abs } else { 0u64 });
        let loss = if !profitable { pnl_abs } else { 0u64 };
        let underwater = loss > margin;
        let equity_net = if underwater { 0u64 } else { margin - loss };
        let equity = if profitable { equity_with_profit } else { equity_net };

        // notional = size * mark_price / 10^6 â€” same pre-division pattern.
        let notional = (size / 1000) * (mark_price / 1000);
        // maintenance = notional * threshold_bps / 10000 â€” exact division, no rebasing.
        let maintenance = notional * liquidation_threshold_bps / 10000;

        let should_liquidate = equity < maintenance;
        let revealed_margin = if should_liquidate { margin } else { 0 };
        let liquidation_price = if should_liquidate { mark_price } else { 0 };

        (
            should_liquidate.reveal(),
            revealed_margin.reveal(),
            liquidation_price.reveal(),
        )
    }
}
