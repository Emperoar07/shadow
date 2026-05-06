//! Settle Private Position Circuit
//!
//! Applies PnL, fees, and funding to a shielded position settlement.
//! The circuit computes the net settlement amount and new shielded balance
//! after closing a position through the private collateral path.
//!
//! Privacy: Position details remain encrypted. Only the settlement outputs
//! needed for on-chain state updates are revealed.

use arcis::*;

#[encrypted]
mod settle_private_position_circuit {
    use arcis::*;

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
        trading_fee_bps: u64,
        remaining_balance: Enc<Shared, u64>,
    ) -> (i64, u64, u64, u64) {
        let pos = position.to_arcis();
        let rem_balance = remaining_balance.to_arcis();

        let entry = pos.1 as i64;
        let price_delta = exit_price as i64 - entry;
        let direction: i64 = if pos.3 != 0 { 1 } else { -1 };

        // Stay in i64/u64 throughout — no u128/i128 intermediates.
        // Pre-divide size by 1e3 and price by 1e6 before multiplying so the
        // product (size * price / 1e9) stays within u64/i64 range.
        let size_reduced = (pos.0 / 1_000) as i64;
        let realized_pnl = size_reduced * (price_delta / 1_000_000) * direction;

        // Fee: position_value = size/1e3 * exit_price/1e6 (= size*price/1e9)
        let position_value: u64 = (pos.0 / 1_000) * (exit_price / 1_000_000);
        let fee: u64 = position_value * trading_fee_bps / 10_000;

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
        let new_balance = rem_balance + settlement_amount;

        (
            realized_pnl.reveal(),
            settlement_amount.reveal(),
            fee.reveal(),
            new_balance.reveal(),
        )
    }
}
