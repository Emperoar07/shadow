use anchor_lang::prelude::*;

pub mod errors;
pub mod handlers;
pub mod state;

use handlers::*;

declare_id!("shad111111111111111111111111111111111111111");

#[program]
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
    pub fn open_position_callback(
        ctx: Context<OpenPositionCallback>,
        output: arcium_anchor::SignedComputationOutputs<open_position_callback::OpenPositionOutput>,
    ) -> Result<()> {
        handlers::callbacks::open_position_callback::handler(ctx, output)
    }

    /// Close an existing position - triggers PnL reveal
    pub fn close_position(
        ctx: Context<ClosePosition>,
        computation_offset: u64,
    ) -> Result<()> {
        handlers::close_position::handler(ctx, computation_offset)
    }

    /// Callback after position closing - reveals final PnL
    pub fn close_position_callback(
        ctx: Context<ClosePositionCallback>,
        output: arcium_anchor::SignedComputationOutputs<close_position_callback::ClosePositionOutput>,
    ) -> Result<()> {
        handlers::callbacks::close_position_callback::handler(ctx, output)
    }

    /// Check liquidation status (private health factor check)
    pub fn check_liquidation(
        ctx: Context<CheckLiquidation>,
        computation_offset: u64,
    ) -> Result<()> {
        handlers::check_liquidation::handler(ctx, computation_offset)
    }

    /// Callback after liquidation check
    pub fn liquidation_callback(
        ctx: Context<LiquidationCallback>,
        output: arcium_anchor::SignedComputationOutputs<liquidation_callback::LiquidationCheckOutput>,
    ) -> Result<()> {
        handlers::callbacks::liquidation_callback::handler(ctx, output)
    }

    /// Deposit collateral to margin account
    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        handlers::deposit_collateral::handler(ctx, amount)
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
