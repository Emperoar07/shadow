use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_anchor::traits::CallbackCompAccs;
use anchor_spl::token::TokenAccount;
use arcium_client::idl::arcium::types::CallbackAccount;
use crate::{ID, ID_CONST};
use crate::ArciumSignerAccount;

use crate::errors::ShadowPerpError;
use crate::state::{MarginAccount, Market, Position, PositionStatus};

use crate::handlers::callbacks::liquidation_callback::CheckLiquidationCallback;

#[queue_computation_accounts("check_liquidation", liquidator)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CheckLiquidation<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = market,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        constraint = liquidator_token_account.owner == liquidator.key(),
        constraint = liquidator_token_account.mint == market.collateral_mint
    )]
    pub liquidator_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        constraint = vault.key() == market.vault
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"margin", market.key().as_ref(), position.owner.as_ref()],
        bump = margin_account.bump,
    )]
    pub margin_account: Account<'info, MarginAccount>,

    // --- Arcium accounts ---
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    /// Cluster must match the one recorded in the market at initialisation.
    #[account(mut, constraint = cluster_account.key() == market.mxe_cluster @ ShadowPerpError::Unauthorized)]
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
    ctx: Context<CheckLiquidation>,
    computation_offset: u64,
) -> Result<()> {
    let market = &ctx.accounts.market;
    let position = &mut ctx.accounts.position;
    let clock = Clock::get()?;

    // Validate position is open
    require!(
        position.status == PositionStatus::Open,
        ShadowPerpError::PositionNotOpen
    );

    // Validate price is not stale (within 60 seconds)
    let price_age = clock.unix_timestamp - market.last_price_update;
    require!(price_age < 60, ShadowPerpError::StalePrice);

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
    let encrypted_owner_lo: [u8; 32] = position.encrypted_data[160..192]
        .try_into()
        .map_err(|_| error!(ShadowPerpError::InvalidAccountData))?;
    let encrypted_owner_hi: [u8; 32] = position.encrypted_data[192..224]
        .try_into()
        .map_err(|_| error!(ShadowPerpError::InvalidAccountData))?;

    // Build arguments for liquidation check MPC circuit
    // position: Enc<Mxe, Position> - encrypted position data
    // mark_price: u64 - plaintext current price
    // market_params: MarketParams - plaintext
    let args = ArgBuilder::new()
        // position: Enc<Mxe, Position>
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_size)   // size
        .encrypted_u64(encrypted_entry_price)  // entry_price
        .encrypted_u8(encrypted_leverage)   // leverage
        .encrypted_bool(encrypted_is_long) // is_long
        .encrypted_u64(encrypted_margin) // margin
        .encrypted_u128(encrypted_owner_lo) // owner_lo
        .encrypted_u128(encrypted_owner_hi) // owner_hi
        // mark_price: u64 (plaintext)
        .plaintext_u64(mark_price)
        // market_params: MarketParams (plaintext)
        .plaintext_u8(market.max_leverage)
        .plaintext_u16(market.liquidation_threshold)
        .plaintext_u16(market.trading_fee)
        .plaintext_u64(mark_price)
        .build();

    // Build callback - only receives boolean result
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
            pubkey: ctx.accounts.liquidator.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: ctx.accounts.liquidator_token_account.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: ctx.accounts.margin_account.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: ctx.accounts.vault.key(),
            is_writable: true,
        },
    ];

    // Bind to the specific computation account so the callback can verify it is consuming
    // output from the exact liquidation computation that was authorised for this position.
    // If multiple concurrent liquidation checks are submitted, the last one wins — earlier
    // callbacks will fail the key check and return, which is safe and preferable.
    position.pending_computation_account = ctx.accounts.computation_account.key();
    drop(position);
    drop(market);

    let callback_ix = CheckLiquidationCallback::callback_ix(
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
