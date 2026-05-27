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
    pub fn close_position_v5(
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
        let realized_pnl = if realized_pnl_i128 > 9_223_372_036_854_775_807i128 {
            9_223_372_036_854_775_807i64
        } else if realized_pnl_i128 < -9_223_372_036_854_775_808i128 {
            -9_223_372_036_854_775_808i64
        } else {
            realized_pnl_i128 as i64
        };

        let position_value = size * (exit_price as u128);
        let fee_u128 =
            (position_value * (trading_fee_bps as u128)) / 10_000_000_000_000u128;
        let fee = if fee_u128 > 18_446_744_073_709_551_615u128 {
            18_446_744_073_709_551_615u64
        } else {
            fee_u128 as u64
        };

        // Settlement = margin + pnl - fees (clamped to 0)
        let settlement_i128 = (pos.4 as i128) + realized_pnl_i128 - (fee as i128);
        let settlement_amount = if settlement_i128 <= 0 {
            0u64
        } else if settlement_i128 > 18_446_744_073_709_551_615i128 {
            18_446_744_073_709_551_615u64
        } else {
            settlement_i128 as u64
        };

        (
            realized_pnl.reveal(),
            settlement_amount.reveal(),
            fee.reveal(),
            pos.4.reveal(),
        )
    }
}
