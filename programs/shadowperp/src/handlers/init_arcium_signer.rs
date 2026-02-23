use anchor_lang::prelude::*;
use crate::ArciumSignerAccount;

/// One-time initializer for the local Arcium sign-seed PDA account.
///
/// Arcium queue_computation derives/signs with this PDA seed. We persist a
/// minimal Anchor account so Account<'info, ArciumSignerAccount> checks pass.
#[derive(Accounts)]
pub struct InitArciumSigner<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + 1, // 8-byte discriminator + 1-byte bump field
        seeds = [b"ArciumSignerAccount"],
        bump
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitArciumSigner>) -> Result<()> {
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    Ok(())
}
