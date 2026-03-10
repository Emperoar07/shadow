use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::ShadowPerpError;
use crate::state::{Market, Position, PositionClosed, PositionStatus};

#[derive(Accounts)]
pub struct SettleClosePosition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = market,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    /// Position owner's token account for settlement
    #[account(
        mut,
        constraint = owner_token_account.owner == position.owner,
        constraint = owner_token_account.mint == market.collateral_mint
    )]
    pub owner_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        constraint = vault.key() == market.vault
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SettleClosePosition>) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let market = &ctx.accounts.market;

    require!(
        position.status == PositionStatus::ClosedPendingSettlement,
        ShadowPerpError::InvalidAccountData
    );

    // position.margin holds the settlement amount stored by the callback.
    let settlement_amount = position.margin;

    // Transfer settlement amount to user
    if settlement_amount > 0 {
        let seeds = &[b"market", market.collateral_mint.as_ref(), &[market.bump]];
        let signer_seeds = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.owner_token_account.to_account_info(),
                authority: market.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, settlement_amount)?;
    }

    // Finalize position state
    position.margin = 0;
    position.requested_margin = 0;
    position.status = PositionStatus::Closed;

    let clock = Clock::get()?;
    emit!(PositionClosed {
        owner: position.owner,
        position: position.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
