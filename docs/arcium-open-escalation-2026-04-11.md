# Arcium Open Lane Escalation Packet (2026-04-11 UTC)

This packet summarizes the current live ShadowPerp devnet evidence for the open-position Arcium abort.

## Live Deployment Context

- Repo branch: `master`
- Program: `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`
- Primary market: `crEV9TSAU6xkiWFUAZebejHmWVh6VFx5EEFLcfX9L2T`
- Cluster offset: `456`
- Active wallet / upload authority: `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt`

## Fresh Deploys and Health Checks

- Updated diagnostic-enabled program deploy tx:
  - `3JnkDSXbJwaopVKXH3PKMXGxzGvWEh9QrajgGFto4UiFovTZ6zCYZRbCmVk1sE1mV2g1sxvGJT7Ya87px6x3xvHZ`
- Fresh oracle update tx:
  - `3bi4ZNtWTmBeFiXbxWTNNyTEJyeRsD4u2pcPKTWdqoQ9u54vXUAVrqQMDjHz5X624bPpGqoWBQ2ar8ic35tUQrzM`
- `npm run check:preflight`:
  - PASS after oracle refresh

## Diagnostic Question

We wanted to isolate whether the live open-position abort is caused by:

1. the encrypted tuple lane itself
2. the plaintext `requested_margin` cross-check
3. the plaintext `max_leverage` cross-check
4. a later branch in the fuller open business logic

## Diagnostic Lanes Added

Three devnet-safe diagnostic computations were added and deployed:

1. `open_position_tuple_probe_v1`
2. `open_position_margin_probe_v1`
3. `open_position_full_probe_v1`

The goal was to progressively reintroduce logic on top of the same encrypted open tuple contract.

## Live Probe Results

### 1. Tuple-only probe

- Queue tx:
  - `fWvsdb8dractFh4yQghxPTVn7MxFUEb5jUCxbauiVNvo2uqfgHjbx4yQFDpPVHZMGGPF2DfL6z1djviQsMv3VP3`
- Diagnostic PDA:
  - `AdUxoy4SimDBJbM1Joxqm39Naad9SA1KtVoci4sSzJfB`
- Final status:
  - `aborted`

### 2. Margin-check probe

- Queue tx:
  - `VnSqfvgskHs5Gy1KfUhiVXYbEkaqgcXjiVNSsC9gpa9QRQEHFMcbC72hsitmkpGAkfae5njiQnxQsTYSivTo2KS`
- Diagnostic PDA:
  - `GGvxzs4jFq5tJ8hAjEatapBkKZY7bJMSS6NMkGmyL1qC`
- Final status:
  - `aborted`

### 3. Full-check probe

- Queue tx:
  - `3shup8vhA4gQUwEXDHwBjFnLiMqqx171FSoU3WjszPNBvJ2ZfGXUaN2zCyheN25unoX6m5JGT7hnm7EGyvzpSUx9`
- Diagnostic PDA:
  - `61ZQYCxUqXPpCmzkTVFK8EcUoytwdJonnmv8QhZFsKJi`
- Final status:
  - `aborted`

All three stages returned result flags equivalent to all-false / abort-path completion.

## Strongest Current Conclusion

The open abort is not introduced by:

- `requested_margin`
- `max_leverage`
- the fuller business-rule branch in the full diagnostic lane

The failure reproduces even in the stripped-down tuple-only probe. That pushes the likely root cause toward one of:

1. an Arcium runtime issue on this fresh encrypted open tuple lane
2. a lower-level contract mismatch that exists before the extra plaintext checks matter

## Relevant Local Fixes Already Applied

- Fixed the diagnostic PDA seed bug in the on-chain diagnostic handlers and redeployed.
- Confirmed the diagnostic instructions are live on the deployed program.
- Synced local RPC fallback order to prefer:
  1. QuickNode
  2. ZAN
  3. Helius
  4. Alchemy
  5. public devnet
- Fixed RPC-to-WS pairing so a preferred RPC now resolves to the matching websocket endpoint.

## Ask For Arcium

Please help verify whether the current open tuple lane is hitting:

1. a known runtime abort pattern for fresh `Enc<Shared, (u64, u64, u8, bool, u64)>` inputs
2. a callback/result verification edge case specific to this lane
3. a lower-level computation contract issue not visible from local signature / param-count checks

## Safe Next Step After Feedback

Keep the diagnostic harness in place and rerun the same three probes after any Arcium-side guidance or code change.
