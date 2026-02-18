use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

pub mod errors;
pub mod handlers;
pub mod state;

pub use handlers::__client_accounts_add_private_order;
pub use handlers::__client_accounts_check_liquidation;
pub use handlers::__client_accounts_check_liquidation_callback;
pub use handlers::__client_accounts_close_position;
pub use handlers::__client_accounts_close_position_callback;
pub use handlers::__client_accounts_deposit_collateral;
pub use handlers::__client_accounts_init_close_position_comp_def;
pub use handlers::__client_accounts_init_liquidation_comp_def;
pub use handlers::__client_accounts_init_open_position_comp_def;
pub use handlers::__client_accounts_init_private_order_book;
pub use handlers::__client_accounts_initialize;
pub use handlers::__client_accounts_open_position;
pub use handlers::__client_accounts_open_position_callback;
pub use handlers::__client_accounts_update_price;
pub use handlers::__client_accounts_withdraw_collateral;

use errors::ErrorCode;
use handlers::callbacks::close_position_callback::ClosePositionCallback;
use handlers::callbacks::liquidation_callback::CheckLiquidationCallback;
use handlers::callbacks::open_position_callback::OpenPositionCallback;
use handlers::check_liquidation::CheckLiquidation;
use handlers::close_position::ClosePosition;
use handlers::deposit_collateral::DepositCollateral;
use handlers::init_comp_defs::{
    InitClosePositionCompDef, InitLiquidationCompDef, InitOpenPositionCompDef,
};
use handlers::initialize::Initialize;
use handlers::open_position::OpenPosition;
use handlers::private_orders::{AddPrivateOrder, InitPrivateOrderBook};
use handlers::update_price::UpdatePrice;
use handlers::withdraw_collateral::WithdrawCollateral;

declare_id!("11111111111111111111111111111111");

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
    pub fn init_open_position_comp_def(ctx: Context<InitOpenPositionCompDef>) -> Result<()> {
        handlers::init_comp_defs::init_open_position_handler(ctx)
    }

    pub fn init_close_position_comp_def(ctx: Context<InitClosePositionCompDef>) -> Result<()> {
        handlers::init_comp_defs::init_close_position_handler(ctx)
    }

    pub fn init_liquidation_comp_def(ctx: Context<InitLiquidationCompDef>) -> Result<()> {
        handlers::init_comp_defs::init_liquidation_handler(ctx)
    }

    /// Open a new encrypted position
    pub fn open_position(
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
        handlers::open_position::handler(
            ctx,
            encrypted_size,
            encrypted_entry_price,
            encrypted_leverage,
            encrypted_is_long,
            encrypted_margin,
            encrypted_owner_lo,
            encrypted_owner_hi,
            margin,
            client_pubkey,
            nonce,
            computation_offset,
        )
    }

    /// Callback after position opening MPC completes
    #[arcium_callback(encrypted_ix = "open_position")]
    pub fn open_position_callback(
        ctx: Context<OpenPositionCallback>,
        output: SignedComputationOutputs<OpenPositionOutput>,
    ) -> Result<()> {
        handlers::callbacks::open_position_callback::open_position_callback_handler(ctx, output)
    }

    /// Close an existing position - triggers PnL reveal
    pub fn close_position(
        ctx: Context<ClosePosition>,
        computation_offset: u64,
    ) -> Result<()> {
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
