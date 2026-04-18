# ShadowPerp Developer Notes

Internal handoff notes for the next engineer. Do not publish secrets.

## Last Updated

## Safe Audit Fixes (2026-04-18 UTC)

### What changed

- Removed the frontend wallet auto-provision side effect from the connect button path:
  - `app/src/pages/app.tsx`
  - Shadow now relies on Privy's configured wallet provisioning instead of opportunistically calling `createWallet()` during login state changes.
- Hardened relay runtime key resolution to fail closed in production when no explicit relayer key is configured:
  - `app/src/lib/server/relay-client.ts`
  - local/dev can still fall back to `~/.config/solana/id.json`, but production no longer should
- Standardized the frontend package-manager path around npm:
  - `app/package.json`
  - removed `app/pnpm-lock.yaml`
  - refreshed `app/package-lock.json`
  - updated install/run guidance in `README.md`
  - updated the deploy script next-step message in `scripts/deploy-devnet.ts`
- Added a real frontend ESLint configuration so lint no longer opens the interactive Next.js setup prompt:
  - `app/.eslintrc.json`
  - `app/package.json`
- Patched browser crypto buffer typing in encrypted local persistence utilities:
  - `app/src/lib/trade-automation.ts`
- Updated relay env documentation:
  - `app/.env.example`

### What was verified

- `cd app && npm install --legacy-peer-deps` -> PASS
  - kept the app on the current Privy SDK line while refreshing the lockfile and adding ESLint dependencies
- `cd app && npx tsc --noEmit` -> PASS
- `cd app && npm run lint` -> PASS with warnings only
  - current warnings are existing React hook dependency warnings in:
    - `BottomPositionsPanel.tsx`
    - `OrderConfirmModal.tsx`
    - `PrivateOrderbook.tsx`
    - `TradingPanel.tsx`
    - `WalletPopup.tsx`
    - `useMarketSnapshot.ts`
    - `app.tsx`

### Current blocker

- Root `npm run check:preflight` is not green from this shell because the current local environment is missing:
  - `NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID`
- That is an env/runtime configuration gap, not a compile failure in the code changes above.

### Next safe step

1. Restore the required devnet env values locally and rerun:
   - `npm run check:preflight`
2. Optionally clean up the remaining React hook warnings now that lint is wired and stable.
3. Commit the audit-fix batch once preflight is revalidated or the missing env is intentionally accepted.

## Privy Custom-Domain Wallet Proxy Fix (2026-04-18 UTC)

### What changed

- Patched the frontend CSP in `app/next.config.js` to allow a configured custom Privy auth domain in `frame-src`.
- Added explicit support for a hosted Privy API/auth domain in the frontend:
  - `app/src/pages/_app.tsx`
  - `app/.env.example`
  - `README.md`
- Added `NEXT_PUBLIC_PRIVY_API_URL` as the deploy-time knob for the custom Privy domain (for example `https://privy.www.shadowperpdex.xyz`).
- Wired `PrivyProvider` to use that custom domain via `apiUrl` when configured.

### What was verified

- Root preflight baseline:
  - `npm run check:preflight` initially failed only on stale oracle freshness
  - `npm run oracle:once` refreshed oracle successfully
  - `npm run check:preflight` then passed
- Frontend static validation:
  - `cd app && npx tsc --noEmit` -> PASS
- Confirmed the prior hosted failure has a concrete code-side cause:
  - browser traces referenced `https://privy.www.shadowperpdex.xyz`
  - repo CSP only allowed `https://auth.privy.io` and `https://*.privy.io`
  - that would block the custom hosted Privy iframe / wallet proxy path

### Current blocker

- The code-side CSP / API-domain gap is patched locally, but hosted production will not benefit until:
  - `NEXT_PUBLIC_PRIVY_API_URL` is set in the deployed environment
  - the frontend is redeployed
- Dashboard-side alignment may still be required after deploy:
  - wallet login enabled
  - email login enabled
  - unwanted social methods disabled
  - HttpOnly cookie domain fully verified/healthy in Privy

### Next safe step

1. Set hosted env:
   - `NEXT_PUBLIC_PRIVY_API_URL=https://privy.www.shadowperpdex.xyz`
2. Redeploy the frontend.
3. Re-smoke hosted auth on `https://www.shadowperpdex.xyz/app` for:
   - `Sign in` opens modal
   - email completes and app shows connected embedded Solana wallet
   - external Solana wallet path is visible in modal
   - connected market-panel behavior unlocks after login
4. If wallet buttons are still absent after redeploy, treat that as a Privy dashboard login-method / wallet-surface mismatch rather than a CSP issue.

## Privy Email Login Failure Trace (2026-04-18 UTC)

### What changed

- Patched the local frontend login flow away from `connectOrCreateWallet()` toward Privy's normal login modal for Solana-targeted auth:
  - `app/src/pages/_app.tsx`
  - `app/src/pages/app.tsx`
- Aligned local provider config toward `wallet + email` and explicit Solana wallet surfacing.
- Ran a hosted smoke on `https://www.shadowperpdex.xyz/app` using a real email login flow.

### What was verified

- Hosted `Sign in` opens the Privy modal successfully.
- Hosted email path accepts an email address and sends a confirmation code.
- Hosted code entry succeeds and advances to the terms-acceptance screen.
- After accepting terms, Privy does **not** complete the wallet/app handoff cleanly.
- The hosted modal ends in:
  - `Something went wrong`
  - `walletProxy does not exist.`
- The app remains visually disconnected after this failure:
  - header button still shows `Sign in`
  - market panel still shows disconnected-state behavior
  - bottom panel still says `Connect wallet to view positions`
- Local static validation after the code patch:
  - `npx tsc --noEmit` in `app/` -> PASS
- `next lint` could not run because this repo does not yet have ESLint configured and Next opened the interactive setup prompt.

### Current blocker

- The root hosted failure is no longer "email submit does nothing".
- The concrete hosted blocker is now Privy's wallet provisioning / wallet proxy handoff after successful email authentication:
  - `walletProxy does not exist`
- This means auth begins and completes far enough to verify the code and accept terms, but the downstream embedded-wallet bridge fails before the app can observe a usable connected wallet.
- Hosted production is also still out of alignment with the intended product surface:
  - Google is still visible in the live modal
  - the wallet-first Solana UX is not visibly matching the patched local config

### Next safe step

1. Verify the hosted deployment actually contains the latest frontend patch:
   - one-button flow uses `login()` instead of `connectOrCreateWallet()`
   - local config change is deployed
2. In the Privy dashboard, confirm production auth methods match intended behavior:
   - wallet enabled
   - email enabled
   - Google disabled if no longer desired
3. Inspect Privy's hosted embedded-wallet / custom-domain setup for the app:
   - the hosted failure now points at missing `walletProxy`
   - prior browser traces also showed custom-domain analytics / proxy irregularities on the Privy domain
4. Re-smoke both paths after dashboard + deploy alignment:
   - email -> embedded wallet creation -> connected app state
   - external Solana wallet -> connected app state

## Privy Hosted Smoke Check (2026-04-18 UTC)

### What changed

- No product code changed in this pass.
- Ran a hosted browser smoke against `https://www.shadowperpdex.xyz/app` focused on the live Privy sign-in surface and canonical-host behavior.

### What was verified

- Apex host redirect is working:
  - `https://shadowperpdex.xyz/app` -> `308` to `https://www.shadowperpdex.xyz/app`
- Hosted app loads successfully on `www` and renders the disconnected trading shell.
- Clicking the `Sign in` button opens the Privy modal successfully.
- Email login progressed through the passwordless init step:
  - submitting a reserved-domain test address advanced the modal to the 6-digit confirmation-code entry screen
- The live modal currently exposes:
  - email entry
  - Google login
- Browser console still reports a Privy custom-domain analytics failure:
  - `https://privy.www.shadowperpdex.xyz/api/v1/analytics_events`
  - browser observed CORS failure from `https://www.shadowperpdex.xyz`

### Current blocker

- Hosted production is still not behaving like the intended `wallet + email only` configuration:
  - the live Privy modal is still surfacing Google
  - the wallet login path is not visibly available in the hosted modal smoke that was run
- This means the remaining risk is operational / dashboard-side, not clearly a repo-side frontend bug:
  - Privy login methods exposed in the dashboard do not yet match the intended product surface
  - the custom Privy domain / cookie-domain setup is still suspicious because browser-side analytics on `privy.www.shadowperpdex.xyz` are failing

### Next safe step

1. In the Privy dashboard, verify the live app only exposes the intended login methods for production.
2. Confirm whether Google should be removed entirely; if yes, align both:
   - Privy dashboard auth methods
   - `app/src/pages/_app.tsx`
3. Verify the custom Privy domain / cookie-domain setup for `privy.www.shadowperpdex.xyz` is fully healthy before treating hosted auth as done.
4. Re-run the hosted smoke specifically for:
   - visible external Solana wallet option in the modal
   - successful connected-state update after wallet login
   - market-panel unlock after connection

## Arcium Circuit Integrity Pass (2026-04-18 UTC)

### What changed

- Repaired the confidential close/liquidation math to match the live frontend encoding contract:
  - `encrypted-ixs/src/close_position.rs`
  - `encrypted-ixs/src/liquidation_check.rs`
  - `encrypted-ixs/src/settle_private_position.rs`
- The fixed unit model now treats:
  - size as base units scaled to `1e9`
  - price and margin as quote-token units scaled to `1e6`
- Removed incorrect leverage reapplication and entry-price normalization from the close/liquidation/settlement circuits.
- Restored correct short-direction handling in the confidential close/liquidation paths.
- Removed unsafe market-state / comp-def bookkeeping that did not belong in live market account storage:
  - `programs/shadowperp/src/handlers/seed_open_interest_state.rs`
  - `programs/shadowperp/src/handlers/init_comp_defs.rs`
  - `programs/shadowperp/src/handlers/callbacks/settle_private_position_callback.rs`
- Kept the live `Market` layout backward-compatible instead of introducing a risky account-size migration path.

### What was verified

- `git status --short` reviewed at session start
- `npm run check:preflight` -> initially FAIL only on stale oracle freshness
- `npm run oracle:once` -> PASS on 2026-04-18
- `npm run check:preflight` -> PASS after oracle refresh
- `wsl bash -lc "cd /mnt/c/Users/bolaj/projects/shadowperp && ./scripts/wsl-arcium-build.sh"` -> PASS
  - generated fresh `build/*.arcis` artifacts for the confidential instructions
- `wsl bash -lc "cd /mnt/c/Users/bolaj/projects/shadowperp && cargo check -p shadowperp"` -> PASS
  - Anchor program compiles successfully against the generated Arcium artifacts

### Current blocker

- The local Arcium/program verification is green, but the patched confidential instruction artifacts have not yet been rolled forward on-chain in this pass.
- That means devnet comp-defs may still point at the previous circuit behavior until the upload / comp-def refresh flow is run intentionally.
- Browser/devnet smoke is still needed after any comp-def refresh for:
  - open position
  - close position
  - liquidation path sanity

### Next safe step

1. Upload the refreshed confidential artifacts and rotate the affected comp-defs on devnet intentionally:
   - `close_position_v2`
   - `check_liquidation`
   - `settle_private_position` if the shielded settlement lane is active in the target environment
2. Run a devnet smoke that proves the patched math through the real callback path.
3. Commit the Arcium integrity fixes together with the updated operational notes once the deploy decision is confirmed.

## Audit Truthfulness + Docs Alignment (2026-04-17 UTC)

### What changed

- Fixed the live trade path to stop using `mockPrice` as an execution-facing fallback:
  - `app/src/components/TradingPanel.tsx`
  - market orders now block when no trusted price is available
  - the trade confirmation modal now handles missing prices explicitly instead of substituting mock pair pricing
- Fixed position-history truthfulness:
  - `app/src/lib/server/history.ts`
  - `app/src/lib/history.ts`
  - `app/src/components/BottomPositionsPanel.tsx`
  - history now carries an explicit notice that the current data is reconstructed from closed/liquidated account scans and is not a durable trade ledger yet
- Reduced stale live relay/frontend surface:
  - removed the unused relay URL helper from `app/src/lib/feature-flags.ts`
- Tightened app dependency posture in `app/package.json` and refreshed `app/pnpm-lock.yaml`
  - removed unused wallet-adapter packages from direct dependencies
  - added safer overrides for current transitive advisory hotspots where possible
- Updated repo and product docs to match the live product state:
  - `README.md`
  - `ARCHITECTURE.md`
  - `DATA_FLOW.md`
  - `PERP_UI_SYSTEM.md`
  - `app/src/pages/docs.tsx`
  - `app/src/pages/index.tsx`

### What was verified

- `pnpm --dir app install` -> PASS
- `pnpm --dir app exec tsc --noEmit` -> PASS
- `pnpm --dir app audit --prod` -> reduced to 4 visible advisories:
  - `bigint-buffer` via `@solana/spl-token`
  - `yaml` via Privy/react-native transitives
  - low `web3-core-subscriptions`
  - low `elliptic`
- `pnpm --dir app build`
  - compiles successfully
  - generates static pages successfully
  - reaches `Collecting build traces ...`
  - then stalls on this machine instead of exiting cleanly

### Current blocker

- The repo is now more truthful about pricing and history behavior, but two follow-ups remain:
  - browser smoke is still needed for the live Privy wallet/email flows after these changes
  - Next production build appears to hang at trace collection in this local environment even though compile/static generation complete

### Next safe step

1. Run a browser smoke on the hosted app for:
   - email login
   - external Solana wallet connection through Privy
   - collateral deposit
   - market-order blocked state when no trusted price exists
   - position-history notice rendering
2. Investigate the local `next build` stall at `Collecting build traces ...` if a clean local production build is required before shipping.
3. Commit and push this audit-fix + docs-alignment batch once the smoke pass is complete or explicitly accepted.

## Privy Wallet State Cleanup + Sponsor Auth Guard (2026-04-17 UTC)

### What changed

- Hardened the server-sponsored Solana fee-payer path:
  - added `app/src/lib/server/privy-auth.ts`
  - added authenticated token verification to `app/src/pages/api/sponsor-solana.ts`
  - sponsor requests now require a Privy bearer token and verify the transaction signers belong to the authenticated user's linked Solana wallets
  - wired browser-side access-token bridging in `app/src/pages/_app.tsx`
  - wired sponsor auth header support in `app/src/lib/client.ts`
- Added canonical-host middleware in `app/middleware.ts` so hosted production can force one Privy-approved origin (`www.shadowperpdex.xyz`) instead of splitting auth across apex and `www`.
- Tightened the live Privy wallet config in `app/src/pages/_app.tsx`:
  - kept only `wallet` and `email`
  - changed embedded wallet creation from `all-users` to `users-without-wallets`
  - added top-level `walletConnectCloudProjectId` support from `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- Cleaned wallet-state duplication:
  - `app/src/components/WalletPopup.tsx` now trusts the shared `useWalletConnectionState()` hook instead of recomputing embedded-wallet connectivity separately
  - removed the dangling no-op `useAnchorWalletCompat()` call in `app/src/pages/app.tsx`
- Removed dead Privy/wallet-adapter glue:
  - deleted `app/src/lib/privy.tsx`
  - deleted `app/src/types/wallet-adapter-wallets.d.ts`
- Fixed landing copy in `app/src/pages/index.tsx` so it no longer claims social login is active when the app currently exposes wallet + email only.
- Updated `app/.env.example` for the live hosted auth/runtime path:
  - `PRIVY_APP_ID`
  - `PRIVY_APP_SECRET`
  - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
  - `NEXT_PUBLIC_CANONICAL_HOST`

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- `npm run check:preflight` -> initially FAIL only on stale oracle freshness
- `npm run oracle:once` -> PASS on 2026-04-17 with guarded single-source publish
- `npm run check:preflight` -> PASS after oracle refresh
- Confirmed the installed Privy SDK (`@privy-io/react-auth@1.99.1`) accepts `walletConnectCloudProjectId` as a top-level `PrivyProvider` config field, not inside `toSolanaWalletConnectors(...)`

### Current blocker

- Hosted login still depends on Privy dashboard / deployment config outside the repo:
  - local shell env does not currently have `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, or `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` set
  - the Privy dashboard screenshot shows `www.shadowperpdex.xyz` app-domain cookie setup is still `Pending`
- If wallet or email login still fails in production after redeploy, check hosted Privy settings first before changing app code again:
  - allowed origins
  - email/passwordless enablement
  - app secret on the backend host
  - canonical host / cookie domain completion

### Next safe step

1. Set hosted env vars on the active deployment targets:
   - Vercel: `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_CANONICAL_HOST=www.shadowperpdex.xyz`
   - backend host: `PRIVY_APP_ID`, `PRIVY_APP_SECRET`
2. Redeploy the frontend so the new Privy config and middleware ship together.
3. Re-test:
   - `Sign in` opens the Privy modal
   - email creates or reuses the embedded Solana wallet
   - external wallet login updates the header and market-panel connected state
4. If email still errors with 403 from Privy, finish the pending Privy cookie-domain verification and re-check the dashboard auth toggles before editing code.

## Privy Email-Only Login Tightening (2026-04-17 UTC)

### What changed

- Tightened Privy login options in `app/src/pages/_app.tsx`:
  - removed `google`
  - removed `twitter`
  - kept only `wallet` and `email`
