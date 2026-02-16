use anchor_lang::prelude::*;

/// Encrypted position account - all sensitive data stored encrypted
#[account]
#[derive(Default)]
pub struct Position {
    /// Owner of the position
    pub owner: Pubkey,

    /// Market this position belongs to
    pub market: Pubkey,

    /// Encrypted position data (size, entry_price, leverage, direction)
    /// This blob is only decryptable within MPC
    pub encrypted_data: [u8; 256],

    /// Position status
    pub status: PositionStatus,

    /// Timestamp when position was opened
    pub opened_at: i64,

    /// Timestamp when position was closed (0 if still open)
    pub closed_at: i64,

    /// Margin deposited for this position
    pub margin: u64,

    /// Realized PnL (only set after position is closed)
    /// This is the ONLY data revealed - and only at settlement
    pub realized_pnl: i64,

    /// Nonce used for encryption
    pub nonce: [u8; 16],

    /// Client public key for shared secret
    pub client_pubkey: [u8; 32],

    /// Position index (unique identifier)
    pub index: u64,

    /// Bump seed for PDA derivation
    pub bump: u8,

    /// Reserved space for future upgrades
    pub _reserved: [u8; 64],
}

impl Position {
    pub const LEN: usize = 8 +   // discriminator
        32 +  // owner
        32 +  // market
        256 + // encrypted_data
        1 +   // status
        8 +   // opened_at
        8 +   // closed_at
        8 +   // margin
        8 +   // realized_pnl
        16 +  // nonce
        32 +  // client_pubkey
        8 +   // index
        1 +   // bump
        64;   // reserved
}

/// Position status enum
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum PositionStatus {
    #[default]
    Pending,    // Position opening in progress (MPC running)
    Open,       // Position is active
    Closing,    // Position close in progress (MPC running)
    Closed,     // Position settled, PnL revealed
    Liquidated, // Position was liquidated
}

/// Event emitted when a position is opened
/// Note: Size and direction are NOT revealed here
#[event]
pub struct PositionOpened {
    pub owner: Pubkey,
    pub position: Pubkey,
    pub market: Pubkey,
    pub margin: u64,
    pub timestamp: i64,
}

/// Event emitted when a position is closed - PnL revealed
#[event]
pub struct PositionClosed {
    pub owner: Pubkey,
    pub position: Pubkey,
    pub realized_pnl: i64,
    pub settlement_amount: u64,
    pub timestamp: i64,
}

/// Event emitted when a position is liquidated
#[event]
pub struct PositionLiquidated {
    pub owner: Pubkey,
    pub position: Pubkey,
    pub liquidation_price: u64,
    pub timestamp: i64,
}
