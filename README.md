# ShadowPerp

ShadowPerp is a privacy perpetuals trading dex on Solana devnet built around Arcium confidential computation.

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

- Solana program deploy/upgrade on devnet (Arcium SDK v0.9.2)
- delegated session trading with relay (no wallet popups after initial session)
- oracle price auto-refresh before every trade (relay-side)
- encrypted position open/close/liquidation computation paths
- privacy-preserving position metadata (side, leverage, margin mode stored client-side)
- cross and isolated margin modes
- leverage selection (1x-50x) with popup modal
- limit orders with client-side automation
- take-profit / stop-loss rules
- external reference orderbook (Coinbase/Binance depth)
- collateral deposit/withdraw (direct and session-delegated)

What is in progress:

- Arcium MPC callbacks are arriving from cluster 456 but failing with `InstructionDidNotDeserialize` (Anchor error 102)
- root cause: comp-def output schema mismatch with the deployed callback handler
- fix requires re-registering the computation definition to match the current `OpenPositionProbeBOutput` struct

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

These are the repo's normal devnet-safe checks:

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

## References

- Arcium: https://www.arcium.com/
- Arcium Docs: https://docs.arcium.com/
- Solana: https://solana.com/docs
- Anchor: https://www.anchor-lang.com/
