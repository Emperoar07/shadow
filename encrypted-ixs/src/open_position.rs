//! Open Position Circuit
//!
//! This circuit validates and processes new position opening requests.
//! All validation happens on encrypted data inside MPC.

use arcis_imports::*;

#[encrypted]
mod open_position_circuit {
    use arcis_imports::*;

    /// Open a new position with encrypted parameters
    #[instruction]
    pub fn open_position(
        size: Enc<Shared, u64>,
        entry_price: Enc<Shared, u64>,
        leverage: Enc<Shared, u8>,
        is_long: Enc<Shared, bool>,
        margin: Enc<Shared, u64>,
        owner_lo: Enc<Shared, u128>,
        owner_hi: Enc<Shared, u128>,
        market_params: (u8, u16, u16, u64),
        oi_state: Enc<Mxe, (u64, u64)>,
    ) -> (
        bool,
        Enc<Mxe, ((u64, u64, u8, bool, u64, u128, u128), (u64, u64))>,
        u64,
    ) {
        let size = size.to_arcis();
        let entry_price = entry_price.to_arcis();
        let leverage = leverage.to_arcis();
        let is_long = is_long.to_arcis();
        let margin = margin.to_arcis();
        let owner_lo = owner_lo.to_arcis();
        let owner_hi = owner_hi.to_arcis();
        let mut oi = oi_state.to_arcis();

        // Validate leverage is within bounds
        let leverage_valid = leverage >= 1 && leverage <= market_params.0;

        // Calculate position value and required margin
        let position_value = size * entry_price;
        let required_margin = position_value / (leverage as u64);

        // Validate margin is sufficient
        let margin_valid = margin >= required_margin;

        // Validate size is non-zero
        let size_valid = size > 0;

        let success = leverage_valid && margin_valid && size_valid;

        // Update open interest based on direction
        if is_long {
            oi.0 = oi.0 + size;
        } else {
            oi.1 = oi.1 + size;
        }

        let position = (size, entry_price, leverage, is_long, margin, owner_lo, owner_hi);
        let combined = (position, oi);

        (
            success.reveal(),
            oi_state.owner.from_arcis(combined),
            required_margin.reveal(),
        )
    }
}
