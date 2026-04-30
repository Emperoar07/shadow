//! TP/SL order handlers:
//!   - `set_tpsl`      — owner-only, creates/updates TpSlOrder PDA
//!   - `cancel_tpsl`   — owner-only, deactivates TpSlOrder
//!   - `trigger_tpsl`  — permissionless keeper, checks mark_price and queues MPC close

use crate::ArciumSignerAccount;
use crate::ID;
use crate::ID_CONST;
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{
    MarginAccount, Market, Position, TpSlOrder, TpSlOrderCancelled,
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
// See audit 2026-04-29 §WT-8 and the close_position_v2 settlement flow.
pub fn set_tpsl_handler(
    ctx: Context<SetTpSl>,
    tp_price: u64,
    sl_price: u64,
    is_long: bool,
) -> Result<()> {
    let _ = (&ctx, tp_price, sl_price, is_long);
    err!(ShadowPerpError::TpSlPrivateDirectionUnsupported)
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

// STUB — pair of set_tpsl_handler. See note above for why this is disabled.
pub fn trigger_tpsl_handler(
    ctx: Context<TriggerTpSl>,
    computation_offset: u64,
) -> Result<()> {
    let _ = (&ctx, computation_offset);
    err!(ShadowPerpError::TpSlPrivateDirectionUnsupported)
}
