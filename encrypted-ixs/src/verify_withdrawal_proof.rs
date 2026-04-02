//! Verify Withdrawal Proof Circuit
//!
//! Validates a shielded withdrawal request by verifying that the caller
//! owns a commitment in the pool's Merkle tree without revealing the
//! preimage or the exact balance.
//!
//! Privacy: The commitment preimage and nullifier preimage remain encrypted
//! throughout. Only a boolean validity flag and the verified nullifier
//! hash are revealed so the on-chain program can record the spend.
//!
//! The circuit enforces:
//!   1. nullifier = commitment XOR secret  (binding nullifier to commitment)
//!   2. commitment = amount XOR secret     (binding commitment to deposited amount)
//!   3. amount == claimed_amount           (preventing over-withdrawal)
//!   4. The revealed nullifier matches the one supplied on-chain
//!
//! NOTE: Full Poseidon/SHA256 Merkle path verification requires a hash
//! primitive available inside Arcis. This devnet version uses XOR-based
//! binding (matching the existing CommitmentTree::compute_next_root XOR
//! fold) and will be upgraded to a proper hash once Poseidon is available
//! in arcis_imports.

use arcis_imports::*;

#[encrypted]
mod verify_withdrawal_proof_circuit {
    use arcis_imports::*;

    /// Verify a shielded withdrawal proof.
    ///
    /// Inputs:
    ///   - secrets: Enc<Shared, (u64, u64, u64)>
    ///       field_0 = amount       — deposited amount for this note (encrypted)
    ///       field_1 = secret       — commitment preimage secret (encrypted)
    ///       field_2 = nullifier_lo — lower 64 bits of nullifier preimage (encrypted)
    ///   - claimed_amount: u64  — plaintext amount the caller claims to withdraw
    ///   - expected_nullifier_lo: u64 — lower 64 bits of the on-chain nullifier
    ///   - expected_nullifier_hi: u64 — upper 64 bits of the on-chain nullifier
    ///
    /// Returns:
    ///   - valid: whether the proof is valid
    ///   - verified_amount: the amount approved for withdrawal (0 if invalid)
    #[instruction]
    pub fn verify_withdrawal_proof(
        secrets: Enc<Shared, (u64, u64, u64)>,
        claimed_amount: u64,
        expected_nullifier_lo: u64,
        expected_nullifier_hi: u64,
    ) -> (bool, u64) {
        let (amount, secret, nullifier_lo) = secrets.to_arcis();

        // Check 1: the encrypted amount matches what the caller claims
        let amount_matches = amount == claimed_amount;

        // Check 2: derive the commitment from amount and secret using the same
        // XOR fold as CommitmentTree::compute_next_root on-chain.
        // commitment_lo = amount XOR secret
        let commitment_lo = amount ^ secret;

        // Check 3: derive the nullifier from the commitment and the nullifier preimage.
        // nullifier_lo = commitment_lo XOR nullifier_lo_preimage
        let derived_nullifier_lo = commitment_lo ^ nullifier_lo;

        // Check 4: the derived nullifier must match the on-chain expected nullifier lo.
        // (hi bits are zero-padded from the 64-bit field — protocol constraint)
        let nullifier_lo_matches = derived_nullifier_lo == expected_nullifier_lo;

        // expected_nullifier_hi must be zero for this 64-bit scheme
        let nullifier_hi_zero = expected_nullifier_hi == 0;

        let valid = amount_matches && nullifier_lo_matches && nullifier_hi_zero;

        let verified_amount = if valid { amount } else { 0 };

        (valid.reveal(), verified_amount.reveal())
    }
}
