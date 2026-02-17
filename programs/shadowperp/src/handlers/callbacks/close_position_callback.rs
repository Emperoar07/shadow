use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{Market, MarginAccount, Position, PositionClosed, PositionStatus};

/// Callback account for receiving PnL result from MPC
#[callback_accounts("close_position")]
#[derive(Accounts)]
pub struct ClosePositionCallback<'info> {
    // Standard Arcium callback accounts
    pub arcium_program: Program<'info, Arcium>,
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: Validated by Arcium
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: Instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    // Custom callback accounts
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = market,
    )]
    pub position: Account<'info, Position>,

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

    /// Position owner's token account for settlement
    #[account(
        mut,
        constraint = owner_token_account.owner == position.owner,
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

/// Handler logic for the close_position callback (called from lib.rs via #[arcium_callback])
pub fn close_position_callback_handler(
    ctx: Context<ClosePositionCallback>,
    output: SignedComputationOutputs<ClosePositionOutput>,
) -> Result<()> {
    // Verify the computation output from the MPC cluster
    let verified_output = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(o) => o,
        Err(_) => return Err(ShadowPerpError::InvalidComputationResult.into()),
    };

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
    // Circuit returns tuple → wrapped in OutputStruct0:
    //   field_0 = ClosePositionOutputStruct00 {field_0: i64, field_1: u64, field_2: u64}
    //   field_1 = MXEEncryptedStruct<2> (updated OI)
    let realized_pnl = verified_output.field_0;
    let settlement_amount = verified_output.field_1;
    let fee = verified_output.field_2;

    // Update position - PnL is now public
    position.realized_pnl = realized_pnl;
    position.status = PositionStatus::Closed;
    position.closed_at = clock.unix_timestamp;

    // Update encrypted open interest from MPC output
    let oi_ciphertexts = &verified_output.field_3.ciphertexts;
    if oi_ciphertexts.len() >= 2 {
        market.encrypted_total_long_oi = oi_ciphertexts[0];
        market.encrypted_total_short_oi = oi_ciphertexts[1];
    }

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

    // Collect trading fees
    market.total_fees_collected = market
        .total_fees_collected
        .checked_add(fee)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Decrement active positions
    market.active_positions = market
        .active_positions
        .checked_sub(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    let updated_balance = margin_account
        .balance
        .checked_sub(position.margin)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?
        .checked_add(settlement_amount)
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
    }
    margin_account.balance = updated_balance;

    emit!(PositionClosed {
        owner: position.owner,
        position: position.key(),
        realized_pnl,  // THIS is the only data revealed
        settlement_amount,
        timestamp: clock.unix_timestamp,
    });

    msg!("Position closed via MPC callback - PnL revealed");
    msg!("Position: {}", position.key());
    msg!("Realized PnL: {}", realized_pnl);
    msg!("Settlement: {}", settlement_amount);
    msg!("Fee: {}", fee);

    Ok(())
}
