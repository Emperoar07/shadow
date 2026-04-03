use anchor_lang::prelude::*;

/// Global market state for the perpetual futures protocol
#[account]
pub struct Market {
    /// Authority that can update market parameters
    pub authority: Pubkey,

    /// Collateral token mint (e.g., USDC)
    pub collateral_mint: Pubkey,

    /// Protocol vault for collateral
    pub vault: Pubkey,

    /// Current oracle price (updated by authorized feeder)
    pub oracle_price: u64,

    /// Last price update timestamp
    pub last_price_update: i64,

    /// Maximum allowed leverage (e.g., 20 = 20x)
    pub max_leverage: u8,

    /// Liquidation threshold in basis points (e.g., 500 = 5%)
    pub liquidation_threshold: u16,

    /// Trading fee in basis points (e.g., 10 = 0.1%)
    pub trading_fee: u16,

    /// Total encrypted long open interest (stored encrypted)
    pub encrypted_total_long_oi: [u8; 32],

    /// Total encrypted short open interest (stored encrypted)
    pub encrypted_total_short_oi: [u8; 32],

    /// Number of active positions
    pub active_positions: u64,

    /// Total fees collected
    pub total_fees_collected: u64,

    /// Authorized oracle price feeder
    pub price_feeder: Pubkey,

    /// MXE cluster address for Arcium computations
    pub mxe_cluster: Pubkey,

    /// Computation definition account for opening positions
    pub open_position_comp_def: Pubkey,

    /// Computation definition account for closing positions
    pub close_position_comp_def: Pubkey,

    /// Computation definition account for liquidation checks
    pub liquidation_comp_def: Pubkey,

    /// Bump seed for PDA derivation
    pub bump: u8,

    /// Nonce used by the MXE cluster for the OI state ciphertext.
    /// Must be passed back to Arcium on each open/close/liquidation computation.
    pub oi_nonce: u128,

    /// Computation definition account for seeding the initial MXE-owned OI state.
    /// Stored after legacy fields so live market accounts keep the original bump/nonce layout.
    pub seed_open_interest_comp_def: Pubkey,

    /// The base asset mint this market trades (e.g. SOL mint for SOL-USD).
    /// Part of the PDA seed: ["market", collateral_mint, base_asset_mint].
    pub base_asset_mint: Pubkey,

    /// Pyth price feed ID for this market's base asset (32-byte feed hash).
    /// Used by `update_price_from_pyth` to read the correct Pyth feed.
    pub pyth_feed_id: [u8; 32],

    /// Reserved space for future upgrades (includes slots for shielded comp defs)
    pub _reserved: [u8; 16],
}

impl Default for Market {
    fn default() -> Self {
        Self {
            authority: Pubkey::default(),
            collateral_mint: Pubkey::default(),
            vault: Pubkey::default(),
            oracle_price: 0,
            last_price_update: 0,
            max_leverage: 0,
            liquidation_threshold: 0,
            trading_fee: 0,
            encrypted_total_long_oi: [0u8; 32],
            encrypted_total_short_oi: [0u8; 32],
            active_positions: 0,
            total_fees_collected: 0,
            price_feeder: Pubkey::default(),
            mxe_cluster: Pubkey::default(),
            open_position_comp_def: Pubkey::default(),
            close_position_comp_def: Pubkey::default(),
            liquidation_comp_def: Pubkey::default(),
            bump: 0,
            oi_nonce: 0,
            seed_open_interest_comp_def: Pubkey::default(),
            base_asset_mint: Pubkey::default(),
            pyth_feed_id: [0u8; 32],
            _reserved: [0u8; 16],
        }
    }
}

impl Market {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        32 + // collateral_mint
        32 + // vault
        8 +  // oracle_price
        8 +  // last_price_update
        1 +  // max_leverage
        2 +  // liquidation_threshold
        2 +  // trading_fee
        32 + // encrypted_total_long_oi
        32 + // encrypted_total_short_oi
        8 +  // active_positions
        8 +  // total_fees_collected
        32 + // price_feeder
        32 + // mxe_cluster
        32 + // open_position_comp_def
        32 + // close_position_comp_def
        32 + // liquidation_comp_def
        1 +  // bump
        16 + // oi_nonce
        32 + // seed_open_interest_comp_def
        32 + // base_asset_mint
        32 + // pyth_feed_id
        16; // reserved (mark_price [0..8] + last_mark_price_update [8..16])

    // _reserved byte layout:
    // [0..8]  — mark_price (u64, 6-decimal fixed-point, same scale as oracle_price)
    // [8..16] — last_mark_price_update (i64, unix timestamp)
    const MARK_PRICE_OFFSET: usize = 0;
    const LAST_MARK_PRICE_UPDATE_OFFSET: usize = 8;

    /// Maximum deviation of mark_price from index_price as basis points (200 bps = 2%)
    pub const MARK_PRICE_MAX_DEVIATION_BPS: u64 = 200;
    pub const MARK_PRICE_MAX_AGE_SECONDS: i64 = 300;

    pub fn mark_price(&self) -> u64 {
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&self._reserved[Self::MARK_PRICE_OFFSET..Self::MARK_PRICE_OFFSET + 8]);
        u64::from_le_bytes(buf)
    }

    pub fn last_mark_price_update(&self) -> i64 {
        let mut buf = [0u8; 8];
        buf.copy_from_slice(
            &self._reserved[Self::LAST_MARK_PRICE_UPDATE_OFFSET..Self::LAST_MARK_PRICE_UPDATE_OFFSET + 8],
        );
        i64::from_le_bytes(buf)
    }

    pub fn set_mark_price(&mut self, value: u64) {
        self._reserved[Self::MARK_PRICE_OFFSET..Self::MARK_PRICE_OFFSET + 8]
            .copy_from_slice(&value.to_le_bytes());
    }

    pub fn set_last_mark_price_update(&mut self, value: i64) {
        self._reserved[Self::LAST_MARK_PRICE_UPDATE_OFFSET..Self::LAST_MARK_PRICE_UPDATE_OFFSET + 8]
            .copy_from_slice(&value.to_le_bytes());
    }

    pub fn mark_price_is_fresh(&self, now_ts: i64) -> bool {
        let mark_price = self.mark_price();
        let last_update = self.last_mark_price_update();
        if mark_price == 0 || last_update <= 0 {
            return false;
        }
        now_ts.saturating_sub(last_update) < Self::MARK_PRICE_MAX_AGE_SECONDS
    }

    /// Returns the effective settlement/liquidation price.
    /// Falls back to oracle_price if mark_price is unset or stale.
    pub fn effective_mark_price_at(&self, now_ts: i64) -> u64 {
        let mp = self.mark_price();
        if mp == 0 || !self.mark_price_is_fresh(now_ts) {
            self.oracle_price
        } else {
            mp
        }
    }
}

/// Event emitted when market is initialized
#[event]
pub struct MarketInitialized {
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub max_leverage: u8,
    pub liquidation_threshold: u16,
}

/// Event emitted when oracle price is updated
#[event]
pub struct PriceUpdated {
    pub old_price: u64,
    pub new_price: u64,
    pub timestamp: i64,
}

/// Event emitted when mark price is updated
#[event]
pub struct MarkPriceUpdated {
    pub market: Pubkey,
    pub old_mark_price: u64,
    pub new_mark_price: u64,
    pub index_price: u64,
    pub timestamp: i64,
}
