//! Execute Private Order Circuit
//!
//! Validates a private limit order against the current market price and
//! produces the decrypted order parameters needed to open a position,
//! but only if the trigger condition is met.
//!
//! Privacy: Order size, price, and direction remain encrypted until the
//! trigger fires. Only the trigger decision and output position parameters
//! are revealed â€” and only when the order actually executes.

use arcis::*;

#[encrypted]
mod execute_private_order_circuit {
    use arcis::*;

    /// Evaluate a private limit order against the current market price.
    ///
    /// Inputs:
    ///   - order: Enc<Shared, (u64, u64, bool)>
    ///       field_0 = size          â€” order size (encrypted)
    ///       field_1 = trigger_price â€” limit price set by the trader (encrypted)
    ///       field_2 = is_long       â€” direction (encrypted)
    ///   - mark_price: u64  â€” current oracle price (plaintext)
    ///
    /// Returns:
    ///   - triggered: bool â€” whether the limit condition is met
    ///   - size: u64       â€” revealed only if triggered (0 otherwise)
    ///   - entry_price: u64 â€” mark price at trigger time (revealed if triggered)
    ///   - is_long: bool   â€” direction (revealed if triggered)
    #[instruction]
    pub fn execute_private_order(
        order: Enc<Shared, (u64, u64, bool)>,
        mark_price: u64,
    ) -> (bool, u64, u64, bool) {
        let (size, trigger_price, is_long) = order.to_arcis();

        // For a long limit order: buy when price drops to or below trigger_price
        // For a short limit order: sell when price rises to or above trigger_price
        let triggered = if is_long {
            mark_price <= trigger_price
        } else {
            mark_price >= trigger_price
        };

        let out_size = if triggered { size } else { 0 };
        let out_price = if triggered { mark_price } else { 0 };
        // Always reveal the same sentinel (false) when not triggered so that
        // repeated calls at different prices cannot leak direction via the
        // is_long output changing from falseâ†’true at the threshold.
        // The caller must only act on is_long when triggered=true.
        let out_long = if triggered { is_long } else { false };

        (
            triggered.reveal(),
            out_size.reveal(),
            out_price.reveal(),
            out_long.reveal(),
        )
    }
}