- Switched the terminal connect CTA in `app/src/pages/app.tsx` away from the plain `login()` helper and back to Privy's unified `connectOrCreateWallet()` flow so one button can open wallet-or-email sign-in without tripping the "already logged in, use link" path.
- Hardened wallet detection in `app/src/lib/use-anchor-wallet.ts`:
  - now prefers Privy's `useActiveWallet()` before falling back to wallet lists
  - this should let a successful Privy connection immediately surface as a connected Solana wallet inside Shadow instead of waiting on secondary wallet list state

### What was verified

- `npm run check:preflight` -> FAIL only on stale oracle freshness at start of session
- `npm run oracle:once` -> PASS with guarded single-source publish on 2026-04-17
- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS after the Privy auth changes

### Current blocker

- Needs fresh browser verification on the deployed app:
  - wallet connect should now show as connected in the header and unlock market-panel actions
  - Privy modal should now offer wallet + email only
- Remaining noisy console logs from extensions, TradingView telemetry/adblock, and injected `window.ethereum` collisions still need to be treated separately from actual Shadow auth state

### Next safe step

1. Redeploy and test the Sign in button on the hosted site.
2. Verify the modal only shows wallet and email.
3. Verify a successful wallet or email flow updates the header into a connected state and enables the market-panel actions.
4. If email still fails, inspect Allowed Origins / Privy dashboard settings next before changing app code again.

## Privy Hosted Config Guard (2026-04-16 UTC)

### What changed

- Hardened the Privy boot path in `app/src/pages/_app.tsx`:
  - removed the hardcoded fallback Privy app ID
  - added a visible hosted-config guard when `NEXT_PUBLIC_PRIVY_APP_ID` is missing
- Hardened the relay-base runtime in `app/src/lib/feature-flags.ts`:
  - hosted deployments are now expected to set `NEXT_PUBLIC_RELAY_URL`
  - same-origin relay fallback is now treated as localhost-only behavior
  - hosted origins without a relay base now emit a visible console warning instead of silently behaving like the legacy Next API layout
- Updated `app/.env.example` to mark `NEXT_PUBLIC_PRIVY_APP_ID` as required for hosted deployments now that email/social sign-in is part of the intended product path.
 - Updated `app/.env.example` to mark `NEXT_PUBLIC_RELAY_URL` as required for hosted relay deployments.

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS after the hosted config guards
- Vercel project `shadow` now has hosted env values set for:
  - `NEXT_PUBLIC_PRIVY_APP_ID`
  - `NEXT_PUBLIC_RELAY_URL`
  - the active Solana/Arcium devnet runtime vars used by the current stack

### Current blocker

- Hosted login can no longer silently attach to the wrong Privy tenant.
- The real `NEXT_PUBLIC_PRIVY_APP_ID` is now set in the active Vercel project.
- Hosted relay calls now point more explicitly at the Railway split and no longer rely on the old same-origin assumption in product code.

### Next safe step

1. Redeploy the active `shadow` Vercel project so the updated hosted env values are picked up by a fresh build.
2. Confirm email/social login creates or reuses the embedded Solana wallet as expected.
3. Confirm the app is reaching the Railway relay at `https://shadow-production-366b.up.railway.app`.

## Deep Repo Audit (2026-04-16 UTC)

### What changed

- No product code changed in this pass.
- Ran a fresh repo-wide audit across Arcium wiring, relay/runtime boundaries, frontend state flow, dependency posture, and deployment/config drift after the hosting move.
- Recorded the highest-signal gaps for the next engineer:
  - frontend relay fallback still assumes same-origin `/api/relay/*` routes even though active relay handling now lives in the standalone `relay/` service
  - delegated withdraw relay validation still applies `max_margin_per_action` despite protocol/docs saying withdraws are exempt
  - position history remains reconstructed from current position accounts rather than a durable event-backed history source, which explains rows disappearing without a refresh
  - app boot/runtime still carries silent public fallbacks (`NEXT_PUBLIC_RELAY_URL`, `NEXT_PUBLIC_PRIVY_APP_ID`, default program IDs/RPCs) that can mask env drift after account/hosting changes
  - dependency backlog remains concentrated in wallet/Privy transitive packages even after the recent Next/Arcium alignment

### What was verified

- `git status --short` -> dirty worktree only in:
  - `app/src/components/MarketInfo.tsx`
  - `app/src/components/layout/DraggablePanel.tsx`
- `npm run check:preflight` -> FAIL on 2026-04-16:
  - oracle stale (`age=113756s`, max 300)
  - collateral mint mismatch flagged in preflight
- `npm run oracle:once` -> FAIL on 2026-04-16:
  - insufficient oracle sources (`1/2`)
  - timed out against upstream reference providers
- `pnpm --dir app audit --prod` -> 17 advisories currently visible in app dependency tree:
  - 2 critical
  - 6 high
  - 7 moderate
  - 2 low
- Reviewed:
  - `app/src/lib/feature-flags.ts`
  - `app/.env.example`
  - `relay/src/index.ts`
  - `relay/src/relay-client.ts`
  - `app/src/hooks/useArcium.ts`
  - `app/src/lib/client.ts`
  - `app/src/components/BottomPositionsPanel.tsx`
  - `app/src/lib/server/history.ts`
  - `app/src/pages/api/history.ts`
  - `app/src/pages/_app.tsx`
  - `app/src/lib/runtime.ts`
  - `ARCHITECTURE.md`
  - `DATA_FLOW.md`
  - `README.md`

### Current blocker

- Main runtime blocker remains unchanged:
  - the Arcium-backed open lane still does not finalize reliably to `Open` on the active devnet namespace
- Operational/deployment blockers are now also clear:
  - oracle freshness is currently unhealthy in the checked environment
  - relay deployment now depends on explicit standalone Railway relay env wiring after the hosting/account move
  - Privy is now part of the intended email/social sign-in path, so stale fallback app IDs are no longer a harmless convenience default
  - docs/handoff still reference removed `app/src/pages/api/relay/*` paths in multiple places

### Next safe step

1. Fix relay-base deployment assumptions:
   - require and verify `NEXT_PUBLIC_RELAY_URL` anywhere standalone relay is the intended path
   - remove stale same-origin relay comments/docs
2. Fix delegated withdraw validation in `relay/src/index.ts` so withdraws are exempt from `max_margin_per_action`, matching protocol/docs.
3. Rework wallet history/position history to come from a durable history source instead of current closed/liquidated account scans.
4. Clean up public runtime fallbacks that can silently point the app at the wrong tenant/program after host migration, starting with `NEXT_PUBLIC_PRIVY_APP_ID` and relay base URL expectations.
5. Triage the `pnpm audit` backlog, starting with wallet/Privy transitive packages that currently drag in vulnerable `axios`, `lodash`, `picomatch`, and related chains.

## Deep Repo Audit (2026-04-11 UTC)

### What changed

- No product code changed in this pass.
- Ran a deep repo audit across relay/API routes, dependency posture, price fallback handling, and automated test coverage.
- Recorded the highest-signal gaps for the next engineer:
  - delegated withdraw relay path currently enforces `max_margin_per_action` even though the documented protocol rule says withdraws are exempt
  - app dependency posture still carries current `pnpm audit` findings (`next@15.5.14`, transitive `axios`, `defu`, `lodash`)
  - market-data fallback can degrade to mock/cached values while the primary trading panel intentionally hides the warning channel
  - automated coverage is still concentrated in `tests/shadowperp.ts` and does not cover relay/API/browser flows

### What was verified

- `git status --short` -> only untracked `previews/`
- `npm run check:preflight` -> PASS on the active QuickNode devnet RPC
- `pnpm --dir app audit --prod --json` -> current dependency advisories confirmed locally
- Reviewed:
  - `app/src/pages/api/relay/open.ts`
  - `app/src/pages/api/relay/deposit.ts`
  - `app/src/pages/api/relay/withdraw.ts`
  - `app/src/pages/api/relay/session.ts`
  - `app/src/pages/api/prices.ts`
  - `app/src/pages/api/reference-depth.ts`
  - `app/src/lib/prices.ts`
  - `app/src/components/TradingPanel.tsx`
  - `app/src/lib/server/relay-client.ts`
  - `tests/shadowperp.ts`

### Current blocker

- Main protocol blocker is unchanged:
  - the Arcium-backed open lane still does not finalize to `Open` on the active devnet namespace
- Audit follow-ups now exist alongside that runtime blocker:
  - delegated withdraw rule mismatch in the relay route
  - dependency/security backlog in the app package
  - hidden fake/cached market-data warning path in the trading panel
  - missing browser/API integration coverage

### Next safe step

1. Fix the delegated withdraw relay cap check so it matches the documented/protocol session rule.
2. Patch the app dependency set starting with `next`, wallet-adapter transitive exposure, and stale `lodash` override.
3. Surface a visible market-data fallback warning anywhere mock/cached prices can reach the trade flow.
4. Add at least one devnet-safe relay/API smoke path and one browser flow test for open/deposit/session lookup behavior.

## Open Finalization Semantics Pass (2026-04-11 UTC)

### What changed

- Added shared open-finalization helpers to `app/src/lib/client.ts` so non-UI callers can wait for a real `Open` state instead of stopping at queue confirmation:
  - `waitForOpenPositionFinalization(...)`
  - `openPositionAndFinalize(...)`
  - `openPositionWithSessionAndFinalize(...)`
  - `openPositionWithSessionV2AndFinalize(...)`
- Ported the relayer script open flows in `scripts/session-relayer.ts` to the finalization-aware helper so `open` and `smoke` now report finalized open status instead of treating "queued" as success.
- Reused the same callback-failure diagnosis pattern already present in the browser hook so shared client callers now get clearer terminal errors when the open callback aborts on-chain.
- Fixed `scripts/session-relayer.ts` config construction to include the now-required `marketRegistry` field expected by the shared client config type.

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS after the shared-client changes
- Focused compile for the touched shared client + relayer script -> PASS:
  - `npx tsc --noEmit --target ES2020 --module commonjs --lib ES2020,DOM --esModuleInterop --resolveJsonModule --skipLibCheck app/src/lib/client.ts scripts/session-relayer.ts`

### Current blocker

- Queue/open semantics are now more honest for non-UI callers.
- Main protocol blocker remains unchanged:
  - the Arcium-backed open lane still does not finalize to `Open` on the active devnet namespace

### Next safe step

1. Run one delegated `session-relayer open` or `session-relayer smoke` check on devnet and confirm it now reports either finalized open or a callback-specific failure instead of a false-positive queue success.
2. If that looks clean, consider switching any other non-UI open callers to the new finalization-aware helper.
3. After that, the next low-risk cleanup is aligning `@arcium-hq/client` to the latest 0.9.x patch and repeating the same smoke path.

## Relay Oracle Failsafe Fix (2026-04-11 UTC)

### What changed

- Hardened `app/src/pages/api/relay/open.ts` so stale-oracle refresh during order open no longer hard-fails whenever one upstream reference source drops out.
- Replaced the relay route's hardcoded two-source-only behavior with the same guarded single-source fallback policy already used by the oracle daemon:
  - reads `ORACLE_MIN_SOURCES_REQUIRED`
  - reads `ORACLE_FAILSAFE_ALLOW_SINGLE_SOURCE`
  - reads `ORACLE_FAILSAFE_MAX_MOVE_BPS`
- Added better upstream error reporting for provider fetch failures so relay logs now distinguish HTTP/provider failures from simple `NaN` parsing.
- The relay still requires the full source threshold by default, but it can now safely refresh from one healthy source when:
  - at least one quote is valid
  - single-source failsafe is enabled
  - the refreshed price stays within the guarded move limit versus the last on-chain oracle price

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS after the relay oracle patch

### Current blocker

- The stale-market-data failure during open should now be reduced when Binance or another single reference source drops out.
- Main protocol blocker remains unchanged:
  - the Arcium-backed open lane still does not finalize to `Open` on the active devnet namespace

### Next safe step

1. Restart the app server if needed so the relay route picks up the new env-backed oracle behavior.
2. Retry an open on a previously failing pair and watch the relay logs for `reducedSourceMode` in `[relay/open:oracle]`.
3. If upstream provider instability continues, add a third reference source to the relay open path instead of relying only on CoinGecko + Binance.

## In-App Voice Alignment Pass (2026-04-11 UTC)

### What changed

- Brought the terminal copy closer to the new trader-first product voice across:
  - `app/src/components/WalletPopup.tsx`
  - `app/src/components/CollateralModal.tsx`
  - `app/src/components/TradeConfirmationModal.tsx`
  - `app/src/components/PositionsList.tsx`
  - `app/src/components/BottomPositionsPanel.tsx`
  - `app/src/components/TradingPanel.tsx`
  - `app/src/lib/server/history.ts`
- Replaced more system-facing phrases such as "protected queue", "delegated trading session", and "encrypted order queued" with calmer trader-facing wording while keeping Arcium explicit where it still adds clarity.
- Kept all execution behavior unchanged; this was a copy-and-status polish pass only.

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS after the terminal copy updates
- Mobile smoke on `/app` at `390x844` -> terminal layout still fits the updated text cleanly
- Console during the `/app` smoke showed no new product errors; remaining warnings were the existing Next dev HMR warning and Lit dev-mode warning

### Current blocker

- Product voice is now more consistent across landing, docs, and the in-app terminal.
- Main protocol blocker remains unchanged:
  - the Arcium-backed open lane still does not finalize to `Open` on the active devnet namespace

### Next safe step

1. Commit and push this in-app voice-alignment follow-up if we want the repo state published.
2. If we keep polishing UX, the next best target is the wallet-connected mobile flow for collateral/session/settings interactions.

## Public Positioning Copy Pass (2026-04-11 UTC)

### What changed

- Reframed the public-facing product copy away from builder-centric "infrastructure / rails" language and toward a trader-first private perp DEX identity in:
  - `README.md`
  - `app/src/pages/index.tsx`
  - `app/src/pages/docs.tsx`
  - `app/src/pages/app.tsx`
- Kept Arcium explicit as the privacy and confidential-compute layer behind Shadow instead of the whole product identity.
- Preserved the existing devnet caveats so the new wording does not imply the open lane is fully signed off.
- Fixed the docs page style block to use `style jsx global`, which removes a dev hydration mismatch that showed up during the mobile docs smoke pass.
- Kept the favicon fallback asset follow-up in scope:
  - `app/public/favicon.ico`

### What was verified

- `npm run check:preflight` -> PASS on the active QuickNode devnet RPC
- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS after the public copy edits
- Follow-up search confirmed the targeted "infrastructure / execution rails / wallets and bots" wording was removed from the touched public surfaces
- Mobile smoke:
  - landing page at `/` renders cleanly at `390x844`
  - docs page at `/docs` now reloads at `390x844` with `0` console errors after the hydration fix

### Current blocker

- Public positioning is now more aligned with the product direction.
- Main protocol blocker remains unchanged:
  - the Arcium-backed open lane still does not finalize to `Open` on the active devnet namespace

### Next safe step

1. Do a quick visual smoke on landing + docs if we want to tune tone further in context.
2. Commit this copy pass together with the favicon follow-up if we want one clean docs/brand push.

## Privacy Docs Truth Pass (2026-04-11 UTC)

### What changed

- Tightened the legal/privacy copy in `app/src/pages/docs.tsx` so it matches current repo behavior more precisely:
  - softened the claim that wallet addresses are never received by server-backed routes
  - softened the claim that relay payloads are never retained in any form
  - clarified that local browser persistence includes more than session info and automation rules
  - expanded the Cookie Policy table to include RPC preferences, layout state, wallet activity cache, and local position-view convenience storage
- Reviewed `README.md` for the same class of overclaim:
  - no matching privacy-policy wording needed correction there in this pass

### What was verified

- Code references for browser persistence and server-backed wallet usage were checked in:
  - `app/src/lib/runtime.ts`
  - `app/src/components/layout/SettingsPanel.tsx`
  - `app/src/components/WalletPopup.tsx`
  - `app/src/lib/trade-automation.ts`
  - `app/src/pages/api/history.ts`
  - `app/src/pages/api/relay/open.ts`

### Current blocker

- Public privacy/legal wording is now closer to the real app behavior.
- Main protocol blocker remains unchanged:
  - the Arcium-backed open lane still does not finalize to `Open` on the active devnet namespace

### Next safe step

1. Run the app typecheck after this docs pass.
2. If it passes, commit and push the privacy-docs correction as a small follow-up.

## Safe Repo Cleanup Pass (2026-04-11 UTC)

### What changed

- Reduced local repo noise without touching protocol/runtime behavior:
  - added local-only ignore coverage in `.gitignore` for:
    - `.agents/`
    - `.trae/`
    - `output/`
    - `.tmp_app_job_id`
    - `skills-lock.json`
    - `app/.logs/`
- Trimmed unused frontend dependencies from `app/package.json`:
  - removed `@noble/hashes`
  - removed `lightweight-charts`
  - removed `styled-jsx`
- Refreshed `app/pnpm-lock.yaml` through `pnpm remove` so the app lockfile matches the manifest again.

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS after the dependency cleanup
- direct code search found no live imports of:
  - `@noble/hashes`
  - `lightweight-charts`
  - `styled-jsx`
- normal `git status --short` now stays focused on tracked work instead of local agent/runtime clutter

### Current blocker

- Cleanup pass is safe and complete for the low-risk repo-hygiene layer.
- Main protocol blocker remains unchanged:
  - the Arcium-backed open lane still does not finalize to `Open` on the active devnet namespace

### Next safe step

