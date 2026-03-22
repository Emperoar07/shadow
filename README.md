# ShadowPerp

ShadowPerp is a private perpetuals trading app on Solana devnet, built with Arcium confidential compute.

The goal is straightforward: make trading feel usable without turning every position into public intent. Sensitive trade inputs are encrypted before submission, Arcium handles the private computation, and only the minimum public state needed for settlement is written on chain.

## What ShadowPerp Includes

Today the repo covers:

- encrypted open, close, and liquidation flows
- delegated trading sessions so a relayer can handle multiple actions after one approval
- settlement paths for deferred close and liquidation handling
- an oracle feeder and a practical devnet preflight runbook
- a terminal style frontend with live reference market depth

## How Arcium Fits In

Arcium is the confidential compute layer behind ShadowPerp.

The intended flow looks like this:

1. The client encrypts sensitive trade inputs such as size, entry price, leverage, direction, and margin.
2. The Solana program queues an Arcium computation with those encrypted values.
3. Arcium processes the encrypted inputs inside its confidential compute network.
4. The callback verifies the result on chain before ShadowPerp updates trade state.

In practice, that means:

- position details are not published in plain text
- sensitive risk checks do not need to reveal trader intent
- liquidation related data stays out of the public state path as much as possible

## Current Status

This repository is an active devnet prototype, not a production exchange.

What is working today:

- Solana program deploy and upgrade on devnet with Arcium SDK `0.9.2`
- delegated session trading with a relay, so users do not sign every action
- automatic oracle refresh before trades on the relay path
- encrypted open, close, and liquidation computation flows
- private position metadata stored in the browser for UI continuity
- cross and isolated margin modes
- leverage selection from `1x` to `50x`
- limit orders with browser based automation
- take profit and stop loss rules
- external reference orderbook data
- collateral deposit and withdrawal, both direct and session delegated

What is still in progress:

- Arcium MPC callbacks from cluster `456` are still failing with `InstructionDidNotDeserialize` (`Anchor` error `102`)
- the current leading cause is a mismatch between the deployed callback handler and the active computation definition output shape
- the private open flow should still be treated as experimental until we complete a successful open and close cycle from start to finish

## Market Data Model

The orderbook in the terminal is external reference depth. It is there to make the product useful and readable. It is not presenting ShadowPerp as if it already has public venue liquidity of its own.

Current reference sources:

- Coinbase first
- Binance as fallback

## Repository Layout

- `programs/shadowperp/`
  Anchor program code
- `encrypted-ixs/`
  Arcium and Arcis circuit sources
- `app/`
  Next.js frontend and relay routes
- `scripts/`
  deploy, oracle, computation definition, smoke, and devnet utility scripts
- `build/`
  compiled circuit artifacts

## Quick Start

### Prerequisites

- Node.js `20+`
- `pnpm`
- Rust
- Solana CLI
- Anchor
- Arcium CLI and build environment

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

Then fill in the devnet values you want to use for:

- program id
- market account
- RPC URLs
- Arcium program id and cluster offset

## Safe Validation Commands

These are the normal repo checks we use on devnet:

```bash
npm run check:oracle
npm run check:preflight
```

If the oracle is stale:

```bash
npm run oracle:once
```

For the frontend:

```bash
cd app
pnpm dev
```

## References

- Arcium: https://www.arcium.com/
- Arcium Docs: https://docs.arcium.com/
- Solana: https://solana.com/docs
- Anchor: https://www.anchor-lang.com/
