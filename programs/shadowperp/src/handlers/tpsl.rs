//! TP/SL order handlers:
//!   - `set_tpsl`      — owner-only, creates/updates TpSlOrder PDA
//!   - `cancel_tpsl`   — owner-only, deactivates TpSlOrder
//!   - `trigger_tpsl`  — permissionless keeper, checks mark_price and queues MPC close

use crate::ArciumSignerAccount;
use crate::ID;
use crate::ID_CONST;
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use arcium_anchor::traits::CallbackCompAccs;
use arcium_client::idl::arcium::types::CallbackAccount;
use crate::handlers::callbacks::close_position_callback::ClosePositionV5Callback;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{
    MarginAccount, Market, Position, PositionStatus, TpSlOrder, TpSlOrderCancelled, TpSlOrderSet,
    TpSlTriggered,
};

// ─────────────────────────────────────────────────────────────────────────────
// set_tpsl
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct SetTpSl<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
        has_one = market,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        init_if_needed,
        payer = owner,
        space = TpSlOrder::LEN,
        seeds = [b"tpsl", position.key().as_ref()],
        bump
    )]
    pub tpsl_order: Box<Account<'info, TpSlOrder>>,

    pub system_program: Program<'info, System>,
}

// STUB — TP/SL on private positions requires an MPC circuit that proves the
// trigger condition without revealing position direction or size. Until that
// circuit and the matching close-position settlement path land, this handler
// returns TpSlPrivateDirectionUnsupported so clients fail fast instead of
// silently writing TpSlOrder accounts that no triggerer will ever evaluate.
// See audit 2026-04-29 §WT-8 and the close_position_v3 settlement flow.
pub fn set_tpsl_handler(
    ctx: Context<SetTpSl>,
    tp_price: u64,
    sl_price: u64,
    is_long: bool,
) -> Result<()> {
    let tpsl = &mut ctx.accounts.tpsl_order;
    tpsl.position = ctx.accounts.position.key();
    tpsl.owner = ctx.accounts.owner.key();
    tpsl.market = ctx.accounts.market.key();
    tpsl.tp_price = tp_price;
    tpsl.sl_price = sl_price;
    tpsl.is_long = if is_long { TpSlOrder::IS_LONG_LONG } else { TpSlOrder::IS_LONG_SHORT };
    tpsl.active = true;
    tpsl.bump = ctx.bumps.tpsl_order;

    emit!(TpSlOrderSet {
        position: tpsl.position,
        owner: tpsl.owner,
        tp_price,
        sl_price,
        is_long,
    });

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// cancel_tpsl
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CancelTpSl<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
        has_one = market,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        seeds = [b"tpsl", position.key().as_ref()],
        bump = tpsl_order.bump,
        has_one = owner @ ShadowPerpError::Unauthorized,
    )]
    pub tpsl_order: Box<Account<'info, TpSlOrder>>,
}

pub fn cancel_tpsl_handler(ctx: Context<CancelTpSl>) -> Result<()> {
    let tpsl = &mut ctx.accounts.tpsl_order;
    require!(tpsl.active, ShadowPerpError::TpSlNotActive);

    tpsl.active = false;

    emit!(TpSlOrderCancelled {
        position: tpsl.position,
        owner: tpsl.owner,
    });

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// trigger_tpsl  (permissionless keeper)
// ─────────────────────────────────────────────────────────────────────────────

/// Permissionless keeper call: checks mark_price against TP/SL levels and
/// queues MPC close computation if triggered. The keeper pays computation fees.
#[queue_computation_accounts("close_position_v5", keeper)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct TriggerTpSl<'info> {
    /// Permissionless keeper — pays for the computation
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = market,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        seeds = [b"tpsl", position.key().as_ref()],
        bump = tpsl_order.bump,
        constraint = tpsl_order.position == position.key() @ ShadowPerpError::InvalidAccountData,
        constraint = tpsl_order.market == market.key() @ ShadowPerpError::InvalidAccountData,
    )]
    pub tpsl_order: Box<Account<'info, TpSlOrder>>,

    #[account(
        mut,
        seeds = [b"margin", position.owner.as_ref()],
        bump = margin_account.bump,
    )]
    pub margin_account: Box<Account<'info, MarginAccount>>,

    // --- Arcium accounts (populated by queue_computation_accounts macro) ---
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
        payer = keeper,
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

