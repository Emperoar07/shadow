use anchor_lang::prelude::*;

#[account]
pub struct LiquidationSettlement {
    pub position: Pubkey,
    pub liquidator: Pubkey,
    pub bump: u8,
    pub _reserved: [u8; 31],
}

impl LiquidationSettlement {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 31;
}
