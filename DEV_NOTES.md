# ShadowPerp Developer Notes

Internal handoff notes for the next engineer. Do not publish secrets.

## Last Updated

- 2026-04-29 UTC

## Live Baseline

- Active devnet program: `34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo`
- Active market: `uGdPR4kmFWR3HwJ8esEjbeMwnuBKVD7oA9ENRv32uvy`
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
- Updated faucet availability/top-up tracking to use the connected wallet's mUSDC token account instead of the Shadow margin account.
- Bound Privy Solana wallet signing methods through their wallet object context before adapting them to Anchor shape.
  - This prevents embedded-wallet signing from dropping its internal public key during collateral deposits.

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

### Working-tree audit addendum

- Added the 2026-04-29 working-tree findings into `CODEBASE_AUDIT_REPORT.md`.
- Current dirty tree is not release/build clean.
- Main new findings:
  - partial `check_liquidation_v2` Arcium migration is missing generated artifacts, especially `build/check_liquidation_v2.idarc`
  - runtime/config namespace is split between live `ESyr...` and new `34ws...`
  - frontend IDL has a new address but stale liquidation instruction shapes
  - liquidation math changed materially and needs deterministic fixtures before deploy

### Post-push audit after `34ws...` program-ID commit

- Latest pushed commits observed locally:
  - `b640354` migrated liquidation wiring to `check_liquidation_v2`
  - `9bc26a8` updated selected runtime files to program `34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo`
- Audit result: the repo is still internally split.
  - `Anchor.toml`, `programs/shadowperp/src/lib.rs`, app IDL address, wallet popup, and oracle-refresh default now point at `34ws...`
  - `Arcium.toml`, live notes, and many ops scripts still default to `ESyr...`
  - the prior default market `crEV...` is still owned by `ESyr...`, not `34ws...`
  - the confirmed `34ws...` SOL market is `uGdPR4kmFWR3HwJ8esEjbeMwnuBKVD7oA9ENRv32uvy`

### Arcium artifact + namespace repair pass

- Applied the Arcium and Arcium program-development workflows to the dirty tree.
- Standardized runtime/script defaults that still pointed at the old `crEV...` SOL market onto the confirmed `34ws...` SOL market:
  - `uGdPR4kmFWR3HwJ8esEjbeMwnuBKVD7oA9ENRv32uvy`
- Patched `scripts/wsl-arcium-build.sh` so `arcium build --skip-program` can run in WSL without incorrectly requiring Anchor/Solana SBF tooling.
  - uses native Cargo from `$HOME/.cargo/bin`
  - keeps missing Anchor/SBF as warnings for this Arcis-only build path
- Regenerated the full `check_liquidation_v2` Arcium artifact set, including the previously missing:
  - `build/check_liquidation_v2.idarc`

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
- 2026-04-25 UTC: embedded wallet deposit + faucet tracking verification:
  - `npm run oracle:once` refreshed stale oracle successfully.
  - `npm run check:preflight` -> PASS.
  - `cd app && .\node_modules\.bin\tsc.cmd --noEmit` -> PASS.
  - `cd app && npm run lint -- --quiet` -> PASS.
- 2026-04-29 UTC: working-tree audit verification:
  - `git diff --check` -> PASS, with line-ending warnings only.
  - `cargo check -p shadowperp` -> FAIL because `check_liquidation_v2.idarc` and generated Arcium symbols are missing.
  - `cd app && .\node_modules\.bin\tsc.cmd --noEmit` -> PASS.
  - `npm run check:preflight` -> FAIL while querying the old `ESyr...` account path with `TypeError: fetch failed`.
  - root `npm audit --omit=dev --json` -> FAIL: 15 prod vulnerabilities, 7 high, 0 critical.
  - app `npm audit --omit=dev --json` -> FAIL: 45 prod vulnerabilities, 3 high, 0 critical.
- 2026-04-29 UTC: post-push audit verification:
  - `npm run oracle:once` -> PASS against the old `ESyr...` market, but only via guarded single-source fallback and RPC retries.
  - `npm run check:preflight` -> PASS against the old `ESyr...` program after oracle refresh.
  - `SHADOWPERP_PROGRAM_ID=34ws... npm run check:preflight` -> FAIL because the active market owner is still `ESyr...`.
  - `cargo check -p shadowperp` -> FAIL because `build/check_liquidation_v2.idarc` and generated Arcium symbols are missing.
  - `cd app && .\node_modules\.bin\tsc.cmd --noEmit` -> PASS.
  - `cd app && npm run lint -- --quiet` -> PASS.
  - `git diff --check` -> PASS, with line-ending warnings only.
  - root `npm audit --omit=dev --json` -> FAIL: 15 prod vulnerabilities, 7 high, 0 critical.
  - app `npm audit --omit=dev --json` -> FAIL: 45 prod vulnerabilities, 3 high, 0 critical.
