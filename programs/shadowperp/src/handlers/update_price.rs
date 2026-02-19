use anchor_lang::prelude::*;

use crate::errors::ShadowPerpError;
use crate::state::{Market, PriceUpdated};

const MAX_PRICE_JUMP_MULTIPLIER: u64 = 10;

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    pub price_feeder: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref()],
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
