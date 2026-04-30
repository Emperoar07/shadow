use crate::ArciumSignerAccount;
use crate::ID;
use crate::ID_CONST;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use arcium_anchor::prelude::*;
use arcium_anchor::traits::CallbackCompAccs;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{
    CommitmentTree, Market, NullifierSet, PendingWithdrawal, ShieldedCollateralFeatureSet,
    ShieldedDeposit, ShieldedMarginRef, ShieldedMarginRefCreated, ShieldedPool,
    ShieldedPoolInitialized, WithdrawalFinalized, WithdrawalRequested,
    SHIELDED_FEATURE_COLLATERAL, WITHDRAWAL_DELAY_SLOTS,
};

use crate::handlers::callbacks::lock_margin_private_callback::LockMarginPrivateCallback;
use crate::handlers::callbacks::settle_private_position_callback::SettlePrivatePositionCallback;

// ---------------------------------------------------------------------------
// init_shielded_pool
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitShieldedPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = authority,
        space = ShieldedPool::LEN,
        seeds = [b"shielded_pool", market.key().as_ref()],
        bump
    )]
    pub shielded_pool: Box<Account<'info, ShieldedPool>>,

    #[account(
        init,
        payer = authority,
        space = NullifierSet::LEN,
        seeds = [b"nullifier_set", market.key().as_ref()],
        bump
    )]
    pub nullifier_set: Box<Account<'info, NullifierSet>>,

    #[account(
        init,
        payer = authority,
        space = CommitmentTree::LEN,
        seeds = [b"commitment_tree", market.key().as_ref()],
        bump
    )]
    pub commitment_tree: Box<Account<'info, CommitmentTree>>,

    pub system_program: Program<'info, System>,
}

pub fn init_shielded_pool_handler(
    ctx: Context<InitShieldedPool>,
    enable_private_collateral: bool,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let slot = clock.slot;
    let market = &ctx.accounts.market;

    // Initialize shielded pool
    let pool = &mut ctx.accounts.shielded_pool;
    pool.market = market.key();
    pool.authority = ctx.accounts.authority.key();
    pool.collateral_mint = market.collateral_mint;
    pool.vault = market.vault;
    pool.tree_root = [0u8; 32];
    pool.total_public_in = 0;
    pool.total_public_out = 0;
    pool.commitment_count = 0;
    pool.feature_flags = if enable_private_collateral {
        SHIELDED_FEATURE_COLLATERAL
    } else {
        0
    };
    pool.created_at = now;
    pool.updated_at = now;
    pool.bump = ctx.bumps.shielded_pool;
    pool.version = ShieldedPool::VERSION;

    // Initialize nullifier set
    let nullifier_set = &mut ctx.accounts.nullifier_set;
    nullifier_set.market = market.key();
    nullifier_set.pool = pool.key();
    nullifier_set.nullifier_count = 0;
    nullifier_set.last_rotation_slot = slot;
    nullifier_set.bump = ctx.bumps.nullifier_set;
    nullifier_set.version = NullifierSet::VERSION;

    // Initialize commitment tree
    let tree = &mut ctx.accounts.commitment_tree;
    tree.pool = pool.key();
    tree.depth = 20; // supports ~1M leaves
    tree.next_index = 0;
    tree.roots = [[0u8; 32]; 16];
    tree.root_index = 0;
    tree.bump = ctx.bumps.commitment_tree;
    tree.version = CommitmentTree::VERSION;

    emit!(ShieldedPoolInitialized {
        market: pool.market,
        authority: pool.authority,
        enabled: pool.collateral_enabled(),
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// set_shielded_collateral_feature
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SetShieldedCollateralFeature<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"shielded_pool", market.key().as_ref()],
        bump = shielded_pool.bump,
        constraint = shielded_pool.market == market.key() @ ShadowPerpError::InvalidAccountData,
        constraint = shielded_pool.authority == authority.key() @ ShadowPerpError::Unauthorized,
    )]
    pub shielded_pool: Box<Account<'info, ShieldedPool>>,
}

