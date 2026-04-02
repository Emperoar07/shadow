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
            return Err(ShadowPerpError::InvalidComputationResult.into());
        }
    };

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
    // This callback records the trigger event and the order is removed from the book
    // by the on-chain keeper that called the instruction.
    msg!(
        "execute_private_order callback: triggered, size={}, entry_price={}, is_long={}",
        size,
        entry_price,
        is_long,
    );

    // Decrement active order count so the book slot is freed.
    let order_book = &mut ctx.accounts.private_order_book;
    if order_book.order_count > 0 {
        order_book.order_count = order_book.order_count.saturating_sub(1);
    }

    Ok(())
}
