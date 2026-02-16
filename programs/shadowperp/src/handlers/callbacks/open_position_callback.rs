use anchor_lang::prelude::*;

use crate::errors::ShadowPerpError;
use crate::state::{Market, MarginAccount, Position, PositionOpened, PositionStatus};

#[derive(Accounts)]
pub struct OpenPositionCallback<'info> {
    /// Arcium callback authority
    /// CHECK: Must be the Arcium program callback
    pub callback_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"margin", market.key().as_ref(), position.owner.as_ref()],
        bump = margin_account.bump,
    )]
    pub margin_account: Account<'info, MarginAccount>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = market,
    )]
    pub position: Account<'info, Position>,
}

pub fn handler(
    ctx: Context<OpenPositionCallback>,
    encrypted_position_data: [u8; 256],
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let margin_account = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;

    // Validate position is in pending state
    require!(
        position.status == PositionStatus::Pending,
        ShadowPerpError::InvalidAccountData
    );

    // Store the encrypted position data from MPC
    // This includes the validated and processed position parameters
    position.encrypted_data = encrypted_position_data;
    position.status = PositionStatus::Open;

    // The MPC has validated margin requirements
    // Lock the required margin in the margin account
    // NOTE: The actual margin amount would be passed from MPC in production
    // For now, we use a placeholder
    let required_margin = margin_account.balance / 2; // Placeholder

    margin_account.locked_balance = margin_account
        .locked_balance
        .checked_add(required_margin)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    position.margin = required_margin;

    // Increment active positions counter
    market.active_positions = market
        .active_positions
        .checked_add(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    margin_account.positions_opened = margin_account
        .positions_opened
        .checked_add(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    let clock = Clock::get()?;

    emit!(PositionOpened {
        owner: position.owner,
        position: position.key(),
        market: market.key(),
        margin: position.margin,
        timestamp: clock.unix_timestamp,
    });

    msg!("Position opened successfully");
    msg!("Position: {}", position.key());
    msg!("Margin locked: {}", position.margin);
    // Note: Size, leverage, direction are NOT logged - they remain private

    Ok(())
}
