# Privacy Margin Migration Plan

## Goal
Remove active-position dependence on plaintext `position.margin` while keeping
collateral accounting correct and preserving compatibility with already-open
positions.

## What Changed
- Open callback no longer persists active lock amount in `position.margin`.
- Close circuit output now includes `locked_margin`, and close callback uses it
  for unlock + settlement accounting.
- Liquidation callback uses MPC-revealed `revealed_margin` when liquidation
  occurs.
- Close/liquidation callbacks keep a legacy fallback to persisted
  `position.margin` for positions opened before this migration.

## Account Compatibility
- No account reallocation is required.
- `Position.margin` and `Position.requested_margin` remain in layout for
  backward compatibility, but are deprecated for active positions.
- `requested_margin` is now pending-only and cleared once open callback settles.

## Rollout Steps
1. Regenerate Arcium artifacts from updated circuits:
   - `encrypted-ixs/src/open_position.rs`
   - `encrypted-ixs/src/close_position.rs`
   - `encrypted-ixs/src/liquidation_check.rs`
2. Rebuild program with regenerated output types and deploy upgrade.
3. Re-initialize computation definitions on devnet for open/close/liquidation.
4. Sync market comp-def pointers and restart frontend with updated IDL + env.

## Operational Commands (Devnet)
1. `wsl -e bash -lc "cd /mnt/c/Users/bolaj/projects/shadowperp && bash _build_circuits.sh"`
2. `npm run build:anchor:safe`
3. `npm run deploy:anchor:safe`
4. `npx ts-node scripts/init-comp-defs.ts --program <PROGRAM_ID> --market <MARKET_PDA> --rpc https://api.devnet.solana.com --arcium-program Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ --mxe-program <PROGRAM_ID> --cluster-offset 456`
5. `npx ts-node scripts/sync-market-comp-defs.ts --program <PROGRAM_ID> --market <MARKET_PDA> --rpc https://api.devnet.solana.com --mxe-program <PROGRAM_ID>`

## Legacy Position Behavior
- Positions opened before migration may still have plaintext `position.margin`.
- They continue to close/liquidate safely due callback fallback logic.
- New positions opened after migration keep `position.margin = 0` while active.

## Post-Migration Hardening (Optional)
- After legacy positions are settled, scrub residual plaintext fields from
  historical analytics surfaces.
- Move additional public counters to encrypted/account-abstracted strategy if
  stricter confidentiality is required.
