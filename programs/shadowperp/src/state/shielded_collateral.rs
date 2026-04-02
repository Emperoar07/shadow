use anchor_lang::prelude::*;
use sha2::{Sha256, Digest};

pub const SHIELDED_FEATURE_COLLATERAL: u64 = 1 << 0;

/// Number of rolling roots kept in the commitment tree.
pub const ROLLING_ROOTS_COUNT: usize = 16;

/// Delay in slots before a pending withdrawal can be finalized.
pub const WITHDRAWAL_DELAY_SLOTS: u64 = 100;

/// Feature-gated shielded collateral pool bound to a market.
/// Holds the current Merkle root, vault reference, and cumulative accounting.
#[account]
pub struct ShieldedPool {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub vault: Pubkey,
    pub tree_root: [u8; 32],
    pub total_public_in: u64,
    pub total_public_out: u64,
    pub commitment_count: u64,
    pub feature_flags: u64,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
    pub version: u8,
    pub _reserved: [u8; 64],
}

impl ShieldedPool {
    pub const VERSION: u8 = 2;
    pub const LEN: usize = 8 + // discriminator
        32 + // market
        32 + // authority
        32 + // collateral_mint
        32 + // vault
        32 + // tree_root
        8 +  // total_public_in
        8 +  // total_public_out
        8 +  // commitment_count
        8 +  // feature_flags
        8 +  // created_at
        8 +  // updated_at
        1 +  // bump
        1 +  // version
        64;  // reserved

    pub fn collateral_enabled(&self) -> bool {
        (self.feature_flags & SHIELDED_FEATURE_COLLATERAL) != 0
    }
}

/// Append-only commitment tree with a rolling ring buffer of recent roots.
/// Allows recent inclusion proofs to remain valid even after new deposits.
#[account]
pub struct CommitmentTree {
    pub pool: Pubkey,
    pub depth: u8,
    pub next_index: u64,
    pub roots: [[u8; 32]; ROLLING_ROOTS_COUNT],
    pub root_index: u8,
    pub bump: u8,
    pub version: u8,
    pub _reserved: [u8; 64],
}

impl CommitmentTree {
    pub const VERSION: u8 = 1;
    pub const LEN: usize = 8 + // discriminator
        32 + // pool
        1 +  // depth
        8 +  // next_index
        (32 * ROLLING_ROOTS_COUNT) + // roots ring buffer
        1 +  // root_index
        1 +  // bump
        1 +  // version
        64;  // reserved

    /// Push a new root into the rolling ring buffer.
    pub fn push_root(&mut self, root: [u8; 32]) {
        self.root_index = ((self.root_index as usize + 1) % ROLLING_ROOTS_COUNT) as u8;
        self.roots[self.root_index as usize] = root;
    }

    /// Check whether a given root is among the recent rolling roots.
    pub fn is_known_root(&self, root: &[u8; 32]) -> bool {
        self.roots.iter().any(|r| r == root)
    }

    /// Compute a new root by hashing the previous root with a new commitment leaf.
    /// Uses SHA256 for cryptographic commitment chaining.
    pub fn compute_next_root(current_root: &[u8; 32], commitment: &[u8; 32]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(current_root);
        hasher.update(commitment);
        let result = hasher.finalize();
        let mut out = [0u8; 32];
        out.copy_from_slice(&result);
        out
    }
}

/// Nullifier bookkeeping for shielded collateral proofs.
/// Tracks spent nullifiers to prevent double-spend/replay.
#[account]
pub struct NullifierSet {
    pub market: Pubkey,
    pub pool: Pubkey,
    pub nullifier_count: u64,
    pub last_rotation_slot: u64,
    pub bump: u8,
    pub version: u8,
    pub _reserved: [u8; 128],
}

impl NullifierSet {
    pub const VERSION: u8 = 1;
    pub const LEN: usize = 8 + // discriminator
        32 + // market
        32 + // pool
        8 +  // nullifier_count
        8 +  // last_rotation_slot
        1 +  // bump
        1 +  // version
        128; // reserved
}

/// Withdrawal intent tied to a nullifier. Created by request_withdraw_private,
/// proof-verified by the Arcium MPC callback, and finalized after the delay
/// period by finalize_withdraw.
#[account]
pub struct PendingWithdrawal {
    pub pool: Pubkey,
    pub nullifier: [u8; 32],
    pub recipient: Pubkey,
    pub amount: u64,
    pub expiry_slot: u64,
    pub finalized: bool,
    /// Set to true by verify_withdrawal_proof_callback once MPC confirms the
    /// caller owns a valid commitment covering this amount. finalize_withdraw
    /// requires this to be true before releasing funds.
    pub proof_verified: bool,
    pub bump: u8,
    pub _reserved: [u8; 31],
}

impl PendingWithdrawal {
    pub const LEN: usize = 8 + // discriminator
        32 + // pool
        32 + // nullifier
        32 + // recipient
        8 +  // amount
        8 +  // expiry_slot
        1 +  // finalized
        1 +  // proof_verified
        1 +  // bump
        31;  // reserved (total reserved stays 32 bytes, split 1+31)
}

/// Links a user to their shielded collateral commitment context.
/// Tracks the latest commitment hash and pending computation binding
/// for MPC-based margin operations.
#[account]
pub struct ShieldedMarginRef {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub pool: Pubkey,
    pub commitment: [u8; 32],
    pub pending_computation_account: Pubkey,
    pub bump: u8,
    pub version: u8,
    pub _reserved: [u8; 64],
}

impl ShieldedMarginRef {
    pub const VERSION: u8 = 1;
    pub const LEN: usize = 8 + // discriminator
        32 + // owner
        32 + // market
        32 + // pool
        32 + // commitment
        32 + // pending_computation_account
        1 +  // bump
        1 +  // version
        64;  // reserved
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct ShieldedPoolInitialized {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub enabled: bool,
}

#[event]
pub struct ShieldedCollateralFeatureSet {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub enabled: bool,
}

#[event]
pub struct ShieldedDeposit {
    pub pool: Pubkey,
    pub depositor: Pubkey,
    pub commitment: [u8; 32],
    pub leaf_index: u64,
}

#[event]
pub struct WithdrawalRequested {
    pub pool: Pubkey,
    pub nullifier: [u8; 32],
    pub recipient: Pubkey,
    pub expiry_slot: u64,
}

#[event]
pub struct WithdrawalFinalized {
    pub pool: Pubkey,
    pub nullifier: [u8; 32],
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ShieldedMarginRefCreated {
    pub owner: Pubkey,
    pub pool: Pubkey,
}
