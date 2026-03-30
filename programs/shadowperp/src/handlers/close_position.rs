use crate::ArciumSignerAccount;
use crate::ID;
use crate::ID_CONST;
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_anchor::traits::CallbackCompAccs;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{MarginAccount, Market, Position, PositionStatus};

use crate::handlers::callbacks::close_position_callback::ClosePositionV2Callback;

#[queue_computation_accounts("close_position_v2", owner)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
        has_one = market,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        seeds = [b"margin", market.key().as_ref(), owner.key().as_ref()],
        bump = margin_account.bump,
        has_one = owner,
        has_one = market,
    )]
    pub margin_account: Box<Account<'info, MarginAccount>>,

    // --- Arcium accounts ---
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(address = market.close_position_comp_def)]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    /// Cluster must match the one recorded in the market at initialisation.
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

pub fn handler(ctx: Context<ClosePosition>, computation_offset: u64) -> Result<()> {
    // Required by Arcium queue flow when this account is initialized on demand.
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    require!(computation_offset > 0, ShadowPerpError::InvalidAccountData);

    let market = &ctx.accounts.market;
    let position = &mut ctx.accounts.position;
    let clock = Clock::get()?;

    // Validate position is open
    require!(
        position.status == PositionStatus::Open,
        ShadowPerpError::PositionNotOpen
    );
    // Validate oracle freshness before closing a position.
    let price_age = clock
        .unix_timestamp
        .saturating_sub(market.last_price_update);
    require!(price_age < 300, ShadowPerpError::StalePrice);
    require!(market.oracle_price > 0, ShadowPerpError::InvalidPrice);
    // Update status to closing
    position.status = PositionStatus::Closing;
    // Bind to the specific computation account so the callback can verify it is consuming
    // output from the exact computation that was authorised for this close request.
    position.begin_pending_computation(
        ctx.accounts.computation_account.key(),
        Position::CALLBACK_KIND_CLOSE,
        computation_offset,
    )?;

    // Build arguments for close_position_v2 MPC circuit
    // position: Enc<Shared, Position> - pass the encrypted position data stored on-chain
    // exit_price: u64 - plaintext oracle price
    // trading_fee_bps: u16 - only market field used by the close circuit
    let nonce = u128::from_le_bytes(position.nonce);
    let encrypted_size: [u8; 32] = position.encrypted_data[0..32]
        .try_into()
        .map_err(|_| error!(ShadowPerpError::InvalidAccountData))?;
    let encrypted_entry_price: [u8; 32] = position.encrypted_data[32..64]
        .try_into()
        .map_err(|_| error!(ShadowPerpError::InvalidAccountData))?;
    let encrypted_leverage: [u8; 32] = position.encrypted_data[64..96]
        .try_into()
        .map_err(|_| error!(ShadowPerpError::InvalidAccountData))?;
    let encrypted_is_long: [u8; 32] = position.encrypted_data[96..128]
        .try_into()
        .map_err(|_| error!(ShadowPerpError::InvalidAccountData))?;
    let encrypted_margin: [u8; 32] = position.encrypted_data[128..160]
        .try_into()
        .map_err(|_| error!(ShadowPerpError::InvalidAccountData))?;

    let args = ArgBuilder::new()
        // position: Enc<Shared, Position> - client x25519 key needed for decryption
        .x25519_pubkey(position.client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_size) // size
        .encrypted_u64(encrypted_entry_price) // entry_price
        .encrypted_u8(encrypted_leverage) // leverage
        .encrypted_bool(encrypted_is_long) // is_long
        .encrypted_u64(encrypted_margin) // margin
        // exit_price: u64 (plaintext - current oracle price)
        .plaintext_u64(market.oracle_price)
        // trading_fee_bps: only market field needed by the close circuit
        .plaintext_u16(market.trading_fee)
        .build();

    // Build callback accounts (3 only — token settlement deferred to settle_close_position)
    let callback_accounts = vec![
        CallbackAccount {
            pubkey: position.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: market.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: ctx.accounts.margin_account.key(),
            is_writable: true,
        },
    ];

    let callback_ix = ClosePositionV2Callback::callback_ix(
        computation_offset,
        &ctx.accounts.mxe_account,
        &callback_accounts,
    )?;

    // Queue the computation to Arcium MPC network
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
