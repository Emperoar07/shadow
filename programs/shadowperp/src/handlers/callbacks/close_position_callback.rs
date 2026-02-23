use crate::{ID, ID_CONST};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{MarginAccount, Market, Position, PositionClosed, PositionStatus};

/// Callback account for receiving PnL result from MPC
#[callback_accounts("close_position")]
#[derive(Accounts)]
pub struct ClosePositionCallback<'info> {
    // Standard Arcium callback accounts
    pub arcium_program: Program<'info, Arcium>,
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: Validated by Arcium
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account: Box<Account<'info, Cluster>>,
    /// CHECK: Instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    // Custom callback accounts
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = market,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"margin", market.key().as_ref(), position.owner.as_ref()],
        bump = margin_account.bump,
    )]
    pub margin_account: Box<Account<'info, MarginAccount>>,

    /// Position owner's token account for settlement
    #[account(
        mut,
        constraint = owner_token_account.owner == position.owner,
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

    pub token_program: Program<'info, Token>,
}

/// Handler logic for the close_position callback (called from lib.rs via #[arcium_callback])
pub fn close_position_callback_handler(
    ctx: Context<ClosePositionCallback>,
    output: SignedComputationOutputs<ClosePositionOutput>,
) -> Result<()> {
    // Verify the computation output from the MPC cluster
    let verified_output = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(o) => o,
        Err(_) => return Err(ShadowPerpError::InvalidComputationResult.into()),
    };

    // Callback must be bound to this market's configured Arcium cluster + comp-def.
    require!(
        ctx.accounts.cluster_account.key() == ctx.accounts.market.mxe_cluster,
        ShadowPerpError::Unauthorized
    );
    require!(
        ctx.accounts.comp_def_account.key() == ctx.accounts.market.close_position_comp_def,
        ShadowPerpError::Unauthorized
    );

    let market = &mut ctx.accounts.market;
    let margin_account = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;
    let clock = Clock::get()?;

    // Validate position is in closing state
    require!(
        position.status == PositionStatus::Closing,
        ShadowPerpError::InvalidAccountData
    );

    // Verify the callback is consuming the exact computation that was authorised for this
    // close request. Prevents replay: output from a different computation cannot be applied
    // to settle this position.
    require!(
        position.pending_computation_account != Pubkey::default(),
        ShadowPerpError::InvalidAccountData
    );
    require!(
        position.pending_callback_seq() > 0,
        ShadowPerpError::InvalidAccountData
    );
    require!(
        position.pending_callback_kind() == Position::CALLBACK_KIND_CLOSE,
        ShadowPerpError::InvalidAccountData
    );
    let expected_computation_account = derive_comp_pda!(
        position.pending_computation_offset(),
        ctx.accounts.mxe_account,
        ErrorCode::ClusterNotSet
    );
    require!(
        expected_computation_account == position.pending_computation_account,
        ShadowPerpError::InvalidAccountData
    );
    require!(
        ctx.accounts.computation_account.key() == position.pending_computation_account,
        ShadowPerpError::Unauthorized
    );
    // Clear the binding so it cannot be consumed a second time.
    position.pending_computation_account = Pubkey::default();
    position.clear_pending_callback_meta();

    // Settlement outputs from MPC.
    // Circuit returns flat tuple (i64, u64, u64, u64, Enc<Mxe, (u64, u64)>) in OutputStruct0:
    //   field_0: i64 (realized_pnl), field_1: u64 (settlement), field_2: u64 (fee),
    //   field_3: u64 (locked_margin), field_4: MXEEncryptedStruct<2> (updated OI)
    let realized_pnl = verified_output.field_0.field_0;
    let settlement_amount = verified_output.field_0.field_1;
    let fee = verified_output.field_0.field_2;
    // Migration compatibility:
    // Prefer MPC-revealed locked margin (new flow). Fall back to legacy persisted slot
    // for positions opened before migration.
    let revealed_locked_margin = verified_output.field_0.field_3;
    let locked_margin = if revealed_locked_margin > 0 {
        revealed_locked_margin
    } else {
        position.margin
    };
    require!(locked_margin > 0, ShadowPerpError::InvalidComputationResult);

    // Update position - PnL is now public
    position.realized_pnl = realized_pnl;
    position.status = PositionStatus::Closed;
    position.closed_at = clock.unix_timestamp;

    // Update encrypted open interest from MPC output.
    // Require exactly 2 elements, each 32 bytes — reject malformed MPC output rather
    // than silently accepting extra or truncated ciphertexts.
    let oi_ciphertexts = &verified_output.field_0.field_4.ciphertexts;
    require!(
        oi_ciphertexts.len() == 2 && oi_ciphertexts[0].len() == 32 && oi_ciphertexts[1].len() == 32,
        ShadowPerpError::InvalidComputationResult
    );
    market.encrypted_total_long_oi = oi_ciphertexts[0];
    market.encrypted_total_short_oi = oi_ciphertexts[1];

    // Unlock margin
    margin_account.locked_balance = margin_account
        .locked_balance
        .checked_sub(locked_margin)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Privacy hardening: avoid exposing cumulative realised PnL as public account state.
    margin_account.total_realized_pnl = 0;

    margin_account.positions_closed = margin_account
        .positions_closed
        .checked_add(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Collect trading fees
    market.total_fees_collected = market
        .total_fees_collected
        .checked_add(fee)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Decrement active positions
    market.active_positions = market
        .active_positions
        .checked_sub(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    let updated_balance = margin_account
        .balance
        .checked_sub(locked_margin)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?
        .checked_add(settlement_amount)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    // Transfer settlement amount to user
    if settlement_amount > 0 {
        let seeds = &[b"market", market.collateral_mint.as_ref(), &[market.bump]];
        let signer_seeds = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.owner_token_account.to_account_info(),
                authority: market.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, settlement_amount)?;
    }
    margin_account.balance = updated_balance;
    position.margin = 0;
    position.requested_margin = 0;

    emit!(PositionClosed {
        owner: position.owner,
        position: position.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
