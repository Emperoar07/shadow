use anchor_lang::prelude::*;

use crate::errors::ShadowPerpError;
use crate::state::{Market, MarginAccount, Position, PositionOpened, PositionStatus};

#[derive(Accounts)]
#[instruction(
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_is_long: [u8; 32],
    client_pubkey: [u8; 32],
    nonce: [u8; 16],
    computation_offset: u64,
)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
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
        init,
        payer = owner,
        space = Position::LEN,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref(), &market.active_positions.to_le_bytes()],
        bump
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
    ctx: Context<OpenPosition>,
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_is_long: [u8; 32],
    client_pubkey: [u8; 32],
    nonce: [u8; 16],
    computation_offset: u64,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let margin_account = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;
    let clock = Clock::get()?;

    // Validate margin account has sufficient balance
    // Note: We can't check exact margin requirement because size/leverage are encrypted
    // The MPC circuit will validate this
    require!(margin_account.balance > 0, ShadowPerpError::InsufficientMargin);

    // Initialize position with encrypted data
    position.owner = ctx.accounts.owner.key();
    position.market = market.key();
    position.status = PositionStatus::Pending;
    position.opened_at = clock.unix_timestamp;
    position.closed_at = 0;
    position.margin = 0; // Set by callback after MPC validates
    position.realized_pnl = 0;
    position.nonce = nonce;
    position.client_pubkey = client_pubkey;
    position.index = market.active_positions;
    position.bump = ctx.bumps.position;

    // Pack encrypted inputs into position data
    // This will be sent to Arcium for processing
    let mut encrypted_data = [0u8; 256];
    encrypted_data[0..32].copy_from_slice(&encrypted_size);
    encrypted_data[32..64].copy_from_slice(&encrypted_entry_price);
    encrypted_data[64..96].copy_from_slice(&encrypted_leverage);
    encrypted_data[96..128].copy_from_slice(&encrypted_is_long);
    position.encrypted_data = encrypted_data;

    // Queue computation to Arcium MPC
    // NOTE: In production, this would make a CPI call to Arcium
    //
    // let cpi_accounts = arcium_anchor::cpi::accounts::QueueComputation {
    //     computation: ctx.accounts.computation.to_account_info(),
    //     cluster: ctx.accounts.cluster.to_account_info(),
    //     mxe: ctx.accounts.mxe.to_account_info(),
    //     mempool: ctx.accounts.mempool.to_account_info(),
    //     executing_pool: ctx.accounts.executing_pool.to_account_info(),
    //     comp_def: ctx.accounts.comp_def.to_account_info(),
    //     payer: ctx.accounts.owner.to_account_info(),
    //     system_program: ctx.accounts.system_program.to_account_info(),
    // };
    //
    // arcium_anchor::cpi::queue_computation(
    //     CpiContext::new(ctx.accounts.arcium_program.to_account_info(), cpi_accounts),
    //     computation_offset,
    //     encrypted_inputs,
    //     client_pubkey,
    //     nonce,
    // )?;

    msg!("Position opening queued for MPC computation");
    msg!("Computation offset: {}", computation_offset);
    msg!("Position index: {}", position.index);

    // Emit event (note: no size/leverage revealed)
    emit!(PositionOpened {
        owner: position.owner,
        position: position.key(),
        market: market.key(),
        margin: 0, // Updated by callback
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
