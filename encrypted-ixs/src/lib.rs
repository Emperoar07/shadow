//! ShadowPerp Encrypted Circuits
//!
//! These circuits run inside Arcium's MPC environment.
//! All computation happens on encrypted data - nodes never see plaintext values.
//!
//! Privacy guarantees:
//! - Position size: NEVER revealed
//! - Entry price: NEVER revealed
//! - Leverage: NEVER revealed
//! - Direction (long/short): NEVER revealed
//! - Health factor: NEVER revealed
//! - Realized PnL: Revealed ONLY at position close

pub mod close_position;
pub mod liquidation_check;
pub mod open_position;
pub mod types;