pub fn set_shielded_collateral_feature_handler(
    ctx: Context<SetShieldedCollateralFeature>,
    enabled: bool,
) -> Result<()> {
    let pool = &mut ctx.accounts.shielded_pool;
    if enabled {
        pool.feature_flags |= SHIELDED_FEATURE_COLLATERAL;
    } else {
        pool.feature_flags &= !SHIELDED_FEATURE_COLLATERAL;
    }
    pool.updated_at = Clock::get()?.unix_timestamp;

    emit!(ShieldedCollateralFeatureSet {
        market: pool.market,
        authority: pool.authority,
        enabled: pool.collateral_enabled(),
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// deposit_to_shielded
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(amount: u64, commitment: [u8; 32])]
pub struct DepositToShielded<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"shielded_pool", market.key().as_ref()],
        bump = shielded_pool.bump,
        constraint = shielded_pool.market == market.key() @ ShadowPerpError::InvalidAccountData,
        constraint = shielded_pool.collateral_enabled() @ ShadowPerpError::ShieldedNotEnabled,
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
        constraint = user_token_account.owner == depositor.key(),
        constraint = user_token_account.mint == shielded_pool.collateral_mint,
    )]
    pub user_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = vault.key() == shielded_pool.vault @ ShadowPerpError::InvalidAccountData,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn deposit_to_shielded_handler(
    ctx: Context<DepositToShielded>,
    amount: u64,
    commitment: [u8; 32],
) -> Result<()> {
    require!(amount > 0, ShadowPerpError::ZeroAmount);

    let pool = &mut ctx.accounts.shielded_pool;
    let tree = &mut ctx.accounts.commitment_tree;

    // Check tree capacity (2^depth leaves)
    let max_leaves: u64 = 1u64
        .checked_shl(tree.depth as u32)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    require!(tree.next_index < max_leaves, ShadowPerpError::CommitmentTreeFull);

    // SPL transfer from depositor to vault
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, amount)?;

    // Record the commitment leaf
    let leaf_index = tree.next_index;
    tree.next_index = tree
        .next_index
        .checked_add(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Compute new root by hashing previous root with commitment (SHA256).
    let new_root = CommitmentTree::compute_next_root(&pool.tree_root, &commitment);
    tree.push_root(new_root);
    pool.tree_root = new_root;

    // Update pool accounting
    pool.total_public_in = pool
        .total_public_in
        .checked_add(amount)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    pool.commitment_count = pool
        .commitment_count
        .checked_add(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    pool.updated_at = Clock::get()?.unix_timestamp;

    emit!(ShieldedDeposit {
        pool: pool.key(),
        depositor: ctx.accounts.depositor.key(),
        commitment,
        leaf_index,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// request_withdraw_private
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(nullifier: [u8; 32], amount: u64)]
pub struct RequestWithdrawPrivate<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"shielded_pool", market.key().as_ref()],
        bump = shielded_pool.bump,
        constraint = shielded_pool.collateral_enabled() @ ShadowPerpError::ShieldedNotEnabled,
    )]
    pub shielded_pool: Box<Account<'info, ShieldedPool>>,

    #[account(
        mut,
        seeds = [b"nullifier_set", market.key().as_ref()],
        bump = nullifier_set.bump,
        constraint = nullifier_set.pool == shielded_pool.key() @ ShadowPerpError::InvalidAccountData,
    )]
    pub nullifier_set: Box<Account<'info, NullifierSet>>,

    #[account(
        init,
        payer = requester,
        space = PendingWithdrawal::LEN,
        seeds = [b"pending_withdrawal", shielded_pool.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub pending_withdrawal: Box<Account<'info, PendingWithdrawal>>,

    pub system_program: Program<'info, System>,
}

