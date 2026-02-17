//! Close Position Circuit
//!
//! This circuit calculates the final PnL when a position is closed.
//! THIS IS THE ONLY CIRCUIT THAT REVEALS DATA - the realized PnL.

use arcis::*;

use crate::types::{ClosePositionResult, MarketParams, OpenInterest, Position};

#[encrypted]
mod close_position_circuit {
    use super::*;

    /// Close an existing position and calculate realized PnL
    ///
    /// Privacy: Position details remain encrypted. ONLY the realized PnL
    /// and settlement amount are revealed - this is the core privacy
    /// guarantee of ShadowPerp.
    #[instruction]
    pub fn close_position(
        // The encrypted position data
        position: Enc<Mxe, Position>,
        // Current oracle price for PnL calculation
        exit_price: u64,
        // Market parameters
        market_params: MarketParams,
        // Current open interest state
        oi_state: Enc<Mxe, OpenInterest>,
    ) -> (ClosePositionResult, Enc<Mxe, OpenInterest>) {
        // Decrypt position into secret shares
        let pos = position.to_arcis();
        let mut oi = oi_state.to_arcis();

        // === CALCULATE PNL (in MPC) ===

        // Calculate price delta
        let entry = pos.entry_price as i64;
        let exit = exit_price as i64;
        let price_delta = exit - entry;

        // Calculate raw PnL based on direction
        // Long: profit when price goes up
        // Short: profit when price goes down
        let raw_pnl = if pos.is_long {
            price_delta * (pos.size as i64)
        } else {
            -price_delta * (pos.size as i64)
        };

        // Apply leverage to PnL
        let leveraged_pnl = raw_pnl * (pos.leverage as i64);

        // Normalize PnL (divide by entry price to get actual dollar value)
        let realized_pnl = leveraged_pnl / entry;

        // === CALCULATE FEES ===

        // Trading fee on position value
        let position_value = pos.size * exit_price;
        let fee = (position_value * market_params.trading_fee as u64) / 10000;

        // === CALCULATE SETTLEMENT ===

        // Settlement = margin + pnl - fees
        let margin_i64 = pos.margin as i64;
        let fee_i64 = fee as i64;
        let settlement_i64 = margin_i64 + realized_pnl - fee_i64;

        // Clamp to zero (can't have negative settlement)
        let settlement_amount = if settlement_i64 > 0 {
            settlement_i64 as u64
        } else {
            0
        };

        // === UPDATE OPEN INTEREST ===

        // Reduce OI based on direction
        if pos.is_long {
            oi.total_long = if oi.total_long >= pos.size {
                oi.total_long - pos.size
            } else {
                0
            };
        } else {
            oi.total_short = if oi.total_short >= pos.size {
                oi.total_short - pos.size
            } else {
                0
            };
        }

        // === BUILD RESULT ===
        // NOTE: This result is REVEALED (not re-encrypted)
        // This is intentional - PnL revelation is the designed behavior
        let result = ClosePositionResult {
            realized_pnl,
            settlement_amount,
            fee,
        };

        (result, Mxe.from_arcis(oi))
    }
}
