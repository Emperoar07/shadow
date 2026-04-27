//! Settle Private Position Circuit
//!
//! Applies PnL, fees, and funding to a shielded position settlement.
//! The circuit computes the net settlement amount and new shielded balance
//! after closing a position through the private collateral path.
//!
//! Privacy: Position details remain encrypted. Only the settlement outputs
//! needed for on-chain state updates are revealed.

use arcis_imports::*;

#[encrypted]
mod settle_private_position_circuit {
    use arcis_imports::*;

    /// Settle a closed position against the shielded collateral pool.
    ///
    /// Inputs:
    ///   - position: (size, entry_price, leverage, is_long, locked_margin) encrypted
    ///   - exit_price: plaintext current price
    ///   - trading_fee_bps: plaintext fee rate
    ///   - remaining_balance: user's remaining shielded balance (encrypted)
    ///
    /// Returns:
    ///   - realized_pnl: net PnL for the position
    ///   - settlement_amount: tokens to credit back to shielded balance
    ///   - fee: trading fee deducted
    ///   - new_balance: updated shielded balance after settlement
    #[instruction]
    pub fn settle_private_position(
        position: Enc<Shared, (u64, u64, u8, u8, u64)>,
        exit_price: u64,
        trading_fee_bps: u16,
        remaining_balance: Enc<Shared, u64>,
    ) -> (i64, u64, u64, u64) {
        let pos = position.to_arcis();
        let rem_balance = remaining_balance.to_arcis();

        let entry = pos.1 as i64;
        let price_delta = exit_price as i64 - entry;
        let direction: i64 = if pos.3 != 0 { 1 } else { -1 };
        const BASE_SCALE: i128 = 1_000_000_000;

        let pnl_num = (price_delta as i128)
            .wrapping_mul(pos.0 as i128)
            .wrapping_mul(direction as i128);
        let realized_pnl = (pnl_num / BASE_SCALE) as i64;

        let position_value = (pos.0 as u128)
            .wrapping_mul(exit_price as u128)
            / BASE_SCALE as u128;
        let fee = ((position_value * trading_fee_bps as u128) / 10000) as u64;

        // Settlement = margin + pnl - fees
        let margin_i64 = pos.4 as i64;
        let fee_i64 = fee as i64;
        let settlement_i64 = margin_i64.wrapping_add(realized_pnl).wrapping_sub(fee_i64);

        // Clamp to zero (can't have negative settlement)
        let settlement_amount = if settlement_i64 > 0 {
            settlement_i64 as u64
        } else {
            0
        };

        // New shielded balance = remaining + settlement
        let new_balance = rem_balance.saturating_add(settlement_amount);

        (
            realized_pnl.reveal(),
            settlement_amount.reveal(),
            fee.reveal(),
            new_balance.reveal(),
        )
    }
}
