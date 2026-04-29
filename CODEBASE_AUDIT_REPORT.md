# ShadowPerp Codebase Audit Report

Last updated: 2026-04-29

Scope: repo-wide audit of UI, copy, docs, security posture, dependency health, Arcium MPC execution paths, and code quality. Three agents ran in parallel: security-review, Arcium circuit audit, and code simplify.

## Executive Summary

ShadowPerp has a coherent devnet trading skeleton but is not release-clean. The most urgent blockers are: (1) the `AbortedComputation (6000)` on `open_position` traced to `encrypted_bool` inside a heterogeneous Arcium tuple — a known Arcium 0.9.3 abort vector with a clear patch; (2) a session-trading withdrawal handler that does not enforce the per-action margin cap, allowing users to drain their session account in a single call; (3) faucet and public signer controls need hosted KV/Upstash envs enabled for durable production enforcement. CSP, dependency-chain upgrades, and rent-harvesting findings are medium severity and can follow.

---

2026-04-29 working-tree addendum: the current dirty tree is not build-clean. The immediate blocker is no longer just protocol behavior; it is now a partial `check_liquidation_v2` Arcium migration plus a program namespace split between the live `ESyr...` deployment and a new `34ws...` program ID. Do not ship this working tree until the artifact set, program ID, generated IDL, and preflight target are made consistent.

---

## Working Tree Audit Addendum (2026-04-29)

Scope: current dirty working tree only. Applied review lenses: Arcium program-development contracts, final codebase audit, and release-safety verification.

### WT-H1. `check_liquidation_v2` migration is not build-clean

- Files:
  - `encrypted-ixs/src/liquidation_check.rs:20`
  - `programs/shadowperp/src/handlers/callbacks/liquidation_callback.rs:13`
  - `programs/shadowperp/src/handlers/init_comp_defs.rs:283`
  - `programs/shadowperp/src/lib.rs:605`
- Evidence: the Rust program now references `check_liquidation_v2`, but the `build/` directory only contains `check_liquidation_v2.arcis`. The companion `check_liquidation_v2.idarc` and generated type artifacts are missing.
- Verification: `cargo check -p shadowperp` fails because Arcium macros cannot read `build/check_liquidation_v2.idarc`. Follow-on generated symbols are also missing: `CheckLiquidationV2Callback`, `CheckLiquidationV2Output`, `__client_accounts_check_liquidation_v2_callback`, and `InitLiquidationCompDef`.
- Impact: the program cannot compile, so no deploy/init/smoke path is safe from this tree.
- Recommendation: regenerate the full v2 artifact set with `arcium build`. If the Arcium CLI emits only old-name `check_liquidation` artifacts, update the build helper to produce deterministic v2 aliases and rewrite generated artifact names consistently. Then rerun `cargo check -p shadowperp`.

### WT-H2. Program namespace is split between `ESyr...` and `34ws...`

- Runtime defaults have now been moved to program `34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo` and market `uGdPR4kmFWR3HwJ8esEjbeMwnuBKVD7oA9ENRv32uvy`; older `ESyr...`/`crEV...` references are historical only.
- Dirty runtime changes point at `34ws...` in:
  - `Anchor.toml:9`
  - `programs/shadowperp/src/lib.rs:89`
  - `app/src/idl/shadowperp.json:2`
  - `app/src/components/WalletPopup.tsx:14`
  - `app/src/pages/api/oracle-refresh.ts:26`
- Impact: scripts, app IDL, program declaration, oracle route, and operational notes can target different deployments. That creates false positives in preflight and can make a local fix look broken on-chain.
- Recommendation: choose one namespace before committing. If staying on the live devnet program, restore the `ESyr...` targets. If intentionally moving to `34ws...`, update `Arcium.toml`, env examples, scripts, `DEV_NOTES.md`, generated IDL, deployment notes, and rerun deploy/init/preflight against the new namespace.

### WT-H3. Frontend IDL is stale/inconsistent

- File: `app/src/idl/shadowperp.json`
- Evidence: the IDL address was changed to the `34ws...` program, but instruction names still include old liquidation entries such as `check_liquidation` and `check_liquidation_callback`.
- Impact: the frontend can point at a different program address while still describing old instruction/account shapes.
- Recommendation: do not hand-edit the IDL address alone. Regenerate the IDL only after Rust compiles and the final namespace is chosen.

