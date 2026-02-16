use anchor_lang::prelude::*;

use crate::errors::ShadowPerpError;
use crate::state::{Market, PriceUpdated};

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
    market.oracle_price = price;
    market.last_price_update = clock.unix_timestamp;

    emit!(PriceUpdated {
        old_price,
        new_price: price,
        timestamp: clock.unix_timestamp,
    });

    msg!("Price updated: {} -> {}", old_price, price);

    Ok(())
}
