use anchor_lang::prelude::*;

/// Encrypted position account - all sensitive data stored encrypted
#[account]
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

    /// Deprecated plaintext margin slot (legacy compatibility only).
    /// New flow keeps this at 0 while a position is active and settles using
    /// MPC-revealed lock amount in callbacks.
    pub margin: u64,

    /// Pending-time user margin cap used during open-position validation.
    /// Cleared once callback transitions position to Open.
    pub requested_margin: u64,

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

    /// The computation account key recorded when this position's MPC computation was queued.
    /// Callbacks verify that the computation_account passed to them matches this key,
    /// binding each callback to the specific computation that was authorised for this position.
    /// Cleared to Pubkey::default() after the callback consumes it.
    pub pending_computation_account: Pubkey,

    /// Reserved space for future upgrades
    pub _reserved: [u8; 32],
}

impl Default for Position {
    fn default() -> Self {
        Self {
            owner: Pubkey::default(),
            market: Pubkey::default(),
            encrypted_data: [0u8; 256],
            status: PositionStatus::Pending,
            opened_at: 0,
            closed_at: 0,
            margin: 0,
            requested_margin: 0,
            realized_pnl: 0,
            nonce: [0u8; 16],
            client_pubkey: [0u8; 32],
            index: 0,
            bump: 0,
            pending_computation_account: Pubkey::default(),
            _reserved: [0u8; 32],
        }
    }
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
        8 +   // requested_margin
        8 +   // realized_pnl
        16 +  // nonce
        32 +  // client_pubkey
        8 +   // index
        1 +   // bump
        32 +  // pending_computation_account
        32; // reserved
}

/// Position status enum
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum PositionStatus {
    #[default]
    Pending, // Position opening in progress (MPC running)
    Open,       // Position is active
    Closing,    // Position close in progress (MPC running)
    Closed,     // Position settled, PnL revealed
    Liquidated, // Position was liquidated
}

/// Event emitted when a position is opened
/// Note: size, direction and margin are not revealed here.
#[event]
pub struct PositionOpened {
    pub owner: Pubkey,
    pub position: Pubkey,
    pub market: Pubkey,
    pub timestamp: i64,
}

/// Event emitted when a position is closed.
/// Settlement details are intentionally omitted to reduce public strategy leakage.
#[event]
pub struct PositionClosed {
    pub owner: Pubkey,
    pub position: Pubkey,
    pub timestamp: i64,
}

/// Event emitted when a position is liquidated.
/// liquidation_price is intentionally omitted — revealing it would let observers
/// reconstruct leverage/direction from margin + price. Only the fact of liquidation
/// is public, matching the MPC circuit's boolean-only output guarantee.
#[event]
pub struct PositionLiquidated {
    pub owner: Pubkey,
    pub position: Pubkey,
    pub timestamp: i64,
}
