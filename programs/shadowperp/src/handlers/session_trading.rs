use crate::ArciumSignerAccount;
use crate::ID;
use crate::ID_CONST;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use arcium_anchor::prelude::*;
use arcium_anchor::traits::CallbackCompAccs;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::handlers::callbacks::close_position_callback::ClosePositionCallback;
use crate::handlers::callbacks::open_position_callback::OpenPositionV2Callback;
use crate::state::{MarginAccount, Market, Position, PositionStatus, TradeSession, TradeSessionCreated, TradeSessionRevoked};

#[derive(Accounts)]
#[instruction(session_id: u64)]
pub struct CreateTradeSession<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = owner,
        space = TradeSession::LEN,
        seeds = [b"trade_session", market.key().as_ref(), owner.key().as_ref(), &session_id.to_le_bytes()],
        bump
    )]
    pub session: Box<Account<'info, TradeSession>>,

    pub system_program: Program<'info, System>,
}

pub fn create_trade_session_handler(
    ctx: Context<CreateTradeSession>,
    session_id: u64,
    relayer: Pubkey,
    max_actions: u32,
    max_margin_per_action: u64,
    expires_at: i64,
) -> Result<()> {
    let clock = Clock::get()?;
    require!(max_actions > 0, ShadowPerpError::InvalidAccountData);
    require!(max_margin_per_action > 0, ShadowPerpError::ZeroAmount);
    require!(expires_at > clock.unix_timestamp, ShadowPerpError::SessionExpired);
    require!(relayer != Pubkey::default(), ShadowPerpError::InvalidAccountData);

    let session = &mut ctx.accounts.session;
    session.owner = ctx.accounts.owner.key();
    session.market = ctx.accounts.market.key();
    session.relayer = relayer;
    session.session_id = session_id;
    session.max_actions = max_actions;
    session.used_actions = 0;
    session.max_margin_per_action = max_margin_per_action;
    session.expires_at = expires_at;
    session.revoked = false;
    session.bump = ctx.bumps.session;

    emit!(TradeSessionCreated {
        owner: session.owner,
        market: session.market,
        relayer: session.relayer,
        session_id,
        max_actions,
        max_margin_per_action,
        expires_at,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct RevokeTradeSession<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"trade_session", market.key().as_ref(), owner.key().as_ref(), &session.session_id.to_le_bytes()],
        bump = session.bump,
        has_one = owner,
        has_one = market,
    )]
    pub session: Box<Account<'info, TradeSession>>,
}

pub fn revoke_trade_session_handler(ctx: Context<RevokeTradeSession>) -> Result<()> {
    let session = &mut ctx.accounts.session;
    session.revoked = true;
    emit!(TradeSessionRevoked {
        owner: session.owner,
        market: session.market,
        relayer: session.relayer,
        session_id: session.session_id,
    });
    Ok(())
}

#[queue_computation_accounts("open_position_v2", relayer)]
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
pub struct OpenPositionWithSession<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,

    /// Session owner whose margin account/position are touched.
    pub owner: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"trade_session", market.key().as_ref(), owner.key().as_ref(), &session.session_id.to_le_bytes()],
        bump = session.bump,
        has_one = owner,
        has_one = market,
    )]
    pub session: Box<Account<'info, TradeSession>>,

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
        payer = relayer,
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
        payer = relayer,
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

pub fn open_position_with_session_handler(
    ctx: Context<OpenPositionWithSession>,
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
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;
    let session = &mut ctx.accounts.session;
    let margin_account = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;

    session.assert_active(ctx.accounts.relayer.key(), market.key(), clock.unix_timestamp)?;
    session.consume_open_action(margin)?;

    require!(margin_account.balance > 0, ShadowPerpError::InsufficientMargin);
    require!(margin > 0, ShadowPerpError::InsufficientMargin);
    let available_margin = margin_account
        .balance
        .checked_sub(margin_account.locked_balance)
        .ok_or(ShadowPerpError::InsufficientMargin)?;
    require!(available_margin >= margin, ShadowPerpError::InsufficientMargin);

    let price_age = clock.unix_timestamp.saturating_sub(market.last_price_update);
    require!(price_age < 300, ShadowPerpError::StalePrice);
    require!(market.oracle_price > 0, ShadowPerpError::InvalidPrice);

    let next_position_index = margin_account.positions_opened;
    margin_account.positions_opened = margin_account
        .positions_opened
        .checked_add(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    position.owner = ctx.accounts.owner.key();
    position.market = market.key();
    position.status = PositionStatus::Pending;
    position.opened_at = clock.unix_timestamp;
    position.closed_at = 0;
    position.margin = 0;
    position.requested_margin = margin;
    position.realized_pnl = 0;
    position.nonce = nonce.to_le_bytes();
    position.client_pubkey = client_pubkey;
    position.index = next_position_index;
    position.bump = ctx.bumps.position;
    position.begin_pending_computation(
        ctx.accounts.computation_account.key(),
        Position::CALLBACK_KIND_OPEN,
        computation_offset,
    )?;

    let mut encrypted_data = [0u8; 256];
    encrypted_data[0..32].copy_from_slice(&encrypted_size);
    encrypted_data[32..64].copy_from_slice(&encrypted_entry_price);
    encrypted_data[64..96].copy_from_slice(&encrypted_leverage);
    encrypted_data[96..128].copy_from_slice(&encrypted_is_long);
    encrypted_data[128..160].copy_from_slice(&encrypted_margin);
    position.encrypted_data = encrypted_data;

    let args = ArgBuilder::new()
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_size)
        .encrypted_u64(encrypted_entry_price)
        .encrypted_u8(encrypted_leverage)
        .encrypted_bool(encrypted_is_long)
        .encrypted_u64(encrypted_margin)
        .plaintext_u64(margin)
        .plaintext_u8(market.max_leverage)
        .plaintext_u16(market.liquidation_threshold)
        .plaintext_u16(market.trading_fee)
        .plaintext_u64(market.oracle_price)
        .plaintext_u128(market.oi_nonce)
        .encrypted_u64(market.encrypted_total_long_oi)
        .encrypted_u64(market.encrypted_total_short_oi)
        .build();

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

#[queue_computation_accounts("close_position", relayer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ClosePositionWithSession<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,

    /// Session owner whose position is being closed.
    pub owner: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"trade_session", market.key().as_ref(), owner.key().as_ref(), &session.session_id.to_le_bytes()],
        bump = session.bump,
        has_one = owner,
        has_one = market,
    )]
    pub session: Box<Account<'info, TradeSession>>,

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

    #[account(
        mut,
        constraint = owner_token_account.owner == owner.key(),
        constraint = owner_token_account.mint == market.collateral_mint
    )]
    pub owner_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        constraint = vault.key() == market.vault
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    // --- Arcium accounts ---
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(address = market.close_position_comp_def)]
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
        payer = relayer,
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

