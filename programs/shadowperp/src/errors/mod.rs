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

    #[msg("Invalid liquidation threshold - must be between 1 and 5000 bps (0.01%–50%)")]
    InvalidLiquidationThreshold,

    #[msg("Invalid trading fee - must be at most 500 bps (5%)")]
    InvalidTradingFee,

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

    #[msg("Shielded collateral feature not enabled")]
    ShieldedNotEnabled,

    #[msg("Nullifier already spent")]
    NullifierAlreadySpent,

    #[msg("Invalid commitment proof")]
    InvalidCommitmentProof,

    #[msg("Withdrawal delay not yet passed")]
    WithdrawalNotReady,

    #[msg("Commitment tree is full")]
    CommitmentTreeFull,

    #[msg("Pending computation has timed out")]
    PendingComputationTimeout,

    #[msg("Mark price deviation exceeds the allowed cap from index price")]
    MarkPriceDeviationExceedsCap,

    #[msg("Funding interval has not elapsed yet")]
    FundingIntervalNotElapsed,

    #[msg("Open interest cap exceeded for this direction")]
    OiCapExceeded,

    #[msg("TP/SL order is not active")]
    TpSlNotActive,

    #[msg("TP/SL trigger conditions not met")]
    TpSlNotTriggered,

    #[msg("Invalid TP/SL price configuration")]
    InvalidTpSlPrice,

    #[msg("Mark price is not set or stale")]
    MarkPriceStale,

    #[msg("On-chain TP/SL requires a private direction-proof path and is currently disabled")]
    TpSlPrivateDirectionUnsupported,
}
