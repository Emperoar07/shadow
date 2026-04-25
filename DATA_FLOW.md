# ShadowPerp Data Flow

This document describes the live request/response flow across UI, Solana, and Arcium.

Current product note:

- the live frontend is direct-wallet first
- embedded and external Solana wallets both sign directly through the app
- delegated session flows remain documented below because the protocol and relay still support them, but they are no longer the primary user path

## 1. Open Position Flow

### Input

- user sets side, size, leverage, order type, optional TP/SL
- UI derives margin requirement estimate from oracle/market data

### Execution Path

1. UI builds encrypted order payload client-side
2. Connected wallet signs and submits `open_position`
3. Program validates basic guards:
   - margin availability
   - oracle freshness
   - account constraints
4. Program queues Arcium computation via `queue_computation`
5. Arcium cluster executes `open_position` circuit
6. Callback `open_position_probe_b_callback` verifies output and updates state

### State Effects

- position moves `Pending -> Open` on successful callback
- margin lock updates occur in margin account
- `market.active_positions` increments on successful callback

### Delegated Open (Session Path, legacy/optional)

1. Owner creates `TradeSession` once (`create_trade_session`)
2. Relayer submits `open_position_with_session` (owner not signer)
3. Program validates session:
   - relayer match
   - not expired/revoked
   - action cap remaining
   - margin <= per-action cap
4. Program queues Arcium computation exactly like direct open path
5. Callback finalizes `Pending -> Open`

### Delegated Open (Wallet-Scoped Session V2 Path, legacy/optional)

1. Owner creates `TradeSessionV2` once (`create_trade_session_v2`)
2. Relayer submits `open_position_with_session_v2`
3. Program validates session:
   - relayer match
   - not expired/revoked
   - action cap remaining
   - margin <= per-action cap
   - wallet-scoped session is allowed across supported markets
4. Program queues Arcium computation exactly like direct open path
5. Callback finalizes `Pending -> Open`

## 2. Close Position Flow

1. UI requests close for open position
2. Connected wallet signs and submits `close_position`
3. Arcium computes settlement outputs
4. Callback verifies output, updates balances, and moves the position to `ClosedPendingSettlement`
5. Client submits `settle_close_position`
6. Program transfers settlement from vault to owner and marks the position `Closed`

### Delegated Close (Session Path, legacy/optional)

1. Relayer submits `close_position_with_session` under active session
2. Program validates session and consumes one action
3. Program queues Arcium close computation
4. Callback verifies output, then relayer submits `settle_close_position`

### Delegated Close (Wallet-Scoped Session V2 Path, legacy/optional)

1. Relayer submits `close_position_with_session_v2` under active wallet-scoped session
2. Program validates session and consumes one action
3. Program queues Arcium close computation
4. Callback verifies output, then relayer submits `settle_close_position`

## 3. Liquidation Check Flow

1. Keeper/user triggers liquidation check
2. Program queues `check_liquidation` computation
3. Program records the authorized liquidator in a `LiquidationSettlement` PDA keyed by position
4. Callback applies liquidation state only when condition is true and moves the position to `LiquidatedPendingSettlement`
5. Liquidator submits `settle_liquidation`
6. Program verifies the recorded liquidator, transfers the liquidation reward, and marks the position `Liquidated`

## 4. Collateral Flow

### Deposit

- UI sends deposit instruction
- SPL transfer into market-linked vault
- on adopted markets, that vault is the shared collateral vault for the collateral mint
- owner-scoped margin account balance increases
- devnet faucet availability/top-up checks read the connected wallet's mUSDC token account,
  not the owner-scoped margin account

### Withdraw

- UI sends withdraw instruction
- program enforces available margin checks
- SPL transfer from the market-linked vault to the user token account
- on adopted markets, this resolves to the shared collateral vault

### Shielded Deposit (feature-gated)

1. User calls `deposit_to_shielded` with amount and client-computed commitment
2. SPL transfer from user ATA to vault (public)
3. Commitment appended to `CommitmentTree` at next leaf index
4. Rolling root updated in tree and pool
5. Pool accounting incremented (`total_public_in`, `commitment_count`)
6. `ShieldedDeposit` event emitted (pool, depositor, commitment, leaf index — no plaintext amount)

### Shielded Withdraw (feature-gated)

1. User calls `request_withdraw_private` with nullifier and amount
2. Program creates `PendingWithdrawal` PDA (keyed by pool + nullifier — PDA uniqueness prevents double-spend)
3. Expiry set to `current_slot + WITHDRAWAL_DELAY_SLOTS`
4. After delay, user calls `finalize_withdraw`
5. Program verifies delay passed, marks nullifier spent in `NullifierSet`
6. SPL transfer from vault to recipient (public)
7. Pool accounting incremented (`total_public_out`)

