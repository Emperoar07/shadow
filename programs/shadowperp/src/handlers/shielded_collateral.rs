use anchor_lang::prelude::*;

use crate::errors::ShadowPerpError;
use crate::state::{
    Market, NullifierSet, ShieldedCollateralFeatureSet, ShieldedPool, ShieldedPoolInitialized,
    SHIELDED_FEATURE_COLLATERAL,
};

#[derive(Accounts)]
pub struct InitShieldedPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = authority,
        space = ShieldedPool::LEN,
        seeds = [b"shielded_pool", market.key().as_ref()],
        bump
    )]
    pub shielded_pool: Account<'info, ShieldedPool>,

    #[account(
        init,
        payer = authority,
        space = NullifierSet::LEN,
        seeds = [b"nullifier_set", market.key().as_ref()],
        bump
    )]
    pub nullifier_set: Account<'info, NullifierSet>,

    pub system_program: Program<'info, System>,
}

pub fn init_shielded_pool_handler(
    ctx: Context<InitShieldedPool>,
    enable_private_collateral: bool,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let slot = clock.slot;
    let shielded_pool_key = ctx.accounts.shielded_pool.key();

    let pool = &mut ctx.accounts.shielded_pool;
    pool.market = ctx.accounts.market.key();
    pool.authority = ctx.accounts.authority.key();
    pool.feature_flags = if enable_private_collateral {
        SHIELDED_FEATURE_COLLATERAL
    } else {
        0
    };
    pool.created_at = now;
    pool.updated_at = now;
    pool.bump = ctx.bumps.shielded_pool;
    pool.version = ShieldedPool::VERSION;

    let nullifier_set = &mut ctx.accounts.nullifier_set;
    nullifier_set.market = ctx.accounts.market.key();
    nullifier_set.pool = shielded_pool_key;
    nullifier_set.nullifier_count = 0;
    nullifier_set.last_rotation_slot = slot;
    nullifier_set.bump = ctx.bumps.nullifier_set;
    nullifier_set.version = NullifierSet::VERSION;

    emit!(ShieldedPoolInitialized {
        market: pool.market,
        authority: pool.authority,
        enabled: pool.collateral_enabled(),
    });

    Ok(())
}

#[derive(Accounts)]
pub struct SetShieldedCollateralFeature<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"shielded_pool", market.key().as_ref()],
        bump = shielded_pool.bump,
        constraint = shielded_pool.market == market.key() @ ShadowPerpError::InvalidAccountData,
        constraint = shielded_pool.authority == authority.key() @ ShadowPerpError::Unauthorized,
    )]
    pub shielded_pool: Account<'info, ShieldedPool>,
}

pub fn set_shielded_collateral_feature_handler(
    ctx: Context<SetShieldedCollateralFeature>,
    enabled: bool,
) -> Result<()> {
    let pool = &mut ctx.accounts.shielded_pool;
    if enabled {
        pool.feature_flags |= SHIELDED_FEATURE_COLLATERAL;
    } else {
        pool.feature_flags &= !SHIELDED_FEATURE_COLLATERAL;
    }
    pool.updated_at = Clock::get()?.unix_timestamp;

    emit!(ShieldedCollateralFeatureSet {
        market: pool.market,
        authority: pool.authority,
        enabled: pool.collateral_enabled(),
    });

    Ok(())
}
