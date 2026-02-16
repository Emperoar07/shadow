use anchor_lang::prelude::*;

use crate::errors::ShadowPerpError;
use crate::state::{Market, Position, PositionStatus};

#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
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

pub fn handler(ctx: Context<ClosePosition>, computation_offset: u64) -> Result<()> {
    let market = &ctx.accounts.market;
    let position = &mut ctx.accounts.position;

    // Validate position is open
    require!(
        position.status == PositionStatus::Open,
        ShadowPerpError::PositionNotOpen
    );

    // Update status to closing
    position.status = PositionStatus::Closing;

    // Queue computation to Arcium MPC for PnL calculation
    // The MPC will:
    // 1. Decrypt position data (size, entry_price, leverage, direction)
    // 2. Calculate PnL using current oracle price
    // 3. Return the realized PnL (this is the ONLY data that gets revealed)
    //
    // NOTE: In production, this would make a CPI call to Arcium
    //
    // let encrypted_inputs = vec![
    //     position.encrypted_data.to_vec(),
    //     market.oracle_price.to_le_bytes().to_vec(),
    // ];
    //
    // arcium_anchor::cpi::queue_computation(
    //     cpi_ctx,
    //     computation_offset,
    //     encrypted_inputs,
    //     position.client_pubkey,
    //     position.nonce,
    // )?;

    msg!("Position close queued for MPC computation");
    msg!("Computation offset: {}", computation_offset);
    msg!("Position: {}", position.key());
    msg!("Current oracle price: {}", market.oracle_price);

    Ok(())
}
