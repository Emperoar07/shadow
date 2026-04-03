use anchor_lang::prelude::*;

/// FundingState PDA — seeded `[b"funding", market.key()]`.
///
/// Stores funding rate data and OI caps for a market.
/// Kept as a separate account to avoid expanding the Market account.
///
/// Reserved space layout (55 bytes of body _reserved, then extra 32 in the _reserved2 field):
/// _reserved[0..8]   — long_oi_cap  (u64, 0 = no cap)
/// _reserved[8..16]  — short_oi_cap (u64, 0 = no cap)
/// _reserved[16..24] — approx_long_oi  (u64, proxy using requested_margin)
/// _reserved[24..32] — approx_short_oi (u64, proxy using requested_margin)
/// _reserved[32..55] — future use
#[account]
pub struct FundingState {
    /// The market this FundingState belongs to
    pub market: Pubkey,           // 32

    /// Hourly funding rate in bps (signed; positive = longs pay shorts)
    pub funding_rate: i64,        // 8

    /// All-time accumulated funding rate (sum of funding_rate * elapsed_hours)
    pub cumulative_funding: i64,  // 8

    /// Unix timestamp of the last funding update
    pub last_funding_time: i64,   // 8

    /// Seconds between funding updates (default 3600 = 1 hour)
    pub funding_interval: u64,    // 8

    /// Maximum absolute funding rate in bps per hour (e.g. 100 = 1%)
    pub max_funding_rate: u64,    // 8

    /// Authority-set premium in bps used as input to the funding rate formula
    pub premium_bps: i64,         // 8

    /// Bump seed for PDA derivation
    pub bump: u8,                 // 1

    /// Reserved space (see layout above)
    pub _reserved: [u8; 55],      // 55
    // Total body: 32+8+8+8+8+8+8+1+55 = 136
}

impl FundingState {
    pub const LEN: usize = 8 +   // discriminator
        32 + // market
        8 +  // funding_rate
        8 +  // cumulative_funding
        8 +  // last_funding_time
        8 +  // funding_interval
        8 +  // max_funding_rate
        8 +  // premium_bps
        1 +  // bump
        55;  // _reserved

    // Byte offsets within _reserved
    const LONG_OI_CAP_OFFSET: usize = 0;
    const SHORT_OI_CAP_OFFSET: usize = 8;
    const APPROX_LONG_OI_OFFSET: usize = 16;
    const APPROX_SHORT_OI_OFFSET: usize = 24;

    fn read_u64(&self, offset: usize) -> u64 {
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&self._reserved[offset..offset + 8]);
        u64::from_le_bytes(buf)
    }

    fn write_u64(&mut self, offset: usize, value: u64) {
        self._reserved[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }

    pub fn long_oi_cap(&self) -> u64 {
        self.read_u64(Self::LONG_OI_CAP_OFFSET)
    }

    pub fn short_oi_cap(&self) -> u64 {
        self.read_u64(Self::SHORT_OI_CAP_OFFSET)
    }

    pub fn approx_long_oi(&self) -> u64 {
        self.read_u64(Self::APPROX_LONG_OI_OFFSET)
    }

    pub fn approx_short_oi(&self) -> u64 {
        self.read_u64(Self::APPROX_SHORT_OI_OFFSET)
    }

    pub fn set_long_oi_cap(&mut self, value: u64) {
        self.write_u64(Self::LONG_OI_CAP_OFFSET, value);
    }

    pub fn set_short_oi_cap(&mut self, value: u64) {
        self.write_u64(Self::SHORT_OI_CAP_OFFSET, value);
    }

    pub fn set_approx_long_oi(&mut self, value: u64) {
        self.write_u64(Self::APPROX_LONG_OI_OFFSET, value);
    }

    pub fn set_approx_short_oi(&mut self, value: u64) {
        self.write_u64(Self::APPROX_SHORT_OI_OFFSET, value);
    }
}

impl Default for FundingState {
    fn default() -> Self {
        Self {
            market: Pubkey::default(),
            funding_rate: 0,
            cumulative_funding: 0,
            last_funding_time: 0,
            funding_interval: 3600,
            max_funding_rate: 100,
            premium_bps: 0,
            bump: 0,
            _reserved: [0u8; 55],
        }
    }
}

/// Events

#[event]
pub struct FundingStateInitialized {
    pub market: Pubkey,
    pub funding_interval: u64,
    pub max_funding_rate: u64,
}

#[event]
pub struct FundingRateUpdated {
    pub market: Pubkey,
    pub new_funding_rate: i64,
    pub cumulative_funding: i64,
    pub timestamp: i64,
}

#[event]
pub struct FundingPremiumSet {
    pub market: Pubkey,
    pub premium_bps: i64,
}

#[event]
pub struct OiCapsSet {
    pub market: Pubkey,
    pub long_oi_cap: u64,
    pub short_oi_cap: u64,
}
