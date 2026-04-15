# ShadowPerp

Private perpetual trading on Solana, powered by Arcium confidential compute.

ShadowPerp is built for traders who want less information leakage by default. Order sizes, entry prices, leverage, and collateral are encrypted before submission. Arcium's Multi Party Computation network handles the private computation, and only the minimum public state required for settlement is written on chain.

The product is first and foremost a private perp DEX experience on Solana. This repository also contains the relay, program, and circuit stack that make that trading flow possible.

**Program ID (Devnet):** `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`

## Features

- **Encrypted Positions** — Trade size, direction, leverage, entry price, and liquidation price are encrypted end to end. No plaintext position data is published on chain.
- **Private Order Flow** — Orders do not broadcast their details before execution. Size, direction, and leverage stay out of the public ledger.
- **Delegated Session Trading** — Approve a delegated trading session once and let the relay act within configurable limits. The default session model is wallet scoped and reusable across supported markets.
- **6 Trading Pairs** — SOL/USD, BTC/USD, ETH/USD, JUP/USD, PYTH/USD, and ORCA/USD. Each pair routes to its own on chain market account. Your selected pair persists across page refreshes.
- **Live Reference Orderbook** — Real time market depth from Binance, Coinbase, Bybit, and Gate.io through the server side reference depth pipeline, with cached client state as a graceful fallback.
- **Shared Collateral** — Adopted markets resolve to a shared collateral vault per mint. Migrated owners use one owner scoped margin balance across supported pairs.
- **Cross and Isolated Margin** — Choose between shared collateral exposure across all positions or isolated margin per position. Leverage from 1x to 50x.
- **Confidential Liquidations** — Liquidation prices are encrypted. No external party can target a position based on its liquidation threshold.
- **Pyth Oracle Integration** — Price feeds sourced from Pyth Network with fallback to aggregated external sources. Circuit breakers and staleness checks protect against manipulation.
- **Custom RPC Endpoints** — Save up to 5 named RPC endpoints in the settings panel. They persist in browser storage and no environment variable changes are required.
- **Shielded Collateral Base Flows** — `deposit_to_shielded`, `request_withdraw_private`, and `finalize_withdraw` are deployed on devnet. Private margin lock and private position settlement are in progress.

## Architecture

ShadowPerp follows an encrypt, compute, and settle model.

1. **Encrypt** — The client encrypts sensitive trade inputs including size, price, leverage, direction, and margin in the browser.
2. **Queue** — The Solana program receives the encrypted payload and queues an Arcium computation.
3. **Compute** — Arcium's MPC network evaluates trade logic, margin checks, PnL, and liquidation conditions without exposing raw inputs to any single node.
4. **Callback** — Arcium returns a verified result to the Solana program via a replay hardened callback.
5. **Settle** — The program updates position and margin state from the verified output.

### Privacy Boundary

| Data | Visibility |
|------|-----------|
| Position size, entry price, leverage, direction | Encrypted on chain |
| Liquidation price, unrealized PnL | Encrypted on chain |
| Wallet address, margin account | Public (Solana constraint) |
| Token transfers to and from vault | Public (Solana constraint) |
| Trade queued event (no position details) | Public |
| Session creation and revocation | Public |

## Repository Layout

```
programs/shadowperp/     Anchor program (Solana)
encrypted-ixs/           Arcium circuit sources (Arcis)
app/                     Next.js frontend and relay API routes
scripts/                 Deploy, oracle, computation, and devnet utilities
build/                   Compiled circuit artifacts
```

## Getting Started

### Prerequisites

- Node.js 20 or later
- pnpm
- Rust and Cargo
- Solana CLI
- Anchor CLI
- Arcium CLI and build environment

### Install

```bash
npm install
cd app && pnpm install && cd ..
```

### Environment

```bash
cp app/.env.example app/.env.local
```

Fill in the following values in `app/.env.local`:

- Program ID and market account
- RPC endpoint
- Arcium program ID and cluster offset

### Run the Frontend

```bash
cd app
pnpm dev
```

## Scripts

### Oracle

```bash
# Check oracle health
npm run check:oracle

# Run oracle price update for a single pass
npm run oracle:once

# Manual price override when external sources are unavailable
npx ts-node scripts/price-oracle.ts --once --manual-price 130.50

# Update oracle via Pyth network feed
npx ts-node scripts/update-oracle-pyth.ts
```

### Deploy and Initialize

