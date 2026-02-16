use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::ShadowPerpError;
use crate::state::{Market, MarginAccount, Position, PositionClosed, PositionStatus};

#[derive(Accounts)]
pub struct ClosePositionCallback<'info> {
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

    /// Position owner's token account for settlement
    #[account(
        mut,
        constraint = owner_token_account.mint == market.collateral_mint
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        constraint = vault.key() == market.vault
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<ClosePositionCallback>,
    realized_pnl: i64,
    settlement_amount: u64,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let margin_account = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;
    let clock = Clock::get()?;

    // Validate position is in closing state
    require!(
        position.status == PositionStatus::Closing,
        ShadowPerpError::InvalidAccountData
    );

    // THIS IS THE KEY PRIVACY MOMENT:
    // The realized_pnl is revealed ONLY now, at position close
    // All position details (size, entry, leverage) remain encrypted forever
    position.realized_pnl = realized_pnl;
    position.status = PositionStatus::Closed;
    position.closed_at = clock.unix_timestamp;

    // Unlock margin
    margin_account.locked_balance = margin_account
        .locked_balance
        .checked_sub(position.margin)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Update margin account PnL tracking
    margin_account.total_realized_pnl = margin_account
        .total_realized_pnl
        .checked_add(realized_pnl)
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

    // Transfer settlement amount to user
    if settlement_amount > 0 {
        let seeds = &[
            b"market",
            market.collateral_mint.as_ref(),
            &[market.bump],
        ];
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

        // Update margin balance
        margin_account.balance = margin_account
            .balance
            .checked_sub(position.margin)
            .ok_or(ShadowPerpError::ArithmeticOverflow)?
            .checked_add(settlement_amount)
            .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    }

    emit!(PositionClosed {
        owner: position.owner,
        position: position.key(),
        realized_pnl,  // THIS is revealed
        settlement_amount,
        timestamp: clock.unix_timestamp,
    });

    msg!("Position closed successfully");
    msg!("Position: {}", position.key());
    msg!("Realized PnL: {}", realized_pnl);  // Only PnL revealed
    msg!("Settlement amount: {}", settlement_amount);

    Ok(())
}
