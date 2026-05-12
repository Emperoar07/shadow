use crate::{ID, ID_CONST};
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{CommitmentTree, ShieldedMarginRef, ShieldedPool};

const COMP_DEF_OFFSET_LOCK_MARGIN_PRIVATE: u32 = comp_def_offset("lock_margin_private");

/// Callback accounts for the lock_margin_private MPC computation.
#[callback_accounts("lock_margin_private")]
#[derive(Accounts)]
pub struct LockMarginPrivateCallback<'info> {
    // Standard Arcium callback accounts — address constraints required by #[callback_accounts] macro
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_LOCK_MARGIN_PRIVATE))]
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
        seeds = [b"commitment_tree", shielded_pool.market.as_ref()],
        bump = commitment_tree.bump,
        constraint = commitment_tree.pool == shielded_pool.key() @ ShadowPerpError::InvalidAccountData,
    )]
    pub commitment_tree: Box<Account<'info, CommitmentTree>>,

    #[account(
        mut,
        seeds = [b"shielded_margin", shielded_pool.key().as_ref(), shielded_margin_ref.owner.as_ref()],
        bump = shielded_margin_ref.bump,
        constraint = shielded_margin_ref.pool == shielded_pool.key() @ ShadowPerpError::InvalidAccountData,
    )]
    pub shielded_margin_ref: Box<Account<'info, ShieldedMarginRef>>,
}

/// Handler for the lock_margin_private callback.
/// Circuit returns (bool, Enc<Mxe, u64>, u64): (valid, enc_new_balance, locked_margin).
pub fn lock_margin_private_callback_handler(
    ctx: Context<LockMarginPrivateCallback>,
    output: SignedComputationOutputs<LockMarginPrivateOutput>,
) -> Result<()> {
    let verified_output = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(o) => o,
        Err(error) => {
            msg!(
                "MPC verify failed for lock_margin_private: {}",
                error
            );
            return Err(ShadowPerpError::InvalidComputationResult.into());
        }
    };

    let pool = &mut ctx.accounts.shielded_pool;
    let tree = &mut ctx.accounts.commitment_tree;
    let margin_ref = &mut ctx.accounts.shielded_margin_ref;

    // Bind callback to the exact computation queued for this margin ref so a
    // back-to-back queue cannot finalise state for the wrong computation.
    require!(
        margin_ref.pending_computation_account == ctx.accounts.computation_account.key(),
        ShadowPerpError::InvalidAccountData
    );

    // Extract circuit outputs: (valid, enc_new_balance, locked_margin)
    let valid = verified_output.field_0.field_0;

    // Read the 32-byte ciphertext instead of a plaintext u64
    let enc_new_balance = verified_output.field_0.field_1.ciphertexts[0];
    let locked_margin = verified_output.field_0.field_2;

    require!(valid, ShadowPerpError::InvalidComputationResult);
    require!(locked_margin > 0, ShadowPerpError::InsufficientMargin);

    // Update the commitment tree with a new root reflecting the balance change.
    // FIX: We now hash the ciphertext directly to maintain privacy!
    let new_commitment = CommitmentTree::compute_next_root(
        &margin_ref.commitment,
        &enc_new_balance,
    );
    let new_root = CommitmentTree::compute_next_root(&pool.tree_root, &new_commitment);
    tree.push_root(new_root);
    pool.tree_root = new_root;

    // Update margin ref to reflect the new commitment state
    margin_ref.commitment = new_commitment;
    margin_ref.pending_computation_account = Pubkey::default();

    pool.updated_at = Clock::get()?.unix_timestamp;

    msg!(
        "lock_margin_private callback: locked {} margin, new_balance={}",
        locked_margin,
        new_balance
    );

    Ok(())
}
