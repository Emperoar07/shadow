use anchor_lang::prelude::*;
use crate::errors::ShadowPerpError;
use super::position::MarginMode;

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

    /// Deprecated public accumulator (kept for account layout compatibility).
    /// Do not use for analytics/privacy-sensitive surfaces.
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
    const CROSS_LOCKED_OFFSET: usize = 0;
    const ISOLATED_LOCKED_OFFSET: usize = 8;

    fn read_u64_reserved(&self, offset: usize) -> u64 {
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&self._reserved[offset..offset + 8]);
        u64::from_le_bytes(buf)
    }

    fn write_u64_reserved(&mut self, offset: usize, value: u64) {
        self._reserved[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }

    pub fn cross_locked_balance(&self) -> u64 {
        self.read_u64_reserved(Self::CROSS_LOCKED_OFFSET)
    }

    pub fn isolated_locked_balance(&self) -> u64 {
        self.read_u64_reserved(Self::ISOLATED_LOCKED_OFFSET)
    }

    fn set_cross_locked_balance(&mut self, value: u64) {
        self.write_u64_reserved(Self::CROSS_LOCKED_OFFSET, value);
    }

    fn set_isolated_locked_balance(&mut self, value: u64) {
        self.write_u64_reserved(Self::ISOLATED_LOCKED_OFFSET, value);
    }

    pub fn legacy_unbucketed_locked_balance(&self) -> Result<u64> {
        let bucketed = self
            .cross_locked_balance()
            .checked_add(self.isolated_locked_balance())
            .ok_or(ShadowPerpError::ArithmeticOverflow)?;
        self.locked_balance
            .checked_sub(bucketed)
            .ok_or(ShadowPerpError::ArithmeticOverflow.into())
    }

    pub fn lock_margin(&mut self, mode: MarginMode, amount: u64) -> Result<()> {
        let current = match mode {
            MarginMode::Cross => self.cross_locked_balance(),
            MarginMode::Isolated => self.isolated_locked_balance(),
        };
        let next_bucket = current
            .checked_add(amount)
            .ok_or(ShadowPerpError::ArithmeticOverflow)?;
        match mode {
            MarginMode::Cross => self.set_cross_locked_balance(next_bucket),
            MarginMode::Isolated => self.set_isolated_locked_balance(next_bucket),
        }

        self.locked_balance = self
            .locked_balance
            .checked_add(amount)
            .ok_or(ShadowPerpError::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn unlock_margin(&mut self, mode: MarginMode, amount: u64) -> Result<()> {
        let cross_locked = self.cross_locked_balance();
        let isolated_locked = self.isolated_locked_balance();

        let (next_cross_locked, next_isolated_locked, fallback_deficit) = match mode {
            MarginMode::Cross => {
                if cross_locked >= amount {
                    (cross_locked - amount, isolated_locked, 0)
                } else {
                    (0, isolated_locked, amount - cross_locked)
                }
            }
            MarginMode::Isolated => {
                if isolated_locked >= amount {
                    (cross_locked, isolated_locked - amount, 0)
                } else {
                    (cross_locked, 0, amount - isolated_locked)
                }
            }
        };

        if fallback_deficit > 0 {
            let bucketed_locked = cross_locked
                .checked_add(isolated_locked)
                .ok_or(ShadowPerpError::ArithmeticOverflow)?;
            let legacy_unbucketed = self
                .locked_balance
                .checked_sub(bucketed_locked)
                .ok_or(ShadowPerpError::ArithmeticOverflow)?;
            require!(
                legacy_unbucketed >= fallback_deficit,
                ShadowPerpError::ArithmeticOverflow
            );
        }

        self.locked_balance = self
            .locked_balance
            .checked_sub(amount)
            .ok_or(ShadowPerpError::ArithmeticOverflow)?;
        self.set_cross_locked_balance(next_cross_locked);
        self.set_isolated_locked_balance(next_isolated_locked);
        Ok(())
    }

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
        64; // reserved
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