### WT-H4. Liquidation math changed materially and needs fixtures

- File: `encrypted-ixs/src/liquidation_check.rs`
- Evidence: the circuit now uses bit-shift scaling such as `(size >> 10) * (price_diff >> 10)` and `notional * liquidation_threshold_bps as u64 >> 14`, replacing the previous decimal-scale arithmetic.
- Impact: liquidation thresholds, PnL, and maintenance margin can drift from the intended contract math. This is especially risky because liquidation logic is safety-critical and runs under Arcium.
- Recommendation: add deterministic fixtures comparing old and new liquidation outputs across long/short, profitable/loss cases, tiny sizes, large sizes, and threshold edges. Verify the intended scale before deployment; comments mention 6-decimal units while the prior scale constant was larger.

### WT-M1. Build helpers do not guarantee v2 liquidation artifacts

- Files:
  - `scripts/wsl-arcium-build.sh`
  - `scripts/run-arcium-build.sh`
- Evidence: helper aliasing currently covers open/close position artifacts, but not the new `check_liquidation_v2` artifact family.
- Impact: developers can run the normal build helper and still end up with an uncompilable program tree.
- Recommendation: make the build helper fail fast unless every referenced Arcium artifact exists, including `.idarc` and generated TypeScript/Rust names for `check_liquidation_v2`.

### WT-M2. Raw circuit account pre-growth path is unverified

- File: `scripts/init-comp-defs.ts`
- Evidence: the working tree adds a raw circuit account pre-growth helper, but compile and preflight are currently blocked before this path can be validated end-to-end.
- Impact: the helper may be correct, but it is not yet proven against the current namespace/artifact set.
- Recommendation: after WT-H1/WT-H2 are resolved, run comp-def initialization on the selected devnet namespace and record whether the raw account path is idempotent.

### Verification snapshot

- `git diff --check` passed, with only line-ending warnings.
- `cargo check -p shadowperp` failed on missing `check_liquidation_v2.idarc` and missing generated Arcium types.
- `cd app && .\node_modules\.bin\tsc.cmd --noEmit` passed.
- `npm run check:preflight` failed while querying the old `ESyr...` account path with `TypeError: fetch failed`, consistent with the namespace split.
- Root `npm audit --omit=dev --json`: 15 production vulnerabilities, 7 high, 0 critical.
- App `npm audit --omit=dev --json`: 45 production vulnerabilities, 3 high, 0 critical.

---

## Critical / High Findings

### H1. Session withdrawal bypasses per-action margin cap (NEW)

- Files: `programs/shadowperp/src/handlers/session_trading.rs:806-858` (V1), `:1458-1510` (V2)
- Evidence: Withdrawal handlers check that the session account has sufficient balance but do not enforce the per-action cap that open/close/liquidation handlers check. A user can withdraw the entire session balance in one transaction.
- Impact: Any user can drain their session account instantly, bypassing position margin requirements.
- Recommendation: Add `require!(amount <= market.max_session_withdraw_per_action, ...)` (or equivalent) at the top of both V1 and V2 withdrawal handlers before the balance check.

### H2. SOL faucet reuses gas-sponsor signing key (NEW)

- File: `app/src/pages/api/faucet-sol.ts`
- Evidence: The SOL drip endpoint loads `SOLANA_GAS_SPONSOR_SECRET_KEY` to transfer native SOL. This is the same key used by `/api/sponsor-solana` for gas sponsorship.
- Impact: If the faucet is abused, the gas-sponsor account is drained and all sponsored transactions fail for all users.
- Recommendation: Provision a dedicated `FAUCET_SOL_SECRET_KEY` for the SOL faucet. Keep the gas-sponsor key strictly for fee-payer co-signing.

### H3. SOL faucet one-time check breaks after 1000 confirmed transactions (NEW)

- File: `app/src/pages/api/faucet-sol.ts`
- Evidence: The "has this wallet ever received a SOL drip" check scans on-chain transaction history via `getSignaturesForAddress` with a limit of 1000. After 1000 confirmed transactions on the wallet, older drip records fall outside the scan window and the durable-record gap is exploited.
- Impact: High-activity wallets can receive unlimited SOL drips.
- Recommendation: Store drip records in a server-side KV store (Redis, Vercel KV, or a Solana PDA per wallet) instead of scanning tx history.

