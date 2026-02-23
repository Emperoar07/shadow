use crate::ArciumSignerAccount;
use crate::ID;
use crate::ID_CONST;
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use arcium_anchor::prelude::*;
use arcium_anchor::traits::CallbackCompAccs;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{MarginAccount, Market, Position, PositionStatus};

use crate::handlers::callbacks::close_position_callback::ClosePositionCallback;

#[queue_computation_accounts("close_position", owner)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = owner,
        has_one = market,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        seeds = [b"margin", market.key().as_ref(), owner.key().as_ref()],
        bump = margin_account.bump,
        has_one = owner,
        has_one = market,
    )]
    pub margin_account: Box<Account<'info, MarginAccount>>,

    #[account(
        mut,
        constraint = owner_token_account.owner == owner.key(),
        constraint = owner_token_account.mint == market.collateral_mint
    )]
    pub owner_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        constraint = vault.key() == market.vault
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    // --- Arcium accounts ---
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(address = market.close_position_comp_def)]
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

pub fn handler(ctx: Context<ClosePosition>, computation_offset: u64) -> Result<()> {
    // Required by Arcium queue flow when this account is initialized on demand.
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let market = &ctx.accounts.market;
    let position = &mut ctx.accounts.position;

    // Validate position is open
    require!(
        position.status == PositionStatus::Open,
        ShadowPerpError::PositionNotOpen
    );
    // Update status to closing
    position.status = PositionStatus::Closing;
    // Bind to the specific computation account so the callback can verify it is consuming
    // output from the exact computation that was authorised for this close request.
    position.begin_pending_computation(
        ctx.accounts.computation_account.key(),
        Position::CALLBACK_KIND_CLOSE,
        computation_offset,
    )?;

    // Build arguments for close_position MPC circuit
    // position: Enc<Mxe, Position> - pass the encrypted position data stored on-chain
    // exit_price: u64 - plaintext oracle price
    // market_params: MarketParams - plaintext
    // oi_state: Enc<Mxe, OpenInterest> - MXE-encrypted state
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

    let args = ArgBuilder::new()
        // position: Enc<Mxe, Position> - 5 fields (size, entry_price, leverage, is_long, margin)
        .plaintext_u128(nonce)
        .encrypted_u64(encrypted_size) // size
        .encrypted_u64(encrypted_entry_price) // entry_price
        .encrypted_u8(encrypted_leverage) // leverage
        .encrypted_bool(encrypted_is_long) // is_long
        .encrypted_u64(encrypted_margin) // margin
        // exit_price: u64 (plaintext - current oracle price)
        .plaintext_u64(market.oracle_price)
        // market_params: MarketParams (plaintext)
        .plaintext_u8(market.max_leverage)
        .plaintext_u16(market.liquidation_threshold)
        .plaintext_u16(market.trading_fee)
        .plaintext_u64(market.oracle_price)
        // oi_state: Enc<Mxe, OpenInterest>
        .plaintext_u128(nonce)
        .encrypted_u64(market.encrypted_total_long_oi)
        .encrypted_u64(market.encrypted_total_short_oi)
        .build();

    // Build callback for when PnL is computed and revealed
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
        CallbackAccount {
            pubkey: ctx.accounts.owner_token_account.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: ctx.accounts.vault.key(),
            is_writable: true,
        },
    ];

    let callback_ix = ClosePositionCallback::callback_ix(
        computation_offset,
        &ctx.accounts.mxe_account,
        &callback_accounts,
    )?;

    // Queue the computation to Arcium MPC network
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
