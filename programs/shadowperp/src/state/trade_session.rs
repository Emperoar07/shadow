use anchor_lang::prelude::*;

use crate::errors::ShadowPerpError;

/// Delegated trading session approved by owner once, then consumed by relayer.
#[account]
pub struct TradeSession {
    /// Session owner whose margin/positions are affected.
    pub owner: Pubkey,
    /// Market scope for this session.
    pub market: Pubkey,
    /// Authorized relayer signer.
    pub relayer: Pubkey,
    /// User-chosen session id for deterministic PDA derivation.
    pub session_id: u64,
    /// Hard cap on how many delegated actions can be executed.
    pub max_actions: u32,
    /// Number of delegated actions already consumed.
    pub used_actions: u32,
    /// Per-open cap to reduce blast radius if relayer misbehaves.
    pub max_margin_per_action: u64,
    /// Unix timestamp after which this session is invalid.
    pub expires_at: i64,
    /// Explicit owner revocation bit.
    pub revoked: bool,
    /// Bump for PDA.
    pub bump: u8,
    /// Reserved for upgrades.
    pub _reserved: [u8; 30],
}

/// Wallet-scoped delegated trading session that can be used across all supported markets.
#[account]
pub struct TradeSessionV2 {
    /// Session owner whose margin/positions are affected.
    pub owner: Pubkey,
    /// Authorized relayer signer.
    pub relayer: Pubkey,
    /// User-chosen session id for deterministic PDA derivation.
    pub session_id: u64,
    /// Hard cap on how many delegated actions can be executed.
    pub max_actions: u32,
    /// Number of delegated actions already consumed.
    pub used_actions: u32,
    /// Per-open cap to reduce blast radius if relayer misbehaves.
    pub max_margin_per_action: u64,
    /// Unix timestamp after which this session is invalid.
    pub expires_at: i64,
    /// Explicit owner revocation bit.
    pub revoked: bool,
    /// Whether the session is allowed to operate on every supported market.
    pub scope_all_markets: bool,
    /// Bump for PDA.
    pub bump: u8,
    /// Reserved for upgrades.
    pub _reserved: [u8; 29],
}

impl Default for TradeSession {
    fn default() -> Self {
        Self {
            owner: Pubkey::default(),
            market: Pubkey::default(),
            relayer: Pubkey::default(),
            session_id: 0,
            max_actions: 0,
            used_actions: 0,
            max_margin_per_action: 0,
            expires_at: 0,
            revoked: false,
            bump: 0,
            _reserved: [0u8; 30],
        }
    }
}

impl Default for TradeSessionV2 {
    fn default() -> Self {
        Self {
            owner: Pubkey::default(),
            relayer: Pubkey::default(),
            session_id: 0,
            max_actions: 0,
            used_actions: 0,
            max_margin_per_action: 0,
            expires_at: 0,
            revoked: false,
            scope_all_markets: true,
            bump: 0,
            _reserved: [0u8; 29],
        }
    }
}

impl TradeSession {
    pub const LEN: usize = 8 + // discriminator
        32 + // owner
        32 + // market
        32 + // relayer
        8 +  // session_id
        4 +  // max_actions
        4 +  // used_actions
        8 +  // max_margin_per_action
        8 +  // expires_at
        1 +  // revoked
        1 +  // bump
        30; // reserved

    pub fn assert_active(
        &self,
        relayer: Pubkey,
        market: Pubkey,
        now_ts: i64,
    ) -> Result<()> {
        require!(!self.revoked, ShadowPerpError::SessionRevoked);
        require!(self.relayer == relayer, ShadowPerpError::Unauthorized);
        require!(self.market == market, ShadowPerpError::Unauthorized);
        require!(now_ts <= self.expires_at, ShadowPerpError::SessionExpired);
        require!(
            self.used_actions < self.max_actions,
            ShadowPerpError::SessionActionLimitReached
        );
        Ok(())
    }

    pub fn consume_open_action(&mut self, margin: u64) -> Result<()> {
        require!(margin > 0, ShadowPerpError::ZeroAmount);
        require!(
            margin <= self.max_margin_per_action,
            ShadowPerpError::SessionMarginLimitExceeded
        );
        self.used_actions = self
            .used_actions
            .checked_add(1)
            .ok_or(ShadowPerpError::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn consume_action(&mut self) -> Result<()> {
        self.used_actions = self
            .used_actions
            .checked_add(1)
            .ok_or(ShadowPerpError::ArithmeticOverflow)?;
        Ok(())
    }
}

impl TradeSessionV2 {
    pub const LEN: usize = 8 + // discriminator
        32 + // owner
        32 + // relayer
        8 +  // session_id
        4 +  // max_actions
        4 +  // used_actions
        8 +  // max_margin_per_action
        8 +  // expires_at
        1 +  // revoked
        1 +  // scope_all_markets
        1 +  // bump
        29; // reserved

    pub fn assert_active(&self, relayer: Pubkey, now_ts: i64) -> Result<()> {
        require!(!self.revoked, ShadowPerpError::SessionRevoked);
        require!(self.relayer == relayer, ShadowPerpError::Unauthorized);
        require!(now_ts <= self.expires_at, ShadowPerpError::SessionExpired);
        require!(
            self.used_actions < self.max_actions,
            ShadowPerpError::SessionActionLimitReached
        );
        require!(self.scope_all_markets, ShadowPerpError::Unauthorized);
        Ok(())
    }

    pub fn consume_open_action(&mut self, margin: u64) -> Result<()> {
        require!(margin > 0, ShadowPerpError::ZeroAmount);
        require!(
            margin <= self.max_margin_per_action,
            ShadowPerpError::SessionMarginLimitExceeded
        );
        self.used_actions = self
            .used_actions
            .checked_add(1)
            .ok_or(ShadowPerpError::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn consume_action(&mut self) -> Result<()> {
        self.used_actions = self
            .used_actions
            .checked_add(1)
            .ok_or(ShadowPerpError::ArithmeticOverflow)?;
        Ok(())
    }
}

#[event]
pub struct TradeSessionCreated {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub relayer: Pubkey,
    pub session_id: u64,
    pub max_actions: u32,
    pub max_margin_per_action: u64,
    pub expires_at: i64,
}

#[event]
pub struct TradeSessionRevoked {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub relayer: Pubkey,
    pub session_id: u64,
}

#[event]
pub struct TradeSessionV2Created {
    pub owner: Pubkey,
    pub relayer: Pubkey,
    pub session_id: u64,
    pub max_actions: u32,
    pub max_margin_per_action: u64,
    pub expires_at: i64,
    pub scope_all_markets: bool,
}

#[event]
pub struct TradeSessionV2Revoked {
    pub owner: Pubkey,
    pub relayer: Pubkey,
    pub session_id: u64,
    pub scope_all_markets: bool,
}
