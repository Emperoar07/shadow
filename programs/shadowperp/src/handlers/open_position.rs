use crate::ArciumSignerAccount;
use crate::ID;
use crate::ID_CONST;
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_anchor::traits::CallbackCompAccs;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{MarginAccount, Market, Position, PositionStatus};

use crate::handlers::callbacks::open_position_callback::OpenPositionV2Callback;

#[queue_computation_accounts("open_position_v2", owner)]
#[derive(Accounts)]
#[instruction(
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_is_long: [u8; 32],
    encrypted_margin: [u8; 32],
    margin: u64,
    client_pubkey: [u8; 32],
    nonce: u128,
    computation_offset: u64,
)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"margin", market.key().as_ref(), owner.key().as_ref()],
        bump = margin_account.bump,
        has_one = owner,
        has_one = market,
    )]
    pub margin_account: Box<Account<'info, MarginAccount>>,

    #[account(
        init,
        payer = owner,
        space = Position::LEN,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref(), &margin_account.positions_opened.to_le_bytes()],
        bump
    )]
    pub position: Box<Account<'info, Position>>,

    // --- Arcium accounts (populated by queue_computation_accounts macro) ---
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(address = market.open_position_comp_def)]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    /// Cluster must match the one recorded in the market at initialisation.
    /// Prevents a caller from substituting a different (potentially malicious) cluster and
    /// enforces canonical Arcium cluster PDA for the active MXE.
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

pub fn handler(
    ctx: Context<OpenPosition>,
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_is_long: [u8; 32],
    encrypted_margin: [u8; 32],
    margin: u64,
    client_pubkey: [u8; 32],
    nonce: u128,
    computation_offset: u64,
) -> Result<()> {
    // Required by Arcium queue flow when this account is initialized on demand.
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let market = &mut ctx.accounts.market;
    let margin_account = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;
    let clock = Clock::get()?;

    // Validate margin account has sufficient balance
    // Note: We can't check exact margin requirement because size/leverage are encrypted
    // The MPC circuit will validate this
    require!(
        margin_account.balance > 0,
        ShadowPerpError::InsufficientMargin
    );
    require!(margin > 0, ShadowPerpError::InsufficientMargin);
    let available_margin = margin_account
        .balance
        .checked_sub(margin_account.locked_balance)
        .ok_or(ShadowPerpError::InsufficientMargin)?;
    require!(
        available_margin >= margin,
        ShadowPerpError::InsufficientMargin
    );

    // Validate oracle freshness before opening a position.
    let price_age = clock
        .unix_timestamp
        .saturating_sub(market.last_price_update);
    require!(price_age < 300, ShadowPerpError::StalePrice);
    require!(market.oracle_price > 0, ShadowPerpError::InvalidPrice);

    // Reserve a monotonic per-user position index to avoid PDA seed reuse.
    let next_position_index = margin_account.positions_opened;
    margin_account.positions_opened = margin_account
        .positions_opened
        .checked_add(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Initialize position with encrypted data
    position.owner = ctx.accounts.owner.key();
    position.market = market.key();
    position.status = PositionStatus::Pending;
    position.opened_at = clock.unix_timestamp;
    position.closed_at = 0;
    // Keep plaintext margin slots empty during active lifecycle.
    // `requested_margin` is used only as a pending-time cap and is cleared in callback.
    position.margin = 0;
    position.requested_margin = margin;
    position.realized_pnl = 0;
    position.nonce = nonce.to_le_bytes();
    position.client_pubkey = client_pubkey;
    position.index = next_position_index;
    position.bump = ctx.bumps.position;
    // Defensive guard: a freshly initialized position must not already carry
    // an in-flight computation binding.
    require!(
        position.pending_computation_account == Pubkey::default(),
        ShadowPerpError::ComputationInProgress
    );
    // Bind this position to the specific computation account that will execute it.
    // The callback will verify this key before accepting any MPC output.
    position.pending_computation_account = ctx.accounts.computation_account.key();

    // Pack encrypted inputs into position data for on-chain storage
    let mut encrypted_data = [0u8; 256];
    encrypted_data[0..32].copy_from_slice(&encrypted_size);
    encrypted_data[32..64].copy_from_slice(&encrypted_entry_price);
    encrypted_data[64..96].copy_from_slice(&encrypted_leverage);
    encrypted_data[96..128].copy_from_slice(&encrypted_is_long);
    encrypted_data[128..160].copy_from_slice(&encrypted_margin);
    position.encrypted_data = encrypted_data;

    // Build encrypted arguments for the MPC computation using ArgBuilder.
    // Circuit: open_position(inputs: Enc<Shared,(u64,u64,u8,bool,u64)>, ...)
    // All five user-encrypted values share one pubkey+nonce (batched Enc<Shared, tuple>).
    // This reduces the argument count from 23 → 15, keeping within Arcium's
    // computation account space budget.
    //
    // Param layout (15 total):
    //   inputs: Enc<Shared, (u64,u64,u8,bool,u64)>
    //     1. x25519_pubkey (shared for all 5 values)
    //     2. plaintext_u128 (shared nonce)
    //     3. encrypted_u64  (size ciphertext)
    //     4. encrypted_u64  (entry_price ciphertext)
    //     5. encrypted_u8   (leverage ciphertext)
    //     6. encrypted_bool (is_long ciphertext)
    //     7. encrypted_u64  (margin ciphertext)
    //   requested_margin: u64     8.
    //   market_params: (u8,u16,u16,u64)  9-12.
    //   oi_state: Enc<Mxe,(u64,u64)>  13-15.
    let args = ArgBuilder::new()
        // inputs: Enc<Shared, (u64, u64, u8, bool, u64)>
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_size)
        .encrypted_u64(encrypted_entry_price)
        .encrypted_u8(encrypted_leverage)
        .encrypted_bool(encrypted_is_long)
        .encrypted_u64(encrypted_margin)
        // requested_margin: plaintext mirror for MPC consistency check
        .plaintext_u64(margin)
        // market_params: (max_leverage, liquidation_threshold, trading_fee, oracle_price)
        .plaintext_u8(market.max_leverage)
        .plaintext_u16(market.liquidation_threshold)
        .plaintext_u16(market.trading_fee)
        .plaintext_u64(market.oracle_price)
        // oi_state: Enc<Mxe, (long_oi, short_oi)>
        .plaintext_u128(market.oi_nonce)
        .encrypted_u64(market.encrypted_total_long_oi)
        .encrypted_u64(market.encrypted_total_short_oi)
        .build();

    // Build callback instruction for when MPC completes
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
            pubkey: margin_account.key(),
            is_writable: true,
        },
    ];

    let callback_ix = OpenPositionV2Callback::callback_ix(
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
        0, // no priority fee
    )?;

    Ok(())
}