pub fn request_withdraw_private_handler(
    ctx: Context<RequestWithdrawPrivate>,
    nullifier: [u8; 32],
    amount: u64,
) -> Result<()> {
    // Gate: verify_withdrawal_proof has no merkle-path verification (audit 2026-04-29).
    // Releasing funds via this flow lets any caller drain the shielded pool. Disabled
    // until commitments are bound to the tree root inside the MPC circuit.
    require!(false, ShadowPerpError::ShieldedWithdrawalGated);

    require!(amount > 0, ShadowPerpError::ZeroAmount);

    // Basic sanity: reject all-zero nullifier (placeholder / uninitialized)
    require!(
        nullifier != [0u8; 32],
        ShadowPerpError::InvalidAccountData
    );

    // Sanity cap: claimed amount cannot exceed total pool balance.
    // The cryptographic ownership proof is enforced in the next step by
    // verify_withdrawal_proof_request, which queues the Arcium MPC circuit.
    // finalize_withdraw will not release funds until proof_verified is true.
    let pool_balance = ctx.accounts.shielded_pool.total_public_in
        .saturating_sub(ctx.accounts.shielded_pool.total_public_out);
    require!(
        amount <= pool_balance,
        ShadowPerpError::InsufficientBalance
    );

    let clock = Clock::get()?;
    let pool = &mut ctx.accounts.shielded_pool;
    let expiry_slot = clock
        .slot
        .checked_add(WITHDRAWAL_DELAY_SLOTS)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // The PDA init will fail if a PendingWithdrawal with this nullifier already exists,
    // which prevents double-spend at the account level.

    let withdrawal = &mut ctx.accounts.pending_withdrawal;
    withdrawal.pool = pool.key();
    withdrawal.nullifier = nullifier;
    withdrawal.recipient = ctx.accounts.requester.key();
    withdrawal.amount = amount;
    withdrawal.expiry_slot = expiry_slot;
    withdrawal.finalized = false;
    withdrawal.proof_verified = false;
    withdrawal.bump = ctx.bumps.pending_withdrawal;

    pool.updated_at = clock.unix_timestamp;

    emit!(WithdrawalRequested {
        pool: pool.key(),
        nullifier,
        recipient: withdrawal.recipient,
        expiry_slot,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// verify_withdrawal_proof_request
// Queues an Arcium MPC computation to verify the caller's ownership of a
// commitment in the shielded pool before the withdrawal is finalised.
// Must be called after request_withdraw_private and before finalize_withdraw.
// ---------------------------------------------------------------------------

use crate::handlers::callbacks::verify_withdrawal_proof_callback::VerifyWithdrawalProofCallback;

const COMP_DEF_OFFSET_VERIFY_WITHDRAWAL_PROOF_QUEUE: u32 =
    comp_def_offset("verify_withdrawal_proof");

#[queue_computation_accounts("verify_withdrawal_proof", requester)]
#[derive(Accounts)]
#[instruction(
    encrypted_payload: Vec<u8>,
    client_pubkey: [u8; 32],
    nonce: u128,
    computation_offset: u64,
)]
pub struct VerifyWithdrawalProofRequest<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        seeds = [b"shielded_pool", market.key().as_ref()],
        bump = shielded_pool.bump,
        constraint = shielded_pool.collateral_enabled() @ ShadowPerpError::ShieldedNotEnabled,
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
        constraint = pending_withdrawal.recipient == requester.key() @ ShadowPerpError::Unauthorized,
        constraint = !pending_withdrawal.finalized @ ShadowPerpError::NullifierAlreadySpent,
        constraint = !pending_withdrawal.proof_verified @ ShadowPerpError::InvalidComputationResult,
    )]
    pub pending_withdrawal: Box<Account<'info, PendingWithdrawal>>,

    // --- Arcium accounts (populated by queue_computation_accounts macro) ---
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_VERIFY_WITHDRAWAL_PROOF_QUEUE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet),
        constraint = cluster_account.key() == market.mxe_cluster @ ShadowPerpError::Unauthorized
    )]
    pub cluster_account: Box<Account<'info, Cluster>>,
    /// CHECK: Validated by address constraint + Arcium.
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: Validated by address constraint + Arcium.
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub executing_pool: UncheckedAccount<'info>,
    /// CHECK: Validated by address constraint + Arcium.
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub computation_account: UncheckedAccount<'info>,
    /// CHECK: Validated by address constraint + Arcium.
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(
        init_if_needed,
        payer = requester,
        space = 9,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn verify_withdrawal_proof_request_handler(
    ctx: Context<VerifyWithdrawalProofRequest>,
    encrypted_payload: Vec<u8>,
    client_pubkey: [u8; 32],
    nonce: u128,
    computation_offset: u64,
) -> Result<()> {
    // Gate: paired with request_withdraw_private — circuit cannot prove commitment
    // is in the tree without merkle-path verification. See audit 2026-04-29.
    require!(false, ShadowPerpError::ShieldedWithdrawalGated);

    require!(computation_offset > 0, ShadowPerpError::InvalidAccountData);

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let withdrawal = &ctx.accounts.pending_withdrawal;

    // The circuit receives:
    //   secrets: Enc<Shared, (amount, secret, nullifier_lo)>   — 3 × 32 bytes
    require!(encrypted_payload.len() >= 96, ShadowPerpError::InvalidAccountData);

    let mut enc_amount = [0u8; 32];
    let mut enc_secret = [0u8; 32];
    let mut enc_nullifier_lo = [0u8; 32];
    enc_amount.copy_from_slice(&encrypted_payload[0..32]);
    enc_secret.copy_from_slice(&encrypted_payload[32..64]);
    enc_nullifier_lo.copy_from_slice(&encrypted_payload[64..96]);

    // Derive the expected nullifier halves from the on-chain stored nullifier.
    // Protocol invariant: nullifier_hi = 0 (64-bit scheme, upper bytes unused).
    let nullifier_lo_u64 = u64::from_le_bytes(
        withdrawal.nullifier[0..8]
            .try_into()
            .map_err(|_| ShadowPerpError::InvalidAccountData)?,
    );

    let args = ArgBuilder::new()
        // secrets: Enc<Shared, (u64, u64, u64)>
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(enc_amount)
        .encrypted_u64(enc_secret)
        .encrypted_u64(enc_nullifier_lo)
        // claimed_amount: plaintext from the pending withdrawal record
        .plaintext_u64(withdrawal.amount)
        // expected_nullifier_lo: first 8 bytes of the stored nullifier
        .plaintext_u64(nullifier_lo_u64)
        // expected_nullifier_hi: always 0 for the 64-bit scheme
        .plaintext_u64(0u64)
        .build();

    let callback_accounts = vec![
        CallbackAccount {
            pubkey: ctx.accounts.shielded_pool.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: withdrawal.key(),
            is_writable: true,
        },
    ];

    let callback_ix = VerifyWithdrawalProofCallback::callback_ix(
        computation_offset,
        &ctx.accounts.mxe_account,
        &callback_accounts,
    )?;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![callback_ix],
        1,
        0,
    )?;

    msg!(
        "verify_withdrawal_proof_request: queued computation offset={}, nullifier_lo={}",
        computation_offset,
        nullifier_lo_u64,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// finalize_withdraw
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct FinalizeWithdraw<'info> {
    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"shielded_pool", market.key().as_ref()],
        bump = shielded_pool.bump,
        constraint = shielded_pool.collateral_enabled() @ ShadowPerpError::ShieldedNotEnabled,
    )]
    pub shielded_pool: Box<Account<'info, ShieldedPool>>,

    #[account(
        mut,
        seeds = [b"nullifier_set", market.key().as_ref()],
        bump = nullifier_set.bump,
        constraint = nullifier_set.pool == shielded_pool.key() @ ShadowPerpError::InvalidAccountData,
    )]
    pub nullifier_set: Box<Account<'info, NullifierSet>>,

    #[account(
        mut,
        seeds = [b"pending_withdrawal", shielded_pool.key().as_ref(), pending_withdrawal.nullifier.as_ref()],
        bump = pending_withdrawal.bump,
        constraint = pending_withdrawal.pool == shielded_pool.key() @ ShadowPerpError::InvalidAccountData,
        constraint = pending_withdrawal.recipient == recipient.key() @ ShadowPerpError::Unauthorized,
        constraint = !pending_withdrawal.finalized @ ShadowPerpError::NullifierAlreadySpent,
    )]
    pub pending_withdrawal: Box<Account<'info, PendingWithdrawal>>,

    #[account(
        mut,
        constraint = recipient_token_account.owner == recipient.key(),
        constraint = recipient_token_account.mint == shielded_pool.collateral_mint,
    )]
    pub recipient_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = vault.key() == shielded_pool.vault @ ShadowPerpError::InvalidAccountData,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA authority for the shared collateral vault.
    #[account(
        seeds = [b"shared_vault_authority", market.collateral_mint.as_ref()],
        bump
    )]
    pub shared_vault_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn finalize_withdraw_handler(ctx: Context<FinalizeWithdraw>) -> Result<()> {
    // Gate: paired with request_withdraw_private. The proof_verified flag is only set
    // by verify_withdrawal_proof_callback consuming a circuit that does not bind
    // (amount, secret) to the merkle tree root. See audit 2026-04-29.
    require!(false, ShadowPerpError::ShieldedWithdrawalGated);

    let clock = Clock::get()?;
    let withdrawal = &mut ctx.accounts.pending_withdrawal;

    // Require MPC proof to be verified before funds can be released
    require!(
        withdrawal.proof_verified,
        ShadowPerpError::WithdrawalNotReady
    );

    // Ensure delay period has passed
    require!(
        clock.slot >= withdrawal.expiry_slot,
        ShadowPerpError::WithdrawalNotReady
    );

    let amount = withdrawal.amount;
    let market = &ctx.accounts.market;
    let pool = &mut ctx.accounts.shielded_pool;
    let nullifier_set = &mut ctx.accounts.nullifier_set;

    // Mark nullifier as spent
    nullifier_set.nullifier_count = nullifier_set
        .nullifier_count
        .checked_add(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Transfer from the shared collateral vault to the recipient.
    let (_shared_vault_authority, shared_vault_authority_bump) = Pubkey::find_program_address(
        &[b"shared_vault_authority", market.collateral_mint.as_ref()],
        ctx.program_id,
    );
    let seeds = &[
        b"shared_vault_authority" as &[u8],
        market.collateral_mint.as_ref(),
        &[shared_vault_authority_bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.shared_vault_authority.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, amount)?;

    // Update pool accounting
    pool.total_public_out = pool
        .total_public_out
        .checked_add(amount)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    pool.updated_at = clock.unix_timestamp;

    // Mark withdrawal as finalized
    withdrawal.finalized = true;

    emit!(WithdrawalFinalized {
        pool: pool.key(),
        nullifier: withdrawal.nullifier,
        recipient: withdrawal.recipient,
        amount,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// init_shielded_margin_ref
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitShieldedMarginRef<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        seeds = [b"shielded_pool", market.key().as_ref()],
        bump = shielded_pool.bump,
        constraint = shielded_pool.collateral_enabled() @ ShadowPerpError::ShieldedNotEnabled,
    )]
    pub shielded_pool: Box<Account<'info, ShieldedPool>>,

    #[account(
        init,
        payer = owner,
        space = ShieldedMarginRef::LEN,
        seeds = [b"shielded_margin", shielded_pool.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub shielded_margin_ref: Box<Account<'info, ShieldedMarginRef>>,

    pub system_program: Program<'info, System>,
}

pub fn init_shielded_margin_ref_handler(ctx: Context<InitShieldedMarginRef>) -> Result<()> {
    let margin_ref = &mut ctx.accounts.shielded_margin_ref;
    margin_ref.owner = ctx.accounts.owner.key();
    margin_ref.market = ctx.accounts.market.key();
    margin_ref.pool = ctx.accounts.shielded_pool.key();
    margin_ref.commitment = [0u8; 32];
    margin_ref.pending_computation_account = Pubkey::default();
    margin_ref.bump = ctx.bumps.shielded_margin_ref;
    margin_ref.version = ShieldedMarginRef::VERSION;

    emit!(ShieldedMarginRefCreated {
        owner: margin_ref.owner,
        pool: margin_ref.pool,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// lock_margin_private
// ---------------------------------------------------------------------------

const COMP_DEF_OFFSET_LOCK_MARGIN_PRIVATE_QUEUE: u32 = comp_def_offset("lock_margin_private");

#[queue_computation_accounts("lock_margin_private", owner)]
#[derive(Accounts)]
#[instruction(
    commitment_ref: [u8; 32],
    encrypted_payload: Vec<u8>,
    client_pubkey: [u8; 32],
    nonce: u128,
    requested_margin: u64,
    computation_offset: u64,
)]
pub struct LockMarginPrivate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

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
        constraint = shielded_pool.collateral_enabled() @ ShadowPerpError::ShieldedNotEnabled,
    )]
    pub shielded_pool: Box<Account<'info, ShieldedPool>>,

    #[account(
        mut,
        seeds = [b"shielded_margin", shielded_pool.key().as_ref(), owner.key().as_ref()],
        bump = shielded_margin_ref.bump,
        constraint = shielded_margin_ref.owner == owner.key() @ ShadowPerpError::Unauthorized,
        constraint = shielded_margin_ref.pool == shielded_pool.key() @ ShadowPerpError::InvalidAccountData,
    )]
    pub shielded_margin_ref: Box<Account<'info, ShieldedMarginRef>>,

    #[account(
        seeds = [b"commitment_tree", market.key().as_ref()],
        bump = commitment_tree.bump,
        constraint = commitment_tree.pool == shielded_pool.key() @ ShadowPerpError::InvalidAccountData,
    )]
    pub commitment_tree: Box<Account<'info, CommitmentTree>>,

    // --- Arcium accounts (populated by queue_computation_accounts macro) ---
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_LOCK_MARGIN_PRIVATE_QUEUE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet),
        constraint = cluster_account.key() == market.mxe_cluster @ ShadowPerpError::Unauthorized
    )]
    pub cluster_account: Box<Account<'info, Cluster>>,
    /// CHECK: Validated by address constraint + Arcium.
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: Validated by address constraint + Arcium.
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub executing_pool: UncheckedAccount<'info>,
    /// CHECK: Validated by address constraint + Arcium.
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub computation_account: UncheckedAccount<'info>,
    /// CHECK: Validated by address constraint + Arcium.
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 9,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn lock_margin_private_handler(
    ctx: Context<LockMarginPrivate>,
    commitment_ref: [u8; 32],
    encrypted_payload: Vec<u8>,
    client_pubkey: [u8; 32],
    nonce: u128,
    requested_margin: u64,
    computation_offset: u64,
) -> Result<()> {
    require!(computation_offset > 0, ShadowPerpError::InvalidAccountData);

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let margin_ref = &mut ctx.accounts.shielded_margin_ref;

    // Validate no computation is already in progress
    require!(
        margin_ref.pending_computation_account == Pubkey::default(),
        ShadowPerpError::ComputationInProgress
    );

    // Bind the computation account to this margin ref for callback verification
    margin_ref.pending_computation_account = ctx.accounts.computation_account.key();

    // Extract encrypted values from the payload.
    // Circuit: lock_margin_private(balance_and_lock: Enc<Shared, (u64, u64, u64)>, requested_margin: u64)
    // The encrypted payload contains 3 encrypted u64s: (balance, lock_amount, commitment_secret)
    require!(encrypted_payload.len() >= 96, ShadowPerpError::InvalidAccountData);

    let mut enc_balance = [0u8; 32];
    let mut enc_lock_amount = [0u8; 32];
    let mut enc_commitment_secret = [0u8; 32];
    enc_balance.copy_from_slice(&encrypted_payload[0..32]);
    enc_lock_amount.copy_from_slice(&encrypted_payload[32..64]);
    enc_commitment_secret.copy_from_slice(&encrypted_payload[64..96]);

    let args = ArgBuilder::new()
        // balance_and_lock: Enc<Shared, (u64, u64, u64)>
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(enc_balance)
        .encrypted_u64(enc_lock_amount)
        .encrypted_u64(enc_commitment_secret)
        // requested_margin: plaintext for MPC consistency check
        .plaintext_u64(requested_margin)
        .build();

    // Build callback accounts
    let callback_accounts = vec![
        CallbackAccount {
            pubkey: ctx.accounts.shielded_pool.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: ctx.accounts.commitment_tree.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: margin_ref.key(),
            is_writable: true,
        },
    ];

    let callback_ix = LockMarginPrivateCallback::callback_ix(
        computation_offset,
        &ctx.accounts.mxe_account,
        &callback_accounts,
    )?;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![callback_ix],
        1,
        0,
    )?;

    msg!(
        "lock_margin_private: queued computation offset={}, commitment_ref={:?}",
        computation_offset,
        &commitment_ref[..8]
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// settle_private_position
// ---------------------------------------------------------------------------

const COMP_DEF_OFFSET_SETTLE_PRIVATE_POSITION_QUEUE: u32 =
    comp_def_offset("settle_private_position");

#[queue_computation_accounts("settle_private_position", owner)]
#[derive(Accounts)]
#[instruction(
    encrypted_payload: Vec<u8>,
    client_pubkey: [u8; 32],
    nonce: u128,
    balance_client_pubkey: [u8; 32],
    balance_nonce: u128,
    exit_price: u64,
    trading_fee_bps: u16,
    computation_offset: u64,
)]
pub struct SettlePrivatePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

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
        constraint = shielded_pool.collateral_enabled() @ ShadowPerpError::ShieldedNotEnabled,
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
        seeds = [b"shielded_margin", shielded_pool.key().as_ref(), owner.key().as_ref()],
        bump = shielded_margin_ref.bump,
        constraint = shielded_margin_ref.owner == owner.key() @ ShadowPerpError::Unauthorized,
        constraint = shielded_margin_ref.pool == shielded_pool.key() @ ShadowPerpError::InvalidAccountData,
    )]
    pub shielded_margin_ref: Box<Account<'info, ShieldedMarginRef>>,

    // --- Arcium accounts ---
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SETTLE_PRIVATE_POSITION_QUEUE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet),
        constraint = cluster_account.key() == market.mxe_cluster @ ShadowPerpError::Unauthorized
    )]
    pub cluster_account: Box<Account<'info, Cluster>>,
    /// CHECK: Validated by address constraint + Arcium.
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: Validated by address constraint + Arcium.
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub executing_pool: UncheckedAccount<'info>,
    /// CHECK: Validated by address constraint + Arcium.
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub computation_account: UncheckedAccount<'info>,
    /// CHECK: Validated by address constraint + Arcium.
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 9,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn settle_private_position_handler(
    ctx: Context<SettlePrivatePosition>,
    encrypted_payload: Vec<u8>,
    client_pubkey: [u8; 32],
    nonce: u128,
    balance_client_pubkey: [u8; 32],
    balance_nonce: u128,
    _exit_price: u64,
    _trading_fee_bps: u16,
    computation_offset: u64,
) -> Result<()> {
    require!(computation_offset > 0, ShadowPerpError::InvalidAccountData);

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let market = &ctx.accounts.market;
    let margin_ref = &mut ctx.accounts.shielded_margin_ref;

    // SECURITY: Use authoritative market values instead of caller-supplied args.
    // A malicious caller could pass a manipulated exit_price or trading_fee_bps
    // to extract value from the protocol. Always read from on-chain market state.
    let exit_price = market.oracle_price;
    let trading_fee_bps = market.trading_fee;

    // Validate no computation is already in progress
    require!(
        margin_ref.pending_computation_account == Pubkey::default(),
        ShadowPerpError::ComputationInProgress
    );

    // Validate oracle freshness
    let clock = Clock::get()?;
    let price_age = clock.unix_timestamp.saturating_sub(market.last_price_update);
    require!(price_age < 300, ShadowPerpError::StalePrice);
    require!(market.oracle_price > 0, ShadowPerpError::InvalidPrice);

    // Bind computation account
    margin_ref.pending_computation_account = ctx.accounts.computation_account.key();

    // Extract encrypted values from the payload.
    // Circuit: settle_private_position(
    //   position: Enc<Shared, (u64, u64, u8, bool, u64)>,  // (size, entry_price, leverage, is_long, locked_margin)
    //   exit_price: u64,
    //   trading_fee_bps: u16,
    //   remaining_balance: Enc<Shared, u64>,
    // )
    require!(encrypted_payload.len() >= 192, ShadowPerpError::InvalidAccountData);

    let mut enc_size = [0u8; 32];
    let mut enc_entry_price = [0u8; 32];
    let mut enc_leverage = [0u8; 32];
    let mut enc_is_long = [0u8; 32];
    let mut enc_locked_margin = [0u8; 32];
    let mut enc_remaining_balance = [0u8; 32];
    enc_size.copy_from_slice(&encrypted_payload[0..32]);
    enc_entry_price.copy_from_slice(&encrypted_payload[32..64]);
    enc_leverage.copy_from_slice(&encrypted_payload[64..96]);
    enc_is_long.copy_from_slice(&encrypted_payload[96..128]);
    enc_locked_margin.copy_from_slice(&encrypted_payload[128..160]);
    enc_remaining_balance.copy_from_slice(&encrypted_payload[160..192]);

    let args = ArgBuilder::new()
        // position: Enc<Shared, (u64, u64, u8, u8, u64)>
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(enc_size)
        .encrypted_u64(enc_entry_price)
        .encrypted_u8(enc_leverage)
        .encrypted_u8(enc_is_long)
        .encrypted_u64(enc_locked_margin)
        // exit_price: plaintext (from market oracle, NOT caller-supplied)
        .plaintext_u64(exit_price)
        // trading_fee_bps: plaintext (from market state, NOT caller-supplied)
        .plaintext_u16(trading_fee_bps)
        // remaining_balance: Enc<Shared, u64> — separate Shared group needs its own pubkey+nonce
        .x25519_pubkey(balance_client_pubkey)
        .plaintext_u128(balance_nonce)
        .encrypted_u64(enc_remaining_balance)
        .build();

    // Build callback accounts
    let callback_accounts = vec![
        CallbackAccount {
            pubkey: market.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: ctx.accounts.shielded_pool.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: ctx.accounts.commitment_tree.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: margin_ref.key(),
            is_writable: true,
        },
    ];

    let callback_ix = SettlePrivatePositionCallback::callback_ix(
        computation_offset,
        &ctx.accounts.mxe_account,
        &callback_accounts,
    )?;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![callback_ix],
        1,
        0,
    )?;

    msg!(
        "settle_private_position: queued computation offset={}, exit_price={} (from oracle)",
        computation_offset,
        exit_price
    );

    Ok(())
}