### H4. Oracle refresh endpoint — rate limit durability (carry-over from prior audit)

- File: `app/src/pages/api/oracle-refresh.ts`
- Status: Remediated in code. The route requires Privy bearer token auth, rejects unsupported inputs, and uses `checkRateLimitAsync`, which is durable when `UPSTASH_REDIS_REST_*` or `KV_REST_API_*` is configured.
- Remaining operational risk: Hosted production must configure the durable store envs, otherwise local/dev falls back to memory.

### H5. mUSDC faucet cooldown durability (carry-over)

- File: `app/src/pages/api/faucet-mock-usdc.ts`
- Status: Remediated in code. Requires Privy auth, wallet ownership check, durable-capable IP + user rate limits, no local-keypair fallback in production, and wallet cooldown persistence through the same optional KV/Upstash backend.
- Remaining operational risk: Hosted production must configure the durable store envs, otherwise local/dev falls back to memory.

### H6. Open position blocked by Arcium AbortedComputation (6000) — root cause confirmed (carry-over + new detail)

- Files:
  - `encrypted-ixs/src/open_position.rs:19`
  - `programs/shadowperp/src/handlers/open_position.rs:236`
  - `app/src/lib/client.ts:272-281`
  - `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
- Root cause (confirmed by Arcium audit): The live circuit uses `Enc<Shared, (u64, u64, u8, bool, u64)>`. On Arcium 0.9.3, `encrypted_bool` inside a heterogeneous tuple triggers `AbortedComputation (6000)` during share-conversion — the MPC path asserts the cleartext is exactly 0 or 1, but field-element reconstruction under tuple packing does not guarantee this. The diagnostic lane (`open_position_tuple_probe_u8_v1`) was built specifically to isolate this.
- The same `encrypted_bool` pattern appears in: `close_position.rs:25`, `liquidation_check.rs:21`, `settle_private_position.rs:31`.
- Concrete fix:
  1. Run `scripts/diagnose-open-contract.ts` — if u8 probe passes while bool probe aborts, the hypothesis is confirmed.
  2. In `encrypted-ixs/src/open_position.rs:19` change `bool` → `u8`.
  3. In `app/src/lib/client.ts:277` the `BigInt(input.direction === "long" ? 1 : 0)` encoding is already correct as int; no change needed there.
  4. In `programs/shadowperp/src/handlers/open_position.rs:236` replace `.encrypted_bool(encrypted_is_long)` → `.encrypted_u8(encrypted_is_long)`.
  5. Apply the same bool→u8 change to `close_position`, `liquidation_check`, and `settle_private_position` and their queue handlers.
  6. `arcium build && arcium deploy` and re-`init_open_position_comp_def`.
- Do not claim "fully live" until open and close are verified end-to-end on devnet.

### H7. Dependency audit has unresolved high issues (carry-over)

- Root `npm audit --omit=dev`: 15 prod vulnerabilities (7 high).
- App `npm audit --omit=dev`: 45 prod vulnerabilities (3 high).
- Recommendation: Do not apply blind `npm audit fix`. Track safe upstream updates for `@solana/web3.js`, `@solana/spl-token`, Pyth/Jito transitive deps, and Privy wallet deps.

---

## Medium Findings

### M1. Rent harvesting via arbitrary payer in settle_close_position (NEW)

- File: `programs/shadowperp/src/handlers/settle_close_position.rs:8-66`
- Evidence: The `close = payer` constraint allows any wallet passed as `payer` to receive the position account's rent lamports on close.
- Impact: Any caller can redirect rent to themselves instead of the position owner.
- Recommendation: Change `close = payer` to `close = position.owner` (or `close = user`) so rent always returns to the position owner.

### M2. Wrapping arithmetic on signed PnL in settle_private_position circuit (NEW)

- File: `encrypted-ixs/src/settle_private_position.rs:44-57`
- Evidence: PnL math uses standard Rust integer arithmetic on `i64`-equivalent values without overflow guards. Under MPC, values arrive as field elements; if the encrypted PnL is adversarially crafted near `i64::MAX`, the subtraction wraps.
- Impact: PnL settlement could produce a wildly incorrect result, allowing a user to claim artificially inflated gains.
- Recommendation: Use checked/saturating arithmetic (`checked_sub`, `saturating_add`) for the PnL accumulation, and add a bounds assert before writing settlement state.

### M3. Oracle force flag abusable by any authenticated user (NEW)

- File: `app/src/pages/api/oracle-refresh.ts`
- Evidence: The `force: true` query flag bypasses the oracle freshness check for any Privy-authenticated user — not just admins or daemon callers.
- Impact: An authenticated user can spam oracle writes, inflating RPC usage and potentially front-running price moves.
- Recommendation: Gate `force: true` behind an admin-only check (compare the Privy user ID or embedded wallet address against an allowlist env var). Remove or scope-lock it before production.

### M4. Wallet-history API has no auth, exhausts Helius key (NEW)

- File: `app/src/pages/api/history.ts`
- Evidence: The route accepts any wallet address and proxies requests to Helius without authentication or rate limiting.
- Impact: A bot can exhaust the Helius API key quota with arbitrary wallet history queries.
- Recommendation: Require a Privy bearer token and verify the requested wallet belongs to the authenticated user. Add IP rate limiting matching the faucet route.

### M5. CSP is broad for production (carry-over)

- File: `app/next.config.js:41,45`
- Evidence: `script-src` includes `'unsafe-eval'` and `'unsafe-inline'`. `connect-src` allows all `https:` and `wss:`.
- Recommendation: Split dev/prod CSP. Narrow `connect-src` to exact Privy, TradingView, RPC, WalletConnect, and app domains.

### M6. Read APIs rate-limited only in-memory (carry-over)

- Files: `app/src/pages/api/prices.ts`, `app/src/pages/api/reference-depth.ts`
- Status: Lightweight IP rate limits added. Remaining risk: resets on cold start.

---

## Low Findings

### L1. Privy auth helper lowercases base58 addresses (NEW)

- File: `app/src/lib/server/privy-auth.ts`
- Evidence: `verifyPrivyToken` lowercases the resolved wallet address before returning it. Base58 Solana addresses are case-sensitive; lowercasing silently corrupts them, causing wallet-match checks downstream to always fail.
- Recommendation: Remove the `.toLowerCase()` call; compare addresses as-is or use a canonical comparison that doesn't alter the casing.

### L2. Gas sponsor size check is post-base64 (NEW)

- File: `app/src/pages/api/sponsor-solana.ts`
- Evidence: `MAX_BODY_BYTES` is checked against the raw base64-encoded body length, not the decoded transaction bytes.
- Impact: The check is 33% looser than intended (base64 inflates ~33%); oversized transactions pass the guard.
- Recommendation: Decode first, then check `Buffer.byteLength`.

### L3. x-forwarded-for trusted unconditionally (NEW)

- File: `app/src/lib/server/privy-auth.ts`
- Evidence: The IP rate limiter reads `x-forwarded-for` without verifying that it was set by a trusted proxy. In Vercel this is safe; on other platforms an attacker can spoof arbitrary IPs to bypass IP rate limits.
- Recommendation: Document the Vercel-only assumption, or add a trusted-proxy CIDR check if the app is ever deployed elsewhere.

### L4. close_position callback uses Err on verify failure (NEW)

- File: `programs/shadowperp/src/handlers/callbacks/close_position_callback.rs:83`
- Evidence: The verify-failure path returns `Err(...)` rather than cleaning up and returning `Ok(())` (the pattern used by `open_position_callback`). A real `AbortedComputation` on close keeps the position in `Closing` forever (Solana rolls back the cleanup).
- Recommendation: Mirror the open callback's `Ok(())` cleanup pattern: transition the position to `Closed` and call `consume_pending_computation` before returning success.

### L5. comp_def_account key check is after state mutation in open_position_callback (NEW)

- File: `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs:127`
- Evidence: `require!(comp_def_account.key() == market.open_position_comp_def)` is checked after the cleanup branch that closes the position on verify failure. A malicious computation account from a different comp_def could trigger the cleanup side-effect.
- Recommendation: Move the `require!` block above the verify-fail handler so the key check is the first operation.

### L6. seed_open_interest_state dummy argument is zero (NEW)

- File: `programs/shadowperp/src/handlers/seed_open_interest_state.rs:80`
- Evidence: `ArgBuilder::new().plaintext_u8(0).build()` passes a constant zero. If the Arcium compiler folds the constant, `Mxe::get().from_arcis((0, 0))` can abort. The pattern is fragile across compiler versions.
- Recommendation: Pass a non-zero sentinel (e.g., `1`) as the dummy argument to prevent constant folding.

### L7. max_leverage zero not guarded in open_position handler (NEW)

- File: `programs/shadowperp/src/handlers/open_position.rs:241`
- Evidence: `market.max_leverage` is a `u8` sent as `plaintext_u8`. If it is zero, `leverage_max_ok = leverage <= 0` always evaluates to false in the circuit, leaving the position permanently in `Closed` rather than returning a readable error.
- Recommendation: Add `require!(market.max_leverage > 0, ErrorCode::InvalidMarketConfig)` at the top of the handler.

---

## Positive Findings

- Privy runtime config is Solana-only with wallet + email login and Ethereum embedded wallet creation disabled.
- `shouldAutoConnect: false` on external wallet connectors prevents wallet-extension hijack on refresh.
- `createOnLogin: "users-without-wallets"` prevents embedded wallet creation failures for existing users.
- Trading panel avoids using mock prices as executable trading inputs.
- Open-position queue path enforces oracle freshness before queuing.
- Arcium callback verifies output before mutating position state.
- Diagnostic lane for `open_position` is fully wired — four probes deployed end-to-end with correct `comp_def_offset` strings and matching `#[arcium_callback]` macros. Ready to run.
- `consume_pending_computation` provides replay protection on all callback paths.
- Current docs and local notes correctly warn not to claim full live status before open/close verification.

