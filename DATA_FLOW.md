# ShadowPerp Data Flow

This document describes the live request/response flow across UI, Solana, and Arcium.

## 1. Open Position Flow

### Input

- user sets side, size, leverage, order type, optional TP/SL
- UI derives margin requirement estimate from oracle/market data

### Execution Path

1. UI builds encrypted order payload client-side
2. UI sends `open_position` instruction to program
3. Program validates basic guards:
   - margin availability
   - oracle freshness
   - account constraints
4. Program queues Arcium computation via `queue_computation`
5. Arcium cluster executes `open_position` circuit
6. Callback `open_position_v2_callback` verifies output and updates state

### State Effects

- position moves `Pending -> Open` on successful callback
- margin lock updates occur in margin account
- market open interest encrypted aggregates update from callback output

## 2. Close Position Flow

1. UI requests close for open position
2. Program queues `close_position` computation
3. Arcium computes settlement outputs
4. Callback verifies output and settles balances
5. position transitions to closed/liquidated terminal state

## 3. Liquidation Check Flow

1. Keeper/user triggers liquidation check
2. Program queues `check_liquidation` computation
3. Callback applies liquidation action only when condition is true

## 4. Collateral Flow

### Deposit

- UI sends deposit instruction
- SPL transfer into program vault
- margin account balance increases

### Withdraw

- UI sends withdraw instruction
- program enforces available margin checks
- SPL transfer from vault to user token account

Note:

- Current collateral transfer path is public at L1.
- Planned shielded internal collateral accounting is specified in `PRIVATE_COLLATERAL_SPEC.md`.

## 5. Oracle Flow

- feeder updates on-chain oracle through `update_price`
- trading paths enforce max staleness window
- stale oracle blocks open/close/liquidation operations

Operational scripts:

- one-shot: `npm run oracle:once`
- daemon: `npm run oracle:daemon`
- check: `npm run check:oracle`

## 6. Network/RPC Flow

- script layer resolves healthy RPC from configured candidate list
- UI layer can switch among configured endpoints manually
- preferred UI endpoint index persists locally and triggers provider rebind

## 7. Preflight and Smoke Flow

Use this sequence before real testing:

1. `npm run check:preflight`
2. `npm run oracle:once` or daemon
3. `npm run check:stable`
4. run smoke path (`_smoke_devnet.ts`) and verify:
   - deposit
   - open
   - callback progression
   - close

## 8. Typical Failure Classes

### Arcium queue invalid arguments

Likely cause:

- circuit signature / comp-def mismatch across local artifacts, deployed binary, and finalized comp-def

Fix:

- regenerate circuits
- rebuild/deploy program
- re-init/sync comp-def pointers

### Stale price

Likely cause:

- oracle daemon not running or delayed updates

Fix:

- refresh oracle and rerun

### Missing env at client init

Likely cause:

- missing `NEXT_PUBLIC_*` vars in `app/.env.local`

Fix:

- set vars and restart dev server
