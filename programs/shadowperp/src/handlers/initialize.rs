use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::{Market, MarketInitialized};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Market::LEN,
        seeds = [b"market", collateral_mint.key().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,

    /// Collateral token mint (e.g., USDC)
    pub collateral_mint: Account<'info, Mint>,

    /// Protocol vault for holding collateral
    #[account(
        init,
        payer = authority,
        token::mint = collateral_mint,
        token::authority = market,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Authorized oracle price feeder
    /// CHECK: This is just a pubkey for authorization
    pub price_feeder: UncheckedAccount<'info>,

    /// MXE cluster for Arcium computations
    /// CHECK: Validated by Arcium
    pub mxe_cluster: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<Initialize>,
    max_leverage: u8,
    liquidation_threshold: u16,
    trading_fee: u16,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let bump = ctx.bumps.market;

    market.authority = ctx.accounts.authority.key();
    market.collateral_mint = ctx.accounts.collateral_mint.key();
    market.vault = ctx.accounts.vault.key();
    market.oracle_price = 0;
    market.last_price_update = 0;
    market.max_leverage = max_leverage;
    market.liquidation_threshold = liquidation_threshold;
    market.trading_fee = trading_fee;
    market.encrypted_total_long_oi = [0u8; 32];
    market.encrypted_total_short_oi = [0u8; 32];
    market.active_positions = 0;
    market.total_fees_collected = 0;
    market.price_feeder = ctx.accounts.price_feeder.key();
    market.mxe_cluster = ctx.accounts.mxe_cluster.key();
    market.seed_open_interest_comp_def = Pubkey::default();
    market.bump = bump;

    emit!(MarketInitialized {
        authority: market.authority,
        collateral_mint: market.collateral_mint,
        max_leverage,
        liquidation_threshold,
    });

    Ok(())
}
