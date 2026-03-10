use crate::{ID, ID_CONST};
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::errors::{ErrorCode, ShadowPerpError};
use crate::state::Market;

/// Callback account for bootstrapping a valid MXE-owned zero OI state.
#[callback_accounts("seed_open_interest_state_v3")]
#[derive(Accounts)]
pub struct SeedOpenInterestStateV3Callback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: Validated by Arcium
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account: Box<Account<'info, Cluster>>,
    /// CHECK: Instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"market", market.collateral_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,
}

pub fn seed_open_interest_state_v3_callback_handler(
    ctx: Context<SeedOpenInterestStateV3Callback>,
    output: SignedComputationOutputs<SeedOpenInterestStateV3Output>,
) -> Result<()> {
    let verified_output = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(o) => o,
        Err(error) => {
            msg!(
                "MPC verify failed while seeding OI state for market {}: {}",
                ctx.accounts.market.key(),
                error
            );
            return Err(ShadowPerpError::InvalidComputationResult.into());
        }
    };

    let market = &mut ctx.accounts.market;
    require!(
        ctx.accounts.cluster_account.key() == market.mxe_cluster,
        ShadowPerpError::Unauthorized
    );
    require!(
        ctx.accounts.comp_def_account.key() == market.seed_open_interest_comp_def,
        ShadowPerpError::Unauthorized
    );
    require!(market.active_positions == 0, ShadowPerpError::InvalidAccountData);
    require!(market.oi_nonce == 0, ShadowPerpError::InvalidAccountData);
    require!(
        market.encrypted_total_long_oi == [0u8; 32] && market.encrypted_total_short_oi == [0u8; 32],
        ShadowPerpError::InvalidAccountData
    );

    let result = &verified_output.field_0;
    require!(result.field_0, ShadowPerpError::InvalidComputationResult);
    let oi_ciphertexts = &result.field_1.ciphertexts;
    require!(
        oi_ciphertexts.len() == 2 && oi_ciphertexts[0].len() == 32 && oi_ciphertexts[1].len() == 32,
        ShadowPerpError::InvalidComputationResult
    );

    market.encrypted_total_long_oi = oi_ciphertexts[0];
    market.encrypted_total_short_oi = oi_ciphertexts[1];
    market.oi_nonce = result.field_1.nonce;

    Ok(())
}
