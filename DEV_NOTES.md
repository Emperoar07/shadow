# ShadowPerp Developer Notes

Internal handoff notes for the next engineer. Do not publish secrets.

## Last Updated

- 2026-04-24 UTC

## Live Baseline

- Active devnet program: `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`
- Active market: `crEV9TSAU6xkiWFUAZebejHmWVh6VFx5EEFLcfX9L2T`
- Arcium cluster offset: `456`
- Current product path:
  - Privy for auth + wallet connection
  - direct Solana wallet execution
  - no delegated relay/session flow in the live UI path

## What Changed Recently

### Faucet RPC + modal hardening

- Hardened `app/src/pages/api/faucet-mock-usdc.ts` so the faucet route no longer trusts a single RPC env var.
  - probes configured RPC candidates
  - skips unauthorized/broken endpoints
  - falls back to public devnet if needed
- Updated `app/src/components/CollateralModal.tsx` to accept either faucet response shape:
  - `transaction`
  - `signature`

### Arcium diagnostic expansion

- Added an additive tuple diagnostic lane using `u8` instead of encrypted `bool`:
  - `open_position_tuple_probe_u8_v1`
- Wired it through:
  - `encrypted-ixs/src/open_position_diagnostics.rs`
  - `programs/shadowperp/src/handlers/init_comp_defs.rs`
  - `programs/shadowperp/src/handlers/open_position_diagnostics.rs`
  - `programs/shadowperp/src/handlers/callbacks/open_position_diagnostic_callbacks.rs`
  - `programs/shadowperp/src/state/open_position_diagnostic.rs`
  - `programs/shadowperp/src/lib.rs`
  - `scripts/diagnose-open-contract.ts`

### Pre-trade oracle refresh

- Added `app/src/pages/api/oracle-refresh.ts`.
  - Checks on-chain oracle freshness.
  - If stale, publishes a median reference price using the authorized server-side oracle feeder.
  - Requires `ORACLE_FEEDER_SECRET_KEY` only when a write is actually needed.
- Updated `app/src/hooks/useArcium.ts` to refresh/check the oracle before building encrypted open-position args.
- Corrected frontend ShadowPerp error-code mapping:
  - `6007` -> `InvalidPrice`
  - `6008` -> `StalePrice`

### Repo-wide audit pass

- Added local audit report: `CODEBASE_AUDIT_REPORT.md`.
- Main findings:
  - public signer endpoint risk in `app/src/pages/api/oracle-refresh.ts`
  - public faucet signer/rate-limit risk in `app/src/pages/api/faucet-mock-usdc.ts`
  - dependency audit blockers in root and app package trees
  - privacy/social copy mismatches in app UI and docs
  - open-position still blocked by protocol-side Arcium callback failure, not wallet auth

### Safe audit fix pass

- Hardened `app/src/pages/api/oracle-refresh.ts`:
  - requires Privy bearer-token auth
  - adds user/IP rate limiting
  - rejects unsupported market/pair inputs
  - requires requested market and trading pair to match
- Hardened `app/src/pages/api/faucet-mock-usdc.ts`:
  - requires Privy bearer-token auth
  - verifies the requested Solana wallet belongs to the authenticated user
  - adds user/IP rate limiting
  - disables local Solana keypair fallback in production
- Updated frontend callers to pass Privy bearer tokens for:
  - pre-trade oracle refresh
  - faucet claims from the collateral modal
  - faucet claims from the zero-balance onboarding gate
- Corrected privacy/auth copy drift:
  - removed "social" wording where runtime supports wallet + email only
  - replaced absolute "never exposed on chain" language with precise encrypted-input copy
- Added lightweight IP rate limits to public read-only market data APIs:
  - `app/src/pages/api/prices.ts`
  - `app/src/pages/api/reference-depth.ts`
- Added root dependency overrides:
  - `protobufjs >=7.5.5`
  - patched `bn.js` ranges

## What Was Verified

- `cargo check -p shadowperp` -> PASS on 2026-04-24 UTC
- `cd app && .\\node_modules\\.bin\\tsc.cmd --noEmit` -> PASS on 2026-04-24 UTC
- `next build` was attempted from `app/`, but this shell hit a local `spawn EPERM` restriction before surfacing any repo code error
- 2026-04-24 UTC: Open-position screenshot error `Custom:6008` was traced to `ShadowPerpError::StalePrice`.
  - `npm run check:oracle` initially failed with oracle age around 39,200s.
  - `npm run oracle:once` refreshed the live devnet market to `$86.3350`.
  - `npm run check:oracle` -> PASS with age under 300s.
  - `npm run check:preflight` -> PASS after refresh.
