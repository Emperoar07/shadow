use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_anchor::traits::CallbackCompAccs;
use arcium_client::idl::arcium::types::CallbackAccount;
use crate::{ID, ID_CONST};
use crate::ArciumSignerAccount;

use crate::errors::ShadowPerpError;
use crate::state::{Market, MarginAccount, Position, PositionStatus};

use crate::handlers::callbacks::open_position_callback::OpenPositionCallback;

#[queue_computation_accounts("open_position", owner)]
#[derive(Accounts)]
#[instruction(
    encrypted_size: [u8; 32],
    encrypted_entry_price: [u8; 32],
    encrypted_leverage: [u8; 32],
    encrypted_is_long: [u8; 32],
    encrypted_margin: [u8; 32],
    encrypted_owner_lo: [u8; 32],
    encrypted_owner_hi: [u8; 32],
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
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"margin", market.key().as_ref(), owner.key().as_ref()],
        bump = margin_account.bump,
        has_one = owner,
        has_one = market,
    )]
    pub margin_account: Account<'info, MarginAccount>,

    #[account(
        init,
        payer = owner,
        space = Position::LEN,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref(), &market.active_positions.to_le_bytes()],
        bump
    )]
    pub position: Account<'info, Position>,

    // --- Arcium accounts (populated by queue_computation_accounts macro) ---
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut)]
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: Validated by Arcium
    #[account(mut)]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: Validated by Arcium
    #[account(mut)]
    pub executing_pool: UncheckedAccount<'info>,
    /// CHECK: Validated by Arcium
    #[account(mut)]
    pub computation_account: UncheckedAccount<'info>,
    /// CHECK: Validated by Arcium
    #[account(mut)]
    pub pool_account: Account<'info, FeePool>,
    /// CHECK: Validated by Arcium
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(mut)]
    pub clock_account: Account<'info, ClockAccount>,

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
    encrypted_owner_lo: [u8; 32],
    encrypted_owner_hi: [u8; 32],
    margin: u64,
    client_pubkey: [u8; 32],
    nonce: u128,
    computation_offset: u64,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let margin_account = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;
    let clock = Clock::get()?;

    // Validate margin account has sufficient balance
    // Note: We can't check exact margin requirement because size/leverage are encrypted
    // The MPC circuit will validate this
    require!(margin_account.balance > 0, ShadowPerpError::InsufficientMargin);
    require!(margin > 0, ShadowPerpError::InsufficientMargin);
    let available_margin = margin_account
        .balance
        .checked_sub(margin_account.locked_balance)
        .ok_or(ShadowPerpError::InsufficientMargin)?;
    require!(available_margin >= margin, ShadowPerpError::InsufficientMargin);

    // Initialize position with encrypted data
    position.owner = ctx.accounts.owner.key();
    position.market = market.key();
    position.status = PositionStatus::Pending;
    position.opened_at = clock.unix_timestamp;
    position.closed_at = 0;
    position.margin = 0; // Set by callback after MPC validates
    position.requested_margin = margin;
    position.realized_pnl = 0;
    position.nonce = nonce.to_le_bytes();
    position.client_pubkey = client_pubkey;
    position.index = market.active_positions;
    position.bump = ctx.bumps.position;

    // Pack encrypted inputs into position data for on-chain storage
    let mut encrypted_data = [0u8; 256];
    encrypted_data[0..32].copy_from_slice(&encrypted_size);
    encrypted_data[32..64].copy_from_slice(&encrypted_entry_price);
    encrypted_data[64..96].copy_from_slice(&encrypted_leverage);
    encrypted_data[96..128].copy_from_slice(&encrypted_is_long);
    encrypted_data[128..160].copy_from_slice(&encrypted_margin);
    encrypted_data[160..192].copy_from_slice(&encrypted_owner_lo);
    encrypted_data[192..224].copy_from_slice(&encrypted_owner_hi);
    position.encrypted_data = encrypted_data;

    // Build encrypted arguments for the MPC computation using ArgBuilder
    // Each Enc<Shared, T> param needs: x25519_pubkey, nonce, ciphertext
    let args = ArgBuilder::new()
        // size: Enc<Shared, u64>
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_size)
        // entry_price: Enc<Shared, u64>
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_entry_price)
        // leverage: Enc<Shared, u8>
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u8(encrypted_leverage)
        // is_long: Enc<Shared, bool>
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_bool(encrypted_is_long)
        // margin: Enc<Shared, u64>
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_margin)
        // owner_lo: Enc<Shared, u128>
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u128(encrypted_owner_lo)
        // owner_hi: Enc<Shared, u128>
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u128(encrypted_owner_hi)
        // market_params: MarketParams (plaintext - public data)
        .plaintext_u8(market.max_leverage)
        .plaintext_u16(market.liquidation_threshold)
        .plaintext_u16(market.trading_fee)
        .plaintext_u64(market.oracle_price)
        // oi_state: Enc<Mxe, OpenInterest> - MXE-encrypted aggregate state
        .plaintext_u128(nonce)
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

    let callback_ix = OpenPositionCallback::callback_ix(
        computation_offset,
        &ctx.accounts.mxe_account,
        &callback_accounts,
    )?;

    let position_index = position.index;
    drop(position);
    drop(market);
    drop(margin_account);

    // Queue the computation to Arcium MPC network
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![callback_ix],
        1, // single transaction
        0, // no priority fee
    )?;

    msg!("Position opening queued for MPC computation");
    msg!("Computation offset: {}", computation_offset);
    msg!("Position index: {}", position_index);

    Ok(())
}
