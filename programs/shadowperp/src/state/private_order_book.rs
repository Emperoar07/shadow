use anchor_lang::prelude::*;

/// Maximum encrypted orders retained per account.
pub const MAX_PRIVATE_ORDERS: usize = 128;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct EncryptedOrder {
    /// Encrypted size payload (client-side encrypted before submission).
    pub encrypted_size: [u8; 32],
    /// Encrypted price payload (client-side encrypted before submission).
    pub encrypted_price: [u8; 32],
    /// Encrypted owner low limb / share.
    pub encrypted_owner_lo: [u8; 32],
    /// Encrypted owner high limb / share.
    pub encrypted_owner_hi: [u8; 32],
    /// Client nonce for deterministic decrypt context.
    pub nonce: [u8; 16],
    /// Creation timestamp.
    pub created_at: i64,
}

impl EncryptedOrder {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 16 + 8;
}

/// User-scoped encrypted private order book.
#[account]
pub struct ConfidentialOrderBook {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub order_count: u64,
    /// Encrypted bid-side orders.
    pub bids: Vec<EncryptedOrder>,
    /// Encrypted ask-side orders.
    pub asks: Vec<EncryptedOrder>,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

impl Default for ConfidentialOrderBook {
    fn default() -> Self {
        Self {
            owner: Pubkey::default(),
            market: Pubkey::default(),
            order_count: 0,
            bids: Vec::new(),
            asks: Vec::new(),
            bump: 0,
            _reserved: [0u8; 64],
        }
    }
}

impl ConfidentialOrderBook {
    pub const LEN: usize = 8 + // discriminator
        32 + // owner
        32 + // market
        8 +  // order_count
        4 + (MAX_PRIVATE_ORDERS * EncryptedOrder::LEN) + // bids vec prefix + max encrypted bids
        4 + (MAX_PRIVATE_ORDERS * EncryptedOrder::LEN) + // asks vec prefix + max encrypted asks
        1 +  // bump
        64; // reserved

    pub fn total_orders(&self) -> usize {
        self.bids.len() + self.asks.len()
    }
}

/// Backward-compatible alias for older handler names.
pub type PrivateOrderBook = ConfidentialOrderBook;

#[event]
pub struct PrivateOrderBookInitialized {
    pub owner: Pubkey,
    pub market: Pubkey,
}

#[event]
pub struct PrivateOrderQueued {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub order_index: u64,
    pub timestamp: i64,
}