- 2026-04-24 UTC: `cd app && .\\node_modules\\.bin\\tsc.cmd --noEmit` -> PASS after pre-trade oracle refresh changes.
- 2026-04-24 UTC: `cd app && npm run lint -- --quiet` -> PASS after pre-trade oracle refresh changes.
- 2026-04-24 UTC: `cd app && npm run build` was attempted twice but hung until bounded local timeouts; no TypeScript or lint error surfaced.
- 2026-04-24 UTC: repo-wide audit verification:
  - `npm run oracle:once` refreshed stale oracle successfully.
  - `npm run check:preflight` -> PASS after refresh.
  - `npm run check:oracle` -> PASS after refresh.
  - `cargo check -p shadowperp` -> PASS with warnings.
  - `cd app && .\\node_modules\\.bin\\tsc.cmd --noEmit` -> PASS.
  - `cd app && npm run lint -- --quiet` -> PASS.
  - `npm run check:release-hygiene --strict` -> FAIL because worktree is intentionally dirty.
  - root `npm audit --omit=dev` -> FAIL: 17 prod vulnerabilities, including 1 critical and 7 high.
  - app `npm audit --omit=dev` -> FAIL: 45 prod vulnerabilities, including 3 high.
- 2026-04-24 UTC: safe audit fix verification:
  - `npm run oracle:once` refreshed stale oracle successfully.
  - `npm run check:preflight` -> PASS.
  - `npm run check:oracle` -> PASS.
  - `cd app && .\\node_modules\\.bin\\tsc.cmd --noEmit` -> PASS.
  - `cd app && npm run lint -- --quiet` -> PASS.
  - `cargo check -p shadowperp` -> PASS with existing warnings.
  - root `npm audit --omit=dev` -> FAIL: 15 prod vulnerabilities, 0 critical, 7 high.
  - app `npm audit --omit=dev` -> FAIL: 45 prod vulnerabilities, 3 high.
  - `cd app && npm run build` timed out locally after 240s and left no code error before timeout; timed-out node workers were stopped.

## Current Blocker

### 1. Faucet/browser retest still needed

- The invalid RPC API-key failure path is patched locally.
- This still needs a browser retest in the same environment that previously showed:
  - `401 Unauthorized`
  - `invalid api key provided`

### 2. Live open-position protocol issue still unresolved

- Both embedded and external wallets converge into the same open-position lane.
- The shared blocker is still protocol-side:
  - `open_position_probe_b` queues
  - callback later hits `AbortedComputation (6000)`
- The new `tuple-u8` diagnostic lane is wired locally but is **not live yet**.
- Separate transient queue-gate issue: `Custom:6008` is `StalePrice`; refresh or run the oracle daemon before retesting open-position flow.
- UI now pre-checks/refreshes the oracle before open-position submission, but hosted production must set `ORACLE_FEEDER_SECRET_KEY` for stale-price writes.

### 3. Audit release blockers

- Public server signer endpoints are now auth-gated, wallet/market-scoped, and rate-limited in-memory.
- Remaining production hardening: move signer-route rate limits/cooldowns to a durable store if these routes remain public.
- Resolve targeted dependency audit issues; do not run blind `npm audit fix`.
- Correct product copy/docs around privacy boundaries and social-login availability when new copy lands.

## Next Safe Step

1. Browser-retest faucet claim flow.
   - confirm the modal no longer fails on a bad RPC key
   - confirm the response-shape mismatch is gone
2. Build and deploy the new Arcium diagnostic lane.
3. Initialize `open_position_tuple_probe_u8_v1` comp-def on devnet.
4. Run `scripts/diagnose-open-contract.ts`.
5. Compare results:
   - if old tuple aborts and `tuple-u8` passes, migrate the live shared tuple away from encrypted `bool`
   - if both abort, keep digging below the tuple-type layer
6. Replace in-memory signer-route limits with durable rate limits before any production release claim.
7. Resolve remaining dependency audit blockers via safe upstream-compatible updates.

## Notes

- Do not claim the live open-position bug is fixed yet.
- Do not rotate away from the live `ESyr...` namespace unless intentionally starting a fresh namespace.
