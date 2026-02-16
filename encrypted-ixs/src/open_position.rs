//! Open Position Circuit
//!
//! This circuit validates and processes new position opening requests.
//! All validation happens on encrypted data inside MPC.

use arcis::prelude::*;

use crate::types::{MarketParams, OpenInterest, Position};

#[encrypted]
mod open_position_circuit {
    use super::*;

    /// Open a new position with encrypted parameters
    ///
    /// Privacy: All inputs remain encrypted. Only the success/failure
    /// and required margin are communicated back (margin is public anyway
    /// since it's locked on-chain).
    #[instruction]
    pub fn open_position(
        // Encrypted inputs from the user
        size: Enc<Shared, u64>,
        entry_price: Enc<Shared, u64>,
        leverage: Enc<Shared, u8>,
        is_long: Enc<Shared, bool>,
        margin: Enc<Shared, u64>,
        owner_lo: Enc<Shared, u128>,
        owner_hi: Enc<Shared, u128>,
        // Market parameters (can be public)
        market_params: MarketParams,
        // Current open interest state (encrypted)
        oi_state: Enc<Mxe, OpenInterest>,
    ) -> (bool, Enc<Mxe, Position>, u64, Enc<Mxe, OpenInterest>) {
        // Decrypt inputs into secret-shared values (still not visible to any single node)
        let size = size.to_arcis();
        let entry_price = entry_price.to_arcis();
        let leverage = leverage.to_arcis();
        let is_long = is_long.to_arcis();
        let margin = margin.to_arcis();
        let owner_lo = owner_lo.to_arcis();
        let owner_hi = owner_hi.to_arcis();
        let mut oi = oi_state.to_arcis();

        // === VALIDATION (all in MPC) ===

        // 1. Validate leverage is within bounds
        let leverage_valid = leverage >= 1 && leverage <= market_params.max_leverage;

        // 2. Calculate position value and required margin
        let position_value = size * entry_price;
        let required_margin = position_value / (leverage as u64);

        // 3. Validate margin is sufficient
        let margin_valid = margin >= required_margin;

        // 4. Validate size is non-zero
        let size_valid = size > 0;

        // All validations must pass
        let success = leverage_valid && margin_valid && size_valid;

        // === UPDATE STATE (all in MPC) ===

        // Update open interest based on direction
        // Note: This happens even if validation fails - the circuit
        // must have deterministic control flow
        if is_long {
            oi.total_long = oi.total_long + size;
        } else {
            oi.total_short = oi.total_short + size;
        }

        // Build position struct
        let position = Position {
            size,
            entry_price,
            leverage,
            is_long,
            margin,
            owner_lo,
            owner_hi,
        };

        // Return the validation bit and required margin in plaintext,
        // while keeping the full position payload encrypted.
        (success, Mxe.from_arcis(position), required_margin, Mxe.from_arcis(oi))
    }
}
