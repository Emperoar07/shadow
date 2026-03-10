use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

pub mod errors;
pub mod handlers;
pub mod state;

use handlers::check_liquidation::__client_accounts_check_liquidation;
use handlers::close_position::__client_accounts_close_position;
use handlers::deposit_collateral::__client_accounts_deposit_collateral;
use handlers::init_arcium_signer::__client_accounts_init_arcium_signer;
use handlers::init_comp_defs::__client_accounts_init_close_position_comp_def;
use handlers::init_comp_defs::__client_accounts_init_liquidation_comp_def;
use handlers::init_comp_defs::__client_accounts_init_open_position_comp_def;
use handlers::init_comp_defs::__client_accounts_init_seed_open_interest_comp_def;
use handlers::initialize::__client_accounts_initialize;
use handlers::open_position::__client_accounts_open_position;
use handlers::private_orders::__client_accounts_add_private_order;
use handlers::private_orders::__client_accounts_init_private_order_book;
use handlers::seed_open_interest_state::__client_accounts_seed_open_interest_state;
use handlers::session_trading::__client_accounts_close_position_with_session;
use handlers::session_trading::__client_accounts_create_trade_session;
use handlers::session_trading::__client_accounts_deposit_collateral_with_session;
use handlers::session_trading::__client_accounts_open_position_with_session;
use handlers::session_trading::__client_accounts_revoke_trade_session;
use handlers::session_trading::__client_accounts_withdraw_collateral_with_session;
use handlers::settle_close_position::__client_accounts_settle_close_position;
use handlers::settle_liquidation::__client_accounts_settle_liquidation;
use handlers::sync_comp_defs::__client_accounts_sync_comp_defs;
use handlers::update_mxe_cluster::__client_accounts_update_mxe_cluster;
use handlers::update_price::__client_accounts_update_price;
use handlers::withdraw_collateral::__client_accounts_withdraw_collateral;
use handlers::callbacks::__client_accounts_check_liquidation_callback;
use handlers::callbacks::__client_accounts_close_position_v2_callback;
use handlers::callbacks::__client_accounts_open_position_probe_b_callback;
use handlers::callbacks::__client_accounts_seed_open_interest_state_v3_callback;
#[cfg(feature = "shielded-collateral")]
use handlers::shielded_collateral::__client_accounts_set_shielded_collateral_feature;
#[cfg(feature = "shielded-collateral")]
use handlers::shielded_collateral::__client_accounts_init_shielded_pool;

use handlers::callbacks::close_position_callback::ClosePositionV2Callback;
pub use handlers::callbacks::close_position_callback::ClosePositionV2Output;
use handlers::callbacks::liquidation_callback::CheckLiquidationCallback;
pub use handlers::callbacks::liquidation_callback::CheckLiquidationOutput;
use handlers::callbacks::open_position_callback::OpenPositionProbeBCallback;
pub use handlers::callbacks::open_position_callback::OpenPositionProbeBOutput;
use handlers::callbacks::seed_open_interest_state_callback::SeedOpenInterestStateV3Callback;
pub use handlers::callbacks::seed_open_interest_state_callback::SeedOpenInterestStateV3Output;
use handlers::check_liquidation::CheckLiquidation;
use handlers::close_position::ClosePosition;
use handlers::deposit_collateral::DepositCollateral;
use handlers::init_arcium_signer::InitArciumSigner;
use handlers::init_comp_defs::{
    InitClosePositionCompDef, InitLiquidationCompDef, InitOpenPositionCompDef,
    InitSeedOpenInterestCompDef,
};
use handlers::initialize::Initialize;
use handlers::open_position::OpenPosition;
use handlers::private_orders::{AddPrivateOrder, InitPrivateOrderBook};
use handlers::seed_open_interest_state::SeedOpenInterestState;
use handlers::session_trading::{
    ClosePositionWithSession,
    CreateTradeSession,
    DepositCollateralWithSession,
    OpenPositionWithSession,
    RevokeTradeSession,
    WithdrawCollateralWithSession,
};
#[cfg(feature = "shielded-collateral")]
use handlers::shielded_collateral::{InitShieldedPool, SetShieldedCollateralFeature};
use handlers::settle_close_position::SettleClosePosition;
use handlers::settle_liquidation::SettleLiquidation;
use handlers::sync_comp_defs::SyncCompDefs;
use handlers::update_mxe_cluster::UpdateMxeCluster;
use handlers::update_price::UpdatePrice;
use handlers::withdraw_collateral::WithdrawCollateral;

declare_id!("2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az");

#[arcium_program]
pub mod shadowperp {
    use super::*;

    /// Initialize the protocol with market parameters
    pub fn initialize(
        ctx: Context<Initialize>,
        max_leverage: u8,
        liquidation_threshold: u16,
        trading_fee: u16,
    ) -> Result<()> {
        handlers::initialize::handler(ctx, max_leverage, liquidation_threshold, trading_fee)
    }

