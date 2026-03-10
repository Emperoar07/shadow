# ShadowPerp

ShadowPerp is a privacy-first perpetuals trading prototype on Solana devnet built around Arcium confidential computation.

The project is trying to reduce trader-intent leakage. Position inputs are encrypted before submission, sensitive trade logic is evaluated through Arcium, and only the minimum required public state is kept on-chain.

## What It Covers

ShadowPerp currently includes:

- encrypted open / close / liquidation computation paths
- delegated session trading so a relayer can execute multiple actions after one owner approval
- fixed settlement paths for deferred close and liquidation handling
- an oracle feeder and preflight/devnet runbook
- a terminal-style frontend with live external reference depth

## How Arcium Fits

ShadowPerp uses Arcium as the confidential compute layer.

The intended flow is:

1. The client encrypts sensitive trade inputs such as size, entry price, leverage, direction, and margin.
2. The Solana program queues an Arcium computation with those encrypted values.
3. Arcium processes the encrypted inputs off-chain.
4. The callback verifies the result on-chain before ShadowPerp updates trade state.

Privacy goal:

- trader-specific position details are not published in plaintext
- sensitive risk checks do not require public intent disclosure
- liquidation-sensitive information is kept out of the public state path

## Current Status

This repository is an active devnet prototype, not a production exchange.

What is working:

- Solana program deploy/upgrade path
- comp-def rollout path
- delegated session creation
- oracle feed + preflight checks
- frontend runtime and relay plumbing
- external reference orderbook in the UI

What is still blocked:

- the real `open_position` computation path is still aborting on Arcium devnet
- the failure currently surfaces as:
  - Arcium `AbortedComputation (6000)`
  - then ShadowPerp `InvalidComputationResult (6008)`

That means the main private trading path should still be treated as experimental until a successful real open/close cycle is verified end to end.

## UI Data Model

The orderbook shown in the terminal is **external reference depth**, not ShadowPerp-native venue liquidity.

Current reference sources:

- Coinbase first
- Binance fallback

That orderbook is there to make the terminal useful and live-looking without pretending ShadowPerp already has a public matching engine or public venue depth of its own.

## Repository Layout

- `programs/shadowperp/`
  - Anchor on-chain program
- `encrypted-ixs/`
  - Arcium/Arcis circuit sources
- `app/`
  - Next.js frontend and relay routes
- `scripts/`
  - deploy, oracle, comp-def, smoke, and devnet utility scripts
- `build/`
  - compiled circuit artifacts

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm
- Rust
- Solana CLI
- Anchor
- Arcium CLI / build environment

### Install

```bash
npm install
cd app
pnpm install
cd ..
```

### Environment

```bash
cp app/.env.example app/.env.local
```

Then set the devnet values you want to use for:

- program id
- market account
- RPC URLs
- Arcium program id / cluster offset

## Safe Validation Commands

These are the repo’s normal devnet-safe checks:

```bash
npm run check:oracle
npm run check:preflight
```

If the oracle is stale:

```bash
npm run oracle:once
```

Frontend:

```bash
cd app
pnpm dev
```

## Development Rules

- do not claim the app is fully live without successful end-to-end open and close verification
- do not commit secrets, keypairs, or local env files
- keep docs aligned with verified chain state, not old assumptions
- treat `DEV_NOTES.md` as the operational source of truth for live devnet state

## References

- Arcium: https://www.arcium.com/
- Arcium Docs: https://docs.arcium.com/
- Solana: https://solana.com/docs
- Anchor: https://www.anchor-lang.com/
