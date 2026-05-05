use crate::{ID, ID_CONST};
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{Market, PrivateOrderBook};

const COMP_DEF_OFFSET_EXECUTE_PRIVATE_ORDER: u32 =
    comp_def_offset("execute_private_order");

/// Callback accounts for the execute_private_order MPC computation.
#[callback_accounts("execute_private_order")]
#[derive(Accounts)]
pub struct ExecutePrivateOrderCallback<'info> {
    // Standard Arcium callback accounts
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_EXECUTE_PRIVATE_ORDER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: Validated by Arcium
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: Instructions sysvar
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    // Custom callback accounts
    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"private-orderbook", market.key().as_ref(), private_order_book.owner.as_ref()],
        bump = private_order_book.bump,
        constraint = private_order_book.market == market.key() @ ShadowPerpError::InvalidAccountData,
    )]
    pub private_order_book: Box<Account<'info, PrivateOrderBook>>,
}

/// Handler for the execute_private_order callback.
/// Circuit returns (bool, u64, u64, bool): (triggered, size, entry_price, is_long).
pub fn execute_private_order_callback_handler(
    ctx: Context<ExecutePrivateOrderCallback>,
    output: SignedComputationOutputs<ExecutePrivateOrderOutput>,
) -> Result<()> {
    // Validate cluster + comp-def bindings BEFORE verify_output to prevent forged accounts.
    require!(
        ctx.accounts.cluster_account.key() == ctx.accounts.market.mxe_cluster,
        ShadowPerpError::Unauthorized
    );
    require!(
        ctx.accounts.comp_def_account.key()
            == derive_comp_def_pda!(COMP_DEF_OFFSET_EXECUTE_PRIVATE_ORDER),
        ShadowPerpError::Unauthorized
    );

    let verified_output = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(o) => o,
        Err(error) => {
            msg!(
                "MPC verify failed for execute_private_order: {}",
                error
            );
            // Clear the pending binding so the order book isn't permanently stuck.
            let order_book = &mut ctx.accounts.private_order_book;
            if order_book.pending_computation_account == ctx.accounts.computation_account.key() {
                order_book.pending_computation_account = Pubkey::default();
                order_book.pending_order_index = 0;
                order_book.pending_order_is_bid = false;
            }
            return Ok(());
        }
    };

    // Verify this callback is consuming the exact computation that was authorised.
    let order_book = &mut ctx.accounts.private_order_book;
    require!(
        order_book.pending_computation_account != Pubkey::default(),
        ShadowPerpError::InvalidAccountData
    );
    require!(
        order_book.pending_computation_account == ctx.accounts.computation_account.key(),
        ShadowPerpError::InvalidAccountData
    );
    // Clear binding immediately — even if order was not triggered.
    order_book.pending_computation_account = Pubkey::default();
    order_book.pending_order_index = 0;
    order_book.pending_order_is_bid = false;

    // Extract circuit outputs: (triggered, size, entry_price, is_long)
    let triggered = verified_output.field_0.field_0;
    let size = verified_output.field_0.field_1;
    let entry_price = verified_output.field_0.field_2;
    let is_long = verified_output.field_0.field_3;

    if !triggered {
        msg!("execute_private_order callback: order not triggered at current price");
        return Ok(());
    }

    // Order triggered — log the execution parameters.
    // The actual position opening flows through the standard open_position path.
    msg!(
        "execute_private_order callback: triggered, size={}, entry_price={}, is_long={}",
        size,
        entry_price,
        is_long,
    );

    // Remove the triggered order from its vec so the slot is freed for future orders.
    // swap_remove is O(1) and preserves vec length invariants that total_orders() depends on.
    let idx = order_book.pending_order_index as usize;
    if order_book.pending_order_is_bid {
        if idx < order_book.bids.len() {
            order_book.bids.swap_remove(idx);
        }
    } else if idx < order_book.asks.len() {
        order_book.asks.swap_remove(idx);
    }

    if order_book.order_count > 0 {
        order_book.order_count = order_book.order_count.saturating_sub(1);
    }

    Ok(())
}
