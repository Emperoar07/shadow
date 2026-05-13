//! Lock Margin Private Circuit

use arcis::*;

#[encrypted]
mod lock_margin_private_circuit {
    use arcis::*;

    /// Lock margin from a shielded commitment for opening a position.
    ///
    /// Inputs:
    ///   - balance: the user's current shielded balance (encrypted)
    ///   - lock_amount: how much margin to lock (encrypted)
    ///   - commitment_secret: the user's commitment preimage secret (encrypted)
    ///   - requested_margin: plaintext margin amount (for on-chain verification)
    ///
    /// Returns:
    ///   - valid: whether the lock is valid (balance >= lock_amount, amounts match)
    ///   - new_commitment_lo: additive binding commitment (balance + secret) hiding the actual balance
    ///   - locked_margin: the amount actually locked (revealed for position binding)
    #[instruction]
    pub fn lock_margin_private(
        balance_and_lock: Enc<Shared, (u64, u64, u64)>,
        requested_margin: u64,
    ) -> (bool, u64, u64) {
        let (balance, lock_amount, commitment_secret) = balance_and_lock.to_arcis();

        // Validate lock amount matches the on-chain requested margin
        let amounts_match = lock_amount == requested_margin;

        // Validate sufficient balance
        let sufficient = balance >= lock_amount;

        let valid = amounts_match && sufficient;

        // Compute remaining balance (clamped to 0 if invalid)
        let new_balance = if valid { balance - lock_amount } else { 0 };

        let locked = if valid { lock_amount } else { 0 };

        // PRIVACY: Additive binding — return new_balance + secret as plaintext u64.
        // This perfectly hides the actual balance on-chain while enabling verification:
        // commitment = balance + secret (mod 2^64)
        // On-chain, only the commitment is stored; the balance remains cryptographically bound.
        let new_commitment_lo = new_balance.wrapping_add(commitment_secret);

        (valid.reveal(), new_commitment_lo.reveal(), locked.reveal())
    }
}
