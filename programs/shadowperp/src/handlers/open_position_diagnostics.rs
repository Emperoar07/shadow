use crate::ArciumSignerAccount;
use crate::ID;
use crate::ID_CONST;
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_anchor::traits::CallbackCompAccs;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{Market, OpenPositionDiagnostic};

use crate::handlers::callbacks::open_position_diagnostic_callbacks::{
    OpenPositionFullProbeV1Callback, OpenPositionMarginProbeV1Callback,
    OpenPositionTupleProbeU8V1Callback, OpenPositionTupleProbeV1Callback,
};

fn seed_diagnostic_account(
    diagnostic: &mut OpenPositionDiagnostic,
    owner: Pubkey,
    market: Pubkey,
    run_id: u64,
    stage: u8,
    bump: u8,
    computation_account: Pubkey,
) -> Result<()> {
    diagnostic.begin(
        owner,
        market,
        run_id,
        stage,
        bump,
        computation_account,
        Clock::get()?.unix_timestamp,
    )
}

fn build_shared_open_probe_prefix(
    client_pubkey: [u8; 32],
    nonce: u128,
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_is_long: [u8; 32],
    encrypted_margin: [u8; 32],
) -> ArgBuilder {
    ArgBuilder::new()
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_size)
        .encrypted_u64(encrypted_entry_price)
        .encrypted_u8(encrypted_leverage)
        .encrypted_bool(encrypted_is_long)
        .encrypted_u64(encrypted_margin)
}

fn build_shared_open_probe_prefix_u8(
    client_pubkey: [u8; 32],
    nonce: u128,
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_direction_flag: [u8; 32],
    encrypted_margin: [u8; 32],
) -> ArgBuilder {
    ArgBuilder::new()
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_size)
        .encrypted_u64(encrypted_entry_price)
        .encrypted_u8(encrypted_leverage)
        // This diagnostic circuit intentionally encodes direction as u8, not bool.
        .encrypted_u8(encrypted_direction_flag)
        .encrypted_u64(encrypted_margin)
}

fn open_probe_callback_accounts(diagnostic: Pubkey, market: Pubkey) -> Vec<CallbackAccount> {
    vec![
        CallbackAccount {
            pubkey: diagnostic,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: market,
            is_writable: false,
        },
    ]
}

#[queue_computation_accounts("open_position_tuple_probe_v1", owner)]
#[derive(Accounts)]
#[instruction(
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_is_long: [u8; 32],
    encrypted_margin: [u8; 32],
    client_pubkey: [u8; 32],
    nonce: u128,
    run_id: u64,
    computation_offset: u64
)]
pub struct RunOpenPositionTupleProbe<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = owner,
        space = OpenPositionDiagnostic::LEN,
        seeds = [b"open-position-diagnostic", market.key().as_ref(), owner.key().as_ref(), &run_id.to_le_bytes()],
        bump
    )]
    pub diagnostic: Box<Account<'info, OpenPositionDiagnostic>>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(address = derive_comp_def_pda!(comp_def_offset("open_position_tuple_probe_v1")))]
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

pub fn run_open_position_tuple_probe_handler(
    ctx: Context<RunOpenPositionTupleProbe>,
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_is_long: [u8; 32],
    encrypted_margin: [u8; 32],
    client_pubkey: [u8; 32],
    nonce: u128,
    run_id: u64,
    computation_offset: u64,
) -> Result<()> {
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    require!(computation_offset > 0, ShadowPerpError::InvalidAccountData);

    seed_diagnostic_account(
        &mut ctx.accounts.diagnostic,
        ctx.accounts.owner.key(),
        ctx.accounts.market.key(),
        run_id,
        OpenPositionDiagnostic::STAGE_TUPLE_ONLY,
        ctx.bumps.diagnostic,
        ctx.accounts.computation_account.key(),
    )?;

    let args = build_shared_open_probe_prefix(
        client_pubkey,
        nonce,
        encrypted_size,
        encrypted_entry_price,
        encrypted_leverage,
        encrypted_is_long,
        encrypted_margin,
    )
    .build();

    let callback_ix = OpenPositionTupleProbeV1Callback::callback_ix(
        computation_offset,
        &ctx.accounts.mxe_account,
        &open_probe_callback_accounts(ctx.accounts.diagnostic.key(), ctx.accounts.market.key()),
    )?;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![callback_ix],
        1,
        0,
    )?;

    Ok(())
}

#[queue_computation_accounts("open_position_tuple_probe_u8_v1", owner)]
#[derive(Accounts)]
#[instruction(
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_direction_flag: [u8; 32],
    encrypted_margin: [u8; 32],
    client_pubkey: [u8; 32],
    nonce: u128,
    run_id: u64,
    computation_offset: u64
)]
pub struct RunOpenPositionTupleProbeU8<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = owner,
        space = OpenPositionDiagnostic::LEN,
        seeds = [b"open-position-diagnostic", market.key().as_ref(), owner.key().as_ref(), &run_id.to_le_bytes()],
        bump
    )]
    pub diagnostic: Box<Account<'info, OpenPositionDiagnostic>>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(address = derive_comp_def_pda!(comp_def_offset("open_position_tuple_probe_u8_v1")))]
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