    /// Initialize computation definitions for MPC operations
    pub fn init_arcium_signer(ctx: Context<InitArciumSigner>) -> Result<()> {
        handlers::init_arcium_signer::handler(ctx)
    }

    /// Initialize computation definitions for MPC operations
    pub fn init_open_position_comp_def(ctx: Context<InitOpenPositionCompDef>) -> Result<()> {
        handlers::init_comp_defs::init_open_position_handler(ctx)
    }

    pub fn init_close_position_comp_def(ctx: Context<InitClosePositionCompDef>) -> Result<()> {
        handlers::init_comp_defs::init_close_position_handler(ctx)
    }

    pub fn init_liquidation_comp_def(ctx: Context<InitLiquidationCompDef>) -> Result<()> {
        handlers::init_comp_defs::init_liquidation_handler(ctx)
    }

    pub fn init_seed_open_interest_comp_def(
        ctx: Context<InitSeedOpenInterestCompDef>,
    ) -> Result<()> {
        handlers::init_comp_defs::init_seed_open_interest_handler(ctx)
    }

    /// Initialize shielded collateral scaffolding accounts (feature-gated).
    /// This does not alter current public deposit/withdraw flow.
    #[cfg(feature = "shielded-collateral")]
    pub fn init_shielded_pool(
        ctx: Context<InitShieldedPool>,
        enable_private_collateral: bool,
    ) -> Result<()> {
        handlers::shielded_collateral::init_shielded_pool_handler(
            ctx,
            enable_private_collateral,
        )
    }

    /// Toggle shielded collateral activation bit on an initialized pool.
    #[cfg(feature = "shielded-collateral")]
    pub fn set_shielded_collateral_feature(
        ctx: Context<SetShieldedCollateralFeature>,
        enabled: bool,
    ) -> Result<()> {
        handlers::shielded_collateral::set_shielded_collateral_feature_handler(ctx, enabled)
    }

    /// Sync market comp-def pointers to already-initialized Arcium accounts.
    pub fn sync_comp_defs(ctx: Context<SyncCompDefs>) -> Result<()> {
        handlers::sync_comp_defs::handler(ctx)
    }

    /// Update the MXE cluster address stored in the market (admin only).
    pub fn update_mxe_cluster(ctx: Context<UpdateMxeCluster>) -> Result<()> {
        handlers::update_mxe_cluster::handler(ctx)
    }

    /// Open a new encrypted position
    pub fn open_position(
        ctx: Context<OpenPosition>,
        encrypted_size: [u8; 32],
        encrypted_entry_price: [u8; 32],
        encrypted_leverage: [u8; 32],
        encrypted_is_long: [u8; 32],
        encrypted_margin: [u8; 32],
        margin_mode: u8,
        margin: u64,
        client_pubkey: [u8; 32],
        nonce: u128,
        computation_offset: u64,
    ) -> Result<()> {
        handlers::open_position::handler(
            ctx,
            encrypted_size,
            encrypted_entry_price,
            encrypted_leverage,
            encrypted_is_long,
            encrypted_margin,
            margin_mode,
            margin,
            client_pubkey,
            nonce,
            computation_offset,
        )
    }

    /// Bootstrap the market with a valid MXE-owned encrypted zero OI state.
    pub fn seed_open_interest_state(
        ctx: Context<SeedOpenInterestState>,
        computation_offset: u64,
    ) -> Result<()> {
        handlers::seed_open_interest_state::handler(ctx, computation_offset)
    }

    /// Create an owner-approved delegated trading session for a relayer.
    pub fn create_trade_session(
        ctx: Context<CreateTradeSession>,
        session_id: u64,
        relayer: Pubkey,
        max_actions: u32,
        max_margin_per_action: u64,
        expires_at: i64,
    ) -> Result<()> {
        handlers::session_trading::create_trade_session_handler(
            ctx,
            session_id,
            relayer,
            max_actions,
            max_margin_per_action,
            expires_at,
        )
    }

    /// Owner can revoke a delegated trading session at any time.
    pub fn revoke_trade_session(ctx: Context<RevokeTradeSession>) -> Result<()> {
        handlers::session_trading::revoke_trade_session_handler(ctx)
    }

    /// Relayer opens an encrypted position under an active owner-approved session.
    pub fn open_position_with_session(
        ctx: Context<OpenPositionWithSession>,
        encrypted_size: [u8; 32],
        encrypted_entry_price: [u8; 32],
        encrypted_leverage: [u8; 32],
        encrypted_is_long: [u8; 32],
        encrypted_margin: [u8; 32],
        margin_mode: u8,
        margin: u64,
        client_pubkey: [u8; 32],
        nonce: u128,
        computation_offset: u64,
    ) -> Result<()> {
        handlers::session_trading::open_position_with_session_handler(
            ctx,
            encrypted_size,
            encrypted_entry_price,
            encrypted_leverage,
            encrypted_is_long,
            encrypted_margin,
            margin_mode,
            margin,
            client_pubkey,
            nonce,
            computation_offset,
        )
    }

