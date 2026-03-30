use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};

use crate::errors::ShadowPerpError;
use crate::state::{Market, PriceUpdated};

const MAX_PRICE_JUMP_MULTIPLIER: u64 = 3;

/// Maximum age of a Pyth price feed update before it's considered stale (seconds).
const PYTH_MAX_AGE_SECS: u64 = 300;

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    pub price_feeder: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
        has_one = price_feeder @ ShadowPerpError::Unauthorized,
    )]
    pub market: Account<'info, Market>,
}

pub fn handler(ctx: Context<UpdatePrice>, price: u64) -> Result<()> {
    require!(price > 0, ShadowPerpError::InvalidPrice);

    let market = &mut ctx.accounts.market;
    let clock = Clock::get()?;

    let old_price = market.oracle_price;

    // Circuit breaker against oracle misconfig or bad feeder updates.
    if old_price > 0 {
        let max_price = old_price
            .checked_mul(MAX_PRICE_JUMP_MULTIPLIER)
            .ok_or(ShadowPerpError::ArithmeticOverflow)?;
        let min_price = old_price / MAX_PRICE_JUMP_MULTIPLIER;
        require!(price <= max_price, ShadowPerpError::InvalidPrice);
        require!(price >= min_price.max(1), ShadowPerpError::InvalidPrice);
    }

    market.oracle_price = price;
    market.last_price_update = clock.unix_timestamp;

    emit!(PriceUpdated {
        old_price,
        new_price: price,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// update_price_from_pyth — permissionless Pyth price push
// ---------------------------------------------------------------------------

/// Anyone can call this to sync the market oracle price from Pyth.
/// No `price_feeder` signer required — the Pyth feed itself is the authority.
#[derive(Accounts)]
pub struct UpdatePriceFromPyth<'info> {
    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    /// The Pyth PriceUpdateV2 account for this market's base asset.
    /// The correct feed ID is validated against market.pyth_feed_id at runtime.
    pub price_update: Account<'info, PriceUpdateV2>,
}

pub fn update_price_from_pyth_handler(ctx: Context<UpdatePriceFromPyth>) -> Result<()> {
    let clock = Clock::get()?;
    // Feed ID is stored per-market, set at initialization for each trading pair.
    let feed_id = ctx.accounts.market.pyth_feed_id;

    let price_data = ctx
        .accounts
        .price_update
        .get_price_no_older_than(&clock, PYTH_MAX_AGE_SECS, &feed_id)
        .map_err(|e| {
            msg!("Pyth staleness check failed: {:?}", e);
            msg!("Clock unix_timestamp: {}", clock.unix_timestamp);
            error!(ShadowPerpError::StalePrice)
        })?;

    // Pyth prices use a signed exponent: actual_price = price_data.price * 10^exponent.
    // Internally, oracle_price is stored in 6-decimal fixed-point (same as the manual
    // update_price path), i.e. $86.42 is stored as 86_420_000.
    //
    // Conversion formula: internal_price = raw_price * 10^(exponent + 6)
    //   exponent=-8 → divide by 10^2:  8_642_000_000 / 100       = 86_420_000  ($86.42)
    //   exponent=-6 → use directly:    8_642_000                  = 8_642_000   ($8.642)
    //   exponent=-4 → multiply by 10^2: 864_200 * 100             = 86_420_000  ($86.42)
    require!(price_data.price > 0, ShadowPerpError::InvalidPrice);
    // Reject prices with a publish_time in the future to guard against feed manipulation.
    require!(
        price_data.publish_time <= clock.unix_timestamp,
        ShadowPerpError::InvalidPrice
    );
    let raw_price = price_data.price as u64; // safe: guarded by > 0 check above
    let exp = price_data.exponent; // i32, typically -8 for most Pyth feeds
    let target_exp = exp + 6; // shift into 6-decimal space; e.g. -8+6 = -2
    let internal_price = if target_exp >= 0 {
        raw_price
            .checked_mul(10u64.pow(target_exp as u32))
            .ok_or(ShadowPerpError::ArithmeticOverflow)?
    } else {
        // target_exp is negative so -target_exp is positive; safe to cast to u32
        let divisor = 10u64.pow((-target_exp) as u32);
        raw_price / divisor // divisor is always >= 10, cannot be zero
    };
    require!(internal_price > 0, ShadowPerpError::InvalidPrice);

    let market = &mut ctx.accounts.market;
    let old_price = market.oracle_price;

    // Circuit breaker: reject jumps beyond MAX_PRICE_JUMP_MULTIPLIER (same guard as
    // manual path). Both old_price and internal_price are in 6-decimal format so the
    // comparison is apples-to-apples.
    if old_price > 0 {
        let max_price = old_price
            .checked_mul(MAX_PRICE_JUMP_MULTIPLIER)
            .ok_or(ShadowPerpError::ArithmeticOverflow)?;
        let min_price = old_price / MAX_PRICE_JUMP_MULTIPLIER;
        require!(internal_price <= max_price, ShadowPerpError::InvalidPrice);
        require!(internal_price >= min_price.max(1), ShadowPerpError::InvalidPrice);
    }

    market.oracle_price = internal_price;
    market.last_price_update = clock.unix_timestamp;

    emit!(PriceUpdated {
        old_price,
        new_price: internal_price,
        timestamp: clock.unix_timestamp,
    });

    // internal_price is 6-decimal fixed-point; divide by 1_000_000 for the dollar display.
    msg!(
        "Pyth oracle update: {}.{:06} USD (raw={}, exp={}, internal={})",
        internal_price / 1_000_000,
        internal_price % 1_000_000,
        price_data.price,
        price_data.exponent,
        internal_price,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// set_pyth_feed_id — authority-only update for the stored Pyth feed
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SetPythFeedId<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
        has_one = authority @ ShadowPerpError::Unauthorized,
    )]
    pub market: Account<'info, Market>,
}

pub fn set_pyth_feed_id_handler(ctx: Context<SetPythFeedId>, pyth_feed_id_hex: String) -> Result<()> {
    let feed_id = get_feed_id_from_hex(&pyth_feed_id_hex)
        .map_err(|_| error!(ShadowPerpError::InvalidPrice))?;
    ctx.accounts.market.pyth_feed_id = feed_id;
    Ok(())
}
