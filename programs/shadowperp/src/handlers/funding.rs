//! Funding rate handlers:
//!   - `init_funding_state`       — authority-only, creates FundingState PDA for a market
//!   - `update_funding_rate`      — permissionless, updates rate if interval elapsed
//!   - `set_funding_premium`      — authority-only, sets the plaintext premium_bps
//!   - `set_oi_caps`              — authority-only, sets long/short OI caps
//!   - `update_mark_price`        — authority/price_feeder, sets mark_price on Market

use anchor_lang::prelude::*;

use crate::errors::ShadowPerpError;
use crate::state::{
    FundingPremiumSet, FundingRateUpdated, FundingState, FundingStateInitialized, Market,
    MarkPriceUpdated, OiCapsSet,
};

// ─────────────────────────────────────────────────────────────────────────────
// init_funding_state
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitFundingState<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
        has_one = authority @ ShadowPerpError::Unauthorized,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = authority,
        space = FundingState::LEN,
        seeds = [b"funding", market.key().as_ref()],
        bump
    )]
    pub funding_state: Box<Account<'info, FundingState>>,

    pub system_program: Program<'info, System>,
}

pub fn init_funding_state_handler(
    ctx: Context<InitFundingState>,
    funding_interval: u64,
    max_funding_rate: u64,
) -> Result<()> {
    require!(funding_interval > 0, ShadowPerpError::InvalidAccountData);
    require!(max_funding_rate > 0, ShadowPerpError::InvalidAccountData);

    let clock = Clock::get()?;
    let funding_state = &mut ctx.accounts.funding_state;
    funding_state.market = ctx.accounts.market.key();
    funding_state.funding_rate = 0;
    funding_state.cumulative_funding = 0;
    funding_state.last_funding_time = clock.unix_timestamp;
    funding_state.funding_interval = funding_interval;
    funding_state.max_funding_rate = max_funding_rate;
    funding_state.premium_bps = 0;
    funding_state.bump = ctx.bumps.funding_state;

    emit!(FundingStateInitialized {
        market: ctx.accounts.market.key(),
        funding_interval,
        max_funding_rate,
    });

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// update_funding_rate  (permissionless — anyone can call, rate changes only if
//                        the funding_interval has elapsed)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct UpdateFundingRate<'info> {
    /// CHECK: permissionless — no signer constraint required
    pub caller: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"funding", market.key().as_ref()],
        bump = funding_state.bump,
        has_one = market @ ShadowPerpError::InvalidAccountData,
    )]
    pub funding_state: Box<Account<'info, FundingState>>,
}

pub fn update_funding_rate_handler(ctx: Context<UpdateFundingRate>) -> Result<()> {
    let clock = Clock::get()?;
    let funding_state = &mut ctx.accounts.funding_state;

    let elapsed = clock
        .unix_timestamp
        .saturating_sub(funding_state.last_funding_time);

    require!(
        elapsed >= funding_state.funding_interval as i64,
        ShadowPerpError::FundingIntervalNotElapsed
    );

    // Funding rate formula (simplified — no encrypted OI access yet):
    //   rate = clamp(premium_bps, -max_funding_rate, max_funding_rate)
    //
    // In a future MPC-enabled pass the premium_bps will be derived from decrypted
    // long_oi / short_oi imbalance. For now the authority controls it via set_funding_premium.
    let max = funding_state.max_funding_rate as i64;
    let rate = funding_state.premium_bps.clamp(-max, max);

    // elapsed_hours may be fractional; we use integer hours for accumulation to keep
    // arithmetic simple and avoid fixed-point division errors.
    let elapsed_hours = elapsed / 3600;

    let delta = rate
        .checked_mul(elapsed_hours)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    funding_state.cumulative_funding = funding_state
        .cumulative_funding
        .checked_add(delta)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    funding_state.funding_rate = rate;
    funding_state.last_funding_time = clock.unix_timestamp;

    emit!(FundingRateUpdated {
        market: funding_state.market,
        new_funding_rate: rate,
        cumulative_funding: funding_state.cumulative_funding,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// set_funding_premium  (authority-only)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct SetFundingPremium<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
        has_one = authority @ ShadowPerpError::Unauthorized,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"funding", market.key().as_ref()],
        bump = funding_state.bump,
        has_one = market @ ShadowPerpError::InvalidAccountData,
    )]
    pub funding_state: Box<Account<'info, FundingState>>,
}

pub fn set_funding_premium_handler(
    ctx: Context<SetFundingPremium>,
    premium_bps: i64,
) -> Result<()> {
    let funding_state = &mut ctx.accounts.funding_state;
    let max = funding_state.max_funding_rate as i64;
    require!(
        premium_bps >= -max && premium_bps <= max,
        ShadowPerpError::InvalidAccountData
    );

    funding_state.premium_bps = premium_bps;

    emit!(FundingPremiumSet {
        market: funding_state.market,
        premium_bps,
    });

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// set_oi_caps  (authority-only)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct SetOiCaps<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
        has_one = authority @ ShadowPerpError::Unauthorized,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"funding", market.key().as_ref()],
        bump = funding_state.bump,
        has_one = market @ ShadowPerpError::InvalidAccountData,
    )]
    pub funding_state: Box<Account<'info, FundingState>>,
}

pub fn set_oi_caps_handler(
    ctx: Context<SetOiCaps>,
    long_oi_cap: u64,
    short_oi_cap: u64,
) -> Result<()> {
    let funding_state = &mut ctx.accounts.funding_state;
    funding_state.set_long_oi_cap(long_oi_cap);
    funding_state.set_short_oi_cap(short_oi_cap);

    emit!(OiCapsSet {
        market: funding_state.market,
        long_oi_cap,
        short_oi_cap,
    });

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// update_mark_price  (price_feeder or authority only)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct UpdateMarkPrice<'info> {
    /// Either the market authority or the price_feeder may update mark price.
    pub price_feeder: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
        constraint = (price_feeder.key() == market.authority || price_feeder.key() == market.price_feeder)
            @ ShadowPerpError::Unauthorized,
    )]
    pub market: Box<Account<'info, Market>>,
}

pub fn update_mark_price_handler(ctx: Context<UpdateMarkPrice>, mark_price: u64) -> Result<()> {
    require!(mark_price > 0, ShadowPerpError::InvalidPrice);

    let market = &mut ctx.accounts.market;
    let index_price = market.oracle_price;
    require!(index_price > 0, ShadowPerpError::InvalidPrice);

    // Enforce ±MARK_PRICE_MAX_DEVIATION_BPS (200 bps = 2%) deviation cap from index price.
    // max_delta = index_price * 200 / 10000 = index_price / 50
    let max_delta = index_price
        .checked_mul(Market::MARK_PRICE_MAX_DEVIATION_BPS)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?
        / 10_000;

    let upper = index_price
        .checked_add(max_delta)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    let lower = index_price.saturating_sub(max_delta);

    require!(
        mark_price >= lower && mark_price <= upper,
        ShadowPerpError::MarkPriceDeviationExceedsCap
    );

    let clock = Clock::get()?;
    let old_mark_price = market.mark_price();

    market.set_mark_price(mark_price);
    market.set_last_mark_price_update(clock.unix_timestamp);

    emit!(MarkPriceUpdated {
        market: market.key(),
        old_mark_price,
        new_mark_price: mark_price,
        index_price,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
