use crate::{ID, ID_CONST};
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{MarginAccount, Market, Position, PositionStatus};

/// Callback account for receiving liquidation decision from MPC.
/// Token transfer is deferred to a separate `settle_liquidation` instruction
/// so that this callback only needs 3 custom accounts (within Arcium's comp-account budget).
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

    // Custom callback accounts (3 only — reduced from 6)
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

/// Handler logic for the check_liquidation callback (called from lib.rs via #[arcium_callback]).
/// Updates state only — token settlement is handled by `settle_liquidation`.
pub fn check_liquidation_callback_handler(
    ctx: Context<CheckLiquidationCallback>,
    output: SignedComputationOutputs<CheckLiquidationOutput>,
) -> Result<()> {
    // Split verification into raw-signature verification and typed deserialization
    // so we can tell whether failures are caused by BLS/signature checks or by
    // output-shape drift between the finalized comp-def and the Rust output type.
    let raw_output = match output.verify_output_raw(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(bytes) => bytes,
        Err(error) => {
            msg!(
                "MPC raw verify failed for position {}: {}",
                ctx.accounts.position.key(),
                error
            );
            return Err(ShadowPerpError::InvalidComputationResult.into());
        }
    };

    let verified_output = match CheckLiquidationOutput::try_from_slice(&raw_output) {
        Ok(output) => output,
        Err(error) => {
            msg!(
                "MPC output deserialize failed for position {}: raw_len={}, expected_size={}, error={}",
                ctx.accounts.position.key(),
                raw_output.len(),
                <CheckLiquidationOutput as HasSize>::SIZE,
                error
            );
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

    // Verify the callback is consuming the exact computation that was authorised.
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
    position.consume_pending_computation(ctx.accounts.computation_account.key())?;

    // Extract revealed liquidation decision.
    let should_liquidate = verified_output.field_0.field_0;
    let revealed_margin = verified_output.field_0.field_1;
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
    let margin = if revealed_margin > 0 {
        revealed_margin
    } else {
        position.margin
    };
    require!(margin > 0, ShadowPerpError::InvalidComputationResult);
    margin_account.unlock_margin(position.margin_mode(), margin)?;

    // Calculate liquidation penalty (5% to liquidator, rest returned).
    let liquidation_penalty = margin
        .checked_mul(5)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?
        .checked_div(100)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    let remaining = margin
        .checked_sub(liquidation_penalty)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
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

    // Store liquidation penalty for settle instruction to transfer.
    // margin = amount to transfer to liquidator, requested_margin = original locked margin.
    position.margin = liquidation_penalty;
    position.requested_margin = margin;
    position.realized_pnl = -(liquidation_penalty as i64);
    position.status = PositionStatus::LiquidatedPendingSettlement;
    position.closed_at = clock.unix_timestamp;

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

    Ok(())
}
