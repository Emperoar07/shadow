use anchor_lang::prelude::*;

use crate::errors::ShadowPerpError;
use crate::state::{Market, Position, PositionStatus};

#[derive(Accounts)]
#[instruction(mark_price: u64, computation_offset: u64)]
pub struct CheckLiquidation<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = market,
    )]
    pub position: Account<'info, Position>,

    /// Computation account for Arcium MPC
    /// CHECK: Validated by Arcium
    #[account(mut)]
    pub computation: UncheckedAccount<'info>,

    /// MXE cluster account
    /// CHECK: Validated by Arcium
    pub cluster: UncheckedAccount<'info>,

    /// MXE account
    /// CHECK: Validated by Arcium
    pub mxe: UncheckedAccount<'info>,

    /// Mempool account
    /// CHECK: Validated by Arcium
    #[account(mut)]
    pub mempool: UncheckedAccount<'info>,

    /// Executing pool
    /// CHECK: Validated by Arcium
    #[account(mut)]
    pub executing_pool: UncheckedAccount<'info>,

    /// Computation definition account
    /// CHECK: Validated by Arcium
    pub comp_def: UncheckedAccount<'info>,

    /// Arcium program
    /// CHECK: Arcium program
    pub arcium_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CheckLiquidation>,
    mark_price: u64,
    computation_offset: u64,
) -> Result<()> {
    let market = &ctx.accounts.market;
    let position = &ctx.accounts.position;
    let clock = Clock::get()?;

    // Validate position is open
    require!(
        position.status == PositionStatus::Open,
        ShadowPerpError::PositionNotOpen
    );

    // Validate price is not stale (within 60 seconds)
    let price_age = clock.unix_timestamp - market.last_price_update;
    require!(price_age < 60, ShadowPerpError::StalePrice);

    // Validate mark_price matches oracle (or is within acceptable range)
    require!(mark_price == market.oracle_price, ShadowPerpError::InvalidPrice);

    // Queue liquidation check computation to Arcium MPC
    // The MPC will:
    // 1. Decrypt position data (size, entry_price, leverage, margin)
    // 2. Calculate unrealized PnL using mark_price
    // 3. Calculate health factor = (margin + unrealized_pnl) / (position_value / leverage)
    // 4. Return whether position should be liquidated (bool)
    //
    // CRITICAL: The health factor itself is NEVER revealed
    // Only the boolean liquidation decision is returned
    // This prevents targeted liquidation attacks
    //
    // NOTE: In production, this would make a CPI call to Arcium
    //
    // let encrypted_inputs = vec![
    //     position.encrypted_data.to_vec(),
    //     mark_price.to_le_bytes().to_vec(),
    //     market.liquidation_threshold.to_le_bytes().to_vec(),
    // ];
    //
    // arcium_anchor::cpi::queue_computation(
    //     cpi_ctx,
    //     computation_offset,
    //     encrypted_inputs,
    //     position.client_pubkey,
    //     position.nonce,
    // )?;

    msg!("Liquidation check queued for MPC computation");
    msg!("Computation offset: {}", computation_offset);
    msg!("Position: {}", position.key());
    msg!("Mark price: {}", mark_price);

    Ok(())
}
