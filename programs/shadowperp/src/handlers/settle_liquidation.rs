use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::ShadowPerpError;
use crate::state::{
    LiquidationSettlement, Market, Position, PositionLiquidated, PositionStatus,
};

#[derive(Accounts)]
pub struct SettleLiquidation<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub liquidator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = market,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"liquidation_settlement", position.key().as_ref()],
        bump = liquidation_settlement.bump,
        constraint = liquidation_settlement.position == position.key() @ ShadowPerpError::InvalidAccountData,
        constraint = liquidation_settlement.liquidator == liquidator.key() @ ShadowPerpError::Unauthorized,
        close = liquidator,
    )]
    pub liquidation_settlement: Box<Account<'info, LiquidationSettlement>>,

    /// Liquidator's token account for reward
    #[account(
        mut,
        constraint = liquidator_token_account.owner == liquidator.key(),
        constraint = liquidator_token_account.mint == market.collateral_mint
    )]
    pub liquidator_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = vault.key() == market.vault
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA authority for the shared collateral vault.
    #[account(
        seeds = [b"shared_vault_authority", market.collateral_mint.as_ref()],
        bump
    )]
    pub shared_vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SettleLiquidation>) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let market = &ctx.accounts.market;

    require!(
        position.status == PositionStatus::LiquidatedPendingSettlement,
        ShadowPerpError::InvalidAccountData
    );

    // position.margin holds the liquidation penalty stored by the callback.
    let liquidation_penalty = position.margin;

    // Pay liquidation reward from vault to liquidator
    if liquidation_penalty > 0 {
        let (_, shared_vault_authority_bump) = Pubkey::find_program_address(
            &[b"shared_vault_authority", market.collateral_mint.as_ref()],
            ctx.program_id,
        );
        let authority_seeds = &[
            b"shared_vault_authority".as_ref(),
            market.collateral_mint.as_ref(),
            &[shared_vault_authority_bump],
        ];
        let signer_seeds = &[&authority_seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.liquidator_token_account.to_account_info(),
                authority: ctx.accounts.shared_vault_authority.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, liquidation_penalty)?;
    }

    // Finalize position state
    position.margin = 0;
    position.requested_margin = 0;
    position.status = PositionStatus::Liquidated;

    let clock = Clock::get()?;
    emit!(PositionLiquidated {
        owner: position.owner,
        position: position.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