    /// Callback after position opening MPC completes
    #[arcium_callback(encrypted_ix = "open_position_probe_b")]
    pub fn open_position_probe_b_callback(
        ctx: Context<OpenPositionProbeBCallback>,
        output: SignedComputationOutputs<OpenPositionProbeBOutput>,
    ) -> Result<()> {
        handlers::callbacks::open_position_callback::open_position_callback_handler(ctx, output)
    }

    #[arcium_callback(encrypted_ix = "seed_open_interest_state_v3")]
    pub fn seed_open_interest_state_v3_callback(
        ctx: Context<SeedOpenInterestStateV3Callback>,
        output: SignedComputationOutputs<SeedOpenInterestStateV3Output>,
    ) -> Result<()> {
        handlers::callbacks::seed_open_interest_state_callback::seed_open_interest_state_v3_callback_handler(ctx, output)
    }

    /// Close an existing position - triggers PnL reveal
    pub fn close_position(ctx: Context<ClosePosition>, computation_offset: u64) -> Result<()> {
        handlers::close_position::handler(ctx, computation_offset)
    }

    /// Relayer closes an encrypted position under an active owner-approved session.
    pub fn close_position_with_session(
        ctx: Context<ClosePositionWithSession>,
        computation_offset: u64,
    ) -> Result<()> {
        handlers::session_trading::close_position_with_session_handler(ctx, computation_offset)
    }

    /// Callback after position closing - reveals final PnL
    #[arcium_callback(encrypted_ix = "close_position_v2")]
    pub fn close_position_v2_callback(
        ctx: Context<ClosePositionV2Callback>,
        output: SignedComputationOutputs<ClosePositionV2Output>,
    ) -> Result<()> {
        handlers::callbacks::close_position_callback::close_position_callback_handler(ctx, output)
    }

    /// Check liquidation status (private health factor check)
    pub fn check_liquidation(
        ctx: Context<CheckLiquidation>,
        computation_offset: u64,
    ) -> Result<()> {
        handlers::check_liquidation::handler(ctx, computation_offset)
    }

    /// Callback after liquidation check
    #[arcium_callback(encrypted_ix = "check_liquidation")]
    pub fn check_liquidation_callback(
        ctx: Context<CheckLiquidationCallback>,
        output: SignedComputationOutputs<CheckLiquidationOutput>,
    ) -> Result<()> {
        handlers::callbacks::liquidation_callback::check_liquidation_callback_handler(ctx, output)
    }

    /// Settle a closed position — transfers tokens from vault to owner.
    /// Called after the close_position callback sets status to ClosedPendingSettlement.
    pub fn settle_close_position(ctx: Context<SettleClosePosition>) -> Result<()> {
        handlers::settle_close_position::handler(ctx)
    }

    /// Settle a liquidated position — transfers penalty from vault to liquidator.
    /// Called after the check_liquidation callback sets status to LiquidatedPendingSettlement.
    pub fn settle_liquidation(ctx: Context<SettleLiquidation>) -> Result<()> {
        handlers::settle_liquidation::handler(ctx)
    }

    /// Deposit collateral to margin account
    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        handlers::deposit_collateral::handler(ctx, amount)
    }

    /// Relayer withdraws collateral for owner under an active delegated session.
    pub fn withdraw_collateral_with_session(
        ctx: Context<WithdrawCollateralWithSession>,
        amount: u64,
    ) -> Result<()> {
        handlers::session_trading::withdraw_collateral_with_session_handler(ctx, amount)
    }

    /// Relayer deposits collateral for owner under an active delegated session.
    /// Requires prior SPL token delegate approval from owner to relayer.
    pub fn deposit_collateral_with_session(
        ctx: Context<DepositCollateralWithSession>,
        amount: u64,
    ) -> Result<()> {
        handlers::session_trading::deposit_collateral_with_session_handler(ctx, amount)
    }

    /// Initialize a user-scoped encrypted private orderbook account.
    pub fn init_private_order_book(ctx: Context<InitPrivateOrderBook>) -> Result<()> {
        handlers::private_orders::init_private_order_book_handler(ctx)
    }

    /// Queue an encrypted private order payload on-chain.
    pub fn add_private_order(
        ctx: Context<AddPrivateOrder>,
        is_bid: bool,
        encrypted_size: [u8; 32],
        encrypted_price: [u8; 32],
        encrypted_owner_lo: [u8; 32],
        encrypted_owner_hi: [u8; 32],
        nonce: [u8; 16],
    ) -> Result<()> {
        handlers::private_orders::add_private_order_handler(
            ctx,
            is_bid,
            encrypted_size,
            encrypted_price,
            encrypted_owner_lo,
            encrypted_owner_hi,
            nonce,
        )
    }

    /// Withdraw collateral from margin account
    pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
        handlers::withdraw_collateral::handler(ctx, amount)
    }

    /// Update oracle price (authorized feeder only)
    pub fn update_price(ctx: Context<UpdatePrice>, price: u64) -> Result<()> {
        handlers::update_price::handler(ctx, price)
    }
}
