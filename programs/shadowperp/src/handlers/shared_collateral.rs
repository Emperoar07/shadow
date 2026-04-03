use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::ShadowPerpError;
use crate::state::{MarginAccount, Market};

#[derive(Accounts)]
pub struct AdoptSharedCollateralVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        constraint = collateral_mint.key() == market.collateral_mint @ ShadowPerpError::InvalidAccountData
    )]
    pub collateral_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub legacy_vault: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = authority,
        token::mint = collateral_mint,
        token::authority = shared_vault_authority,
        seeds = [b"shared_vault", collateral_mint.key().as_ref()],
        bump
    )]
    pub shared_vault: Account<'info, TokenAccount>,

    /// CHECK: PDA authority for the shared collateral vault.
    #[account(
        seeds = [b"shared_vault_authority", collateral_mint.key().as_ref()],
        bump
    )]
    pub shared_vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn adopt_shared_collateral_vault_handler(
    ctx: Context<AdoptSharedCollateralVault>,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let legacy_vault = &ctx.accounts.legacy_vault;
    let shared_vault = &ctx.accounts.shared_vault;

    if legacy_vault.key() != shared_vault.key() && legacy_vault.amount > 0 {
        let seeds = &[
            b"market",
            market.collateral_mint.as_ref(),
            market.base_asset_mint.as_ref(),
            &[market.bump],
        ];
        let signer_seeds = &[&seeds[..]];
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: legacy_vault.to_account_info(),
                to: shared_vault.to_account_info(),
                authority: market.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, legacy_vault.amount)?;
    }

    market.vault = shared_vault.key();
    Ok(())
}

#[derive(Accounts)]
pub struct MigrateLegacyMarginAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"margin", market.key().as_ref(), owner.key().as_ref()],
        bump = legacy_margin_account.bump,
        has_one = owner,
    )]
    pub legacy_margin_account: Account<'info, MarginAccount>,

    #[account(
        init_if_needed,
        payer = owner,
        space = MarginAccount::LEN,
        seeds = [b"margin", owner.key().as_ref()],
        bump,
        constraint = global_margin_account.owner == Pubkey::default()
            || global_margin_account.owner == owner.key(),
    )]
    pub global_margin_account: Account<'info, MarginAccount>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub legacy_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = shared_vault.key() == market.vault @ ShadowPerpError::InvalidAccountData
    )]
    pub shared_vault: Account<'info, TokenAccount>,

    /// CHECK: PDA authority for the shared collateral vault.
    #[account(
        seeds = [b"shared_vault_authority", market.collateral_mint.as_ref()],
        bump
    )]
    pub shared_vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn migrate_legacy_margin_account_handler(
    ctx: Context<MigrateLegacyMarginAccount>,
) -> Result<()> {
    let legacy_margin_account = &mut ctx.accounts.legacy_margin_account;
    let global_margin_account = &mut ctx.accounts.global_margin_account;
    let legacy_balance = legacy_margin_account.balance;

    require!(
        legacy_margin_account.locked_balance == 0,
        ShadowPerpError::InvalidAccountData
    );

    if global_margin_account.owner == Pubkey::default() {
        global_margin_account.owner = ctx.accounts.owner.key();
        global_margin_account.market = Pubkey::default();
        global_margin_account.bump = ctx.bumps.global_margin_account;
    }

    if legacy_balance > 0
        && ctx.accounts.legacy_vault.key() != ctx.accounts.shared_vault.key()
    {
        let market = &ctx.accounts.market;
        let seeds = &[
            b"market",
            market.collateral_mint.as_ref(),
            market.base_asset_mint.as_ref(),
            &[market.bump],
        ];
        let signer_seeds = &[&seeds[..]];
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.legacy_vault.to_account_info(),
                to: ctx.accounts.shared_vault.to_account_info(),
                authority: market.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, legacy_balance)?;
    }

    global_margin_account.balance = global_margin_account
        .balance
        .checked_add(legacy_balance)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    global_margin_account.total_deposited = global_margin_account
        .total_deposited
        .checked_add(legacy_balance)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    global_margin_account.positions_opened = global_margin_account
        .positions_opened
        .max(legacy_margin_account.positions_opened);
    global_margin_account.positions_closed = global_margin_account
        .positions_closed
        .checked_add(legacy_margin_account.positions_closed)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    legacy_margin_account.balance = 0;
    legacy_margin_account.locked_balance = 0;

    Ok(())
}
