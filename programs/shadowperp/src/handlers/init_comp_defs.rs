use crate::ID;
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::state::Market;

// ============ OPEN POSITION COMP DEF ============

#[init_computation_definition_accounts("open_position_probe_b", payer)]
#[derive(Accounts)]
pub struct InitOpenPositionCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Created and validated by the Arcium program during init_comp_def CPI.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    /// CHECK: Derived LUT PDA checked by address constraint above.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: Must match LUT program id via address constraint above.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_open_position_handler(ctx: Context<InitOpenPositionCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;

    let market = &mut ctx.accounts.market;
    market.open_position_comp_def = ctx.accounts.comp_def_account.key();

    Ok(())
}

// ============ OPEN POSITION DIAGNOSTIC COMP DEFS ============

#[init_computation_definition_accounts("open_position_tuple_probe_v1", payer)]
#[derive(Accounts)]
pub struct InitOpenPositionTupleProbeCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Created and validated by the Arcium program during init_comp_def CPI.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    /// CHECK: Derived LUT PDA checked by address constraint above.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: Must match LUT program id via address constraint above.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_open_position_tuple_probe_handler(
    ctx: Context<InitOpenPositionTupleProbeCompDef>,
) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;
    msg!(
        "open_position_tuple_probe_v1 comp def: {}",
        ctx.accounts.comp_def_account.key()
    );
    Ok(())
}

#[init_computation_definition_accounts("open_position_tuple_probe_u8_v1", payer)]
#[derive(Accounts)]
pub struct InitOpenPositionTupleProbeU8CompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Created and validated by the Arcium program during init_comp_def CPI.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    /// CHECK: Derived LUT PDA checked by address constraint above.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: Must match LUT program id via address constraint above.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_open_position_tuple_probe_u8_handler(
    ctx: Context<InitOpenPositionTupleProbeU8CompDef>,
) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;
    msg!(
        "open_position_tuple_probe_u8_v1 comp def: {}",
        ctx.accounts.comp_def_account.key()
    );
    Ok(())
}

#[init_computation_definition_accounts("open_position_margin_probe_v1", payer)]
#[derive(Accounts)]
pub struct InitOpenPositionMarginProbeCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Created and validated by the Arcium program during init_comp_def CPI.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    /// CHECK: Derived LUT PDA checked by address constraint above.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: Must match LUT program id via address constraint above.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_open_position_margin_probe_handler(
    ctx: Context<InitOpenPositionMarginProbeCompDef>,
) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;
    msg!(
        "open_position_margin_probe_v1 comp def: {}",
        ctx.accounts.comp_def_account.key()
    );
    Ok(())
}

#[init_computation_definition_accounts("open_position_full_probe_v1", payer)]
#[derive(Accounts)]
pub struct InitOpenPositionFullProbeCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Created and validated by the Arcium program during init_comp_def CPI.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    /// CHECK: Derived LUT PDA checked by address constraint above.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: Must match LUT program id via address constraint above.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_open_position_full_probe_handler(
    ctx: Context<InitOpenPositionFullProbeCompDef>,
) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;
    msg!(
        "open_position_full_probe_v1 comp def: {}",
        ctx.accounts.comp_def_account.key()
    );
    Ok(())
}

// ============ CLOSE POSITION COMP DEF ============

#[init_computation_definition_accounts("close_position_v3", payer)]
#[derive(Accounts)]
pub struct InitClosePositionCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Created and validated by the Arcium program during init_comp_def CPI.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    /// CHECK: Derived LUT PDA checked by address constraint above.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: Must match LUT program id via address constraint above.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_close_position_handler(ctx: Context<InitClosePositionCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;

    let market = &mut ctx.accounts.market;
    market.close_position_comp_def = ctx.accounts.comp_def_account.key();

    Ok(())
}

// ============ LIQUIDATION COMP DEF ============

