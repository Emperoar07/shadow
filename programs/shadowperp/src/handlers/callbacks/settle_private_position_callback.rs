use crate::{ID, ID_CONST};
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{CommitmentTree, Market, ShieldedMarginRef, ShieldedPool};

const COMP_DEF_OFFSET_SETTLE_PRIVATE_POSITION: u32 = comp_def_offset("settle_private_position");

/// Callback accounts for the settle_private_position MPC computation.
#[callback_accounts("settle_private_position")]
#[derive(Accounts)]
pub struct SettlePrivatePositionCallback<'info> {
    // Standard Arcium callback accounts — address constraints required by #[callback_accounts] macro
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SETTLE_PRIVATE_POSITION))]
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
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"shielded_pool", market.key().as_ref()],
        bump = shielded_pool.bump,
        constraint = shielded_pool.market == market.key() @ ShadowPerpError::InvalidAccountData,
    )]
    pub shielded_pool: Box<Account<'info, ShieldedPool>>,

    #[account(
        mut,
        seeds = [b"commitment_tree", market.key().as_ref()],
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

/// Handler for the settle_private_position callback.
/// Circuit returns (realized_pnl, settlement_amount, fee, new_commitment_lo).
pub fn settle_private_position_callback_handler(
    ctx: Context<SettlePrivatePositionCallback>,
    output: SignedComputationOutputs<SettlePrivatePositionOutput>,
) -> Result<()> {
    let verified_output = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(o) => o,
        Err(error) => {
            msg!(
                "MPC verify failed for settle_private_position: {}",
                error
            );
            return Err(ShadowPerpError::InvalidComputationResult.into());
        }
    };

    // Callback must be bound to this market's configured Arcium cluster and
    // the fixed settle_private_position comp-def PDA.
    require!(
        ctx.accounts.cluster_account.key() == ctx.accounts.market.mxe_cluster,
        ShadowPerpError::Unauthorized
    );
    require!(
        ctx.accounts.comp_def_account.key()
            == derive_comp_def_pda!(COMP_DEF_OFFSET_SETTLE_PRIVATE_POSITION),
        ShadowPerpError::Unauthorized
    );

    let market = &mut ctx.accounts.market;
    let pool = &mut ctx.accounts.shielded_pool;
    let tree = &mut ctx.accounts.commitment_tree;
    let margin_ref = &mut ctx.accounts.shielded_margin_ref;

    // Bind callback to the exact computation queued for this margin ref so a
    // back-to-back queue cannot finalise state for the wrong computation.
    require!(
        margin_ref.pending_computation_account == ctx.accounts.computation_account.key(),
        ShadowPerpError::InvalidAccountData
    );

    // Extract circuit outputs: (realized_pnl, settlement_amount, fee, new_commitment_lo)
    let _realized_pnl = verified_output.field_0.field_0;
    let settlement_amount = verified_output.field_0.field_1;
    let fee = verified_output.field_0.field_2;
    let new_commitment_lo = verified_output.field_0.field_3;

    // Collect trading fees
    market.total_fees_collected = market
        .total_fees_collected
        .checked_add(fee)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Expand the additive-binding commitment scalar into the 32-byte payload
    // used by the on-chain commitment tree.
    let mut commitment_bytes = [0u8; 32];
    commitment_bytes[..8].copy_from_slice(&new_commitment_lo.to_le_bytes());
    let new_commitment = CommitmentTree::compute_next_root(
        &margin_ref.commitment,
        &commitment_bytes,
    );
    let new_root = CommitmentTree::compute_next_root(&pool.tree_root, &new_commitment);
    tree.push_root(new_root);
    pool.tree_root = new_root;

    // Update margin ref
    margin_ref.commitment = new_commitment;
    margin_ref.pending_computation_account = Pubkey::default();

    pool.updated_at = Clock::get()?.unix_timestamp;

    msg!(
        "settle_private_position callback: settlement={}, fee={}",
        settlement_amount,
        fee,
    );

    Ok(())
}
