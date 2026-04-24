# ShadowPerp

Private perpetual trading on Solana, powered by Arcium confidential compute.

ShadowPerp is a private perp DEX built for human traders who want less information leakage by default. Trade size, leverage, entry price, and margin are encrypted before submission. Direction is encrypted for the MPC path but revealed at open for routing and liquidation bookkeeping. Arcium's Multi Party Computation network handles the private computation, and only the minimum public state required for settlement is written on chain.

This repository contains the devnet product: frontend, on-chain program, Arcium circuits, and the supporting tooling used to run and debug the system.

**Program ID (Devnet):** `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`

## Features

- **Encrypted positions** - Size, leverage, entry price, margin, and liquidation thresholds stay encrypted instead of being exposed as plaintext position data; direction is revealed at open for protocol routing.
- **Direct wallet trading** - Shadow signs directly from the connected Solana wallet. Privy embedded wallets and external Solana wallets share the same trading path.
- **Private order flow** - Orders do not broadcast the usual pre-trade signals before execution.
- **6 trading pairs** - SOL/USD, BTC/USD, ETH/USD, JUP/USD, PYTH/USD, and ORCA/USD.
- **Cross and isolated margin** - Choose shared account risk or isolated position risk, with leverage from 1x to 50x.
- **Shared collateral** - Adopted markets resolve to a shared collateral vault per owner on devnet.
- **Live reference orderbook** - Market depth from external venues for context, with graceful fallback handling.
- **Privy support** - Email login, embedded Solana wallets, and external Solana wallet connections are supported in the app.
- **Shielded collateral base flows** - `deposit_to_shielded`, `request_withdraw_private`, and `finalize_withdraw` are deployed on devnet.

## Architecture

ShadowPerp follows an encrypt, compute, and settle model:

1. **Encrypt** - The client encrypts sensitive trade inputs in the browser.
2. **Queue** - The Solana program receives the encrypted payload and queues an Arcium computation.
3. **Compute** - Arcium MPC evaluates trade logic, margin checks, PnL, and liquidation conditions without exposing raw inputs.
4. **Callback** - Arcium returns a verified result to the Solana program through a replay-hardened callback.
5. **Settle** - The program updates position and margin state from the verified output.

### Privacy Boundary

| Data | Visibility |
|------|-----------|
| Position size, entry price, leverage, margin | Encrypted on chain |
| Direction | Encrypted for MPC, revealed at open for routing and liquidation bookkeeping |
| Liquidation price, unrealized PnL | Encrypted on chain |
| Wallet address and token transfers | Public |
| Trade queued event without plaintext details | Public |

## Repository Layout

```text
programs/shadowperp/     Anchor program
encrypted-ixs/           Arcium circuit sources
app/                     Next.js frontend and product docs
scripts/                 Deploy, oracle, computation, and devnet utilities
build/                   Compiled circuit artifacts
```

## Getting Started

### Prerequisites

- Node.js 20 or later
- npm
- Rust and Cargo
- Solana CLI
- Anchor CLI
- Arcium CLI and build environment

### Install

```bash
npm install
cd app && npm install && cd ..
```

### Environment

```bash
cp app/.env.example app/.env.local
```

Set the required values in `app/.env.local`, especially:

- `NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID`
- `NEXT_PUBLIC_ARCIUM_RPC_URL`
- `NEXT_PUBLIC_PRIVY_APP_ID`
- `NEXT_PUBLIC_PRIVY_API_URL` if Privy is using a custom hosted auth domain such as `https://privy.www.shadowperpdex.xyz`
- market and Arcium runtime values

### Run the Frontend

```bash
cd app
npm run dev
```

## Scripts

### Oracle

```bash
npm run check:oracle
npm run oracle:once
npx ts-node scripts/price-oracle.ts --once --manual-price 130.50
npx ts-node scripts/update-oracle-pyth.ts
```

### Deploy and Initialize

```bash
npx ts-node scripts/deploy-devnet.ts
npx ts-node scripts/create-devnet-mints.ts
npx ts-node scripts/init-markets.ts
npx ts-node scripts/adopt-shared-collateral.ts
npx ts-node scripts/migrate-shared-margin.ts
npx ts-node scripts/init-comp-defs.ts
npx ts-node scripts/init-shielded-comp-defs.ts
npx ts-node scripts/set-pyth-feed-id.ts
```

### Preflight and Validation

```bash
npm run check:preflight
npm run diag:open-contract
npx ts-node scripts/smoke-test-devnet.ts
```

## Current Status

ShadowPerp is deployed on Solana devnet as an active prototype for private perpetual trading.

**Working today**

- Program deployment and upgrade on devnet
- Direct wallet signing for trading and collateral actions
- Privy embedded wallet support for email sign-in
- External Solana wallet support through Privy connectors
- All 6 market accounts initialized on chain with synced computation definition pointers
- Shared collateral custody model deployed on devnet with adoption and migration scripts
- Encrypted open, close, and liquidation computation paths wired into the program
- Cross and isolated margin modes with 1x to 50x leverage
- Limit orders with browser-based automation
- Take profit and stop loss rules
- Collateral deposit and withdrawal through the connected wallet
- Private position metadata stored in the browser for UI continuity
- Live reference orderbook for all 6 pairs
- Pyth oracle integration
- Custom named RPC endpoint manager saved to browser storage
- Shielded collateral pool with `deposit_to_shielded`, `request_withdraw_private`, and `finalize_withdraw` deployed and active on devnet
- Staged open-position diagnostic harness for the Arcium callback path
- Callback-aware UI and SDK behavior so queued no longer looks like final success
- Market-order submission blocks when no trusted price is available instead of silently falling back to mock pair pricing
- Position history is labeled as reconstructed account-scan data rather than presented as a durable trade ledger

**Known devnet limitations**

- End-to-end open and close are not fully signed off yet
- The open lane is still blocked on devnet, and the staged diagnostic harness confirms the abort survives the tuple-only, margin-check, and full-check probes
- Current evidence points away from ordinary business-logic drift and toward an Arcium runtime or lower-level contract mismatch in the open lane
- Shared collateral is active only for adopted markets and migrated owners
- Limit orders and TP/SL are browser-local automation, not venue-side persistence
- Oracle updates are protected by a circuit breaker, so manual intervention is still required when price freshness drifts too far
- Position history is still reconstructed from current closed/liquidated account state rather than a durable ledger

**In progress**

- Private margin lock and settlement through Arcium MPC
- Stronger shielded collateral commitment tree hashing
- Arcium escalation for the open-position lane

## References

- [Arcium](https://www.arcium.com/)
- [Arcium Documentation](https://docs.arcium.com/)
- [Solana](https://solana.com/docs)
- [Anchor](https://www.anchor-lang.com/)
- [Pyth Network](https://pyth.network/)