1. If you want this cleanup published, commit it together with the current README/docs/landing truth-alignment updates.
2. Keep `.agents/` and `.trae/` ignored but not deleted; they are local tooling state, not product code.
3. If we want a second cleanup pass later, the next best target is dependency/tree simplification around the wallet-adapter stack, but that should be treated as a separate, higher-risk task.

## Public Docs Alignment (2026-04-11 UTC)

### What changed

- Updated public repo/docs copy to match the current devnet truth:
  - `README.md`
  - `app/src/pages/docs.tsx`
  - `app/src/pages/index.tsx`
- Added the staged diagnostic command to the README validation section:
  - `npm run diag:open-contract`
- Clarified the current public status:
  - hardened relay/runtime path is working
  - delegated session and collateral flows are working
  - the remaining blocker is still the Arcium-backed open lane
- Removed wording that implied end-to-end market-order open finalization is already fully signed off.
- Removed decorative arrow icons from the public landing-page `Launch App` CTAs so the button copy reads more cleanly.

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS after the docs page updates

### Current blocker

- Public copy is now aligned with the current technical state.
- Main protocol blocker remains unchanged:
  - the open lane still does not finalize to `Open` on the current devnet namespace

### Next safe step

1. If you want these README + docs updates published remotely too, commit and push them as a docs-alignment follow-up.
2. Keep the escalation packet and public docs in sync if Arcium guidance changes the diagnosis.

## Relay Reliability Hardening (2026-04-11 UTC)

### What changed

- Hardened relay/session account-miss detection with a shared helper:
  - `app/src/lib/account-errors.ts`
  - wired into:
    - `app/src/pages/api/relay/open.ts`
    - `app/src/pages/api/relay/session.ts`
    - `app/src/pages/api/relay/deposit.ts`
    - `app/src/pages/api/relay/withdraw.ts`
    - `app/src/hooks/useArcium.ts`
    - `app/src/lib/client.ts`
    - `app/src/lib/arcium-errors.ts`
- Increased callback wait windows to better match observed Arcium devnet timing:
  - open wait in `app/src/hooks/useArcium.ts`
  - generic position-status wait in `app/src/lib/client.ts`
- Tightened relay open oracle behavior in `app/src/pages/api/relay/open.ts`:
  - require 2/2 live sources from the route's pair-specific CoinGecko + Binance set before refreshing
  - log warnings for degraded sources
  - stop treating any `getMarginAccount` failure as "no collateral"
  - fail explicitly when the oracle remains stale after attempted refresh

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- exact-string account-miss checks are now removed from app/relay codepaths and centralized in `app/src/lib/account-errors.ts`
- `npm run oracle:once` -> PASS
  - publish tx `vzCURx77qczeT6eDMzzopsQV9wU9NJfYfQ2tYfZMiwLm4evo9SG5qTYSxsMzqz4i7WU1iHufde91tg9sZPY8T8A`
- `npm run check:oracle` -> PASS
- `npm run check:preflight` -> PASS after the oracle publish finalized on the active RPC
- Hardened relay API smoke via local `/api/relay/open`:
  - v2 session create tx `4ZNnjibri3tumqquXkQpqzjtAPgQjkupqZGYQLxKvgvN2uDJh4gTL82Hk5JZXyS1yi5gKpzaNAvBio6MQEtMavaH`
  - relay open tx `3sQyX3jQDN6hyDpQ1RaBU6pZBpMSZjJtHvHaq6K2u9gHvoVoXh7uNzydabQkyWLjujZV6sj6egzpKD9NrLiUSaNp`
  - position `H28KXancir6BCpDXTbtd6noJBAWgmPHgzNPDYetpKkLp`
  - final observed status `Closed`

### Current blocker

- Main protocol blocker is still unchanged:
  - the open lane continues to abort on devnet even in the tuple-only diagnostic probe
  - the hardened relay path now confirms the same root issue without leaving the position stuck pending

### Next safe step

1. Commit the relay reliability hardening together with the diagnostic harness work.
2. Send `docs/arcium-open-escalation-2026-04-11.md` to Arcium with the live probe packet plus the fresh relay-open repro above.
3. Wait for Arcium guidance before spending more time on ruled-out margin/leverage branches.

## Deep Audit + Escalation Packet (2026-04-11 UTC)

### What changed

- Re-ran a deep repo audit across the live open path:
  - on-chain open / callback handlers
  - delegated session flow
  - relay open API
  - frontend callback waiting path
  - shared RPC transport helpers
- Added a shareable Arcium escalation packet:
  - `docs/arcium-open-escalation-2026-04-11.md`

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- `cargo check -p shadowperp` -> PASS
- `scripts/rpc.ts` now resolves aligned RPC + WS transport pairs for preferred endpoints:
  - explicit ZAN preference resolves to ZAN RPC + ZAN WS, not a mixed QuickNode WS fallback

### Audit findings

1. The user-facing open wait window is still too short for the observed Arcium callback envelope:
   - `app/src/hooks/useArcium.ts` waits only `45s`
   - `app/src/lib/client.ts` defaults settlement polling to `60s`
   - repo notes and live smoke history already show callback windows can run well beyond that
2. Relay v2 -> v1 session fallback is still brittle:
   - `app/src/pages/api/relay/open.ts`
   - `app/src/pages/api/relay/session.ts`
   - both depend on the exact error string `Account does not exist`
   - provider-specific variants can wrongly skip fallback and reject valid v1 sessions
3. The relay open route contains a looser oracle-refresh policy than the hardened feeder:
   - it medianizes CoinGecko + Binance and accepts any positive fulfilled subset
   - it silently swallows refresh failures
   - this is operationally weaker than the hardened multi-source oracle path documented elsewhere in this repo

### Current blocker

- Main protocol blocker is unchanged:
  - the open lane still aborts on devnet even in the tuple-only diagnostic probe

### Next safe step

1. Send the new escalation packet to Arcium with the three live probe txs and diagnostic PDAs.
2. Independently harden the app/relay path:
   - raise callback wait windows to match observed devnet timing
   - replace exact-string session-miss detection with a shared account-missing classifier
   - align relay oracle refresh policy with the hardened feeder rules

## Full Open Probe Matrix (2026-04-11 UTC)

### What changed

- Re-ran the staged open-contract diagnostics after:
  - deploying the diagnostic instructions live
  - fixing the diagnostic PDA seed bug
  - wiring local RPC fallback order to prefer QuickNode, then ZAN, Helius, Alchemy, and public devnet
- Patched `scripts/rpc.ts` and `scripts/diagnose-open-contract.ts` so the diagnostic runner can use aligned RPC+WS transports from local env.

### What was verified

- QuickNode-first run succeeded far enough to show:
  - `tuple-only` -> `aborted`
  - `margin-check` -> `aborted`
- ZAN-backed rerun completed the entire staged matrix:
  - `tuple-only`
    - tx `fWvsdb8dractFh4yQghxPTVn7MxFUEb5jUCxbauiVNvo2uqfgHjbx4yQFDpPVHZMGGPF2DfL6z1djviQsMv3VP3`
    - diagnostic `AdUxoy4SimDBJbM1Joxqm39Naad9SA1KtVoci4sSzJfB`
    - status `aborted`
  - `margin-check`
    - tx `VnSqfvgskHs5Gy1KfUhiVXYbEkaqgcXjiVNSsC9gpa9QRQEHFMcbC72hsitmkpGAkfae5njiQnxQsTYSivTo2KS`
    - diagnostic `GGvxzs4jFq5tJ8hAjEatapBkKZY7bJMSS6NMkGmyL1qC`
    - status `aborted`
  - `full-check`
    - tx `3shup8vhA4gQUwEXDHwBjFnLiMqqx171FSoU3WjszPNBvJ2ZfGXUaN2zCyheN25unoX6m5JGT7hnm7EGyvzpSUx9`
    - diagnostic `61ZQYCxUqXPpCmzkTVFK8EcUoytwdJonnmv8QhZFsKJi`
    - status `aborted`
- All three stages returned result flags `[false, false, false, false]` because the callback path hit the abort branch before any positive outputs were verified.

### Findings

- The root abort is not introduced by:
  - `requested_margin`
  - `max_leverage`
  - the fuller business-rule branch in `open_position_full_probe_v1`
- The failure survives the entire staged simplification ladder.
- Current evidence now points much more strongly toward:
  - an Arcium/runtime issue tied to this fresh encrypted open tuple lane, or
  - a lower-level contract mismatch that is already present before the extra plaintext checks matter

### Current blocker

- The staged diagnostics are now complete enough to answer the original isolation question.
- The blocker is no longer "which branch causes the open abort?"
- The blocker is now how to resolve or escalate an abort that reproduces in every open probe stage.

### Next safe step

1. Package the staged probe evidence for Arcium escalation:
   - three live devnet probe txs
   - three diagnostic PDAs
   - same abort outcome at tuple-only, margin-check, and full-check
2. Keep the local diagnostic harness in place for regression checks after any Arcium-side guidance or code change.
3. Do not spend more cycles assuming the problem is only in margin/leverage business logic, because the staged matrix now rules that out.

## RPC Fallback Priority Refresh (2026-04-11 UTC)

### What changed

- Updated the shared script RPC resolver in `scripts/rpc.ts` to auto-load local RPC env values from:
  - `app/.env.local`
  - repo-root `.env.local`
- This lets repo scripts use the same local fallback list as the app without committing keyed RPC URLs into tracked source.
- Updated `app/.env.example` comments to document the intended failover order:
  - primary paid RPC first
  - secondary paid RPCs next
  - public devnet last
- Updated local `app/.env.local` RPC ordering to:
  1. QuickNode
  2. ZAN
  3. Helius
  4. Alchemy
  5. public devnet
- Added aligned websocket fallback lists in local env for the same providers.

### What was verified

- `collectRpcCandidates()` now returns:
  1. `https://ancient-autumn-sunset.solana-devnet.quiknode.pro/28a5d96c2894cc2c31d70709291285773cb2806e`
  2. `https://api.zan.top/node/v1/solana/devnet/19ad9ecee1c340fdb1e14a5d1fb05cd2`
  3. `https://devnet.helius-rpc.com/?api-key=b077c7fc-8625-488f-93fd-1daf8de886c1`
  4. `https://solana-devnet.g.alchemy.com/v2/Nbazz1j8QfREnu7ryGLtGI03ubwKJJtt`
  5. `https://api.devnet.solana.com`
- `resolveRpcEndpoint({ requireHealthy: false })` now resolves to QuickNode by default when no explicit `--rpc` override is passed.

### Current blocker

- RPC priority is improved locally, but the larger Arcium circuit upload path may still require a websocket-capable endpoint with enough throughput to avoid `429` during large upload bursts.

### Next safe step

1. Retry the remaining diagnostic comp-def finalization using the new default QuickNode-first fallback path.
2. If QuickNode degrades, let the shared resolver fall through to ZAN, then Helius, then Alchemy, then public devnet.

## Open Diagnostic Live Probe Pass (2026-04-11 UTC)

### What changed

- Built the updated `shadowperp.so` + IDL through the WSL-safe Solana/Anchor lane after adding the open-position diagnostic instructions.
- Deployed the updated program binary to the existing devnet program id:
  - program `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`
  - successful deploy tx: `3JnkDSXbJwaopVKXH3PKMXGxzGvWEh9QrajgGFto4UiFovTZ6zCYZRbCmVk1sE1mV2g1sxvGJT7Ya87px6x3xvHZ`
- Fixed a local on-chain seed bug in the diagnostic handlers:
  - `programs/shadowperp/src/handlers/open_position_diagnostics.rs`
  - root cause: `#[instruction(...)]` listed only trailing args, so Anchor validated the diagnostic PDA seeds against the wrong instruction bytes
- Redeployed again after the seed fix to the same program id.
- Hardened `scripts/diagnose-open-contract.ts` so it can:
  - detect missing deployed diagnostic instructions
  - detect incomplete comp-defs
  - attempt comp-def finalization from local circuit artifacts

### What was verified

- Post-redeploy, the diagnostic instruction is definitely live:
  - devnet simulation reached `Instruction: RunOpenPositionTupleProbe`
- `open_position_tuple_probe_v1` comp-def now exists and was finalized successfully enough to run the first tuple-only diagnostic lane.
- Tuple-only diagnostic run succeeded in queueing and finalized with:
  - diagnostic `8a6PKPifFaHYGUdL5QPsMnsDuLGYPfc5KDYYrVKq1i5d`
  - queued tx `DgfJcmwbzvr5HD6D7MFWQj1EEcjkB3uG7NusKn1BwPzNvYW68Fp5Dt8BSRJnpF1XiNcQCbuZjsJnY52ymvgVDZg`
  - status `aborted`
  - results `[false, false, false, false]`
- This is the strongest diagnostic signal so far:
  - the open lane can abort even in the tuple-only probe, before reintroducing `requested_margin` or `max_leverage`

### Findings

- The prior PDA mismatch was local code, not chain state:
  - once fixed and redeployed, the tuple-only probe executed
- The tuple-only probe abort means the current root issue is earlier than the full business rule layer.
- Current evidence now points more strongly toward:
  - Arcium/runtime behavior around this specific fresh encrypted open tuple lane, or
  - a subtle open-lane contract mismatch that still survives after stripping the logic down to tuple decryption + trivial output
- `open_position_margin_probe_v1` and `open_position_full_probe_v1` are not yet fully finalized:
  - on Alchemy, Arcium client upload/finalize hits missing `signatureSubscribe`
  - on public devnet RPC, large circuit upload runs into `429 Too Many Requests`

### Current blocker

- The key root-cause lane is partially isolated now:
  - tuple-only already aborts
- Remaining blocker for completing the staged investigation:
  - need a websocket-capable RPC with enough throughput to finalize the larger diagnostic comp-def uploads (`margin` / `full`) without `429` or subscription failures

### Next safe step

1. Keep the tuple-only result as the current root diagnostic fact: the abort is upstream of margin/leverage checks.
2. Finalize the remaining diagnostic comp-defs using a higher-throughput websocket-capable RPC.
3. Re-run `diag:open-contract` and record whether:
   - margin-check also aborts, or
   - full-check is the first stage that changes behavior.
4. If RPC limits remain the blocker, escalate to Arcium with the tuple-only repro because it is already minimal and live.

## Open Contract Diagnostic Harness (2026-04-10 UTC)

### What changed

- Added a devnet-safe Arcium diagnostic lane for the open-position contract:
  - new confidential probes in `encrypted-ixs/src/open_position_diagnostics.rs`
  - new diagnostic state account in `programs/shadowperp/src/state/open_position_diagnostic.rs`
  - new queue + callback handlers in `programs/shadowperp/src/handlers/open_position_diagnostics.rs`
  - new callback handlers in `programs/shadowperp/src/handlers/callbacks/open_position_diagnostic_callbacks.rs`
  - new comp-def init entrypoints and program wiring in `programs/shadowperp/src/handlers/init_comp_defs.rs` and `programs/shadowperp/src/lib.rs`
  - new runner script `scripts/diagnose-open-contract.ts`
  - new upload entries in `scripts/upload-circuits.ts`
- Built the new Arcium circuit artifacts with the existing WSL Arcium path:
  - `build/open_position_tuple_probe_v1.*`
  - `build/open_position_margin_probe_v1.*`
  - `build/open_position_full_probe_v1.*`
- Regenerated local IDL via WSL:
  - `node scripts/build-idl.js --program-path programs/shadowperp --out target/idl/shadowperp.json`

### What was verified

- `cargo check -p shadowperp` -> PASS after the new probe artifacts were present.
- `npx ts-node --transpile-only scripts/diagnose-open-contract.ts --rpc <Alchemy>` now starts successfully and reaches the first comp-def init transaction.
- The runner now reports the live blocker clearly:
  - `Deployed program ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4 does not include the open-position diagnostic instructions yet. Rebuild and redeploy this branch before running diag:open-contract.`
- This came from on-chain simulation logs showing:
  - `InstructionFallbackNotFound`
  - meaning the local source + IDL have the new diagnostic instructions, but the currently deployed devnet program does not.

### Findings

- The new diagnostic harness is locally wired far enough to use after redeploy.
- The current blocker for running the probes is no longer TypeScript or IDL drift.
- The next gating step is deployment state:
  - build the updated program binary
  - deploy this branch to devnet
  - then initialize the new probe comp-defs and run `diag:open-contract`
- Windows native Anchor build remains flaky on this machine because the local SBF install path reports a corrupted toolchain during `npm run build:anchor:safe`.
- WSL remains the more reliable build/IDL path for this repo at the moment.

### Current blocker

- The diagnostic instructions are not on the live devnet deployment yet, so the new open-contract probes cannot be executed against the current program address.

### Next safe step

1. Build the updated program binary through the repo's WSL-safe Anchor lane.
2. Deploy the updated program to devnet.
3. Upload/init the new diagnostic probe comp-defs if needed.
4. Run `npm run diag:open-contract -- --rpc <Alchemy>` and capture which stage passes or aborts.

## Arcium Investigation Pass (2026-04-10 UTC)

### What changed

- No product-code changes in this pass.
- Ran a focused `arcium-program-development` investigation on the live `open_position_probe_b` abort path.
- Compared:
  - local circuit source
  - queue ArgBuilder contract in direct and session-v2 paths
  - generated local build artifacts
  - callback output shapes
  - direct account evidence from the latest failed position/computation

### What was verified

