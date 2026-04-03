# ShadowPerp Architecture

This document is the stable architecture reference for engineers and agents.
For live status, addresses, and active blockers, read `DEV_NOTES.md` first.

For the private collateral redesign plan, read `PRIVATE_COLLATERAL_SPEC.md`.

## System Overview

ShadowPerp is a Solana perpetual DEX with privacy-preserving trade logic through Arcium MPC.

- Frontend: `app/` (Next.js + wallet adapter + Arcium client bindings)
- Program: `programs/shadowperp/` (Anchor + Arcium macros)
- MPC circuits: `encrypted-ixs/` (Arcis instructions compiled to `build/*.arcis`)
- DevOps scripts: `scripts/` (deploy, comp-def init, oracle feeder, preflight, faucet)

## Core Components

### 1. Frontend Runtime

Main files:

- `app/src/lib/client.ts`
- `app/src/lib/runtime.ts`
- `app/src/pages/index.tsx`
- `app/src/components/TradingPanel.tsx`
- `app/src/components/BottomPositionsPanel.tsx`
- `app/src/components/NetworkIndicator.tsx`
- `app/src/components/layout/SettingsPanel.tsx`

Responsibilities:

- wallet connect and chain session
- client-side encryption context for Arcium calls
- order entry UX (market/limit + TP/SL)
- collateral management UX
- multi-RPC selection: up to 5 custom named endpoints saved to localStorage, with fallback to public devnet. No env var edits required for users to switch RPCs.

### 2. On-Chain Program (Anchor)

Main entrypoint:

- `programs/shadowperp/src/lib.rs`

Main handlers:

- `initialize`
- `init_arcium_signer`
- `init_open_position_comp_def`
- `init_close_position_comp_def`
- `init_liquidation_comp_def`
- `sync_comp_defs`
- `open_position`
- `open_position_with_session` (delegated relayer path)
- `open_position_v2_callback`
- `close_position`
- `close_position_with_session` (delegated relayer path)
- `close_position_callback`
- `check_liquidation`
- `check_liquidation_callback`
- `settle_close_position`
- `settle_liquidation`
- `deposit_collateral`
- `withdraw_collateral`
- `update_price`
- delegated session controls:
  - `create_trade_session`
  - `revoke_trade_session`
  - `create_trade_session_v2`
  - `revoke_trade_session_v2`
- feature-gated shielded collateral (`shielded-collateral` feature only):
  - `init_shielded_pool` (creates pool, commitment tree, nullifier set)
  - `set_shielded_collateral_feature` (toggle activation bit)
  - `deposit_to_shielded` (SPL transfer + commitment append)
  - `request_withdraw_private` (nullifier-keyed withdrawal intent with delay)
  - `finalize_withdraw` (nullifier spend + vault transfer)
  - `lock_margin_private` (stub — awaiting Arcium circuit)
  - `settle_private_position` (stub — awaiting Arcium circuit)

State accounts:

- `Market`
- `MarginAccount`
- `Position`
- `LiquidationSettlement` (authorized liquidator binding for deferred liquidation settlement)
- `TradeSession` (market-scoped owner-approved relayer window with action/margin caps + expiry)
- `TradeSessionV2` (wallet-scoped owner-approved relayer window reusable across supported markets; deployed and smoke-verified for delegated collateral across multiple markets on devnet)
- optional private orderbook state
- feature-gated shielded collateral state (`shielded-collateral` feature only):
  - `ShieldedPool` (per-market pool with commitment tree root, vault, accounting)
  - `CommitmentTree` (append-only leaf storage with 16-root rolling ring buffer)
  - `NullifierSet` (spent nullifier tracking for double-spend prevention)
  - `PendingWithdrawal` (withdrawal intent with nullifier, amount, expiry)
  - `ShieldedMarginRef` (user-to-commitment linkage with callback binding)

### 3. Arcium MPC Layer

Circuit sources:

- `encrypted-ixs/src/open_position.rs`
- `encrypted-ixs/src/close_position.rs`
- `encrypted-ixs/src/liquidation_check.rs`
- `encrypted-ixs/src/lock_margin_private.rs` (stub — shielded collateral)
- `encrypted-ixs/src/settle_private_position.rs` (stub — shielded collateral)

