use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::ShadowPerpError;
use crate::state::{FundingState, Market, Position, PositionClosed, PositionFundingRef, PositionStatus};

#[derive(Accounts)]
pub struct SettleClosePosition<'info> {
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), position.owner.as_ref(), &position.index.to_le_bytes()],
        bump = position.bump,
        has_one = market,
    )]
    pub position: Box<Account<'info, Position>>,

    /// Receives recovered rent from closed PDAs. Must match `position.owner`
    /// so rent cannot be redirected to an arbitrary caller.
    #[account(
        mut,
        constraint = position_owner.key() == position.owner
    )]
    pub position_owner: SystemAccount<'info>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    /// Position owner's token account for settlement
    #[account(
        mut,
        constraint = owner_token_account.owner == position.owner,
        constraint = owner_token_account.mint == market.collateral_mint
    )]
    pub owner_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = vault.key() == market.vault
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: PDA authority for the shared collateral vault.
    #[account(
        seeds = [b"shared_vault_authority", market.collateral_mint.as_ref()],
        bump
    )]
    pub shared_vault_authority: UncheckedAccount<'info>,

    /// PositionFundingRef PDA for this position — optional.
    /// If present, the funding delta is applied to the settlement amount and the account is
    /// closed here to recover rent (returned to payer).
    #[account(
        mut,
        seeds = [b"pos-funding", position.key().as_ref()],
        bump,
        close = position_owner,
    )]
    pub pos_funding_ref: Option<Account<'info, PositionFundingRef>>,

    /// FundingState for this market — read-only. Required when pos_funding_ref is provided.
    #[account(
        seeds = [b"funding", market.key().as_ref()],
        bump,
    )]
    pub funding_state: Option<Account<'info, FundingState>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SettleClosePosition>) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let market = &ctx.accounts.market;

    require!(
        position.status == PositionStatus::ClosedPendingSettlement,
        ShadowPerpError::InvalidAccountData
    );

    // position.margin holds the base settlement amount stored by the close callback.
    let base_settlement = position.margin;

    // Apply accrued funding if this position has a PositionFundingRef and a live FundingState.
    //
    // Convention (matches FundingState.funding_rate sign):
    //   funding_delta > 0 → longs pay shorts over this period
    //   funding_delta < 0 → shorts pay longs over this period
    //
    // funding_owed = base_settlement * |funding_delta_bps| / 10_000, capped at base_settlement.
    let is_long = position.is_long();
    let settlement_amount = if let (Some(pos_ref), Some(fs)) = (
        ctx.accounts.pos_funding_ref.as_ref(),
        ctx.accounts.funding_state.as_ref(),
    ) {
        let funding_delta = fs
            .cumulative_funding
            .saturating_sub(pos_ref.entry_funding_rate);

        if funding_delta != 0 {
            let abs_delta = funding_delta.unsigned_abs();
            let adjustment = (base_settlement as u128)
                .saturating_mul(abs_delta as u128)
                / 10_000;
            let adjustment = adjustment.min(base_settlement as u128) as u64;

            // Long pays when delta > 0; short pays when delta < 0.
            // "pays" = receives less settlement; "receives" = gets more.
            let long_pays = funding_delta > 0;
            if is_long == long_pays {
                // This side owes funding — reduce settlement.
                base_settlement.saturating_sub(adjustment)
            } else {
                // This side is owed funding — increase settlement.
                base_settlement.saturating_add(adjustment)
            }
        } else {
            base_settlement
        }
    } else {
        base_settlement
    };

    let (shared_vault, _) = Pubkey::find_program_address(
        &[b"shared_vault", market.collateral_mint.as_ref()],
        ctx.program_id,
    );

    // Transfer settlement amount to user
    if settlement_amount > 0 {
        if ctx.accounts.vault.key() == shared_vault {
            let (_, shared_vault_authority_bump) = Pubkey::find_program_address(
                &[b"shared_vault_authority", market.collateral_mint.as_ref()],
                ctx.program_id,
            );
            let authority_seeds = &[
                b"shared_vault_authority".as_ref(),
                market.collateral_mint.as_ref(),
                &[shared_vault_authority_bump],
            ];
            let signer_seeds = &[&authority_seeds[..]];

            let transfer_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.shared_vault_authority.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(transfer_ctx, settlement_amount)?;
        } else {
            let market_seeds = &[
                b"market".as_ref(),
                market.collateral_mint.as_ref(),
                market.base_asset_mint.as_ref(),
                &[market.bump],
            ];
            let signer_seeds = &[&market_seeds[..]];

            let transfer_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(transfer_ctx, settlement_amount)?;
        }
    }

    // Finalize position state
    position.margin = 0;
    position.requested_margin = 0;
    position.status = PositionStatus::Closed;

    let clock = Clock::get()?;
    emit!(PositionClosed {
        owner: position.owner,
        position: position.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