- `npm run check:preflight` remained PASS earlier in the same repo session.
- Latest failed open repro still points at:
  - position `5aBDinsLwftjjGB9vckfDPgwts2RfMMhKwK3n5g7CgUF`
  - computation `FaVW6efZZCnnLWKc7FmeX98AFmCvH4MP4SvueRRYPgbn`
- Direct account inspection confirms the deployed program still leaves this failed open in:
  - `status = Pending`
  - `pendingComputationAccount = FaVW6efZZCnnLWKc7FmeX98AFmCvH4MP4SvueRRYPgbn`
- Position PDA history still shows repeated callback failures:
  - `6010` on ShadowPerp callback txs
- Computation PDA history still shows repeated Arcium failure-reclaim retries:
  - `6301 InvalidArguments` during `ReclaimFailureRentIdempotent`
- Local artifact/build contract still aligns with the known open comp-def signature:
  - `build/open_position_probe_b.ts` shows inputs:
    - `Enc<Shared, (u64, u64, u8, bool, u64)>`
    - `u64`
    - `u8`
  - outputs:
    - `bool`
- Local generated IDL confirms callback output shape is correct:
  - `OpenPositionProbeBOutput.field_0: bool`
  - this is different from nested outputs like `SeedOpenInterestStateV3OutputStruct0`, so the open callback's flat `field_0` access is not the issue
- Queue contracts remain aligned across paths:
  - direct open in `programs/shadowperp/src/handlers/open_position.rs`
  - delegated wallet-scoped open in `programs/shadowperp/src/handlers/session_trading.rs`
  - app client tuple encryption in `app/src/lib/client.ts`
  - smoke/canary tuple encryption in `scripts/smoke-test-devnet.ts` and `scripts/devnet-canary.ts`

### Findings

- The strongest "easy mismatch" candidates are now weaker:
  - instruction naming alignment appears correct
  - local callback output type/shape appears correct
  - local ArgBuilder field order appears consistent with the generated build contract
  - local artifact size/signature evidence previously matched the finalized comp-def metadata already logged in these notes
- The open lane still differs from the other computations in a few important ways:
  - it decrypts a fresh user-supplied `Enc<Shared, (u64, u64, u8, bool, u64)>` immediately rather than reading previously stored encrypted data
  - it returns only a revealed `bool`
  - it mixes the encrypted tuple with plaintext `requested_margin: u64` and `max_leverage: u8`
- `close_position_v2` and `check_liquidation` share the same encrypted tuple type/order in local source, so the broad tuple layout itself is not obviously wrong from the code contract alone.
- The repeated `6301 InvalidArguments` reclaim noise appears secondary to the failed computation path, not like the primary root cause.
- The deployed program still has the separate cleanup bug that leaves failed opens in `Pending`; the local callback-cleanup patch should address that only after rebuild/deploy.

### Current blocker

- Main live protocol blocker remains unchanged:
  - `open_position_probe_b` still aborts at Arcium verification time on devnet
- Current evidence points more toward:
  - an Arcium runtime/computation issue in the open lane, or
  - a subtle contract mismatch not visible from name/count/type/shape inspection alone
- Current evidence points less toward:
  - simple callback output parsing bug
  - simple instruction-name mismatch
  - simple param-count drift

### Next safe step

1. Do not redeploy blindly just to chase the root abort.
2. If protocol debugging continues, the best next experiment is to create a devnet-only diagnostic computation that isolates the open tuple contract:
   - same encrypted tuple shape
   - minimal/no business logic
   - progressively add back `requested_margin` and `max_leverage`
3. If we want operational safety first, deploy the already-prepared callback-cleanup patch separately so failed opens no longer remain stuck in `Pending`.

## Callback Failure Cleanup Patch (2026-04-10 UTC)

### What changed

- Patched local callback failure handling in:
  - `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
  - `programs/shadowperp/src/handlers/callbacks/close_position_callback.rs`
  - `programs/shadowperp/src/handlers/callbacks/liquidation_callback.rs`
- New local behavior:
  - open-position verify failure now commits `Closed` cleanup instead of returning an error that rolls the cleanup back
  - open-position MPC rejection (`field_0 == false`) now also commits a terminal `Closed` state
  - close-position verify failure now restores `Open` and clears the pending computation binding when the callback matches the expected computation account
  - liquidation verify failure now clears the pending computation binding when the callback matches the expected liquidation computation account

### What was verified

- Re-ran mandatory live health checks for this repo-scoped pass:
  - read `DEV_NOTES.md`
  - `git status --short`
  - verified env in `app/.env.local`
  - `npm run check:preflight` -> PASS
- Fresh bounded devnet repro:
  - `npx ts-node scripts/smoke-test-devnet.ts --rpc <Alchemy> --trade`
  - queue tx succeeded:
    - `2APjebvmsx8CnZjCpdpE32xj7DArh8A8J5brKkTgkWgHFX9ZJ7jzXUw7w8tLJSvM7eS5iBgWs7Mq1pw7h4fzXWM`
  - derived position:
    - `5aBDinsLwftjjGB9vckfDPgwts2RfMMhKwK3n5g7CgUF`
  - pending computation account:
    - `FaVW6efZZCnnLWKc7FmeX98AFmCvH4MP4SvueRRYPgbn`
  - callback txs still landed and failed on-chain with the same signature pattern:
    - `2EoTB8uHTRXphiFKdEB3Qwbn9FGoZZwFg2NqExusrn9SXvfMVe58PFNM2YiEPa5mMYycxadgU7AVhfUgCaumCPdF`
    - `5mh52frtvyNFozeHhsdyswccvE5YD581wMAeB3sNnMFodUr6SPtREoyPNNQVDQg42HNaPQV7cLanxoTM2NCee7x7`
  - callback logs still show:
    - `Instruction: OpenPositionProbeBCallback`
    - `MPC verify failed ... AbortedComputation (6000)`
    - then `InvalidComputationResult (6010)`
- Additional Arcium-side retry/failure reclaim activity still present on the same computation account:
  - repeated `ReclaimFailureRentIdempotent`
  - `InvalidArguments (6301)` during failure reclaim retries
- `cargo check -p shadowperp` -> PASS after the callback cleanup patch

### Findings

- The original local callback cleanup logic for open positions was not actually taking effect on-chain because it mutated account state and then returned `Err(...)`.
- On Solana, returning an error rolls back those writes, so the position remains stuck in `Pending` even though the code appears to close it.
- This rollback trap also existed in sibling callback failure paths:
  - close failure could leave a position stuck in `Closing`
  - liquidation failure could leave the pending computation binding uncleared
- The new local patch fixes the zombie-state problem, but it does **not** solve the underlying Arcium abort for `open_position_probe_b`.

### Current blocker

- Main live protocol blocker is still unchanged on devnet:
  - `open_position_probe_b` callbacks continue to abort with `AbortedComputation (6000) -> InvalidComputationResult (6010)`
- The cleanup fix is local source only until the program is rebuilt and redeployed.
- Tracked local worktree also contains unrelated user-side app changes:
  - `app/src/components/BottomPositionsPanel.tsx`
  - `app/src/components/WalletPopup.tsx`
  - untracked history files under `app/src/lib/` and `app/src/pages/api/`

### Next safe step

1. Decide whether to ship the callback-cleanup patch first as a safety fix, even before the Arcium abort is solved.
2. If yes:
   - rebuild the program
   - deploy to devnet
   - re-run the open-position smoke to confirm failed callbacks now leave `Closed` instead of `Pending`
3. In parallel or immediately after, keep the Arcium escalation lane active with the fresh repro packet above because the root abort still exists.

## Repo Knowledge Pass (2026-04-10 UTC)

### What changed

- No product-code changes in this pass.
- Completed a repo-wide learning/audit pass across:
  - required onboarding docs
  - live runtime env and preflight/oracle checks
  - Anchor program state/handlers/callback wiring
  - Arcium circuit sources
  - frontend runtime/client/relay flow
  - operator scripts and safety tooling

### What was verified

- Mandatory session checklist completed:
  - read `DEV_NOTES.md`
  - read `ARCHITECTURE.md`
  - read `DATA_FLOW.md`
  - read `PERP_UI_SYSTEM.md`
  - read `DESIGN_RULES.md`
  - read `NO_TOUCH_LIST.md`
  - `git status --short`
  - verified env in `app/.env.local`
  - `npm run check:preflight`
  - `npm run oracle:once`
  - `npm run check:preflight`
- Active env remains:
  - program: `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`
  - primary market env: `crEV9TSAU6xkiWFUAZebejHmWVh6VFx5EEFLcfX9L2T`
  - cluster offset: `456`
  - RPC: Alchemy devnet
- Oracle refresh succeeded:
  - tx `4DeWwNEUuoopVNNhHS6GX6HMNZH7mWELGLsSWU8XP4cjtvDy72MALciP3J29AWms3wy7e5sArSjgmNZZnHJvbevD`
- Post-refresh preflight passed fully:
  - program/market/comp-def/oracle/operator balance checks all PASS

### Findings

- Repo shape is coherent and currently centers on five active lanes:
  - devnet-safe Anchor perp program in `programs/shadowperp/`
  - Arcium MPC circuits in `encrypted-ixs/`
  - Next.js terminal + relay/API in `app/`
  - operator/deploy/oracle scripts in `scripts/`
  - migration-backed shared-collateral rollout plus feature-gated shielded collateral
- Current live money model:
  - shared collateral is active on adopted devnet markets
  - user margin PDA is now owner-scoped (`[b"margin", owner]`)
  - session v2 is wallet-scoped and intended for cross-market delegated use
- Current privacy model:
  - open/close/liquidation inputs are encrypted through Arcium
  - token transfers, wallet addresses, and delegated session creation remain public
  - shielded collateral base flows are implemented, but full private margin lifecycle is still incomplete
- Current frontend/relay model:
  - trading UX is centered on delegated relay execution by default
  - `/api/relay/open` validates signed session auth, rate limits requests, and auto-refreshes oracle when stale
  - client/runtime now uses polling-safe confirmation for major user flows
- Secondary product gaps still visible in source:
  - funding scaffolding exists but is not yet fully connected to the live position lifecycle
  - TP/SL and limit-order semantics still rely on browser-local automation rather than durable exchange-side behavior

### Current blocker

- Main live protocol blocker remains unchanged:
  - `open_position_probe_b` callback can still fail on devnet with `AbortedComputation (6000) -> InvalidComputationResult (6010)`
- Repo understanding pass found no new evidence that this is a simple callback wiring mismatch.
- The strongest current working theory remains:
  - queueing path works
  - callback path lands
  - failure is in Arcium runtime / computation-result handling for the open-position lane

### Next safe step

1. If the goal is protocol readiness, continue the `open_position_probe_b` debugging/escalation lane with fresh live evidence.
2. If the goal is product reliability instead, the safest next source lane is funding/automation truthfulness:
   - either wire funding into real lifecycle settlement
   - or keep funding/UI claims explicitly scoped
   - and decide whether browser-local TP/SL and limit orders should remain product behavior.
3. Keep using `npm run check:preflight` and `npm run oracle:once` at the start of every new repo session because the rest of the stack is only meaningful when oracle freshness is healthy.

## Mobile App Density + Docs Drift Fix (2026-04-05 UTC)

### What changed

- Restored the tracked drift in `app/src/pages/docs.tsx` so the public docs again match the current verified devnet state:
  - shared collateral is described as active on adopted markets for migrated wallets
  - shielded collateral base flow is described as live on devnet
- Tightened the mobile terminal viewport in `app/src/pages/app.tsx`:
  - reduced mobile chart block height from `340px` to `280px`
  - reduced outer mobile spacing around the chart/orderbook tab block
- Softened mobile chart loading in `app/src/components/PriceChart.tsx`:
  - keep the full spinner only during the initial short load window
  - after `4.5s`, downgrade to a small non-blocking `Chart still loading` badge so the chart area is not fully obscured on slow loads

### What was verified

- Mandatory session checklist completed:
  - read `DEV_NOTES.md`
  - read `ARCHITECTURE.md`
  - read `DATA_FLOW.md`
  - read `PERP_UI_SYSTEM.md`
  - read `DESIGN_RULES.md`
  - read `NO_TOUCH_LIST.md`
  - `git status --short`
  - verified env in `app/.env.local`
  - `npm run check:preflight`
  - `npm run oracle:once`
- Oracle refresh succeeded:
  - tx `4cFVpnrP9GSgvzWVDXsKkUEQBYo6bpTcMWLBiSAQEPDQkKyL3HWEdws2SttksojkPQ7W8XgjXCBGJsAGcon4r8AD`
- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- Local mobile browser pass against `http://127.0.0.1:3050/app`:
  - screenshot saved to `output/playwright/local-mobile-app-after.png`
  - first mobile viewport is less cramped than before
  - chart is visible in the viewport instead of being hidden behind a persistent full-screen loader

### Findings

- The mobile shell improved in the local pass:
  - market info + tab block consume less vertical space
  - chart area is still prominent, but no longer dominates the first screen as heavily
  - slower chart loads now degrade more gracefully
- Console noise during the local dev capture was not from this patch:
  - existing Gate.io browser fallback requests still hit CORS on localhost
  - a Next dev HMR warning was present in local dev only

### Current blocker

- Main protocol blocker remains unchanged:
  - `open_position_probe_b` callback can still abort with `AbortedComputation (6000) -> InvalidComputationResult (6010)`
- Local tracked changes now exist in:
  - `app/src/pages/docs.tsx`
  - `app/src/pages/app.tsx`
  - `app/src/components/PriceChart.tsx`
- Local untracked artifacts remain:
  - `.tmp_app_job_id`
  - `output/`
  - `.agents/`
  - `.trae/`
  - `skills-lock.json`

### Next safe step

1. Decide whether to commit this mobile/docs pass as its own clean UI/docs patch.
2. If continuing mobile polish, focus next on:
   - reducing the large empty-space feel on the landing page hero
   - making orderbook/provider fallback feel cleaner on mobile
3. Keep mobile verification mandatory for all future UI/product changes.

## Live UI Smoke + Mobile Reminder (2026-04-05 UTC)

### What changed

- No product-code changes in this pass.
- Ran a live user-facing smoke against `https://shadowperpdex.xyz/app`.
- Added a standing local reminder for future passes: every UI/product change should be checked on mobile as well as desktop before sign-off.

### What was verified

- Live site reachable: `https://shadowperpdex.xyz/app` -> HTTP `200`
- Captured fresh live screenshots into `output/playwright/`:
  - `live-desktop-home.png`
  - `live-mobile-home.png`
  - `live-desktop-app.png`
  - `live-mobile-app.png`
- Live landing page:
  - desktop loads and branding/hero render correctly
  - mobile loads and branding/hero render correctly
- Live app page:
  - desktop terminal shell renders with chart, orderbook, trading panel, and bottom tabs in place
  - mobile terminal shell renders, but the first viewport remains cramped and the chart was still on a loading spinner in the captured state

### Findings

- Desktop landing looks aligned.
- Mobile landing is generally aligned, but the hero content sits low in the viewport and leaves a large amount of empty space above it.
- Desktop app shell looks structurally fine.
- Mobile app still needs stricter review on every UI pass:
  - top-of-screen density is high
  - chart loading/readiness is not convincingly stable from the live capture
  - the first mobile viewport still feels cramped relative to the amount of trading chrome shown

### Current blocker

- Main protocol blocker is still separate and unchanged:
  - `open_position_probe_b` callback can still abort with `AbortedComputation (6000) -> InvalidComputationResult (6010)`
- Operational cleanup from this smoke:
  - local tracked file drift remains in `app/src/pages/docs.tsx`
  - untracked local artifacts exist:
    - `.tmp_app_job_id`
    - `output/`
    - `.agents/`
    - `.trae/`
    - `skills-lock.json`

### Next safe step

1. Restore or recommit the local `app/src/pages/docs.tsx` drift before the next code change so the tracked worktree is clean again.
2. Treat mobile verification as mandatory for future UI/product changes.
3. If continuing product polish, start with the mobile app first-viewport density/loading behavior because that is the clearest remaining UX weakness from the live capture.

## Public Docs Alignment Pass (2026-04-04 UTC)

### What changed

- Updated public writeups to match the current verified devnet state:
  - `README.md`
  - `ARCHITECTURE.md`
  - `DATA_FLOW.md`
  - `app/src/pages/docs.tsx`
- Main alignment points:
  - `TradeSessionV2` is the default wallet-scoped delegated session model on devnet
  - shared collateral is no longer described as source-only; public docs now say it is live on adopted markets for migrated owners
  - shielded collateral base flows (`deposit_to_shielded`, `request_withdraw_private`, `finalize_withdraw`) are described as live, while private margin lock/settle remains in progress
  - `open_position_probe_b` remains explicitly documented as the main unsigned-off devnet blocker

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- Read-through grep on updated docs confirms the old "source only / not live yet" shared-collateral language was replaced with migration-backed live-state wording.

### Current blocker

- Public docs are now aligned with the current verified devnet state.
- Separate code changes still local in this session:
  - callback audit fixes in:
    - `programs/shadowperp/src/handlers/callbacks/execute_private_order_callback.rs`
    - `programs/shadowperp/src/handlers/callbacks/settle_private_position_callback.rs`
    - `programs/shadowperp/src/handlers/shielded_collateral.rs`
- Main protocol blocker remains unchanged:
  - `open_position_probe_b` callback can still abort with `AbortedComputation (6000) -> InvalidComputationResult (6010)`

### Next safe step

