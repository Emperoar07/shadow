//! Open Position Circuit
//!
//! This circuit validates and processes new position opening requests.
//! All validation happens on encrypted data inside MPC.

use arcis_imports::*;

#[encrypted]
mod open_position_circuit {
    use arcis_imports::*;

    /// Open a new position with encrypted parameters.
    /// All five user-encrypted values (size, entry_price, leverage, is_long, margin) are
    /// batched into one Enc<Shared, (...)> to reduce the parameter count from 23 → 15,
    /// keeping the computation account within Arcium's on-chain space budget.
    #[instruction]
    pub fn open_position(
        inputs: Enc<Shared, (u64, u64, u8, bool, u64)>,
        requested_margin: u64,
        market_params: (u8, u16, u16, u64),
        oi_state: Enc<Mxe, (u64, u64)>,
    ) -> (bool, Enc<Mxe, (u64, u64)>) {
        let (size, entry_price, leverage, is_long, margin) = inputs.to_arcis();
        let mut oi = oi_state.to_arcis();

        // Validate leverage is within bounds
        let leverage_valid = leverage >= 1 && leverage <= market_params.0;

        // Calculate position value and required margin
        let position_value = size * entry_price;
        let required_margin = position_value / (leverage as u64);

        // Validate margin is sufficient
        let margin_valid = margin >= required_margin;
        let margin_matches = margin == requested_margin;

        // Validate size is non-zero
        let size_valid = size > 0;

        let success = leverage_valid && margin_valid && margin_matches && size_valid;

        // Update open interest based on direction
        if is_long {
            oi.0 = oi.0 + size;
        } else {
            oi.1 = oi.1 + size;
        }

        (success.reveal(), oi_state.owner.from_arcis(oi))
    }
}
