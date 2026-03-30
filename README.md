# ShadowPerp

Private perpetual futures trading on Solana, powered by Arcium confidential compute.

ShadowPerp encrypts order sizes, entry prices, leverage, and collateral before submission. Arcium's Multi Party Computation (MPC) network handles the private computation, and only the minimum public state required for settlement is written on chain.

**Program ID (Devnet):** `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`

## Features

- **Encrypted Positions** — Trade size, direction, leverage, entry price, and liquidation price are encrypted end to end. No plaintext position data is published on chain.
- **Private Orderbook** — Order flow is shielded from MEV bots and front runners. Orders cannot be extracted or front run because they are never visible.
- **Session Trading** — Approve a delegated trading session once and trade without repeated wallet prompts. The relay submits encrypted orders on your behalf within configurable limits.
- **Cross and Isolated Margin** — Choose between shared margin across positions or isolated margin per position. Leverage from 1x to 50x.
- **Confidential Liquidations** — Liquidation prices are encrypted. No external party can target a position based on its liquidation threshold.
- **Pyth Oracle Integration** — Price feeds sourced from Pyth Network with fallback to aggregated external sources (Coinbase, Binance). Circuit breakers and staleness checks protect against manipulation.
- **Custom RPC Endpoints** — Save up to 5 named RPC endpoints in the settings panel. Endpoints persist in browser localStorage; no env var changes required. Falls back to public Solana devnet.
- **Shielded Collateral** (in progress) — Commitment tree based collateral pool with nullifier withdrawals, hiding internal balance ownership and margin transitions from public view.

## Architecture

ShadowPerp follows an encrypt, compute, settle model:

1. **Encrypt** — The client encrypts sensitive trade inputs (size, price, leverage, direction, margin) in the browser.
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
| Token transfers to/from vault | Public (Solana constraint) |
| Trade queued event (no details) | Public |
| Session creation/revocation | Public |

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

- Node.js 20+
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

Configure the following in `app/.env.local`:

- Program ID and market account
- RPC endpoint (QuickNode recommended; falls back to public devnet)
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

# Run oracle price update (single pass)
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

ShadowPerp is deployed on Solana Devnet as an active prototype.

**Working today:**

- Program deployment and upgrade on devnet with Arcium SDK 0.9.2
- Delegated session trading with relay (sign once, trade freely)
- Encrypted open, close, and liquidation computation flows
- Automatic oracle refresh before trades on the relay path
- Cross and isolated margin modes with 1x to 50x leverage
- Limit orders with browser based automation
- Take profit and stop loss rules
- Collateral deposit and withdrawal (direct and session delegated)
- Private position metadata stored in the browser for UI continuity
- External reference orderbook data (Coinbase primary, Binance fallback)
- Pyth oracle integration with `update-oracle-pyth.ts`
- Custom named RPC endpoint manager (up to 5, saved to localStorage)
- Security hardened program: zombie position prevention, correct rent reclaim targets, computation offset validation

**In progress:**

- Shielded collateral circuits for private margin lock/release transitions
- Commitment tree hashing (placeholder XOR fold pending SHA256/Poseidon integration)

## References

- [Arcium](https://www.arcium.com/)
- [Arcium Documentation](https://docs.arcium.com/)
- [Solana](https://solana.com/docs)
- [Anchor](https://www.anchor-lang.com/)
- [Pyth Network](https://pyth.network/)
