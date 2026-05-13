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

        let size = pos.0 as u128;
        let entry = pos.1 as i128;
        let exit_price_i128 = exit_price as i128;
        let price_delta = exit_price_i128 - entry;
        let direction: i128 = if pos.3 != 0 { 1 } else { -1 };

        // size is stored at 1e9 precision and prices at 1e6 precision.
        // Multiplying in 128-bit space preserves the full 1e6-scaled pnl.
        let realized_pnl_i128 =
            (size as i128 * price_delta * direction) / 1_000_000_000i128;
        let realized_pnl = realized_pnl_i128 as i64;

        let position_value = size * (exit_price as u128);
        let fee_u128 =
            (position_value * (trading_fee_bps as u128)) / 10_000_000_000_000u128;
        let fee = fee_u128 as u64;

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