- 2026-04-29 UTC: Arcium artifact + namespace repair verification:
  - `wsl bash scripts/wsl-arcium-build.sh` -> PASS and regenerated `check_liquidation_v2` artifacts.
  - `cargo check -p shadowperp` -> PASS with warnings only.
  - `npm run oracle:once` -> PASS against program `34ws...` and market `uGd...`.
    - Latest refresh published `$84.9100`.
    - Latest transaction: `3FgUXmohPR6f1hA2YMSk76kkM23jnXWipS9Y2ZSX1iw2ebtaWjGmDzfQNiByoJP2Zs5eHR9umXDH3CEi2p7VoPqZ`.
    - Used guarded single-source fallback because Binance/Coinbase/Kraken DNS lookups failed and only CoinGecko responded.
  - `npm run check:preflight` -> PASS against program `34ws...` and market `uGd...`.
    - Default RPC had transient `fetch failed` retries after the refresh.
    - `SOLANA_RPC_URL=https://api.devnet.solana.com npm run check:preflight` -> PASS.
  - `cd app && .\node_modules\.bin\tsc.cmd --noEmit` -> PASS.
  - `cd app && npm run lint -- --quiet` -> PASS.
  - `git diff --check` -> PASS, with line-ending warnings only.
- 2026-04-29 UTC: deep audit verification after latest push:
  - `git status --short --branch` -> clean on `master...origin/master`.
  - Active runtime/config was checked against program `34wszdEvGvyAVADY7ozpbdAvAB9zHRBTaT1YsNcpRJdo` and market `uGdPR4kmFWR3HwJ8esEjbeMwnuBKVD7oA9ENRv32uvy`.
  - `SOLANA_RPC_URL=https://api.devnet.solana.com npm run check:preflight` -> PASS.
    - Program, market, comp-def pointers, owners, and finalized Arcium defs all passed.
    - Oracle was still fresh but close to the limit: about `280s / 300s`.
  - `npm run check:oracle` -> PASS, also near the freshness limit at about `279s / 300s`.
  - `cargo check -p shadowperp` -> PASS with warnings only.
  - `cd app && .\node_modules\.bin\tsc.cmd --noEmit` -> PASS.
  - `cd app && npm run lint -- --quiet` -> PASS.
  - `npm run check:release-hygiene -- --strict` -> PASS.
  - `git diff --check` -> PASS.
  - `cd app && npm run build` -> timed out locally after about 240s; no compile/type error appeared before timeout.
  - Root `npm audit --omit=dev --json` -> FAIL: 15 prod vulnerabilities, 7 high, 0 critical.
  - App `npm audit --omit=dev --json` -> FAIL: 45 prod vulnerabilities, 3 high, 0 critical.
- 2026-04-29 UTC: audit fix implementation pass:
  - Removed the fake successful oracle-refresh throttle response so `/api/oracle-refresh` no longer returns `success: true` with `price: 0` / `ageSeconds: 0`.
  - Faucet modal availability now gates only on the connected wallet mUSDC balance, not wallet + margin balance.
  - Public mutation/signer routes now call async rate limiting with optional durable Redis/KV REST support:
    - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
    - or `KV_REST_API_URL` + `KV_REST_API_TOKEN`
  - mUSDC faucet cooldowns and SOL drip claim records also use the same durable store when configured, with local memory fallback for dev.
  - CSP was tightened safely by narrowing Shadow frame sources to known Privy custom domains and adding `base-uri 'self'`, `object-src 'none'`, and `form-action 'self'`.
  - Corrected stale Arcium open-position comments from encrypted `bool` direction to encrypted `u8`.
  - Removed the unused Rust `market` binding from `deposit_collateral`.
  - App dependency hardening: pinned `postcss` to `8.5.10` and reverted bad `lodash` / `lodash-es` override pins to stable releases.
  - Verification:
    - forced public-RPC oracle refresh -> PASS, latest tx `wzNq9NtoQ2a5LiSLavpMV7oy7eUdui8xN1SnAzrYEp9UZ7iUmxVsTNG2UT11LSDB3QxjNFmoAE4ryEQ4t2PzdHi`
    - `SOLANA_RPC_URL=https://api.devnet.solana.com npm run check:preflight` -> PASS, oracle age `8s`
    - `npm run check:oracle` -> PASS, oracle age `26s`
    - `cargo check -p shadowperp` -> PASS with warnings only
    - `cd app && .\node_modules\.bin\tsc.cmd --noEmit` -> PASS
    - `cd app && npm run lint -- --quiet` -> PASS
    - `cd app && npm run build` -> PASS
    - `git diff --check` -> PASS, line-ending warnings only
  - `npm run check:release-hygiene -- --strict` currently fails only because the audit-fix working tree is intentionally dirty.
  - App prod audit improved from 45 to 43 vulnerabilities after safe dependency pins; remaining dependency findings require upstream Solana/Privy SDK migrations, not blind `npm audit fix`.

### Faucet refill threshold adjustment

- Lowered the wallet mUSDC faucet refill prompt threshold from `2,000` to `500`.
- Updated the low-balance gate copy to describe wallet mUSDC, not margin collateral.
- The faucet rule remains wallet-balance based; margin account balances are not used for refill availability.
- Verification:
  - `npm run oracle:once` -> PASS after preflight found a stale oracle.
  - `npm run check:preflight` -> PASS after refresh, oracle age `8s`.
  - `cd app && .\node_modules\.bin\tsc.cmd --noEmit` -> PASS.
  - `cd app && npm run lint -- --quiet` -> PASS.

