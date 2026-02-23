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
    /// Placed at end of struct so existing on-chain accounts (reserved bytes = 0)
    /// naturally initialise this to 0 without requiring account re-initialisation.
    pub oi_nonce: u128,

    /// Reserved space for future upgrades (128 - 16 = 112 bytes after oi_nonce)
    pub _reserved: [u8; 112],
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
            _reserved: [0u8; 112],
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
        112; // reserved (128 - 16 for oi_nonce)
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
