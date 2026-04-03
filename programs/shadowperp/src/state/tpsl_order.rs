use anchor_lang::prelude::*;

/// TpSlOrder PDA — seeded `[b"tpsl", position.key()]`.
///
/// Stores take-profit and stop-loss trigger prices for a position.
/// `is_long` is revealed at set-time by the user — they know their own direction.
/// This is a necessary trade-off since TP/SL trigger logic requires it on-chain.
#[account]
pub struct TpSlOrder {
    /// The position this TP/SL order is attached to
    pub position: Pubkey,    // 32

    /// Owner of the position (authorized to modify)
    pub owner: Pubkey,       // 32

    /// Market the position belongs to
    pub market: Pubkey,      // 32

    /// Take-profit price in 6-decimal fixed-point (0 = no TP)
    pub tp_price: u64,       // 8

    /// Stop-loss price in 6-decimal fixed-point (0 = no SL)
    pub sl_price: u64,       // 8

    /// Whether the position is long (revealed at set-time by user)
    /// None means not yet set; Some(true) = long, Some(false) = short
    pub is_long: u8,         // 1  (0 = unset, 1 = long, 2 = short)

    /// Whether this TP/SL order is active
    pub active: bool,        // 1

    /// Bump seed for PDA derivation
    pub bump: u8,            // 1

    /// Reserved space for future upgrades
    pub _reserved: [u8; 13], // 13
    // Total body: 32+32+32+8+8+1+1+1+13 = 128
    // + 8 discriminator = 136
}

impl Default for TpSlOrder {
    fn default() -> Self {
        Self {
            position: Pubkey::default(),
            owner: Pubkey::default(),
            market: Pubkey::default(),
            tp_price: 0,
            sl_price: 0,
            is_long: 0,
            active: false,
            bump: 0,
            _reserved: [0u8; 13],
        }
    }
}

impl TpSlOrder {
    pub const LEN: usize = 8 +  // discriminator
        32 + // position
        32 + // owner
        32 + // market
        8 +  // tp_price
        8 +  // sl_price
        1 +  // is_long (u8 encoding)
        1 +  // active
        1 +  // bump
        13;  // _reserved

    pub const IS_LONG_UNSET: u8 = 0;
    pub const IS_LONG_LONG: u8 = 1;
    pub const IS_LONG_SHORT: u8 = 2;
}

/// Events

#[event]
pub struct TpSlOrderSet {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub tp_price: u64,
    pub sl_price: u64,
    pub is_long: bool,
}

#[event]
pub struct TpSlOrderCancelled {
    pub position: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct TpSlTriggered {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub trigger_type: u8,  // 1 = TP, 2 = SL
    pub trigger_price: u64,
    pub mark_price: u64,
}