1. Decide whether to commit docs only, callback audit fixes only, or both together.
2. If shipping the callback fixes, redeploy and resync the relevant flow before calling those fixes live.
3. Keep `open_position_probe_b` as a separate debugging lane.

## Arcium Callback Audit Fixes (2026-04-04 UTC)

### What changed

- Applied the real Arcium callback fixes from the latest callback audit:
  - `programs/shadowperp/src/handlers/callbacks/settle_private_position_callback.rs`
  - `programs/shadowperp/src/handlers/callbacks/execute_private_order_callback.rs`
  - `programs/shadowperp/src/handlers/shielded_collateral.rs`
- `settle_private_position_callback` now:
  - requires the callback cluster to match `market.mxe_cluster`
  - requires the callback comp-def account to match the expected derived PDA
  - includes `commitment_tree` in accounts
  - pushes the new root into the tree ring buffer instead of updating only `shielded_pool.tree_root`
- `execute_private_order_callback` now:
  - requires the callback cluster to match `market.mxe_cluster`
  - requires the callback comp-def account to match the expected derived PDA
- `settle_private_position` queue handler now passes `commitment_tree` into the callback account list so the callback account contract stays aligned.

### What was verified

- Mandatory session checklist completed:
  - read `DEV_NOTES.md`, `ARCHITECTURE.md`, `DATA_FLOW.md`, `PERP_UI_SYSTEM.md`, `DESIGN_RULES.md`, `NO_TOUCH_LIST.md`
  - read Arcium program skill instructions
  - `git status --short`
  - verified active env in `app/.env.local`
  - `npm run check:preflight`
  - `npm run oracle:once`
- Oracle refresh:
  - tx `2hkK636rkujZhDCc4GZjz9Mp5DHMge13oS4E2buvtWmqhWkQCnRqYya166EhyBYTY41Vfs5PaAfK2Pz4ouUjjgRH`
- `cargo check -p shadowperp` -> PASS

### Current blocker

- The callback audit issues above are fixed in local source.
- One lower-priority audit item remains intentionally unimplemented:
  - storing `execute_private_order` / `settle_private_position` auxiliary comp-defs directly on `Market`
  - not safe as a quick patch because live market accounts do not have room for four extra pubkeys
- Separate protocol blocker remains unchanged:
  - `open_position_probe_b` callback can still abort with `AbortedComputation (6000) -> InvalidComputationResult (6010)`

### Next safe step

1. Decide whether to commit/push this callback-audit patch set now.
2. If we want to address the remaining low audit item, do it as a separate market-account migration/design lane rather than an in-place field expansion.
3. Keep `open_position_probe_b` as a separate debugging track.

## Shared-Collateral Idempotency Deploy (2026-04-04 UTC)

### What changed

- Deployed the updated program containing the `MigrateLegacyMarginAccount` idempotency guard to devnet using Zan RPC.
- Kept the Arcium encrypted open-position path untouched.

### What was verified

- Rebuilt program artifact via WSL:
  - `arcium build --skip-keys-sync --skip-program`
  - `cargo-build-sbf --tools-version v1.53 --manifest-path programs/shadowperp/Cargo.toml`
- Deployed via Zan:
  - deploy signature `yAMqJEGiroYuQWqjWUEpo5sVXJup9YHEmVcmgzLsBKNQ8Dx2YXSK7ttkqhpPfunK3To5JdPoC72g3weRiqNUBDW`
- `solana program show ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4 --url https://api.devnet.solana.com`
  - `Last Deployed In Slot: 453145996`
- Post-deploy rerun on Zan:
  - `npx ts-node scripts/migrate-shared-margin.ts --rpc https://api.zan.top/node/v1/solana/devnet/19ad9ecee1c340fdb1e14a5d1fb05cd2`
  - result:
    - `SOL-USD no legacy balance to migrate`
    - `BTC-USD no legacy balance to migrate`
    - `JUP-USD no legacy balance to migrate`
    - `ETH-USD no legacy margin account`
    - `PYTH-USD no legacy margin account`
    - `ORCA-USD no legacy margin account`

### Current blocker

- Shared-collateral rollout lane is now deploy-verified and operator-safe for no-op reruns.
- Remaining major protocol blocker is still separate:
  - `open_position_probe_b` callback can still abort with `AbortedComputation (6000) -> InvalidComputationResult (6010)`

### Next safe step

1. Commit/push the shared-collateral rollout files and script hardening.
2. Optionally regenerate/copy IDL again before push only if we want a fresh post-deploy local sync snapshot.
3. Then return to the separate `open_position_probe_b` lane.

## Migration Idempotency Pass (2026-04-04 UTC)

### What changed

- Implemented an idempotency guard in:
  - `programs/shadowperp/src/handlers/shared_collateral.rs`
- `migrate_legacy_margin_account_handler` now:
  - returns early when legacy spendable balance is already `0`
  - clears migrated legacy metadata after a real migration:
    - `total_deposited`
    - `total_withdrawn`
    - `positions_opened`
    - `positions_closed`
    - `total_realized_pnl`
    - `_reserved`
- Hardened the operator migration script further in:
  - `scripts/migrate-shared-margin.ts`
  - it now skips true no-op legacy accounts before submitting any tx

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- `cargo check -p shadowperp` -> PASS
- Live operator rerun on Zan:
  - `npx ts-node scripts/migrate-shared-margin.ts --rpc https://api.zan.top/node/v1/solana/devnet/19ad9ecee1c340fdb1e14a5d1fb05cd2`
  - result:
    - `SOL-USD no legacy balance to migrate`
    - `BTC-USD no legacy balance to migrate`
    - `JUP-USD no legacy balance to migrate`
    - `ETH-USD no legacy margin account`
    - `PYTH-USD no legacy margin account`
    - `ORCA-USD no legacy margin account`
- This confirms the script-side no-op behavior is already safe for operators on the current live deployment.

### Current blocker

- The on-chain idempotency guard exists only in local source until the next deploy.
- Live operator safety is already much better because the script now skips no-op legacy accounts before sending transactions.
- Separate blocker remains unchanged:
  - `open_position_probe_b` callback can still abort with `AbortedComputation (6000) -> InvalidComputationResult (6010)`

### Next safe step

1. Deploy the updated program/IDL so the on-chain idempotency guard becomes live.
2. Re-run `scripts/migrate-shared-margin.ts` once after deploy to confirm harmless no-op behavior even if someone bypasses the script skip in the future.
3. Then commit/push the rollout lane cleanly.

## Shared-Collateral Script Hardening + Audit (2026-04-04 UTC)

### What changed

- Hardened the shared-collateral operator scripts to avoid the flaky provider `.rpc()` confirmation path:
  - `scripts/rpc.ts`
  - `scripts/adopt-shared-collateral.ts`
  - `scripts/migrate-shared-margin.ts`
- Added:
  - explicit poll-based confirmation via `getSignatureStatuses`
  - bounded retry handling for transient RPC/socket/429 failures
- Updated `migrate-shared-margin.ts` to match the current on-chain `MigrateLegacyMarginAccount` account list:
  - removed legacy vault / shared vault authority / token program assumptions

### What was verified

- `npx ts-node scripts/adopt-shared-collateral.ts --rpc https://api.zan.top/node/v1/solana/devnet/19ad9ecee1c340fdb1e14a5d1fb05cd2`
  - PASS
  - all 6 markets reported `already adopted`
- `npx ts-node scripts/migrate-shared-margin.ts --rpc https://api.zan.top/node/v1/solana/devnet/19ad9ecee1c340fdb1e14a5d1fb05cd2`
  - PASS
  - script no longer depends on `signatureSubscribe`
- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- `cargo check -p shadowperp` -> PASS

### Audit finding

- `MigrateLegacyMarginAccount` is not idempotent yet.
  - `programs/shadowperp/src/handlers/shared_collateral.rs`
  - the handler zeroes `balance` and `locked_balance` on the legacy account, but it does **not** clear or mark migrated metadata like `positions_closed`
  - on rerun, the global account can re-add `positions_closed` from the same legacy account
  - the new script also still attempts migration for zero-balance legacy accounts, which makes this easier to trigger operationally

### Current blocker

- Shared-collateral rollout is operationally healthier now, but the migration handler should be made idempotent before we call this lane fully safe for repeated operator use.
- Separate protocol blocker remains unchanged:
  - `open_position_probe_b` callback can still abort with `AbortedComputation (6000) -> InvalidComputationResult (6010)`

### Next safe step

1. Make `MigrateLegacyMarginAccount` explicitly idempotent:
   - either add a migrated flag
   - or zero/consume the migrated legacy counters after transfer
   - and have the script skip no-op legacy accounts
2. Re-run the migration script after that fix to confirm reruns are harmless.
3. Only then commit/push the rollout + script hardening lane.

## Shared Collateral Live Devnet Proof (2026-04-03 UTC)

### What changed

- No product-code changes in this pass.
- Continued the shared-collateral rollout using the deployed program, adopted shared vaults, and migrated owner-scoped margin.
- Kept `open_position_probe_b` completely untouched.

### What was verified

- `git status --short` before the smoke showed only tracked local rollout files:
  - `app/src/idl/shadowperp.json`
  - `app/src/pages/index.tsx`
  - `programs/shadowperp/src/handlers/shared_collateral.rs`
  - plus ignored local tooling
- Active runtime env from `app/.env.local`:
  - program: `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`
  - market: `crEV9TSAU6xkiWFUAZebejHmWVh6VFx5EEFLcfX9L2T`
  - cluster offset: `456`
  - RPC: Alchemy devnet
- `npm run check:preflight` failed only on stale oracle freshness.
- `npm run oracle:once` refreshed the price successfully:
  - tx `2ahMFcVuYX1VKoBpSUnoisjHPcUwbdR4gjZyuEVDCueHvXcY4BZnJDkdyX41wn1TPLrVbSq9PSKkaCbcyqQHozGN`
- Live shared-vault proof on devnet using explicit polling against `https://api.devnet.solana.com`:
  - global margin before:
    - `balance=5000000`
    - `locked=0`
    - `totalDeposited=5000000`
    - `totalWithdrawn=0`
  - `BTC-USD` market vault:
    - `9Uecz2urPrztYuigxdUbXbQqCCpHBBkNire6PfTKvxVj`
  - `JUP-USD` market vault:
    - `9Uecz2urPrztYuigxdUbXbQqCCpHBBkNire6PfTKvxVj`
  - deposit `0.01 USDC` through `BTC-USD`:
    - tx `5YyxAfFa5Z6KJVnNWVRc4pwxbwwHDkxpYoMcFLvcqo6cznqhVGnMvzbVYiP4KbEcvvUHCd8vjundJM3WxVjFRnUx`
    - global margin after deposit:
      - `balance=5010000`
      - `totalDeposited=5010000`
  - withdraw `0.01 USDC` through `JUP-USD`:
    - tx `CeD6BhE2o55Tro8Xm5ZhKxQLgG2jYUJxcx2gUR2JXUDagtqrSwv91GkdBF31u5D15cVTrHifJkErRReWAeofmPm`
    - global margin after withdraw:
      - `balance=5000000`
      - `totalWithdrawn=10000`
- This proves one migrated owner-scoped margin balance can be used across at least two adopted markets.

### Current blocker

- Shared collateral is now proven on devnet for the operator wallet, but the rollout is not fully productized yet:
  - the migration helper scripts still use `.rpc()` and can falsely timeout on RPCs without `signatureSubscribe`
  - the local tracked rollout files are not committed/pushed yet
- Separate blocker remains unchanged:
  - `open_position_probe_b` callback can still abort with `AbortedComputation (6000) -> InvalidComputationResult (6010)`

### Next safe step

1. Decide whether to commit/push the shared-collateral rollout files now:
   - `programs/shadowperp/src/handlers/shared_collateral.rs`
   - `app/src/idl/shadowperp.json`
   - optionally `app/src/pages/index.tsx`
2. Harden `scripts/adopt-shared-collateral.ts` and `scripts/migrate-shared-margin.ts` to use explicit polling instead of raw `.rpc()` so other operators do not hit false timeout noise.
3. Only after that, run broader wallet-level smoke on additional owners if needed.

## Shared Collateral Migration Lane (2026-04-03 UTC)

### What changed

- Implemented a shared-collateral migration lane in source:
  - shared vault PDA per collateral mint
  - owner-scoped `MarginAccount` PDA
  - adoption instruction for legacy market vaults
  - owner migration instruction for legacy per-market margin balances
- Added migration scripts:
  - `scripts/adopt-shared-collateral.ts`
  - `scripts/migrate-shared-margin.ts`
- Updated settlement/withdraw paths and the generated IDL to match the shared-vault authority model.
- Synced public writeups:
  - `README.md`
  - `ARCHITECTURE.md`
  - `DATA_FLOW.md`
  - `app/src/pages/docs.tsx`

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- `cargo check -p shadowperp` -> PASS
- `anchor idl build` -> PASS
- Copied the rebuilt IDL into `app/src/idl/shadowperp.json`
- Kept `open_position_probe_b` contract untouched:
  - no ArgBuilder layout change
  - no encrypted circuit signature change
  - no callback output contract change

### Current blocker

- This is a migration-backed architecture change, not a silent live flip.
- Existing devnet markets and balances still require the ops runbook before the shared-collateral model should be treated as active:
  1. close or settle legacy open positions
  2. run `scripts/adopt-shared-collateral.ts`
  3. run `scripts/migrate-shared-margin.ts` per owner
- The separate live protocol blocker remains unchanged:
  - `open_position_probe_b` callback can still abort with `AbortedComputation (6000) -> InvalidComputationResult (6010)`

### Next safe step

1. Commit and push the shared-collateral source + docs + migration scripts.
2. Deploy to devnet only alongside the migration runbook above.
3. After migration, run a bounded smoke:
   - deposit once
   - reuse collateral across at least two pairs
   - withdraw from the shared balance
4. Keep the `open_position_probe_b` investigation as a separate lane.

## Trade Status Timing + Global Margin Constraint Review (2026-04-03 UTC)

### What changed

- Reduced terminal auto-dismiss on the trade confirmation/status modal from `15s` to `10s` in:
  - `app/src/components/TradeConfirmationModal.tsx`

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- Confirmed the current blocker for "one margin account across all pairs" is deeper than the PDA seed:
  - `MarginAccount` is still seeded per market in the direct and delegated handlers
  - each market also owns its own collateral vault PDA
  - close/withdraw/settlement paths still settle from the selected market vault, not from a shared global vault

### Current blocker

- A safe cross-market margin account cannot be implemented by changing only margin-account seeds.
- Doing that alone would create balance accounting that appears global while tokens still sit in per-market vaults, which would break withdrawals/settlements and can make markets insolvent.

### Next safe step

1. If we want truly shared collateral across all pairs, design it as a vault + margin model together:
   - shared collateral vault (or explicit vault migration/rebalancing)
   - owner-scoped margin account
   - updated close/liquidation/withdraw settlement paths
2. Do not ship a margin-PDA-only change.

## Pair-Aware Collateral Routing + Overlay Modal Pass (2026-04-03 UTC)

### What changed

- Fixed selected-pair collateral routing in the UI so direct deposit/withdraw no longer silently pin to the SOL market.
- Updated selected-pair margin/position reads in the main trading surfaces:
  - `app/src/components/TradingPanel.tsx`
  - `app/src/components/PortfolioSummary.tsx`
  - `app/src/components/MarketInfo.tsx`
  - `app/src/components/BottomPositionsPanel.tsx`
  - `app/src/components/CollateralModal.tsx`
- Moved the generic order confirmation modal onto a body portal so it overlays terminal panels like the trade status modal:
  - `app/src/components/OrderConfirmModal.tsx`
- Trimmed `DEV_NOTES.md` down to the recent operational window (current 2026-04-02 / 2026-04-03 entries only).

### What was verified

- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- Confirmed the root cause of the user-reported collateral mismatch:
  - the protocol still uses per-market `MarginAccount` PDAs
  - the frontend was also incorrectly reading/writing direct collateral against `runtime.marketAddress` in several places, which effectively pinned direct collateral UX to SOL
- Current code now resolves selected pair markets through `runtime.marketRegistry[pair.label]` in the updated UI surfaces.

### Current blocker

- The frontend routing bug is fixed in source, but a fresh live browser/devnet check is still needed to confirm:
  - direct deposit on a non-SOL pair now lands on that pair's margin account
  - open on that same pair no longer throws the misleading `No collateral deposited` error
- The deeper protocol limitation remains:
  - collateral is still per-market on chain, not one shared cross-market balance

### Next safe step

1. Run one live browser smoke:
   - select a non-SOL pair
   - deposit a tiny amount
   - verify the pair-specific open path sees that collateral
2. If that passes, commit the UI/docs/notes batch.

## Docs Alignment After TradeSessionV2 Deploy (2026-04-03 UTC)

### What changed

- Updated public writeups to match the current devnet state after `TradeSessionV2` deploy and smoke.
- Touched:
  - `README.md`
  - `app/src/pages/docs.tsx`
  - `ARCHITECTURE.md`
  - `DATA_FLOW.md`

### What was verified

- `TradeSessionV2` is now described as deployed and smoke-verified for multi-market delegated collateral actions.
- Session docs now describe the default wallet-scoped delegated session model instead of saying sessions are always market-bound.
- Cookie/localStorage docs now describe the session namespace more accurately for wallet-scoped storage.
- README now includes an explicit devnet limitation note for the still-unresolved `open_position_probe_b` callback failure, so we are no longer implying full end-to-end perp health.

### Current blocker

