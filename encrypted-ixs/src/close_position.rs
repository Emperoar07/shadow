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
    pub fn close_position_v2(
        position: Enc<Shared, (u64, u64, u8, u8, u64)>,
        exit_price: u64,
        trading_fee_bps: u16,
    ) -> (i64, u64, u64, u64) {
        let pos = position.to_arcis();

        let entry = pos.1 as i64;
        let price_delta = exit_price as i64 - entry;
        let direction: i64 = if pos.3 != 0 { 1 } else { -1 };
        // Size is stored in base units scaled to 1e9. Prices and margins are
        // stored in quote-token units scaled to 1e6.
        const BASE_SCALE: i128 = 1_000_000_000;

        let pnl_num = (price_delta as i128)
            .wrapping_mul(pos.0 as i128)
            .wrapping_mul(direction as i128);
        let realized_pnl = (pnl_num / BASE_SCALE) as i64;

        let position_value = (pos.0 as u128)
            .wrapping_mul(exit_price as u128)
            / BASE_SCALE as u128;
        let fee = ((position_value * trading_fee_bps as u128) / 10000) as u64;

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
