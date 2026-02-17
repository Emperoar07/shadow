use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use arcium_anchor::prelude::*;

use crate::errors::ShadowPerpError;
use crate::state::{Market, MarginAccount, Position, PositionLiquidated, PositionStatus};

/// Callback account for receiving liquidation decision from MPC
#[callback_accounts("check_liquidation")]
#[derive(Accounts)]
pub struct CheckLiquidationCallback<'info> {
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

    /// Liquidator who initiated the check
    /// CHECK: Receives liquidation reward
    pub liquidator: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = liquidator_token_account.owner == liquidator.key(),
        constraint = liquidator_token_account.mint == market.collateral_mint
    )]
    pub liquidator_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"margin", market.key().as_ref(), position.owner.as_ref()],
        bump = margin_account.bump,
    )]
    pub margin_account: Account<'info, MarginAccount>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        constraint = vault.key() == market.vault
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Auto-generated output type from the check_liquidation circuit
/// Returns: LiquidationResult (REVEALED - should_liquidate bool, liquidation_price)
/// The health factor is NEVER revealed - only the boolean decision
pub type LiquidationCheckOutput = CheckLiquidationCallbackOutput;

#[arcium_callback(encrypted_ix = "check_liquidation")]
pub fn handler(
    ctx: Context<CheckLiquidationCallback>,
    output: SignedComputationOutputs<LiquidationCheckOutput>,
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

    // Extract revealed liquidation decision
    // CRITICAL: Only the boolean is revealed, NOT the health factor
    let should_liquidate = verified_output.field_0.field_0;
    let liquidation_price = verified_output.field_0.field_1;

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

    // Calculate liquidation penalty (5% to liquidator, rest returned)
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

    // Pay liquidation reward from the market vault to the liquidator.
    if liquidation_penalty > 0 {
        let seeds = &[b"market", market.collateral_mint.as_ref(), &[market.bump]];
        let signer_seeds = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.liquidator_token_account.to_account_info(),
                authority: market.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, liquidation_penalty)?;
    }

    emit!(PositionLiquidated {
        owner: position.owner,
        position: position.key(),
        liquidation_price,
        timestamp: clock.unix_timestamp,
    });

    msg!("Position liquidated via MPC callback");
    msg!("Position: {}", position.key());
    msg!("Liquidation price: {}", liquidation_price);
    msg!("Liquidation penalty: {}", liquidation_penalty);
    // Note: Position size, leverage, entry price remain PRIVATE even after liquidation

    Ok(())
}
