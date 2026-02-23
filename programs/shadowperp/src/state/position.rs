use anchor_lang::prelude::*;
use crate::errors::ShadowPerpError;

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
    // _reserved callback metadata layout (no account size expansion):
    // [0..8)   callback_seq_counter (u64)
    // [8..16)  pending_callback_seq (u64; 0 means none)
    // [16]     pending_callback_kind (u8)
    // [17..25) pending_computation_offset (u64)
    const CALLBACK_SEQ_COUNTER_OFFSET: usize = 0;
    const PENDING_CALLBACK_SEQ_OFFSET: usize = 8;
    const PENDING_CALLBACK_KIND_OFFSET: usize = 16;
    const PENDING_COMP_OFFSET_OFFSET: usize = 17;

    pub const CALLBACK_KIND_NONE: u8 = 0;
    pub const CALLBACK_KIND_OPEN: u8 = 1;
    pub const CALLBACK_KIND_CLOSE: u8 = 2;
    pub const CALLBACK_KIND_LIQUIDATION: u8 = 3;

    fn read_u64_reserved(&self, offset: usize) -> u64 {
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&self._reserved[offset..offset + 8]);
        u64::from_le_bytes(buf)
    }

    fn write_u64_reserved(&mut self, offset: usize, value: u64) {
        self._reserved[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }

    pub fn callback_seq_counter(&self) -> u64 {
        self.read_u64_reserved(Self::CALLBACK_SEQ_COUNTER_OFFSET)
    }

    pub fn pending_callback_seq(&self) -> u64 {
        self.read_u64_reserved(Self::PENDING_CALLBACK_SEQ_OFFSET)
    }

    pub fn pending_callback_kind(&self) -> u8 {
        self._reserved[Self::PENDING_CALLBACK_KIND_OFFSET]
    }

    pub fn pending_computation_offset(&self) -> u64 {
        self.read_u64_reserved(Self::PENDING_COMP_OFFSET_OFFSET)
    }

    pub fn set_pending_callback_meta(&mut self, kind: u8, computation_offset: u64) -> Result<()> {
        require!(kind != Self::CALLBACK_KIND_NONE, ShadowPerpError::InvalidAccountData);

        let next_seq = self
            .callback_seq_counter()
            .checked_add(1)
            .ok_or(ShadowPerpError::ArithmeticOverflow)?;
        self.write_u64_reserved(Self::CALLBACK_SEQ_COUNTER_OFFSET, next_seq);
        self.write_u64_reserved(Self::PENDING_CALLBACK_SEQ_OFFSET, next_seq);
        self._reserved[Self::PENDING_CALLBACK_KIND_OFFSET] = kind;
        self.write_u64_reserved(Self::PENDING_COMP_OFFSET_OFFSET, computation_offset);
        Ok(())
    }

    pub fn clear_pending_callback_meta(&mut self) {
        self.write_u64_reserved(Self::PENDING_CALLBACK_SEQ_OFFSET, 0);
        self._reserved[Self::PENDING_CALLBACK_KIND_OFFSET] = Self::CALLBACK_KIND_NONE;
        self.write_u64_reserved(Self::PENDING_COMP_OFFSET_OFFSET, 0);
    }

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