- Main protocol blocker remains unchanged:
  - delegated open queues successfully
  - callback reaches `OpenPositionProbeBCallback`
  - `verify_output` fails with `AbortedComputation (6000) -> InvalidComputationResult (6010)`

### Next safe step

1. Commit and push the docs alignment pass.
2. Then decide whether to do the small confirmation-hardening follow-up for owner-side approve/fund helpers, or return directly to the `open_position_probe_b` lane.

## TradeSessionV2 Multi-Pair Smoke (2026-04-03 UTC)

### What changed

- No additional product code changes in this pass.
- Ran a bounded devnet smoke for the newly deployed wallet-scoped delegated session (`TradeSessionV2`) without touching `open_position_probe_b`.

### What was verified

- `git status --short` before the smoke showed the expected tracked v2/session files plus local tooling:
  - tracked: `ARCHITECTURE.md`, `DATA_FLOW.md`, `app/src/components/TradeConfirmationModal.tsx`, `app/src/hooks/useArcium.ts`, `app/src/idl/shadowperp.json`, `app/src/lib/client.ts`, `app/src/pages/api/relay/{deposit,open,session,withdraw}.ts`, `app/src/types/index.ts`, `programs/shadowperp/Cargo.toml`, `programs/shadowperp/src/{handlers/session_trading.rs,lib.rs,state/trade_session.rs}`
  - untracked tooling: `.agents/`, `.trae/`, `skills-lock.json`
- Active runtime env from `app/.env.local`:
  - program: `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`
  - canonical market env: `crEV9TSAU6xkiWFUAZebejHmWVh6VFx5EEFLcfX9L2T`
  - cluster offset: `456`
  - RPC: Alchemy devnet
- `npm run check:preflight` remains healthy except oracle freshness can still age out quickly because the live market price is still frozen at `103` and `oracle:once` currently trips the circuit breaker against live sources around `79.3`.
- TradeSessionV2 smoke passed using:
  - owner: `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt`
  - temporary relayer: `6EepAM2yTdMjYu2iDY5sFepww8kGhw4zD7tXuczhMj95`
  - session id: `1775197962`
  - session PDA: `B27EaXY4zdFbM1xTVSDgLLvXAQnwgAGk4X3xmzaqGcoN`
- Funding + session lifecycle txs:
  - relayer funding: `wNnopm722aH6QrH6E9tQsWF3YRgH9YQqPgrpb6ucdgj5kenRpoyUJRQEUC8kweMDKARWdzSSzMwVddgLotr8xAz`
  - create v2 session: `SEYsUpfBux7FEhPFdNBAvHk1dnWqzRkYh2iAdb9tVkttL2P6juuGSUGVmfB1VZkaqJ5sHeCtcYa4PHvc5THMhej`
  - approve owner USDC delegate: `2soexuYuUDd6MqTajV2ArP9zFHgh74T61G5EAnduM5oPhGDp92WrTcwRPzABFpzzisCqsT3ws1HpMbMs7G74TAEQ`
  - revoke v2 session: `p75q6tNzYjpr4LmNRhhjirzhcsCiLPRWwGzFphVRao2C6n1Y8DaXjt2UcwqCyEXidRgRvThgRTMg9yhV9WLKCwY`
- Same v2 session successfully performed delegated collateral actions across two different markets:
  - `BTC-USD` market `BDWSuzRkMgEuAqRFKAuzjjiwnqvJV4dHY7T25REBAhAw`
    - deposit `0.01 USDC`: `4rXAnMcQoRjEqtdKn4Nf5Y6NE8tVLwsk4S6H3cRdptqrmodZmvF9DQUUkAw5jvfeyyu7EDqhanXwkjfLstZyuDXt`
    - withdraw `0.01 USDC`: `24S2qm4d9CrnuvWCPoj9RPvm6gSuWgbbhzmM1TPiPRbPqvUaA7ztp9nGjVmAnxdUXJme2tQiMR1Y5cNFRKwuyAiy`
  - `JUP-USD` market `C54281u2MvmBz7tNtkTCp7snpmR1BSmgQbtWaTMSRPNi`
    - deposit `0.01 USDC`: `53JLCmU64rYKjaUjnDwwY2aFd1biTSKVv4jwnmEchUECpoMcU5JoYzV1TfyADGyru9KZF46x6FZnzxa579MtvKCB`
    - withdraw `0.01 USDC`: `346aron2igThSHwgZ1vBrZtkc6WNAB8tPr2uXxh4TLi8iLk4UX3DLBXzsffuTJMKUFESabXrha5iLuceb1Fab4Lm`
- This confirms one delegated v2 session can be reused across multiple markets for collateral actions without asking for a new session per pair.

### Current blocker

- `TradeSessionV2` itself is now proven for multi-pair delegated collateral actions.
- Main remaining live blocker is still unrelated and unchanged:
  - delegated open queues
  - callback reaches `OpenPositionProbeBCallback`
  - `verify_output` fails with `AbortedComputation (6000) -> InvalidComputationResult (6010)`

### Next safe step

1. Commit and push the current `TradeSessionV2` source/IDL/docs changes now that multi-pair delegated collateral behavior is proven on devnet.
2. Keep the `open_position_probe_b` investigation as a separate follow-up lane.

## Open Smoke Repro + Arcium Playbook Trigger (2026-04-02 UTC)

### What changed

- No product code changes in this pass.
- Ran the devnet open smoke path on the current live namespace and verified the callback failure pattern directly from chain logs.

### What was verified

- `git status --short` at start:
  - `app/src/hooks/useArcium.ts`
  - `app/src/pages/docs.tsx`
  - `app/src/pages/index.tsx`
  - untracked local tooling folders/files only: `.agents/`, `.trae/`, `skills-lock.json`
- Active runtime env from `app/.env.local`:
  - program: `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`
  - market: `crEV9TSAU6xkiWFUAZebejHmWVh6VFx5EEFLcfX9L2T`
  - cluster offset: `456`
  - RPC: Alchemy devnet
- `npm run oracle:once` refreshed oracle:
  - tx `4vppw9iY7hDv2Gcm62ieawZxaEjssEdjviJ8vm3SFkniPL4gSxfYWdZw23zsWUCdiBiJdTvpS4L2UcFGednwqLuR`
- `npm run check:oracle` -> PASS immediately after refresh
- `npx ts-node scripts/smoke-test-devnet.ts --rpc <Alchemy> --trade`:
  - queue tx succeeded:
    - `21vgakf6Q89zGeyJZxpgDXxLy1RMMxND9tF65iWkLD6CPkUkzSrR2NRWmVY3jTuwTSnhCY7sbwtwXnb4ktxtJfF5`
  - derived position:
    - `FeYvxpwo7WM8uJ5bAk7aoLu7YgrKGkFCFq9vyj86SjZx`
  - callback txs landed and both failed:
    - `RfzGRPrgnPyXqpYTRt9QSpyun194zdN5SoVANvV7CRz83kJMNJgwYtQGoUXBNNCmuSWkGG1tCYusuXctFy8g78C`
    - `3hQ9AN2Yy8u3Pd2FsBLfgEbNKoEzZZSw4VxJ2fQzX1MfRMtmKYYBn8Kccjhhb2wVQx6tjTkh6TyeTb7FJWVNGJts`
  - callback logs show:
    - `Instruction: OpenPositionProbeBCallback`
    - `MPC verify failed ... AbortedComputation (6000)`
    - then `InvalidComputationResult (6010)`
- This confirms the current open failure is not a timeout artifact and not a stale-oracle guard once the oracle is refreshed.

### Current blocker

- Main live blocker remains:
  - open queue succeeds
  - callback arrives
  - Arcium output verification fails with `AbortedComputation (6000) -> InvalidComputationResult (6010)`
- Close smoke could not be run because the position never reached `Open`.

### Next safe step

1. Treat this as an Arcium/circuit/comp-def mismatch or runtime abort, not a UI timeout bug.
2. Follow the ShadowPerp-specific Arcium debugging playbook:
   - verify current circuit artifact name/signature for `open_position_probe_b`
   - verify `ArgBuilder` order/types in `programs/shadowperp/src/handlers/open_position.rs`
   - verify callback output shape in `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
   - verify finalized open comp-def binding and artifact sync
   - compare against Arcium examples / `llms-full.txt` when assumptions are unclear
3. Only after that decide whether the next move is:
   - rebuild + deploy + comp-def sync, or
   - escalation with the exact repro packet above

## Open Callback Diagnosis UX Patch (2026-04-02 UTC)

### What changed

- Updated `app/src/hooks/useArcium.ts` so delegated open callback waiting now inspects recent callback transactions for the position and pending computation account.
- When the callback already failed on-chain, the client now throws a specific Arcium-aware error instead of always timing out into a generic pending message.

### What was verified

- `git status --short` before this patch showed only:
  - local docs/landing copy edits in `app/src/pages/docs.tsx` and `app/src/pages/index.tsx`
  - local tooling folders/files (`.agents/`, `.trae/`, `skills-lock.json`)
- Active runtime env from `app/.env.local`:
  - program: `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`
  - market: `crEV9TSAU6xkiWFUAZebejHmWVh6VFx5EEFLcfX9L2T`
  - cluster offset: `456`
  - RPC: Alchemy devnet
- `npm run check:preflight` initially failed only on stale oracle freshness.
- `npm run oracle:once` refreshed the oracle successfully:
  - tx `28nbnvFBvyg4QHHCMqZwaw9oSQFMgHWLTkMQngA9ngAuhj34AnVxj4KcrbTrh1PBKqhLdY6oQx52ndbDrttzNvWH`
- `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- Behavior now:
  - if open stays `Pending` and callback history shows `OpenPositionProbeBCallback` failed, UI can surface a message like:
    - `Queued on Arcium cluster 456, but the MPC callback already failed on-chain: AbortedComputation (6000) -> InvalidComputationResult (6010).`
  - if no callback failure is visible yet, it still falls back to the generic pending timeout message

### Current blocker

- Main protocol blocker is unchanged:
  - open callback path still aborts upstream in Arcium (`6000 -> 6010`) for the known failing repros
- This patch only improves diagnosis; it does not fix the underlying computation abort

### Next safe step

1. Retry one delegated open in the app and capture the new modal error copy.
2. If it reports the on-chain callback failure directly, keep that UX and move back to tracing the open circuit/comp-def/arg path with the Arcium workflow.
3. Separately decide whether to commit the local landing/docs `48h` session copy alignment in `app/src/pages/index.tsx` and `app/src/pages/docs.tsx`.

## Repo Audit Snapshot (2026-04-02 UTC)

### What changed

- No product code changes in this pass.
- Ran a repo-level audit focused on execution integrity, relay/runtime behavior, and product reliability.

### What was verified

- `git status --short` -> only non-product local files:
  - `.agents/`
  - `.trae/`
  - `skills-lock.json`
- Active runtime env from `app/.env.local`:
  - program: `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`
  - market: `crEV9TSAU6xkiWFUAZebejHmWVh6VFx5EEFLcfX9L2T`
  - cluster offset: `456`
  - RPC: Alchemy devnet
- `npm run check:preflight` -> PASS
- Primary audit findings:
  1. UI supports 11 selectable pairs, but execution still routes through one runtime market address unless env is changed.
  2. Confirmation hardening was applied to open flows only; close/deposit/withdraw/settlement paths still rely on `.rpc()` confirmation.
  3. `useArcium` still times out open callbacks after 45 seconds, while docs already say devnet callbacks can take 30 to 120 seconds.
  4. Relay session discovery still downgrades some RPC capability failures into `exists: false`, which can hide active sessions behind provider limits.
  5. Limit orders and TP/SL remain browser-local automation, not relay-side or exchange-side controls.

### Current blocker

- No single blocking code change from this audit pass.
- Main product-level risks are execution-market mismatch, inconsistent confirmation UX across actions, and browser-local automation semantics that are weaker than a typical perp venue.

### Next safe step

1. Either scope the product honestly to one live market, or implement real market-address mapping per pair end to end.
2. Extend the new polling-based confirmation path beyond open flows to close/deposit/withdraw/settlement.
3. Increase open callback wait windows and surface pending state separately from failure.
4. Make relay session lookup distinguish `unavailable` from `not found`.
5. Decide whether TP/SL and limit orders should remain browser-local or move to a durable relay/exchange-side automation model.

## Open Position "Account not initialized" Diagnosis (2026-04-02 UTC)

### What changed

- No product code changes in this pass.
- Traced the current open-position modal failure message back to the margin-account initialization path.

### What was verified

- `git status --short` -> only non-product local files:
  - `.agents/`
  - `.trae/`
  - `skills-lock.json`
- Active runtime env from `app/.env.local`:
  - program: `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`
  - market: `crEV9TSAU6xkiWFUAZebejHmWVh6VFx5EEFLcfX9L2T`
  - cluster offset: `456`
  - RPC: Alchemy devnet
- `npm run check:preflight` -> PASS
- Open flow still requires the owner margin account to exist before queueing:
  - `app/src/pages/api/relay/open.ts:194` comment confirms margin account is created by first deposit, not by `open_position`
  - `app/src/pages/api/relay/open.ts:198` throws `No collateral deposited. Deposit collateral before opening a position.`
- Client-side direct path has the same requirement:
  - `app/src/lib/client.ts:547` throws `Margin account not initialized. Deposit collateral first.`
- UI error text is normalized by:
  - `app/src/lib/arcium-errors.ts:203` -> `Account not initialized`

### Current blocker

- The user-visible open-position error is a wallet-and-market setup issue, not the Arcium callback path yet.
- The connected wallet does not have an initialized margin account on the current market namespace, or the user deposited on an older market/program namespace.

### Next safe step

1. Deposit collateral on the current live market using the connected wallet.
2. Confirm the wallet is funded with the canonical devnet USDC mint configured in preflight.
3. Retry open only after the deposit transaction succeeds.

## Shared Collateral + Global Positions Safety Pass (2026-04-05 UTC)

### What changed

- Hardened legacy/shared-collateral compatibility in:
  - `programs/shadowperp/src/handlers/withdraw_collateral.rs`
  - `programs/shadowperp/src/handlers/settle_close_position.rs`
  - `programs/shadowperp/src/handlers/settle_liquidation.rs`
- Hardened degraded relay-session lookup in:
  - `app/src/pages/api/relay/session.ts`
- Removed unsafe unknown-pair fallback in direct collateral UI:
  - `app/src/components/CollateralModal.tsx`
- Aggregated position/account views across configured markets in:
  - `app/src/lib/client.ts`
  - `app/src/components/BottomPositionsPanel.tsx`
  - `app/src/components/PositionsList.tsx`
  - `app/src/components/PortfolioSummary.tsx`
- Removed the browser-side Gate.io fallback path:
  - `app/src/hooks/useMarketSnapshot.ts`
- Disabled on-chain TP/SL instructions explicitly until a private direction-proof path exists:
  - `programs/shadowperp/src/errors/mod.rs`
  - `programs/shadowperp/src/handlers/tpsl.rs`
- Docs/copy alignment also exists locally in:
  - `README.md`
  - `app/src/pages/docs.tsx`

### What was verified

- Required session-start checks re-run this session:
  - `git status --short`
  - `npm run check:preflight` -> stale oracle first, then PASS after `npm run oracle:once`
- Build checks after the fixes:
  - `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
  - `cargo check -p shadowperp` -> PASS
- The top-level portfolio summary no longer uses the broken nested `getMarginAccount(...)` call.
- Bottom positions, history, and close actions now resolve positions by their actual market instead of the currently selected pair.

### Current blocker

- `open_position_probe_b` remains the main live protocol blocker and was not touched in this pass.
- A user-facing app smoke for the new global positions/collateral behavior still needs to be run before claiming the UX is fully signed off.

### Next safe step

1. Run a wallet-connected app smoke on at least two pairs:
   - deposit/withdraw collateral
   - confirm top open-position count stays global
   - confirm bottom positions/history remain global while switching pairs
2. If the UI smoke passes, commit the current worktree as one reliability-focused batch.
3. Return to the separate `open_position_probe_b` lane afterward.

## Oracle Freshness Check (2026-04-10 UTC)

### What changed

- No product-code changes in this pass.
- Re-ran the mandatory live-state checks to establish the current devnet status before further work.

### What was verified

- `git status --short` -> only local untracked artifacts:
  - `.agents/`
  - `.tmp_app_job_id`
  - `.trae/`
  - `output/`
  - `skills-lock.json`
- Active env in `app/.env.local`:
  - program: `ESyrZFvBAbZmTgjEQwuNCrM7Jwaupt4jkNQE32pBt7N4`
  - market: `crEV9TSAU6xkiWFUAZebejHmWVh6VFx5EEFLcfX9L2T`
  - cluster offset: `456`
  - RPC: Alchemy devnet
- `npm run check:preflight`:
  - program/market/comp-def checks all PASS
  - only failing check is oracle freshness
  - current on-chain oracle still reads `$80.3600`
- `npm run oracle:once` failed because the hardened oracle feeder only got `1/2` healthy external sources:
  - `Fatal: Insufficient oracle sources (1/2). Request timed out after 10s | Request timed out after 10s`
- `npx ts-node scripts/oracle-feed.ts --once --rpc <Alchemy>` also failed operationally:
  - all market updates timed out at the old `30.00 seconds` confirmation path
  - repeated `signatureSubscribe` RPC errors show the script is still using a non-hardened confirmation path on this provider

### Current blocker

- Live trading is still blocked by stale oracle state even though the market/program/comp-def layer is healthy.
- There are two separate oracle-tooling issues:
  1. `price-oracle.ts` is too strict to refresh when fewer than 2 external sources are healthy.
  2. `oracle-feed.ts` still depends on the old `.rpc()`/`signatureSubscribe` confirmation behavior.

### Next safe step

1. Harden `scripts/oracle-feed.ts` to use the same explicit polling confirmation path already used in other rollout scripts.
2. Optionally add a bounded degraded mode to `price-oracle.ts` for stale-oracle recovery when only one healthy source is available and the move is within failsafe bounds.
3. Re-run preflight after one of those two recovery paths succeeds.

## Oracle Feed Polling Hardening (2026-04-10 UTC)

### What changed

- Hardened `scripts/oracle-feed.ts` to stop relying on the old `.rpc()` / `signatureSubscribe` confirmation path.
- The script now uses the shared explicit polling helper from `scripts/rpc.ts` (`sendAndConfirmWithPolling`) so it can confirm updates on RPCs that do not support websocket signature subscriptions.

### What was verified

- Ran:
  - `npx ts-node scripts/oracle-feed.ts --once --rpc https://solana-devnet.g.alchemy.com/v2/Nbazz1j8QfREnu7ryGLtGI03ubwKJJtt`
