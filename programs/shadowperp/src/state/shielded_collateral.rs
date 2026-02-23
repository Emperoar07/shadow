use anchor_lang::prelude::*;

pub const SHIELDED_FEATURE_COLLATERAL: u64 = 1 << 0;

/// Feature-gated scaffold for shielded collateral state.
/// This account is intentionally independent from the current public
/// deposit/withdraw path until feature activation is explicitly enabled.
#[account]
pub struct ShieldedPool {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub feature_flags: u64,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
    pub version: u8,
    pub _reserved: [u8; 128],
}

impl ShieldedPool {
    pub const VERSION: u8 = 1;
    pub const LEN: usize = 8 + // discriminator
        32 + // market
        32 + // authority
        8 +  // feature_flags
        8 +  // created_at
        8 +  // updated_at
        1 +  // bump
        1 +  // version
        128; // reserved

    pub fn collateral_enabled(&self) -> bool {
        (self.feature_flags & SHIELDED_FEATURE_COLLATERAL) != 0
    }
}

/// Nullifier bookkeeping scaffold for future private collateral proofs.
/// No active nullifier verification path is wired into deposit/withdraw yet.
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