### Private Margin Lock/Release (stubs — awaiting Arcium circuits)

- `lock_margin_private` will queue Arcium MPC computation with commitment reference and encrypted balance
- Callback will verify output and update shielded commitment root
- `settle_private_position` will apply PnL/funding/fees privately through MPC callback

### Shared Collateral Migration Flow

1. Legacy markets begin with per-market vault custody and per-market margin PDAs.
2. Admin runs `adopt_shared_collateral_vault` to move each market onto the shared collateral vault for the collateral mint.
3. Each owner runs `migrate_legacy_margin_account` after legacy positions are flat (`locked_balance == 0`).
4. After migration:
   - one owner-scoped margin account can fund multiple adopted markets
   - closing or liquidating any adopted market settles back into the shared collateral pool

Important:

- This is a migration-backed architecture change, not a silent in-place flip.
- On the current devnet namespace, adopted markets already use the shared vault model.
- Each owner with legacy per-market balances still needs the owner migration step before treating their balance as one shared pool.
- Cross-pair shared collateral has been smoke-verified on adopted markets, but that does not migrate legacy balances automatically for every wallet.

Note:

- L1 token transfers remain public (Solana constraint).
- Privacy target is internal collateral ownership, allocation, and margin transitions.
- Full design in `PRIVATE_COLLATERAL_SPEC.md`.

## 4.1 Direct Wallet Lifecycle

1. User connects through Privy with either:
   - an embedded Solana wallet
   - an external Solana wallet connector
2. User signs trading and collateral transactions directly from that wallet
3. The app encrypts sensitive order inputs before queueing Arcium computation
4. Callback and settlement complete on-chain without a delegated relayer being required in the primary frontend path

## 4.2 Delegated Session Lifecycle

1. `create_trade_session`: owner signs once, defines relayer + limits
2. `open_position_with_session` / `close_position_with_session`: relayer executes within limits
3. `revoke_trade_session`: owner can immediately disable delegated execution
4. `create_trade_session_v2`: owner signs once for a wallet-scoped delegated window across supported markets
5. `open_position_with_session_v2` / `close_position_with_session_v2`: relayer executes across markets within the same limits
6. `revoke_trade_session_v2`: owner can immediately disable the wallet-scoped delegated session

Note:

- The delegated lifecycle remains part of the protocol and relay surface, but it is not the primary live frontend UX anymore.
- `TradeSessionV2` is deployed on devnet and reflected in the generated IDL.
- One wallet-scoped delegated session has been smoke-tested across multiple markets for delegated collateral actions.
- The separate `open_position_probe_b` callback issue remains an independent blocker and is not part of the v2 session smoke proof.

## 5. Oracle Flow

- feeder updates on-chain oracle through `update_price`
- trading paths enforce max staleness window
- stale oracle blocks open/close/liquidation operations

Operational scripts:

- one-shot: `npm run oracle:once`
- daemon: `npm run oracle:daemon`
- manual override: `npx ts-node scripts/price-oracle.ts --once --manual-price <USD>`
- check: `npm run check:oracle`

The manual override bypasses external source fetching (Coinbase, Binance, CoinGecko) and submits the given price directly. The on-chain 10x circuit breaker still applies as a safety net.

## 6. Network/RPC Flow

- script layer resolves healthy RPC from configured candidate list
- UI layer can switch among configured endpoints manually
- preferred UI endpoint index persists locally and triggers provider rebind

## 7. Preflight and Smoke Flow

Use this sequence before real testing:

1. `npm run check:preflight`
2. `npx ts-node scripts/devnet-canary.ts --max-oracle-age-seconds 300`
3. `npm run oracle:once` or daemon
4. `npm run check:stable`
5. run smoke path (`_smoke_devnet.ts`) and verify:
   - deposit
   - open
   - callback progression
   - close
   - market-order submit blocks cleanly when no trusted price is available
   - position-history reconstructed-data notice renders when history rows are shown

Canary scope:

- oracle freshness
- finalized comp-def pointers
- client encryption init
- non-destructive `open_position` queue simulation health

## 8. Typical Failure Classes

### Arcium queue invalid arguments

Likely cause:

- circuit signature / comp-def mismatch across local artifacts, deployed binary, and finalized comp-def

Fix:

- regenerate circuits
- rebuild/deploy program
- re-init/sync comp-def pointers

### Stale price

Likely cause:

- oracle daemon not running or delayed updates

Fix:

- refresh oracle and rerun

### Missing env at client init

Likely cause:

- missing `NEXT_PUBLIC_*` vars in `app/.env.local`

Fix:

- set vars and restart dev server
