use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

pub mod errors;
pub mod handlers;
pub mod state;

use handlers::__client_accounts_add_private_order;
use handlers::__client_accounts_check_liquidation;
use handlers::__client_accounts_check_liquidation_callback;
use handlers::__client_accounts_close_position;
use handlers::__client_accounts_close_position_callback;
use handlers::__client_accounts_deposit_collateral;
use handlers::__client_accounts_init_arcium_signer;
use handlers::__client_accounts_init_close_position_comp_def;
use handlers::__client_accounts_init_liquidation_comp_def;
use handlers::__client_accounts_init_open_position_comp_def;
use handlers::__client_accounts_init_private_order_book;
use handlers::__client_accounts_initialize;
use handlers::__client_accounts_open_position;
use handlers::__client_accounts_open_position_v2_callback;
#[cfg(feature = "shielded-collateral")]
use handlers::__client_accounts_set_shielded_collateral_feature;
#[cfg(feature = "shielded-collateral")]
use handlers::__client_accounts_init_shielded_pool;
use handlers::__client_accounts_sync_comp_defs;
use handlers::__client_accounts_update_price;
use handlers::__client_accounts_withdraw_collateral;

use errors::ErrorCode;
use handlers::callbacks::close_position_callback::ClosePositionCallback;
pub use handlers::callbacks::close_position_callback::ClosePositionOutput;
use handlers::callbacks::liquidation_callback::CheckLiquidationCallback;
pub use handlers::callbacks::liquidation_callback::CheckLiquidationOutput;
use handlers::callbacks::open_position_callback::OpenPositionV2Callback;
pub use handlers::callbacks::open_position_callback::OpenPositionOutput;
use handlers::check_liquidation::CheckLiquidation;
use handlers::close_position::ClosePosition;
use handlers::deposit_collateral::DepositCollateral;
use handlers::init_arcium_signer::InitArciumSigner;
use handlers::init_comp_defs::{
    InitClosePositionCompDef, InitLiquidationCompDef, InitOpenPositionCompDef,
};
use handlers::initialize::Initialize;
use handlers::open_position::OpenPosition;
use handlers::private_orders::{AddPrivateOrder, InitPrivateOrderBook};
#[cfg(feature = "shielded-collateral")]
use handlers::shielded_collateral::{InitShieldedPool, SetShieldedCollateralFeature};
use handlers::sync_comp_defs::SyncCompDefs;
use handlers::update_price::UpdatePrice;
use handlers::withdraw_collateral::WithdrawCollateral;

declare_id!("2Gz35PAHBkggSfV77mCENobt5YEURuYMAjgpvKXoL61d");

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

    /// Open a new encrypted position
    pub fn open_position(
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
        handlers::open_position::handler(
            ctx,
            encrypted_size,
            encrypted_entry_price,
            encrypted_leverage,
            encrypted_is_long,
            encrypted_margin,
            margin,
            client_pubkey,
            nonce,
            computation_offset,
        )
    }

    /// Callback after position opening MPC completes
    #[arcium_callback(encrypted_ix = "open_position_v2", auto_serialize = false)]
    pub fn open_position_v2_callback(
        ctx: Context<OpenPositionV2Callback>,
        output: SignedComputationOutputs<OpenPositionOutput>,
    ) -> Result<()> {
        handlers::callbacks::open_position_callback::open_position_callback_handler(ctx, output)
    }

    /// Close an existing position - triggers PnL reveal
    pub fn close_position(ctx: Context<ClosePosition>, computation_offset: u64) -> Result<()> {
        handlers::close_position::handler(ctx, computation_offset)
    }

    /// Callback after position closing - reveals final PnL
    #[arcium_callback(encrypted_ix = "close_position")]
    pub fn close_position_callback(
        ctx: Context<ClosePositionCallback>,
        output: SignedComputationOutputs<ClosePositionOutput>,
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

    /// Deposit collateral to margin account
    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        handlers::deposit_collateral::handler(ctx, amount)
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
