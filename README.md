# ShadowPerp

ShadowPerp is a private perpetual trading terminal on Solana, powered by Arcium confidential compute.

It is built for traders who want a quieter trading surface. Position size, leverage, entry price, margin, liquidation values, and PnL move through an encrypted computation path instead of being published as ordinary plaintext position data. Solana handles settlement. Arcium handles the private compute. The app keeps the trading experience familiar while reducing the amount of useful information exposed to the public ledger.

Program ID on Solana devnet

`34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo`

## What Shadow Gives Traders

Encrypted positions

Size, leverage, entry price, margin, liquidation thresholds, and unrealized PnL are handled through the encrypted path. Direction is encrypted for the MPC computation and revealed where protocol routing and liquidation bookkeeping require it.

Direct wallet trading

Every trading and collateral action is signed by the connected Solana wallet. Email users can trade through a Privy embedded Solana wallet. External wallet users can connect through supported Solana wallet connectors.

Market context in one place

The terminal includes charting, reference order book depth, market stats, order entry, collateral management, and position panels. Mobile keeps the chart and order book together so analysis feels natural on a smaller screen.

Flexible collateral

Supported markets use shared collateral flows so one owner-scoped balance can support activity across adopted pairs.

Private order book

Encrypted limit orders are stored on-chain as client-side ciphertext. The Arcium MPC circuit evaluates trigger conditions on encrypted order data and reveals parameters only when a trigger fires. Each order book enforces a single in-flight computation lock to prevent concurrent evaluation races.

Six supported pairs

SOL/USD, BTC/USD, ETH/USD, JUP/USD, PYTH/USD, and ORCA/USD are wired into the terminal experience.

## How It Works

1. The browser prepares the trade and encrypts sensitive inputs before submission.

2. The Solana program receives the encrypted payload and queues an Arcium computation.

3. Arcium evaluates the private trade logic without exposing raw inputs to any single party.

4. A verified callback returns the result to the Solana program.

5. The program updates margin and position state from the verified output.

This keeps the user experience close to a familiar perpetual exchange while moving the sensitive parts of the trade into a confidential computation path.

## Privacy Boundary

Private through the encrypted path

Position size, entry price, leverage, margin amount, liquidation values, and unrealized PnL.

Visible on Solana

Wallet addresses, token transfers, transaction timing, and the public settlement state required by the protocol.

Partially public by design

Direction is encrypted for MPC and revealed at open where routing and liquidation bookkeeping need it. Shadow is designed to reduce information leakage, not pretend that a public chain has no public surface.

## Repository Map

`programs/shadowperp`

Anchor program for markets, collateral, positions, private order books, and callbacks.

`encrypted-ixs`

Arcium circuit sources (Arcis 0.9.7) for confidential trade and risk computation.

`app`

Next.js frontend, product pages, wallet flows, trading terminal, and app documentation.

`scripts`

Devnet deployment, oracle, preflight, market setup, diagnostics, and operational tooling.

`build`

Compiled Arcium circuit artifacts used by the program.

## Getting Started

Prerequisites

Node.js 20 or later, npm, Rust, Cargo, Solana CLI, Anchor CLI, and the Arcium build environment.

Install dependencies

```bash
npm install
cd app && npm install && cd ..
```

Create local app environment

```bash
cp app/.env.example app/.env.local
```

Important environment values

`NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID`

`NEXT_PUBLIC_ARCIUM_RPC_URL`

`NEXT_PUBLIC_PRIVY_APP_ID`

`NEXT_PUBLIC_PRIVY_API_URL` when using a Privy hosted auth domain

`PRIVY_APP_SECRET` for protected backend routes

`ORACLE_FEEDER_SECRET_KEY` for hosted oracle refresh writes

`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or Vercel KV equivalents, for durable hosted rate limits and faucet records

Run the app

```bash
cd app
npm run dev
```

## Useful Commands

Oracle checks

```bash
npm run check:oracle
npm run oracle:once
npx ts-node scripts/price-oracle.ts --once --manual-price 130.50
```

Deployment and setup

```bash
npx ts-node scripts/deploy-devnet.ts
npx ts-node scripts/create-devnet-mints.ts
npx ts-node scripts/init-markets.ts
npx ts-node scripts/adopt-shared-collateral.ts
npx ts-node scripts/migrate-shared-margin.ts
npx ts-node scripts/init-comp-defs.ts
npx ts-node scripts/set-pyth-feed-id.ts
```

Preflight and diagnostics

```bash
npm run check:preflight
npm run diag:open-contract
npx ts-node scripts/smoke-test-devnet.ts
npx ts-node scripts/verify-markets.ts
npx ts-node scripts/check-mxe-status.ts
```

Build

```bash
# Full Arcium + Anchor build (run from WSL)
bash scripts/wsl-arcium-build.sh

# Anchor-only build
bash scripts/wsl-anchor-build.sh
```

## Devnet Workspace

ShadowPerp runs as a devnet trading workspace. Balances are test funds, and the environment is meant for iteration, verification, and product testing before any mainnet conversation.

The active product path uses Privy for authentication and wallet connection, direct Solana wallet signing for trading and collateral, Arcium computation definitions for encrypted logic, and preflight scripts to keep the deployed namespace easy to verify.

Before calling a build ready, run the preflight checks, refresh the oracle if needed, and perform a browser smoke test through the wallet path you care about.

## References

Arcium

https://www.arcium.com/

Arcium documentation

https://docs.arcium.com/

Solana documentation

https://solana.com/docs

Anchor documentation

https://www.anchor-lang.com/

Pyth Network

https://pyth.network/