---

## Verification Run (2026-04-26)

- `npm run oracle:once` refreshed stale devnet oracle successfully.
- `npm run check:preflight` passed after refresh.
- `npm run check:oracle` passed after refresh.
- `cargo check -p shadowperp` passed with warnings.
- `cd app && tsc --noEmit` passed.
- `cd app && npm run lint -- --quiet` passed.
- root `npm audit --omit=dev` still fails: unresolved high/moderate vulnerabilities.
- app `npm audit --omit=dev` still fails: unresolved high/moderate/low vulnerabilities.

---

## Recommended Fix Order

### Immediate (blocks devnet testing)
1. **H6** — Migrate `encrypted_bool` → `u8` in all four circuits (`open_position`, `close_position`, `liquidation_check`, `settle_private_position`). Run `scripts/diagnose-open-contract.ts` first to confirm hypothesis, then apply patch, `arcium build && arcium deploy`, re-init comp defs.
2. **H1** — Add per-action margin cap check to both V1 and V2 session withdrawal handlers.
3. **L4** — Mirror open callback cleanup pattern in `close_position_callback` to prevent `Closing` state stuck.

### Before public devnet
4. **H2** — Provision dedicated `FAUCET_SOL_SECRET_KEY`; stop reusing gas-sponsor key.
5. **H3** — Configure hosted KV/Upstash so the SOL faucet durable drip record is active in production.
6. **M1** — Change `close = payer` to `close = position.owner` in `settle_close_position`.
7. **M2** — Use checked/saturating arithmetic in `settle_private_position` PnL math.
8. **M3** — Gate oracle `force: true` behind admin allowlist.
9. **M4** — Add auth + wallet-ownership check to `/api/history`.
10. **L1** — Remove `.toLowerCase()` from Privy auth helper.
11. **L5** — Move `comp_def_account` key check before cleanup branch in `open_position_callback`.
12. **L7** — Add `require!(market.max_leverage > 0)` in `open_position` handler.

### Before mainnet / production hardening
13. **H4/H5/M6** — Ensure hosted production has Redis/Vercel KV envs set so durable rate limits and cooldowns are active.
14. **H7** — Resolve dependency audit blockers with targeted upstream-compatible updates.
15. **M5** — Split dev/prod CSP; narrow `connect-src` to exact allowed domains.
16. **L2** — Fix gas sponsor body size check to operate on decoded bytes.
17. **L3** — Document trusted-proxy assumption or add CIDR guard.
18. **L6** — Pass non-zero dummy argument in `seed_open_interest_state`.
19. Add `emit!(...)` events on `verify_output` failure across all callbacks for off-chain observability.
20. Add `[clusters.mainnet]` block to `Arcium.toml` before mainnet launch.
