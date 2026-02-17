//! Close Position Circuit
//!
//! This circuit calculates the final PnL when a position is closed.
//! THIS IS THE ONLY CIRCUIT THAT REVEALS DATA - the realized PnL.

use arcis_imports::*;

#[encrypted]
mod close_position_circuit {
    use arcis_imports::*;

    /// Close an existing position and calculate realized PnL
    ///
    /// Privacy: Position details remain encrypted. ONLY the realized PnL
    /// and settlement amount are revealed.
    #[instruction]
    pub fn close_position(
        position: Enc<Mxe, (u64, u64, u8, bool, u64, u128, u128)>,
        exit_price: u64,
        market_params: (u8, u16, u16, u64),
        oi_state: Enc<Mxe, (u64, u64)>,
    ) -> ((i64, u64, u64), Enc<Mxe, (u64, u64)>) {
        let pos = position.to_arcis();
        let mut oi = oi_state.to_arcis();

        // Calculate price delta
        let entry = pos.1 as i64;
        let exit = exit_price as i64;
        let price_delta = exit - entry;

        // Calculate raw PnL based on direction
        let raw_pnl = if pos.3 {
            price_delta * (pos.0 as i64)
        } else {
            -price_delta * (pos.0 as i64)
        };

        // Apply leverage to PnL
        let leveraged_pnl = raw_pnl * (pos.2 as i64);

        // Normalize PnL (divide by entry price to get actual dollar value)
        let realized_pnl = leveraged_pnl / entry;

        // Trading fee on position value
        let position_value = pos.0 * exit_price;
        let fee = (position_value * market_params.2 as u64) / 10000;

        // Settlement = margin + pnl - fees
        let margin_i64 = pos.4 as i64;
        let fee_i64 = fee as i64;
        let settlement_i64 = margin_i64 + realized_pnl - fee_i64;

        // Clamp to zero (can't have negative settlement)
        let settlement_amount = if settlement_i64 > 0 {
            settlement_i64 as u64
        } else {
            0
        };

        // Reduce OI based on direction
        if pos.3 {
            oi.0 = if oi.0 >= pos.0 {
                oi.0 - pos.0
            } else {
                0
            };
        } else {
            oi.1 = if oi.1 >= pos.0 {
                oi.1 - pos.0
            } else {
                0
            };
        }

        // NOTE: ClosePositionResult is REVEALED (not re-encrypted)
        let result = (realized_pnl, settlement_amount, fee);

        (result, Mxe.from_arcis(oi))
    }
}
