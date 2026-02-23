use anchor_lang::prelude::*;

/// Required by arcium-anchor macros (`#[callback_accounts]` generates code referencing
/// `ErrorCode::ClusterNotSet`).
#[error_code]
pub enum ErrorCode {
    #[msg("Cluster not set on MXE account")]
    ClusterNotSet,
}

#[error_code]
pub enum ShadowPerpError {
    #[msg("Unauthorized access")]
    Unauthorized,

    #[msg("Invalid leverage - must be between 1 and max leverage")]
    InvalidLeverage,

    #[msg("Insufficient margin for position")]
    InsufficientMargin,

    #[msg("Position is not open")]
    PositionNotOpen,

    #[msg("Position is already closed")]
    PositionAlreadyClosed,

    #[msg("Invalid oracle price")]
    InvalidPrice,

    #[msg("Price is stale - needs update")]
    StalePrice,

    #[msg("Computation already in progress")]
    ComputationInProgress,

    #[msg("Invalid computation result")]
    InvalidComputationResult,

    #[msg("Market is paused")]
    MarketPaused,

    #[msg("Insufficient balance for withdrawal")]
    InsufficientBalance,

    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Position cannot be liquidated - health factor above threshold")]
    CannotLiquidate,

    #[msg("Invalid nonce")]
    InvalidNonce,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Invalid account data")]
    InvalidAccountData,

    #[msg("Trade session is expired")]
    SessionExpired,

    #[msg("Trade session is revoked")]
    SessionRevoked,

    #[msg("Trade session action limit reached")]
    SessionActionLimitReached,

    #[msg("Trade session per-action margin limit exceeded")]
    SessionMarginLimitExceeded,
}
