# ShadowPerp Codebase Audit Report

Last updated: 2026-04-24

Scope: repo-wide audit of UI, copy, docs, security posture, dependency health, and Arcium execution paths.

## Executive Summary

ShadowPerp is close to a coherent devnet trading flow, but it is not release-clean yet. The largest remaining risks are unresolved Solana ecosystem dependency advisories, broad CSP allowances, and the known Arcium open-position callback blocker. The public signer endpoint findings below have been partially remediated with Privy authentication, wallet matching, allowlisting, and rate limiting.

## Critical / High Findings

### 1. Oracle refresh endpoint can use the server feeder signer

- File: `app/src/pages/api/oracle-refresh.ts`
- Status: Partially remediated in code. The route now requires a Privy bearer token, applies user/IP rate limits, and rejects unsupported market/pair inputs.
- Remaining risk: Rate limiting is still in-memory. For production-grade abuse resistance, move this to a durable store or keep oracle writes daemon-only.

### 2. Faucet endpoint signs server-side token transfers

- File: `app/src/pages/api/faucet-mock-usdc.ts`
- Status: Partially remediated in code. The route now requires a Privy bearer token, verifies the requested Solana wallet belongs to that user, applies user/IP rate limits, and disables local keypair fallback in production.
- Remaining risk: Cooldown is still in-memory. Persist cooldown by user + wallet + IP before treating the faucet as production hardened.

### 3. Open position is still blocked by protocol-side Arcium callback failure

- Files:
  - `programs/shadowperp/src/handlers/open_position.rs`
  - `encrypted-ixs/src/open_position.rs`
  - `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
- Evidence:
  - Live path queues `open_position_probe_b`.
  - Circuit input is `Enc<Shared, (u64, u64, u8, bool, u64)>`.
  - Callback verifies Arcium output before state mutation.
  - Local notes still show live callback failure as `AbortedComputation (6000)`.
- Impact: Both embedded and external wallets share this protocol path, so wallet fixes alone cannot make open-position fully live.
- Recommendation:
  - Deploy and initialize the additive `open_position_tuple_probe_u8_v1` diagnostic lane.
  - Run `scripts/diagnose-open-contract.ts`.
  - If tuple-u8 passes while tuple-bool fails, migrate live input layout away from encrypted bool.
  - Do not claim "fully live" until open and close are verified end-to-end.

### 4. Dependency audit has unresolved high issues

- Root `npm audit --omit=dev`: 15 prod vulnerabilities, including 7 high and 0 critical after targeted overrides.
- App `npm audit --omit=dev`: 45 prod vulnerabilities, including 3 high.
- Impact: Release and supply-chain risk. Some audit fixes suggest unsafe downgrades, so this needs targeted overrides instead of blind `npm audit fix`.
- Recommendation:
  - Do not apply npm's suggested major downgrades for Solana packages.
  - Track safe upstream updates for `@solana/web3.js`, `@solana/spl-token`, Pyth/Jito transitive dependencies, and Privy wallet dependencies.
  - Re-run root and app audits after targeted package updates.

## Medium Findings

### 5. CSP is broad for production

- File: `app/next.config.js`
- Evidence:
  - `script-src` includes `'unsafe-eval'` and `'unsafe-inline'`.
  - `connect-src` allows all `https:` and `wss:`.
- Impact: XSS containment and exfiltration resistance are weaker than ideal.
- Recommendation:
  - Split dev/prod CSP.
  - Narrow `connect-src` to exact Privy, TradingView, RPC, WalletConnect/Reown, and app domains.
  - Document why any unsafe directives are still required.

### 6. Privacy and auth copy overpromise current behavior

- Files:
  - `app/src/pages/app.tsx`
  - `ARCHITECTURE.md`
- Evidence:
  - Historical UI/docs copy overpromised privacy and mentioned social login while runtime login methods are wallet + email only.
- Status: Remediated in touched UI/config/docs copy. Continue watching new landing/docs changes for the same wording drift.

### 7. Read APIs lack public-abuse controls

- Files:
  - `app/src/pages/api/prices.ts`
  - `app/src/pages/api/reference-depth.ts`
- Status: Remediated with lightweight IP rate limits and explicit method checks where missing.
- Remaining risk: Rate limits are in-memory; use edge/CDN or durable limits for production abuse controls.

## Positive Findings

- Privy runtime config is Solana-only with wallet + email login and Ethereum embedded wallet creation disabled.
- Trading panel avoids using mock prices as executable trading inputs.
- Open-position queue path enforces oracle freshness before queuing.
- Arcium callback verifies output before mutating position state.
- Current docs and local notes correctly warn not to claim full live status before open/close verification.

## Verification Run

- `npm run oracle:once` refreshed stale devnet oracle successfully.
- `npm run check:preflight` passed after refresh.
- `npm run check:oracle` passed after refresh.
- `cargo check -p shadowperp` passed with warnings.
- `cd app && .\node_modules\.bin\tsc.cmd --noEmit` passed.
- `cd app && npm run lint -- --quiet` passed.
- `npm run check:release-hygiene --strict` failed because the worktree is intentionally dirty.
- root `npm audit --omit=dev` still fails due unresolved high/moderate vulnerabilities, but no longer reports a critical vulnerability.
- app `npm audit --omit=dev` still fails due unresolved high/moderate/low vulnerabilities.

## Recommended Fix Order

1. Replace in-memory signer-route rate limits with durable rate limits if these routes remain public.
2. Resolve remaining dependency audit blockers with targeted upstream-compatible updates, not blind audit fix.
3. Tighten CSP after confirming required Privy/TradingView/WalletConnect domains.
4. Deploy and run Arcium diagnostic lane for `open_position_probe_b`.
5. Re-run full preflight, build, audit, and open/close smoke flow.
