use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use crate::{ID, ID_CONST};

use crate::state::Market;

// ============ OPEN POSITION COMP DEF ============

#[init_computation_definition_accounts("open_position", payer)]
#[derive(Accounts)]
pub struct InitOpenPositionCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_open_position_handler(ctx: Context<InitOpenPositionCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;

    let market = &mut ctx.accounts.market;
    market.open_position_comp_def = ctx.accounts.comp_def_account.key();

    msg!("Open position computation definition initialized");
    msg!("Comp def: {}", market.open_position_comp_def);

    Ok(())
}

// ============ CLOSE POSITION COMP DEF ============

#[init_computation_definition_accounts("close_position", payer)]
#[derive(Accounts)]
pub struct InitClosePositionCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_close_position_handler(ctx: Context<InitClosePositionCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;

    let market = &mut ctx.accounts.market;
    market.close_position_comp_def = ctx.accounts.comp_def_account.key();

    msg!("Close position computation definition initialized");
    msg!("Comp def: {}", market.close_position_comp_def);

    Ok(())
}

// ============ LIQUIDATION COMP DEF ============

#[init_computation_definition_accounts("check_liquidation", payer)]
#[derive(Accounts)]
pub struct InitLiquidationCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ crate::errors::ShadowPerpError::Unauthorized,
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,

    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,

    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,

    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,

    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,

    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn init_liquidation_handler(ctx: Context<InitLiquidationCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)?;

    let market = &mut ctx.accounts.market;
    market.liquidation_comp_def = ctx.accounts.comp_def_account.key();

    msg!("Liquidation computation definition initialized");
    msg!("Comp def: {}", market.liquidation_comp_def);

    Ok(())
}
