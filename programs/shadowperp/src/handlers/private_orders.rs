use anchor_lang::prelude::*;

use crate::errors::ShadowPerpError;
use crate::state::{
    EncryptedOrder, Market, PrivateOrderBook, PrivateOrderBookInitialized, PrivateOrderQueued,
    MAX_PRIVATE_ORDERS,
};

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

    // TODO: Wire queue_computation to Arcium MXE callback flow once comp-def is finalized.
    emit!(PrivateOrderQueued {
        owner: order_book.owner,
        market: order_book.market,
        order_index: order_book.order_count - 1,
        timestamp: now,
    });

    Ok(())
}
