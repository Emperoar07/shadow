use anchor_lang::prelude::*;

use crate::errors::ShadowPerpError;
use crate::state::{Market, MarginAccount, Position, PositionLiquidated, PositionStatus};

#[derive(Accounts)]
pub struct LiquidationCallback<'info> {
    /// Arcium callback authority
    /// CHECK: Must be the Arcium program callback
    pub callback_authority: Signer<'info>,

    /// Liquidator who initiated the check
    /// CHECK: Receives liquidation reward
    #[account(mut)]
    pub liquidator: UncheckedAccount<'info>,

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
    ctx: Context<LiquidationCallback>,
    should_liquidate: bool,
    liquidation_price: u64,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let margin_account = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;
    let clock = Clock::get()?;

    // If position should not be liquidated, just return
    if !should_liquidate {
        msg!("Position health factor above liquidation threshold");
        msg!("Position: {}", position.key());
        return Ok(());
    }

    // Validate position is open
    require!(
        position.status == PositionStatus::Open,
        ShadowPerpError::PositionNotOpen
    );

    // LIQUIDATION OCCURS
    // Note: The health factor that triggered this is NEVER revealed
    // Only the fact that liquidation occurred is public
    position.status = PositionStatus::Liquidated;
    position.closed_at = clock.unix_timestamp;

    // Unlock margin (will be distributed to liquidator and protocol)
    let margin = position.margin;
    margin_account.locked_balance = margin_account
        .locked_balance
        .checked_sub(margin)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Calculate liquidation penalty (e.g., 5% to liquidator, rest returned)
    let liquidation_penalty = margin / 20; // 5%
    let remaining = margin.checked_sub(liquidation_penalty).unwrap_or(0);

    // Return remaining to user's margin balance
    margin_account.balance = margin_account
        .balance
        .checked_sub(margin)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?
        .checked_add(remaining)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Record as loss for the user
    position.realized_pnl = -(liquidation_penalty as i64);
    margin_account.total_realized_pnl = margin_account
        .total_realized_pnl
        .checked_sub(liquidation_penalty as i64)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    margin_account.positions_closed = margin_account
        .positions_closed
        .checked_add(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Decrement active positions
    market.active_positions = market
        .active_positions
        .checked_sub(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // TODO: Transfer liquidation reward to liquidator via CPI

    emit!(PositionLiquidated {
        owner: position.owner,
        position: position.key(),
        liquidation_price,
        timestamp: clock.unix_timestamp,
    });

    msg!("Position liquidated");
    msg!("Position: {}", position.key());
    msg!("Liquidation price: {}", liquidation_price);
    msg!("Liquidation penalty: {}", liquidation_penalty);
    // Note: Position size, leverage, entry price remain PRIVATE even after liquidation

    Ok(())
}
