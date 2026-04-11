use crate::{ID, ID_CONST};
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::{
    Market, OpenPositionDiagnostic, OpenPositionDiagnosticStatus,
};

const COMP_DEF_OFFSET_OPEN_POSITION_TUPLE_PROBE_V1: u32 =
    comp_def_offset("open_position_tuple_probe_v1");
const COMP_DEF_OFFSET_OPEN_POSITION_MARGIN_PROBE_V1: u32 =
    comp_def_offset("open_position_margin_probe_v1");
const COMP_DEF_OFFSET_OPEN_POSITION_FULL_PROBE_V1: u32 =
    comp_def_offset("open_position_full_probe_v1");

fn abort_probe(
    diagnostic: &mut OpenPositionDiagnostic,
    computation_account: Pubkey,
    completed_at: i64,
) -> Result<()> {
    diagnostic.consume(computation_account, completed_at)?;
    diagnostic.status = OpenPositionDiagnosticStatus::Aborted;
    Ok(())
}

#[callback_accounts("open_position_tuple_probe_v1")]
#[derive(Accounts)]
pub struct OpenPositionTupleProbeV1Callback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_OPEN_POSITION_TUPLE_PROBE_V1))]
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

    #[account(
        mut,
        seeds = [b"open-position-diagnostic", market.key().as_ref(), diagnostic.owner.as_ref(), &diagnostic.run_id.to_le_bytes()],
        bump = diagnostic.bump,
        has_one = market,
    )]
    pub diagnostic: Box<Account<'info, OpenPositionDiagnostic>>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
}

pub fn open_position_tuple_probe_v1_callback_handler(
    ctx: Context<OpenPositionTupleProbeV1Callback>,
    output: SignedComputationOutputs<OpenPositionTupleProbeV1Output>,
) -> Result<()> {
    let clock = Clock::get()?;
    let diagnostic = &mut ctx.accounts.diagnostic;

    let verified_output = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(o) => o,
        Err(error) => {
            msg!(
                "tuple probe verify failed for diagnostic {}: {}",
                diagnostic.key(),
                error
            );
            abort_probe(diagnostic, ctx.accounts.computation_account.key(), clock.unix_timestamp)?;
            return Ok(());
        }
    };

    require!(
        ctx.accounts.cluster_account.key() == ctx.accounts.market.mxe_cluster,
        ShadowPerpError::Unauthorized
    );
    require!(
        ctx.accounts.comp_def_account.key()
            == derive_comp_def_pda!(COMP_DEF_OFFSET_OPEN_POSITION_TUPLE_PROBE_V1),
        ShadowPerpError::Unauthorized
    );
    require!(
        diagnostic.pending_computation_account == ctx.accounts.computation_account.key(),
        ShadowPerpError::Unauthorized
    );

    diagnostic.consume(ctx.accounts.computation_account.key(), clock.unix_timestamp)?;
    diagnostic.result_0 = verified_output.field_0;
    diagnostic.status = if verified_output.field_0 {
        OpenPositionDiagnosticStatus::Passed
    } else {
        OpenPositionDiagnosticStatus::Rejected
    };

    Ok(())
}

#[callback_accounts("open_position_margin_probe_v1")]
#[derive(Accounts)]
pub struct OpenPositionMarginProbeV1Callback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_OPEN_POSITION_MARGIN_PROBE_V1))]
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

    #[account(
        mut,
        seeds = [b"open-position-diagnostic", market.key().as_ref(), diagnostic.owner.as_ref(), &diagnostic.run_id.to_le_bytes()],
        bump = diagnostic.bump,
        has_one = market,
    )]
    pub diagnostic: Box<Account<'info, OpenPositionDiagnostic>>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
}

pub fn open_position_margin_probe_v1_callback_handler(
    ctx: Context<OpenPositionMarginProbeV1Callback>,
    output: SignedComputationOutputs<OpenPositionMarginProbeV1Output>,
) -> Result<()> {
    let clock = Clock::get()?;
    let diagnostic = &mut ctx.accounts.diagnostic;

    let verified_output = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(o) => o,
        Err(error) => {
            msg!(
                "margin probe verify failed for diagnostic {}: {}",
                diagnostic.key(),
                error
            );
            abort_probe(diagnostic, ctx.accounts.computation_account.key(), clock.unix_timestamp)?;
            return Ok(());
        }
    };

    require!(
        ctx.accounts.cluster_account.key() == ctx.accounts.market.mxe_cluster,
        ShadowPerpError::Unauthorized
    );
    require!(
        ctx.accounts.comp_def_account.key()
            == derive_comp_def_pda!(COMP_DEF_OFFSET_OPEN_POSITION_MARGIN_PROBE_V1),
        ShadowPerpError::Unauthorized
    );
    require!(
        diagnostic.pending_computation_account == ctx.accounts.computation_account.key(),
        ShadowPerpError::Unauthorized
    );

    diagnostic.consume(ctx.accounts.computation_account.key(), clock.unix_timestamp)?;
    diagnostic.result_0 = true;
    diagnostic.result_1 = verified_output.field_0;
    diagnostic.status = if verified_output.field_0 {
        OpenPositionDiagnosticStatus::Passed
    } else {
        OpenPositionDiagnosticStatus::Rejected
    };

    Ok(())
}

#[callback_accounts("open_position_full_probe_v1")]
#[derive(Accounts)]
pub struct OpenPositionFullProbeV1Callback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_OPEN_POSITION_FULL_PROBE_V1))]
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

    #[account(
        mut,
        seeds = [b"open-position-diagnostic", market.key().as_ref(), diagnostic.owner.as_ref(), &diagnostic.run_id.to_le_bytes()],
        bump = diagnostic.bump,
        has_one = market,
    )]
    pub diagnostic: Box<Account<'info, OpenPositionDiagnostic>>,

    #[account(
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
}

pub fn open_position_full_probe_v1_callback_handler(
    ctx: Context<OpenPositionFullProbeV1Callback>,
    output: SignedComputationOutputs<OpenPositionFullProbeV1Output>,
) -> Result<()> {
    let clock = Clock::get()?;
    let diagnostic = &mut ctx.accounts.diagnostic;

    let verified_output = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(o) => o,
        Err(error) => {
            msg!(
                "full probe verify failed for diagnostic {}: {}",
                diagnostic.key(),
                error
            );
            abort_probe(diagnostic, ctx.accounts.computation_account.key(), clock.unix_timestamp)?;
            return Ok(());
        }
    };

    require!(
        ctx.accounts.cluster_account.key() == ctx.accounts.market.mxe_cluster,
        ShadowPerpError::Unauthorized
    );
    require!(
        ctx.accounts.comp_def_account.key()
            == derive_comp_def_pda!(COMP_DEF_OFFSET_OPEN_POSITION_FULL_PROBE_V1),
        ShadowPerpError::Unauthorized
    );
    require!(
        diagnostic.pending_computation_account == ctx.accounts.computation_account.key(),
        ShadowPerpError::Unauthorized
    );

    diagnostic.consume(ctx.accounts.computation_account.key(), clock.unix_timestamp)?;
    diagnostic.result_0 = verified_output.field_0.field_0;
    diagnostic.result_1 = verified_output.field_0.field_1;
    diagnostic.result_2 = verified_output.field_0.field_2;
    diagnostic.result_3 = verified_output.field_0.field_3;
    diagnostic.status = if diagnostic.result_0
        && diagnostic.result_1
        && diagnostic.result_2
        && diagnostic.result_3
    {
        OpenPositionDiagnosticStatus::Passed
    } else {
        OpenPositionDiagnosticStatus::Rejected
    };

    Ok(())
}
