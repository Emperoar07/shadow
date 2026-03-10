//! Seed Open Interest State Circuit
//!
//! Bootstraps a valid MXE-owned encrypted zero open-interest state for a new market.

use arcis_imports::*;

#[encrypted]
mod seed_open_interest_state_circuit {
    use arcis_imports::*;

    #[instruction]
    pub fn seed_open_interest_state_v3(dummy: u8) -> (bool, Enc<Mxe, (u64, u64)>) {
        // Build a secret-shared zero from MPC randomness instead of encrypting a public constant.
        // The previous bootstrap variants aborted before callback verification on Arcium.
        let random = ArcisRNG::gen_uniform::<u64>();
        let mask = random + (dummy as u64);
        let zero = mask - mask;
        let zero_oi = (zero, zero);
        let encrypted_zero_oi = Mxe::get().from_arcis(zero_oi);
        (true, encrypted_zero_oi)
    }
}
