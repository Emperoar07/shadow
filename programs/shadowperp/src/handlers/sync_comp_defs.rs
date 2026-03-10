use anchor_lang::prelude::*;
use arcium_anchor::prelude::ComputationDefinitionAccount;

use crate::errors::ShadowPerpError;
use crate::state::Market;

#[derive(Accounts)]
pub struct SyncCompDefs<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub open_position_comp_def: Account<'info, ComputationDefinitionAccount>,
    pub close_position_comp_def: Account<'info, ComputationDefinitionAccount>,
    pub liquidation_comp_def: Account<'info, ComputationDefinitionAccount>,
    pub seed_open_interest_comp_def: Account<'info, ComputationDefinitionAccount>,
}

pub fn handler(ctx: Context<SyncCompDefs>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    market.open_position_comp_def = ctx.accounts.open_position_comp_def.key();
    market.close_position_comp_def = ctx.accounts.close_position_comp_def.key();
    market.liquidation_comp_def = ctx.accounts.liquidation_comp_def.key();
    market.seed_open_interest_comp_def = ctx.accounts.seed_open_interest_comp_def.key();
    Ok(())
}