pub fn run_open_position_tuple_probe_u8_handler(
    ctx: Context<RunOpenPositionTupleProbeU8>,
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_direction_flag: [u8; 32],
    encrypted_margin: [u8; 32],
    client_pubkey: [u8; 32],
    nonce: u128,
    run_id: u64,
    computation_offset: u64,
) -> Result<()> {
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    require!(computation_offset > 0, ShadowPerpError::InvalidAccountData);

    seed_diagnostic_account(
        &mut ctx.accounts.diagnostic,
        ctx.accounts.owner.key(),
        ctx.accounts.market.key(),
        run_id,
        OpenPositionDiagnostic::STAGE_TUPLE_U8_ONLY,
        ctx.bumps.diagnostic,
        ctx.accounts.computation_account.key(),
    )?;

    let args = build_shared_open_probe_prefix_u8(
        client_pubkey,
        nonce,
        encrypted_size,
        encrypted_entry_price,
        encrypted_leverage,
        encrypted_direction_flag,
        encrypted_margin,
    )
    .build();

    let callback_ix = OpenPositionTupleProbeU8V1Callback::callback_ix(
        computation_offset,
        &ctx.accounts.mxe_account,
        &open_probe_callback_accounts(ctx.accounts.diagnostic.key(), ctx.accounts.market.key()),
    )?;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![callback_ix],
        1,
        0,
    )?;

    Ok(())
}

#[queue_computation_accounts("open_position_margin_probe_v1", owner)]
#[derive(Accounts)]
#[instruction(
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_is_long: [u8; 32],
    encrypted_margin: [u8; 32],
    client_pubkey: [u8; 32],
    nonce: u128,
    requested_margin: u64,
    run_id: u64,
    computation_offset: u64
)]
pub struct RunOpenPositionMarginProbe<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = owner,
        space = OpenPositionDiagnostic::LEN,
        seeds = [b"open-position-diagnostic", market.key().as_ref(), owner.key().as_ref(), &run_id.to_le_bytes()],
        bump
    )]
    pub diagnostic: Box<Account<'info, OpenPositionDiagnostic>>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(address = derive_comp_def_pda!(comp_def_offset("open_position_margin_probe_v1")))]
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

pub fn run_open_position_margin_probe_handler(
    ctx: Context<RunOpenPositionMarginProbe>,
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_is_long: [u8; 32],
    encrypted_margin: [u8; 32],
    client_pubkey: [u8; 32],
    nonce: u128,
    requested_margin: u64,
    run_id: u64,
    computation_offset: u64,
) -> Result<()> {
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    require!(computation_offset > 0, ShadowPerpError::InvalidAccountData);

    seed_diagnostic_account(
        &mut ctx.accounts.diagnostic,
        ctx.accounts.owner.key(),
        ctx.accounts.market.key(),
        run_id,
        OpenPositionDiagnostic::STAGE_MARGIN_CHECK,
        ctx.bumps.diagnostic,
        ctx.accounts.computation_account.key(),
    )?;

    let args = build_shared_open_probe_prefix(
        client_pubkey,
        nonce,
        encrypted_size,
        encrypted_entry_price,
        encrypted_leverage,
        encrypted_is_long,
        encrypted_margin,
    )
    .plaintext_u64(requested_margin)
    .build();

    let callback_ix = OpenPositionMarginProbeV1Callback::callback_ix(
        computation_offset,
        &ctx.accounts.mxe_account,
        &open_probe_callback_accounts(ctx.accounts.diagnostic.key(), ctx.accounts.market.key()),
    )?;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![callback_ix],
        1,
        0,
    )?;

    Ok(())
}

#[queue_computation_accounts("open_position_full_probe_v1", owner)]
#[derive(Accounts)]
#[instruction(
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_is_long: [u8; 32],
    encrypted_margin: [u8; 32],
    client_pubkey: [u8; 32],
    nonce: u128,
    requested_margin: u64,
    run_id: u64,
    computation_offset: u64
)]
pub struct RunOpenPositionFullProbe<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = owner,
        space = OpenPositionDiagnostic::LEN,
        seeds = [b"open-position-diagnostic", market.key().as_ref(), owner.key().as_ref(), &run_id.to_le_bytes()],
        bump
    )]
    pub diagnostic: Box<Account<'info, OpenPositionDiagnostic>>,

    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(address = derive_comp_def_pda!(comp_def_offset("open_position_full_probe_v1")))]
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

pub fn run_open_position_full_probe_handler(
    ctx: Context<RunOpenPositionFullProbe>,
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_is_long: [u8; 32],
    encrypted_margin: [u8; 32],
    client_pubkey: [u8; 32],
    nonce: u128,
    requested_margin: u64,
    run_id: u64,
    computation_offset: u64,
) -> Result<()> {
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    require!(computation_offset > 0, ShadowPerpError::InvalidAccountData);

    seed_diagnostic_account(
        &mut ctx.accounts.diagnostic,
        ctx.accounts.owner.key(),
        ctx.accounts.market.key(),
        run_id,
        OpenPositionDiagnostic::STAGE_FULL_CHECK,
        ctx.bumps.diagnostic,
        ctx.accounts.computation_account.key(),
    )?;

    let args = build_shared_open_probe_prefix(
        client_pubkey,
        nonce,
        encrypted_size,
        encrypted_entry_price,
        encrypted_leverage,
        encrypted_is_long,
        encrypted_margin,
    )
    .plaintext_u64(requested_margin)
    .plaintext_u8(ctx.accounts.market.max_leverage)
    .build();

    let callback_ix = OpenPositionFullProbeV1Callback::callback_ix(
        computation_offset,
        &ctx.accounts.mxe_account,
        &open_probe_callback_accounts(ctx.accounts.diagnostic.key(), ctx.accounts.market.key()),
    )?;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![callback_ix],
        1,
        0,
    )?;

    Ok(())
}
