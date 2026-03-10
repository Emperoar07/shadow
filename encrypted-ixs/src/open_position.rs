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
    /// batched into one Enc<Shared, (...)> to reduce parameter pressure on the Arcium
    /// computation account.
    ///
    #[instruction]
    pub fn open_position_probe_b(
        inputs: Enc<Shared, (u64, u64, u8, bool, u64)>,
        requested_margin: u64,
        max_leverage: u8,
    ) -> bool {
        let (size, _entry_price, leverage, _is_long, margin) = inputs.to_arcis();

        let size_ok = size > 0u64;
        let margin_ok = margin > 0u64;
        let requested_margin_ok = margin == requested_margin;
        let leverage_min_ok = leverage >= 1u8;
        let leverage_max_ok = leverage <= max_leverage;

        (size_ok && margin_ok && requested_margin_ok && leverage_min_ok && leverage_max_ok).reveal()
    }
}
