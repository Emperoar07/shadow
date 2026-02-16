use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::ShadowPerpError;
use crate::state::{Market, MarginAccount, Position, PositionOpened, PositionStatus};

/// Callback account for storing validated position data from MPC
#[callback_accounts("open_position")]
#[derive(Accounts)]
pub struct OpenPositionCallback<'info> {
    // Standard Arcium callback accounts
    pub arcium_program: Program<'info, Arcium>,
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: Validated by Arcium
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: Instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    // Custom callback accounts - order must match CallbackAccount vec
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
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
}

/// Auto-generated output type from the open_position circuit
/// Returns: (bool success, Enc<Mxe, Position>, u64 required_margin, Enc<Mxe, OpenInterest>)
pub type OpenPositionOutput = OpenPositionCallbackOutput;

#[arcium_callback(encrypted_ix = "open_position")]
pub fn handler(
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

    let market = &mut ctx.accounts.market;
    let margin_account = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;

    // Validate position is in pending state
    require!(
        position.status == PositionStatus::Pending,
        ShadowPerpError::InvalidAccountData
    );

    // Enforce MPC validation outcome.
    require!(
        verified_output.field_0,
        ShadowPerpError::InvalidComputationResult
    );

    // field_1: encrypted position payload
    // field_2: required margin returned by MPC
    // field_3: updated encrypted OI
    let position_ciphertexts = &verified_output.field_1.ciphertexts;
    let required_margin = verified_output.field_2;
    let oi_ciphertexts = &verified_output.field_3.ciphertexts;

    // Update position with MPC-validated encrypted data
    // The MPC has verified margin sufficiency and parameter validity
    position.status = PositionStatus::Open;

    // Bind on-chain locked collateral to MPC-calculated requirement.
    // This prevents divergence between public and encrypted margin paths.
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

    position.margin = required_margin;

    // Replace encrypted position payload with MPC-produced ciphertexts.
    if position_ciphertexts.len() >= 7 {
        position.encrypted_data[0..32].copy_from_slice(&position_ciphertexts[0]);
        position.encrypted_data[32..64].copy_from_slice(&position_ciphertexts[1]);
        position.encrypted_data[64..96].copy_from_slice(&position_ciphertexts[2]);
        position.encrypted_data[96..128].copy_from_slice(&position_ciphertexts[3]);
        position.encrypted_data[128..160].copy_from_slice(&position_ciphertexts[4]);
        position.encrypted_data[160..192].copy_from_slice(&position_ciphertexts[5]);
        position.encrypted_data[192..224].copy_from_slice(&position_ciphertexts[6]);
    } else {
        return Err(ShadowPerpError::InvalidComputationResult.into());
    }

    // Update encrypted open interest from MPC output
    // field_3 contains updated Enc<Mxe, OpenInterest>
    if oi_ciphertexts.len() >= 2 {
        market.encrypted_total_long_oi = oi_ciphertexts[0];
        market.encrypted_total_short_oi = oi_ciphertexts[1];
    }

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

    msg!("Position opened successfully via MPC callback");
    msg!("Position: {}", position.key());
    msg!("Margin locked: {}", position.margin);
    // Note: Size, leverage, direction are NOT logged - they remain private

    Ok(())
}
