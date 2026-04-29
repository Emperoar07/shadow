use crate::ArciumSignerAccount;
use crate::ID;
use crate::ID_CONST;
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_anchor::traits::CallbackCompAccs;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{
    LiquidationSettlement, MarginAccount, Market, Position, PositionStatus,
};

use crate::handlers::callbacks::liquidation_callback::CheckLiquidationV2Callback;

#[queue_computation_accounts("check_liquidation_v2", liquidator)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CheckLiquidation<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
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
        seeds = [b"margin", position.owner.as_ref()],
        bump = margin_account.bump,
    )]
    pub margin_account: Box<Account<'info, MarginAccount>>,

    #[account(
        init_if_needed,
        payer = liquidator,
        space = LiquidationSettlement::LEN,
        seeds = [b"liquidation_settlement", position.key().as_ref()],
        bump
    )]
    pub liquidation_settlement: Box<Account<'info, LiquidationSettlement>>,

    // --- Arcium accounts ---
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(address = market.liquidation_comp_def)]
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
        payer = liquidator,
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

pub fn handler(ctx: Context<CheckLiquidation>, computation_offset: u64) -> Result<()> {
    // Required by Arcium queue flow when this account is initialized on demand.
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    require!(computation_offset > 0, ShadowPerpError::InvalidAccountData);

    let market = &ctx.accounts.market;
    let position = &mut ctx.accounts.position;
    let liquidation_settlement = &mut ctx.accounts.liquidation_settlement;
    let clock = Clock::get()?;

    // Validate position is open
    require!(
        position.status == PositionStatus::Open,
        ShadowPerpError::PositionNotOpen
    );
    // Validate price is not stale (within 300 seconds)
    let price_age = clock.unix_timestamp.saturating_sub(market.last_price_update);
    require!(price_age < 300, ShadowPerpError::StalePrice);

    let mark_price = market.oracle_price;
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

    // Build arguments for liquidation check MPC circuit
    // position: Enc<Shared, Position> - encrypted position data (client x25519 key)
    // mark_price: u64 - plaintext current price
    // liquidation_threshold_bps: only market field used by the liquidation circuit
    let args = ArgBuilder::new()
        // position: Enc<Shared, Position> - client x25519 key needed for decryption
        .x25519_pubkey(position.client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_size) // size
        .encrypted_u64(encrypted_entry_price) // entry_price
        .encrypted_u8(encrypted_leverage) // leverage
        .encrypted_u8(encrypted_is_long) // is_long
        .encrypted_u64(encrypted_margin) // margin
        // mark_price: u64 (plaintext)
        .plaintext_u64(mark_price)
        // liquidation_threshold_bps: only market field needed by the liquidation circuit
        .plaintext_u16(market.liquidation_threshold)
        .build();

    // Build callback accounts (3 only — token settlement deferred to settle_liquidation)
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

    liquidation_settlement.position = position.key();
    liquidation_settlement.liquidator = ctx.accounts.liquidator.key();
    liquidation_settlement.bump = ctx.bumps.liquidation_settlement;

    // Bind to the specific computation account so the callback can verify it is consuming
    // output from the exact liquidation computation that was authorised for this position.
    // This helper enforces strict one-at-a-time lifecycle semantics.
    position.begin_pending_computation(
        ctx.accounts.computation_account.key(),
        Position::CALLBACK_KIND_LIQUIDATION,
        computation_offset,
    )?;

    let callback_ix = CheckLiquidationV2Callback::callback_ix(
        computation_offset,
        &ctx.accounts.mxe_account,
        &callback_accounts,
    )?;

    // Queue liquidation check computation
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
