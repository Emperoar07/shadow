# ShadowPerp

ShadowPerp is a privacy-first perpetuals trading prototype on Solana devnet, built with Arcium for confidential computation.

The project is designed to reduce trader intent leakage. Position inputs are encrypted before they are submitted, sensitive trade logic is evaluated privately, and only the minimum required public state is exposed on-chain.

## What ShadowPerp Does

ShadowPerp applies private computation to core perpetuals flows:

- Position opening checks
- Position close and settlement logic
- Liquidation checks
- Session-based delegated trading for smoother UX

The goal is straightforward: make it harder for other market participants to infer live trader intent, copy positions, or target liquidations based on public state.

## How Arcium Is Used

Arcium is the confidential compute layer behind ShadowPerp.

The flow is:

1. The client encrypts sensitive trade inputs such as size, entry price, leverage, direction, and margin.
2. The Solana program queues a computation request to Arcium using those encrypted inputs.
3. Arcium processes the encrypted data off-chain using confidential computation.
4. The result is verified on-chain before ShadowPerp updates trade state.

### Privacy Benefits

- Live position details are not exposed in plaintext on-chain.
- Sensitive risk logic can be evaluated without publishing trader intent.
- Final realized PnL is revealed only when settlement requires it.
- The design reduces copy-trading and liquidation targeting based on visible positions.

## Current Status

ShadowPerp is an active devnet prototype with a real Solana + Arcium integration.

Current limitation:

- The callback-backed `open_position` queue path is currently blocked on Arcium devnet by `AccountDidNotSerialize (3004)` on the Arcium `comp` account.

This means the architecture, privacy model, frontend, and integration are in place, but the main open-position path should still be treated as a devnet prototype until the upstream callback serialization issue is resolved or a validated workaround is adopted.

## Project Structure

- `programs/shadowperp/` - Anchor program for the on-chain protocol
- `encrypted-ixs/` - Arcium/Arcis confidential circuits
- `app/` - Next.js frontend
- `scripts/` - deployment, oracle, health-check, and devnet utility scripts

## Getting Started

### Prerequisites

- Node.js 20+
- Rust
- Solana CLI
- Anchor
- pnpm

### Install

```bash
npm install
cd app
pnpm install
cd ..
```

### Configure

```bash
cp app/.env.example app/.env.local
```

Set the required environment values for your devnet setup before running the app.

### Run Checks

```bash
npm run check:preflight
npm run check:oracle
```

If the oracle is stale:

```bash
npm run oracle:once
```

### Run the App

```bash
cd app
pnpm dev
```

## Open Source

This repository is intended to be open and readable. Please do not commit secrets, private keys, or local environment files.

If you use this project publicly, keep claims aligned with verified behavior on the current deployment.

## References

- Arcium: https://www.arcium.com/
- Arcium Docs: https://docs.arcium.com/
- Solana: https://solana.com/docs
- Anchor: https://www.anchor-lang.com/
