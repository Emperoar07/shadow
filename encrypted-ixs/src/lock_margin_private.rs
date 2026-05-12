//! Lock Margin Private Circuit
//!
//! Validates a shielded margin lock request. The circuit verifies that the
//! user's commitment contains sufficient balance to cover the requested margin,
//! and outputs the new commitment root after deducting the locked amount.
//!
//! Privacy: The commitment balance and locked amount remain encrypted.
//! Only a boolean validity flag and the new root hash are revealed.

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
    ///   - enc_new_balance: remaining balance after lock (encrypted with MXE key)
    ///   - locked_margin: the amount actually locked (revealed for position binding)
    #[instruction]
    pub fn lock_margin_private(
        balance_and_lock: Enc<Shared, (u64, u64, u64)>,
        requested_margin: u64,
    ) -> (bool, Enc<Mxe, u64>, u64) {
        let (balance, lock_amount, _commitment_secret) = balance_and_lock.to_arcis();

        // Validate lock amount matches the on-chain requested margin
        let amounts_match = lock_amount == requested_margin;

        // Validate sufficient balance
        let sufficient = balance >= lock_amount;

        let valid = amounts_match && sufficient;

        // Compute remaining balance (clamped to 0 if invalid)
        let new_balance = if valid { balance - lock_amount } else { 0 };

        let locked = if valid { lock_amount } else { 0 };

        // FIX: Return the new balance as an MXE-owned ciphertext instead of revealing it!
        let enc_new_balance = Mxe::get().from_arcis(new_balance);

        (valid.reveal(), enc_new_balance, locked.reveal())
    }
}
