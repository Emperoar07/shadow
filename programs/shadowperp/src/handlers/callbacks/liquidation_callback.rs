use crate::{ID, ID_CONST};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{MarginAccount, Market, Position, PositionLiquidated, PositionStatus};

/// Callback account for receiving liquidation decision from MPC
#[callback_accounts("check_liquidation")]
#[derive(Accounts)]
pub struct CheckLiquidationCallback<'info> {
    // Standard Arcium callback accounts
    pub arcium_program: Program<'info, Arcium>,
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: Validated by Arcium
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account: Box<Account<'info, Cluster>>,
    /// CHECK: Instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    // Custom callback accounts
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = market,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    /// Liquidator who initiated the check
    /// CHECK: Receives liquidation reward
    pub liquidator: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = liquidator_token_account.owner == liquidator.key(),
        constraint = liquidator_token_account.mint == market.collateral_mint
    )]
    pub liquidator_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"margin", market.key().as_ref(), position.owner.as_ref()],
        bump = margin_account.bump,
    )]
    pub margin_account: Box<Account<'info, MarginAccount>>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        constraint = vault.key() == market.vault
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

/// Handler logic for the check_liquidation callback (called from lib.rs via #[arcium_callback])
pub fn check_liquidation_callback_handler(
    ctx: Context<CheckLiquidationCallback>,
    output: SignedComputationOutputs<CheckLiquidationOutput>,
) -> Result<()> {
    // Verify the computation output from the MPC cluster
    let verified_output = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(o) => o,
        Err(_) => {
            msg!("MPC verify failed for position {}", ctx.accounts.position.key());
            return Err(ShadowPerpError::InvalidComputationResult.into());
        }
    };

    // Callback must be bound to this market's configured Arcium cluster + comp-def.
    require!(
        ctx.accounts.cluster_account.key() == ctx.accounts.market.mxe_cluster,
        ShadowPerpError::Unauthorized
    );
    require!(
        ctx.accounts.comp_def_account.key() == ctx.accounts.market.liquidation_comp_def,
        ShadowPerpError::Unauthorized
    );

    let market = &mut ctx.accounts.market;
    let margin_account = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;
    let clock = Clock::get()?;

    // Verify the callback is consuming the exact computation that was authorised
    // for this liquidation check.
    require!(
        position.pending_computation_account != Pubkey::default(),
        ShadowPerpError::InvalidAccountData
    );
    require!(
        position.pending_callback_seq() > 0,
        ShadowPerpError::InvalidAccountData
    );
    require!(
        position.pending_callback_kind() == Position::CALLBACK_KIND_LIQUIDATION,
        ShadowPerpError::InvalidAccountData
    );
    let expected_computation_account = derive_comp_pda!(
        position.pending_computation_offset(),
        ctx.accounts.mxe_account,
        ErrorCode::ClusterNotSet
    );
    require!(
        expected_computation_account == position.pending_computation_account,
        ShadowPerpError::InvalidAccountData
    );
    // Clear the binding immediately even if liquidation does not occur.
    // The computation is consumed and must not be reusable.
    position.consume_pending_computation(ctx.accounts.computation_account.key())?;

    // Extract revealed liquidation decision.
    // Health factor remains private in MPC output.
    let should_liquidate = verified_output.field_0.field_0;
    let revealed_margin = verified_output.field_0.field_1;
    // Migration compatibility:
    // use revealed margin when present; fall back to legacy persisted value.
    // liquidation_price is deliberately not stored or emitted.
    let _liquidation_price = verified_output.field_0.field_2;

    // If position should not be liquidated, just return
    if !should_liquidate {
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
    let margin = if revealed_margin > 0 {
        revealed_margin
    } else {
        position.margin
    };
    require!(margin > 0, ShadowPerpError::InvalidComputationResult);
    margin_account.unlock_margin(position.margin_mode(), margin)?;

    // Calculate liquidation penalty (5% to liquidator, rest returned).
    // Use multiply-then-divide to avoid integer-division precision loss.
    let liquidation_penalty = margin
        .checked_mul(5)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    let remaining = margin
        .checked_sub(liquidation_penalty)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    // Invariant: the two halves must reconstitute the original margin exactly.
    require!(
        liquidation_penalty
            .checked_add(remaining)
            .ok_or(ShadowPerpError::ArithmeticOverflow)?
            == margin,
        ShadowPerpError::ArithmeticOverflow
    );

    // Return remaining to user's margin balance
    margin_account.balance = margin_account
        .balance
        .checked_sub(margin)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?
        .checked_add(remaining)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Record as loss for the user
    position.realized_pnl = -(liquidation_penalty as i64);
    // Privacy hardening: avoid exposing cumulative realised PnL as public account state.
    margin_account.total_realized_pnl = 0;

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

    position.margin = 0;
    position.requested_margin = 0;

    emit!(PositionLiquidated {
        owner: position.owner,
        position: position.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

