//! Settle Private Position Circuit

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
    ///   - remaining_balance_and_secret: (remaining balance, commitment secret) encrypted
    ///
    /// Returns:
    ///   - realized_pnl: net PnL for the position (10^6 scale)
    ///   - settlement_amount: tokens to credit back to shielded balance (10^6 scale)
    ///   - fee: trading fee deducted (10^6 scale)
    ///   - new_commitment_lo: additive binding commitment hiding the new shielded balance
    #[instruction]
    pub fn settle_private_position(
        position: Enc<Shared, (u64, u64, u8, u8, u64)>,
        exit_price: u64,
        trading_fee_bps: u64,
        remaining_balance_and_secret: Enc<Shared, (u64, u64)>,
    ) -> (i64, u64, u64, u64) {
        let pos = position.to_arcis();
        let (rem_balance, commitment_secret) = remaining_balance_and_secret.to_arcis();

        let size = pos.0 as u128;
        let entry = pos.1 as i128;
        let exit_price_i128 = exit_price as i128;
        let price_delta = exit_price_i128 - entry;
        let direction: i128 = if pos.3 != 0 { 1 } else { -1 };

        // PnL in 10^6 scale: size (10^9) * price_delta (10^6) -> 10^15 / 10^9 -> 10^6
        let realized_pnl_i128 = (size as i128 * price_delta * direction) / 1_000_000_000i128;
        let realized_pnl = realized_pnl_i128 as i64;

        // Position value: size (10^9) * exit_price (10^6) = 10^15
        let position_value = size * (exit_price as u128);

        // Fee: (position_value * bps) / (10_000 * 10^9) -> 10^6 scale
        let fee_u128 = (position_value * (trading_fee_bps as u128)) / 10_000_000_000_000u128;
        let fee = fee_u128 as u64;

        // Settlement = margin + pnl - fees
        let margin_i64 = pos.4 as i64;
        let fee_i64 = fee as i64;
        let settlement_i64 = margin_i64.wrapping_add(realized_pnl).wrapping_sub(fee_i64);

        let settlement_amount = if settlement_i64 > 0 {
            settlement_i64 as u64
        } else {
            0
        };

        // New shielded balance = remaining + settlement
        let new_balance = rem_balance + settlement_amount;

        // PRIVACY: Additive binding — return new_balance + secret as plaintext u64.
        // This hides the actual shielded balance on-chain.
        let new_commitment_lo = new_balance.wrapping_add(commitment_secret);

        (
            realized_pnl.reveal(),
            settlement_amount.reveal(),
            fee.reveal(),
            new_commitment_lo.reveal(),
        )
    }
}
