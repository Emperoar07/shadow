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
pub mod execute_private_order;
pub mod liquidation_check;
pub mod lock_margin_private;
pub mod open_position;
pub mod open_position_diagnostics;
pub mod seed_open_interest_state;
pub mod settle_private_position;
pub mod types;
pub mod verify_withdrawal_proof;

pub use close_position::*;
pub use execute_private_order::*;
pub use liquidation_check::*;
pub use lock_margin_private::*;
pub use open_position::*;
pub use open_position_diagnostics::*;
pub use seed_open_interest_state::*;
pub use settle_private_position::*;
pub use verify_withdrawal_proof::*;