pub fn close_position_with_session_handler(
    ctx: Context<ClosePositionWithSession>,
    computation_offset: u64,
) -> Result<()> {
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let clock = Clock::get()?;
    let market = &ctx.accounts.market;
    let session = &mut ctx.accounts.session;
    let position = &mut ctx.accounts.position;

    session.assert_active(ctx.accounts.relayer.key(), market.key(), clock.unix_timestamp)?;
    session.consume_action()?;

    require!(
        position.status == PositionStatus::Open,
        ShadowPerpError::PositionNotOpen
    );
    position.status = PositionStatus::Closing;
    position.begin_pending_computation(
        ctx.accounts.computation_account.key(),
        Position::CALLBACK_KIND_CLOSE,
        computation_offset,
    )?;

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
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_size)
        .encrypted_u64(encrypted_entry_price)
        .encrypted_u8(encrypted_leverage)
        .encrypted_bool(encrypted_is_long)
        .encrypted_u64(encrypted_margin)
        .plaintext_u64(market.oracle_price)
        .plaintext_u8(market.max_leverage)
        .plaintext_u16(market.liquidation_threshold)
        .plaintext_u16(market.trading_fee)
        .plaintext_u64(market.oracle_price)
        .plaintext_u128(nonce)
        .encrypted_u64(market.encrypted_total_long_oi)
        .encrypted_u64(market.encrypted_total_short_oi)
        .build();

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
        CallbackAccount {
            pubkey: ctx.accounts.owner_token_account.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: ctx.accounts.vault.key(),
            is_writable: true,
        },
    ];

    let callback_ix = ClosePositionCallback::callback_ix(
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

    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawCollateralWithSession<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,

    /// Session owner whose margin account is affected.
    pub owner: SystemAccount<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"trade_session", market.key().as_ref(), owner.key().as_ref(), &session.session_id.to_le_bytes()],
        bump = session.bump,
        has_one = owner,
        has_one = market,
    )]
    pub session: Box<Account<'info, TradeSession>>,

    #[account(
        mut,
        seeds = [b"margin", market.key().as_ref(), owner.key().as_ref()],
        bump = margin_account.bump,
        has_one = owner,
        has_one = market,
    )]
    pub margin_account: Box<Account<'info, MarginAccount>>,

    #[account(
        mut,
        constraint = owner_token_account.owner == owner.key(),
        constraint = owner_token_account.mint == market.collateral_mint
    )]
    pub owner_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        constraint = vault.key() == market.vault
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn withdraw_collateral_with_session_handler(
    ctx: Context<WithdrawCollateralWithSession>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, ShadowPerpError::ZeroAmount);

    let clock = Clock::get()?;
    let relayer = ctx.accounts.relayer.key();
    let market = &ctx.accounts.market;
    let margin_account = &mut ctx.accounts.margin_account;
    let session = &mut ctx.accounts.session;

    session.assert_active(relayer, market.key(), clock.unix_timestamp)?;
    require!(
        amount <= session.max_margin_per_action,
        ShadowPerpError::SessionMarginLimitExceeded
    );
    session.consume_action()?;

    let available = margin_account
        .balance
        .checked_sub(margin_account.locked_balance)
        .ok_or(ShadowPerpError::InsufficientBalance)?;
    require!(available >= amount, ShadowPerpError::InsufficientBalance);

    let seeds = &[b"market", market.collateral_mint.as_ref(), &[market.bump]];
    let signer_seeds = &[&seeds[..]];
    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.owner_token_account.to_account_info(),
            authority: market.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, amount)?;

    margin_account.balance = margin_account
        .balance
        .checked_sub(amount)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;
    margin_account.total_withdrawn = margin_account
        .total_withdrawn
        .checked_add(amount)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    Ok(())
}
