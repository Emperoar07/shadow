use crate::{ID, ID_CONST};
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{MarginAccount, Market, Position, PositionStatus};

/// Callback account for receiving PnL result from MPC.
/// Token transfer is deferred to a separate `settle_close_position` instruction
/// so that this callback only needs 3 custom accounts (within Arcium's comp-account budget).
#[callback_accounts("close_position_v2")]
#[derive(Accounts)]
pub struct ClosePositionV2Callback<'info> {
    // Standard Arcium callback accounts
    pub arcium_program: Program<'info, Arcium>,
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: Validated by Arcium
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account: Box<Account<'info, Cluster>>,
    /// CHECK: Instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    // Custom callback accounts (3 only — reduced from 5)
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

    #[account(
        mut,
        seeds = [b"margin", market.key().as_ref(), position.owner.as_ref()],
        bump = margin_account.bump,
    )]
    pub margin_account: Box<Account<'info, MarginAccount>>,
}

/// Handler logic for the close_position callback (called from lib.rs via #[arcium_callback]).
/// Updates state only — token settlement is handled by `settle_close_position`.
pub fn close_position_callback_handler(
    ctx: Context<ClosePositionV2Callback>,
    output: SignedComputationOutputs<ClosePositionV2Output>,
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
        ctx.accounts.comp_def_account.key() == ctx.accounts.market.close_position_comp_def,
        ShadowPerpError::Unauthorized
    );

    let market = &mut ctx.accounts.market;
    let margin_account = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;
    let clock = Clock::get()?;

    // Validate position is in closing state
    require!(
        position.status == PositionStatus::Closing,
        ShadowPerpError::InvalidAccountData
    );

    // Verify the callback is consuming the exact computation that was authorised for this
    // close request. Prevents replay.
    require!(
        position.pending_computation_account != Pubkey::default(),
        ShadowPerpError::InvalidAccountData
    );
    require!(
        position.pending_callback_seq() > 0,
        ShadowPerpError::InvalidAccountData
    );
    require!(
        position.pending_callback_kind() == Position::CALLBACK_KIND_CLOSE,
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
    // Consume the binding so this callback result cannot be replayed.
    position.consume_pending_computation(ctx.accounts.computation_account.key())?;

    // Settlement outputs from MPC.
    // Circuit returns (i64, u64, u64, u64):
    //   field_0: i64 (realized_pnl), field_1: u64 (settlement), field_2: u64 (fee),
    //   field_3: u64 (locked_margin)
    let realized_pnl = verified_output.field_0.field_0;
    let settlement_amount = verified_output.field_0.field_1;
    let fee = verified_output.field_0.field_2;
    let revealed_locked_margin = verified_output.field_0.field_3;
    let locked_margin = if revealed_locked_margin > 0 {
        revealed_locked_margin
    } else {
        position.margin
    };
    require!(locked_margin > 0, ShadowPerpError::InvalidComputationResult);

    // Update position — PnL is now public.
    // Store settlement_amount in `margin` for the settle instruction to read.
    position.realized_pnl = realized_pnl;
    position.status = PositionStatus::ClosedPendingSettlement;
    position.closed_at = clock.unix_timestamp;
    position.margin = settlement_amount;
    position.requested_margin = locked_margin;

    // Unlock margin in the position's margin bucket (cross/isolated).
    margin_account.unlock_margin(position.margin_mode(), locked_margin)?;

    // Privacy hardening: avoid exposing cumulative realised PnL as public account state.
    margin_account.total_realized_pnl = 0;

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

    // Update margin balance (deduct locked, add settlement)
    margin_account.balance = margin_account
        .balance
        .checked_sub(locked_margin)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?
        .checked_add(settlement_amount)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    Ok(())
}
