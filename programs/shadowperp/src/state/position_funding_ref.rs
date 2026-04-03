use anchor_lang::prelude::*;

/// PositionFundingRef PDA — seeded `[b"pos-funding", position.key()]`.
///
/// Created when a position opens. Records the cumulative funding rate at entry
/// and accumulates funding owed. Consumed during settlement.
#[account]
pub struct PositionFundingRef {
    /// The position this funding ref belongs to
    pub position: Pubkey,         // 32

    /// Cumulative funding rate at the time the position was opened (from FundingState)
    pub entry_funding_rate: i64,  // 8

    /// Funding already settled/accrued (for partial settlements, future use)
    pub accrued_funding: i64,     // 8

    /// Bump seed for PDA derivation
    pub bump: u8,                 // 1

    /// Reserved space for future upgrades
    pub _reserved: [u8; 15],      // 15
    // Total body: 32+8+8+1+15 = 64
}

impl Default for PositionFundingRef {
    fn default() -> Self {
        Self {
            position: Pubkey::default(),
            entry_funding_rate: 0,
            accrued_funding: 0,
            bump: 0,
            _reserved: [0u8; 15],
        }
    }
}

impl PositionFundingRef {
    pub const LEN: usize = 8 +  // discriminator
        32 + // position
        8 +  // entry_funding_rate
        8 +  // accrued_funding
        1 +  // bump
        15;  // _reserved
}