Build artifacts:

- `build/open_position.arcis`
- `build/close_position.arcis`
- `build/check_liquidation.arcis`

Arcium-related account pointers are stored in market state and validated in callbacks.

## Data and Account Boundaries

- User funds: SPL token accounts and program vault (canonical devnet USDC by default)
- Public state: market-level metadata, balances, lifecycle statuses
- Sensitive trade details: encrypted payloads and MPC outputs
- Oracle: on-chain price feeder authority updates market price with freshness checks and future-date guard

### Delegated Session Boundary

- Owner signs once to create a `TradeSession` PDA scoped to:
  - owner
  - market
  - relayer pubkey
  - action cap
  - per-open margin cap
  - expiry timestamp
- Relayer can then submit multiple encrypted open/close queue transactions without additional owner signatures.
- Session can be revoked by owner at any time.
- `max_margin_per_action` applies to open/deposit actions only, not withdrawals.
- Collateral transfer path remains public; only position internals remain on Arcium encrypted flow.

### Shielded Collateral Boundary

- SPL token transfers to/from vault are public (Solana constraint).
- Internal collateral ownership, allocation, and margin transitions are private.
- Commitments are appended to a rolling Merkle tree on deposit.
- Withdrawals require a nullifier that can only be used once (PDA-enforced uniqueness + NullifierSet tracking).
- A time-delay (`WITHDRAWAL_DELAY_SLOTS`) separates withdrawal request from finalization.
- Private margin lock/release transitions will be handled by Arcium MPC circuits (stubs in place).

## Security Design Decisions

- **Zombie position prevention** — If `verify_output` fails in any callback, the position is immediately set to `PositionStatus::Closed` and `consume_pending_computation` is called before returning an error. This prevents positions from being permanently stuck in Pending status.
- **Rent reclaim targets** — `LiquidationSettlement` uses `close = liquidator`, not `close = payer`. Rent lamports go to the authorized liquidator, not an arbitrary caller.
- **Computation offset validation** — All queue handlers (`open_position`, `close_position`, `check_liquidation`, session variants) require `computation_offset > 0`. Zero offset is not a valid comp-def.
- **Oracle future-dating guard** — `update_price` rejects price data with `publish_time > clock.unix_timestamp`, preventing acceptance of fabricated future timestamps.
- **Session withdraw exemption** — Session-delegated withdrawals are not subject to `max_margin_per_action` caps. The cap applies to opens and deposits only.

## Deploy/Init Pipeline

Canonical order:

1. Build circuits (`arcium build`)
2. Build program (`anchor build` / safe wrapper)
3. Deploy program binary
4. Create devnet token mints (`create-devnet-mints.ts`)
5. Initialize markets (`init-markets.ts`)
6. Initialize/sync comp-defs (`init-comp-defs.ts`, `sync-market-comp-defs.ts`)
7. Set Pyth feed ID (`set-pyth-feed-id.ts`)
8. Update env files and UI runtime config
9. Start oracle daemon (`price-oracle.ts` or `update-oracle-pyth.ts`)
10. Run preflight and smoke tests

See scripts:

- `scripts/deploy-devnet.ts`
- `scripts/create-devnet-mints.ts`
- `scripts/init-markets.ts`
- `scripts/init-comp-defs.ts`
- `scripts/init-shielded-comp-defs.ts`
- `scripts/set-pyth-feed-id.ts`
- `scripts/price-oracle.ts` (supports `--manual-price <USD>` for offline operation)
- `scripts/update-oracle-pyth.ts`
- `scripts/stable-preflight.ts`
- `scripts/smoke-test-devnet.ts`

## Known Architectural Risk Area

If circuit artifacts and deployed binary are out of sync, Arcium queue calls fail due signature/argument mismatch.

Typical symptom:

- `QueueComputation` rejects arguments (invalid parameter type/shape)

Root cause class:

- comp-def finalized for old circuit signature while client/program emits new arg layout

Mitigation:

- rebuild circuits
- rebuild and deploy program
- re-init/sync comp-def pointers
- verify via preflight before UI smoke
