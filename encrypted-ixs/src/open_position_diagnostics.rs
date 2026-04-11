//! Open Position Diagnostic Circuits
//!
//! These probes isolate the failing `open_position_probe_b` contract into
//! smaller Arcium computations so we can identify which layer starts aborting.

use arcis_imports::*;

#[encrypted]
mod open_position_diagnostics_circuit {
    use arcis_imports::*;

    #[instruction]
    pub fn open_position_tuple_probe_v1(
        inputs: Enc<Shared, (u64, u64, u8, bool, u64)>,
    ) -> bool {
        let _ = inputs.to_arcis();
        true.reveal()
    }

    #[instruction]
    pub fn open_position_margin_probe_v1(
        inputs: Enc<Shared, (u64, u64, u8, bool, u64)>,
        requested_margin: u64,
    ) -> bool {
        let (_size, _entry_price, _leverage, _is_long, margin) = inputs.to_arcis();
        (margin == requested_margin).reveal()
    }

    #[instruction]
    pub fn open_position_full_probe_v1(
        inputs: Enc<Shared, (u64, u64, u8, bool, u64)>,
        requested_margin: u64,
        max_leverage: u8,
    ) -> (bool, bool, bool, bool) {
        let (size, _entry_price, leverage, _is_long, margin) = inputs.to_arcis();

        let size_ok = size > 0u64;
        let margin_ok = margin > 0u64;
        let requested_margin_ok = margin == requested_margin;
        let leverage_ok = leverage >= 1u8 && leverage <= max_leverage;

        (
            size_ok.reveal(),
            margin_ok.reveal(),
            requested_margin_ok.reveal(),
            leverage_ok.reveal(),
        )
    }
}
