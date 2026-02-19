use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::ShadowPerpError;
use crate::state::{CollateralWithdrawn, MarginAccount, Market};

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"margin", market.key().as_ref(), owner.key().as_ref()],
        bump = margin_account.bump,
        has_one = owner,
        has_one = market,
    )]
    pub margin_account: Account<'info, MarginAccount>,

    #[account(
        mut,
        constraint = user_token_account.owner == owner.key(),
        constraint = user_token_account.mint == market.collateral_mint
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        constraint = vault.key() == market.vault
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, ShadowPerpError::ZeroAmount);

    let margin_account = &mut ctx.accounts.margin_account;
    let market = &ctx.accounts.market;

    // Check available balance (balance - locked)
    let available = margin_account
        .balance
        .checked_sub(margin_account.locked_balance)
        .ok_or(ShadowPerpError::InsufficientBalance)?;

    require!(available >= amount, ShadowPerpError::InsufficientBalance);

    // Transfer tokens from vault to user using PDA signer
    let seeds = &[b"market", market.collateral_mint.as_ref(), &[market.bump]];
    let signer_seeds = &[&seeds[..]];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: market.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, amount)?;

    // Update margin account
    margin_account.balance = margin_account
        .balance
        .checked_sub(amount)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    margin_account.total_withdrawn = margin_account
        .total_withdrawn
        .checked_add(amount)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    emit!(CollateralWithdrawn {
        owner: margin_account.owner,
        amount,
        new_balance: margin_account.balance,
    });

    Ok(())
}
