# ShadowPerp Private Collateral Spec (Devnet First)

Status: design proposal for implementation
Owner: ShadowPerp core team
Last updated: 2026-02-23

## 1. Goal

Add private collateral accounting to ShadowPerp while preserving:

- canonical devnet USDC deposits/withdrawals
- existing Arcium MPC trade privacy flow
- deterministic rollback path if issues appear

Important boundary:

- SPL token transfers are public on Solana.
- Privacy target is internal collateral ownership, allocation, and margin transitions inside protocol state.

## 2. Scope and Non-Goals

### In scope

- Shielded internal collateral ledger backed by vault reserves
- Private margin lock/release transitions for open/close flows
- Replay-safe callback binding for all private collateral mutations
- Migration path from current public `MarginAccount.balance`

### Out of scope (phase 1)

- Fully private L1 deposit amount hiding (not possible with direct SPL transfer)
- Anonymous withdrawals on L1 without a relayer/privacy set design
- Mainnet launch criteria (this is devnet hardening first)

## 3. Threat Model

We protect against:

- observers linking per-user internal margin state over time
- replayed callbacks mutating balances twice
- malformed MPC outputs
- account substitution in callback/settlement paths

We accept:

- public visibility of L1 token transfers to/from vault
- public timestamps of deposit/withdraw transactions

## 4. High-Level Architecture

Use a "public edge, private core" model:

1. User deposits canonical USDC to vault (public).
2. Program creates a shielded collateral commitment in protocol state.
3. Trade lifecycle consumes/produces shielded commitments through Arcium MPC.
4. Withdrawal burns/marks a commitment and releases public USDC from vault.

## 5. On-Chain State Additions

Add new accounts/state (versioned):

- `ShieldedPool` (per market)
  - `market`
  - `collateral_mint`
  - `vault`
  - `tree_root`
  - `tree_depth`
  - `next_leaf_index`
  - `total_public_in`
  - `total_public_out`
  - `version`

- `CommitmentTree` (or chunked tree accounts)
  - append-only commitment storage and rolling roots

- `NullifierSet`
  - marks spent commitments/nullifiers
  - prevents double spend/replay

- `PendingWithdrawal`
  - withdrawal intent tied to nullifier + recipient + amount + expiry

- `MarginAccountV2` (or extension)
  - keeps compatibility fields
  - points to shielded ownership context
  - no plaintext active margin requirement in steady state

## 6. Instruction Set (Proposed)

### 6.1 Initialization

- `init_shielded_pool`
  - creates `ShieldedPool`, `CommitmentTree`, `NullifierSet`
  - binds to market and canonical collateral mint

### 6.2 Public Deposit -> Shielded Credit

- `deposit_to_shielded`
  - SPL transfer user ATA -> vault
  - append commitment leaf to tree
  - increment `total_public_in`
  - emit minimal event without plaintext internal allocation details

Inputs:

- `amount` (public, in token units)
- `commitment` (32-byte commitment)
- optional encrypted metadata blob

### 6.3 Shielded Margin Lock for Open

- `lock_margin_private`
  - queues Arcium computation with:
    - commitment inclusion reference
    - encrypted balance/margin intent
  - callback validates output and writes updated root/position linkage

### 6.4 Settlement for Close/Liquidation

- `settle_private_position`
  - consumes position + shielded state reference
  - callback applies PnL/funding/fees privately and updates commitment root

### 6.5 Shielded Withdraw

- `request_withdraw_private`
  - verifies nullifier not spent
  - verifies inclusion/proof context
  - writes `PendingWithdrawal`

- `finalize_withdraw`
  - marks nullifier spent
  - transfers vault -> recipient ATA
  - increments `total_public_out`

## 7. Arcium Circuit Layer Changes

Add/adjust circuits for:

- private balance update transitions
- margin lock/release transitions
- settlement output generation with strict schema lengths

Rules:

- fixed output schema and exact length checks in callbacks
- each encrypted element length validated explicitly
- callback binds to:
  - expected market
  - expected cluster/comp-def
  - expected computation reference/nonce

## 8. Anti-Replay and Binding Requirements

For every callback mutation:

- store pending computation reference in state
- require exact computation account/key match
- require one-time nonce/sequence consumption
- clear pending reference after successful callback
- reject duplicate callback attempts

## 9. Event and Privacy Policy

Do not emit plaintext internal collateral details.

Allowed event fields:

- lifecycle status booleans
- market and account references
- tx-level identifiers

Avoid in events:

- realized PnL exact values (if policy is private by default)
- per-position liquidation price if not required publicly
- cumulative per-user profitability counters

## 10. Migration Plan

### Phase A: Dual-Path Deployment

- keep legacy public margin path active
- deploy shielded pool accounts and instructions behind feature flag

### Phase B: Opt-In Conversion

- `migrate_margin_to_shielded`
  - user converts public margin balance into initial commitment
  - mark account version to v2 mode

### Phase C: Default New Users to Shielded

- new accounts use shielded path by default
- legacy path remains read/close-only for old positions

### Phase D: Legacy Sunset

- disable new legacy margin opens
- keep controlled emergency withdrawal for legacy balances

## 11. UI/API Requirements

### UI

- keep "privacy by default" messaging minimal
- do not show fake orderbook depth or synthetic private metrics as real
- clear action errors:
  - missing runtime vars
  - stale oracle
  - shielded proof/callback failure

### SDK

- add explicit methods:
  - `depositToShielded(...)`
  - `requestWithdrawPrivate(...)`
  - `finalizeWithdraw(...)`
- preserve existing methods during migration window

## 12. Testing and Verification Matrix

### Unit

- commitment append/root update
- nullifier spend once semantics
- invariant checks for balances and vault conservation

### Integration (localnet/devnet)

- deposit -> lock margin -> close -> withdraw
- replay attempt on callbacks
- malformed output length rejection
- stale oracle rejection path

### Property/Invariant

- `vault_balance >= total_redeemable_liquidity`
- no double nullifier spend
- no state mutation on failed callback verification

### Operational

- `npm run check:preflight`
- oracle freshness under configured threshold
- smoke tests for both legacy and shielded paths during migration

## 13. Rollout Gates

Do not claim "fully private collateral live" until all are true:

1. open/close/settle succeeds through shielded path on devnet
2. withdraw succeeds with nullifier protection
3. replay tests fail as expected
4. no plaintext internal collateral leakage in events/state beyond accepted boundary
5. docs and runbooks updated

## 14. Immediate Next Implementation Steps

1. Add state structs and versioning fields for `ShieldedPool` and `NullifierSet`.
2. Implement `init_shielded_pool` and `deposit_to_shielded`.
3. Add callback binding nonce/reference checks to current callbacks (before full migration).
4. Introduce feature flag `SHIELDED_COLLATERAL_ENABLED` in runtime and program config.
5. Build localnet integration test for:
   - deposit_to_shielded
   - lock_margin_private
   - settle_private_position
   - request/finalize withdraw

This order gives immediate security improvement (replay resistance) while enabling incremental migration without breaking current devnet operations.
