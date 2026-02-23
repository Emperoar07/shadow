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

Responsibilities:

- wallet connect and chain session
- client-side encryption context for Arcium calls
- order entry UX (market/limit + TP/SL)
- collateral management UX
- multi-RPC selection and manual endpoint switching

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
- `open_position_v2_callback`
- `close_position`
- `close_position_callback`
- `check_liquidation`
- `check_liquidation_callback`
- `deposit_collateral`
- `withdraw_collateral`
- `update_price`

State accounts:

- `Market`
- `MarginAccount`
- `Position`
- optional private orderbook state

### 3. Arcium MPC Layer

Circuit sources:

- `encrypted-ixs/src/open_position.rs`
- `encrypted-ixs/src/close_position.rs`
- `encrypted-ixs/src/liquidation_check.rs`

Build artifacts:

- `build/open_position.arcis`
- `build/close_position.arcis`
- `build/check_liquidation.arcis`

Arcium-related account pointers are stored in market state and validated in callbacks.

## Data and Account Boundaries

- User funds: SPL token accounts and program vault (canonical devnet USDC by default)
- Public state: market-level metadata, balances, lifecycle statuses
- Sensitive trade details: encrypted payloads and MPC outputs
- Oracle: on-chain price feeder authority updates market price with freshness checks

## Deploy/Init Pipeline

Canonical order:

1. Build circuits (`arcium build`)
2. Build program (`anchor build` / safe wrapper)
3. Deploy program binary
4. Initialize/sync comp-defs
5. Update env files and UI runtime config
6. Start oracle daemon
7. Run preflight and smoke tests

See scripts:

- `scripts/deploy-devnet.ts`
- `scripts/init-comp-defs.ts`
- `scripts/price-oracle.ts`
- `scripts/stable-preflight.ts`

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
