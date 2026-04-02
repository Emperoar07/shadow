use crate::{ID, ID_CONST};
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{PendingWithdrawal, ShieldedPool};

const COMP_DEF_OFFSET_VERIFY_WITHDRAWAL_PROOF: u32 =
    comp_def_offset("verify_withdrawal_proof");

/// Callback accounts for the verify_withdrawal_proof MPC computation.
#[callback_accounts("verify_withdrawal_proof")]
#[derive(Accounts)]
pub struct VerifyWithdrawalProofCallback<'info> {
    // Standard Arcium callback accounts
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_VERIFY_WITHDRAWAL_PROOF))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: Validated by Arcium
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: Instructions sysvar
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    // Custom callback accounts
    #[account(
        mut,
        seeds = [b"shielded_pool", shielded_pool.market.as_ref()],
        bump = shielded_pool.bump,
    )]
    pub shielded_pool: Box<Account<'info, ShieldedPool>>,

    #[account(
        mut,
        seeds = [
            b"pending_withdrawal",
            shielded_pool.key().as_ref(),
            pending_withdrawal.nullifier.as_ref(),
        ],
        bump = pending_withdrawal.bump,
        constraint = pending_withdrawal.pool == shielded_pool.key() @ ShadowPerpError::InvalidAccountData,
        constraint = !pending_withdrawal.finalized @ ShadowPerpError::NullifierAlreadySpent,
        // Reject re-verification once proof has already been accepted.
        constraint = !pending_withdrawal.proof_verified @ ShadowPerpError::InvalidComputationResult,
    )]
    pub pending_withdrawal: Box<Account<'info, PendingWithdrawal>>,
}

/// Handler for the verify_withdrawal_proof callback.
/// Circuit returns (bool, u64): (valid, verified_amount).
pub fn verify_withdrawal_proof_callback_handler(
    ctx: Context<VerifyWithdrawalProofCallback>,
    output: SignedComputationOutputs<VerifyWithdrawalProofOutput>,
) -> Result<()> {
    let verified_output = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(o) => o,
        Err(error) => {
            msg!(
                "MPC verify failed for verify_withdrawal_proof: {}",
                error
            );
            return Err(ShadowPerpError::InvalidComputationResult.into());
        }
    };

    // Extract circuit outputs: (valid, verified_amount)
    let valid = verified_output.field_0.field_0;
    let verified_amount = verified_output.field_0.field_1;

    require!(valid, ShadowPerpError::InvalidComputationResult);

    let withdrawal = &mut ctx.accounts.pending_withdrawal;

    // Ensure the MPC-verified amount matches what was requested.
    // This closes the gap where a caller could have requested more than they own.
    require!(
        verified_amount == withdrawal.amount,
        ShadowPerpError::InvalidComputationResult
    );

    // Mark the withdrawal as proof-verified. finalize_withdraw will check this
    // flag in addition to the time-lock before releasing funds.
    withdrawal.proof_verified = true;

    ctx.accounts.shielded_pool.updated_at = Clock::get()?.unix_timestamp;

    msg!(
        "verify_withdrawal_proof callback: proof valid, amount={} approved",
        verified_amount
    );

    Ok(())
}