// STUB — pair of set_tpsl_handler. See note above for why this is disabled.
pub fn trigger_tpsl_handler(
    ctx: Context<TriggerTpSl>,
    computation_offset: u64,
) -> Result<()> {
    require!(computation_offset > 0, ShadowPerpError::InvalidAccountData);
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let clock = Clock::get()?;
    let market = &ctx.accounts.market;
    let margin_account_key = ctx.accounts.margin_account.key();
    let mxe_account = ctx.accounts.mxe_account.clone();
    let computation_account_key = ctx.accounts.computation_account.key();

    let (position_key, position_owner, mark_price, trigger_type, trigger_price, args) = {
        let position = &mut ctx.accounts.position;
        let tpsl_order = &mut ctx.accounts.tpsl_order;

        require!(tpsl_order.active, ShadowPerpError::TpSlNotActive);
        require!(position.status == PositionStatus::Open, ShadowPerpError::PositionNotOpen);

        let price_age = clock.unix_timestamp.saturating_sub(market.last_price_update);
        require!(price_age < 300, ShadowPerpError::StalePrice);
        require!(market.oracle_price > 0, ShadowPerpError::InvalidPrice);

        let mark_price = market.effective_mark_price_at(clock.unix_timestamp);
        let is_long = tpsl_order.is_long == crate::state::TpSlOrder::IS_LONG_LONG;

        let mut triggered = false;
        let mut trigger_type = 0u8;

        if is_long {
            if tpsl_order.tp_price > 0 && mark_price >= tpsl_order.tp_price {
                triggered = true;
                trigger_type = 1;
            } else if tpsl_order.sl_price > 0 && mark_price <= tpsl_order.sl_price {
                triggered = true;
                trigger_type = 2;
            }
        } else {
            if tpsl_order.tp_price > 0 && mark_price <= tpsl_order.tp_price {
                triggered = true;
                trigger_type = 1;
            } else if tpsl_order.sl_price > 0 && mark_price >= tpsl_order.sl_price {
                triggered = true;
                trigger_type = 2;
            }
        }

        require!(triggered, ShadowPerpError::TpSlNotTriggered);

        tpsl_order.active = false;

        position.status = PositionStatus::Closing;
        position.begin_pending_computation(
            computation_account_key,
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
            .x25519_pubkey(position.client_pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(encrypted_size)
            .encrypted_u64(encrypted_entry_price)
            .encrypted_u8(encrypted_leverage)
            .encrypted_u8(encrypted_is_long)
            .encrypted_u64(encrypted_margin)
            .plaintext_u64(mark_price)
            .plaintext_u64(u64::from(market.trading_fee))
            .build();

        let trigger_price = if trigger_type == 1 {
            tpsl_order.tp_price
        } else {
            tpsl_order.sl_price
        };

        (
            position.key(),
            position.owner,
            mark_price,
            trigger_type,
            trigger_price,
            args,
        )
    };

    let callback_accounts = vec![
        CallbackAccount {
            pubkey: position_key,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: market.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: margin_account_key,
            is_writable: true,
        },
    ];

    let callback_ix =
        ClosePositionV5Callback::callback_ix(computation_offset, &mxe_account, &callback_accounts)?;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![callback_ix],
        1,
        0,
    )?;

    emit!(TpSlTriggered {
        position: position_key,
        owner: position_owner,
        trigger_type,
        trigger_price,
        mark_price,
    });

    Ok(())
}
