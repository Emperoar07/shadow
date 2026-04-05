# ShadowPerp

Private perpetual futures trading on Solana, powered by Arcium confidential compute.

ShadowPerp encrypts order sizes, entry prices, leverage, and collateral before submission. Arcium's Multi Party Computation (MPC) network handles the private computation, and only the minimum public state required for settlement is written on chain.

**Program ID (Devnet):** `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`

## Features

- **Encrypted Positions** - Trade size, direction, leverage, entry price, and liquidation price are encrypted end to end. No plaintext position data is published on chain.
- **Private Orderbook** - Order flow is shielded from MEV bots and front runners. Orders cannot be extracted or front run because they are never visible.
- **Session Trading** - Approve a delegated trading session once and let the relay act within configurable limits. The default session model is wallet-scoped and reusable across supported markets.
- **6 Trading Pairs** - SOL-USD, BTC-USD, ETH-USD, JUP-USD, PYTH-USD, and ORCA-USD. Each pair routes to its own on-chain market PDA. Selected pair persists across page refreshes.
- **Live Orderbook** - Real time market depth from Binance, Coinbase, Bybit, and Gate.io through the server-side reference depth pipeline, with cached client state as a graceful fallback.
- **Shared Collateral on Devnet** - Adopted markets now resolve to a shared collateral vault per mint, and migrated owners use one owner-scoped margin balance across supported pairs.
- **Cross and Isolated Position Modes** - Choose between shared collateral exposure across positions or isolated position-level margin usage. Leverage from 1x to 50x.
- **Confidential Liquidations** - Liquidation prices are encrypted. No external party can target a position based on its liquidation threshold.
- **Pyth Oracle Integration** - Price feeds sourced from Pyth Network with fallback to aggregated external sources. Circuit breakers and staleness checks protect against manipulation.
- **Custom RPC Endpoints** - Save up to 5 named RPC endpoints in the settings panel. Endpoints persist in browser localStorage; no env var changes required. Falls back to public Solana devnet.
- **Shielded Collateral Base Flows** - `deposit_to_shielded`, `request_withdraw_private`, and `finalize_withdraw` are deployed on devnet. Private margin lock and private position settlement remain in progress.

## Architecture

ShadowPerp follows an encrypt, compute, settle model:

1. **Encrypt** - The client encrypts sensitive trade inputs (size, price, leverage, direction, margin) in the browser.
2. **Queue** - The Solana program receives the encrypted payload and queues an Arcium computation.
3. **Compute** - Arcium's MPC network evaluates trade logic, margin checks, PnL, and liquidation conditions without exposing raw inputs to any single node.
4. **Callback** - Arcium returns a verified result to the Solana program via a replay hardened callback.
5. **Settle** - The program updates position and margin state from the verified output.

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

# Adopt existing markets into the shared collateral vault
npx ts-node scripts/adopt-shared-collateral.ts

# Migrate your legacy per-market margin balances into the owner-scoped margin account
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

ShadowPerp is deployed on Solana devnet as an active prototype.

**Working today:**

- Program deployment and upgrade on devnet with Arcium SDK 0.9.2
- Wallet-scoped delegated session v2 on devnet, reusable across supported markets
- Delegated collateral deposit and withdrawal under one active session across multiple markets
- All 6 market PDAs initialized on chain with synced comp-def pointers
- Shared-collateral custody model deployed on devnet:
  - shared vault PDA per collateral mint
  - owner-scoped margin PDA
  - adoption and migration instructions/scripts for legacy per-market balances
  - cross-pair shared-balance smoke proof completed on adopted markets
- Encrypted open, close, and liquidation computation paths wired into the program and relay
- Automatic oracle refresh before trades on the relay path
- Cross and isolated margin modes with 1x to 50x leverage
- Limit orders with browser-based automation
- Take profit and stop loss rules
- Collateral deposit and withdrawal (direct and session delegated)
- Private position metadata stored in the browser for UI continuity
- Live reference orderbook for all 6 pairs via Binance, Coinbase, Bybit, and Gate.io through the server-side reference depth pipeline
- Pyth oracle integration with `update-oracle-pyth.ts`
- Custom named RPC endpoint manager (up to 5, saved to localStorage)
- Session revoke UI in the Settings panel
- Selected trading pair persists across page refreshes
- Security-hardened program paths such as rent reclaim fixes, computation offset validation, and safer relay/runtime checks
- Shielded collateral pool: `deposit_to_shielded`, `request_withdraw_private`, `finalize_withdraw` deployed and active on devnet
- Shielded collateral state: commitment Merkle tree, nullifier set, pending withdrawal with time delay, shielded margin ref

**Known devnet limitations:**

- End-to-end open and close are not fully signed off yet. The current `open_position_probe_b` callback can still abort on devnet with `AbortedComputation (6000) -> InvalidComputationResult (6010)`.
- Shared collateral is active only for adopted markets and migrated owners. Wallets with legacy per-market balances still need the migration runbook before treating their balance as one shared pool.
- Legacy per-market balances and positions must be migrated carefully. The intended runbook is:
  1. close or settle open legacy positions
  2. run `scripts/adopt-shared-collateral.ts`
  3. run `scripts/migrate-shared-margin.ts` per owner
- Limit orders and TP/SL are browser-local automation, not exchange-side order persistence.
- Oracle updates are protected by a circuit breaker. If the on-chain price drifts too far from live sources, manual intervention is required before trading resumes.

**In progress:**

- Private margin lock and settle via Arcium MPC (`lock_margin_private`, `settle_private_position` - circuits built, on-chain wiring complete, circuit integration pending)
- Commitment tree hashing (placeholder additive binding pending stronger tree hashing integration)

## References

- [Arcium](https://www.arcium.com/)
- [Arcium Documentation](https://docs.arcium.com/)
- [Solana](https://solana.com/docs)
- [Anchor](https://www.anchor-lang.com/)
- [Pyth Network](https://pyth.network/)