- Successful market updates:
  - `SOL-USD` -> tx `3M7zsNGA2KWj...`
  - `BTC-USD` -> tx `5ufET2TGPRdZ...`
  - `ETH-USD` -> tx `2icuiEHW1Taj...`
  - `JUP-USD` -> tx `5j3EpoaXruL6...`
  - `PYTH-USD` -> tx `3Yq366scztdS...`
  - `ORCA-USD` -> tx `3jcnZgHhiXgY...`
- Re-ran:
  - `npm run check:preflight`
- Result:
  - PASS
  - oracle freshness restored (`age=46s`)

### Current blocker

- Oracle tooling is healthy again on the current Alchemy RPC.
- Main remaining protocol blocker is still separate and unchanged:
  - `open_position_probe_b` callback can still abort with `AbortedComputation (6000) -> InvalidComputationResult (6010)`

### Next safe step

1. Commit and push the `scripts/oracle-feed.ts` hardening patch.
2. Run a fresh wallet-connected app smoke on two pairs now that oracle freshness is healthy again.
3. Return to the `open_position_probe_b` lane afterward if the app smoke is clean.

## Post-Oracle Live Smoke (2026-04-10 UTC)

### What changed

- Committed and pushed the oracle-feed hardening patch:
  - commit `e8feaea` — `Harden oracle feed confirmation polling`
- No further product-code changes in this pass.

### What was verified

- `npx ts-node scripts/smoke-test-devnet.ts --rpc https://solana-devnet.g.alchemy.com/v2/Nbazz1j8QfREnu7ryGLtGI03ubwKJJtt --trade`
- Smoke result:
  - program deployment: PASS
  - market account + comp-def pointers: PASS
  - MXE / cluster / comp-def accounts: PASS
  - wallet + collateral ATA + margin account: PASS
  - open tx queue: PASS
    - tx `64kpHfXjgMBXbnj9gg4J...`
  - callback finalization within 120s: FAIL
    - position stayed `Pending` for full wait window
- Overall smoke summary:
  - `PASSED: 18`
  - `FAILED: 1`

### Current blocker

- Oracle freshness is healthy again.
- The main live blocker is still the Arcium open callback lane:
  - queueing works
  - callback/finalization still does not complete successfully within the smoke window
  - this remains consistent with the existing `open_position_probe_b` investigation lane

### Next safe step

1. Return to the `open_position_probe_b` debugging/escalation lane with this fresh smoke evidence.
2. If desired, inspect the recent callback/computation accounts for the new queued tx to determine whether this repro was:
   - no callback received
   - or callback received but failed off the main smoke path


## Reference Callback Comparison + Fresh Repro Inspection (2026-04-10 UTC)

### What was checked

- Compared Arcium callback patterns in:
  - `C:\Users\bolaj\AppData\Local\Temp\incognitoballots\programs\incognitoballots\src\lib.rs`
  - `C:\Users\bolaj\AppData\Local\Temp\arcium-examples\voting\programs\voting\src\lib.rs`
- Compared them against local ShadowPerp open path:
  - `programs/shadowperp/src/handlers/open_position.rs`
  - `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
- Inspected fresh smoke repro on devnet via RPC logs.

### What was verified

- Reference repos use the same fundamental callback pattern as ShadowPerp:
  - `queue_computation(...)`
  - generated `Callback::callback_ix(...)`
  - `SignedComputationOutputs<T>`
  - `verify_output(&cluster_account, &computation_account)` before state mutation
- ShadowPerp open queue/callback wiring still matches that pattern.

Fresh repro packet:
- queue tx:
  - `64kpHfXjgMBXbnj9gg4JdQEDNgSHskoB2T8BTFnheXRcjR7eZAU1vLUWcpgfGEfJ91sXgt6e4a2Knogr3jnEd626`
- position:
  - `9Tewpys9uMBuRMt7j7fLNfBaFePSyzdTNqqHd7PfRkF7`
- computation account:
  - `53e95BoYHfPxhvQkjPZwxm9WVGSuu2d5P1rtCxnh4jJy`

Queue tx logs:
- `Instruction: OpenPosition`
- Arcium `Instruction: QueueComputation`
- tx success

Callback evidence:
- position account shows repeated callback failures with `6010`
- computation account shows repeated Arcium-side failure txs with `6000`
- inspected callback tx:
  - `2Fa7EEmTsGC8byb55ABb7QVWjW9DW6YMyMGe96PHhYaR4JGCgGrxbdgc9SMDdRSfdaQ2C5orx7pV8SM9dEt2tB7P`
- callback logs:
  - Arcium `Instruction: CallbackComputation` succeeded
  - ShadowPerp `Instruction: OpenPositionProbeBCallback`
  - `MPC verify failed for position ... AbortedComputation (6000)`
  - then `InvalidComputationResult (6010)`

Additional Arcium-side failure evidence:
- inspected computation-account tx:
  - `3D7N2jQnBJPSPPhB2ADg3ZvhLiG11zZKsD1pRrxao6SAztkN9HvdQMh2zCwCjWNfHg9UtQMYk1N5QkqghivV5uqP`
- logs show:
  - `Instruction: ReclaimFailureRentIdempotent`
  - `InvalidAuthority (6000)` inside Arcium program failure path
- later tx:
  - `WZEdk6dXbjaP36FeL2TTpoJZD1Vf8ctikp9WgXdpxh5AdmpxuyowmtZ1jqvs1f6q6jPZMfXtmDWbPnLwnVezBtN`
  - shows Arcium failure-claim sequence eventually succeeding

### Current blocker

- The latest smoke is not a missing-callback case.
- Callbacks do land and fail repeatedly on-chain.
- Reference repos do not reveal a missing callback pattern in ShadowPerp.
- Current evidence still points to one of:
  1. live `open_position_probe_b` comp-def/artifact drift
  2. genuine Arcium runtime abort for the open computation contract
- New nuance: Arcium failure-reclaim handling also shows intermittent `InvalidAuthority (6000)` on the computation account path during retries.

### Next safe step

1. Verify or disprove live `open_position_probe_b` comp-def/artifact drift against the deployed program and local artifact.
2. If no drift is found, escalate with the exact repro packet above, including the Arcium failure-reclaim tx evidence.

### Live Comp-Def Drift Check (2026-04-10 UTC)

- Verified live `open_position_probe_b` comp-def directly from chain state:
  - comp-def: `8UQb2ma8SV5CVnwcqo2B5cmT7sefrzM9mD41jvtbWmPY`
  - finalized: `true`
  - upload auth: `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt`
  - params: `9`
  - outputs: `1`
  - circuit_len: `785440`
- Compared against local artifact:
  - `build/open_position_probe_b.arcis`
  - local length: `785440`
  - local `.hash` exists, but on-chain comp-def account does not expose a directly comparable artifact hash in the fetched fields.
- Conclusion:
  - obvious live comp-def/artifact drift is **not supported** by the available evidence.
  - current evidence now points more strongly to a genuine Arcium runtime abort / failure-path issue for `open_position_probe_b`, not a callback wiring mismatch and not an easy comp-def size/signature drift.

## Codebase Audit Snapshot (2026-04-10 UTC)

### What was verified
- `git status --short` clean for tracked files; only local untracked tooling/artifacts remain.
- `pnpm --dir app exec tsc --noEmit --incremental false` passed.
- `cargo check -p shadowperp` passed with warnings.
- `npm run check:preflight` failed only on stale oracle before refresh.
- `npm run oracle:once` recovered the oracle, but still emitted `signatureSubscribe` noise because `scripts/price-oracle.ts` uses the older `.rpc()` path in its publish branch.

### Audit findings
1. Several client/operator paths still use `.rpc()` / provider confirmation instead of polling-safe confirmation, including close/liquidation settlement and the main oracle publisher.
2. Funding scaffolding exists, but funding is not actually connected to position lifecycle yet; `PositionFundingRef` is defined but not created/used.
3. On-chain TP/SL is explicitly disabled, while the user-facing experience still relies on browser-local automation.
4. The current live blocker remains `open_position_probe_b` callback verification on devnet.

### Next safe step
1. If we choose to fix infra reliability next, convert the remaining `.rpc()` paths in `client.ts` and `price-oracle.ts` to polling-safe sends.
2. If we choose to improve product depth next, wire funding into real position entry/exit lifecycle before exposing it as a serious perp primitive.

## Sprint 1 Reliability Pass (2026-04-10 UTC)

### What changed
- Hardened remaining user/operator confirmation paths in:
  - `app/src/lib/client.ts`
    - `approveCollateralDelegate`
    - `closePosition`
    - `closePositionWithSession`
    - `checkLiquidation`
    - `settleClosePosition`
    - `settleLiquidation`
    - `updateOraclePrice`
  - `scripts/price-oracle.ts`
- All of the above now build transactions and use polling-safe confirmation instead of `.rpc()` / provider confirmation.
- Added clearer shared-collateral visibility in the UI:
  - `app/src/components/PortfolioSummary.tsx`
    - computes `freeCollateral` and `lockedCollateral`
    - surfaces `Free Collateral` in the market summary
  - `app/src/components/CollateralModal.tsx`
    - shows `Total / Free / Locked`
    - withdraw quick-actions and validation now use free collateral, not total balance

### What was verified
- `pnpm --dir app exec tsc --noEmit --incremental false` passed.
- `cargo check -p shadowperp` passed.
- `npm run oracle:once` passed with the new polling-safe publisher path.
- `npm run check:preflight` passed after oracle refresh.
- `hosting:start` succeeded and local app shell loaded on `http://localhost:3000`.

### Current blocker
- `open_position_probe_b` remains the main live protocol blocker.
- The new collateral visibility UI is wallet-gated, so headless mobile verification could only confirm shell/load behavior, not a fully connected-wallet collateral modal render.

### Next safe step
1. Do a wallet-connected app smoke on desktop + mobile to verify the new `Total / Free / Locked` collateral view and withdraw gating.
2. If that looks good, commit and push this Sprint 1 reliability batch.

## Wallet-Connected UI Verification (2026-04-10 UTC)

### Confirmed
- Manual wallet-connected desktop and mobile verification is complete.
- The collateral modal now reflects the shared-collateral model with `Total / Free / Locked` balance treatment.
- Withdraw behavior is gated by free collateral rather than total balance.

### Product takeaway
- Shadow should not position itself as “another Solana perp.”
- Stronger whitespace:
  - confidential perps for traders who want hidden positions and hidden order flow
  - privacy execution rails that plug into existing liquidity instead of bootstrapping all liquidity from scratch
  - delegated/private trading infrastructure for wallets, bots, or frontends that want protected execution on Solana

## Public Positioning Update (2026-04-10 UTC)

### What changed
- Updated public copy in the landing page, README, docs, and architecture overview to frame Shadow as confidential execution infrastructure rather than a generic perp DEX.
- The public story now emphasizes:
  - confidential perps
  - privacy execution rails
  - delegated/private trading infrastructure

### What was verified
- `pnpm --dir app exec tsc --noEmit --incremental false` passed.

### Next safe step
1. If you want the same framing reflected in more external copy, update the social/marketing snippets next.
2. Otherwise, move on to the next product gap lane.

## Indexed History MVP (2026-04-10 UTC)

### What changed
- Added a server-backed history snapshot at `app/src/pages/api/history.ts`.
- Added shared history response types in `app/src/lib/history.ts`.
- Added server-side history indexing in `app/src/lib/server/history.ts`:
  - wallet activity comes from finalized signatures + parsed transaction enrichment
  - closed/liquidated position snapshots are fetched server-side across markets
- Updated the wallet popup to prefer the server history snapshot and fall back to the existing local RPC parser if needed.
- Updated the bottom positions panel history tab to prefer the server-indexed closed/liquidated list and fall back to the current on-chain filter if needed.

### What was verified
- `pnpm --dir app exec tsc --noEmit --incremental false` passed.

### Current blocker
- `open_position_probe_b` is still unchanged and remains the main live protocol blocker.
- The history MVP is intentionally narrow: it indexes activity and closed/liquidated snapshots first, but it does not yet replace browser-local order protection / TP-SL metadata.

### Next safe step
1. Smoke the wallet popup activity tab and bottom-panel history tab against the new API route.
2. If the output looks right, commit and push this indexed-history MVP.

## Indexed History Smoke (2026-04-10 UTC)

### What was checked
- Browser smoke against the new history API route on localhost:
  - `GET /api/history?wallet=5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt&limit=5&includePositions=true`
- App shell smoke on `http://127.0.0.1:3000/app`

### What happened
- The history API returned `ok: true` with recent activity rows and a structured `historyPositions` list shape.
- The app shell loaded normally and the bottom panel still rendered the `Trade History` tab with the new count badge.
- Browser console noise was limited to normal dev-server/HMR / favicon noise, not a history-route failure.

### Current blocker
- `open_position_probe_b` remains unchanged and is still the main live protocol blocker.

### Next safe step
1. If you want to inspect the new history UI more deeply, do a wallet-connected smoke next.
2. Otherwise, move on to the next product gap lane and keep the history MVP as the current baseline.
## Audit Pass (2026-04-11 UTC)

Verified live:
- `npm run check:preflight` passed.
- Oracle freshness was healthy during the audit window.

Audit findings to keep in view:
- `app/src/lib/server/history.ts` still resolves only the first RPC candidate, so the new history API can fail on a bad primary even when fallback RPCs are healthy.
- `scripts/upload-circuits.ts` still uses `provider.sendAndConfirm(...)` for comp-def finalization, which leaves one operator helper on the old confirmation path.
- `app/src/pages/api/history.ts` rate-limits by wallet query string only, so the expensive `includePositions=true` path is still easy to fan out across arbitrary wallet values.

No code changes were made during this audit pass.

## UI Surface Polish Pass (2026-04-11 UTC)

### What changed
- Tightened the main trading terminal UI without changing protocol behavior:
  - `app/src/components/PriceChart.tsx`
    - added a softer loading state
    - added a hard fallback card with retry and TradingView escape hatch when the embed stalls
  - `app/src/components/MarketInfo.tsx`
  - `app/src/components/PortfolioSummary.tsx`
    - upgraded thin metric strips into clearer card-like stat surfaces for better scanability
  - `app/src/components/TradingPanel.tsx`
    - softened session / submit language
    - clarified the order summary section
    - updated the order review copy to read more human
  - `app/src/components/BottomPositionsPanel.tsx`
    - replaced repeated `MPC Processing` language with calmer state labels and helper detail
  - `app/src/components/PositionsList.tsx`
    - aligned legacy position-card wording with the calmer `Queued` / `Finalizing` / `Resolved` state language
  - `app/src/components/TradeConfirmationModal.tsx`
    - normalized raw error strings into trader-facing explanations
    - preserved technical detail inside the expanded error state
  - `app/src/components/CollateralModal.tsx`
    - clarified what is public vs protected
    - improved header hierarchy and action copy
  - `app/src/components/WalletPopup.tsx`
  - `app/src/components/OrderConfirmModal.tsx`
    - improved wallet/collateral wording and summary hierarchy
  - `app/src/pages/docs.tsx`
    - updated the FAQ to match the new queue/finalization wording instead of the older `MPC Processing` label
  - Follow-up preference change:
    - removed the extra execution explainer card and helper sentence from the trading panel after review
    - restored the lower separator on the market strip so it reads as its own panel again
    - removed the long-load chart fallback modal and kept only the lighter inline loading state
    - trimmed the market strip and summary cards slightly so the lower boundary reads more like the other standalone panels
    - added a touch more bottom breathing room inside the market strip so the lower separator matches the standalone panel feel more closely
    - tightened the market strip bottom spacing again and increased its border thickness from 2px to 3px for a stronger panel boundary
    - reduced the shared app scrollbar thickness globally so scrollable panels feel less visually heavy
    - refined the shared scrollbar thickness again from 3px to 2px based on UI review

### What was verified
- `pnpm --dir app exec tsc --noEmit --incremental false` passed.

### Current blocker
- `open_position_probe_b` remains the main live protocol blocker.
- A non-wallet mobile smoke is complete, but a wallet-connected mobile smoke is still outstanding for collateral/session flows.

### Next safe step
1. Run a wallet-connected mobile smoke for collateral/session flows and a final desktop visual pass for the latest market-strip spacing tweaks.
2. If those surfaces still look right, keep this UI baseline as the current release candidate.

