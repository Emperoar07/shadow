use crate::{ID, ID_CONST};
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{MarginAccount, Market, Position, PositionOpened, PositionStatus};

/// Callback account for storing validated position data from MPC
#[callback_accounts("open_position")]
#[derive(Accounts)]
pub struct OpenPositionCallback<'info> {
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

/// Handler logic for the open_position callback (called from lib.rs via #[arcium_callback])
pub fn open_position_callback_handler(
    ctx: Context<OpenPositionCallback>,
    output: SignedComputationOutputs<OpenPositionOutput>,
) -> Result<()> {
    // Verify the computation output from the MPC cluster
    let verified_output = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(o) => o,
        Err(_) => return Err(ShadowPerpError::InvalidComputationResult.into()),
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
        ctx.accounts.computation_account.key() == position.pending_computation_account,
        ShadowPerpError::Unauthorized
    );
    // Clear the binding so it cannot be consumed a second time.
    position.pending_computation_account = Pubkey::default();

    // Enforce MPC validation outcome.
    // Circuit returns tuple → wrapped in OutputStruct0: field_0=bool, field_1=encrypted, field_2=u64
    let result = &verified_output.field_0;
    require!(result.field_0, ShadowPerpError::InvalidComputationResult);

    // field_1: encrypted (position, open_interest) payload
    // field_2: required margin returned by MPC
    let combined_ciphertexts = &result.field_1.ciphertexts;
    let required_margin = result.field_2;

    // Update position with MPC-validated encrypted data
    // The MPC has verified margin sufficiency and parameter validity
    position.status = PositionStatus::Open;

    // Bind on-chain locked collateral to MPC-calculated requirement.
    // During pending->open we still keep an explicit user-provided cap
    // (`requested_margin`) to prevent unexpected lock expansion.
    require!(
        required_margin == position.requested_margin,
        ShadowPerpError::InvalidComputationResult
    );
    let available_margin = margin_account
        .balance
        .checked_sub(margin_account.locked_balance)
        .ok_or(ShadowPerpError::InsufficientMargin)?;
    require!(
        available_margin >= required_margin,
        ShadowPerpError::InsufficientMargin
    );

    margin_account.locked_balance = margin_account
        .locked_balance
        .checked_add(required_margin)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Privacy hardening:
    // do not persist active locked collateral in plaintext position state.
    // Close/liquidation callbacks read margin from MPC outputs.
    position.margin = 0;
    // The requested margin is only needed during pending->open transition.
    position.requested_margin = 0;

    // Replace encrypted position payload with MPC-produced ciphertexts.
    // Require exactly 9 elements (7 position fields + 2 OI fields).
    require!(
        combined_ciphertexts.len() == 9,
        ShadowPerpError::InvalidComputationResult
    );
    position.encrypted_data[0..32].copy_from_slice(&combined_ciphertexts[0]);
    position.encrypted_data[32..64].copy_from_slice(&combined_ciphertexts[1]);
    position.encrypted_data[64..96].copy_from_slice(&combined_ciphertexts[2]);
    position.encrypted_data[96..128].copy_from_slice(&combined_ciphertexts[3]);
    position.encrypted_data[128..160].copy_from_slice(&combined_ciphertexts[4]);
    position.encrypted_data[160..192].copy_from_slice(&combined_ciphertexts[5]);
    position.encrypted_data[192..224].copy_from_slice(&combined_ciphertexts[6]);

    // Update encrypted open interest from combined MPC output (last 2 ciphertexts).
    // Lengths already validated in the loop above.
    market.encrypted_total_long_oi = combined_ciphertexts[7];
    market.encrypted_total_short_oi = combined_ciphertexts[8];

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
