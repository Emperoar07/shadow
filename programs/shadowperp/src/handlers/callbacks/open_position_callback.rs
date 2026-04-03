use crate::{ID, ID_CONST};
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{MarginAccount, Market, Position, PositionOpened, PositionStatus};

const COMP_DEF_OFFSET_OPEN_POSITION_PROBE_B: u32 = comp_def_offset("open_position_probe_b");

/// Callback account for storing validated position data from MPC
#[callback_accounts("open_position_probe_b")]
#[derive(Accounts)]
pub struct OpenPositionProbeBCallback<'info> {
    // Standard Arcium callback accounts — address constraints required by #[callback_accounts] macro
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_OPEN_POSITION_PROBE_B))]
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

    // Custom callback accounts - order must match CallbackAccount vec
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"margin", position.owner.as_ref()],
        bump = margin_account.bump,
    )]
    pub margin_account: Box<Account<'info, MarginAccount>>,
}

/// Handler logic for the open_position callback (called from lib.rs via #[arcium_callback])
pub fn open_position_callback_handler(
    ctx: Context<OpenPositionProbeBCallback>,
    output: SignedComputationOutputs<OpenPositionProbeBOutput>,
) -> Result<()> {
    let verified_output = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(o) => o,
        Err(error) => {
            msg!(
                "MPC verify failed for position {}: {}",
                ctx.accounts.position.key(),
                error
            );
            // Mark position as Closed so it doesn't remain stuck in Pending.
            // Requested margin was never locked, so margin account is unaffected.
            ctx.accounts.position.status = PositionStatus::Closed;
            ctx.accounts.position.consume_pending_computation(
                ctx.accounts.computation_account.key(),
            )?;
            return Err(ShadowPerpError::InvalidComputationResult.into());
        }
    };

    // Callback must be bound to this market's configured Arcium cluster + comp-def.
    require!(
        ctx.accounts.cluster_account.key() == ctx.accounts.market.mxe_cluster,
        ShadowPerpError::Unauthorized
    );
    require!(
        ctx.accounts.comp_def_account.key() == ctx.accounts.market.open_position_comp_def,
        ShadowPerpError::Unauthorized
    );

    let market = &mut ctx.accounts.market;
    let margin_account = &mut ctx.accounts.margin_account;
    let position = &mut ctx.accounts.position;

    // Validate position is in pending state
    require!(
        position.status == PositionStatus::Pending,
        ShadowPerpError::InvalidAccountData
    );

    // Verify the callback is consuming the exact computation that was authorised for this
    // position. Prevents replay: output from a different computation (with different/malicious
    // parameters) cannot be applied to this position even if it passes verify_output.
    require!(
        position.pending_computation_account != Pubkey::default(),
        ShadowPerpError::InvalidAccountData
    );
    require!(
        position.pending_callback_seq() > 0,
        ShadowPerpError::InvalidAccountData
    );
    require!(
        position.pending_callback_kind() == Position::CALLBACK_KIND_OPEN,
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
    // Consume the binding so this callback result cannot be replayed.
    position.consume_pending_computation(ctx.accounts.computation_account.key())?;

    // Enforce MPC validation outcome.
    if !verified_output.field_0 {
        // MPC rejected the position (e.g. insufficient margin, invalid params).
        // Mark as Closed so the account is not stuck in Pending.
        position.status = PositionStatus::Closed;
        return Err(ShadowPerpError::InvalidComputationResult.into());
    }

    // Update position with MPC-validated encrypted data
    // The MPC has verified margin sufficiency and parameter validity.
    position.status = PositionStatus::Open;

    // Bind on-chain locked collateral to the user-requested margin.
    // Circuit enforces encrypted_margin == requested_margin.
    let required_margin = position.requested_margin;
    let available_margin = margin_account
        .balance
        .checked_sub(margin_account.locked_balance)
        .ok_or(ShadowPerpError::InsufficientMargin)?;
    require!(
        available_margin >= required_margin,
        ShadowPerpError::InsufficientMargin
    );

    margin_account.lock_margin(position.margin_mode(), required_margin)?;

    // Privacy hardening:
    // do not persist active locked collateral in plaintext position state.
    // Close/liquidation callbacks read margin from MPC outputs.
    position.margin = 0;
    // The requested margin is only needed during pending->open transition.
    position.requested_margin = 0;

    // Aggregate OI is intentionally no longer maintained through Arcium because
    // MXE-owned OI ciphertext creation is the observed abort source on devnet.
    market.active_positions = market
        .active_positions
        .checked_add(1)
        .ok_or(ShadowPerpError::ArithmeticOverflow)?;

    let clock = Clock::get()?;

    emit!(PositionOpened {
        owner: position.owner,
        position: position.key(),
        market: market.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
