use anchor_lang::prelude::*;

/// User's margin account for collateral management
#[account]
pub struct MarginAccount {
    /// Owner of the margin account
    pub owner: Pubkey,

    /// Associated market
    pub market: Pubkey,

    /// Available collateral balance
    pub balance: u64,

    /// Collateral locked in open positions
    pub locked_balance: u64,

    /// Total deposited all-time
    pub total_deposited: u64,

    /// Total withdrawn all-time
    pub total_withdrawn: u64,

    /// Number of positions opened
    pub positions_opened: u64,

    /// Number of positions closed
    pub positions_closed: u64,

    /// Total realized PnL (sum of all closed positions)
    pub total_realized_pnl: i64,

    /// Bump seed for PDA derivation
    pub bump: u8,

    /// Reserved space for future upgrades
    pub _reserved: [u8; 64],
}

impl Default for MarginAccount {
    fn default() -> Self {
        Self {
            owner: Pubkey::default(),
            market: Pubkey::default(),
            balance: 0,
            locked_balance: 0,
            total_deposited: 0,
            total_withdrawn: 0,
            positions_opened: 0,
            positions_closed: 0,
            total_realized_pnl: 0,
            bump: 0,
            _reserved: [0u8; 64],
        }
    }
}

impl MarginAccount {
    pub const LEN: usize = 8 +  // discriminator
        32 + // owner
        32 + // market
        8 +  // balance
        8 +  // locked_balance
        8 +  // total_deposited
        8 +  // total_withdrawn
        8 +  // positions_opened
        8 +  // positions_closed
        8 +  // total_realized_pnl
        1 +  // bump
        64;  // reserved
}

/// Event emitted when collateral is deposited
#[event]
pub struct CollateralDeposited {
    pub owner: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}

/// Event emitted when collateral is withdrawn
#[event]
pub struct CollateralWithdrawn {
    pub owner: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}