#[init_computation_definition_accounts("check_liquidation_v3", payer)]
#[derive(Accounts)]
pub struct InitLiquidationCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Created and validated by the Arcium program during init_comp_def CPI.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    /// CHECK: Derived LUT PDA checked by address constraint above.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: Must match LUT program id via address constraint above.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_liquidation_handler(ctx: Context<InitLiquidationCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;

    let market = &mut ctx.accounts.market;
    market.liquidation_comp_def = ctx.accounts.comp_def_account.key();

    Ok(())
}

// ============ SEED OPEN INTEREST STATE COMP DEF ============

#[init_computation_definition_accounts("seed_open_interest_state_v3", payer)]
#[derive(Accounts)]
pub struct InitSeedOpenInterestCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Created and validated by the Arcium program during init_comp_def CPI.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    /// CHECK: Derived LUT PDA checked by address constraint above.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: Must match LUT program id via address constraint above.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_seed_open_interest_handler(ctx: Context<InitSeedOpenInterestCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;

    let market = &mut ctx.accounts.market;
    market.seed_open_interest_comp_def = ctx.accounts.comp_def_account.key();

    Ok(())
}

// ============ LOCK MARGIN PRIVATE COMP DEF (shielded-collateral feature) ============

#[cfg(feature = "shielded-collateral")]
#[init_computation_definition_accounts("lock_margin_private", payer)]
#[derive(Accounts)]
pub struct InitLockMarginPrivateCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Created and validated by the Arcium program during init_comp_def CPI.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    /// CHECK: Derived LUT PDA checked by address constraint above.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: Must match LUT program id via address constraint above.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[cfg(feature = "shielded-collateral")]
pub fn init_lock_margin_private_handler(ctx: Context<InitLockMarginPrivateCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;

    msg!("lock_margin_private comp def: {}", ctx.accounts.comp_def_account.key());

    Ok(())
}

// ============ SETTLE PRIVATE POSITION COMP DEF (shielded-collateral feature) ============

#[cfg(feature = "shielded-collateral")]
#[init_computation_definition_accounts("settle_private_position", payer)]
#[derive(Accounts)]
pub struct InitSettlePrivatePositionCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Created and validated by the Arcium program during init_comp_def CPI.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    /// CHECK: Derived LUT PDA checked by address constraint above.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: Must match LUT program id via address constraint above.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[cfg(feature = "shielded-collateral")]
pub fn init_settle_private_position_handler(
    ctx: Context<InitSettlePrivatePositionCompDef>,
) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;

    msg!("settle_private_position comp def: {}", ctx.accounts.comp_def_account.key());

    Ok(())
}

// ============ VERIFY WITHDRAWAL PROOF COMP DEF ============

#[init_computation_definition_accounts("verify_withdrawal_proof", payer)]
#[derive(Accounts)]
pub struct InitVerifyWithdrawalProofCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Created and validated by the Arcium program during init_comp_def CPI.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    /// CHECK: Derived LUT PDA checked by address constraint above.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: Must match LUT program id via address constraint above.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[cfg(feature = "shielded-collateral")]
pub fn init_verify_withdrawal_proof_handler(
    ctx: Context<InitVerifyWithdrawalProofCompDef>,
) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;
    msg!("verify_withdrawal_proof comp def: {}", ctx.accounts.comp_def_account.key());
    Ok(())
}

// ============ EXECUTE PRIVATE ORDER COMP DEF ============

#[init_computation_definition_accounts("execute_private_order", payer)]
#[derive(Accounts)]
pub struct InitExecutePrivateOrderCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref(), market.base_asset_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    /// CHECK: Created and validated by the Arcium program during init_comp_def CPI.
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    /// CHECK: Derived LUT PDA checked by address constraint above.
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    /// CHECK: Must match LUT program id via address constraint above.
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_execute_private_order_handler(
    ctx: Context<InitExecutePrivateOrderCompDef>,
) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;
    msg!("execute_private_order comp def: {}", ctx.accounts.comp_def_account.key());
    Ok(())
}
