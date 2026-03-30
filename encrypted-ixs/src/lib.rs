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
pub mod lock_margin_private;
pub mod open_position;
pub mod seed_open_interest_state;
pub mod settle_private_position;
pub mod types;

pub use close_position::*;
pub use liquidation_check::*;
pub use lock_margin_private::*;
pub use open_position::*;
pub use seed_open_interest_state::*;
pub use settle_private_position::*;
