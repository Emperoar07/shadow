//! Close Position Circuit
//!
//! This circuit calculates the final PnL when a position is closed.
//! THIS IS THE ONLY CIRCUIT THAT REVEALS DATA - the realized PnL.

use arcis::*;

#[encrypted]
mod close_position_circuit {
    use arcis::*;

    /// Close an existing position and calculate realized PnL
    ///
    /// Privacy: Position details remain encrypted while open.
    /// At settlement we reveal:
    /// - realized PnL
    /// - settlement amount
    /// - fee
    /// - locked_margin
    ///
    /// locked_margin is revealed only during close settlement so active
    /// positions do not need a plaintext margin slot on-chain.
    #[instruction]
    pub fn close_position_v3(
        position: Enc<Shared, (u64, u64, u8, u8, u64)>,
        exit_price: u64,
        trading_fee_bps: u64,
    ) -> (i64, u64, u64, u64) {
        let pos = position.to_arcis();

        let entry = pos.1 as i64;
        let price_delta = exit_price as i64 - entry;
        let direction: i64 = if pos.3 != 0 { 1 } else { -1 };

        // Stay in i64/u64 throughout — no u128/i128 intermediates.
        // Pre-divide size by 1e3 and price by 1e6 before multiplying so the
        // product (size * price / 1e9) stays within u64/i64 range.
        // Equivalent to the original BASE_SCALE=1e9 division but cast-free.
        let size_reduced = (pos.0 / 1_000) as i64;
        let realized_pnl = size_reduced * (price_delta / 1_000_000) * direction;

        // Fee: position_value = size/1e3 * exit_price/1e6 (= size*price/1e9)
        let position_value: u64 = (pos.0 / 1_000) * (exit_price / 1_000_000);
        let fee: u64 = position_value * trading_fee_bps / 10_000;

        // Settlement = margin + pnl - fees (clamped to 0)
        let margin_i64 = pos.4 as i64;
        let fee_i64 = fee as i64;
        let settlement_i64 = margin_i64.wrapping_add(realized_pnl).wrapping_sub(fee_i64);
        let settlement_amount = if settlement_i64 > 0 {
            settlement_i64 as u64
        } else {
            0u64
        };

        (
            realized_pnl.reveal(),
            settlement_amount.reveal(),
            fee.reveal(),
            pos.4.reveal(),
        )
    }
}
