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

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::handlers::callbacks::close_position_callback::ClosePositionV2Callback;
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

pub fn set_tpsl_handler(
    ctx: Context<SetTpSl>,
    tp_price: u64,
    sl_price: u64,
    is_long: bool,
) -> Result<()> {
    let position = &ctx.accounts.position;
    let clock = Clock::get()?;

    // Position must be open to set TP/SL
    require!(
        position.status == PositionStatus::Open,
        ShadowPerpError::PositionNotOpen
    );

    // At least one of TP or SL must be set
    require!(
        tp_price > 0 || sl_price > 0,
        ShadowPerpError::InvalidTpSlPrice
    );

    let current_price = ctx
        .accounts
        .market
        .effective_mark_price_at(clock.unix_timestamp);

    // Validate TP/SL prices make sense for direction
    if tp_price > 0 && current_price > 0 {
        if is_long {
            // TP for long should be above current price
            require!(tp_price > current_price, ShadowPerpError::InvalidTpSlPrice);
        } else {
            // TP for short should be below current price
            require!(tp_price < current_price, ShadowPerpError::InvalidTpSlPrice);
        }
    }

    if sl_price > 0 && current_price > 0 {
        if is_long {
            // SL for long should be below current price
            require!(sl_price < current_price, ShadowPerpError::InvalidTpSlPrice);
        } else {
            // SL for short should be above current price
            require!(sl_price > current_price, ShadowPerpError::InvalidTpSlPrice);
        }
    }

    let tpsl = &mut ctx.accounts.tpsl_order;
    tpsl.position = position.key();
    tpsl.owner = ctx.accounts.owner.key();
    tpsl.market = ctx.accounts.market.key();
    tpsl.tp_price = tp_price;
    tpsl.sl_price = sl_price;
    tpsl.is_long = if is_long {
        TpSlOrder::IS_LONG_LONG
    } else {
        TpSlOrder::IS_LONG_SHORT
    };
    tpsl.active = true;
    tpsl.bump = ctx.bumps.tpsl_order;

    emit!(TpSlOrderSet {
        position: position.key(),
        owner: ctx.accounts.owner.key(),
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
#[queue_computation_accounts("close_position_v2", keeper)]
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

pub fn trigger_tpsl_handler(
    ctx: Context<TriggerTpSl>,
    computation_offset: u64,
) -> Result<()> {
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    require!(computation_offset > 0, ShadowPerpError::InvalidAccountData);

    let tpsl = &ctx.accounts.tpsl_order;

    require!(tpsl.active, ShadowPerpError::TpSlNotActive);

    let position = &ctx.accounts.position;
    require!(
        position.status == PositionStatus::Open,
        ShadowPerpError::PositionNotOpen
    );

    let market = &ctx.accounts.market;

    // Mark price must have been set (non-zero) to trigger TP/SL
    let mark_price = market.mark_price();
    require!(mark_price > 0, ShadowPerpError::MarkPriceStale);

    // Validate oracle freshness
    let clock = Clock::get()?;
    let price_age = clock
        .unix_timestamp
        .saturating_sub(market.last_mark_price_update());
    require!(price_age < 300, ShadowPerpError::MarkPriceStale);

    let is_long = tpsl.is_long == TpSlOrder::IS_LONG_LONG;
    require!(
        tpsl.is_long != TpSlOrder::IS_LONG_UNSET,
        ShadowPerpError::InvalidTpSlPrice
    );

    // Determine trigger type: 1 = TP, 2 = SL
    let (triggered, trigger_type, trigger_price) = check_trigger(
        mark_price,
        tpsl.tp_price,
        tpsl.sl_price,
        is_long,
    );
    require!(triggered, ShadowPerpError::TpSlNotTriggered);

    // Deactivate the TP/SL order
    let tpsl_mut = &mut ctx.accounts.tpsl_order;
    tpsl_mut.active = false;

    emit!(TpSlTriggered {
        position: position.key(),
        owner: tpsl_mut.owner,
        trigger_type,
        trigger_price,
        mark_price,
    });

    // Queue close_position_v2 MPC computation using mark_price as exit price
    let position = &mut ctx.accounts.position;
    position.status = PositionStatus::Closing;
    position.begin_pending_computation(
        ctx.accounts.computation_account.key(),
        Position::CALLBACK_KIND_CLOSE,
        computation_offset,
    )?;

    let market = &ctx.accounts.market;
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

    // Use mark_price as exit price for TP/SL settlement
    let args = ArgBuilder::new()
        .x25519_pubkey(position.client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_size)
        .encrypted_u64(encrypted_entry_price)
        .encrypted_u8(encrypted_leverage)
        .encrypted_bool(encrypted_is_long)
        .encrypted_u64(encrypted_margin)
        .plaintext_u64(mark_price)
        .plaintext_u16(market.trading_fee)
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
    ];

    let callback_ix = ClosePositionV2Callback::callback_ix(
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

/// Returns (triggered, trigger_type, trigger_price).
/// trigger_type: 1 = TP, 2 = SL
fn check_trigger(
    mark_price: u64,
    tp_price: u64,
    sl_price: u64,
    is_long: bool,
) -> (bool, u8, u64) {
    if is_long {
        // Long TP: mark >= tp_price
        if tp_price > 0 && mark_price >= tp_price {
            return (true, 1, tp_price);
        }
        // Long SL: mark <= sl_price
        if sl_price > 0 && mark_price <= sl_price {
            return (true, 2, sl_price);
        }
    } else {
        // Short TP: mark <= tp_price
        if tp_price > 0 && mark_price <= tp_price {
            return (true, 1, tp_price);
        }
        // Short SL: mark >= sl_price
        if sl_price > 0 && mark_price >= sl_price {
            return (true, 2, sl_price);
        }
    }
    (false, 0, 0)
}