### Mobile chart and landing header polish

- Reworked mobile terminal tabs from `Chart / Order Book` to `Chart / Trade`.
- Mobile `Chart` now stacks the TradingView chart and order book together for a CEX-style market-analysis view.
- Mobile `Trade` now isolates the order-entry panel instead of always showing it under the chart.
- TradingView mobile no longer hides top/side analysis toolbars, so timeframe and drawing tools are available.
- Tightened the landing-page mobile nav so the theme toggle sits cleanly beside `Launch App`.
- Verification:
  - `npm run oracle:once` -> PASS after stale oracle preflight.
  - `npm run check:preflight` -> PASS after refresh, oracle age `18s`.
  - `cd app && .\node_modules\.bin\tsc.cmd --noEmit` -> PASS.
  - `cd app && npm run lint -- --quiet` -> PASS.
  - Playwright mobile screenshots captured for `/app` and `/`.

### Public docs and README tone pass

- Rewrote `README.md` into a calmer product and operator guide.
- Removed the old public status section that emphasized unresolved devnet work.
- Updated `app/src/pages/docs.tsx` to describe ShadowPerp as a devnet trading workspace without highlighting active blockers.
- Kept devnet and test-fund safety language, but made the tone more human and product-facing.
- Avoided hyphen-led README bullets in the rewritten sections.
- Verification:
  - `npm run oracle:once` -> PASS after stale oracle preflight.
  - `npm run check:preflight` -> PASS after refresh, oracle age `15s`.
  - `cd app && .\node_modules\.bin\tsc.cmd --noEmit` -> PASS.
  - `cd app && npm run lint -- --quiet` -> PASS.

## Current Blocker

### 0. Live open/close smoke still needed

- The local build/preflight state is stable on `34ws...` + `uGd...`.
- Do not claim "fully live" until an end-to-end browser or script smoke verifies:
  - open position
  - callback finalization
  - close/settle path

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
- Latest hosted open-position screenshot showed:
  - `Unable to refresh market oracle before opening position. Oracle feeder keypair is not configured.`
  - This is an operational env blocker for hosted stale-oracle refresh, not a wallet or Arcium callback failure.

### 3. Audit release blockers

- Public server signer endpoints are now auth-gated, wallet/market-scoped, and rate-limited in-memory.
- Remaining production hardening: move signer-route rate limits/cooldowns to a durable store if these routes remain public.
- Resolve targeted dependency audit issues; do not run blind `npm audit fix`.
- Correct product copy/docs around privacy boundaries and social-login availability when new copy lands.
- CSP still permits broad inline/eval compatibility allowances for TradingView/Privy; keep this as an explicit production hardening item.

## Next Safe Step

1. Browser-retest faucet claim flow.
   - confirm the modal no longer fails on a bad RPC key
   - confirm the response-shape mismatch is gone
2. Run a devnet-safe open-position smoke on `34ws...` + `uGd...`.
3. Build and deploy the new Arcium diagnostic lane if the current open-position callback still aborts.
4. Initialize `open_position_tuple_probe_u8_v1` comp-def on devnet.
5. Run `scripts/diagnose-open-contract.ts`.
6. Compare results:
   - if old tuple aborts and `tuple-u8` passes, migrate the live shared tuple away from encrypted `bool`
   - if both abort, keep digging below the tuple-type layer
7. Replace in-memory signer-route limits with durable rate limits before any production release claim.
8. Resolve remaining dependency audit blockers via safe upstream-compatible updates.

## Notes

- Do not claim the live open-position bug is fixed yet.
- Current verified namespace is `34ws...` + `uGd...`; do not reintroduce stale `ESyr...` runtime defaults unless intentionally rolling back.
- Landing/app polish in progress:
  - added a moving top-pumps strip under the market panel
  - removed landing header nav links and GitHub footer links
  - added a first-visit cookies/terms modal backed by local storage
  - kept a single centered landing badge labeled `Built on Arcium`
  - reverted the broader write-up sweep so only the requested badge wording changed
- Verification for this pass:
  - `cd app && tsc --noEmit`
  - `cd app && npm run lint -- --quiet`
- Arcium cluster check:
  - repo/runtime cluster offset is `456`
  - live cluster `DzaQ...br95` has 2 active nodes
  - init-comp-defs builds at least 4 recovery peer entries by cycling active node offsets
  - no repo config currently exposes a separate `--recovery-set-size 4` flag
  - preflight remains blocked only by stale oracle; `oracle:once` failed because price sources timed out
- Top movers layout update:
  - renamed the strip from `Top pumps` to `Top movers`
  - separated the strip from the Market Info panel in the desktop draggable grid
  - bumped the desktop layout storage key to avoid old saved layouts placing the strip over chart/orderbook panels
  - kept the mobile strip in normal document flow below Market Info
  - reduced the default Top Movers panel height by 50%
  - removed mobile-only 24H Change and 24H Volume cards from Market Info
  - squared the mobile chart, orderbook, and trade panel shells to match desktop panel edges
