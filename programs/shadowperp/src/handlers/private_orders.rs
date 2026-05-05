use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_anchor::traits::CallbackCompAccs;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{
    EncryptedOrder, Market, PrivateOrderBook, PrivateOrderBookInitialized, PrivateOrderQueued,
    MAX_PRIVATE_ORDERS,
};
use crate::ArciumSignerAccount;
use crate::ID;
use crate::ID_CONST;
use crate::handlers::callbacks::execute_private_order_callback::ExecutePrivateOrderCallback;

const COMP_DEF_OFFSET_EXECUTE_PRIVATE_ORDER: u32 = comp_def_offset("execute_private_order");

#[derive(Accounts)]
pub struct InitPrivateOrderBook<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = owner,
        space = PrivateOrderBook::LEN,
        seeds = [b"private-orderbook", market.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub private_order_book: Account<'info, PrivateOrderBook>,

    pub system_program: Program<'info, System>,
}

pub fn init_private_order_book_handler(ctx: Context<InitPrivateOrderBook>) -> Result<()> {
    let order_book = &mut ctx.accounts.private_order_book;
    order_book.owner = ctx.accounts.owner.key();
    order_book.market = ctx.accounts.market.key();
    order_book.order_count = 0;
    order_book.bids = Vec::new();
    order_book.asks = Vec::new();
    order_book.bump = ctx.bumps.private_order_book;

    emit!(PrivateOrderBookInitialized {
        owner: order_book.owner,
        market: order_book.market,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct AddPrivateOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        has_one = owner @ ShadowPerpError::Unauthorized,
        has_one = market @ ShadowPerpError::InvalidAccountData,
        seeds = [b"private-orderbook", market.key().as_ref(), owner.key().as_ref()],
        bump = private_order_book.bump
    )]
    pub private_order_book: Account<'info, PrivateOrderBook>,
}

pub fn add_private_order_handler(
    ctx: Context<AddPrivateOrder>,
    is_bid: bool,
    encrypted_size: [u8; 32],
    encrypted_price: [u8; 32],
    encrypted_owner_lo: [u8; 32],
    encrypted_owner_hi: [u8; 32],
    nonce: [u8; 16],
) -> Result<()> {
    let order_book = &mut ctx.accounts.private_order_book;
    require!(
        order_book.total_orders() < MAX_PRIVATE_ORDERS,
        ShadowPerpError::InvalidAccountData
    );

    let now = Clock::get()?.unix_timestamp;
    let order = EncryptedOrder {
        encrypted_size,
        encrypted_price,
        encrypted_owner_lo,
        encrypted_owner_hi,
        nonce,
        created_at: now,
    };

    if is_bid {
        order_book.bids.push(order);
    } else {
        order_book.asks.push(order);
    }
    order_book.order_count = order_book
        .order_count
        .checked_add(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    emit!(PrivateOrderQueued {
        owner: order_book.owner,
        market: order_book.market,
        order_index: order_book.order_count - 1,
        timestamp: now,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// execute_private_order
// Called by a keeper when the market price may have crossed a limit trigger.
// Queues an Arcium MPC computation that evaluates the trigger condition on
// the encrypted order and reveals the order parameters only if triggered.
// ---------------------------------------------------------------------------

#[queue_computation_accounts("execute_private_order", owner)]
#[derive(Accounts)]
#[instruction(
    order_index: u32,
    is_bid: bool,
    client_pubkey: [u8; 32],
    nonce: u128,
    computation_offset: u64,
)]
pub struct ExecutePrivateOrder<'info> {
    /// The order owner (must sign to authorize execution).
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        has_one = owner @ ShadowPerpError::Unauthorized,
        has_one = market @ ShadowPerpError::InvalidAccountData,
        seeds = [b"private-orderbook", market.key().as_ref(), owner.key().as_ref()],
        bump = private_order_book.bump,
        realloc = PrivateOrderBook::LEN,
        realloc::payer = owner,
        realloc::zero = true,
    )]
    pub private_order_book: Account<'info, PrivateOrderBook>,

    // --- Arcium accounts (populated by queue_computation_accounts macro) ---
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_EXECUTE_PRIVATE_ORDER))]
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
        payer = owner,
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

pub fn execute_private_order_handler(
    ctx: Context<ExecutePrivateOrder>,
    order_index: u32,
    is_bid: bool,
    client_pubkey: [u8; 32],
    nonce: u128,
    computation_offset: u64,
) -> Result<()> {
    require!(computation_offset > 0, ShadowPerpError::InvalidAccountData);

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    // Reject if a previous execution is still pending MPC settlement.
    require!(
        ctx.accounts.private_order_book.pending_computation_account == Pubkey::default(),
        ShadowPerpError::ComputationInProgress
    );

    let order_book = &ctx.accounts.private_order_book;
    let market = &ctx.accounts.market;

    // Validate oracle freshness before evaluating trigger
    let clock = Clock::get()?;
    let price_age = clock.unix_timestamp.saturating_sub(market.last_price_update);
    require!(price_age < 300, ShadowPerpError::StalePrice);
    require!(market.oracle_price > 0, ShadowPerpError::InvalidPrice);

    // Retrieve the specified order from the book
    let orders = if is_bid { &order_book.bids } else { &order_book.asks };
    let order_idx = order_index as usize;
    require!(order_idx < orders.len(), ShadowPerpError::InvalidAccountData);
    let order = &orders[order_idx];

    // Circuit: execute_private_order(order: Enc<Shared,(u64,u64,bool)>, mark_price: u64)
    // The encrypted order was stored as:
    //   encrypted_size  → enc_size
    //   encrypted_price → enc_trigger_price
    //   encrypted_owner_lo (first 32 bytes) reused as encrypted direction (bool)
    //
    // ArgBuilder layout:
    //   order: Enc<Shared, (u64, u64, bool)>
    //     1. x25519_pubkey
    //     2. plaintext_u128 nonce
    //     3. encrypted_u64  size
    //     4. encrypted_u64  trigger_price
    //     5. encrypted_bool is_long
    //   mark_price: u64 (plaintext)
    let args = ArgBuilder::new()
        .x25519_pubkey(client_pubkey)
        .plaintext_u128(nonce)
        .encrypted_u64(order.encrypted_size)
        .encrypted_u64(order.encrypted_price)
        .encrypted_bool(order.encrypted_owner_lo) // direction encoded here by client
        .plaintext_u64(market.oracle_price)
        .build();

    let callback_accounts = vec![
        CallbackAccount {
            pubkey: market.key(),
            is_writable: false,
        },
        CallbackAccount {
            pubkey: order_book.key(),
            is_writable: true,
        },
    ];

    let callback_ix = ExecutePrivateOrderCallback::callback_ix(
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

    // Bind the computation account + order coordinates so the callback can verify
    // replay safety and remove the exact order from the vec on trigger.
    ctx.accounts.private_order_book.pending_computation_account =
        ctx.accounts.computation_account.key();
    ctx.accounts.private_order_book.pending_order_index = order_index;
    ctx.accounts.private_order_book.pending_order_is_bid = is_bid;

    msg!(
        "execute_private_order: queued order_index={}, is_bid={}, mark_price={}",
        order_index,
        is_bid,
        market.oracle_price,
    );

    Ok(())
}