## Mobile Smoke (2026-04-11 UTC)

### What was checked
- Browser-driven mobile viewport smoke on `http://localhost:3000/app` at `390x844`.
- Mobile checks covered:
  - header layout
  - market strip after the recent spacing/border tweaks
  - chart tab load
  - trading panel fit
  - bottom positions section
  - mobile wallet popup modal behavior

### What happened
- The mobile shell loaded successfully and the updated market strip remained intact after the latest spacing changes.
- The chart tab rendered and the trading panel stayed within the viewport without layout breakage.
- The wallet popup opened as a centered mobile modal and the updated copy/hierarchy rendered correctly.
- Console noise was limited to known dev-only / environment issues:
  - Next.js HMR warning
  - missing local favicon
  - transient external RPC SSL errors from ZAN
  - TradingView websocket warning

### Current blocker
- No new mobile-specific UI regression was found in the non-wallet smoke.
- A wallet-connected mobile pass is still needed for deposit/session/settings flows.

### Next safe step
1. Run one wallet-connected mobile pass to verify collateral/session/settings interactions.
2. If that also looks clean, no further mobile UI patch is needed for this batch.

## Asset Follow-up (2026-04-11 UTC)

### What changed
- Added `app/public/favicon.ico` as a real fallback icon asset to match the existing `/favicon.ico` reference in the app document head.

### What was verified
- `GET /favicon.ico` returned `200` on the local app server.

### Notes
- This fixes the missing favicon request seen during the mobile/browser smoke.
- The remaining browser console noise from HMR, external RPC SSL failures, and TradingView websocket behavior is environment/provider-related and was not changed in this pass.

## Trader History + Callback Copy Pass (2026-04-11 UTC)

### What changed
- `app/src/hooks/useArcium.ts`
  - treated `Closed` after queue as a callback-abort diagnosis path instead of falling back to the vaguer `unexpected status Closed` error
- `app/src/components/TradeConfirmationModal.tsx`
  - normalized callback-abort cases into clearer trader copy: `Arcium callback aborted`
  - mapped `callback already failed on-chain`, `resolved to Closed instead of Open`, `unexpected status Closed`, `AbortedComputation`, and `InvalidComputationResult` into the same honest error family
- `app/src/components/BottomPositionsPanel.tsx`
  - expanded the lower panel into trader-facing tabs:
    - `Positions`
    - `Open Orders`
    - `Balances`
    - `Order History`
    - `Trade History`
    - `Funding History`
    - `Position History`
  - kept data-source boundaries explicit:
    - balances pull live wallet balances plus margin-account total/free/locked
    - order history uses browser-managed automation state
    - trade history uses indexed wallet activity
    - position history uses closed/liquidated position accounts
    - funding history shows an honest placeholder until that ledger is wired
  - normalized all lower-panel tables to the same shared table shell so the row cards match the main positions tab footprint

### What was verified
- `pnpm --dir app exec tsc --noEmit --incremental false` passed.

### Current blocker
- The core open-lane protocol blocker is still the Arcium callback abort on devnet.
- Funding history is still not backed by a dedicated Shadow data source yet; the new tab is intentionally a placeholder.

### Next safe step
1. Do one browser QA pass on the new lower-panel tabs to check spacing, scrolling, and empty states.
2. If the UI feels right, commit this pass separately from any unrelated landing-page or layout work already sitting in the tree.

## Privy Embedded Wallet Compatibility Pass (2026-04-16 UTC)

### What changed
- `app/src/lib/use-anchor-wallet.ts`
  - extended the compat wallet wrapper to expose `signMessage` for both wallet-adapter wallets and Privy embedded wallets when the provider supports it
- `app/src/hooks/useArcium.ts`
  - moved session-auth identity and message signing onto `useAnchorWalletCompat()` instead of raw `useWallet()`
- `app/src/components/TradingPanel.tsx`
  - switched encrypted automation persistence unlocks to the compat wallet so Privy email/social users can use the same signed persistence path as external wallets
- `app/src/pages/app.tsx`
  - stopped treating embedded-wallet users as sessionless
  - session ownership and the session timer chip now use the compat wallet public key, so delegated sessions can show up for Privy users too

### What was verified
- `pnpm --dir app exec tsc --noEmit --incremental false` passed on April 16, 2026.

### Current blocker
- This pass fixes the code-path assumptions, but it does not prove live Privy behavior by itself.
- A real devnet smoke is still needed for:
  - email/social login
  - delegated session creation
  - collateral deposit
  - one delegated open request through the Railway relay

### Next safe step
1. Redeploy the current frontend so the hosted Privy and Railway relay envs are active together.
2. Run one live Privy devnet smoke from the browser and confirm:
   - session creation succeeds
   - collateral deposit works
   - order submission reaches the same queue/finalize path as external wallets
3. If that smoke passes, commit only the Privy/relay hardening files separately from unrelated UI work already in the tree.

## Embedded Wallet Direct Path Split (2026-04-16 UTC)

### What changed
- Adopted an explicit wallet execution model:
  - `external` wallets use delegated session trading
  - `embedded` Privy wallets sign and submit directly without relay/session dependency
- `app/src/lib/use-anchor-wallet.ts`
  - added `useWalletExecutionMode()` to centralize the external vs embedded decision
- `app/src/hooks/useArcium.ts`
  - embedded-wallet mode now skips relay availability/session recovery entirely
  - `ensureRelaySession()` and `createRelaySession()` now reject for embedded Privy wallets instead of silently routing them into delegated flow
  - `submitPrivateOrder()` now uses direct `client.openPosition(...)` for embedded wallets while preserving the same callback-finalization wait path
- `app/src/pages/app.tsx`
  - session timer chip is shown only for external wallets
  - settings session controls are hidden for embedded wallets
- `app/src/components/PortfolioSummary.tsx`
  - embedded users now resolve account state from the compat wallet and do not pass relay affordances into collateral UI
- `app/src/components/BottomPositionsPanel.tsx`
  - main lower panel now treats embedded Privy wallets as connected via the compat wallet instead of wallet-adapter-only state

### What was verified
- `pnpm --dir app exec tsc --noEmit --incremental false` passed on April 16, 2026 after the execution-mode split.

### Current blocker
- The product rule is now encoded in the frontend, but the embedded-wallet direct path still needs a live browser smoke to confirm Privy signing works end to end on:
  - direct encrypted open
  - direct deposit
  - direct withdraw

### Next safe step
1. Run one embedded-wallet browser smoke on devnet:
   - sign in with email/social
   - confirm embedded wallet auto-creation
   - deposit collateral directly
   - open one encrypted position directly
   - verify no session chip or session settings appear anywhere
2. Separately run one external-wallet smoke to confirm delegated session UX still behaves exactly as before.

## Railway Root Deploy Guard (2026-04-16 UTC)

### What changed
- Added a repo-root `railway.toml` that explicitly builds and starts the Node relay from `relay/`.
- This is meant to protect Railway deployments that are accidentally pointed at the monorepo root, where Railpack otherwise detects the top-level Rust workspace via `Cargo.toml` and fails with `No start command detected`.

### What was verified
- Confirmed the relay already had its own nested Railway config in `relay/railway.toml`, but root deploys would not pick that up automatically.
- Confirmed there was no repo-root `railway.toml` before this patch.

### Current blocker
- Railway still needs either:
  - the service root directory set to `relay`, or
  - the new repo-root `railway.toml` committed and deployed from the repo root.

### Next safe step
1. Commit the root `railway.toml`.
2. In Railway, either keep the service pointed at the repo root and redeploy, or set the service root directory to `relay`.
3. Verify the deploy starts with `node dist/index.js` from the relay build output instead of Rust autodetection.

## Panel Shell Border Cleanup (2026-04-16 UTC)

### What changed
- Moved the market-panel separator treatment back into the shared `DraggablePanel` shell instead of styling it directly inside `MarketInfo`.
- Added an explicit `borderClassName` override on `DraggablePanel` so the market panel can keep a thicker lower separator without making `allowOverflow` responsible for visual styling.
- Removed the inline `boxShadow` separator hack from `MarketInfo`.

### What was verified
- `pnpm --dir app exec tsc --noEmit --incremental false` passed on April 16, 2026.

### Current blocker
- `npm run check:preflight` currently fails in this environment with `Non-base58 character`, so the broader env/program preflight remains blocked on configuration cleanup rather than this UI change.

### Next safe step
1. Visually smoke the desktop and mobile trading layout to confirm the market panel separator matches the intended 2px standalone look.
2. Fix the invalid env/program value causing `check:preflight` to fail before treating the full session baseline as green again.

## Direct Wallet + Product Copy Alignment (2026-04-17 UTC)

### What changed
- Moved the frontend toward a direct-wallet model instead of a delegated-session-first model.
- `app/src/pages/_app.tsx`
  - wired Privy Solana connectors with `toSolanaWalletConnectors(...)`
  - set `appearance.walletChainType` to `solana-only`
  - removed wallet-adapter modal/adapters from the visible connection path while keeping a minimal `WalletProvider` shell for compatibility
- `app/src/lib/use-anchor-wallet.ts`
  - replaced wallet-adapter-first signer selection with a Privy-centered compat layer
  - added wallet connection state helpers so embedded and external Solana wallets resolve through one source of truth
- `app/src/hooks/useArcium.ts`
  - `submitPrivateOrder()` now uses the direct `client.openPosition(...)` path for trading
  - returned relay/session UI state is now stubbed idle/null so the app stops advertising delegated flow
- `app/src/pages/app.tsx`
  - removed the session chip/header UX
  - switched connect-wallet UX to Privy `connectWallet()` for external Solana wallets
  - kept embedded-wallet export affordance
- `app/src/components/CollateralModal.tsx`
  - removed delegated collateral submission branch from the live modal flow
  - collateral actions now describe and use the direct wallet path
- Updated wallet-aware UI components to use the new compat wallet state:
  - `app/src/components/PortfolioSummary.tsx`
  - `app/src/components/BottomPositionsPanel.tsx`
  - `app/src/components/NetworkIndicator.tsx`
  - `app/src/components/WalletPopup.tsx`
  - `app/src/components/PositionsList.tsx`
- Updated front-facing product copy:
  - `README.md`
  - `app/src/pages/docs.tsx`
  - `app/src/pages/index.tsx`
  - copy now frames Shadow as a private perp DEX for human traders, not as session-first infrastructure

### What was verified
- `pnpm --dir app exec tsc --noEmit --incremental false` passed on April 17, 2026 after the direct-wallet migration and copy refresh.

### Current blocker
- The code now compiles and the product copy matches the current direct-wallet direction, but the new Privy-owned external-wallet path still needs a real browser smoke on devnet.
- `npm run check:preflight` is still not green in this environment because of the existing `Non-base58 character` config issue noted earlier.

### Next safe step
1. Run a live browser smoke with:
   - Privy email/social login
   - embedded wallet deposit
   - direct open-position attempt
2. Run a second smoke with an external Solana wallet connected through Privy.
3. Fix the invalid env/program value that is still breaking `npm run check:preflight`.

## Direct Wallet Cleanup Pass (2026-04-17 UTC)

### What changed
- Removed leftover relay/session props and imports from `app/src/components/CollateralModal.tsx`.
- Simplified `app/src/components/PortfolioSummary.tsx` so collateral management no longer threads unused relay/session state through the UI.
- Removed the old session section from `app/src/components/layout/SettingsPanel.tsx` so settings reflect the direct-wallet product path.
- Cleaned `app/src/components/TradingPanel.tsx` by:
  - dropping unused relay/session destructuring
  - removing the session refresh polling effect
  - letting the limit-order executor run on the active direct wallet path instead of an always-false session gate

### What was verified
- `rg -n "relaySession|isRelaySessionActive|revokeRelaySession|ensureRelaySession|refreshRelaySession|invalidateRelaySession|relayAvailable" app/src -g "*.tsx"` returned no remaining TSX references after the cleanup.
- `pnpm --dir app exec tsc --noEmit --incremental false` passed on April 17, 2026 after the cleanup pass.

### Current blocker
- `app/src/hooks/useArcium.ts` still contains legacy relay/session internals behind stubbed return values. They are not currently wired into the live UI, but the hook itself still deserves a dedicated reduction pass.
- `npm run check:preflight` remains blocked by the existing `Non-base58 character` env/config issue.

### Next safe step
1. Do a focused cleanup pass inside `app/src/hooks/useArcium.ts` to remove dead relay/session internals without changing the direct open-position callback behavior.
2. Run a browser smoke for embedded and external Privy wallet flows after that reduction.
3. Fix the invalid base58 env/program value so the repo baseline preflight is green again.

## useArcium Direct-Path Reduction (2026-04-17 UTC)

### What changed
- Replaced the old `app/src/hooks/useArcium.ts` delegated-session-heavy implementation with a smaller direct-wallet hook.
- Kept the live Arcium-sensitive pieces intact:
  - encrypted open-position submission
  - market leverage validation
  - scaled amount conversion
  - callback wait loop
  - callback failure diagnosis from recent transaction logs
- Removed the unused relay/session runtime internals from the hook itself:
  - session storage hydration/recovery
  - relay availability probing
  - delegated session creation/auth/reconnect flows
  - collateral delegation preparation
  - relay revocation logic
- Preserved compatibility exports and stubbed return fields so existing imports continue compiling while the app finishes its direct-wallet transition.

### What was verified
- `pnpm --dir app exec tsc --noEmit --incremental false` passed on April 17, 2026 after the hook rewrite.
- A repo sweep confirmed the previously removed relay/session TSX references stayed gone after the hook reduction.

### Current blocker
- The code path is now much smaller and matches the live product direction better, but it still needs browser smoke coverage for:
  - Privy embedded wallet open flow
  - Privy external wallet open flow
  - callback failure copy in the modal
- `npm run check:preflight` is still blocked by the existing `Non-base58 character` environment/config issue.

### Next safe step
1. Run a live browser smoke on devnet for embedded and external Privy wallet paths.
2. Fix the invalid base58 env/program value so `npm run check:preflight` can pass again.
3. After that, do a final audit for any remaining direct-wallet documentation or code comments that still imply delegated sessions are active.

## Audit Fix Pass + Privy Connect Cleanup (2026-04-17 UTC)

### What changed
- Fixed `scripts/stable-preflight.ts` public-key parsing so it now normalizes quoted or wrapped env values the same way the frontend runtime already does.
- Fixed the relay delegated-withdraw validator in `relay/src/index.ts` so `max_margin_per_action` is no longer enforced for withdraw requests.
- Hardened `app/src/lib/server/history.ts` to iterate across configured RPC candidates instead of always pinning wallet history to the first endpoint only.
- Updated `ARCHITECTURE.md` and `DATA_FLOW.md` so the root repo docs reflect the current direct-wallet / Privy-first product path while still documenting delegated session flows as legacy or optional.
- Simplified the disconnected wallet CTA in `app/src/pages/app.tsx` to a single Privy-owned connect button instead of a split email/social vs external-wallet chooser.

### What was verified
- `pnpm --dir app exec tsc --noEmit --incremental false` passed on April 17, 2026 after the audit fix pass.
- `npm run check:preflight` now gets past env parsing and program/account checks successfully.
- Current remaining preflight failure is now a real operational issue:
  - oracle freshness failed with stale age on the current namespace
  - this replaced the earlier misleading `Non-base58 character` blocker

### Current blocker
- The repo baseline is no longer blocked on malformed env parsing, but devnet oracle freshness is currently stale and still keeps `check:preflight` from going fully green.
- Relay local typecheck still depends on the relay workspace dependencies being installed in this checkout.

### Next safe step
1. Run `npm run oracle:once` or bring the feeder back to a healthy state, then rerun `npm run check:preflight`.
2. Smoke the unified Privy connect button for:
   - email/social login
   - external Solana wallet connection
3. If we want relay verification locally too, install the relay workspace deps and run its TypeScript check again.

## Oracle Recovery Hardening (2026-04-17 UTC)

### What changed
- Hardened `scripts/price-oracle.ts` so it now normalizes quoted or wrapped public-key env values before constructing `PublicKey`, matching the safer parsing already used by preflight.
- Added retry-backed HTTP fetching for external price sources so transient upstream resets do not collapse the composite feed on the first network blip.
- Added Kraken as an extra public reference source for SOL-USD.
- Added a guarded stale-recovery override in `scripts/price-oracle.ts`:
  - normal circuit-breaker protection still applies for fresh markets
  - if the on-chain oracle is already badly stale, at least the minimum source count is healthy, and source disagreement stays low, the feeder can now repair the oracle even when the catch-up move is larger than the normal 500 bps breaker

### What was verified
- `npm run oracle:once` passed on April 17, 2026 and published a fresh SOL oracle update on devnet.
- `npm run check:preflight` passed on April 17, 2026 after the oracle repair.
- `pnpm --dir app exec tsc --noEmit --incremental false` remained green after the oracle-script hardening.

### Current blocker
- Baseline repo health is back to green for preflight, but the new unified Privy connect path still needs a real browser smoke on devnet.
- There are still unrelated local edits in the worktree that should stay out of this commit unless explicitly requested.

### Next safe step
1. Browser-smoke the single Privy connect CTA for:
   - email/social login
   - external Solana wallet login through Privy
2. Commit only the audit-fix, oracle-hardening, doc-alignment, and connect-button files.
3. Leave the unrelated local UI/layout edits untouched until they are reviewed separately.