```bash
# Deploy program to devnet
npx ts-node scripts/deploy-devnet.ts

# Create devnet token mints
npx ts-node scripts/create-devnet-mints.ts

# Initialize markets
npx ts-node scripts/init-markets.ts

# Adopt existing markets into the shared collateral vault
npx ts-node scripts/adopt-shared-collateral.ts

# Migrate legacy per-market margin balances into the owner scoped margin account
npx ts-node scripts/migrate-shared-margin.ts

# Initialize computation definitions
npx ts-node scripts/init-comp-defs.ts

# Initialize shielded collateral computation definitions
npx ts-node scripts/init-shielded-comp-defs.ts

# Set Pyth feed ID on market
npx ts-node scripts/set-pyth-feed-id.ts
```

### Preflight and Validation

```bash
# Run preflight checks
npm run check:preflight

# Run the staged open contract diagnostics
npm run diag:open-contract

# Smoke test devnet
npx ts-node scripts/smoke-test-devnet.ts
```

### Build with Shielded Collateral

```bash
anchor build -- --features shielded-collateral
```

Or with Cargo directly:

```bash
cargo build --features shielded-collateral -p shadowperp
```

## Current Status

ShadowPerp is deployed on Solana devnet as an active prototype for private perpetual trading.

**Working today:**

- Program deployment and upgrade on devnet with Arcium SDK 0.9.2
- Wallet scoped delegated session v2 on devnet, reusable across supported markets
- Delegated collateral deposit and withdrawal under one active session across multiple markets
- All 6 market accounts initialized on chain with synced computation definition pointers
- Shared collateral custody model deployed on devnet with a shared vault per collateral mint, owner scoped margin account, and adoption and migration scripts for legacy per-market balances
- Encrypted open, close, and liquidation computation paths wired into the program and relay
- Automatic oracle refresh before trades on the relay path
- Cross and isolated margin modes with 1x to 50x leverage
- Limit orders with browser based automation
- Take profit and stop loss rules
- Collateral deposit and withdrawal through both direct and session delegated flows
- Private position metadata stored in the browser for UI continuity
- Live reference orderbook for all 6 pairs via Binance, Coinbase, Bybit, and Gate.io
- Pyth oracle integration
- Custom named RPC endpoint manager saved to browser storage
- Shared script side RPC fallback with prioritized paid endpoints and aligned websocket resolution
- Relay hardening around delegated session fallback, oracle refresh, and callback wait handling
- Session revoke UI in the Settings panel
- Selected trading pair persists across page refreshes
- Security hardened program paths including rent reclaim fixes, computation offset validation, and safer relay and runtime checks
- Shielded collateral pool with `deposit_to_shielded`, `request_withdraw_private`, and `finalize_withdraw` deployed and active on devnet
- Shielded collateral state including commitment Merkle tree, nullifier set, pending withdrawal with time delay, and shielded margin reference
- Devnet safe staged open position diagnostic harness with tuple only probe, margin check probe, and full check probe
- Hardened relay open smoke confirms failed opens resolve to a terminal closed state instead of staying stranded in pending

**Known devnet limitations:**

- End-to-end open and close are not fully signed off yet
- The open lane is still blocked on devnet and the staged diagnostic harness confirms the abort survives the tuple only probe, margin check probe, and full check probe
- Current evidence points away from margin and leverage business logic toward an Arcium runtime or lower-level contract issue in the open lane
- The hardened relay path improves failure handling but does not fix the root protocol issue
- Shared collateral is active only for adopted markets and migrated owners. Wallets with legacy per-market balances still need the migration runbook
- Legacy per-market balances and positions must be migrated carefully: close open legacy positions first, then run `scripts/adopt-shared-collateral.ts`, then run `scripts/migrate-shared-margin.ts` per owner
- Limit orders and TP/SL are browser local automation and not exchange side order persistence
- Oracle updates are protected by a circuit breaker. If the on chain price drifts too far from live sources, manual intervention is required before trading resumes

**In progress:**

- Private margin lock and settle via Arcium MPC using `lock_margin_private` and `settle_private_position`. Circuits are built and on chain wiring is complete. Circuit integration is pending.
- Commitment tree hashing. Placeholder additive binding is in place while stronger tree hashing integration is completed.
- Arcium escalation for the open position lane

## References

- [Arcium](https://www.arcium.com/)
- [Arcium Documentation](https://docs.arcium.com/)
- [Solana](https://solana.com/docs)
- [Anchor](https://www.anchor-lang.com/)
- [Pyth Network](https://pyth.network/)
