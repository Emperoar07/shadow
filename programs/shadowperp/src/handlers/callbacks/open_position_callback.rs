use crate::{ID, ID_CONST};
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{MarginAccount, Market, Position, PositionOpened, PositionStatus};

/// Callback account for storing validated position data from MPC
#[callback_accounts("open_position_v2")]
#[derive(Accounts)]
pub struct OpenPositionV2Callback<'info> {
    // Standard Arcium callback accounts
    pub arcium_program: Program<'info, Arcium>,
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: Validated by Arcium
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account: Box<Account<'info, Cluster>>,
    /// CHECK: Instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    // Custom callback accounts - order must match CallbackAccount vec
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
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

pub type OpenPositionV2Output = OpenPositionOutput;

/// Handler logic for the open_position callback (called from lib.rs via #[arcium_callback])
pub fn open_position_callback_handler(
    ctx: Context<OpenPositionV2Callback>,
    output: SignedComputationOutputs<OpenPositionV2Output>,
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
        ctx.accounts.comp_def_account.key() == ctx.accounts.market.open_position_comp_def,
        ShadowPerpError::Unauthorized
    );

    let market = &mut ctx.accounts.market;
    let margin_account = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;

    // Validate position is in pending state
    require!(
        position.status == PositionStatus::Pending,
        ShadowPerpError::InvalidAccountData
    );

    // Verify the callback is consuming the exact computation that was authorised for this
    // position. Prevents replay: output from a different computation (with different/malicious
    // parameters) cannot be applied to this position even if it passes verify_output.
    require!(
        position.pending_computation_account != Pubkey::default(),
        ShadowPerpError::InvalidAccountData
    );
    require!(
        position.pending_callback_seq() > 0,
        ShadowPerpError::InvalidAccountData
    );
    require!(
        position.pending_callback_kind() == Position::CALLBACK_KIND_OPEN,
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

    // Enforce MPC validation outcome.
    // Circuit returns tuple -> wrapped in OutputStruct0:
    // field_0=bool, field_1=encrypted OI.
    let result = &verified_output.field_0;
    require!(result.field_0, ShadowPerpError::InvalidComputationResult);

    // field_1: encrypted open_interest payload
    let oi_ciphertexts = &result.field_1.ciphertexts;

    // Update position with MPC-validated encrypted data
    // The MPC has verified margin sufficiency and parameter validity.
    position.status = PositionStatus::Open;

    // Bind on-chain locked collateral to the user-requested margin.
    // Circuit enforces encrypted_margin == requested_margin.
    let required_margin = position.requested_margin;
    let available_margin = margin_account
        .balance
        .checked_sub(margin_account.locked_balance)
        .ok_or(ShadowPerpError::InsufficientMargin)?;
    require!(
        available_margin >= required_margin,
        ShadowPerpError::InsufficientMargin
    );

    margin_account.lock_margin(position.margin_mode(), required_margin)?;

    // Privacy hardening:
    // do not persist active locked collateral in plaintext position state.
    // Close/liquidation callbacks read margin from MPC outputs.
    position.margin = 0;
    // The requested margin is only needed during pending->open transition.
    position.requested_margin = 0;

    // Open-position inputs were already persisted on position creation.
    // Here we only need OI updates produced by MPC.
    require!(oi_ciphertexts.len() == 2, ShadowPerpError::InvalidComputationResult);
    market.encrypted_total_long_oi = oi_ciphertexts[0];
    market.encrypted_total_short_oi = oi_ciphertexts[1];
    // Persist the MXE-assigned nonce so subsequent computations can pass it back.
    market.oi_nonce = result.field_1.nonce;

    // Increment active positions counter
    market.active_positions = market
        .active_positions
        .checked_add(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    let clock = Clock::get()?;

    emit!(PositionOpened {
        owner: position.owner,
        position: position.key(),
        market: market.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
