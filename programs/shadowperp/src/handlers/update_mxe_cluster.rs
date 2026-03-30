use anchor_lang::prelude::*;

use crate::errors::ShadowPerpError;
use crate::state::Market;

#[derive(Accounts)]
pub struct UpdateMxeCluster<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    /// The new MXE cluster account.
    /// CHECK: Validated by the admin; Arcium cluster PDA.
    pub new_mxe_cluster: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<UpdateMxeCluster>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let old_cluster = market.mxe_cluster;
    market.mxe_cluster = ctx.accounts.new_mxe_cluster.key();

    msg!(
        "mxe_cluster updated: {} -> {}",
        old_cluster,
        market.mxe_cluster
    );

    Ok(())
}
