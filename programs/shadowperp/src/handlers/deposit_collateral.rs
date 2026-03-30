use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::ShadowPerpError;
use crate::state::{CollateralDeposited, MarginAccount, Market};

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        init_if_needed,
        payer = owner,
        space = MarginAccount::LEN,
        seeds = [b"margin", market.key().as_ref(), owner.key().as_ref()],
        bump,
        constraint = margin_account.owner == Pubkey::default()
            || margin_account.owner == owner.key(),
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
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, ShadowPerpError::ZeroAmount);

    let margin_account = &mut ctx.accounts.margin_account;
    let market = &ctx.accounts.market;

    // Initialize margin account if new
    if margin_account.owner == Pubkey::default() {
        margin_account.owner = ctx.accounts.owner.key();
        margin_account.market = market.key();
        margin_account.bump = ctx.bumps.margin_account;
    }

    // Transfer tokens from user to vault
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, amount)?;

    // Update margin account
    margin_account.balance = margin_account
        .balance
        .checked_add(amount)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    margin_account.total_deposited = margin_account
        .total_deposited
        .checked_add(amount)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    emit!(CollateralDeposited {
        owner: margin_account.owner,
        amount,
        new_balance: margin_account.balance,
    });

    Ok(())
}
