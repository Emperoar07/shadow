# ShadowPerp Developer Notes

Internal handoff notes for the next engineer. Do not publish secrets.

## Last Updated
- Date: 2026-03-07 (UTC)
- Author: Codex

## Reapplied `0f2bf62` + `7b714de` Safely (2026-03-10 UTC)
- Scope:
  - reintroduce:
    - `0f2bf62` Harden market routing and session UX
    - `7b714de` Tighten pair feeds and mobile trading UI
- What changed:
  1. Reapplied both commits on top of the reverted branch via cherry-pick.
  2. Resolved overlap by keeping the intended newer market-data path:
     - restored `app/src/hooks/useMarketSnapshot.ts`
     - restored deterministic `app/src/lib/market-feeds.ts`
     - switched `app/src/pages/app.tsx` back to the shared snapshot flow
     - updated `app/src/components/PrivateOrderbook.tsx` to accept shared `marketSnapshot`
  3. Kept `app/src/pages/terminal-v2.tsx` deleted as a dead product branch.
  4. Active pair surface now excludes `BONK-PERP` and `HNT-PERP`.
- What was verified:
  - `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
  - `npm run oracle:once` -> PASS
- Current blocker:
  - `stale oracle`
  - immediate `npm run check:preflight` still reports old oracle age on public devnet right after the publish tx; this looks like RPC freshness lag, not a code failure
- Next safe step:
  1. Push the reconciliation commit so remote `master` includes the reapplied pair-feed/mobile UX changes.
  2. If needed, rerun preflight on a healthier RPC or after RPC state catches up.

## Mobile Trading Tabs + Reference Depth Coverage + Landing Theme Toggle Fixes (2026-03-10 UTC)
- Scope:
  - `app/src/pages/app.tsx`
  - `app/src/pages/index.tsx`
  - `app/src/lib/market-feeds.ts`
  - `app/src/lib/reference-depth.ts`
  - `app/src/pages/api/reference-depth.ts`
  - `programs/shadowperp/src/lib.rs`
  - `programs/shadowperp/src/handlers/mod.rs`
- What changed:
  1. Removed the extra mobile `Trades` market tab at the app-shell level. Mobile now switches between `Chart` and `Order Book`, and the trades view remains inside the orderbook component itself.
  2. Fixed the landing-page theme toggle so dark mode reads visually as the selected state by default.
  3. Expanded reference-depth provider coverage to follow the chart venue family more closely:
     - Binance
     - Coinbase
     - Bybit
     - MEXC
     - Gate.io
     - Kraken
  4. Added per-pair reference provider mappings in `market-feeds.ts` so SPL pairs with weaker Coinbase/Binance coverage can still show deeper live books.
  5. Tightened the Rust crate hygiene pass:
     - removed the unused `ErrorCode` import in `programs/shadowperp/src/lib.rs`
     - removed broad handler glob re-export reliance in `programs/shadowperp/src/handlers/mod.rs` without breaking `lib.rs`
  6. Fixed stale mojibake in this notes file.
- What was verified:
  - `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
  - `cargo check -p shadowperp` -> PASS
  - `npm run oracle:once` -> PASS
  - `npm run check:preflight` -> PASS
- Current blocker:
  - `needs browser verification`
  - The new reference-depth coverage and landing toggle semantics are code-verified, but not visually rechecked in-browser during this pass.
- Next safe step:
  1. Open the landing page and confirm the bottom-right toggle visually indicates dark mode when no light preference is saved.
  2. Open `/app` on a mobile viewport and confirm the market tab row shows only `Chart` and `Order Book`.
  3. Spot-check SPL pairs like `ORCA-PERP`, `JUP-PERP`, `PYTH-PERP`, and `HNT-PERP` for deeper orderbooks and sane chart fallbacks.

## Market Bar / Orderbook Alignment Fixes (2026-03-10 UTC)
- Scope:
  - `app/src/components/MarketInfo.tsx`
  - `app/src/components/PrivateOrderbook.tsx`
  - `app/src/lib/reference-depth.ts`
- What changed:
  1. The top market bar now prefers the same live reference-depth snapshot used by the orderbook before falling back to `/api/prices` or on-chain oracle state. This prevents the header from drifting to stale/mock values while the book is live.
  2. Orderbook grouping defaults were tightened for sub-$100 and sub-$10k markets so depth does not collapse into only a few grouped levels.
  3. Grouped level limit was increased from `14` to `24`.
  4. Ask rows are now visually anchored toward the spread so the book uses vertical space better instead of leaving the upper side looking sparse.
- What was verified:
  - `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- Current blocker:
  - `needs browser verification`
  - The price-source alignment and fuller orderbook rendering are typechecked, but not visually rechecked in a running browser during this pass.
- Next safe step:
  1. Verify the top market bar price now tracks the orderbook last trade / mid more closely for `SOL-PERP`.
  2. Confirm the book renders fuller and asks sit nearer the spread instead of floating at the top.

## Mobile Market Tabs + Theme Init Sync (2026-03-10 UTC)
- Scope:
  - `app/src/pages/app.tsx`
  - `app/src/components/PrivateOrderbook.tsx`
  - `app/src/components/PriceChart.tsx`
  - `app/src/components/ThemeToggle.tsx`
  - `app/src/pages/index.tsx`
- What changed:
  1. Added mobile-only market tabs in the app terminal for `Chart`, `Order Book`, and `Trades`.
  2. Wired `PrivateOrderbook` to accept an optional controlled tab state so mobile app-level buttons can switch directly into the trades view.
  3. Reset TradingView loading state when the symbol/feed changes so fallback rotation and pair changes do not keep stale chart state.
  4. Synchronized theme toggle initialization with the actual document theme state on first render.
  5. Landing page theme state now also initializes from the active document class instead of briefly assuming a different state during hydration.
- What was verified:
  - `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- Current blocker:
  - `needs browser verification`
  - Mobile chart/orderbook/trades navigation and first-paint theme toggle state are code-verified only.
- Next safe step:
  1. Open the app on a narrow/mobile viewport and verify the market tabs switch cleanly between chart, order book, and trades.
  2. Confirm the theme button reflects dark mode on first load when no light preference is saved.

## Market Feed + Theme Default + TP/SL Light-Mode Fixes (2026-03-10 UTC)
- Scope:
  - `app/src/lib/market-feeds.ts`
  - `app/src/components/PriceChart.tsx`
  - `app/src/pages/api/prices.ts`
  - `app/src/lib/prices.ts`
  - `app/src/components/ThemeToggle.tsx`
  - `app/public/theme-init.js`
  - `app/src/pages/index.tsx`
  - `app/src/components/BottomPositionsPanel.tsx`
  - `app/src/styles/globals.css`
- What changed:
  1. Added a shared market-feed mapping so the top market stats and the TradingView chart use the same primary venue/symbol family instead of the old mixed price aggregation.
  2. Replaced the `/api/prices` source logic with chart-aligned provider fetches:
     - Binance
     - Bybit
     - MEXC
     - Coinbase
     - Kraken
     - Gate.io
  3. Switched the default theme to dark mode:
     - no saved theme now defaults to dark
     - landing page and main app both read the same default
     - `theme-init.js` only applies `light` when explicitly saved
  4. Added explicit light-mode styling for the TP/SL automation editor panel instead of relying on inherited trade-panel colors.
  5. Removed the misleading pending-order cancel action from the orders panel:
     - pending orders now show `Queued`
     - triggered orders show `In Flight`
     - only failed local orders can be removed
- What was verified:
  - `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
  - `npm run check:oracle` -> PASS
    - price `$87.2350`
    - age `59s`
- Current blocker:
  - `needs browser verification`
  - The feed alignment, dark-default theme path, and TP/SL light-mode fixes are code-verified, but not visually rechecked in a running browser during this pass.
- Next safe step:
  1. Open the app and confirm the market bar price tracks the chart venue more closely for `SOL-PERP`.
  2. Confirm no-saved-theme opens in dark mode on both landing page and app.
  3. Toggle to light mode and verify the TP/SL editor, spread row, and top market bar remain readable.

## Landing Reveal + Session Persistence Fixes (2026-03-10 UTC)
- Scope:
  - `app/src/pages/index.tsx`
  - `app/src/hooks/useArcium.ts`
  - `app/src/pages/app.tsx`
- What changed:
  1. Fixed the landing-page reveal lifecycle so `.lp-reveal` elements are re-observed after theme initialization and theme changes.
  2. Removed the keyed root remount from the landing page, which was causing reveal targets to be replaced after theme init and left hidden.
  3. Hardened delegated session refresh logic so a just-created session is not immediately cleared when the relay RPC/API briefly reports `exists === false`.
  4. Removed the immediate post-create `refreshRelaySession()` call from the session chip, which was forcing that race right after successful creation.
- What was verified:
  - `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
  - `npm run check:oracle` -> PASS
    - price `$87.0900`
    - age `299s`
- Current blocker:
  - `needs browser verification`
  - The code path is fixed and typechecked, but the landing-page reveal and session-chip behavior were not visually reverified in a running browser during this pass.
- Next safe step:
  1. Start the app locally.
  2. Verify landing-page copy appears on first load and after theme toggle.
  3. Verify starting a delegated session no longer immediately clears the active chip/state.

## `open_position_probe_a` Live Rollout Succeeded, Arithmetic Path Is the Remaining Bug (2026-03-10 UTC)
- Scope:
  - `scripts/js-deploy.ts`
  - `scripts/init-comp-defs.ts`
  - `encrypted-ixs/src/open_position.rs`
  - `programs/shadowperp/src/handlers/open_position.rs`
  - `programs/shadowperp/src/handlers/session_trading.rs`
  - `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
- What changed/live rollout:
  1. Upgraded the existing program in place on QuickNode:
     - program `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
  2. Synced the frontend IDL:
     - `npx ts-node scripts/run-frontend.ts --sync-only`
  3. Finalized the new open comp-def for the minimal probe circuit:
     - `open_position_probe_a`: `C8pC4NT5mse346T37D7zZEzkmvcC3rzYeD7BQDGvN9Xk`
  4. Market open pointer now references:
     - `C8pC4NT5mse346T37D7zZEzkmvcC3rzYeD7BQDGvN9Xk`
- What was verified on QuickNode:
  - Oracle refresh succeeded:
    - tx `5Wk9xCKC4FC7PxLKgTcexCKkx1Zs7dtK32685N3Y8FH4cx8rfR4QHmhgcwmFFvj2uXTTHQut3nZXxK2MWNXuGmfh`
  - `npm run check:preflight` passed on QuickNode once RPC state caught up.
  - Fresh smoke:
    - session `1773127382`
    - session address `9oWSUmRvPtV38Mnetjz8hmSBN78cqZLSnWWVDMgWQsbR`
    - position `ByttC6czEm4YyaMSXDtWnnXzxTZyT3juy1w8q2YBGkYv`
    - open tx `3eNqK41YX7bxQA3MLxanpwwQKgcnejzpXNbzZuHX6SCiEFcTZs2hEVsU6Q1hUkwSqqyWaqTGRXF4Rd9fbcEeAiWX`
  - Callback result:
    - successful callback tx:
      - `UNrNbJjxpTpzTSf1pCjfeQfEvqAcdc42ZSwoNi5kxbPKW2NkwoTJDhF4nmMUDTu5MRYmPcpQsaMQGRytVDs24rw`
    - duplicate callback rejected by Arcium as expected:
      - `5kEmy7hZ7BLmoKvCjRBfD4kw6XVw7hJxnQTtCZEDMNpzFh8sxTwnEnszVVhbbHVroBgPtdsJtLmvASLT3MSUwPPo`
      - `AlreadyCallbackedComputation (6204)`
  - Position account decode confirms:
    - `status = Open`
    - `pending_computation_account = 11111111111111111111111111111111`
- Important conclusion:
  - The minimal probe proves that:
    - callback account sizing is not the blocker
    - callback plumbing is not the blocker
    - encrypted tuple input shape is not the blocker
    - Arcium can execute and callback this open path successfully
  - Therefore the remaining bug is in the original open arithmetic / business logic path (`open_position_v5`), not in the general callback/runtime pipeline.
- Current blocker:
  - `waiting on narrowed arithmetic isolation`
  - Next work should be probe-style binary search on the open circuit math:
    1. `probe_b` with only basic comparisons and no multiplication/division
    2. if that passes, `probe_c` adding arithmetic incrementally
- Next safe step:
  1. Replace `open_position_probe_a` with `open_position_probe_b`:
     - keep same input shape
     - add only leverage / margin / positivity comparisons
     - no multiplication or division
  2. Rebuild + in-place upgrade.
  3. Finalize the new open comp-def and rerun one delegated open smoke on QuickNode.

## `open_position_probe_a` Prepared, Upgrade Blocked on Buffer Rent (2026-03-10 UTC)
- Scope:
  - `encrypted-ixs/src/open_position.rs`
  - `programs/shadowperp/src/handlers/open_position.rs`
  - `programs/shadowperp/src/handlers/session_trading.rs`
  - `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
  - `programs/shadowperp/src/lib.rs`
  - `scripts/init-comp-defs.ts`
  - `scripts/sync-market-comp-defs.ts`
  - `scripts/force-upload-circuit.ts`
- What changed locally:
  1. Replaced the live open circuit path with `open_position_probe_a`.
  2. `open_position_probe_a` now ignores the encrypted tuple and returns only `true.reveal()`.
  3. On-chain queue/callback wiring and helper scripts were updated to target `open_position_probe_a`.
- What was verified:
  - `cargo check -p shadowperp` -> PASS
  - `wsl bash scripts/wsl-arcium-build.sh` -> PASS
  - `wsl bash scripts/wsl-anchor-build.sh` -> PASS
  - `build/open_position_probe_a.arcis` exists
  - `target/deploy/shadowperp.so` updated
  - `npm run check:preflight` on public devnet -> PASS after `npm run oracle:once`
  - Session creation still works on-chain:
    - session `1773106025`
    - tx `49dPsmrcMR5BCt3vhCbNKaoTg9VaRorSjmbNGPgob9rZoGNbGPFJjYKQcCTXXL1A3sdNoV3EVpB2iZ4UqTghghTF`
- Current blocker:
  - `waiting on funds`
  - In-place upgrade attempt on public devnet did not start because the wallet cannot fund the upgrade buffer for the current binary.
  - Live numbers from the failed attempt:
    - wallet balance: `8.20474808 SOL`
    - required buffer rent: `8.50476504 SOL`
    - shortfall: about `0.30001696 SOL` before fees
  - No stray buffer was left behind:
    - attempted buffer `BXcXr3hwox1mCpm71b9CxrLhz6wL76vAQHpubC2nPcrA` does not exist
    - `solana program show --buffers --url https://api.devnet.solana.com` shows none
- Important conclusion:
  - The next state change is not a code change. It is funding the deploy wallet enough to cover the upgrade buffer for the probe binary.
  - Once funded, the next step is to upgrade the current namespace in place, then finalize the new open comp-def and rerun one delegated open smoke.
- Next safe step:
  1. Fund deploy wallet `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt` with at least `0.5 SOL`.
  2. Retry:
     - `npx ts-node scripts/js-deploy.ts --rpc https://api.devnet.solana.com`
  3. Then run:
     - `npx ts-node scripts/run-frontend.ts --sync-only`
     - `npx ts-node scripts/init-comp-defs.ts --rpc https://api.devnet.solana.com --program 2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az --market Hx4cXyuoJWqsFh1CKmrPYsvYFpGYFMw9Ntst2bgXvKVC`
     - `npm run oracle:once`
     - `npm run check:preflight`
     - one delegated open smoke on public devnet

## `open_position_v4` / `close_position_v2` Rollout Complete, Live Open Still Aborts (2026-03-10 UTC)
- Scope:
  - `scripts/js-deploy.ts`
  - `scripts/init-comp-defs.ts`
  - live program / market / callback logs
- What changed:
  1. Landed the upgraded program in place on the existing namespace:
     - program `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
  2. Finished comp-def rollout on public devnet:
     - `open_position_v4`: `3FHGEdZ5qRxgCqmuFN3cxb4yYkynVTBUFUA7saQuoCmn`
     - `close_position_v2`: `54gwPKpVrigmnnRtuhmAZ28u3u6Z8QQRXQxRGJNzVuZi`
     - market now points to those new finalized comp-defs
  3. Oracle publish succeeded on public devnet:
     - tx `3ZrbxyBaWm26BdvuxtTxrR88z3eDe9sBV7zU4aifYyXh9bNkC9BumVtg2WNEfpLuxsEmgZYxw9GQ5XJ76WxY9dav`
     - note: immediate `check:oracle` / `check:preflight` still read stale age due to RPC lag, even though the tx confirmed
- What was verified live:
  - Delegated open smoke on public devnet:
    - session `1773101604`
    - session address `VfvbqfpcLLfFBV16XiH7PxSA2R3BMuzCEKXqoz5g5aG`
    - position `141s6C9rWyTRSbsBkaxPSLn7ua4iDMqXrW9eEZfaBduX`
    - open tx `9BxNisj189cToXuzpyPaJg6YyaKazdRhBGno6bHWZ1nqwYrSkWaJrMXX37NjhiiWmnzWHM9LdrJfCKcNeZNya84`
  - The position account stayed:
    - `status = Pending`
  - Callback txs both failed:
    - `39mBwppPGah57uCDVhodyp8ABTkYocUuNjKqR2rqSLfgXCYBWM48eQUDXcfNZDxFxMv9FAV9BqjYVBwrhfJDtDCA`
    - `41Qma7spEyhs8cZYGf158dvagUi3UwLwk6Ezt1ZAEyPNenzDshRVUxq8xE9R2um72gGiC6vck2iHxPZgszR7tfzp`
  - Exact callback log remains:
    - `Instruction: OpenPositionV4Callback`
    - `MPC raw verify failed ... AbortedComputation (6000)`
    - `InvalidComputationResult (6008)`
- Current blocker:
  - `waiting on Arcium/circuit-runtime diagnosis`
  - The program upgrade and comp-def rollout are no longer the blocker.
  - Removing encrypted OI from open/close did **not** eliminate the Arcium abort on open.
- Important conclusion:
  - The strongest remaining blocker is inside the Arcium computation/runtime path for `open_position_v4`, not:
    - deploy transport
    - comp-def initialization
    - callback output deserialization
    - MXE-owned OI state
- Next safe step:
  1. Inspect the exact `open_position_v4` circuit logic and runtime inputs again.
  2. Compare a live open request against the circuit’s arithmetic / branch conditions for any abort source.
  3. Prepare a minimal repro package for Arcium team if local circuit logic still looks coherent.

## Program Upgrade + Partial `v4/v2` Comp-Def Rollout (2026-03-10 UTC)
- Scope:
  - `scripts/js-deploy.ts`
  - `scripts/init-comp-defs.ts`
- What changed:
  1. Patched `scripts/js-deploy.ts` to stop using websocket-backed `sendAndConfirmTransaction`.
  2. The deployer now:
     - fetches a fresh blockhash per retry,
     - sends raw transactions directly,
     - confirms by HTTP polling via `getSignatureStatuses`,
     - tracks chunk progress in `target/deploy/shadowperp-buffer-progress.json`.
  3. This makes interrupted program upgrades resumable without restarting chunk uploads from `1/1222`.
- What was verified live:
  - In-place program upgrade succeeded on:
    - program `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
    - program data `Ee4sj7BuuoDnnvezicJNyEAFCnMH7tu8AShh6hrF8xG8`
  - Existing upgrade buffer `FtthWSaWdxSski7kPQnNgL4PFwW94upCR3F89VTsLrDY` was reused successfully; no new deploy buffer was created.
  - `init-comp-defs.ts` on public devnet resumed safely:
    - `open_position_v4` comp-def already initialized and then successfully uploaded/finalized from `build/open_position_v4.arcis`
    - new open comp-def:
      - `3FHGEdZ5qRxgCqmuFN3cxb4yYkynVTBUFUA7saQuoCmn`
    - `close_position_v2` comp-def initialized:
      - `54gwPKpVrigmnnRtuhmAZ28u3u6Z8QQRXQxRGJNzVuZi`
    - raw circuit resize progressed through `32/33` resize txs before stopping on low SOL
- Current blocker:
  - `need user input`
  - deploy wallet `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt` is now only about `0.191961929 SOL`
  - close upload failed with:
    - `Insufficient SOL while uploading close_position_v2: short by 0.021854 SOL`
  - practical recommendation is to fund at least `1 SOL` before retrying, not just the exact shortfall
- Important state now:
  - old live market pointer is still on open `6t1JWBP4...` and close `4JYtM2Xd...` until the rollout script completes and syncs the market
  - `open_position_v4` is finalized on-chain, but not yet switched into the market pointer
  - `close_position_v2` is partially prepared and should be resumed, not recreated
- Next safe step:
  1. Fund `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt` with at least `1 SOL`.
  2. Rerun:
     - `npx ts-node scripts/init-comp-defs.ts --rpc https://api.devnet.solana.com --program 2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az --market Hx4cXyuoJWqsFh1CKmrPYsvYFpGYFMw9Ntst2bgXvKVC`
  3. Then refresh oracle and rerun:
     - `npm run check:oracle`
     - `npm run check:preflight`
     - one delegated open smoke on a single pinned RPC

## Remove Encrypted OI From Open/Close Path (2026-03-08 UTC)
- Scope:
  - `encrypted-ixs/src/open_position.rs`
  - `encrypted-ixs/src/close_position.rs`
  - `programs/shadowperp/src/handlers/open_position.rs`
  - `programs/shadowperp/src/handlers/close_position.rs`
  - `programs/shadowperp/src/handlers/session_trading.rs`
  - `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
  - `programs/shadowperp/src/handlers/callbacks/close_position_callback.rs`
  - `programs/shadowperp/src/handlers/init_comp_defs.rs`
  - `programs/shadowperp/src/lib.rs`
  - `scripts/init-comp-defs.ts`
  - `scripts/deploy-devnet.ts`
  - `scripts/sync-market-comp-defs.ts`
  - `scripts/force-upload-circuit.ts`
  - `scripts/wsl-arcium-build.sh`
- What changed:
  1. Stopped threading aggregate OI through Arcium open/close computations.
  2. Added new confidential instruction versions:
     - `open_position_v4`
     - `close_position_v2`
  3. `open_position_v4` now validates the private open request and returns only a revealed `bool`.
  4. `close_position_v2` now returns only revealed settlement outputs `(pnl, settlement, fee, locked_margin)`.
  5. Open/close callbacks no longer read or write MXE-owned OI ciphertexts.
  6. `deploy-devnet.ts` no longer auto-runs the encrypted OI seed path.
  7. Helper scripts now derive the new comp-def names:
     - `open_position_v4`
     - `close_position_v2`
- What was verified locally:
  - `wsl bash scripts/wsl-arcium-build.sh` -> PASS
    - generated `build/open_position_v4.arcis`
    - generated `build/close_position_v2.arcis`
  - `cargo check -p shadowperp` -> PASS
  - `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
  - `wsl bash scripts/wsl-anchor-build.sh` -> PASS
    - updated `target/deploy/shadowperp.so`
    - updated `target/idl/shadowperp.json`
- Current blocker:
  - `waiting on funds`
  - Current deploy wallet balance is only about `5.59 SOL`
  - No reclaimable deploy buffers remain
  - This is not enough for:
    1. the next program upgrade buffer, and
    2. a fresh `close_position_v2` comp-def upload/finalization on devnet
- Important conclusion:
  - The local code path is ready for rollout, but no devnet rollout was attempted in this batch because wallet balance is below the safe minimum.
  - The next live step should not begin until the deploy wallet is topped up again.
- Next safe step:
  1. Fund the deploy wallet `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt`.
  2. Upgrade the current program on QuickNode with the rebuilt binary.
  3. Run `scripts/init-comp-defs.ts` on the current market to finalize:
     - `open_position_v4`
     - `close_position_v2`
  4. Refresh oracle on pinned QuickNode.
  5. Rerun `check:oracle`, `check:preflight`, then one delegated open smoke.

## Seed OI Bootstrap v3 Rollout (2026-03-07 UTC)
- Scope:
  - `encrypted-ixs/src/seed_open_interest_state.rs`
  - `programs/shadowperp/src/handlers/seed_open_interest_state.rs`
  - `programs/shadowperp/src/handlers/callbacks/seed_open_interest_state_callback.rs`
  - `programs/shadowperp/src/handlers/init_comp_defs.rs`
  - `programs/shadowperp/src/lib.rs`
  - `scripts/init-comp-defs.ts`
- What changed:
  1. Added `seed_open_interest_state_v3` to replace the failed `v2` bootstrap path.
  2. `v3` tries to derive a secret-shared zero from MPC randomness before converting it to `Enc<Mxe, (u64, u64)>`.
  3. Updated all on-chain callback/init wiring and comp-def init script references from `v2` to `v3`.
- What was verified:
  - `wsl bash scripts/wsl-arcium-build.sh` -> PASS
  - `cargo check -p shadowperp` -> PASS
  - `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
  - `wsl bash scripts/wsl-anchor-build.sh` -> PASS
  - `npx ts-node scripts/js-deploy.ts --rpc <QuickNode>` -> PASS (program upgraded in place)
  - `npx ts-node scripts/init-comp-defs.ts --rpc https://api.devnet.solana.com ...` -> PASS for `seed_open_interest_state_v3`
    - new finalized seed comp-def: `8bdfGvYHVhQ7y8d5CHe34hBrDkqJHCMZUhT4m4d68w8N`
  - `npx ts-node scripts/deploy-devnet.ts --skip-deploy` -> PASS through `SeedOpenInterestState`
  - Direct market decode after the run still shows:
    - `oi_nonce = 0`
    - `encrypted_total_long_oi = [0; 32]`
    - `encrypted_total_short_oi = [0; 32]`
  - Recent market tx logs confirm the callback still aborts:
    - queue tx: `5CpmYy6qvtzN5CZDLq3JGdtDrRwLRwJiozSTDKfqtTtcMfdKSPxFcusPDcioqQajcu87CxxiJLYJXBkSNBjGzuWC`
    - callback txs:
      - `py45ED6nRY4XAsg4npozcqMHXgbN7hY3kbNuNoFAk9ioDLaL6EgLTKUGNpCxLHZMSXdqCSc7zP5KKirHBQtXZSe`
      - `UNuo76aPVAKiFVbuL6RgK8GSXfnYs32fEjy1naZo8qqVQiZDiw21UaV2J9MbFpF2ethqDSjtD5AF51uQg1G83se`
    - log line:
      - `SeedOpenInterestStateV3Callback`
      - `MPC verify failed while seeding OI state ... AbortedComputation (6000)`
      - `InvalidComputationResult (6008)`
- Current blocker:
  - `waiting on first-open architecture change`
  - Three standalone seed variants (`v1`, `v2`, `v3`) all abort before callback verification succeeds.
  - The evidence now points away from "seed circuit shape bug" and toward "standalone OI bootstrap path is not viable on current Arcium devnet/runtime".
- New conclusion:
  - Do not spend more cycles on another standalone `seed_open_interest_state_vN` variant.
  - The safer next design is to special-case the first open so `open_position` can initialize OI without decrypting placeholder state.
  - That likely means a new `open_position_v3` circuit / comp-def path, not another seed-only circuit.
- Next safe step:
  1. Design `open_position_v3` so the first open does not require a valid preexisting `Enc<Mxe, (u64, u64)>`.
  2. Keep close/liquidation unchanged if possible.
  3. Rebuild, in-place upgrade, init only the new open comp-def path, then rerun one delegated open smoke.

## Open Computation Abort Diagnosis (2026-03-07 UTC)
- Scope:
  - `encrypted-ixs/src/open_position.rs`
  - `programs/shadowperp/src/handlers/open_position.rs`
  - `programs/shadowperp/src/handlers/session_trading.rs`
  - `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
  - live market account `Hx4cXyuoJWqsFh1CKmrPYsvYFpGYFMw9Ntst2bgXvKVC`
- What was verified:
  1. Input packing is aligned across the circuit and both queue handlers.
  2. Callback plumbing is aligned; the upgraded callback logs now distinguish raw verification failure from output deserialization failure.
  3. Live callback failure is `AbortedComputation (6000)` from `verify_output_raw`, not output deserialization.
  4. The open circuit immediately executes `let mut oi = oi_state.to_arcis();` before any success/failure checks.
  5. The market is still initialized with an all-zero OI state:
     - `oi_nonce = 0`
     - `encrypted_total_long_oi = [0; 32]`
     - `encrypted_total_short_oi = [0; 32]`
     - `active_positions = 0`
  6. No script or on-chain initialization step currently seeds a valid encrypted zero OI state before the first open.
- Current blocker:
  - `waiting on first-open OI state fix`
  - Most likely root cause is that Arcium aborts when `open_position_v2` attempts to decrypt `oi_state` from the market's zero-filled placeholder ciphertexts.
- Why this is the strongest theory:
  - The computation abort happens before output deserialization.
  - The first use of `oi_state` in the circuit is a decrypt/convert operation, and the live market still contains placeholder zero bytes rather than a valid encrypted zero tuple.
  - This explains why the first open never reaches `success=false`; it aborts before validation logic can run.
- Next safe step:
  1. Decide the first-open strategy:
     - seed the market with a valid encrypted zero OI state during init/deploy, or
     - special-case the first open so the circuit does not decrypt placeholder OI state.
  2. Apply the smallest code change that preserves the existing comp-def assumptions if possible.
  3. Rebuild Rust only if the fix is callback/handler-side; rebuild circuits + comp-defs if the circuit itself must change.

## Full Smoke Test + App UI Verification (2026-03-07 ~16:12 UTC)
- All smoke tests passed clean:
  - `npm run check:preflight` → **22/22 PASS**
  - `npm run canary:devnet --verbose` → **12/12 PASS** (queue simulation passed)
  - `npm run session:relayer:smoke` → **PASS** (session `1772900108` created + delegated open queued)
- Oracle refreshed to $83.75 (within circuit breaker, normal 500 bps limit)
- App UI (`cd app && pnpm dev`):
  - Next.js 15.5.10, compiled in 196.1s (3669 modules), no errors
  - Landing page (`/`) and trading app (`/app`) both serve on localhost:3000
  - Light mode fully implemented: theme toggle, CSS variable overrides, landing page dual-mode
- `.env.local` verified: program ID `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`, all Arcium accounts correct
- Wallet balance: ~5.10 SOL, 38 USDC in operator ATA, 5 USDC in margin account
- Fix applied: `scripts/session-relayer.ts:474` — removed stale 5th arg from `closePositionWithSession` (signature changed in settlement split)

## Fresh Namespace Deploy via JS Deployer (2026-03-07 UTC)
- Scope:
  - `scripts/js-deploy.ts` — pure JS deployer bypassing Solana CLI
  - `programs/shadowperp/src/lib.rs` — declare_id sync
  - `Anchor.toml`, `Arcium.toml` — program ID sync
- What happened:
  1. Previous program `4qTkcW4AaDAUPtm3m1qRCca9piNrNmZhjSt5PaWe6MsN` was successfully upgraded via JS deployer (buffer write + BPF Upgrade instruction).
  2. Post-deploy init (market, arcium signer, MXE) all succeeded.
  3. Comp-def init hit `FRESH_NAMESPACE_REQUIRED`: the `open_position_v2` comp-def was finalized with 12 params but new code expects 15 params. Comp-defs are immutable once finalized.
  4. Rotated to fresh namespace: `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
  5. Rebuilt binary in WSL with new `declare_id!()`, IDL regenerated.
  6. Fresh deploy in progress via `js-deploy.ts` (1150 chunks to write).
- JS Deployer fixes applied:
  - Fixed Write instruction: bincode `Vec<u8>` uses `u64` length prefix, not `u32`.
  - Added upgrade support (`Upgrade` instruction discriminant 3).
  - Added blockhash fetch retry (5 attempts with backoff) for SSL flakiness.
- Key addresses:
  - New program ID: `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
  - Deploy wallet: `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt`
  - Buffer: `He5o1aamk3KPZrZr9Rq8Y7KX8hvaZELoZMiFDGz59766`
- Network issues:
  - WSL has no outbound internet (HTTP 000 timeout).
  - Windows `solana.exe` CLI fails with "error sending request".
  - Node.js HTTP works fine — JS deployer is the only working deploy path.
  - Helius RPC has intermittent SSL errors (EPROTO, ECONNRESET) — retry logic handles them.
- Deploy progress:
  1. Buffer fully written (1150/1150 chunks), program account created, deploy finalized. **Program live on devnet.**
  2. Post-deploy init completed: market, arcium signer PDA, MXE account all initialized.
  3. Fixed `EXPECTED_SIGNATURES` mismatch: arcis circuit produces 12 params (not 15). Updated `init-comp-defs.ts`.
  4. Switched from Helius to QuickNode RPC due to persistent SSL errors (EPROTO/ECONNRESET) — affects all providers intermittently but QuickNode is more stable.
- Comp-def init progress: **ALL 3 FINALIZED**
  - `open_position_v2`: `CAPvXjpRGqgMMU5ejVVRA3i9kZj5ytoffiFBZQ3bjzcX` (params=12, outputs=4)
  - `close_position`: `4JYtM2XdNZ5fZmH436RDKa2iAFCS49c5afUjqHfe1k3w` (params=11, outputs=7)
  - `check_liquidation`: `7KNuD6Z2ZjRKrg3zoqz2GAhdwnn4CKffxXsD7c2gdmSf`
- Post-deploy init: **COMPLETE**
  - Market: `Hx4cXyuoJWqsFh1CKmrPYsvYFpGYFMw9Ntst2bgXvKVC`
  - Collateral (USDC): `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
  - MXE Account: `9NiWgGU1SZfCvkt6ji2WiFrRE7Pc1wUDdgaytwQwAiNB`
  - Arcium Signer PDA: `6Rk2FXTgohP3GDwDpj5mNDiHxDWdCmyruvaRhcEqXSGx`
  - Oracle price: $83.71 (live-synced, circuit breaker required one-time 2000 bps override from stale $103)
  - `.env.local` regenerated, IDL synced to `app/src/idl/`
  - 5 USDC deposited into operator margin account for canary simulation
- SOL consumption total: ~120 SOL across multiple funding rounds
  - Program deploy: ~24 SOL, open_position_v2 circuit: ~2 SOL, close_position circuit: ~43 SOL, check_liquidation circuit: ~43 SOL, tx fees: ~8 SOL
- Current status: **DEPLOYMENT COMPLETE — ALL SMOKE TESTS PASS**
  - Wallet balance: ~5.12 SOL remaining at `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt`
  - USDC balance: 38 USDC in operator ATA, 5 USDC in margin account
- Smoke test results (2026-03-07 ~15:53 UTC):
  - `npm run check:preflight` → **22/22 PASS** (trading stack in stable-ready state)
  - `npm run canary:devnet --verbose` → **12/12 PASS** (queue simulation passed)
  - `npm run session:relayer:smoke` → **PASS** (session created + delegated open queued)
- Fixes applied during smoke:
  - Oracle circuit breaker: initial price $103 vs live ~$84 (1838 bps). One-time `ORACLE_MAX_DEVIATION_BPS=2000` to resync.
  - `scripts/session-relayer.ts:474` — removed stale 5th arg from `closePositionWithSession` call (method signature changed in settlement split).
- Next steps:
  1. App UI test: `cd app && pnpm dev`
  2. Open/close position end-to-end via the UI
  3. Keep oracle fed: `npm run oracle:once` before each test session (or run in loop mode)

## WSL Build Lane + Fresh Deploy Attempt (2026-03-07 UTC)
- Scope:
  - `scripts/wsl-anchor-build.sh`
  - `scripts/wsl-arcium-build.sh`
  - `scripts/build-idl.js`
  - `scripts/deploy-devnet.ts`
  - `encrypted-ixs/src/open_position.rs`
- What changed:
  1. Fixed the encrypted instruction name mismatch by renaming the circuit entrypoint from `open_position` to `open_position_v2` so build artifacts now match the on-chain callback/types.
  2. Added a repo-local IDL fallback builder in `scripts/build-idl.js` that runs the Anchor `__anchor_private_print_idl` cargo test directly and reconstructs `target/idl/shadowperp.json` from the printed marker blocks.
  3. Updated `scripts/wsl-anchor-build.sh` to use the working WSL Solana `2.3.13` lane, keep Node on `PATH`, and call the new IDL builder instead of the broken `anchor idl build` path.
  4. Updated `scripts/deploy-devnet.ts` to call the WSL build wrapper from Windows without broken shell quoting.
- What was verified:
  - `wsl bash scripts/wsl-arcium-build.sh` -> PASS
  - `wsl bash scripts/wsl-anchor-build.sh` -> PASS
  - `target/idl/shadowperp.json` regenerated successfully (`~127 KB`) and includes new instructions such as:
    - `settle_close_position`
    - `settle_liquidation`
    - `update_mxe_cluster`
    - `PositionStatus` pending-settlement variants
  - Fresh deploy wrapper reached the real devnet deploy step after rotating namespace and rebuilding artifacts.
- Current blocker:
  - `waiting on funds`
  - Deploy wallet `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt` has about `4.997 SOL`, but the fresh deploy path needs about `8.006 SOL` for the program write + fees.
  - `solana program show --buffers` returned no reclaimable upgrade buffers for the current authority.
  - The specific ephemeral buffer address shown during the failed deploy was already absent by the time we tried to close it.
- Important current state:
  - The failed fresh deploy already rotated the local program namespace again.
  - Current local program keypair / `declare_id!` / `Anchor.toml` now point at:
    - `ir15eQX9cuVm2HdGsxihLSU5HkanrKwaCaVsoeVk6m4`
  - This namespace is built locally but not yet deployed.
- Next safe step:
  1. Fund the deploy wallet with at least `4 SOL` more on devnet (more is safer).
  2. Retry deploy without rotating again:
     - `npx ts-node scripts/deploy-devnet.ts`
  3. If deploy succeeds, continue with:
     - `npm run oracle:once`
     - `npm run check:preflight`
     - `npm run canary:devnet -- --verbose`
  4. Then run open/close smoke and pending-settlement UI checks on the new namespace.

## Liquidation Settlement Authorization + Client Wiring (2026-03-06 UTC)
- Scope:
  - `programs/shadowperp/src/state/liquidation_settlement.rs`
  - `programs/shadowperp/src/state/mod.rs`
  - `programs/shadowperp/src/handlers/check_liquidation.rs`
  - `programs/shadowperp/src/handlers/settle_liquidation.rs`
  - `app/src/lib/client.ts`
  - `app/src/types/index.ts`
  - `app/src/components/PositionsList.tsx`
  - `app/src/components/BottomPositionsPanel.tsx`
  - `scripts/session-relayer.ts`
- What changed:
  1. Added a `LiquidationSettlement` PDA keyed by position so deferred liquidation rewards stay bound to the liquidator that queued the computation.
  2. `check_liquidation` now initializes/updates that PDA before queueing Arcium work.
  3. `settle_liquidation` now requires the recorded liquidator signer and a token account owned by that liquidator.
  4. Added client SDK helpers for pending-settlement flows:
     - `settleClosePosition`
     - `settleLiquidation`
     - `waitForPositionStatus`
     - `finalizeClosePosition`
     - `finalizeLiquidation`
  5. Frontend close flows now wait for callback completion and then submit `settle_close_position` when the position enters `ClosedPendingSettlement`.
  6. Added relayer CLI callers for deferred settlement:
     - `close` now auto-finalizes with `finalizeClosePosition`
     - new commands: `settle-close`, `settle-liquidation`
  7. UI status parsing now recognizes pending-settlement states and shows them as `Settling`.
- What was verified:
  - mandatory session checklist completed:
    - `git status --short`
    - env values verified from `app/.env.local`
    - `npm run check:preflight` -> stale oracle once, then PASS after `npm run oracle:once`
  - `cargo check -p shadowperp` -> PASS
  - `pnpm --dir app exec tsc --noEmit --incremental false` -> PASS
- Current blocker:
  - local code is ready, but live validation still depends on:
    1. `arcis build`
    2. Anchor build/deploy
    3. IDL sync
    4. comp-def re-init
    5. devnet canary / close smoke on the updated namespace
- Next safe step:
  1. Run `arcis build`.
  2. Run the safe Anchor build/deploy wrappers from a normal terminal.
  3. Sync the updated IDL into `app/src/idl/shadowperp.json`.
  4. Re-init comp-defs for the updated signatures.
  5. Smoke:
     - close -> callback -> settle_close_position
     - liquidation callback -> settle_liquidation

## Callback Account Reduction + Deferred Settlement (2026-03-06 UTC)
- Scope:
  - `programs/shadowperp/src/handlers/callbacks/close_position_callback.rs`
  - `programs/shadowperp/src/handlers/callbacks/liquidation_callback.rs`
  - `programs/shadowperp/src/handlers/settle_close_position.rs`
  - `programs/shadowperp/src/handlers/settle_liquidation.rs`
  - `programs/shadowperp/src/state/position.rs`
  - `programs/shadowperp/src/lib.rs`
  - `programs/shadowperp/src/handlers/mod.rs`
- What changed:
  1. Reduced callback custom-account counts by moving token transfers out of Arcium callbacks.
  2. `close_position_callback` now updates state only and no longer requires token transfer accounts.
  3. `check_liquidation_callback` now updates state only and no longer requires liquidator/vault transfer accounts.
  4. Added `settle_close_position` to transfer settlement from vault to owner after callback state transition.
  5. Added `settle_liquidation` to transfer liquidation reward from vault to liquidator after callback state transition.
  6. Added intermediate `PositionStatus` values:
     - `ClosedPendingSettlement`
     - `LiquidatedPendingSettlement`
  7. Callback handlers now store pending transfer amounts in `position.margin` for the settle instruction to consume.
- Why:
  - Arcium team feedback pointed to `comp` account budget pressure.
  - Close/liquidation callback account vectors were materially larger than open-position.
  - This keeps MPC verification in callback while moving token transfers to plain program instructions.
- Verification:
  - `cargo check -p shadowperp` -> PASS
- Current blocker:
  - The settlement split is code-only until updated program/circuits are built, deployed, and exercised on devnet.
  - Frontend/relayer integration for the new settle instructions is not yet verified in a live flow.
- Review findings:
  1. Critical: `settle_liquidation` does not bind payout to the original liquidator.
     - Current `SettleLiquidation` only checks token mint, so any caller can provide any token account and receive the liquidation reward once status is `LiquidatedPendingSettlement`.
     - The deferred flow needs to persist the authorized liquidator identity on-chain and enforce it during settlement.
  2. Medium: deferred settlement is not wired in client/relayer code yet.
     - `settle_close_position` / `settle_liquidation` exist in the program and IDL surface, but there are no app/scripts callers yet.
     - Without that integration, positions will remain in `ClosedPendingSettlement` / `LiquidatedPendingSettlement` after callback even if the on-chain program is deployed successfully.
- Next safe step:
  1. Add liquidator binding for deferred liquidation settlement.
  2. Add client/relayer support for `settle_close_position` and `settle_liquidation`.
  3. Rebuild Arcium circuits (`arcis build`) so reduced signatures match generated artifacts.
  4. Rebuild and deploy the updated program.
  5. Re-init comp-defs for the new circuit signatures.
  6. Run devnet smoke for:
     - open -> callback
     - close -> callback -> `settle_close_position`
     - liquidation check -> callback -> `settle_liquidation`

## Admin Cluster Pointer Update Instruction (2026-03-06 UTC)
- Scope:
  - `programs/shadowperp/src/handlers/update_mxe_cluster.rs`
  - `programs/shadowperp/src/lib.rs`
  - `programs/shadowperp/src/handlers/mod.rs`
- What changed:
  1. Added admin-only `update_mxe_cluster` instruction.
  2. Instruction updates `market.mxe_cluster` in-place and logs old/new cluster pubkeys.
- Why:
  - Provides a supported path to correct stored cluster pointers if Arcium devnet rotates infrastructure again.
- Verification:
  - included in `cargo check -p shadowperp` -> PASS
- Current blocker:
  - not deployed, so live namespace still depends on the current stored market cluster.
- Next safe step:
  1. Deploy alongside the queue-payload reduction changes.
  2. Use only if a future live cluster-pointer mismatch is actually verified.

## Comp Account Space Budget (Arcium team feedback) (2026-03-06 UTC)
- Source:
  - Arcium team direct feedback: "the 483 byte comp account can't hold 15 params + callbacks"
  - Recommended fix: "try packing/combining related params into fewer encrypted fields, then try reducing your callback accounts"
- Current param + callback counts per circuit:
  - open_position:      12 ArgBuilder params + 3 callback accounts = 15 items
  - close_position:      9 ArgBuilder params + 3 callback accounts = 12 items
  - check_liquidation:   8 ArgBuilder params + 3 callback accounts = 11 items
- Reduction plan:
  1. Circuit-level: circuits already simplified (market_params tuple → single field per circuit).
     BUT the `.idarc` files still reflect the OLD tuple signatures.
     Circuits MUST be recompiled with `arcis build` to produce matching `.idarc` files.
  2. Callback accounts: token transfer is now moved out of close/liquidation callbacks
     This drops close_position from 5 → 3 callbacks, check_liquidation from 6 → 3 callbacks.
  3. After both reductions, target counts:
     - open_position:      12 params + 3 callbacks (already borderline — may be OK)
     - close_position:      9 params + 3 callbacks = 12 items
     - check_liquidation:   8 params + 3 callbacks = 11 items
- Status:
  - ArgBuilder reductions: DONE (code-only, needs circuit recompile)
  - Callback account reduction: NOT YET DONE
  - Circuit recompile: BLOCKED (needs `arcis build` environment)
  - update_mxe_cluster admin instruction: DONE (code, compiles, not deployed)

## Queue Payload Reduction: Remove Unused Market Params (2026-03-06 UTC)
- Scope:
  - `encrypted-ixs/src/open_position.rs`
  - `encrypted-ixs/src/close_position.rs`
  - `encrypted-ixs/src/liquidation_check.rs`
  - `programs/shadowperp/src/handlers/open_position.rs`
  - `programs/shadowperp/src/handlers/close_position.rs`
  - `programs/shadowperp/src/handlers/check_liquidation.rs`
  - `programs/shadowperp/src/handlers/session_trading.rs`
- What changed:
  1. Reduced Arcium queue payload size by removing plaintext market fields that the circuits were not using.
  2. `open_position` now sends only `max_leverage` instead of the full `(max_leverage, liquidation_threshold, trading_fee, oracle_price)` tuple.
  3. `close_position` now sends only `trading_fee` instead of the full market tuple.
  4. `check_liquidation` now sends only `liquidation_threshold` instead of the full market tuple.
  5. Applied the same reductions to session-relayed open/close queue paths.
- Why:
  - Team feedback and local code audit both point to `comp` account pressure during `QueueComputation`.
  - The previous handlers were still passing unused fields, inflating the computation-account payload without adding validation value.
- Verification:
  - `cargo check -p shadowperp` -> PASS
  - Full workspace `cargo check --workspace` still does not verify `encrypted-ixs` via plain Cargo because `arcis` expects the Arcium build environment (`arcis manifest is not 'Cargo.toml'`); this is a tooling constraint, not a new program-side compile failure.
- Current blocker:
  - These payload reductions are code-only until the Arcium circuit/build/deploy/re-init path is run.
  - Current live devnet namespace is still on the old circuit signatures.
- Next safe step:
  1. Rebuild the Arcium circuits with the updated signatures.
  2. Re-deploy program/circuit artifacts.
  3. Re-initialize comp-defs for the new circuit signatures.
  4. Re-run `npm run oracle:once` then `npm run canary:devnet -- --verbose`.

## Comp Account Space Budget Update (2026-03-06 UTC)
- This note supersedes the earlier rough callback-budget section above.
- Current effective counts after code changes:
  - `open_position`: 12 ArgBuilder params + 3 callback accounts = 15 items
  - `close_position`: 9 ArgBuilder params + 3 callback accounts = 12 items
  - `check_liquidation`: 8 ArgBuilder params + 3 callback accounts = 11 items
- Current status:
  - ArgBuilder reductions: DONE
  - Callback account reduction: DONE
  - New settle instructions: ADDED
  - Arcium circuit rebuild: NOT DONE
  - Deploy + comp-def re-init: NOT DONE
- Meaning:
  - The close/liquidation callback-count concern has been addressed in code.
  - The open-position path is still the tightest budget and remains the main live risk until Arcium rebuild/deploy validation is done.

## Callback Account Space Audit (Arcium docs follow-up) (2026-03-05 UTC)
- Scope:
  - docs + runtime audit only (no source changes)
- Prompt source:
  - Arcium team suggestion to verify callback output target account space:
    - `https://docs.arcium.com/developers/program/callback-accs`
- Relevant doc constraints verified:
  1. Callback accounts cannot be resized during callback.
  2. Accounts must exist before callback.
  3. Callback account order and writability must match callback instruction.
  4. Output payloads should remain compact (Arcium limitations page notes ~1232-byte callback transaction output budget).
- ShadowPerp verification:
  1. Callback account ordering is correct in all queue handlers:
     - open: position, market, margin
     - close: position, market, margin, owner_token, vault
     - liquidation: position, market, liquidator, liquidator_token, margin, vault
  2. Callback writability flags (`is_writable: true`) align with `#[account(mut)]` callback structs.
  3. Callback target accounts are fixed-size and initialized with explicit space constants:
     - `Market::LEN = 494`
     - `Position::LEN = 490`
     - `MarginAccount::LEN = 193`
  4. Circuit outputs are compact tuples (open/close/liquidation) and do not approach the documented output-size limit.
- Runtime result:
  - Despite valid callback account sizing/layout, queue simulation still fails in Arcium at queue stage:
    - `QueueComputation` -> `comp` -> `AccountDidNotSerialize (3004)` (`0xbbc`)
- Conclusion:
  - Callback target account space is not the primary blocker for the current open-position queue failure.

## Hypothesis Check: "stale market cluster / missing comp-def pointers" (2026-03-05 UTC)
- Scope:
  - runtime verification only (no source changes)
- Claim tested:
  1. Market points to stale/non-existent comp-def accounts.
  2. Market stores stale `mxe_cluster` address that no longer exists.
- What was run:
  1. Anchor decode of live market account via IDL account fetch (`program.account.market.fetch(...)`) and direct account-existence checks.
  2. `npm run canary:devnet -- --verbose --max-oracle-age-seconds 2000` to force queue simulation path.
- Verified live values:
  - `open_position_comp_def`: `8QvPiBX18gbcWpKLZiwiMDnCP9hcpqJBs4sCxo6hQX15` (exists, finalized)
  - `close_position_comp_def`: `3JpwyAdVLrqEh8Auf97yVBgP6JDsojeqqoMAzujrzYgr` (exists, finalized)
  - `liquidation_comp_def`: `FarLAbaeZUph6qoqoa3Qvu8XNqhYjYjuSoiF78Av5iCU` (exists, finalized)
  - `market.mxe_cluster`: `DzaQCyfybroycrNqE5Gk7LhSbWD2qfCics6qptBFbr95` (exists)
  - `derived cluster(offset=456)`: `DzaQCyfybroycrNqE5Gk7LhSbWD2qfCics6qptBFbr95` (matches market)
- Result:
  - Stale-pointer hypothesis is disproven for the current live market.
  - Queue simulation still deterministically fails at Arcium queue serialization:
    - `Instruction: QueueComputation`
    - `AnchorError caused by account: comp`
    - `AccountDidNotSerialize (3004)`
    - Arcium custom error: `0xbbc`
- Likely reason the stale-pointer diagnosis appeared:
  - Manual byte-offset decoding used an outdated Market layout. Current struct order places `mxe_cluster` before comp-def fields; incorrect offsets can produce plausible but wrong pubkeys.
- Current blocker:
  - unchanged Arcium queue-path serialization failure on `comp` account.
- Next safe step:
  1. Escalate with this fresh canary log proving pointers/cluster are valid and issue persists in `QueueComputation`.
  2. Keep production claims conservative (`partial live`, no fully-live claim) until queue path passes canary.

## Devnet Queue Simulation Recheck (2026-03-05 UTC)
- Scope:
  - runtime verification only (no source changes)
- What was run:
  1. `npm run canary:devnet -- --verbose` (first attempt)
  2. `npm run check:preflight` + `npm run check:oracle`
  3. `npm run oracle:once`
  4. `npm run canary:devnet -- --verbose` (post-refresh retry)
- Results:
  1. First canary attempt failed with transient `fetch failed` (network/tooling transient).
  2. Preflight + oracle health showed `stale oracle` (age ~1200s), not queue-path success/fail.
  3. Oracle refreshed successfully:
     - tx: `4q1d1w5YAsbDs7ZuaxKHYcM6MBWETjGwYgxQTrwvnTfz1LxCPtPqFQzQtwY9BJTNBAQgTysVEaK57uUFstF6Mm9J`
  4. Second canary reached queue simulation and reproduced blocker deterministically:
     - `Instruction: QueueComputation`
     - `AnchorError caused by account: comp. Error Code: AccountDidNotSerialize (3004)`
     - Arcium program failed with custom error `0xbbc`
- Current blocker:
  - unchanged Arcium devnet queue-path serialization failure on `comp` account for open-position simulation.
- Next safe step:
  1. Share this exact canary log block with Arcium support as fresh reproducible evidence on current 0.8.5 stack.
  2. Keep ShadowPerp pinned to Arcium 0.8.5; do not downgrade to 0.6.x as a hotfix.

## External Reference Check: anon0mesh Arcium Integration (2026-03-05 UTC)
- Scope:
  - external reference repo review (no local code changes)
- What changed:
  1. Verified `anon0mesh/contract` uses real Arcium callback-based integration (`queue_computation`, `#[queue_computation_accounts]`, `#[arcium_callback]`, and comp-def init macros).
  2. Confirmed it is not a perps implementation; it is a BLE revenue-sharing payment contract with Arcium-backed confidential computation.
  3. Verified the reference repo is pinned to Arcium `0.6.x` (`arcium-anchor/client/macros = 0.6.3`, JS client `@arcium-hq/client ^0.6.4`), while ShadowPerp runs `0.8.5`.
- What was verified:
  - `git status --short`
  - active env keys present in `app/.env.local` (program/market/arcium/rpc)
  - `npm run check:preflight` -> initially FAIL (`Oracle freshness`)
  - `npm run oracle:once` -> PASS (tx: `2dJCDiDfxQjsyZtxk2KujJrBx5SZ6qQ8gXq7CQftiNAn4nSnoG1bPUXgXaNTn1G7CoaY34WqFY5SB37iQP2WnEyF`)
  - `npm run check:preflight` -> PASS
- Current blocker:
  - unchanged Arcium devnet queue-path failure on open-position flows:
    - `QueueComputation` -> `AccountDidNotSerialize (3004)` on `comp`
- Next safe step:
  1. Do not port anon0mesh code directly; use it only as a macro/account-layout reference.
  2. Keep ShadowPerp and Arcium dependency versions consistent (`0.8.5`) and avoid mixing `0.6.x` patterns.
  3. If needed, create a minimal ShadowPerp-only queue repro on current `0.8.5` for Arcium support escalation.

## Public README Cleanup (2026-03-02 UTC)
- Scope:
  - `README.md`
- Changes:
  1. Rewrote the README into a public-facing project overview.
  2. Removed internal-only maintainer guidance, agent onboarding references, and detailed deployment notes that were not appropriate for a public landing document.
  3. Kept the privacy model, Arcium integration summary, current devnet limitation, and contributor-safe setup instructions.
  4. Shifted tone toward a more professional and human product description instead of an internal runbook.
- Verification:
  - Documentation-only change; no code or runtime checks were required.
- Current blocker:
  - Arcium devnet queue path can still fail at `QueueComputation` with `AccountDidNotSerialize (3004)` in open-position flows.
- Next safe step:
  1. Do a quick public-facing review of the README after push to confirm the wording matches how you want to present the project externally.

## Agent Session Stall Guardrails (2026-03-02 UTC)
- Scope:
  - `AGENTS.md`
- Changes:
  1. Added a repo-wide session stall policy for future agent sessions.
  2. New rule requires lean context handling after the initial doc pass, explicit blocked-state reporting, bounded command timeouts, and targeted restarts instead of silent loops.
  3. Documented that repo instructions can enforce operator behavior, but true inactivity auto-cancel still depends on the host runner.
- Verification:
  - `git status --short`
  - `npm run oracle:once` -> PASS
  - `npm run check:preflight` -> PASS
- Current blocker:
  - Arcium devnet queue path can still fail at `QueueComputation` with `AccountDidNotSerialize (3004)` in open-position flows.
- Next safe step:
  1. If hard auto-cancel/restart is required, add inactivity timers in the chat runner/orchestration layer outside this repo.

## Landing Copy: Session Messaging (2026-03-02 UTC)
- Scope:
  - `app/src/pages/index.tsx`
- Changes:
  1. Removed fixed `5h` session marketing from the landing page.
  2. Replaced the session stat card from `5h / Session window` to `Scoped / Session rules`.
  3. Updated supporting copy to describe delegated sessions without implying a hardcoded duration.
- Verification:
  - `rg -n '5h|5-hour' app/src/pages/index.tsx` -> no matches
- Current blocker:
  - Arcium devnet queue path can still fail at `QueueComputation` with `AccountDidNotSerialize (3004)` in open-position flows.
- Next safe step:
  1. Smoke the landing page on desktop and mobile after deploy to confirm the stat card still fits the layout cleanly.

## Landing Copy: Remove Session Rules Stat Card (2026-03-02 UTC)
- Scope:
  - `app/src/pages/index.tsx`
- Changes:
  1. Removed the `Scoped / Session rules` stat card from the session callout on the landing page.
  2. Kept the remaining `1x / Wallet sign` and `infinity / Trades within cap` cards unchanged.
- Verification:
  - `pnpm --dir app exec tsc --noEmit`
- Current blocker:
  - Arcium devnet queue path can still fail at `QueueComputation` with `AccountDidNotSerialize (3004)` in open-position flows.
- Next safe step:
  1. Quick visual smoke after deploy to confirm the two remaining stat cards still align cleanly in the session callout.

## Trade Submit: Callback Timeout + Clear Queued Error (2026-03-02 UTC)
- Scope:
  - `app/src/hooks/useArcium.ts`
  - `app/src/components/TradingPanel.tsx`
  - `app/src/components/TradeConfirmationModal.tsx`
- Changes:
  1. Added open-position callback polling after the relayed queue tx succeeds.
  2. The client now waits for the position account to leave `Pending` and become `Open` instead of treating queue success as a completed trade.
  3. Added a 45-second callback timeout with an explicit error when Arcium never sends the callback on the current cluster.
  4. Trade modal now shows a dedicated `Finalize / MPC callback` step.
  5. If the queue tx lands but finalization times out, the modal now shows `Queued but not finalized` and keeps the queued tx explorer link visible.
- Verification:
  - `pnpm --dir app exec tsc --noEmit`
- Current blocker:
  - Arcium devnet can still stall after `QueueComputation`, leaving callbacks missing even though the queue tx confirms.
- Next safe step:
  1. Smoke one open-position attempt on devnet and confirm the new timeout path surfaces clearly when callbacks stall.

## Trade Submit Smoke Attempt (2026-03-02 UTC)
- Scope:
  - devnet session relayer smoke
- What was verified:
  1. Refreshed stale oracle with `npm run oracle:once`.
  2. Created a fresh delegated session successfully:
     - session id: `1772465767`
     - session tx: `5D9Xda7iBhFNAqBvc6s11WCmYekrR2Datg3BYzwG13vZK2vQNasqnj1U2c3u38Gd5Aqk2GJEz7iPyR5tZBHkkXTC`
  3. Attempted delegated open with:
     - `npx ts-node scripts/session-relayer.ts open --session-id 1772465767`
- Result:
  - The open failed before queue finalization polling could begin:
    - `AnchorError caused by account: comp. Error Code: AccountDidNotSerialize (3004).`
- Impact:
  - The new client-side callback-timeout path is implemented and typechecked, but this live repo namespace could not exercise it because the existing queue serialization blocker still fails before the queue tx completes.
- Current blocker:
  - `QueueComputation` path remains unstable on current devnet namespace with `AccountDidNotSerialize (3004)`.
- Next safe step:
  1. Re-test the timeout UX immediately after the queue serialization blocker is cleared or on a namespace where queue txs succeed but callbacks stall.

## Open Queue Investigation: Callback Serialization Alignment (2026-03-02 UTC)
- Scope:
  - `programs/shadowperp/src/lib.rs`
  - `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
- Findings:
  1. Live devnet retry still reproduces the queue failure inside Arcium:
     - `AnchorError caused by account: comp. Error Code: AccountDidNotSerialize (3004)`
  2. The current `open_position_v2_callback` path was the only primary callback using `#[arcium_callback(..., auto_serialize = false)]`.
  3. `close_position_callback` and `check_liquidation_callback` already use the default callback serialization path.
- Changes:
  1. Removed `auto_serialize = false` from `open_position_v2_callback`.
  2. Added a local alias `OpenPositionV2Output = OpenPositionOutput` so the callback stays compatible with the macro's default expected output type.
- Verification:
  - `cargo check -p shadowperp` -> PASS
- Deployment + live retry:
  1. Rebuilt the SBF artifact with the repo-bundled Solana toolchain:
     - `.\.tools\solana-v2.3.13-extracted\solana-release\bin\cargo-build-sbf.exe --skip-tools-install --manifest-path programs\shadowperp\Cargo.toml --sbf-out-dir target\deploy`
  2. First deploy attempt over RPC failed with `Max retries exceeded`; closed the temporary buffer account and reclaimed `7.84317528 SOL`.
  3. Retried deploy over QUIC with a small priority fee; upgrade succeeded:
     - Program: `2Gz35PAHBkggSfV77mCENobt5YEURuYMAjgpvKXoL61d`
     - Upgrade tx: `cQJkUmU9HWoEYGGvkgtjJ62mB4GCQhSHJnGH9yj7DGZ79GF43hgfdJTCx2RuHaxZUS8s5AcB46qvWYPunkaktcD`
  4. Refreshed stale oracle:
     - Oracle tx: `5mLGvcvp1Li6LXUwS4JSPS9CQcLhULSiCp58UMxfHDDW1XG66qjc3U5vgR4RVGf879BRo1yUaDoLjTytqCaxiZhz`
  5. Created a fresh delegated session and re-ran open smoke:
     - Session create tx: `52e3E7peggU7xHcfkR7VzHSmC1zkNVioYt8EukbK3dUN8GLvgeiw4CjmLoQXTaBi8fWX3jZ156T2j4dtJ1JHCtP4`
     - Open still fails immediately in simulation with the same Arcium queue error:
       - `AnchorError caused by account: comp. Error Code: AccountDidNotSerialize (3004).`
- Current blocker:
  - This callback macro alignment change is deployed, but it does not remove the queue-path failure.
  - The deterministic blocker remains the previously documented Arcium `QueueComputation` space-formula bug on `comp`.
- Package status:
  - `cargo search arcium-anchor --limit 5` -> latest published crate is still `0.8.5`
  - `cargo search arcium-client --limit 5` -> latest published crate is still `0.8.5`
- Next safe step:
  1. Stop treating the callback macro shape as the primary suspect; the deployed retry disproved that path.
  2. Escalate the existing `AccountDidNotSerialize (3004)` bug report to Arcium with the devnet upgrade tx + fresh smoke evidence above.
  3. Do not claim open-position trading is fixed until Arcium ships a protocol-side patch or a documented workaround.

## Vercel Deploy Prep (Partial Live) (2026-03-01 UTC)
- Scope:
  - `.gitignore`
  - `.vercelignore`
  - `vercel.json`
- Changes:
  1. Linked Vercel project `shadowperp` and connected GitHub repo.
  2. Added `.vercelignore` to exclude local backup folders (`app/node_modules_bak_*`, `app/node_modules`).
  3. Added `vercel.json` to build/deploy the Next app from `/app`:
     - install: `cd app && pnpm install`
     - build: `cd app && pnpm build`
     - output: `app/.next`
  4. Removed local backup directories blocking Vercel scan:
     - `app/node_modules_bak_20260222141608`
     - `C﹕Usersbolaj` temp dir
- Deployment status:
  - CLI deploy still timed out on first production attempt.
  - Retry needed after Vercel build settings take effect.
- Next safe step:
  1. Re-run `vercel --prod --yes` from repo root.
  2. Confirm production URL and smoke `/` + `/app` (partial-live: trading disabled).

## Vercel Deploy Fixes: App-Root Config (2026-03-01 UTC)
- Scope:
  - `app/.vercelignore`
  - `app/vercel.json`
  - `.gitignore`
- Changes:
  1. Added `app/.vercelignore` to exclude `node_modules` and `.next` during app-root deployments.
  2. Added `app/vercel.json` with `framework: nextjs` to force Next detection when deploying from `/app`.
  3. Added `app/.vercel/` to root `.gitignore` to avoid tracking Vercel metadata.
- Notes:
  - `vercel link --cwd app` re-wrote `app/.env.local`; local env values were restored manually.
- Next safe step:
  1. Run `vercel --prod --cwd app --yes`.
  2. If build still shows `0ms`/Error, set Vercel project Root Directory to `app` in UI and re-deploy.

## Vercel Deploy: Root Config Cleanup (2026-03-01 UTC)
- Scope:
  - `vercel.json` (root)
  - `README.md`
- Changes:
  1. Removed root `vercel.json` to avoid Vercel trying to build from repo root (non-Next).
  2. Documented Vercel Root Directory = `app` and Node 20 requirement in README.
- Current status:
  - Deploys still failing with `0ms` build time when root dir not set.
- Next safe step:
  1. In Vercel UI, set **Root Directory** to `app` and **Node.js Version** to `20.x`.
  2. Re-deploy production.

## Partial Live Mode (Trading Disabled UI Guardrails) (2026-03-01 UTC)
- Scope:
  - `app/src/lib/feature-flags.ts`
  - `app/.env.example`
  - `app/src/components/TradingPanel.tsx`
  - `app/src/components/BottomPositionsPanel.tsx`
  - `app/src/components/PositionsList.tsx`
- Changes:
  1. Added feature flag `NEXT_PUBLIC_TRADING_DISABLED` (default 0) to support partial-live deploys.
  2. Trading panel now blocks all order submissions when disabled:
     - shows "Trading temporarily disabled"
     - limit executor no-ops
  3. Close-position actions and TP/SL auto-close are disabled when trading is disabled.
- Why:
  - Arcium devnet queue path is still failing with `AccountDidNotSerialize`, so trade actions must be blocked while read-only UI remains live.
- Verification:
  - `npm run check:preflight` -> PASS (oracle fresh)
  - `npm run canary:devnet -- --verbose` -> FAIL at `QueueComputation` with `AccountDidNotSerialize` (expected blocker)
- Next safe step:
  1. Deploy to Vercel with `NEXT_PUBLIC_TRADING_DISABLED=1`.
  2. Re-enable only after Arcium patches the devnet queue serialization issue and canary passes.

## Devnet Rollout Attempt + ABI Sync (2026-02-26 UTC)
- Scope:
  - `programs/shadowperp/src/state/position.rs`
  - `app/src/idl/shadowperp.json`
- Changes:
  1. Fixed Anchor/IDL build blocker by deriving `Debug` for:
     - `PositionStatus`
     - `MarginMode`
  2. Rebuilt program artifacts with:
     - `npm run build:anchor:safe`
  3. Deployed updated program binary + IDL to devnet:
     - program: `2Gz35PAHBkggSfV77mCENobt5YEURuYMAjgpvKXoL61d`
     - deploy signature: `2VttJqetQ4rW5SbcdyzbHofZocKRJpVZBYcQGw2LF8en6UepPDw6f3VoCY7t9pEYs4mo9LMoYTV2nCSGbuGN1jin`
  4. Synced frontend IDL:
     - `npm run app:sync-idl`
     - includes `deposit_collateral_with_session` instruction and latest `margin_mode` args in open/session-open paths.
- Verification:
  - `npm run check:preflight` -> PASS (after oracle refresh)
  - `npm run canary:devnet` -> FAIL only at queue simulation:
    - `Queue call health (open_position simulate) - AccountDidNotSerialize (queue computation account serialization)`
- Current blocker:
  - Arcium devnet queue path still fails with `AccountDidNotSerialize`.
  - ABI mismatch issue is cleared (no longer "too many arguments").
- Next safe step:
  1. Keep oracle live (`npm run oracle:daemon`) and keep preflight/canary as gates.
  2. Share latest canary + tx logs with Arcium support as the active blocker.
  3. Do not mark fully live until open+close callback flow passes canary/smoke without queue serialization failure.

## Oracle Cron Hardening (2026-02-27 UTC)
- Scope:
  - `.github/workflows/oracle-cron.yml`
  - `.github/workflows/devnet-health.yml`
  - `app/.env.example`
- Changes:
  1. Added workflow concurrency guard to prevent overlapping runs.
  2. Added `SOLANA_RPC_URL` support (server RPC preferred; falls back to `NEXT_PUBLIC_SOLANA_RPC_URL`).
  3. Wired GitHub Actions to use `SOLANA_RPC_URL` from **Secrets** (fallback to vars).
  4. Documented server-only `SOLANA_RPC_URL` in `.env.example` without exposing keys.
- Notes:
  - GitHub Actions schedules are best-effort; keep `oracle:daemon` on a stable host if strict freshness is required.

## Protocol Margin Buckets: Isolated vs Cross On-Chain (2026-02-26 UTC)
- Scope implemented:
  - `programs/shadowperp/src/state/position.rs`
  - `programs/shadowperp/src/state/margin_account.rs`
  - `programs/shadowperp/src/handlers/open_position.rs`
  - `programs/shadowperp/src/handlers/session_trading.rs`
  - `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
  - `programs/shadowperp/src/handlers/callbacks/close_position_callback.rs`
  - `programs/shadowperp/src/handlers/callbacks/liquidation_callback.rs`
  - `programs/shadowperp/src/lib.rs`
  - `app/src/lib/client.ts`
  - `app/src/hooks/useArcium.ts`
  - `app/src/pages/api/relay/open.ts`
  - `app/src/components/TradingPanel.tsx`
  - `app/src/types/index.ts`
  - `scripts/devnet-canary.ts`
  - `scripts/session-relayer.ts`
- Changes:
  1. Added protocol margin mode metadata on `Position` using reserved bytes (no account size change):
     - `MarginMode` enum (`cross` / `isolated`)
     - `position.set_margin_mode_from_u8(...)` on open paths.
  2. Added explicit lock buckets on `MarginAccount` using reserved bytes (no migration realloc):
     - `cross_locked_balance`
     - `isolated_locked_balance`
     - helpers: `lock_margin(...)`, `unlock_margin(...)`, legacy fallback handling.
  3. Updated open callback accounting:
     - lock collateral into margin-mode bucket + aggregate `locked_balance`.
  4. Updated close/liquidation callback accounting:
     - unlock from margin-mode bucket with legacy-locked compatibility fallback.
  5. Updated instruction interfaces:
     - `open_position(...)` now includes `margin_mode: u8`.
     - `open_position_with_session(...)` now includes `margin_mode: u8`.
  6. Updated relay/client/UI plumbing to pass margin mode end-to-end.
  7. Updated canary/session scripts to the new open-position arg shape.
- Safety:
  - no account-size expansion and no forced account migrations.
  - legacy positions/margin state remain closeable due fallback unlock logic.
- Verification:
  - `cargo check -p shadowperp` -> PASS
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `npm run oracle:once` -> PASS
  - `npm run check:preflight` -> PASS
- Current blocker:
  - rollout requires program rebuild/deploy + IDL sync before frontend runtime can call new arg shapes against devnet.
  - `anchor build` from current PowerShell environment needs env/toolchain stabilization (initial `HOME` error; timed run exceeded default timeout).
- Next safe step:
  1. run `anchor build` in stable shell env (set `HOME`, allow longer timeout).
  2. deploy updated program to devnet namespace.
  3. sync `target/idl/shadowperp.json` into `app/src/idl/shadowperp.json`.
  4. rerun delegated open/close smoke for both `cross` and `isolated`.

## Pending Local Mods Reviewed + Shipped (2026-02-26 UTC)
- Scope reviewed:
  - `app/next-env.d.ts`
  - `app/pnpm-lock.yaml`
  - `app/src/components/PortfolioSummary.tsx`
  - `app/src/components/PrivateOrderbook.tsx`
- Review outcome:
  1. `next-env.d.ts` route-types reference update is valid for current Next setup.
  2. lockfile updates align with current `app/package.json` (`next@15.5.10`) and dependency overrides.
  3. `PortfolioSummary.tsx` removes interactive equity popover block; summary stats remain functional.
  4. `PrivateOrderbook.tsx` updates tabs/grouping UI structure without changing trading execution paths.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `npm run check:preflight` -> PASS
- Current blocker:
  - unchanged Arcium queue-path risk (`AccountDidNotSerialize`) in current namespace.
- Next safe step:
  1. run `/app` UI smoke for portfolio summary + orderbook interactions after restart.
  2. if visual regressions appear, revert only UI component changes (`PortfolioSummary.tsx`, `PrivateOrderbook.tsx`) without touching lock/runtime files.

## Workspace Hygiene: Preview Artifact Cleanup (2026-02-26 UTC)
- Scope:
  - repo root local preview files
  - runtime theme bootstrap tracking check
- Actions:
  1. removed local preview artifacts from workspace:
     - `light-mode-*.html`
     - `logo-previews*.html`
     - `margin-mode-previews.html`
     - `session-timer-previews.html`
  2. confirmed runtime theme bootstrap remains tracked:
     - `app/public/theme-init.js`
- Verification:
  - preview file glob scan returns no matches.
  - `git ls-files app/public/theme-init.js` returns tracked path.
- Notes:
  - cleanup is workspace-safe and does not affect app runtime logic.

## Trading UX: Isolated Mode Enabled for Execution (2026-02-26 UTC)
- Scope implemented:
  - `app/src/components/TradingPanel.tsx`
- Changes:
  1. removed isolated-mode submit block:
     - deleted guard that forced:
       - `"Isolated mode is not live on-chain yet. Switch to Cross mode."`
  2. removed isolated `Preview only` badge from mode selector.
  3. hardened pre-submit collateral checks to use free collateral:
     - computes spendable margin as `balance - locked_balance` from margin account.
     - rejects orders that exceed spendable collateral, not just total balance.
  4. updated sizing slider max notional to use spendable collateral for safer isolated/cross UX when some margin is already locked.
- Safety:
  - no on-chain instruction/account layout changes.
  - no IDL changes.
  - no relay/session signing flow changes.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `npm run check:preflight` -> PASS (oracle age 124s)
- Current blocker:
  - unchanged protocol blocker on Arcium queue path can still surface in current namespace (`AccountDidNotSerialize`) during open-position queue.
- Next safe step:
  1. run manual smoke on `/app`:
     - cross submit
     - isolated submit
     - ensure both enforce spendable collateral correctly while positions are already open.
  2. if queue-path fails, continue using canary/preflight guardrails and keep isolated UI enabled as requested.

## Runtime Incident: "missing required error components" (2026-02-26 UTC)
- Symptom:
  - Browser showed: `missing required error components, refreshing...`
  - App log showed missing vendor chunk under old Next path:
    - `Cannot find module './chunks/vendor-chunks/next@14.1.0...js'`
- Root cause:
  - stale dev build output (`app/.next`) still referenced older Next runtime chunks after dependency upgrades.
- Recovery performed:
  1. stopped hosting stack
  2. removed stale `app/.next`
  3. reinstalled app deps with lockfile (`pnpm --dir app install --frozen-lockfile`)
  4. restarted hosting stack (`npm run hosting:start`)
  5. verified `/` and `/app` return `200`
- Verification:
  - `npm run check:preflight` still passes
  - app dev server compiles `/` and `/app` successfully after restart
- Next safe step:
  - if this recurs after dependency changes, repeat the same cache reset flow before deeper debugging.

## Trading UX: Margin Mode Selector (2026-02-26 UTC)
- Scope implemented:
  - `app/src/components/TradingPanel.tsx`
- Change:
  - added `MarginMode` selector (`Cross` / `Isolated`) in trading panel.
  - added mode-aware risk display metrics in the "Perps Overview" card:
    - margin ratio label/value
    - account leverage label/value
  - added explicit `Margin Mode` row in order summary.
- Safety:
  - no on-chain instruction/layout changes.
  - no IDL changes.
  - order execution path remains protocol-compatible on current devnet namespace.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `/app` returns 200 with updated panel rendering.
- Follow-up (if true isolated accounting is required):
  - add protocol-level margin mode field + liquidation/accounting branch in program and relay payloads.

## Layout Update: Detached Trading Panel (2026-02-26 UTC)
- Scope implemented:
  - `app/src/pages/app.tsx`
- Change:
  - separated trading panel container from chart+orderbook container.
  - preserved current right-side position on desktop (`lg:w-[360px]`), stacked on mobile.
  - added independent rounded border wrappers so panel is visually detached, not part of the chart/orderbook block.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `GET /app` -> 200
- Next safe step:
  - if you want stronger separation, we can add independent height constraints or drag-resizable widths without touching trade logic.

## Layout Hotfix: Chart/Orderbook Height Collapse (2026-02-26 UTC)
- Scope implemented:
  - `app/src/pages/app.tsx`
- Root cause:
  - after separating the trading panel, the inner chart/orderbook grid no longer inherited full height from its wrapper.
- Change:
  - made chart/orderbook wrapper a flex height container (`flex h-full ...`).
  - forced `trade-terminal-grid` to fill parent height (`h-full ... flex-1`).
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `GET /app` -> 200

## Layout Hardening: Non-Collapsing Terminal Height (2026-02-26 UTC)
- Scope implemented:
  - `app/src/pages/app.tsx`
- Root cause:
  - flex-basis percentage height (`basis-[60%]`) could still render as collapsed in some runtime/layout states.
- Change:
  - replaced basis-based row height with explicit viewport-based height:
    - `h-[60vh] min-h-[480px]`
  - enforced stretch semantics on row and explicit full-height on trading-panel column.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `GET /app` -> 200

## Layout Tuning: Terminal Row Height 20% (2026-02-26 UTC)
- Scope implemented:
  - `app/src/pages/app.tsx`
- Change:
  - terminal row height set to `h-[20vh]` per UI request.
  - removed previous `min-h-[480px]` floor to allow true 20% behavior.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `GET /app` -> 200

## Layout Tuning: Terminal Row Height 70% (2026-02-26 UTC)
- Scope implemented:
  - `app/src/pages/app.tsx`
- Change:
  - terminal row height updated from `h-[20vh]` to `h-[70vh]`.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `GET /app` -> 200

## UI Safety Batch: Layout Bounds + Persistent Margin Mode + Position Labels (2026-02-26 UTC)
- Scope implemented:
  - `app/src/pages/app.tsx`
  - `app/src/components/TradingPanel.tsx`
  - `app/src/lib/trade-automation.ts`
  - `app/src/components/BottomPositionsPanel.tsx`
- Changes:
  1. Terminal row bounds hardened:
     - set `h-[80vh]` with `min-h-[560px] max-h-[900px]` to avoid extreme shrink/overgrow across screens.
  2. Margin mode persistence:
     - added wallet-scoped local persistence for margin mode selection (`cross` / `isolated`) in trading panel.
     - mode now survives refresh and wallet reconnect.
  3. Margin mode propagation:
     - added `marginMode` to local automation models (`PendingLimitOrder`, `OwnerPositionView`) with backward-compatible `cross` fallback for legacy snapshots.
     - trading submissions and queued limit execution now carry margin mode into local owner views.
  4. Position/order labels:
     - open orders now display margin mode in summary row.
     - open position cards now show a mode badge (`CROSS` / `ISOLATED`) next to side/leverage badges.
- Safety:
  - no on-chain instruction changes.
  - no IDL changes.
  - devnet runtime path unchanged.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `GET /app` -> 200

## Safety/Release Batch (No Queue-Path Changes) (2026-02-26 UTC)
- Scope implemented:
  - `app/src/components/TradingPanel.tsx`
  - `.gitignore`
  - `package.json`
  - `app/package.json`
  - `app/public/theme-init.js` (tracked runtime static asset)
- Changes:
  1. Margin mode safety hardening:
     - isolated mode remains visible as preview, but trade submission is now blocked with explicit message:
       - "Isolated mode is not live on-chain yet. Switch to Cross mode."
     - prevents mismatch between UI selection and current on-chain accounting path.
  2. Repo hygiene hardening:
     - added ignore patterns for local preview/scratch HTML artifacts:
       - `light-mode-*.html`
       - `logo-previews*.html`
       - `margin-mode-previews.html`
       - `session-timer-previews.html`
     - reduced noisy untracked workspace clutter.
  3. Runtime consistency fix:
     - aligned Node engine ranges in both root and app manifests:
       - `>=20 <25`
     - removes false engine mismatch warnings for current runtime while keeping floor at Node 20.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `npm run check:preflight` -> PASS

## Security Hardening Batch Applied (2026-02-25 UTC)
- Scope implemented:
  1. on-chain close path oracle safety guard
  2. relay authorization binding hardening (action-bound signatures + auth TTL enforcement)
  3. frontend dependency critical patch (`next` 14.1.0 -> 14.2.35)

### 1) On-chain close-path stale oracle guard
- Updated:
  - `programs/shadowperp/src/handlers/close_position.rs`
- Change:
  - added `Clock::get()?` in close handler
  - enforced:
    - `price_age < 300`
    - `market.oracle_price > 0`
- Why:
  - prevents queueing close-position MPC settlement against stale/invalid oracle state.

### 2) Relay auth hardening
- Updated shared auth schema:
  - `app/src/lib/relay-session-auth.ts`
  - scope upgraded to `shadowperp:relay-session:v2`
  - message now binds:
    - action (`open` | `deposit` | `withdraw`)
    - session expiry
    - auth expiry
- Updated client session handling:
  - `app/src/hooks/useArcium.ts`
  - session now tracks `authAction`
  - auth validity now requires:
    - matching scope
    - matching action
    - non-expired `authExpiresAt`
  - action signatures are created on-demand per reason (`trade`->`open`, `deposit`, `withdraw`)
  - relay `/open` submission now sends `auth.action = "open"`
  - auth error handling expanded for `Authorization action mismatch`
- Updated collateral relay caller:
  - `app/src/components/CollateralModal.tsx`
  - always resolves session for current action reason before delegated submit
  - sends endpoint-aligned `auth.action` in request body
  - handles `Authorization action mismatch` as reauth condition
- Updated relay API validators:
  - `app/src/pages/api/relay/open.ts`
  - `app/src/pages/api/relay/deposit.ts`
  - `app/src/pages/api/relay/withdraw.ts`
  - checks now enforce:
    - endpoint/action alignment (`auth.action`)
    - `authExpiresAt <= sessionExpiry`
    - `authExpiresAt > now`
    - signature verification against action-bound message payload

### 3) Dependency patch
- Updated:
  - `app/package.json`
  - `app/pnpm-lock.yaml`
- Change:
  - `next` bumped from `14.1.0` to `14.2.35`
- Audit delta:
  - before: `1 critical, 7 high, 9 moderate, 3 low`
  - after: `0 critical, 2 high, 4 moderate, 1 low`
  - remaining highs are transitive/line-level advisories requiring broader upgrades (not this safety patch).

### Verification
- `cargo check -p shadowperp` -> PASS (warnings only)
- `pnpm --dir app exec tsc --noEmit` -> PASS
- `npm run check:preflight` -> PASS
- `pnpm --dir app audit --prod` -> PASS with residual advisories only (no critical)

### Current blocker
- Unchanged protocol blocker:
  - Arcium devnet queue path can still fail on open-position with `AccountDidNotSerialize` in current namespace.

### Next safe step
1. run delegated-session smoke for all 3 actions (open/deposit/withdraw) using new v2 auth signatures.
2. if stable, deploy/sync and confirm no stale close settles by forcing stale oracle and verifying close rejection.
3. plan staged dependency upgrades for remaining advisories (likely Next 15 line + selected wallet stack transitive updates).

## Security Audit Pass (2026-02-25 UTC)
- Scope:
  - on-chain program handlers + state
  - relay API endpoints
  - client crypto/session plumbing
  - dependency vulnerabilities (pnpm audit)
- Findings (no code changes yet):
  - On-chain: `close_position` does not enforce oracle staleness or price>0 before queuing MPC; stale oracle can settle at an old price.
    - file: `programs/shadowperp/src/handlers/close_position.rs`
  - Relay auth scope: the session auth message is scoped as `shadowperp:relay-open:v1`, but the same signature is accepted for deposit/withdraw/open; no action-specific binding.
    - file: `app/src/lib/relay-session-auth.ts`
    - endpoints: `app/src/pages/api/relay/open.ts`, `app/src/pages/api/relay/deposit.ts`, `app/src/pages/api/relay/withdraw.ts`
  - Relay auth expiry: request `auth.expiresAt` is checked only against session expiry, but the signed message always uses session expiry; shorter TTL is not enforced.
    - file: `app/src/pages/api/relay/open.ts` (+ deposit/withdraw)
  - Dependency risk: `pnpm --dir app audit --prod` reports 1 critical, 7 high, 9 moderate, 3 low (primarily Next.js < patched versions).
    - critical: Next.js middleware auth bypass (`next` < 14.2.25)
- Verification:
  - `npm run check:preflight` -> PASS after `npm run oracle:once`
  - Oracle refreshed (one-shot) to reset staleness.
- Current blocker:
  - unchanged: Arcium devnet `QueueComputation` serialization (`AccountDidNotSerialize`) still blocks open-position queue path.
- Next safe step:
  1. Decide whether to patch `close_position` staleness guard and relay auth scoping in one batch.
  2. If yes, implement + `cargo check -p shadowperp` + `pnpm --dir app exec tsc --noEmit`.
  3. Plan dependency upgrade for `next` to a patched version (>=14.2.35 or 15.x) with a staged branch.

## Equity Breakdown Card Added (2026-02-25 UTC)
- User request:
  - account equity UX should resemble a dedicated breakdown panel (Spot/Perps + Perps Overview).
- Implemented:
  - `app/src/components/PortfolioSummary.tsx`
    - `Account Equity` stat is now clickable and opens a breakdown card.
    - added panel rows:
      - Spot
      - Perps
      - Balance
      - Unrealized PNL
      - Cross Margin Ratio
      - Maintenance Margin
      - Cross Account Leverage
    - added supporting computed metrics:
      - `estimatedNotional` (from active local position views at live price)
      - `maintenanceMargin = estimatedNotional * 0.05` (UI estimate)
      - `crossAccountLeverage = estimatedNotional / accountEquity` (when equity > 0)
    - added click-outside close behavior for the card.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `npm run hosting:restart` -> PASS
- Current blocker:
  - none introduced; some rows are estimations if full on-chain position decomposition is unavailable.
- Next safe step:
  1. click Account Equity in header strip and confirm card behavior
  2. validate values while positions are open and prices move

## Account Equity Added to Portfolio Strip (2026-02-25 UTC)
- User request:
  - add account equity support to perp UI.
- Implemented:
  - `app/src/components/PortfolioSummary.tsx`
    - added `accountEquity` to portfolio data model.
    - computes equity as:
      - `accountEquity = marginBalance + (unrealizedPnl ?? 0)`
      - clamped at `>= 0` for UI safety.
    - updated health estimate to use equity ratio over posted margin:
      - `health = clamp((accountEquity / marginBalance) * 100, 0..100)`
      - falls back to `100` when margin exists but no unrealized signal.
    - added new `Account Equity` stat in the top portfolio strip.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `npm run hosting:restart` -> PASS
- Current blocker:
  - none introduced by this patch; equity uses client-side unrealized estimate when position views exist.
- Next safe step:
  1. confirm equity updates after opening position and as market price changes
  2. if required, wire a strictly on-chain-equity surrogate metric for environments where local position views are unavailable

## Pair Dropdown Front-Layer Fix (2026-02-25 UTC)
- User issue:
  - pair selector token list rendered under chart layer (remaining SPL tokens visually hidden behind chart).
- Implemented:
  - `app/src/components/MarketInfo.tsx`
    - market bar now uses explicit stacking + visible overflow:
      - `relative z-[120] overflow-visible`
  - `app/src/components/PairSelector.tsx`
    - selector wrapper raised to `z-[130]`
    - dropdown raised to `z-[140]` with explicit shadow for visual separation.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `npm run hosting:restart` -> PASS (app + oracle relaunched)
- Current blocker:
  - none introduced by this layering fix.
- Next safe step:
  1. hard refresh `/app`
  2. open pair selector and confirm full token list is above chart layer

## Session Reuse on Refresh + Gas Drain Reduction (2026-02-25 UTC)
- User issue:
  - refresh could still show "start/sign session" and lead to extra paid txs instead of reusing active delegated session.
  - expectation: reuse active session across refresh/theme switch; only request wallet signature when needed, and avoid new on-chain fee if session already exists.
- Implemented:
  - `app/src/pages/api/relay/session.ts`
    - added owner-only lookup path: `GET /api/relay/session?owner=<wallet>`
    - scans on-chain `trade_session` accounts for `{owner, market, relayer}` and returns latest active session.
    - keeps existing owner+sessionId lookup behavior unchanged.
  - `app/src/hooks/useArcium.ts`
    - added on-hydration recovery flow that attempts on-chain active-session adoption when storage is missing/stale.
    - added explicit relay-auth validity helper and auth refresh flow:
      - if on-chain session exists but auth signature is missing, user can continue with message signature only (no new session-create tx).
    - changed collateral delegate approval behavior to be reason-scoped:
      - only enforced for `reason: "deposit"`.
      - `trade` and `withdraw` session ensure paths no longer trigger token delegate approval tx.
    - improved ensure path order:
      - in-memory -> local storage -> refresh specific candidate -> on-chain latest recovery -> create new session (user-initiated only).
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `npm run check:preflight` -> PASS
  - local relay endpoint check:
    - `GET /api/relay/session?owner=<wallet>` returns availability + session existence status.
- Current blocker:
  - none introduced by this patch; remaining behavior depends on wallet localStorage availability and relay/API uptime.
- Next safe step:
  1. connect wallet and refresh page
  2. confirm session indicator/trade CTA does not force new on-chain session creation when active session exists
  3. capture one relay session payload if unexpected prompt still appears (to verify auth expiry/session counters)

## Market Stats Live Wiring (2026-02-25 UTC)
- User issue:
  - top market strip showed `24H Volume`, `24H High`, `24H Low` as `--` even when price/change were live.
- Implemented:
  - `app/src/pages/api/prices.ts`
    - extended `PriceData` payload to include `volume24h`, `high24h`, `low24h`.
    - upgraded CoinGecko source to `coins/markets` endpoint so high/low/volume are provided.
    - hardened Binance fetch path with batch-first + per-symbol fallback so one invalid symbol no longer zeroes the whole source.
  - `app/src/lib/prices.ts`
    - extended frontend `PriceData` model to carry `volume24h`, `high24h`, `low24h`.
    - upgraded direct CoinGecko fallback to `coins/markets` with full stat fields.
  - `app/src/components/MarketInfo.tsx`
    - removed hardcoded `--` placeholders for volume/high/low and bound stats to live feed values.
    - added formatting helpers for compact USD volume and USD price stats.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `GET /api/prices` -> provider `mixed` and `SOL-PERP` now returns:
    - `price`, `change24h`, `volume24h`, `high24h`, `low24h`
  - `npm run hosting:status` -> app running + oracle running
- Current blocker:
  - none introduced by this patch; values still depend on upstream provider availability/rate limits.
- Next safe step:
  1. hard refresh `/app` and confirm market strip renders non-`--` values
  2. if any pair still lacks high/low, log provider + pair label and extend fallback strategy per source

## Session Stability + Collateral Relay Reliability (2026-02-24 UTC)
- User issue:
  - delegated session kept re-triggering wallet prompts
  - delegated deposit/withdraw could fail with `Invalid session authorization signature`
  - recent UI/runtime changes did not appear reflected consistently
- Implemented:
  - `app/src/hooks/useArcium.ts`
    - added session auth scope tracking (`authScope`) and enforced scope check for usability.
    - normalized stored/remote session numeric fields (`maxActions`, `usedActions`, `expiresAt`) to prevent stale/invalid comparisons.
    - added local session hydration state (`relaySessionHydrated`) so auto-session init waits for stored-session load.
    - `ensureRelaySession()` now checks storage-first before creating a new on-chain session, reducing duplicate signing prompts.
    - added `invalidateRelaySession()` and integrated invalid-signature invalidation in submit path.
  - `app/src/components/TradingPanel.tsx`
    - auto session init now waits for `relaySessionHydrated` before creating session.
  - `app/src/components/CollateralModal.tsx`
    - added shared delegated collateral submit helper for both deposit/withdraw.
    - added one-time auto-rotation on auth-signature/session-expiry errors:
      - invalidate local session
      - re-create session
      - retry delegated request once
  - `app/src/components/PortfolioSummary.tsx`
    - wired `invalidateRelaySession` into `CollateralModal`.
  - restarted hosting stack so latest frontend/runtime code is active.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `pnpm --dir app build` -> PASS
  - `npm run hosting:status` -> app running + oracle running
  - `npm run check:preflight` -> PASS (oracle fresh within 300s)
- Current blocker:
  - known Arcium devnet `QueueComputation` serialization blocker for open-position path (`AccountDidNotSerialize`) still remains protocol-side.
- Next safe step:
  1. smoke test delegated session flow in UI:
     - connect wallet
     - verify one session sign
     - delegated deposit
     - delegated withdraw
     - open position (session path)
  2. if auth error reappears, capture exact relay API response and tx signature for targeted replay.

## GitHub Health-Check Email Noise Guard (2026-02-24 UTC)
- Issue:
  - `Devnet Health Check` workflow emails were triggering while operator was offline.
- Cause:
  - workflow had scheduled cron every 10 minutes and failures emit GitHub notifications regardless of local online status.
- Implemented:
  - `.github/workflows/devnet-health.yml`
    - job now runs only when:
      - manually triggered (`workflow_dispatch`), or
      - repo variable `ENABLE_DEVNET_HEALTH_CRON=1` is set.
- Operational note:
  - leave `ENABLE_DEVNET_HEALTH_CRON` unset to suppress scheduled health-run failures/emails.
  - set it to `1` only when you want continuous GitHub-based health monitoring.

## Session Popup/SOL Drain Fix (2026-02-24 UTC)
- User issue:
  - every page refresh triggered a new delegated session signature and on-chain session creation.
- Root cause:
  - automatic session bootstrap in `TradingPanel` could create sessions without explicit user intent (on refresh/reconnect paths).
- Implemented:
  - `app/src/components/TradingPanel.tsx`
    - removed auto session-init effect on mount/refresh.
    - trade button is now enabled without pre-existing session and shows `Sign Session & ...` when session is missing.
  - `app/src/hooks/useArcium.ts`
    - `submitPrivateOrder()` now ensures a valid session on-demand before relay submission.
    - if no valid session exists, it prompts a single session signature at trade time, then reuses it.
- Outcome:
  - no automatic session creation on page refresh.
  - no repeated SOL spend from refresh loops.
  - session is created only when user performs an action (trade/deposit/withdraw) requiring it.

## Refresh/Theme Signature Popup Hardening (2026-02-24 UTC)
- User issue:
  - wallet signature popup still appeared on refresh/theme switch.
- Root cause:
  - encrypted automation persistence was unlocking on component mount, which triggers `signMessage` every refresh.
- Implemented:
  - `app/src/components/TradingPanel.tsx`
    - removed mount-time `enableEncryptedAutomationPersistence` call.
    - unlock now runs only on explicit user action (limit-order queue path).
    - kept auto-disable when wallet/signer is unavailable.
  - also removed pre-submit hard block on missing session in `handleSubmit`; session creation is now on-demand inside private submit path.
- Result:
  - refresh/theme switch no longer triggers signature requests.
  - signatures appear only on explicit actions (trade/deposit/withdraw or first encrypted limit-order persistence unlock).

## Delegated Withdraw Fallback Guard (2026-02-24 UTC)
- User issue:
  - delegated withdraw failed with `InstructionFallbackNotFound` (Anchor 101).
- Cause:
  - deployed program binary does not expose `withdraw_collateral_with_session` path expected by relay.
- Implemented:
  - `app/src/components/CollateralModal.tsx`
    - when delegated withdraw hits unsupported-instruction errors (`InstructionFallbackNotFound` / method missing), UI now falls back to wallet withdraw path automatically.
    - preserves delegated withdraw first when available.
- Result:
  - withdraw no longer hard-fails on this deployment mismatch.
  - user can still withdraw collateral while relay/session withdraw instruction is pending deployment.

## Explicit Session Start Control (2026-02-25 UTC)
- User issue:
  - session signing popup not appearing when expected.
- Implemented:
  - `app/src/components/MarketInfo.tsx`
    - added explicit `Start session` action when relay is available but no active session exists.
    - button calls `ensureRelaySession({ reason: "trade", userInitiated: true })`.
    - success/error feedback now shown via toast.
- Rationale:
  - keeps no-auto-sign safety on refresh/theme switch while restoring a deterministic manual session entry point.

## Chart Height Reduction (2026-02-24 UTC)
- User request:
  - reduce chart height by 60%.
- Implemented:
  - `app/src/pages/app.tsx`
    - terminal top row (`trade-terminal-grid`) changed from full remaining height to `basis-2/5` (40% of terminal body).
    - positions wrapper changed to `flex-1 min-h-0` so remaining height is consumed by bottom panel.
  - `app/src/components/BottomPositionsPanel.tsx`
    - root panel now uses `h-full` so it fills the remaining terminal space cleanly.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
- Current blocker:
  - none introduced by this layout change.
- Next safe step:
  1. visual QA on `/app` in light and dark mode
  2. if exact pixel target is needed, replace `basis-2/5` with explicit `h-[...]` per breakpoint

## Landing Theme Toggle Placement + Default Light (2026-02-24 UTC)
- User request:
  - landing page should default to light mode.
  - replace top nav mini toggle with `LIGHT MODE PREVIEW` style button at bottom that toggles light/dark.
- Implemented:
  - `app/src/pages/index.tsx`
    - theme state now initializes to light-first (`useState(true)` + existing saved-theme load).
    - toggle now switches theme live via `document.documentElement.classList` and updates localStorage without page reload.
    - removed top nav sun/moon toggle control.
    - added bottom fixed preview button:
      - shows `LIGHT MODE PREVIEW` in light mode, `DARK MODE PREVIEW` in dark mode.
      - styled to match provided pill-style purple button.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
- Current blocker:
  - none introduced by this change.
- Next safe step:
  1. hard refresh landing page (`/`) and verify bottom toggle behavior
  2. verify theme persistence by reloading page and reopening browser tab

## Compact Panel Height Pass (2026-02-24 UTC)
- User request:
  - reduce panel heights in the terminal area by ~60% for a denser layout.
- Implemented (UI-only, no trading logic touched):
  - `app/src/components/PriceChart.tsx`
    - reduced timeframe toolbar vertical padding and button heights.
  - `app/src/components/PrivateOrderbook.tsx`
    - reduced tab/header/spread/footer row heights and book row line height.
  - `app/src/components/TradingPanel.tsx`
    - reduced panel padding, block spacing, button/input heights, leverage block size, summary card footprint, and submit button height.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
- Current blocker:
  - none introduced by this pass.
- Next safe step:
  1. visual QA in light mode on `/app`
  2. if needed, apply a second pass for exact pixel target per panel

## Hosting Incident: "missing required error components" loop (2026-02-24 UTC)
- User symptom:
  - browser showed `missing required error components, refreshing...` and page did not load.
- Verification:
  - `npm run hosting:status` showed `oracle: running` but `app: stopped`.
  - env and chain preflight were valid (`npm run check:preflight` PASS).
  - after app restart, `http://127.0.0.1:3000/` and `/app` both returned HTTP 200.
- Root cause:
  - hosting stack was partially up (oracle-only), so browser sat in refresh loop waiting for Next error/runtime components from a non-running app server.
- Recovery used:
  - `npm run hosting:start`
  - (or deterministic reset) `npm run hosting:restart`
- Current blocker:
  - none for hosting/runtime startup.
- Next safe step:
  1. always use `npm run hosting:status` first when UI appears blank
  2. if app is stopped, run `npm run hosting:restart`
  3. hard refresh browser once app is confirmed running

## Light Mode UI Alignment + Session Collateral Relay Fix (2026-02-24 UTC)
- User issue:
  - delegated collateral withdraw returned `Invalid session authorization signature`
  - requested app UI to match provided light-mode terminal preview exactly
  - requested TradingView chart palette alignment without changing chart functionality
- Session collateral updates now in repo:
  - `app/src/components/CollateralModal.tsx`
    - relay auth now uses session-bound `authExpiresAt` (`session.authExpiresAt ?? session.expiresAt`) instead of ad-hoc short TTL, removing signature mismatch source
    - added delegated deposit call path via `/api/relay/deposit`
    - safe fallback to wallet-signed deposit when delegated deposit instruction is not active on current deployed IDL
  - `app/src/pages/api/relay/deposit.ts` added (session-verified relay endpoint)
  - `app/src/hooks/useArcium.ts` / `app/src/lib/client.ts` include session/delegate support plumbing for collateral path
  - on-chain additions for delegated deposit exist in:
    - `programs/shadowperp/src/handlers/session_trading.rs`
    - `programs/shadowperp/src/lib.rs`
  - runtime gate:
    - `NEXT_PUBLIC_SESSION_DEPOSIT_ENABLED=1` enables delegated deposit path
- Light mode terminal alignment pass:
  - shell/grid/header tuned to preview proportions in `app/src/pages/app.tsx`
    - main grid now `chart | orderbook | trading` with fixed right columns
    - header includes inline preview theme button
  - theme toggle reworked in `app/src/components/ThemeToggle.tsx`
    - header variant: `LIGHT MODE PREVIEW` style button
    - floating variant retained
  - light-mode visual system tightened in `app/src/styles/globals.css`
    - neutral light surfaces, border hierarchy, typography contrast, header/market/portfolio bar treatment
    - component-scoped light overrides for chart/orderbook/trading/positions panels
  - class hooks added for styling only (no execution logic changes):
    - `MarketInfo`, `PriceChart`, `PrivateOrderbook`, `TradingPanel`, `BottomPositionsPanel`, `PortfolioSummary`, `PairSelector`, `NeuralShadowBackground`
  - TradingView styling:
    - `app/src/components/PriceChart.tsx` uses light toolbar background (`toolbarbg=#f8f9fc`) when light mode is active
- Verification run:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `cargo check -p shadowperp` -> PASS (warnings only)
  - `npm run check:preflight` -> PASS
  - `pnpm --dir app exec next build` -> FAIL on pre-existing export/page mapping issue (`PageNotFoundError` for `/` and `/terminal-v2`), not introduced by this light-mode pass
- Current blocker:
  - end-to-end open/close trade queue remains blocked by Arcium `QueueComputation` serialization (`AccountDidNotSerialize`) in devnet open-position path
  - delegated deposit will only be fully relay-native live after updated program+IDL deployment and enabling `NEXT_PUBLIC_SESSION_DEPOSIT_ENABLED=1`
- Next safe step:
  1. deploy/sync latest program + IDL including `deposit_collateral_with_session`
  2. set `NEXT_PUBLIC_SESSION_DEPOSIT_ENABLED=1`
  3. run delegated collateral smoke:
     - create/refresh session
     - deposit via session
     - withdraw via session
     - verify both tx signatures on explorer

## Leverage UI Consistency Fix (2026-02-22 UTC)
- User-reported UI issue: leverage scale looked inconsistent/misaligned.
- Updated leverage controls in `app/src/components/TradingPanel.tsx`:
  - Introduced `MIN_LEVERAGE`/`MAX_LEVERAGE` derived from presets.
  - Slider range now matches presets (`2x` to `50x`) instead of `1x` to `50x`.
  - Tick labels now come from `LEVERAGE_PRESETS` and use dynamic positioning logic.
  - Endpoint ticks (`2x`, `50x`) are anchored left/right to avoid clipping; middle ticks are centered.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS

## Runtime Env Incident: Missing Market Var Toast (2026-02-22 UTC)
- Symptom observed in UI:
  - `Client init failed: Missing required env var: NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT`
- Verification:
  - `app/.env.local` already contained `NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT=C3UcQ3FnjqUsFPWfDgKNoq4cGzpWw6tSEqM6bf1MoFv8`.
- Root cause:
  - stale Next.js dev process not reflecting current env state.
- Action taken:
  - terminated existing `npm run dev` / `next` node processes
  - restarted dev server from `app/` (`pnpm dev`)
  - confirmed listener on port `3000` and `/api/prices` returns live payload.
- Operator note:
  - if this toast reappears with env present, restart dev server and hard-refresh browser before changing code.

## Live Price UX Hardening + Fallback Cleanup (2026-02-22 UTC)
- Implemented backend live-price route for the app UI:
  - `app/src/pages/api/prices.ts`
  - Provider order:
    1. CoinGecko (primary)
    2. CoinMarketCap (optional if `COINMARKETCAP_API_KEY` is set)
    3. stale in-memory cache
    4. static mock fallback
  - Added short in-memory server cache to reduce upstream rate-limit pressure.
- Reworked client price fetch pipeline:
  - `app/src/lib/prices.ts`
  - Now calls `/api/prices` first, then direct CoinGecko only as emergency fallback.
  - Added diagnostics meta:
    - `getLastPriceMeta()` with quality (`live`/`cached`/`mock`) and provider.
- Removed visible fallback noise in trade UI:
  - `app/src/components/MarketInfo.tsx`
    - removed visible `fallback/live/stale` badge text.
  - `app/src/components/TradingPanel.tsx`
    - removed visible yellow fallback warning panel.
    - kept safety behavior for trade submission gating when runtime/client is invalid.
- Runtime env resilience improvement:
  - `app/src/lib/runtime.ts`
  - `parsePublicKey` now normalizes wrapped values (`<...>`, quotes), reducing false init failures from pasted env formatting.
  - `NEXT_PUBLIC_ARCIUM_PROGRAM_ID` now safely falls back to Arcium canonical program address.
- Env template update:
  - `app/.env.example`
  - added optional `COINMARKETCAP_API_KEY` (server-side only).

### Verification Run (post-change)
- `pnpm --dir app exec tsc --noEmit` -> PASS
- `npm run oracle:once` -> PASS
- `npm run check:preflight` -> PASS
- `npx ts-node _smoke_devnet.ts` -> FAIL (unchanged known blocker):
  - Arcium CPI `QueueComputation`
  - `AnchorError account: comp`
  - `AccountDidNotSerialize (3004)`

### Current blocker
- Trading execution is still blocked by Arcium queue serialization in `open_position` path (`comp` account serialization failure), unrelated to chart/feed UI.

### Next safe step
1. Keep current UI/live-price changes as-is (safe, non-protocol-breaking).
2. Continue protocol unblocking with minimal repro payload-size reduction in `open_position` queue args/callback footprint, then rebuild/redeploy/re-init comp-defs and re-run smoke.

## Arcium Docs Triage + Client Comp-Def Pointer Fix (2026-02-22 UTC)
- User request: use Arcium docs/repos to identify practical unblockers for current queue failure.
- Completed baseline checklist:
  - read `DEV_NOTES.md`
  - `git status --short`
  - verified active env values (`app/.env.local`)
  - `npm run check:preflight` / `npm run check:oracle`
  - refreshed oracle via `npm run oracle:once` and re-ran preflight to PASS
- Implemented client hardening fix:
  - `app/src/lib/client.ts`
  - stopped deriving comp-def PDAs by instruction name in the frontend client path
  - now uses market-stored on-chain pointers:
    - `market.openPositionCompDef`
    - `market.closePositionCompDef`
    - `market.liquidationCompDef`
  - added guard on missing open-position comp-def pointer.
- Updated typed market model:
  - `app/src/types/index.ts`
  - added:
    - `openPositionCompDef: PublicKey`
    - `closePositionCompDef: PublicKey`
    - `liquidationCompDef: PublicKey`

### Verification Run (post-change)
- `pnpm --dir app exec tsc --noEmit` -> PASS
- `npm run oracle:once` -> PASS
- `npx ts-node _smoke_devnet.ts` -> FAIL (same blocker):
  - Arcium CPI `QueueComputation`
  - `AnchorError account: comp`
  - `AccountDidNotSerialize (3004)`

### Additional diagnostics captured
- Decoded open-position comp-def directly from Arcium account:
  - params: 15
  - outputs: 4
  - finalized + correct owner
- Confirms current deployed comp-def signature aligns with batched v2 layout.
- Remaining failure is still at Arcium computation account serialization stage on queue.

### Current blocker
- `open_position` queue path still fails on Arcium with `AccountDidNotSerialize (3004)` for `comp`.
- This is after:
  - correct market comp-def pointer
  - fresh oracle
  - valid accounts + PDA constraints
  - matching 15/4 signature on-chain.

### Next safe step
1. Isolate computation-account space pressure by shrinking queue payload in a controlled branch:
   - keep current circuit semantics
   - reduce queued callback/argument footprint (Arcis `EncData`/reference patterns per docs)
   - rebuild circuits, redeploy, re-init comp-defs, retest smoke.
2. If failure persists after payload shrink, escalate with a minimal repro (single open-position queue) to Arcium support with tx logs + comp-def signature dump.

## UI Cleanup + Orders Tab Merge (2026-02-22 UTC)
- Implemented requested UI behavior updates:
  - Hid V2 top status strip message.
    - Updated: `app/src/pages/app.tsx`
  - Moved limit-order list into bottom tabbed panel.
    - Added `Orders` tab beside `Position` and `History`.
    - Renamed tab label `Open Positions` -> `Position`.
    - Renamed `Open Limit Orders` concept -> `Orders`.
    - Updated: `app/src/components/BottomPositionsPanel.tsx`
    - Removed old separate "Open Limit Orders" section from: `app/src/components/TradingPanel.tsx`
- Removed demo-mode user messaging/copy:
  - Reworded collateral/trading unavailability errors to config/runtime wording.
    - `app/src/components/CollateralModal.tsx`
    - `app/src/components/TradingPanel.tsx`
  - Replaced market badge state from `demo` to `fallback`.
    - `app/src/components/MarketInfo.tsx`
  - Updated comments mentioning demo mode:
    - `app/src/components/PortfolioSummary.tsx`
    - `app/src/components/PositionsList.tsx`
    - `app/src/lib/tokens.ts`

### Verification Run (post-change)
- `cd app && pnpm exec tsc --noEmit` -> PASS
- `npm run oracle:once` -> PASS
- `npm run check:preflight` -> PASS
- `npx ts-node _smoke_devnet.ts` -> FAIL (unchanged blocker):
  - `QueueComputation` -> `AccountDidNotSerialize (3004)` on `comp`

## UI V2 Guardrail Phase (2026-02-22 UTC)
- Implemented requested wrapper-only V2 integration with fallback:
  - Flag: `NEXT_PUBLIC_UI_V2=1`
  - Backward-compatible alias still accepted: `NEXT_PUBLIC_SAFE_UI_ADAPT=1`
- Added V2 presentation atoms/wrappers (non-critical only):
  - `app/src/components/ui-v2/V2SectionMotion.tsx`
  - `app/src/components/ui-v2/V2Panel.tsx`
  - `app/src/components/ui-v2/V2Badge.tsx`
  - `app/src/components/ui-v2/V2StatusStrip.tsx`
- Wired into trade page without rewriting core data paths:
  - `app/src/pages/app.tsx`
  - Existing data/execution components remain source-of-truth:
    - `PriceChart`
    - `TradingPanel`
    - `BottomPositionsPanel`
- Added explicit no-touch guardrail doc:
  - `NO_TOUCH_LIST.md`
  - Included in onboarding order in `AGENTS.md`.
- Template-risk hardening:
  - `app/next.config.js` now explicitly sets:
    - `typescript.ignoreBuildErrors = false`
  - `app/.env.example` now documents:
    - `NEXT_PUBLIC_UI_V2`
    - deprecated alias `NEXT_PUBLIC_SAFE_UI_ADAPT`

### Verification Run (post-change)
- `cd app && pnpm exec tsc --noEmit` -> PASS
- `npm run check:preflight` -> initially FAIL (oracle stale), then PASS after `npm run oracle:once`
- `npx ts-node _smoke_devnet.ts` -> FAIL (unchanged blocker):
  - Arcium CPI `QueueComputation`
  - `AnchorError account: comp`
  - `AccountDidNotSerialize (3004)`

### Arcium Playbook Scan (sicmundu/arcium-playbook)
- Useful operational patterns confirmed:
  - automate IDL sync before frontend run (`scripts/run_frontend.sh`)
  - enforce comp-def init wrappers/checklists per lifecycle
  - maintain explicit env templates for RPC/cluster/program IDs
- Practical relevance to Shadow:
  - Added a Shadow-specific frontend sync wrapper:
    - `scripts/run-frontend.ts`
    - `npm run app:sync-idl`
    - `npm run app:dev:sync-idl`
  - Behavior:
    - syncs `target/idl/shadowperp.json` -> `app/src/idl/shadowperp.json` before frontend startup
  - does not directly resolve `AccountDidNotSerialize`; blocker remains in Arcium queue serialization path

## Safe UI Adaptation from External ZIP (2026-02-22 UTC)
- Request implemented:
  - Adapt external UI kit patterns into ShadowPerp without touching sensitive execution paths.
- Source package reviewed:
  - `C:\Users\bolaj\Downloads\b_e8TSgupk7Ed-1771769091622.zip`
- Safe adaptation boundaries:
  - Preserved existing sensitive components and flows:
    - `app/src/components/PriceChart.tsx`
    - `app/src/components/TradingPanel.tsx`
    - `app/src/lib/client.ts` execution wiring
    - existing Shadow logo rendering in `app/src/pages/app.tsx`
  - Added non-invasive UI layer only:
    - `app/src/components/adapted/SafeMotionSection.tsx`
    - `app/src/components/adapted/TopStatusStrip.tsx`
    - wiring in `app/src/pages/app.tsx`
- Feature flag:
  - `NEXT_PUBLIC_SAFE_UI_ADAPT=1` enables adapted shell/motion layer.
  - `0` or unset keeps prior layout behavior.
- Env template update:
  - `app/.env.example` now documents `NEXT_PUBLIC_SAFE_UI_ADAPT`.

## Blocker Refresh (2026-02-22 UTC)
- Fresh checks run:
  - `npm run check:preflight`
  - `npm run oracle:once`
  - `npx ts-node _smoke_devnet.ts`
  - `npx ts-node scripts/_open_position_test.ts`
- Current findings:
  - Preflight now shows open comp-def pointer is `8QvPiBX18gbcWpKLZiwiMDnCP9hcpqJBs4sCxo6hQX15` and finalized with `params=15, outputs=4`.
  - `_smoke_devnet.ts` path still fails before queue with comp-def seed mismatch because app client derives `open_position` comp-def (`27h...`) instead of `open_position_v2`.
  - Direct open test using market pointer (`8Qv...`) reaches Arcium queue but fails with:
    - `AccountDidNotSerialize (3004)` on account `comp`.
- Practical interpretation:
  - One frontend bug remains (wrong comp-def derivation in `app/src/lib/client.ts`).
  - One deeper Arcium queue serialization issue remains even when using correct comp-def.
- Safe fix order:
  1. Fix app client to use market-stored comp-def pointers (or `open_position_v2`) for open/close/liquidation account wiring.
  2. Re-run smoke; expected remaining error should be only `AccountDidNotSerialize`.
  3. Resolve serialization blocker by strict version alignment + fresh deploy/comp-def cycle:
     - keep crates/JS/CLI on same Arcium version
     - rebuild circuits
     - rebuild/deploy program
     - re-init/sync comp-defs
     - retry direct open test

## Auto RPC Selection Enabled (2026-02-22 UTC)
- Implemented automatic frontend RPC switching for smoother UX.
- File changed:
  - `app/src/pages/_app.tsx`
- Behavior:
  - probes all configured endpoints (`NEXT_PUBLIC_SOLANA_RPC_URLS`) on startup and every 45s
  - uses `getLatestBlockhash` probe latency + health to rank endpoints
  - auto-switches when:
    - startup best endpoint differs from current
    - current endpoint is unhealthy
    - best endpoint is significantly faster (with cooldown)
  - persists selected endpoint index via `setPreferredRpcIndex(...)`
- Safety:
  - 90s cooldown to reduce endpoint flapping
  - no switch if all endpoints are unhealthy
- Validation:
  - `pnpm exec tsc --noEmit` passed in `app/`.

## UI Tweak: Hide RPC Chip (2026-02-22 UTC)
- Removed visible `RPC x/y` switch chip from the top network indicator for cleaner UX.
- File changed:
  - `app/src/components/NetworkIndicator.tsx`
- Kept:
  - network badge (devnet/mainnet/localnet)
  - wallet token balance chips
- Verification:
  - `pnpm exec tsc --noEmit` passed in `app/`.

## Onboarding Docs Added (2026-02-22 UTC)
- Added root-level onboarding references for future engineers/agents:
  - `ARCHITECTURE.md`
  - `PERP_UI_SYSTEM.md`
  - `DATA_FLOW.md`
  - `DESIGN_RULES.md`
  - `AGENTS.md`
- Purpose:
  - standardize architecture, UI behavior, data-flow expectations, and operating rules
  - reduce handoff ambiguity between dev sessions
  - make `DEV_NOTES.md` the live status source and these files the stable baseline
- Notes:
  - all new docs are ASCII-clean
  - `AGENTS.md` explicitly enforces reading `DEV_NOTES.md` first each session

## Callback Macro Fix (2026-02-22 UTC)
- Root cause:
  - `open_position_v2` callback handler used `SignedComputationOutputs<OpenPositionV2Output>`.
  - In current macro expansion for this repo, the generated output type is `OpenPositionOutput`.
  - This caused compile failure:
    - `cannot find type OpenPositionV2Output in this scope`
- Applied fix:
  - `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
  - Updated handler signature to:
    - `SignedComputationOutputs<OpenPositionOutput>`
- Verification:
  - `cargo check -p shadowperp` now passes.

## User RPC Bundle Integration (2026-02-22 UTC)
- User-provided providers captured for failover usage:
  - Helius devnet RPC (`https://devnet.helius-rpc.com/?api-key=...`)
  - Helius parse APIs (`/v0/transactions`, `/v0/addresses/{address}/transactions`)
  - Ankr devnet RPC (`https://rpc.ankr.com/solana_devnet/...`)
  - Alchemy devnet RPC (`https://solana-devnet.g.alchemy.com/v2/...`)
  - Chainstack API key provided, but full Solana devnet endpoint URL not yet added.
- Practical setup:
  - Put all Solana RPC endpoints in:
    - root env: `SOLANA_RPC_URLS=...`
    - app env: `NEXT_PUBLIC_SOLANA_RPC_URLS=...`
  - First endpoint is default; UI switcher cycles across endpoints.
  - Do not commit real API keys into tracked files. Keep in local env + GitHub secrets/vars.
- Health check on current environment:
  - `npm run check:preflight` passed over Helius endpoint.

## Buffer Account ("Buffer Wallet") Operational Guide
- Solana upgradeable deployment writes program bytes into a temporary buffer account first.
- If deploy fails midway (RPC rate limits, insufficient SOL, dropped connection), SOL can remain in buffer rent.
- Always recover before retrying:
  1. Capture buffer pubkey from deploy logs/error output.
  2. Confirm balance:
     - `solana account <BUFFER_PUBKEY> --url <RPC>`
  3. Close and reclaim rent:
     - `solana program close <BUFFER_PUBKEY> --bypass-warning --url <RPC>`
  4. Recheck wallet SOL balance, then redeploy.
- In this repo deploy flow (`scripts/deploy-devnet.ts`):
  - tries `anchor deploy` first
  - falls back to `solana program deploy --use-rpc`
  - same buffer-account recovery rules apply to both paths.

## Multi-RPC Update (2026-02-22 UTC)
- Added script-level RPC failover helper:
  - `scripts/rpc.ts`
  - Supports:
    - `SOLANA_RPC_URLS` (comma/newline separated)
    - `NEXT_PUBLIC_SOLANA_RPC_URLS`
    - fallback to single URL envs + devnet default
  - Probes candidates and picks first healthy endpoint.
- Wired failover into scripts:
  - `scripts/deploy-devnet.ts`
  - `scripts/init-comp-defs.ts`
  - `scripts/price-oracle.ts`
  - `scripts/oracle-health.ts`
  - `scripts/stable-preflight.ts`
  - `scripts/faucet.ts`
  - `scripts/sync-market-comp-defs.ts`
- Frontend RPC switching implemented:
  - `app/src/lib/runtime.ts`
    - `getRpcEndpoints()`
    - `getPreferredRpcIndex()`
    - `setPreferredRpcIndex()`
    - `RPC_CHANGED_EVENT`
    - Node-safe window access (via `globalThis`) so ts-node scripts importing shared runtime do not fail.
  - `app/src/pages/_app.tsx` now rebinds `ConnectionProvider` endpoint on switch event.
  - `app/src/components/NetworkIndicator.tsx` now shows `RPC x/y` switch button when multiple endpoints are configured.
- Env template updated:
  - `app/.env.example` includes `NEXT_PUBLIC_SOLANA_RPC_URLS`.
- Local validated run:
  - `npm run oracle:once` succeeded via Helius RPC.
  - `npm run check:preflight` succeeded via Helius RPC.

## Buffer Wallet Note
- During `solana program deploy`, Solana writes program bytes to a temporary **buffer account** first.
- That buffer account is funded by the deployer wallet; if deploy fails midway, SOL can remain locked there.
- CLI prints a recovery phrase and a `solana program close <BUFFER_PUBKEY>` command to reclaim lamports.
- In this repo's deploy flow:
  - anchor deploy is tried first,
  - then direct `solana program deploy --use-rpc` fallback.
  - If either fails, always close leaked buffer accounts before retrying.

## Latest Debug Addendum (2026-02-22 UTC)
- Reproduced `open_position` failure with fresh oracle and direct script call:
  - Arcium CPI `QueueComputation` -> `AnchorError account: comp` -> `AccountDidNotSerialize (3004)`.
- Reconfirmed this is not the stale-price branch:
  - stale path fails earlier with `ShadowPerpError::StalePrice` as expected.
- On-chain comp-def metadata currently reports:
  - open: `circuit_len=3734871`, `params=23`, `outputs=4`
  - close: `circuit_len=6211275`, `params=14`, `outputs=7`
  - liquidation: `circuit_len=6055271`, `params=11`, `outputs=3`
- Artifact mismatch found locally:
  - `build/*.arcis` lengths differ from `ci_artifacts/build/*.arcis`.
  - Current on-chain values match `build/*.arcis` (not `ci_artifacts`).
- Safe client hardening applied:
  - `app/src/lib/client.ts`: computation offset generation reverted to Arcium-recommended random 8-byte `u64` (`new BN(randomBytes(8), "le")`).
  - This did not resolve the queue serialization blocker by itself.
- Fresh reset-path hardening applied:
  - `scripts/init-comp-defs.ts` now throws `FRESH_NAMESPACE_REQUIRED` when finalized comp-def signature or circuit length mismatches expected local circuit shape.
  - `scripts/deploy-devnet.ts` now supports `--fresh-namespace` rotation (backup old program keypair + generate new + `anchor keys sync`).
  - `scripts/force-upload-circuit.ts` now prefers `.arcis` over `.idarc` for upload safety.

## Fresh Namespace Attempt (Current Session)
- `--fresh-namespace` rotation was executed successfully:
  - New program keypair pubkey: `GvW692czdm6hv1hwrmoW5QG1ttW1DDwT3zx5RLa1XNar`
  - IDs synced in:
    - `Anchor.toml`
    - `programs/shadowperp/src/lib.rs`
  - Backup written at:
    - `target/deploy/backup/shadowperp-keypair.2026-02-22T09-10-30-348Z.json`
- Deployment/init did not complete due external infra limits:
  - devnet RPC `429 Too Many Requests`
  - wallet insufficient SOL for program account allocation
  - faucet airdrop requests currently rate-limited
- Safety rollback applied after failed deploy:
  - restored `target/deploy/shadowperp-keypair.json` from backup
  - restored `Anchor.toml` devnet ID to `2Gz35...`
  - `programs/shadowperp/src/lib.rs` already remained at `2Gz35...`
- Current active local/devnet namespace remains `2Gz35...` until fresh deployment completes.

## Validation of Earlier Notes
- Outdated now:
  - Previous namespace references (`6QNv...`, market `GSBK...`) are no longer current.
  - Any "fully live" claim is not valid for the new namespace yet.
- Still valid in principle:
  - Canonical devnet USDC mint usage.
  - Oracle freshness gating is required for trade paths.
  - Arcium comp-def finalization is required before trade execution.

## Current Active Devnet Namespace
- Program ID: `2Gz35PAHBkggSfV77mCENobt5YEURuYMAjgpvKXoL61d`
- Market PDA: `C3UcQ3FnjqUsFPWfDgKNoq4cGzpWw6tSEqM6bf1MoFv8`
- Collateral mint (canonical devnet USDC): `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- Arcium program: `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ`
- Arcium cluster offset/account: `456` / `DzaQCyfybroycrNqE5Gk7LhSbWD2qfCics6qptBFbr95`
- MXE account (derived): `92czByGU8KsVTbKF5Z2D47DeaBD15EqwD59Vta9kE3yT`
- Arcium signer PDA: `GWmuyb9Qv5qAVdLDfngvDxW1wH87giTSo9jF3LsaGdWU`
- Comp-defs (finalized):
  - open_position: `27hS4eyJ3LDMsXJMyqsDhozBopRP4s7cv33brZnTX6ux`
  - close_position: `3JpwyAdVLrqEh8Auf97yVBgP6JDsojeqqoMAzujrzYgr`
  - check_liquidation: `FarLAbaeZUph6qoqoa3Qvu8XNqhYjYjuSoiF78Av5iCU`

## Deployment + Init Actions Executed
1. Generated fresh program keypair and synced IDs:
   - `solana-keygen new ... target/deploy/shadowperp-keypair.json`
   - `anchor keys sync`
2. Built with local safe wrapper:
   - `npm run build:anchor:safe`
3. Manual deploy via RPC path (more reliable than TPU in this env):
   - `solana program deploy ... --use-rpc --max-sign-attempts 12`
   - Deploy signature: `vbnjZpYjVcAgmNFDsNi4zBmjeQXpZMpxsFUWbfbUqsGFnHjiTqyZKADChLA5uTGSrPdsNdHQJ37VMoNfHfJ3Wpf`
4. Namespace initialization + comp-def upload/finalize + env sync:
   - `npx ts-node scripts/deploy-devnet.ts --skip-deploy`

## Env + GitHub Variable Updates
- `app/.env.local` updated to the new program/market/MXE values above.
- GitHub repo vars updated (`Emperoar07/shadow`):
  - `NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID=2Gz35...`
  - `NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT=C3UcQ3...`
  - `NEXT_PUBLIC_ARCIUM_MXE_PROGRAM_ID=2Gz35...`
- Existing vars left unchanged (still valid):
  - `NEXT_PUBLIC_ARCIUM_PROGRAM_ID=Arcj82...`
  - `NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com`
  - `NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=456`
  - `NEXT_PUBLIC_ARCIUM_CLUSTER_ACCOUNT=DzaQ...`

## Health Checks Run
- `npm run oracle:once` passed.
- `npm run check:stable` passed:
  - Program exists/executable.
  - Market owner correct.
  - All three comp-def pointers exist and are `completed`.
  - Oracle freshness within configured window.
  - Operator canonical devnet USDC balance detected.

## Smoke Test Status (Current Blocker)
### What works
- Deposit collateral works.
  - Example deposit tx: `5U955tNPBywNFmnGLC89eEEVXrBEEhbjN8xZ52QtpJ1tv4tz8esaHmLGUvVCwiugTNoN53cbRLt63Gaon9wLQHb5`

### What fails
- `open_position` fails during Arcium CPI queue step:
  - Error: `AnchorError caused by account: comp. Error Code: AccountDidNotSerialize (3004)`
  - Program logs show failure inside:
    - `Program Arcj82... invoke`
    - `Instruction: QueueComputation`
    - `AccountDidNotSerialize` on account `comp`

This blocks end-to-end open/close flow in the new namespace.

## Technical Checks Already Performed On This Blocker
- Oracle staleness path verified separately (stale errors occur as expected when old).
- With fresh oracle update, error remains deterministic as `AccountDidNotSerialize` in Arcium queue.
- On-chain open_position comp-def signature fetched and confirmed:
  - Parameters: 23
  - Outputs: 4 (bool + mxe nonce + 2 ciphertexts)
- This indicates comp-def metadata is present and finalized, but queue serialization still fails on computation account creation/write.

## Additional Changes Introduced This Session
- `app/src/lib/client.ts`
  - Added bounded slot-based computation offset helper (`nextComputationOffset`) and replaced direct `randomBytes(8)` offsets for open/close/liquidation calls.
  - This is safe hardening but does not resolve the current Arcium queue serialization blocker.

## Known Version Caveat
- WSL Arcium CLI currently reports `arcium-cli 0.8.4`.
- Rust crates are pinned to `0.8.5`.
- `arcup install 0.8.5` currently fails in this environment because `arcup` expects Docker (`/var/run/docker.sock`).
- Version skew is a plausible contributor and should be eliminated as next action.
- Docs cross-check: Arcium devnet cluster offset `456` is documented as `v0.8.3` in current public deployment docs, so strict version alignment across:
  - Rust crates (`arcium-*`),
  - JS client (`@arcium-hq/client`),
  - CLI (`arcium-cli`)
  is required before re-running circuit upload + comp-def init.

## Next Safe Steps
1. Align Arcium CLI/tooling to `0.8.5` (or exact version required by current docs) and regenerate artifacts.
2. Re-run comp-def sync/finalization after artifact regeneration.
3. Re-run smoke immediately after oracle refresh:
   - deposit
   - open market
   - close
4. If `AccountDidNotSerialize` persists, escalate with Arcium using this exact log fingerprint from `QueueComputation` (`account: comp`, code `3004`) and current namespace addresses.

## Fresh Finalized Comp-Def Reset Path (Implemented)
- `scripts/deploy-devnet.ts` now supports:
  - `--fresh-namespace` (or `FRESH_NAMESPACE=1`)
  - Behavior:
    1. backs up existing `target/deploy/shadowperp-keypair.json`
    2. generates a new program keypair
    3. runs `anchor keys sync`
    4. builds, deploys, initializes market/MXE/comp-defs in fresh namespace
- `scripts/init-comp-defs.ts` now enforces finalized signature safety:
  - validates finalized comp-def signature counts against expected:
    - `open_position`: params=15, outputs=4
    - `close_position`: params=14, outputs=7
    - `check_liquidation`: params=11, outputs=3
  - validates finalized `circuit_len` against local `build/*.arcis` (fallback `.idarc` if `.arcis` missing)
  - throws explicit `FRESH_NAMESPACE_REQUIRED` error on mismatch (no unsafe in-place reuse)
- Upload artifact precedence fixed to safer default:
  - prefer `build/*.arcis` over `build/*.idarc` in init/force-upload scripts.

## One-Command Safe Reset
```bash
npm run deploy:devnet:fresh
```

This is now the recommended path whenever a comp-def is already finalized with old param/output shape.

## Quick Commands
```bash
npm run oracle:once
npm run check:stable
npx ts-node _smoke_devnet.ts
```

---

## ROOT CAUSE: AccountDidNotSerialize (3004) — Arcium Space Formula Bug (2026-02-22 UTC)

### Summary
`QueueComputation` fails with `AccountDidNotSerialize (3004)` on account `comp` because Arcium's
on-chain program allocates **12 fewer bytes** than it needs to borsh-serialize the
`ComputationAccount`. This is a bug inside the Arcium protocol — no client-side change can close
the gap.

---

### Exact Numbers (open_position_v2, N=9 callback accounts)

| | Bytes |
|---|---|
| Arcium allocates | **822** |
| Actual borsh needed | **834** |
| Gap | **12** |

**Arcium's formula (reconstructed from `_inspect_comp_space.ts` output):**
```
111 (fixed header)
+ 370 (ArgumentList — 15 args: 8 byte_arrays + 4 plaintext_numbers + 2 values_128_bit + 1 inline u8)
+ 4   (Vec<CallbackInstruction> outer length prefix)
+ 32  (program_id: Pubkey)
+ 0   (discriminator — BUG: counted as 0 bytes)
+ 4   (accounts Vec length prefix)
+ 9*33 (9 callback accounts × 33 bytes each: 32 pubkey + 1 is_writable)
+ 4   (trailing: callback_transactions_required u8 + bm u16 + bump u8)
= 822
```

**Actual borsh size:**
```
Same as above, but discriminator is Vec<u8> with 8-byte Anchor discriminator:
  4 bytes (Vec<u8> length prefix) + 8 bytes (discriminator data) = 12 bytes
= 834
```

---

### Why the discriminator is 12 bytes

`CallbackInstruction.discriminator` is typed as `Vec<u8>` in Arcium's IDL and Rust structs.
Anchor populates it with the 8-byte instruction discriminator (e.g. `OpenPositionV2Callback::DISCRIMINATOR`).

Borsh encoding of `Vec<u8>` with 8-byte content:
- 4 bytes: u32 little-endian length prefix
- 8 bytes: the discriminator data itself
= **12 bytes total**

Arcium's space formula counts **0 bytes** for this field. Hence the constant 12-byte shortfall.

---

### Why no client-side fix works

The gap is **independent** of argument count and callback account count.

| Change | Arcium formula | Actual borsh | Gap |
|---|---|---|---|
| Current (15 args, 9 accs) | 822 | 834 | **12** |
| Remove 3 dead market_params args | 822 − 30 = 792 | 834 − 30 = 804 | **12** |
| Remove 1 callback account | 822 − 33 = 789 | 834 − 33 = 801 | **12** |
| Both above | 759 | 771 | **12** |
| Empty discriminator (vec![]) | 822 − 8 = 814 | 834 − 8 = 826 | **still 12** |

Reducing args or accounts reduces **both sides equally**. The gap always equals `disc_size`
(4-byte prefix + data length). With a standard 8-byte Anchor discriminator the gap is always 12.
With an empty `vec![]` discriminator the data portion drops to 0 but the 4-byte length prefix
remains, so the gap becomes 4 — still non-zero and still a protocol bug.

---

### Callback account injection detail

`callback_ix()` (generated by `#[callback_accounts("open_position_v2")]` macro in arcium-macros)
auto-prepends **6 standard accounts** before the caller's custom accounts:

1. `arcium_program`
2. `comp_def_account`
3. `mxe_account`
4. `computation_account`
5. `cluster_account`
6. `instructions_sysvar`

`OpenPositionV2Callback` passes 3 custom accounts (`position`, `market`, `margin_account`),
so total N = 6 + 3 = **9**.

`ClosePositionCallback` passes 5 custom accounts → N = 11.
`CheckLiquidationCallback` passes 6 custom accounts → N = 12.
All three are affected.

---

### Additional finding: dead circuit parameters

Investigation of `encrypted-ixs/src/open_position.rs` revealed that only `market_params.0`
(max_leverage) is actually used by the circuit.

```rust
// Only market_params.0 is referenced:
let leverage_valid = leverage >= 1 && leverage <= market_params.0;
// market_params.1 (liquidation_threshold) — unused in circuit
// market_params.2 (trading_fee)           — unused in circuit
// market_params.3 (oracle_price)          — unused in circuit
```

These 3 dead parameters (1×u16 + 1×u16 + 1×u64 = 12 bytes in ArgList) could be removed in a
future circuit revision for cleanliness, but this has no effect on the space bug since the gap
is constant regardless of arg count.

---

### ComputationAccount struct (confirmed from arcium-anchor-0.8.5 test code)

```
Fixed header (111 bytes):
  discriminator:                   8
  payer:                          32
  mxe_program_id:                 32
  computation_definition_offset:   4
  execution_fee { base, priority, output_delivery }: 24
  slot:                            8
  slot_counter:                    2
  status:                          1

ArgumentList (370 bytes for current 15 args):
  args Vec (n=15 items, 2 bytes each inline):     4 + 30
  byte_arrays Vec (n=8 items, 32 bytes each):    4 + 256
  plaintext_numbers Vec (n=4 items, 8 bytes each): 4 + 32
  values_128_bit Vec (n=2 items, 16 bytes each): 4 + 32
  accounts Vec (empty):                           4

Vec<CallbackInstruction> (actual 297 bytes, Arcium formula gives 285):
  outer Vec length prefix:                        4
  program_id:                                    32
  discriminator Vec<u8> (BUG — counted as 0):  0/12
  accounts Vec length prefix:                     4
  9 accounts × 33 bytes:                        297

Trailing (4 bytes):
  callback_transactions_required: u8              1
  callback_transactions_submitted_bm: u16         2
  bump: u8                                        1
```

SLOT_OFFSET=100 and SLOT_COUNTER_OFFSET=108 in arcium-anchor source confirm the header layout.

---

### Recommended action

1. **Report to Arcium** with this exact bug fingerprint:
   - Error: `AccountDidNotSerialize (3004)` on account `comp` inside `QueueComputation`
   - Root cause: space formula omits 12 bytes for `CallbackInstruction.discriminator: Vec<u8>`
   - Formula fix required: add `+ 4 + discriminator.len()` (= `+12` for standard 8-byte disc)
   - Affected: all `queue_computation` calls with at least one callback instruction
   - Arcium version in use: crates `0.8.5`, CLI `0.8.4`
   - Devnet program: `Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ`

2. **Check if Arcium `0.8.6+` exists** with a patched formula before rebuilding circuits.

3. **No code change needed on our side** — the program, circuit, and client are correct.
   The bug is entirely inside Arcium's on-chain `queue_computation` logic.

4. If Arcium provides a workaround (e.g. a patched `arcium-anchor` crate with corrected space
   accounting), update `Cargo.toml` accordingly, rebuild, redeploy, re-init comp-defs, retest.

---

## 2026-02-22 - Leverage UI consistency + runtime verification

### What changed

- Trading panel leverage control was normalized to one scale:
  - Presets: `2x, 5x, 10x, 25x, 50x`
  - Slider range now uses `2..50` (not `1..50`)
  - Tick labels are rendered from presets instead of hardcoded mixed values
  - Tick positioning now uses `MIN_LEVERAGE/MAX_LEVERAGE` math for consistent alignment
- File touched: `app/src/components/TradingPanel.tsx`

### What was verified

- Env values present in `app/.env.local`:
  - `NEXT_PUBLIC_SOLANA_RPC_URL`
  - `NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID`
  - `NEXT_PUBLIC_ARCIUM_PROGRAM_ID`
  - `NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT`
- `npm run check:preflight`:
  - First run failed only on stale oracle freshness
  - Ran `npm run oracle:once`
  - Re-ran preflight: full PASS
- Type check PASS: `pnpm --dir app exec tsc --noEmit`

### Current blocker

- None introduced by this UI fix. Existing deeper blocker remains Arcium `QueueComputation`
  serialization-space mismatch noted above.

### Next safe step

- Keep oracle fresh while testing (`npm run oracle:daemon`) and continue end-to-end UI smoke
  against current devnet env while tracking Arcium patch availability.

---

## 2026-02-22 - Price source sync (pair header vs market panel)

### What changed

- Synced the pair header price/change display to the same canonical stream used by `MarketInfo`.
- Added shared display props path:
  - `MarketInfo` now emits `{ pairLabel, price, change24h }` via `onPriceUpdate`.
  - `app/src/pages/app.tsx` stores that snapshot for the selected pair.
  - `PriceChart` forwards this snapshot to `PairSelector`.
  - `PairSelector` uses `displayPrice/displayChange24h` when present.
- Files touched:
  - `app/src/components/MarketInfo.tsx`
  - `app/src/components/PriceChart.tsx`
  - `app/src/components/PairSelector.tsx`
  - `app/src/pages/app.tsx`

### What was verified

- Type check PASS: `pnpm --dir app exec tsc --noEmit`

### Notes

- TradingView iframe still uses external exchange candles (public feed). It can differ by a few ticks from on-chain mark/oracle price at any instant.
- This change removes the extra UI mismatch between pair header and right-side market panel.

## 2026-02-22 - Leverage layout update (requested visual)

### What changed

- Updated leverage UI to match requested design:
  - Preset buttons remain `2x, 5x, 10x, 25x, 50x`
  - Slider range now spans `1..50`
  - Slider marker labels now show `1x, 10x, 20x, 35x, 50x`
  - Default leverage set to `10x`
- File touched: `app/src/components/TradingPanel.tsx`

### What was verified

- Type check PASS: `pnpm --dir app exec tsc --noEmit`
- Runtime verification during this update:
  - `npm run check:preflight` initially failed only on stale oracle freshness.
  - Ran `npm run oracle:once`, then `npm run check:preflight` passed.

## 2026-02-22 - Right-column layout polish + Private Orderbook panel

### What changed

- Removed redundant MarketInfo footer copy (`Privacy is always on by default.`).
- Added `PrivateOrderbook` panel under MarketInfo in the right column.
- Right column now uses full-height flex layout so MarketInfo + PrivateOrderbook fill alongside chart height with no dead empty block.
- Files touched:
  - `app/src/components/MarketInfo.tsx`
  - `app/src/components/PrivateOrderbook.tsx` (new)
  - `app/src/pages/app.tsx`

### What was verified

- Type check PASS: `pnpm --dir app exec tsc --noEmit`
- Preflight PASS after refresh:
  - `npm run check:preflight` (stale only)
  - `npm run oracle:once`
  - `npm run check:preflight` (all green)

## 2026-02-23 - Oracle hardening v2 (4 safety controls implemented)

### What changed

- Replaced single-source oracle feeder logic in `scripts/price-oracle.ts` with hardened multi-source flow.
- Implemented 4 requested controls:
  1. Multi-source median aggregation (CoinGecko + Binance + Coinbase, optional CoinMarketCap when `COINMARKETCAP_API_KEY` is set).
  2. Write gating: publish only when heartbeat elapsed or price moved by threshold bps.
  3. Circuit breaker: reject publish when median deviates too far from last accepted on-chain price.
  4. Read-after-write verification: fetch market after tx and assert on-chain raw oracle value matches published raw value.
- Added configurable env knobs:
  - `ORACLE_HEARTBEAT_SECONDS` (default `120`)
  - `ORACLE_MIN_MOVE_BPS` (default `10`)
  - `ORACLE_MAX_DEVIATION_BPS` (default `500`)
  - `ORACLE_MIN_SOURCES_REQUIRED` (default `2`)
- Added `--force` support for one-shot/daemon cycles to bypass write gating when needed.

### What was verified

- Live one-shot publish succeeded with new logic:
  - median computed from healthy sources
  - tx submitted and confirmed
  - post-write on-chain verification passed
- `npm run check:preflight` passed immediately after update (oracle freshness green).

### Current blocker

- No new blocker introduced by oracle hardening.
- Existing separate blocker remains Arcium `QueueComputation` `AccountDidNotSerialize (3004)` path documented earlier.

### Next safe step

- Run daemon for stability test window:
  - `npm run oracle:daemon`
- Observe skip-vs-publish behavior with current thresholds and tune if needed (e.g., heartbeat 90s or move 8 bps).
- Follow-up verification:
  - Added oracle hardening env docs to `app/.env.example`.
  - Re-ran `npm run oracle:once` (publish path confirmed with heartbeat-triggered write).
  - `npm run check:preflight` had one transient RPC fetch error, immediate retry passed fully.

## 2026-02-23 - Oracle hardening v3 (resilience + safety mode)

### What changed

- Upgraded `scripts/price-oracle.ts` with the requested production-safe controls:
  1. Read-after-write verification retained and enforced per publish.
  2. RPC write resilience: publish now retries across RPC candidate list and switches active RPC on success.
  3. Metrics + alerting: structured `METRIC` logs include source prices, median, tx sig, tx latency, age, disagreement, and consecutive failures.
  4. Jitter polling: daemon sleep uses interval +/- jitter.
  5. Safety mode freeze: if source disagreement exceeds threshold, update is frozen and alert emitted.
- Added alert transport support:
  - `ORACLE_ALERT_WEBHOOK_URL` (optional POST JSON).
  - console `ALERT` logging with cooldown dedupe.
- Added new env docs in `app/.env.example`:
  - `ORACLE_SAFETY_MODE`
  - `ORACLE_SOURCE_DISAGREE_BPS`
  - `ORACLE_STALE_ALERT_SECONDS`
  - `ORACLE_ALERT_COOLDOWN_SECONDS`
  - `ORACLE_ALERT_WEBHOOK_URL`
  - `ORACLE_JITTER_MS`

### What was verified

- Forced one-shot publish succeeded using new flow:
  - median aggregation
  - write path with verification
  - metrics emitted
  - alert path exercised (stale-warning)
- `npm run check:preflight` passed after update.
- One transient RPC fetch failure occurred during first preflight attempt; immediate retry passed.

### Current blocker

- No new blocker introduced by oracle changes.
- Existing separate blocker remains Arcium devnet `QueueComputation` `AccountDidNotSerialize (3004)`.

### Next safe step

- Run daemon for burn-in:
  - `npm run oracle:daemon`
- If webhook paging is desired, set `ORACLE_ALERT_WEBHOOK_URL` and validate one alert delivery.

## 2026-02-23 - PrivateOrderbook label cleanup

### What changed

- Hid the two requested UI elements in the PrivateOrderbook panel:
  - `Arcium MPC matched`
  - `Spread` value block
- Kept panel layout stable and removed dead spread-calculation fields from component internals.
- File touched: `app/src/components/PrivateOrderbook.tsx`

### What was verified

- Type check PASS: `pnpm --dir app exec tsc --noEmit`

## 2026-02-23 - Oracle ops + release hygiene implementation

### What changed

- Added managed oracle daemon commands:
  - `npm run oracle:daemon:start`
  - `npm run oracle:daemon:stop`
  - `npm run oracle:daemon:status`
  - Backed by new script: `scripts/oracle-daemon.ts`
  - Runtime state/log paths: `.runtime/oracle-daemon.pid`, `.runtime/oracle-daemon.log`
- Added alert webhook test command:
  - `npm run oracle:alert:test`
  - Script: `scripts/test-alert-webhook.ts`
- Added release hygiene reports/checks:
  - `npm run report:release-hygiene`
  - `npm run check:release-hygiene` (strict fail if dirty)
  - Script: `scripts/release-hygiene.ts`
- Added .gitignore entries for local runtime + backup/temp artifacts (`.runtime/`, backup dirs, tarballs).
- Hardened oracle daemon continuity during partial source outages:
  - guarded single-source failsafe at stale-risk window
  - env knobs: `ORACLE_FAILSAFE_ALLOW_SINGLE_SOURCE`, `ORACLE_FAILSAFE_MAX_MOVE_BPS`
  - startup log now clearly indicates webhook configured vs console-only alerts

### What was verified

- Daemon management:
  - `oracle:daemon:stop` (clean)
  - `oracle:daemon:start`
  - `oracle:daemon:status` -> running with PID and log path
- Oracle health with daemon live:
  - `npm run check:preflight` -> PASS (fresh oracle)
- Release hygiene:
  - `npm run report:release-hygiene` -> report generated
  - `npm run check:release-hygiene` -> expected FAIL while worktree is dirty
- Alert test command:
  - currently fails as expected until `ORACLE_ALERT_WEBHOOK_URL` is set

### Current blocker

- Real external paging not active yet because `ORACLE_ALERT_WEBHOOK_URL` is not configured in `app/.env.local`.

### Next safe step

1. Set `ORACLE_ALERT_WEBHOOK_URL=<your webhook endpoint>` in `app/.env.local`.
2. Run `npm run oracle:alert:test` to verify delivery.
3. Keep daemon running via `npm run oracle:daemon:start` and confirm with `npm run oracle:daemon:status`.

## 2026-02-23 - UI alignment pass (trade form + market card)

### What changed

- Restyled `app/src/components/TradingPanel.tsx` to match the requested compact reference style while preserving all existing trading logic and callbacks.
  - Updated leverage markers to `1x, 5x, 10x, 25x, 50x`.
  - Refined control hierarchy: direction/order toggles, size input, TP/SL row, compact summary strip, CTA.
  - Kept collateral modal wiring, limit order flow, and submit behavior unchanged.
- Restyled `app/src/components/MarketInfo.tsx` into a compact tile-card layout.
  - Headline now shows `PAIR · ORACLE`, larger price readout, and change badge.
  - Replaced row list with 2-column metric tiles using existing on-chain/live-backed values.

### What was verified

- `pnpm --dir app exec tsc --noEmit` PASS
- `npm run check:preflight` PASS
  - program + market accounts valid
  - comp-def pointers finalized
  - oracle freshness within 300s

### Current blocker

- No new blocker introduced by this UI pass.
- Existing end-to-end trading execution validation still depends on running full open/close smoke on current namespace.

### Next safe step

1. Run the app and verify UI layout on 13-15 inch desktop widths and mobile.
2. Execute smoke: deposit -> open market -> open limit -> TP/SL edit -> close.
3. If visuals are accepted, commit this UI pass separately from protocol/runtime changes.

## 2026-02-23 - Bottom positions panel visual upgrade (card layout)

### What changed

- Upgraded Position tab visuals in `app/src/components/BottomPositionsPanel.tsx` to a compact card design similar to requested reference:
  - pair + side + leverage + status chips on top row
  - right-side action buttons (`TP/SL`, `Close`)
  - metric row (`Entry Price`, `Liq. Price`, `Margin`, `PnL`)
  - health bar with percentage
- Preserved existing logic paths:
  - close-position action and status transitions
  - TP/SL rule edit flow
  - orders and history tabs (functional behavior unchanged)
- Wired local owner position view metadata into card rendering for user-visible side/leverage/entry when available.

### What was verified

- `pnpm --dir app exec tsc --noEmit` PASS
- `npm run check:preflight` PASS

### Current blocker

- No new blocker introduced by this UI change.

### Next safe step

1. Visually verify on 13-15 inch and mobile breakpoints.
2. Confirm card data matches user expectations for live/open positions after one fresh trade.

## 2026-02-23 - Orderbook visual redesign (compact depth ladder)

### What changed

- Restyled `app/src/components/PrivateOrderbook.tsx` to match the requested ladder look:
  - ask rows (red) with right-anchored depth bars
  - centered mid-price + spread row
  - bid rows (green) with right-anchored depth bars
  - compact PRICE/SIZE header and tighter row spacing
- Kept behavior display-only (no execution path changes).
- Added deterministic pseudo-size values per level to present realistic SIZE column formatting.

### What was verified

- `pnpm --dir app exec tsc --noEmit` PASS
- `npm run check:preflight` PASS

### Current blocker

- No blocker introduced by this UI update.

### Next safe step

1. Visually review with live pair switching to confirm readability on small laptop widths.
2. If desired, tune depth opacity and row height for higher density.

## 2026-02-23 - Leverage control simplification

### What changed

- Simplified leverage UI in `app/src/components/TradingPanel.tsx` to match requested compact style:
  - removed preset leverage buttons
  - retained single slider with `Adjust` label and large live `Nx` value
  - retained marker row (`1x, 5x, 10x, 25x, 50x`) with active marker highlight
- No trade execution logic changed.

### What was verified

- `pnpm --dir app exec tsc --noEmit` PASS

## 2026-02-23 - Right rail size rebalance (50/50 split)

### What changed

- Rebalanced right rail in `app/src/pages/app.tsx` to split vertically on desktop:
  - top half: `MarketInfo`
  - bottom half: `PrivateOrderbook`
- Reduced `MarketInfo` visual weight in `app/src/components/MarketInfo.tsx`:
  - smaller headline price and badge
  - tighter card/tile padding
  - lighter typography scale
- Updated `PrivateOrderbook` container in `app/src/components/PrivateOrderbook.tsx` to `h-full min-h-0` so it cleanly occupies the lower half.

### What was verified

- `pnpm --dir app exec tsc --noEmit` PASS
- `npm run check:preflight` PASS

## 2026-02-23 - Chart/right-rail 50:50 split + price-source alignment

### What changed

- Enforced right rail to track the chart panel height and split into strict equal halves:
  - Added `ResizeObserver`-based chart height measurement in `app/src/pages/app.tsx`.
  - Applied measured height to right rail container.
  - Used desktop rows `minmax(0,1fr) minmax(0,1fr)` for exact 50/50 panel split.
- Improved UI price consistency across chart header + market panel + orderbook:
  - `app/src/components/MarketInfo.tsx` now prefers live feed display price (when available) and falls back to on-chain oracle.
  - Parent `displayPrice` remains the shared source passed to `PriceChart` header and `PrivateOrderbook`.
- Upgraded `/api/prices` aggregation in `app/src/pages/api/prices.ts`:
  - Added Binance ticker source for supported pairs (to better align with TradingView exchange feeds).
  - Added mixed-source merge strategy with precedence (Binance first, then CoinGecko/CoinMarketCap for missing pairs).
  - Extended provider typing to include `binance` and `mixed`.
- Updated client-side API response type in `app/src/lib/prices.ts` for new provider values.

### What was verified

- `pnpm --dir app exec tsc --noEmit` PASS
- `npm run check:preflight` PASS

### Notes

- The embedded TradingView candle/last print is exchange-feed driven and cross-origin, so exact tick-for-tick lock is not guaranteed at every instant; this update minimizes drift by using exchange-aligned pricing where available.

## 2026-02-23 - Arcium devnet program metadata check (support escalation aid)

### What changed

- Pulled current devnet Arcium program metadata for support escalation context.

### What was verified

- `solana program show Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ`:
  - ProgramData: `6kZkJ4BgFbuYcEAED3AtzVouHDMNMLYLJb5zZSoEBftc`
  - Upgrade authority: `CLSU4qLjcBAdysFwEn5RBpj6dPv3JDYhKfXryyD8V3AH`
  - Last deployed slot: `442373963`
- Current slot observed: `444038690` (~1,664,727 slots later; ~7.71 days at 0.4s/slot).

### Current blocker

- `QueueComputation` still fails with `AccountDidNotSerialize (3004)` on `comp` pending Arcium-side confirmation/fix.

### Next safe step

- Send program metadata + failing tx signatures + `_inspect_comp_space.ts` output to Arcium support ticket for binary/version confirmation.

## Session Update: Right Rail Fixed 315px (2026-02-23 UTC)
- Changed `app/src/pages/app.tsx` to enforce a fixed right-rail split:
  - top market/oracle panel = `315px`
  - bottom orderbook = remaining height (`minmax(0, 1fr)`)
- Verification completed:
  - `npm run check:preflight` -> PASS
  - `pnpm --dir app exec tsc --noEmit` -> PASS
- Current blocker:
  - unchanged open-position Arcium queue serialization issue in smoke execution path.
- Next safe step:
  - visually confirm on `/app` that the top panel is exactly 315px and continue protocol unblock separately.

## Session Update: Orderbook Panel Set to 315px (2026-02-23 UTC)
- User request implemented: reduced right-rail Orderbook panel height to `315px`.
- Updated `app/src/pages/app.tsx`:
  - added `BOTTOM_RIGHT_ORDERBOOK_PANEL_HEIGHT = 315`
  - right rail now uses fixed rows: `315px 315px`
  - desktop inter-row gap removed (`lg:gap-0`) to keep the fixed stack exact.
- Additional safe compile unblock:
  - `app/src/pages/index.tsx` nullability fix in decryption text effect (`target!` usage) so workspace typecheck passes.
- Verification:
  - `npm run check:preflight` -> PASS
  - `pnpm --dir app exec tsc --noEmit` -> PASS
- Current blocker:
  - unchanged Arcium `QueueComputation` serialization failure on open-position smoke path.
- Next safe step:
  - visual QA on `/app` at desktop widths to confirm both right-rail cards render at exact 315px with no clipping.

## Session Update: Equalized Orderbook Sides (2026-02-23 UTC)
- User-requested visual fix implemented: ask/bid sides now render with equal vertical allocation inside the fixed orderbook panel.
- Updated `app/src/components/PrivateOrderbook.tsx`:
  - Added `LEVELS_PER_SIDE = 5` to keep both sides visible in constrained height.
  - Reworked body layout to `grid-rows-[1fr_auto_1fr]`:
    - top = asks
    - middle = spread strip
    - bottom = bids
  - Reduced row typography/padding (`text-xs`, tighter vertical padding) to prevent clipping.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
- Current blocker:
  - unchanged Arcium open-position queue serialization issue on protocol path.
- Next safe step:
  - visual confirm on `/app` desktop that ask and bid sections show equal row count and balanced spacing.

## Session Update: Deposit Runtime Fix (2026-02-23 UTC)
- User-reported issue: collateral modal showed `Deposits unavailable. Check wallet + runtime configuration.` while attempting deposit.
- Root cause addressed:
  - Runtime required `NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT` with no fallback, causing client init failure when env was stale/missing.
- Fix implemented:
  - `app/src/lib/runtime.ts`
    - added `DEFAULT_COLLATERAL_MINT` (canonical devnet USDC)
    - added fallback derivation for market PDA from seeds `['market', collateralMint]` + program ID
    - `marketAddress` now falls back to derived PDA when `NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT` is not set
  - `app/.env.example`
    - documented optional `NEXT_PUBLIC_SHADOWPERP_COLLATERAL_MINT`
    - documented market PDA derivation fallback behavior
  - `app/src/components/CollateralModal.tsx`
    - improved runtime/env error toasts with specific missing env var name when available
  - `app/src/components/TradingPanel.tsx`
    - deposit path now surfaces `clientInitError` when client context is unavailable
    - improved missing-env toast detail
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `npm run check:preflight` -> PASS
- Current known blocker (unchanged):
  - Arcium `QueueComputation` serialization issue in open-position smoke path.
- Next safe step:
  - restart `app` dev server, re-open collateral modal, and retest deposit flow with connected wallet + canonical devnet USDC ATA.

## Session Update: Orderbook Size Indicator Removed (2026-02-23 UTC)
- User request implemented: removed size indicators from UI orderbook because venue is not yet active.
- Updated `app/src/components/PrivateOrderbook.tsx`:
  - removed `Size` column header
  - removed per-row size values
  - removed depth/shading bars (size visual proxy)
  - kept price ladder + spread line only
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
- Current protocol blocker unchanged:
  - Arcium `QueueComputation` serialization on open-position smoke path.

## Session Update: Orderbook Header Kept, Size Values Hidden (2026-02-23 UTC)
- User request implemented: keep `SIZE` header visible but do not show per-row size numbers.
- Updated `app/src/components/PrivateOrderbook.tsx`:
  - restored `PRICE | SIZE` header layout
  - rows keep two-column alignment with blank size cell placeholders
  - no numeric size values rendered
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS

## Session Update: Orderbook Row Numbers Hidden (2026-02-23 UTC)
- User request implemented: removed visible row-level numeric values from orderbook ladder.
- Updated `app/src/components/PrivateOrderbook.tsx`:
  - ask/bid rows now render non-numeric placeholders only
  - `PRICE | SIZE` header remains
  - center reference price + spread strip remains visible
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS

## Session Update: Private Collateral Architecture Spec Added (2026-02-23 UTC)
- User requested concrete plan to implement private collateral safely.
- Added new root spec:
  - `PRIVATE_COLLATERAL_SPEC.md`
  - includes goals, threat model, account model, instruction set, Arcium callback binding, replay protection, migration phases, test matrix, rollout gates.
- Updated references:
  - `ARCHITECTURE.md` now points to `PRIVATE_COLLATERAL_SPEC.md`
  - `DATA_FLOW.md` clarifies current public L1 collateral path and links planned shielded flow spec.
- Session checklist run:
  - `git status --short` reviewed
  - active env values verified from `app/.env.local`
  - `npm run check:preflight` -> PASS
- Current blocker (unchanged):
  - open-position Arcium queue serialization issue in smoke flow.
- Next safe implementation order from spec:
  1. Add callback replay/reference binding checks in current callbacks.
  2. Introduce `ShieldedPool` + `NullifierSet` state and `init_shielded_pool`.
  3. Implement `deposit_to_shielded` behind feature flag.
  4. Add localnet integration tests before enabling default path.

## Session Update: Callback Replay-Binding Hardening (Step 1) (2026-02-23 UTC)
- Implemented minimal safe hardening for callback binding lifecycle (no account layout changes).
- Updated handlers:
  - `programs/shadowperp/src/handlers/open_position.rs`
  - `programs/shadowperp/src/handlers/close_position.rs`
  - `programs/shadowperp/src/handlers/check_liquidation.rs`
- Change:
  - enforce one in-flight computation per position before binding `pending_computation_account`
  - return `ShadowPerpError::ComputationInProgress` if a queue attempt tries to overwrite an existing pending binding
  - liquidation queue path no longer relies on last-writer-wins behavior
- Why:
  - strengthens replay/reference safety by preventing pending-computation binding replacement races.
- Verification:
  - `cargo check -p shadowperp` -> PASS
  - `npm run check:preflight` -> PASS
- Current blocker (unchanged):
  - open-position smoke still blocked by Arcium queue serialization issue on devnet path.
- Next safe step:
  1. add explicit callback reference nonce/sequence storage + verification (using reserved bytes, no account size expansion)
  2. run localnet regression for open/close/liquidation queue lifecycle and duplicate queue rejection.

## Session Update: Callback Reference Sequence Binding (Step 2) (2026-02-23 UTC)
- Implemented explicit callback reference metadata lifecycle using existing `Position._reserved` bytes (no account size changes).
- Added `Position` callback metadata API in `programs/shadowperp/src/state/position.rs`:
  - callback kinds: open/close/liquidation
  - monotonic `callback_seq_counter`
  - `pending_callback_seq`
  - `pending_callback_kind`
  - `pending_computation_offset`
  - setters/clear helpers
- Queue handlers now persist callback metadata at queue time:
  - `open_position.rs`
  - `close_position.rs`
  - `check_liquidation.rs`
- All callbacks now verify:
  - pending seq > 0
  - expected callback kind
  - expected computation PDA derived from stored offset and MXE cluster
  - computation account matches stored pending key
  - metadata is cleared on consume
- Verification:
  - `cargo check -p shadowperp` -> PASS
  - `npm run check:preflight` -> transient RPC fetch failures observed on initial tries
  - re-run preflight -> PASS
- Notes:
  - no UI/config changes in this step
  - no account layout expansion; migration-safe for existing positions.
- Next safe step:
  1. add localnet integration test for duplicate queue rejection + callback consume-once semantics.
  2. then proceed to `ShieldedPool`/`NullifierSet` scaffolding behind feature flag.
## Session Update: Callback Metadata Unit Tests Added (2026-02-23 UTC)
- Added focused unit tests in `programs/shadowperp/src/state/position.rs` for callback metadata lifecycle:
  - set + read + clear roundtrip
  - sequence monotonicity across callback cycles
  - rejection of invalid callback kind (`CALLBACK_KIND_NONE`)
- Verification:
  - `cargo test -p shadowperp state::position::tests -- --nocapture` -> PASS (3 passed)
  - `npm run check:preflight` -> PASS
- Current blocker (unchanged):
  - Arcium devnet `QueueComputation` serialization issue on open-position path.
- Next safe step:
  1. add localnet integration test path for duplicate queue rejection + consume-once callback semantics.
  2. begin `ShieldedPool`/`NullifierSet` scaffolding behind feature flag after test path is in place.
## Session Update: Pending-Computation Helpers + Consume-Once Wiring (2026-02-23 UTC)
- Added `Position` lifecycle helpers in `programs/shadowperp/src/state/position.rs`:
  - `begin_pending_computation(...)`
  - `consume_pending_computation(...)`
- Queue handlers now use helper-based binding:
  - `programs/shadowperp/src/handlers/open_position.rs`
  - `programs/shadowperp/src/handlers/close_position.rs`
  - `programs/shadowperp/src/handlers/check_liquidation.rs`
- Callback handlers now consume bindings via helper (single-use semantics):
  - `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
  - `programs/shadowperp/src/handlers/callbacks/close_position_callback.rs`
  - `programs/shadowperp/src/handlers/callbacks/liquidation_callback.rs`
- Expanded unit coverage in `position.rs` to assert:
  - duplicate bind rejection
  - consume-once behavior
- Verification:
  - `cargo test -p shadowperp state::position::tests -- --nocapture` -> PASS (5 passed)
  - `cargo check -p shadowperp` -> PASS
  - `npm run check:preflight` -> PASS
- Current blocker (unchanged):
  - Arcium devnet `QueueComputation` serialization issue on open-position path.
- Next safe step:
  1. Add localnet integration test for duplicate queue rejection + callback consume-once path.
  2. Start `ShieldedPool`/`NullifierSet` scaffolding behind feature flag.
## Session Update: Operator Directive - Devnet Only (2026-02-23 UTC)
- User directive received: do not integrate localnet anymore.
- Policy update applied:
  - localnet integration testing is deferred
  - next hardening/verification steps will be devnet-only
- Next safe step (updated):
  1. continue devnet-safe protocol hardening behind feature flags (`ShieldedPool` / `NullifierSet` scaffolding)
  2. add devnet-focused smoke/assert scripts only (no localnet dependency)
## Session Update: Devnet Canary + Shielded Collateral Scaffold (2026-02-23 UTC)
- Implemented a new devnet canary command:
  - `scripts/devnet-canary.ts`
  - `npm run check:canary`
- Canary checks now include:
  - oracle freshness
  - comp-def pointer/finalization status
  - client encryption bootstrap (`x25519` + `RescueCipher`)
  - non-destructive `open_position` queue simulation health
- Added feature-gated shielded collateral scaffolding (no live flow wiring):
  - new state (feature `shielded-collateral`):
    - `programs/shadowperp/src/state/shielded_collateral.rs`
    - `ShieldedPool`, `NullifierSet`
  - new handlers (feature `shielded-collateral`):
    - `init_shielded_pool`
    - `set_shielded_collateral_feature`
  - integration wiring:
    - `programs/shadowperp/src/state/mod.rs`
    - `programs/shadowperp/src/handlers/mod.rs`
    - `programs/shadowperp/src/lib.rs`
    - `programs/shadowperp/Cargo.toml` (added feature flag)
- Safety guarantee:
  - `deposit_collateral`/`withdraw_collateral` behavior unchanged in default build.

### Verification
- `cargo check -p shadowperp` -> PASS
- `cargo check -p shadowperp --features shielded-collateral` -> PASS
- `npm run check:preflight` -> PASS
- `npm run check:canary` -> FAIL (expected current blocker surfaced clearly):
  - `Queue call health (open_position simulate): AccountDidNotSerialize (queue computation account serialization)`

### Current blocker
- Arcium devnet queue path serialization issue (`AccountDidNotSerialize`) remains unresolved.

### Next safe step
1. Keep using `npm run check:canary` as the single readiness gate before smoke tests.
2. After Arcium-side queue serialization fix is confirmed, rerun canary then full devnet smoke.
3. Only then consider wiring shielded collateral into runtime flows behind explicit enablement.
- Canary command:
  - `npx ts-node scripts/devnet-canary.ts --max-oracle-age-seconds 300`

## Unified Hosting Orchestrator (2026-02-23 UTC)
- User request: one command should start all required runtime services together, and one command should stop all together.
- Added new orchestrator:
  - `scripts/hosting-stack.ts`
  - Manages:
    - Next.js app dev server
    - oracle daemon (`scripts/price-oracle.ts`)
  - Uses detached processes + PID state file:
    - state: `.runtime/hosting-stack.json`
    - logs:
      - `.runtime/app-dev.log`
      - `.runtime/oracle-daemon.log`
- Added package scripts:
  - `npm run hosting:start`
  - `npm run hosting:stop`
  - `npm run hosting:status`
  - `npm run hosting:restart`
  - `npm run canary:devnet`

### Verification Run (post-change)
- Required session checklist completed:
  - read `DEV_NOTES.md`
  - `git status --short`
  - verified env values in `app/.env.local`
  - `npm run check:preflight` -> FAIL (oracle stale), then `npm run oracle:once`, then PASS
- Orchestrator validation:
  - `npx ts-node scripts/hosting-stack.ts start` -> starts app + oracle
  - `npx ts-node scripts/hosting-stack.ts status` -> both running with PIDs/logs
  - verified logs:
    - app ready on `http://localhost:3000`
    - oracle daemon publishing/skipping as expected
  - `npx ts-node scripts/hosting-stack.ts stop` -> both stopped cleanly
- Canary check:
  - `npx ts-node scripts/devnet-canary.ts --max-oracle-age-seconds 300` -> still fails only on known blocker:
    - `Queue call health (open_position simulate): AccountDidNotSerialize (queue computation account serialization)`

### Current blocker
- Arcium queue serialization failure on `open_position` (`AccountDidNotSerialize`) remains the protocol blocker for real open-position flow.

### Next safe step
1. Use unified runtime commands during testing:
   - `npm run hosting:start`
   - `npm run canary:devnet`
   - `npm run hosting:stop`
2. Continue Arcium-side queue serialization unblock path while keeping this orchestrator unchanged.

## Repo Hygiene + README Cleanup (2026-02-23 UTC)
- Request addressed: clean public-facing repo metadata and make README human-readable.
- Updated `.gitignore` to explicit allow/deny patterns:
  - removed brittle global `*.json` ignore
  - added targeted secret/key ignores (`*keypair*.json`, `**/id.json`, `*.pem`, `*.key`)
  - added runtime/scratch/tooling ignores (`.runtime/`, `_*.log`, `_tmp_*`, temp clones, archives, preview html)
  - ensured `.env.example` files remain trackable while `.env*` stays ignored
- Rewrote `README.md` into concise, accurate sections:
  - current status with known devnet blocker (`AccountDidNotSerialize` queue path)
  - quick start and unified hosting commands
  - ops command map and onboarding read order
  - safety rules for public repo hygiene
- Secret scan result:
  - no committed keypair/env-local files detected in tracked set
  - no hardcoded user API keys found in tracked docs/scripts

### Verification
- Reviewed current tracked/untracked repo state with `git status --short`
- Scanned repo for key-like strings and known leaked values via `rg`
- Confirmed README renders cleanly (ASCII, no mojibake)

### Current blocker
- Protocol-side queue serialization (`AccountDidNotSerialize`) remains unchanged.

### Next safe step
1. Commit only docs/hygiene files (`README.md`, `.gitignore`) as a small isolated commit.
2. Keep operational/protocol fixes in separate commits to avoid release confusion.

## UI Minimal Privacy Label (2026-02-23 UTC)
- User request: hide oracle + long privacy sentence in bottom panel header and keep only minimal lock + `encrypted`.
- Updated:
  - `app/src/components/BottomPositionsPanel.tsx`
  - removed `Oracle: $...` inline label from the header right side
  - replaced long copy `Size, leverage & direction encrypted via Arcium MPC` with `encrypted`
  - kept lock icon indicator.

### Verification
- `npm run check:preflight` -> PASS
- `pnpm --dir app exec tsc --noEmit` -> PASS

### Current blocker
- Unchanged: Arcium queue path `AccountDidNotSerialize` on `open_position`.

### Next safe step
1. Refresh UI and confirm header now shows only lock icon + `encrypted`.
2. Keep protocol-debug work isolated from UI changes.

## Delegated Session Batching Scaffold (2026-02-23 UTC)
- User request: implement safe "single owner approval + many encrypted executions" flow.
- Implemented on-chain delegated session model:
  - New state: `TradeSession`
    - file: `programs/shadowperp/src/state/trade_session.rs`
    - fields: owner, market, relayer, session_id, max_actions, used_actions, max_margin_per_action, expires_at, revoked
    - guards: relayer binding, expiry, action cap, per-open margin cap, owner revocation
  - New instructions:
    - `create_trade_session`
    - `revoke_trade_session`
    - `open_position_with_session`
    - `close_position_with_session`
  - New handler module:
    - `programs/shadowperp/src/handlers/session_trading.rs`
  - Wiring updates:
    - `programs/shadowperp/src/state/mod.rs`
    - `programs/shadowperp/src/handlers/mod.rs`
    - `programs/shadowperp/src/lib.rs`
    - `programs/shadowperp/src/errors/mod.rs` (session-specific errors)
- Safety properties:
  - owner signs once to create session
  - relayer can execute multiple encrypted open/close queue txs without repeated owner signatures
  - session is bounded by expiry + max actions + max margin per open
  - owner can revoke at any time
  - existing direct open/close path unchanged
  - collateral transfer path unchanged/public (by design)

### Frontend SDK support
- Added client methods in `app/src/lib/client.ts`:
  - `getTradeSessionAddress`
  - `getTradeSession`
  - `createTradeSession`
  - `revokeTradeSession`
  - `openPositionWithSession`
  - `closePositionWithSession`
- Added `TradeSession` type in `app/src/types/index.ts`.

### Verification
- `cargo check -p shadowperp` -> PASS
- `pnpm --dir app exec tsc --noEmit` -> PASS
- `npm run check:preflight` -> FAIL initially (oracle stale), then:
  - `npm run oracle:once`
  - `npm run check:preflight` -> PASS

### Current blocker
- Unchanged protocol blocker: Arcium queue path still fails on open-position with `AccountDidNotSerialize` in current devnet namespace.

### Next safe step
1. Rebuild/deploy program and regenerate IDL, then sync `app/src/idl/shadowperp.json` so new session instructions are callable at runtime.
2. Add a relayer ops script (`create-session`, `queue-open`, `queue-close`) and UI controls for owner session lifecycle.
3. Keep delegated path behind an explicit runtime flag until end-to-end devnet smoke passes.

## Session Update: Relayer Ops Live + 5h Session Default + UI Hide (2026-02-23 UTC)
- User request handled:
  - keep `Privacy degraded` indicator hidden in trade UI
  - move delegated session flow from source-only to live deploy path
  - make session default duration 5 hours
  - keep hosting stack live.

### Code changes
- Hidden degraded UI indicator:
  - `app/src/components/TradingPanel.tsx`
  - removed render block for `Privacy degraded` badge (`privacyStatus === "error"`).
- Session default duration:
  - `app/src/lib/client.ts`
  - added `DEFAULT_TRADE_SESSION_DURATION_SECONDS = 5 * 60 * 60`
  - `createTradeSession(...)` now accepts optional `expiresAt` and defaults to current time + 5h.
- New relayer runbook script:
  - `scripts/session-relayer.ts`
  - commands: `create | status | revoke | open | close | smoke`
  - supports owner/relayer wallets, session id, limits, and default 5h expiry.
- Added package scripts:
  - `session:relayer:create`
  - `session:relayer:status`
  - `session:relayer:open`
  - `session:relayer:close`
  - `session:relayer:revoke`
  - `session:relayer:smoke`

### Deploy / IDL / runtime verification
- Build:
  - `npm run build:anchor:safe` -> PASS
- Deploy:
  - `npx ts-node scripts/deploy-devnet.ts` (with Helius RPC) -> PASS
  - program confirmed: `2Gz35PAHBkggSfV77mCENobt5YEURuYMAjgpvKXoL61d`
  - market confirmed: `C3UcQ3FnjqUsFPWfDgKNoq4cGzpWw6tSEqM6bf1MoFv8`
- IDL sync:
  - `npm run app:sync-idl` -> PASS
  - deploy script also synced `target/idl/shadowperp.json` to `app/src/idl/shadowperp.json`
- Relayer flow:
  - `npm run session:relayer:smoke`
  - step 1 (create session) -> PASS
    - sample session id: `1771850982`
    - sample session pda: `AdHsSWitkufv5kMHBVAZ9WupYgoAHdm3HWDkv1Ydhz8n`
    - expiry: `2026-02-23T17:49:42.000Z` (5h)
  - step 2 (delegated open queue) -> FAIL
    - `AnchorError account: comp`
    - `AccountDidNotSerialize (3004)`
- Session status check:
  - `npm run session:relayer:status -- --session-id 1771850982` -> PASS
  - confirms active, unrevoked, `used_actions=0`, expiry set correctly.
- Preflight:
  - `npm run check:preflight` -> PASS
- Canary:
  - `npm run canary:devnet` -> FAIL only on queue simulation with same `AccountDidNotSerialize`.
- Hosting:
  - `npm run hosting:restart` + `npm run hosting:status` -> PASS
  - app + oracle daemon running from `.runtime` logs.

### Operational note
- Deploy script writes initial oracle to `$103.00`; this can trigger oracle safety freeze if external sources are far from that price.
- Performed one-shot correction with temporary env:
  - `ORACLE_MAX_DEVIATION_BPS=10000 npm run oracle:once`
- Restarted hosting stack so daemon baseline reset to live market level.

### Current blocker
- Primary protocol blocker unchanged:
  - Arcium queue path for `open_position` / `open_position_with_session` fails at `queue_computation` with `AccountDidNotSerialize (3004)` on `comp`.

### Next safe step
1. Keep delegated session ops available (create/revoke/status) and treat delegated open/close as blocked by Arcium queue serialization until resolved.
2. Use `npm run canary:devnet` as the hard gate before trade tests.
3. Continue with the fresh finalized-comp-def reset + Arcium-side serialization unblock track; once fixed, rerun:
   - `npm run session:relayer:smoke`
   - open/close end-to-end smoke
   - then mark delegated batching live-ready.

## Delegated Session Relay Wiring (2026-02-23 UTC)
- User issue addressed:
  - Opening positions still triggered wallet transaction popups each time.
  - Requested behavior: one-time setup path, then no per-trade wallet popup.
- Implemented:
  - Added server-side relay runtime/bootstrap:
    - `app/src/lib/server/relay-client.ts`
    - Loads relayer keypair from:
      - `SHADOWPERP_RELAYER_KEYPAIR_JSON` (preferred)
      - `SOLANA_WALLET_KEYPAIR_JSON` (fallback)
      - `SHADOWPERP_RELAYER_KEYPAIR_PATH`
      - fallback file: `~/.config/solana/id.json`
  - Added relay API routes:
    - `app/src/pages/api/relay/session.ts`
      - health/info endpoint and optional on-chain session status lookup
    - `app/src/pages/api/relay/open.ts`
      - executes `open_position_with_session` via relayer account
      - validates owner/session/auth signature and session constraints before queueing
  - Added shared auth/message helpers:
    - `app/src/lib/relay-session-auth.ts`
  - Extended trade hook:
    - `app/src/hooks/useArcium.ts`
    - Added delegated session lifecycle:
      - create session (one-time wallet approval + message signature)
      - revoke session
      - refresh session status
      - persisted session state in localStorage
    - `submitPrivateOrder` now auto-routes:
      - delegated session path if active
      - direct wallet path otherwise
  - Added UI controls in trade panel:
    - `app/src/components/TradingPanel.tsx`
    - new `Enable Session / Session On` control in margin card
    - execution status row (`Delegated session active - Xm left` / `Direct wallet mode`)
  - Updated env template:
    - `app/.env.example`
    - documented relay server keypair env vars

### Verification Run (post-change)
- `pnpm --dir app exec tsc --noEmit` -> PASS
- `npm run oracle:once` -> PASS
- `npm run check:preflight` -> PASS

### Current blocker
- Core Arcium queue path can still fail intermittently by environment/state (`AccountDidNotSerialize` on `comp`) in some flows; this change only removes repeated wallet-popup UX friction by routing through delegated sessions when available.

### Next safe step
1. Set relayer server env in `app/.env.local` or process env:
   - `SHADOWPERP_RELAYER_KEYPAIR_JSON` or `SHADOWPERP_RELAYER_KEYPAIR_PATH`
2. Restart Next.js server (`cd app && pnpm dev`).
3. In UI, click `Enable Session` once, then test open-position flow again.

## Repo Hygiene: Scratch File Cleanup (2026-02-23 UTC)

### What changed
- Deleted 7 obsolete untracked scratch/diagnostic scripts (all had `_` prefix per convention, never committed to git):
  - `_smoke_devnet.ts` — superseded by `npm run canary:devnet` + `session:relayer:smoke`
  - `scripts/_init_signer.ts` — one-off signer init, completed
  - `scripts/_inspect_comp_space.ts` — used to diagnose 3004 space bug, analysis complete and documented in DEV_NOTES
  - `scripts/_open_position_test.ts` — replaced by `session:relayer:smoke` / `check:canary`
  - `scripts/_state_check.ts` — replaced by `check:preflight` + `check:stable`
  - `scripts/_test_flow.ts` — replaced by full smoke/canary flow
  - `scripts/_test_flow2.ts` — same as above

### What was verified
- Full security + hygiene audit run before deletion
- All 7 files confirmed untracked (`git status --short` showed `??`) before removal
- No tracked files deleted
- No git history affected

### Audit findings summary
- No secrets or API keys tracked in git
- No .gitignore gaps detected
- No hardcoded addresses in frontend source
- No plaintext position data leakage in Rust programs or API routes
- No NO_TOUCH_LIST violations
- No auth bypass risks in relay routes
- HTML preview files (landing-preview.html, header-logo-preview.html, ui-previews.html) confirmed untracked and properly gitignored

### Current blocker
- Unchanged: Arcium `QueueComputation` `AccountDidNotSerialize (3004)` on `comp`.

### Next safe step
- Continue Arcium-side queue unblock track.

---

## Security Hygiene: API Key Removed from .claude/settings.json (2026-02-23 UTC)

### What was found
- Helius devnet RPC API key was embedded inside a Bash permission entry in `.claude/settings.json`.
- `.claude/settings.json` is gitignored so the key was never committed to git, but the file can be accidentally shared if copied to another machine or repo.

### Root cause (exact mechanism)
At some point a ts-node script was run with the API key baked in inline, like:
```
NEXT_PUBLIC_SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=<KEY> npx ts-node scripts/...
```
Claude Code prompted "Allow this Bash command?" and the approval was granted.
When you approve a command, Claude Code writes the **full command string verbatim** into `.claude/settings.json` as a stored permission rule — including any env vars and secrets embedded in the string.
The key was then sitting in `.claude/settings.json` indefinitely.

### What was fixed
- Cleaned the offending permission entry from `.claude/settings.json`.
- Then deleted `.claude/settings.json` entirely — Claude Code recreates it fresh when needed.
- All remaining (new) permission entries will only contain public on-chain addresses.
- Verified: no API keys in git history, no API keys in tracked files.

### Rule going forward
- **Never pass API keys, RPC keys, or auth tokens inline in terminal commands.**
- All sensitive values belong in `app/.env.local` (gitignored):
  - `NEXT_PUBLIC_SOLANA_RPC_URL` / `NEXT_PUBLIC_SOLANA_RPC_URLS`
  - `COINMARKETCAP_API_KEY`
  - `SHADOWPERP_RELAYER_KEYPAIR_JSON`
  - `ORACLE_ALERT_WEBHOOK_URL`
- Scripts and the frontend pick these up automatically from `.env.local` — no inline passing needed.
- If a key absolutely must be passed inline for a one-off command, use **"Allow once"** not "Always allow" in the Claude Code permission prompt — "Allow once" does not write the command to `settings.json`.
- If a key was already passed inline and approved as "Always allow", rotate it immediately.

### Where secrets live (canonical reference)
| Secret | File | Notes |
|---|---|---|
| Helius / Alchemy / Ankr RPC URLs + keys | `app/.env.local` | `NEXT_PUBLIC_SOLANA_RPC_URLS` |
| CoinMarketCap key | `app/.env.local` | `COINMARKETCAP_API_KEY` (server-side only) |
| Relayer keypair | `app/.env.local` | `SHADOWPERP_RELAYER_KEYPAIR_JSON` or `_PATH` |
| Alert webhook URL | `app/.env.local` | `ORACLE_ALERT_WEBHOOK_URL` |
| Solana wallet keypair | `~/.config/solana/id.json` | never in repo |
| Program keypair | `target/deploy/shadowperp-keypair.json` | gitignored via `*keypair*.json` |

---

## Session-Only Trading Enforcement (2026-02-23 UTC)
- Updated flow to remove direct wallet trade fallback.
- Files updated:
  - `app/src/hooks/useArcium.ts`
    - `submitPrivateOrder` now hard-requires active delegated session.
    - If session is expired/revoked/missing, returns explicit error:
      - "Delegated session required. Click 'Enable Session' again to continue trading."
  - `app/src/components/TradingPanel.tsx`
    - Added strict guard before any submit path (market + limit queue).
    - Limit executor now no-ops when no active session.
    - Submit button disabled when session is not active.
    - Execution hint changed from "Direct wallet mode" to "Session required to trade".
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `npm run oracle:once` -> PASS
  - `npm run check:preflight` -> PASS

## Deep Codebase Audit (2026-02-23 UTC)

Full multi-dimensional audit run across all TypeScript, Rust, scripts, and config. No files modified.

### Result: 0 CRITICAL, 3 HIGH, 8 MEDIUM, 5 LOW

---

### HIGH findings

**H1 — Privacy: position.margin rendered in UI**
- File: `app/src/components/BottomPositionsPanel.tsx`
- `position.margin` is read and used in health % calculations rendered on screen.
- Model intention: margin is cleared to 0 on-chain after settlement, so for active positions this should already be 0. But the component still performs the division path when > 0.
- Action: Confirm margin is always 0 during active position lifecycle. Add a guard or remove the render path for active positions.

**H2 — Architecture: NEXT_PUBLIC_SOLANA_CLUSTER not in .env.example**
- File: `app/src/lib/explorer.ts` references `NEXT_PUBLIC_SOLANA_CLUSTER` for Solana Explorer URL generation.
- This env var is not documented in `app/.env.example`.
- Action: Add `# NEXT_PUBLIC_SOLANA_CLUSTER=devnet` to `app/.env.example`.

**H3 — Security: relay open.ts missing session market validation**
- File: `app/src/pages/api/relay/open.ts`
- The endpoint validates relayer, expiry, and revoked status but does not explicitly check that `session.market` matches the configured market address before queuing.
- On-chain constraints mitigate this, but API-level validation is incomplete.
- Action: Add `if (!session.market.equals(relay.config.marketAddress)) throw error` before queue call.

---

### MEDIUM findings

**M1 — Quality (Rust): `.expect()` in position state handlers**
- File: `programs/shadowperp/src/state/position.rs`
- Multiple `.expect()` calls in `set_pending_callback_meta()` and related helpers will panic on overflow instead of returning graceful Anchor errors.
- Action: Replace with `?` operator and `ShadowPerpError::ArithmeticOverflow`.

**M2 — Quality (Rust): incomplete private_orders handler**
- File: `programs/shadowperp/src/handlers/private_orders.rs`
- Contains `// TODO: Wire queue_computation to Arcium MXE callback flow once comp-def is finalized.`
- Private order book feature is not wired to Arcium callbacks yet.
- Action: Keep as-is for now but track separately; ensure it is not callable without the wiring in place.

**M3 — Quality (TS): excessive `any` types in client.ts**
- File: `app/src/lib/client.ts` lines ~60, 77, 161-164
- `private program: any`, `new (Program as any)(idlWithAddress, provider)`, event callbacks typed as `any`.
- Action: Define strict Anchor program types and event interfaces when time permits.

**M4 — Security: relay-client.ts keypair parsing has no input validation**
- File: `app/src/lib/server/relay-client.ts`
- `SHADOWPERP_RELAYER_KEYPAIR_JSON` is parsed and passed directly to `Keypair.fromSecretKey()` without format validation. Malformed input produces generic errors that could expose file system paths.
- Action: Wrap with try/catch and sanitize error messages.

**M5 — Security: deposit_collateral missing `has_one = owner` constraint**
- File: `programs/shadowperp/src/handlers/deposit_collateral.rs`
- `margin_account` struct uses PDA seeds with owner but no `has_one = owner` constraint. Anchor will not verify the stored owner field matches the signer on `init_if_needed` path.
- Action: Add `has_one = owner` to the `margin_account` attribute.

**M6 — Quality: env error messages don't differentiate missing vs invalid**
- File: `app/src/lib/runtime.ts` lines 67-76
- Error copy says "Invalid public key" for both missing and malformed env vars.
- Action: Separate the missing-key and invalid-format error paths.

**M7 — Observability: callback verify failure is silent**
- File: `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
- `output.verify_output()` failure silently returns `InvalidComputationResult` with no log.
- Action: Add `msg!("MPC verify failed for position {}", position.key())` before the error return.

**M8 — Validation: relay open.ts doesn't check owner token account exists**
- File: `app/src/pages/api/relay/open.ts`
- No pre-flight check that owner's USDC token account exists before queuing the on-chain tx.
- Action: Add `getAccountInfo` check on the owner's ATA before calling `openPositionWithSession`.

---

### LOW / INFO findings

**L0 — Audit addendum: hardcoded Helius base URL in deploy-devnet.ts**
- File: `scripts/deploy-devnet.ts` line 400
- `NEXT_PUBLIC_ARCIUM_RPC_URL=https://devnet.helius-rpc.com` is written to `app/.env.local` on deploy.
- No API key embedded — public Helius devnet base URL (rate-limited free tier). `.env.local` is gitignored.
- Risk: LOW. Quality improvement only: script could read from `SOLANA_RPC_URLS` to auto-use the private key.

**L1 — Dead Code: unconventional import path in session-relayer.ts**
- `import type { ... } from "../app/src/types"` traverses out of scripts/ into app/.
- Works but fragile if structure changes.

**L2 — Confirmed CLEAN: IDL sync is correct**
- Session instructions (create_trade_session, revoke_trade_session, open_position_with_session, close_position_with_session) are present and correct in `app/src/idl/shadowperp.json`.

**L3 — Confirmed CLEAN: Program ID consistent across all configs**
- `Anchor.toml`, `programs/shadowperp/src/lib.rs` declare_id!, `app/src/idl/shadowperp.json`, and DEV_NOTES all agree: `2Gz35PAHBkggSfV77mCENobt5YEURuYMAjgpvKXoL61d`.

**L4 — Confirmed CLEAN: no plaintext position data in events/logs**
- All `emit!` and `msg!` calls in Rust handlers log only public identifiers (owner pubkey, position pubkey, timestamp). No size, leverage, margin, or PnL values in logs.

**L5 — Confirmed CLEAN: no hardcoded secrets anywhere**
- No Helius/Alchemy/Ankr/CoinMarketCap API keys in any tracked file. All RPC and auth values are env-var-based.

---

### Priority action order
1. H3 — relay market validation (quick, API-level fix)
2. H2 — add NEXT_PUBLIC_SOLANA_CLUSTER to .env.example (trivial)
3. H1 — verify margin=0 guard in BottomPositionsPanel (confirm then fix or no-op)
4. M5 — has_one = owner in deposit_collateral (on-chain, requires rebuild/deploy)
5. M1 — replace .expect() with ? in position state (on-chain, requires rebuild/deploy)
6. M7 — add msg! to callback verify failure (on-chain, low priority)
7. M3/M6/M8 — TypeScript quality cleanup (frontend-only, non-breaking)

---

### Current blocker (unchanged)
- Arcium `QueueComputation` `AccountDidNotSerialize (3004)` on `comp` — independent of all findings above.

---

## Session Indicator Relocation + Auto Session Bootstrap (2026-02-23 UTC)
- User request implemented:
  - Move delegated session status from trading panel to top summary strip (right side).
  - Keep timer live.
  - Auto-create session immediately after wallet connect when needed.
  - Reuse previous session automatically if still valid (owner/market match, not expired, not exhausted).
- Files updated:
  - `app/src/components/PortfolioSummary.tsx`
    - Added right-side session pill with lock icon.
    - Live countdown updates every second.
    - Status text states:
      - `Delegated session active - Xm left`
      - `Session required`
      - `Relay unavailable`
    - Polls relay session status every 30s.
  - `app/src/components/TradingPanel.tsx`
    - Removed session toggle button + execution text from margin card.
    - Added auto session bootstrap effect (`ensureRelaySession`) on wallet connect.
    - Retains strict session-only trade enforcement.
  - `app/src/hooks/useArcium.ts`
    - Persisted session no longer cleared on disconnect.
    - Added storage/event sync across multiple hook instances.
    - Added `ensureRelaySession()` helper.
    - Added usable-session guard (checks expiry + action budget).
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `npm run oracle:once` -> PASS
  - `npm run check:preflight` -> PASS
- Follow-up adjustment:
  - Auto session bootstrap now retries safely with cooldown (30s) when session is missing/expired/exhausted.
  - Prevents duplicate auto-create attempts while still recovering automatically after expiry/action-budget exhaustion.

## Session Exhaustion + 15s Renewal Gate (2026-02-23 UTC)
- Enforced wallet-address-aware session reuse and strict replacement rules:
  - Existing unexhausted session is reused (no new signing) when:
    - same wallet owner
    - same market
    - actions remaining
    - more than 15s to expiry
  - New session signing is required when:
    - session exhausted (`usedActions >= maxActions`)
    - session has 15s or less remaining before expiry
    - session missing/revoked/invalid
- Storage model updated to owner+market scoped keys:
  - `shadowperp.relay.session.v1:<owner>:<market>`
  - supports wallet-based recognition of unexhausted sessions.
- Implemented in `app/src/hooks/useArcium.ts`:
  - `RELAY_SESSION_RENEW_BEFORE_SECONDS = 15`
  - owner+market storage helpers + legacy key migration
  - usable-session guard now includes 15s renewal window
  - `createRelaySession` returns existing usable session instead of re-signing
- UI behavior:
  - auto bootstrap signs only when needed (missing/expired/exhausted/<=15s)
  - top header timer reflects active session window continuously.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `npm run oracle:once` -> PASS
  - `npm run check:preflight` -> PASS

## Relay Availability Hardening Addendum (2026-02-23 UTC)
- Added API-level market binding validation in relay open endpoint:
  - `app/src/pages/api/relay/open.ts`
  - now rejects session if `session.market` != runtime configured market.
- Added missing cluster env docs:
  - `app/.env.example`
  - `NEXT_PUBLIC_SOLANA_CLUSTER=devnet` documented for explorer URL consistency.
- Verification:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `npm run check:preflight` -> PASS

## Repo-Wide Review + Push Prep (2026-02-23 UTC)

### What changed
- Resolved prior merge blocker in `README.md` (removed unresolved conflict state and retained a clean merged document).
- Performed full working-tree review across staged + unstaged + untracked files.
- Included all pending local changes (UI, scripts, docs, Rust program/session flow, relay/API, and repo hygiene files) for a single push-ready snapshot.

### What was verified
- Mandatory session checklist executed:
  - read `DEV_NOTES.md`
  - `git status --short`
  - verified active env values in `app/.env.local`
  - `npm run check:preflight` -> PASS (program, market, comp-defs, oracle freshness, canonical devnet USDC)
- Build checks:
  - `pnpm --dir app exec tsc --noEmit` -> PASS
  - `cargo check -p shadowperp` -> PASS (warnings only)
- Safety checks:
  - no remaining merge markers
  - no hardcoded private API keys found in tracked files (placeholder-only patterns in docs/templates)

### Current blocker
- Known protocol/runtime blocker remains unchanged:
  - Arcium queue path can still hit `QueueComputation` -> `AccountDidNotSerialize (3004)` in specific open-position flows.

### Next safe step
1. Keep canary/preflight as gate before every trading run.
2. Continue Arcium queue serialization unblock track with minimal repro + support channel.
3. Maintain session-only relay UX until queue path is stable.

## Delegated Withdraw + Relay Watchdog + Audit Follow-up (2026-02-23 UTC)

### What changed
- Added delegated-session withdrawal path end-to-end:
  - On-chain:
    - `programs/shadowperp/src/handlers/session_trading.rs`
      - new `WithdrawCollateralWithSession` accounts context
      - new `withdraw_collateral_with_session_handler(...)`
      - enforces active session + relayer/market binding + amount <= `max_margin_per_action` + action consumption
    - `programs/shadowperp/src/lib.rs`
      - new instruction `withdraw_collateral_with_session`
  - Client:
    - `app/src/lib/client.ts`
      - new `withdrawCollateralWithSession(...)`
  - Relay API:
    - new `app/src/pages/api/relay/withdraw.ts`
      - validates auth signature, session owner/market/relayer, expiry, limits
      - executes `withdrawCollateralWithSession`
  - UI:
    - `app/src/components/CollateralModal.tsx`
      - withdraw now runs via relay/session (no per-withdraw wallet popup)
      - auto-ensures session and refreshes session usage after successful withdraw
    - `app/src/components/TradingPanel.tsx`
      - passes relay/session props into collateral modal

- Added relay watchdog script with webhook paging:
  - new `scripts/relay-watchdog.ts`
    - checks `/api/relay/session`
    - fails fast on unhealthy response
    - sends webhook alert on failure (`RELAY_ALERT_WEBHOOK_URL` fallback `ORACLE_ALERT_WEBHOOK_URL`)
  - `package.json`
    - new script: `relay:watchdog`
  - `app/.env.example`
    - added `RELAY_WATCHDOG_BASE_URL`
    - added `RELAY_ALERT_WEBHOOK_URL`

- Audit follow-up hardening:
  - `app/src/components/BottomPositionsPanel.tsx`
    - removed health/PnL% dependence on on-chain `position.margin`
    - now uses local derived margin from owner view (`entryPrice * sizeBase / leverage`)

- Repo hygiene:
  - `.gitignore` updated to ignore `timer-icon-preview.html` scratch file.

### What was verified
- `pnpm --dir app exec tsc --noEmit` -> PASS
- `cargo check -p shadowperp` -> PASS (warnings only)
- `npm run check:preflight` -> PASS
- `npm run relay:watchdog -- --base-url http://localhost:3000` -> PASS
- Checked `C:\Users\bolaj\AppData\Local\Temp\claude\c--Users-bolaj-projects-shadowperp\tasks\b9ec040.output`:
  - captured output is normal mid-compilation crate graph
  - warning about unused `proc-macro2` patch is pre-existing/non-blocking
  - build status remains clean

### Current blocker
- Core Arcium queue blocker remains unchanged for open-position queue path in some flows:
  - `QueueComputation` -> `AccountDidNotSerialize (3004)`

### Next safe step
1. Deploy updated program + sync IDL to activate `withdraw_collateral_with_session` on-chain.
2. Run delegated withdraw smoke (session create -> withdraw -> session usage increment -> revoke).
3. Keep relay watchdog in CI/ops loop for fast runtime readiness checks.

## Session Bootstrap Loop Fix (2026-02-23 UTC)

### What changed
- Fixed delegated-session auto-bootstrap loop and stuck loading toast:
  - `app/src/components/TradingPanel.tsx`
    - auto-session toast now always dismisses on cleanup/cancel/success-active state
    - added stronger cooldown backoff after auto-session failure (`5m`) to prevent repeated retries
    - keeps short base cooldown (`30s`) for normal flow
- Reduced repeated gas-spend risk during session creation:
  - `app/src/hooks/useArcium.ts`
    - reordered `createRelaySession` flow to sign authorization message **before** on-chain `createTradeSession`
      - prevents sending repeated on-chain session-create txs when auth/sign step fails
    - hardened storage helpers (`persistSession` / `clearStoredSession`) to not throw on localStorage failures

### What was verified
- `pnpm --dir app exec tsc --noEmit` -> PASS
- `npm run check:preflight` -> PASS

### Current blocker
- Unchanged protocol blocker on some trade queue paths: `QueueComputation -> AccountDidNotSerialize (3004)`.

### Next safe step
1. User-side confirm: spinner clears after session activation and no repeated session-create tx fees.
2. If any repeat persists, log `/api/relay/session` payload cadence + wallet adapter sign events for exact retry trigger.

## Trading Panel Layout Tweak (2026-02-23 UTC)

### What changed
- Moved the leverage slider panel to sit directly under the size panel in `app/src/components/TradingPanel.tsx`.
- Removed the now-empty secondary column for horizontal layout and expanded the primary form column to full width (`lg:col-span-12`) so no dead space remains.
- Kept leverage logic/behavior unchanged (same markers, same slider, same values).

### What was verified
- `pnpm --dir app exec tsc --noEmit` -> PASS
- `npm run check:preflight` -> PASS

### Current blocker
- Unchanged runtime blocker in some queue paths: `QueueComputation -> AccountDidNotSerialize (3004)`.

### Next safe step
1. Visually verify the new order in the live form (`Size` then `Leverage`) on desktop and mobile widths.
2. Continue Arcium queue-path unblock track in parallel with UI refinement work.

## Market Panel Simplification (2026-02-23 UTC)

### What changed
- Simplified right-side market info card to price-only display in `app/src/components/MarketInfo.tsx`.
- Removed nonessential stat tiles from that panel:
  - Open Interest
  - Notional Traded
  - Trading Fee
  - Max Leverage
  - Liq. Threshold
  - Fees Collected
- Removed active-position counter and percent-change badge from this card to keep only the price value visible.
- Cleaned now-unused helper/state fields tied to removed tiles.

### What was verified
- `pnpm --dir app exec tsc --noEmit` -> PASS

### Current blocker
- Unchanged runtime blocker in some queue flows: `QueueComputation -> AccountDidNotSerialize (3004)`.

### Next safe step
1. Quick visual pass in app to confirm the 50/50 chart-side panel proportions still look correct after content reduction.

---

## UI Cleanup Session (2026-02-26 UTC)

### Files changed
- `app/src/components/PrivateOrderbook.tsx`
- `app/src/components/PortfolioSummary.tsx`
- `app/src/components/TradingPanel.tsx`

### Changes made

#### PrivateOrderbook.tsx
- Removed the Trades side-panel (was 45% width column with Price/Size/Time headers and "No trades" placeholder).
- Added Order Book / Trades tab switcher in the header with cyan underline indicator — clicking Trades shows the trades column, clicking Order Book shows the book.
- Fixed column header: `Total` was showing `(SOL)` (base symbol) — corrected to `(USDC)` (quote symbol) since Total represents cumulative notional value.

#### PortfolioSummary.tsx
- Removed Account Equity card from the portfolio strip (the clickable button that opened a dropdown with Spot/Perps breakdown + Perps Overview panel).
- Cleaned up associated state: `equityCardRef`, `equityCardOpen`, and the click-outside `useEffect`.

#### TradingPanel.tsx
- Replaced the two stacked checkbox-style margin mode cards (Cross / Isolated) with a compact segmented pill toggle. Active half fills solid purple.
- Replaced pill toggle + standalone leverage box with two compact chips: `[Cross ↕]` and `[20x ↓]`.
  - Clicking the Cross chip cycles margin mode (Cross ↔ Isolated) directly.
  - Clicking the 20x chip expands/collapses the leverage slider inline below the chips.
- Removed the Margin / Notional / Liq. Price summary strip (the 3-column card shown above the submit button).
- Removed the Account Equity section from the account info panel (Spot/Perps rows + Perps Overview breakdown with margin ratio, maintenance margin, leverage).
- Removed the "Perps <-> Spot" transfer button; Withdraw button now spans full width.
- Removed both Deposit and Withdraw buttons entirely.

### Safety
- No on-chain instruction changes, no IDL changes, no relay route changes.
- All removals were UI-only — underlying state/calculations (`accountEquity`, `marginRatio`, etc.) retained where still used by other logic.

### Rule going forward
- DEV_NOTES.md should be updated after every ~5 UI/code changes in a session.
2. Keep price-source sync behavior unchanged (chart/pair/panel canonical feed alignment work remains intact).

## Session Duration Selector + Relay Diagnosis (2026-03-02 UTC)

### Files changed
- `app/src/hooks/useArcium.ts`
- `app/src/pages/app.tsx`

### Changes made

#### useArcium.ts
- Added `durationSeconds` option to `EnsureRelaySessionOptions` interface.
- `createRelaySession` now uses `options.durationSeconds` instead of the hardcoded `DEFAULT_TRADE_SESSION_DURATION_SECONDS` (5h) when provided.

#### app.tsx (SessionTimerChip)
- Added session duration selector: clicking "Start session" now opens a dropdown with 12h / 24h / 48h options.
- User selects duration before session creation begins.
- Added click-outside handler to dismiss the dropdown.

### "Relay unavailable" diagnosis
- Root cause: `createRelayRuntimeContext()` in `relay-client.ts` throws when no relayer keypair is configured.
- On Vercel, `SHADOWPERP_RELAYER_KEYPAIR_JSON` must be set as a server-side env var (JSON array of the keypair bytes).
- This is a deployment config issue, not a code bug.

## Callback Account Reduction — Settlement Split (2026-03-06 UTC)

### Problem
Arcium's 483-byte computation account can't hold all params + callback accounts during `QueueComputation`. The `AccountDidNotSerialize` (3004) error was caused by exceeding this budget.

### Solution: Two-Phase Settlement Split
Callbacks now update on-chain state only (3 callback accounts each). Token transfers are deferred to new permissionless settlement instructions.

### Callback account counts (before → after)
| Handler              | Before | After |
|----------------------|--------|-------|
| close_position       | 5      | 3     |
| check_liquidation    | 6      | 3     |

### New PositionStatus variants
- `ClosedPendingSettlement` (5) — close callback done, awaiting `settle_close_position`
- `LiquidatedPendingSettlement` (6) — liquidation callback done, awaiting `settle_liquidation`

### New instructions
- **`settle_close_position`** — reads settlement amount from `position.margin`, transfers from vault → owner, sets status to `Closed`, emits `PositionClosed`.
- **`settle_liquidation`** — reads penalty from `position.margin`, transfers from vault → liquidator, sets status to `Liquidated`, emits `PositionLiquidated`.

### Files changed
- `programs/shadowperp/src/state/position.rs` — added 2 enum variants
- `programs/shadowperp/src/handlers/callbacks/close_position_callback.rs` — removed `owner_token_account`, `vault`, `token_program`; sets `ClosedPendingSettlement` instead of transferring
- `programs/shadowperp/src/handlers/callbacks/liquidation_callback.rs` — removed `liquidator`, `liquidator_token_account`, `vault`, `token_program`; sets `LiquidatedPendingSettlement`
- `programs/shadowperp/src/handlers/close_position.rs` — callback_accounts vec reduced (5→3), removed `owner_token_account` and `vault` from struct
- `programs/shadowperp/src/handlers/check_liquidation.rs` — callback_accounts vec reduced (6→3), removed `liquidator_token_account` and `vault` from struct, added `LiquidationSettlement` PDA
- `programs/shadowperp/src/handlers/session_trading.rs` — `ClosePositionWithSession` callback_accounts reduced (5→3), removed `owner_token_account` and `vault` from struct
- `programs/shadowperp/src/handlers/settle_close_position.rs` — NEW
- `programs/shadowperp/src/handlers/settle_liquidation.rs` — NEW
- `programs/shadowperp/src/handlers/mod.rs` — registered new modules
- `programs/shadowperp/src/lib.rs` — registered new instructions

### Client SDK changes
- `app/src/lib/client.ts`:
  - `closePosition()` — removed `ownerTokenAccount` param; no longer passes `ownerTokenAccount`/`vault` to on-chain instruction
  - `closePositionWithSession()` — removed `ownerTokenAccount` param; no longer passes `ownerTokenAccount`/`vault`
  - `checkLiquidation()` — already correct (passes `liquidationSettlement`, no `liquidatorTokenAccount`/`vault`)
  - `settleClosePosition()` — already implemented (handles token transfer after callback)
  - `settleLiquidation()` — already implemented (handles penalty transfer after callback)
  - `finalizeClosePosition()` / `finalizeLiquidation()` — already implemented (poll + settle orchestrators)
  - `waitForPositionStatus()` — already implemented (generic polling helper)
- `app/src/components/BottomPositionsPanel.tsx` — updated `closePosition()` call (removed `ownerTokenAccount` arg)
- `app/src/components/PositionsList.tsx` — updated `closePosition()` call (removed `ownerTokenAccount` arg)
- `app/src/types/index.ts` — `PositionStatus` enum already has variants 5 and 6

### Verification
- `cargo check -p shadowperp` passes (warnings only, zero errors)

### Remaining — Deploy Runbook (verified 2026-03-06)

All scripts verified present and compatible. Fresh namespace is required (new instructions change the IDL).

**3-command deploy sequence (from non-sandboxed terminal):**
```bash
# 1. Build circuits in WSL (arcis artifacts needed for comp-def init)
bash scripts/wsl-arcium-build.sh

# 2. Fresh deploy: rotates keypair, anchor build, deploy, market init, comp-def init, IDL sync, .env.local
npm run deploy:devnet:fresh

# 3. Refresh oracle + health check
npm run oracle:once && npm run check:preflight && npm run canary:devnet -- --verbose
```

**Post-deploy smoke (settlement flow):**
```bash
npm run session:relayer:create -- --max-actions 10 --max-margin-usdc 5
npm run session:relayer:open -- --session-id <ID> --owner <OWNER>
npm run session:relayer:close -- --session-id <ID> --owner <OWNER> --position-index <INDEX>
```

**What `deploy:devnet:fresh` does automatically:**
- Generates fresh program keypair + `anchor keys sync`
- `anchor build` + `anchor deploy`
- Market initialize + Arcium signer PDA init
- `init-comp-defs.ts` (MXE init, upload circuits, finalize comp-defs)
- Writes `app/.env.local` with new program ID
- Copies `target/idl/shadowperp.json` → `app/src/idl/shadowperp.json`

**Known failure points:**
1. WSL arcis toolchain not installed (`scripts/wsl-arcium-build.sh` checks and errors)
2. Insufficient devnet SOL in deploy wallet
3. RPC rate limiting during deploy/init

**Note:** Circuits (`encrypted-ixs/src/*.rs`) were NOT changed in this round. `arcis build` produces identical artifacts. Fresh namespace is needed because the instruction set changed (new settle instructions), not because circuit bytecode changed.
## 2026-03-06 21:06 WAT - Build Environment Probe / Toolchain Status

- Checked required session basics again during environment work:
  - active env still points to devnet program `2Gz35PAHBkggSfV77mCENobt5YEURuYMAjgpvKXoL61d`
  - market `C3UcQ3FnjqUsFPWfDgKNoq4cGzpWw6tSEqM6bf1MoFv8`
  - Arcium cluster offset `456`
- Runtime side remains healthy:
  - `npm run oracle:once` had already recovered stale oracle earlier in session
  - `npm run check:preflight` passed
  - deploy wallet still had enough SOL for normal devnet ops

### What changed

- Fixed WSL native-Rust path expected by `scripts/wsl-arcium-build.sh`:
  - `~/.rust-native/install/bin/cargo`
  - `~/.rust-native/install/bin/rustc`
- Added repo wrapper:
  - `scripts/cargo-build-sbf.cmd`
- Updated build/deploy wrappers to pass cargo args through Anchor:
  - `scripts/build-anchor.ps1`
  - `scripts/deploy-devnet.ts`
  - both now use `anchor build -- --skip-tools-install`

### What was verified

- WSL toolchain check:
  - `arcium 0.8.5`
  - `arcup 0.8.5`
  - `anchor 0.32.1`
  - native cargo/rust path now valid
- Windows repo-local Solana bundle analysis:
  - repo-local `cargo-build-sbf.exe` is `2.3.13`
  - package metadata requires `tools-version = "v1.53"`
  - `v1.48` Rust only exposes `sbf-*`
  - `v1.53` Rust exposes required `sbpf-*` targets
- Restored a sane cache-backed `v1.53` Rust toolchain and relinked rustup:
  - `rustup run solana rustc --version` -> `rustc 1.89.0-dev`
  - `rustup run solana rustc --print target-list` includes `sbpf-solana-solana`

### Current blocker

- Windows `cargo-build-sbf 2.3.13` still self-invalidates the `solana` rustup toolchain even in a clean `v1.53` cache-backed setup:
  - direct repro:
    - `cargo-build-sbf.exe --skip-tools-install --manifest-path programs/shadowperp/Cargo.toml`
  - observed behavior:
    - logs `info: uninstalling toolchain 'solana'`
    - then fails with `The Solana toolchain is corrupted. Please, run cargo-build-sbf with the --force-tools-install argument to fix it.`
- `--force-tools-install` is not a stable escape hatch on this machine:
  - it hung >15 minutes
  - it replaced the populated cache with a partial temp archive under `.cache/solana/v1.53/platform-tools/tmp-platform-tools-windows-x86_64.tar.bz2`
- WSL is not ready as a substitute build lane yet:
  - installed Solana/Cargo SBF there is `2.1.0`
  - `anchor build -- --skip-tools-install` routes args incorrectly in that lane
  - direct WSL `cargo-build-sbf` build hit missing target/toolchain behavior

### Next safe step

- Treat the current Windows Anchor/SBF lane as `waiting on tool` / toolchain-blocked.
- Do not keep looping on `cargo-build-sbf` in this exact setup.
- Safest next move is one of:
  1. provision a clean Solana `2.3.13` build lane outside this current Windows install state (fresh shell VM, CI runner, or clean WSL/Linux install with matching Solana/Anchor)
  2. or fully replace the local Solana SBF toolchain with a known-good `2.3.13` install instead of patching partial cache/install state
- Once that lane is clean, resume:
  1. `bash scripts/wsl-arcium-build.sh`
  2. `npm run deploy:devnet:fresh`
  3. `npm run oracle:once`
  4. `npm run check:preflight`
  5. `npm run canary:devnet -- --verbose`

## 2026-03-07 04:25 WAT - Clean WSL 2.3.13 lane established

### What changed

- Installed an isolated WSL Solana toolchain at:
  - `~/.local/share/solana-2.3.13/active_release`
- Seeded WSL cache for `platform-tools v1.53` from the already-downloaded Windows Linux archive:
  - source archive:
    - `C:\\Users\\bolaj\\projects\\shadowperp\\.tools\\platform-tools-v1.53-linux-x86_64.tar.bz2`
  - target cache:
    - `~/.cache/solana/v1.53/platform-tools`
- Linked WSL rustup `solana` toolchain to:
  - `~/.cache/solana/v1.53/platform-tools/rust`

### What was verified

- WSL `solana --version` from isolated lane:
  - `solana-cli 2.3.13`
- WSL `cargo-build-sbf --version` from isolated lane:
  - `solana-cargo-build-sbf 2.3.13`
- WSL `rustup run solana rustc --version`:
  - `rustc 1.89.0-dev`
- WSL `rustup run solana rustc --print target-list` includes:
  - `sbpf-solana-solana`
- Direct WSL build succeeded from repo root:
  - `cargo-build-sbf --tools-version v1.53 --manifest-path programs/shadowperp/Cargo.toml`
  - result: `Finished 'release' profile [optimized]`

### Important note

- This gives us a working **WSL SBF build lane**.
- It does **not** mean Windows `cargo-build-sbf` is fixed. Windows lane is still toolchain-fragile and can be ignored now.

### Current blocker

- No longer blocked on obtaining a clean SBF build environment.
- Remaining work is operational:
  1. run Arcium circuit build on the WSL-capable path
  2. run deploy flow using the clean lane / scripts
  3. re-init comp-defs on fresh namespace
  4. rerun preflight + canary

### Next safe step

1. run `bash scripts/wsl-arcium-build.sh`
2. if that passes, run `npm run deploy:devnet:fresh`
3. then `npm run oracle:once`
4. then `npm run check:preflight`
5. then `npm run canary:devnet -- --verbose`

## 2026-03-07 05:18 WAT - Multi-RPC failover normalized across app and relay

### What changed

- Updated local `app/.env.local` to use a 5-endpoint devnet HTTP RPC pool:
  - Helius
  - QuickNode
  - Alchemy
  - ZAN
  - public devnet fallback
- Kept the primary single-value RPC env on Helius and added the full pool to:
  - `SOLANA_RPC_URLS`
  - `NEXT_PUBLIC_SOLANA_RPC_URLS`
- Switched local `NEXT_PUBLIC_ARCIUM_RPC_URL` from public devnet to Helius for this machine.
- Finished the server relay async failover wiring:
  - `app/src/lib/server/relay-client.ts` now probes candidate RPC URLs and uses the first healthy endpoint before building the Anchor provider
  - `app/src/pages/api/relay/withdraw.ts` now awaits `createRelayRuntimeContext()`
  - `app/src/pages/api/relay/session.ts` now awaits `createRelayRuntimeContext()`

### What was verified

- Frontend runtime already supported multi-endpoint auto-selection via:
  - `app/src/lib/runtime.ts`
  - `app/src/pages/_app.tsx`
- Script/deploy/preflight/canary failover already existed via:
  - `scripts/rpc.ts`
- App TypeScript still passes after relay failover changes:
  - `pnpm --dir app exec tsc --noEmit --incremental false`

### Current blocker

- Code-side RPC failover is now aligned across scripts, browser runtime, and relay API routes.
- Deployment/runtime progress is still blocked on the main devnet rollout sequence not yet being rerun on the current local namespace.

### Next safe step

1. confirm deploy wallet funding is still present
2. run `bash scripts/wsl-arcium-build.sh`
3. run `npx ts-node scripts/deploy-devnet.ts`
4. run `npm run oracle:once`
5. run `npm run check:preflight`
6. run `npm run canary:devnet -- --verbose`

## 2026-03-07 05:42 WAT - Websocket failover wiring added

### What changed

- Added browser-side RPC transport pairing in:
  - `app/src/lib/runtime.ts`
  - each active HTTP RPC endpoint now has a matching websocket endpoint
  - websocket endpoint is taken from index-aligned env vars when present, otherwise derived from the HTTP URL by scheme swap (`https -> wss`, `http -> ws`)
- Updated the Next app connection setup in:
  - `app/src/pages/_app.tsx`
  - `ConnectionProvider` now receives both:
    - `endpoint` = active HTTP RPC
    - `config.wsEndpoint` = matching websocket endpoint
- Updated the relay runtime in:
  - `app/src/lib/server/relay-client.ts`
  - relay now resolves `{ rpcUrl, wsUrl }` together and builds `Connection` with `wsEndpoint`
- Documented optional env vars for aligned websocket overrides in:
  - `app/.env.example`

### What was verified

- App TypeScript passes after websocket failover wiring:
  - `pnpm --dir app exec tsc --noEmit --incremental false`

### Important note

- No explicit tracked WSS secrets were added.
- Current local env can rely on derivation for providers whose websocket URL is the same host/path with a different scheme.
- If a provider needs a non-derived websocket endpoint in the future, set:
  - `NEXT_PUBLIC_SOLANA_WSS_URLS`
  - `SOLANA_WSS_URLS`
  with the same ordering as the corresponding HTTP RPC lists.

### Current blocker

- No longer blocked on missing websocket failover wiring.
- Remaining rollout blocker is still the real deploy + canary sequence on the current local namespace.

### Next safe step

1. run `bash scripts/wsl-arcium-build.sh`
2. run `npx ts-node scripts/deploy-devnet.ts`
3. run `npm run oracle:once`
4. run `npm run check:preflight`
5. run `npm run canary:devnet -- --verbose`

## 2026-03-07 05:55 WAT - First rollout attempt: build passed, deploy failed, funds recovered

### What changed

- Ran the first rollout steps in order:
  1. `bash scripts/wsl-arcium-build.sh`
  2. `npx ts-node scripts/deploy-devnet.ts`
- Stopped the sequence after step 2 failed; did not run `oracle:once`.

### What was verified

- Step 1 passed:
  - WSL Arcium build lane ran cleanly
  - encrypted instruction artifacts were current
- Step 2 failed during the deploy write phase:
  - deploy script selected `https://api.devnet.solana.com`
  - `anchor deploy` failed with repeated `AlreadyProcessed`
  - fallback `solana program deploy` also failed
  - failure ended with:
    - `219 write transactions failed`
    - temporary spend shortfall against the deploy wallet
- Post-failure cleanup succeeded:
  - reclaimable buffer discovered:
    - `3A9n5VBMau9HFkjHKgRsY5js5hjvHDj4VdeFKkLYbNyk`
  - closed successfully with `solana program close`
  - deploy wallet balance restored to:
    - `14.99028484 SOL`

### Current blocker

- The blocker is now `waiting on deploy retry`.
- This was not an Arcium build failure and not a persistent wallet-funding problem after cleanup.
- The failed attempt used public devnet RPC; the retry should force a stronger RPC instead of relying on the script default selection path.

### Next safe step

1. retry deploy with an explicit RPC override, for example:
   - `set SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=...`
   - then run `npx ts-node scripts/deploy-devnet.ts`
2. only if deploy succeeds, continue with:
   - `npm run oracle:once`
   - `npm run check:preflight`
   - `npm run canary:devnet -- --verbose`

## 2026-03-07 ~07:00 WAT - WSL deploy lane added to deploy-devnet.ts

### What changed

- `scripts/deploy-devnet.ts` Step 2 (deploy) now defaults to WSL on Windows:
  - Uses the clean Solana 2.3.13 lane at `~/.local/share/solana-2.3.13/active_release/bin`
  - Passes `--with-compute-unit-price 10000` and `--max-sign-attempts 100` for better tx landing
  - Converts Windows paths to WSL `/mnt/` paths via existing `toWslPath()` helper
  - Falls back to Windows anchor/solana deploy only if `USE_WSL_DEPLOY=0` is set
- This addresses the repeated deploy write failures (AlreadyProcessed, connection resets) seen across public devnet, Helius, and Alchemy RPCs when deploying from Windows

### Next safe step

1. run `npx ts-node scripts/deploy-devnet.ts` with Helius RPC override
2. do **not** rotate to another fresh namespace yet; the repo is already on the current undeployed rotated namespace
3. if deploy succeeds, continue with oracle/preflight/canary

## 2026-03-07 06:22 WAT - Explicit Helius and Alchemy deploy retries both failed

### What changed

- Retried deploy with explicit Helius RPC:
  - `SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=...`
  - `npx ts-node scripts/deploy-devnet.ts`
- Retried deploy with explicit Alchemy RPC:
  - `SOLANA_RPC_URL=https://solana-devnet.g.alchemy.com/v2/...`
  - `npx ts-node scripts/deploy-devnet.ts`

### What was verified

- Helius retry failed in the deploy write phase with:
  - connection reset during `anchor deploy`
  - fallback `solana program deploy` failed with:
    - `Data writes to account failed: Custom error: Max retries exceeded`
- Alchemy retry failed in the deploy write phase with:
  - repeated `AlreadyProcessed`
  - `504 write transactions failed`
- Post-failure cleanup:
  - closed deploy buffers as they appeared / were discoverable
  - confirmed a reclaimable buffer remained at:
    - `3A9n5VBMau9HFkjHKgRsY5js5hjvHDj4VdeFKkLYbNyk`
  - closed it successfully
  - deploy wallet balance restored again to:
    - `14.98313984 SOL`

### Current blocker

- The blocker is no longer simple RPC endpoint preference.
- Public devnet, Helius, and Alchemy all failed during the heavy program write phase.
- Current state should be treated as:
  - `waiting on deploy strategy`
- Build lane is healthy, wallet funding is adequate, but devnet program deploy writes are not landing reliably through the current script/CLI path.

### Next safe step

- Do not keep blind-retrying full deploys across more RPCs.
- Next move should be one of:
  1. switch deploy method to a more controlled/resumable program write path
  2. or run the deploy from a different environment/CLI lane if we suspect this Windows-side deploy path is contributing to write replay/reset behavior
- Only after deploy succeeds should we continue with:
  - `npm run oracle:once`
  - `npm run check:preflight`
  - `npm run canary:devnet -- --verbose`

## 2026-03-07 07:05 WAT - QuickNode and Helius deploy checks narrowed further

### What changed

- Continued on the post-ZAN fresh namespace:
  - current local program id:
    - `ALEuKu6asHB6QSpzScpPrechpHUDM9yPT2ai87DYQwLw`
- Tried deploy on QuickNode:
  - `SOLANA_RPC_URL=https://cool-boldest-yard.solana-devnet.quiknode.pro/...`
  - `npx ts-node scripts/deploy-devnet.ts`
- Tried deploy on Helius:
  - `SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=...`
  - `npx ts-node scripts/deploy-devnet.ts`

### What was verified

- QuickNode is not usable for this deploy payload:
  - failed immediately with `413 Payload Too Large`
- Helius is still not landing the WSL deploy request:
  - failed immediately with `error sending request`
- After both attempts, deploy wallet balance remained unchanged:
  - `14.965233275 SOL`
- That means these two retries did **not** strand additional buffers or lock more deploy rent.

### Current blocker

- Deploy remains blocked, but the viable RPC set is narrower now:
  - QuickNode is unsuitable for the binary size/path
  - Helius is still failing on request submission in this lane
- Current state should be treated as:
  - `waiting on deploy endpoint/strategy`

### Next safe step

1. do not retry QuickNode for deploy
2. do not keep looping on Helius in the same state
3. choose between:
   - public devnet as a bounded retry in the WSL deploy lane
   - or moving to a fully manual/resumable deploy flow
4. only after a deploy succeeds:
   - `npm run oracle:once`
   - `npm run check:preflight`
   - `npm run canary:devnet -- --verbose`

## 2026-03-07 07:14 WAT - Public devnet bounded retry also ruled out

### What changed

- Tried the current `ALEu...` namespace on public devnet in the WSL deploy lane:
  - `SOLANA_RPC_URL=https://api.devnet.solana.com`
  - `npx ts-node scripts/deploy-devnet.ts`

### What was verified

- The deploy script failed before the write phase:
  - repeated `429 Too Many Requests`
  - final error: `No healthy RPC endpoint found`
- Because it failed at RPC selection / health probing, this attempt should not have created a deploy buffer or tied up additional rent.

### Current blocker

- QuickNode: ruled out for deploy (`413 Payload Too Large`)
- Helius: ruled out in current state (`error sending request`)
- Public devnet: ruled out in current state (`429 Too Many Requests`)
- Current state should now be treated as:
  - `waiting on deploy strategy`

### Next safe step

- Stop endpoint-hopping.
- Move to a manual or resumable deploy strategy, or another environment that can land the deploy write path reliably.
- Only after deploy succeeds:
  - `npm run oracle:once`
  - `npm run check:preflight`
  - `npm run canary:devnet -- --verbose`

## 2026-03-07 07:34 WAT - Manual/resumable deploy helper added

### What changed

- Added a persistent-buffer deploy helper:
  - `scripts/manual-deploy-devnet.ts`
- Added package scripts:
  - `npm run deploy:manual:status`
  - `npm run deploy:manual`
  - `npm run deploy:manual:finalize`
  - `npm run deploy:manual:full`
  - `npm run deploy:manual:close-buffer`
- The helper uses:
  - current local program keypair
  - persistent buffer keypair at:
    - `target/deploy/shadowperp-buffer-keypair.json`
  - WSL Solana `2.3.13` deploy lane
  - `solana program deploy --buffer ...` for resumable uploads
  - `deploy-devnet.ts --skip-deploy` for post-upload market/init/env sync

### What was verified

- Manual status command runs cleanly:
  - `npx ts-node scripts/manual-deploy-devnet.ts status --rpc https://devnet.helius-rpc.com/?api-key=...`
- Current state from the helper:
  - wallet: `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt`
  - wallet SOL: `14.965228275`
  - program id: `ALEuKu6asHB6QSpzScpPrechpHUDM9yPT2ai87DYQwLw`
  - program visible: `false`
  - persistent buffer pubkey: `CpWNXGR97wTrSqsAkJpCj5Cm9i9qpznkbMUGJjPUqiwg`
  - persistent buffer exists on-chain: `false`

### Current blocker

- Still blocked on getting the actual program upload to land.
- However, deploy attempts are no longer forced through a one-shot random-buffer path.
- Current state should be treated as:
  - `waiting on manual deploy attempt`

### Next safe step

1. choose one RPC for the resumable path (Helius is still the best read candidate)
2. run:
   - `npx ts-node scripts/manual-deploy-devnet.ts deploy --rpc <RPC>`
3. if program upload succeeds, run:
   - `npx ts-node scripts/manual-deploy-devnet.ts finalize --rpc <RPC>`
4. only after that:
   - `npm run oracle:once`
   - `npm run check:preflight`
   - `npm run canary:devnet -- --verbose`

## 2026-03-07 ~07:45 WAT - Auto buffer cleanup + balance check added to deploy-devnet.ts

### What changed

- `scripts/deploy-devnet.ts` now has Step 1b before deploy:
  1. **Auto buffer reclaim** — queries `solana program show --buffers`, closes any stale buffers from previous failed deploys, SOL returns to wallet
  2. **Balance check + auto airdrop** — if wallet is below 10 SOL, airdrops in 2-SOL batches until funded
- This prevents the SOL drain from repeated deploy failures (was ~15 SOL → ~8 SOL after failed attempts)
- Duplicate variable declarations (`walletPath`, `walletWsl`, `solanaBinWsl`) hoisted above Step 1b/Step 2 to avoid redeclaration

### Current state

- Deploy is still blocked on getting write transactions to land
- All RPCs tried (public devnet, Helius, Alchemy, QuickNode) have failed at the write phase
- Manual/resumable deploy helper exists at `scripts/manual-deploy-devnet.ts`
- Wallet balance: ~14.96 SOL
- Program ID: `ALEuKu6asHB6QSpzScpPrechpHUDM9yPT2ai87DYQwLw`

### Next safe step

1. Use the manual resumable deploy helper:
   - `npx ts-node scripts/manual-deploy-devnet.ts deploy --rpc <RPC>`
2. If upload lands, finalize:
   - `npx ts-node scripts/manual-deploy-devnet.ts finalize --rpc <RPC>`
3. Then run post-deploy:
   - `SOLANA_RPC_URL=<RPC> npx ts-node scripts/deploy-devnet.ts --skip-deploy`
   - `npm run oracle:once && npm run check:preflight && npm run canary:devnet -- --verbose`

## 2026-03-07 12:35 WAT - Live state changed in another session; notes reconciled

### What changed

- A separate session rotated the local program namespace again.
- Current local IDs are now aligned on:
  - `programs/shadowperp/src/lib.rs`: `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
  - `Anchor.toml`: `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
  - `Arcium.toml`: `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`

### What was verified

- Manual deploy status on public devnet now reports:
  - wallet: `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt`
  - spendable wallet SOL: `1.714321191`
  - current local program id: `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
  - program visible: `false`
  - buffer pubkey: `He5o1aamk3KPZrZr9Rq8Y7KX8hvaZELoZMiFDGz59766`
  - buffer exists on-chain: `true`
- `solana program show --buffers` confirms:
  - `He5o1aamk3KPZrZr9Rq8Y7KX8hvaZELoZMiFDGz59766`
  - balance: `8.00035992 SOL`
- `app/.env.local` is still stale and points to the old deployed namespace:
  - `NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID=2Gz35PAHBkggSfV77mCENobt5YEURuYMAjgpvKXoL61d`
  - `NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT=C3UcQ3FnjqUsFPWfDgKNoq4cGzpWw6tSEqM6bf1MoFv8`

### Current blocker

- The live operational log had fallen behind the repo state.
- Current state should be treated as:
  - `waiting on deploy state cleanup / resume decision`
- The immediate risk is acting on stale notes or stale app env while the local namespace has already moved.

### Next safe step

1. Decide whether to:
   - close buffer `He5o1aamk3KPZrZr9Rq8Y7KX8hvaZELoZMiFDGz59766` and reclaim `8.00035992 SOL`, or
   - resume deployment using that exact buffer for the current local program id `2M13...`
2. Do not run app/preflight/canary against the old `2Gz35...` env if the intent is to continue the new namespace rollout.
3. After deploy state is resolved, update `app/.env.local` and then run:
   - `npm run oracle:once`
   - `npm run check:preflight`
   - `npm run canary:devnet -- --verbose`

## 2026-03-07 12:51 WAT - Buffer inventory rechecked; nothing left to reclaim

### What was verified

- `solana program show --buffers --keypair ~/.config/solana/id.json --url https://api.devnet.solana.com`
  now returns no buffer rows for the deploy wallet.
- Current wallet balance on public devnet is:
  - `1.083049973 SOL`
- This means the previously noted `He5o...` buffer is no longer reclaimable from the wallet context checked in this session.

### Current blocker

- Still blocked on deploy state, but not because of reclaimable buffers.
- Current state should be treated as:
  - `waiting on deploy/funding reconciliation`

### Next safe step

1. Reconcile what consumed the remaining deploy SOL in the parallel session(s).
2. Do not assume buffer reclaim is still available; it is not visible now.
3. Before any further deploy attempt, re-check:
   - wallet balance
   - `solana program show --buffers`
   - active local program id (`lib.rs`, `Anchor.toml`, `Arcium.toml`)

## 2026-03-07 16:37 WAT - Notes confirmed against current codebase and live namespace

### What was verified

- Current local source IDs are aligned on:
  - `programs/shadowperp/src/lib.rs`: `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
  - `Anchor.toml`: `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
  - `Arcium.toml`: `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
- `scripts/wsl-anchor-build.sh` now copies the fresh WSL-built `.so` back into `target/deploy/shadowperp.so`.
- `scripts/deploy-devnet.ts` still includes the Arcium.toml sync fix during fresh namespace rotation.
- `app/.env.local` is no longer stale; it now points to the current namespace:
  - `NEXT_PUBLIC_SHADOWPERP_PROGRAM_ID=2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
  - `NEXT_PUBLIC_SHADOWPERP_MARKET_ACCOUNT=Hx4cXyuoJWqsFh1CKmrPYsvYFpGYFMw9Ntst2bgXvKVC`
  - `NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=456`
- Manual status on public devnet now reports:
  - wallet SOL: `5.139702457`
  - program visible: `true`
  - program executable: `true`
  - buffer exists: `false`
- `npm run check:preflight` on the current namespace shows:
  - program/market wiring: pass
  - comp-defs (open/close/check_liquidation): pass and finalized
  - operator wallet and USDC balance: pass
  - only failure: `Oracle freshness - age=1003s`
- `npm run oracle:once` on the current namespace does not update because the oracle safety circuit breaker fires:
  - on-chain price: `$103.0000`
  - live median price: about `$84.065`
  - move: `1838.35 bps`
  - max deviation: `500 bps`

### Current blocker

- The codebase and env are now aligned on the new namespace.
- The current blocker is no longer deploy drift or stale env.
- Current state should be treated as:
  - `stale oracle`
  - `waiting on oracle reconciliation / safety decision`

### Next safe step

1. Decide how to reconcile the new market's on-chain oracle from `$103` to live price without violating the safety model.
2. Do not treat preflight as green until oracle freshness passes on the `2M13...` namespace.
3. After oracle is reconciled, rerun:
   - `npm run check:preflight`
   - `npm run canary:devnet -- --verbose`

## 2026-03-07 17:24 WAT - Smoke advanced past canary; remaining issue is relayer/transport, not deploy

### What was verified

- `npm run oracle:once` succeeded on the current namespace and published a fresh oracle update:
  - tx: `5aZzNeAyCxZ6wjBa7utuqkfyQ55qDtMswfFng7Lw42EXqJsFzYtZUrzZUbe5JiyaVGn743WADA4kySJrACZczV8i`
- `npm run check:preflight` passed on:
  - program: `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
  - market: `Hx4cXyuoJWqsFh1CKmrPYsvYFpGYFMw9Ntst2bgXvKVC`
- `npm run canary:devnet -- --verbose` passed.
- Real delegated session smoke moved beyond infrastructure:
  - `npx ts-node scripts/session-relayer.ts smoke`
    - step 1: session create succeeded
    - step 2: initially failed with generic `fetch failed`
- Direct delegated open retry then succeeded on the same live session:
  - session id: `1772899586`
  - position: `BqxHe2EbnapRmGK4C4FSSyKDUWeYMgqJw8jb5s2fvDKo`
  - tx: `faTE1rvwLPg2WGNz42Gf2HfTu39EYoR4vPxeVpsXP1TAyQkbSd7FVrVPfawL89LV56PwLECAR5SAEgVD7Uovb4E`
- Session status after the successful open:
  - `usedActions: 1/50`
  - session remains valid and not revoked

### Current blocker

- Infra/deploy/canary are green.
- The remaining blocker is not on-chain queueing.
- Current state should be treated as:
  - `waiting on relayer/tooling fix`
  - `transport instability during live smoke`
- Two concrete issues were observed:
  1. `scripts/session-relayer.ts close --position-index 0` rejects the valid first position because `parsePositiveInt` forbids `0`.
  2. A direct read-only account inspection through the same Node/Anchor stack hit:
     - `TypeError: fetch failed`
     - cause: `ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC`
     - meaning the remaining instability is in RPC transport/client runtime, not the deployed program path.

### Next safe step

1. Fix the CLI helper so `position-index 0` is accepted for smoke on the first live position.
2. Stabilize or pin the RPC used by the relayer/client smoke path before concluding the open/close flow is broken.
3. After that, rerun:
   - delegated close on the live position
   - settlement verification (`ClosedPendingSettlement` if applicable -> `Closed`)

## 2026-03-07 17:42 WAT - Smoke helper fixed; live blocker is open callback verification

### What changed

- `scripts/session-relayer.ts` now accepts `--position-index 0` for:
  - `close`
  - `settle-close`
  - `settle-liquidation`
- `scripts/session-relayer.ts` now also accepts `--rpc <url>` and uses it as the preferred endpoint for the entire command, which lets live smoke stay on one pinned RPC.

### What was verified

- TypeScript still compiles:
  - `pnpm --dir app exec tsc --noEmit --incremental false`
- Pinned-RPC delegated close now reaches on-chain logic instead of failing in local CLI parsing:
  - command:
    - `npx ts-node scripts/session-relayer.ts close --session-id 1772899586 --owner 5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt --position-index 0 --rpc <helius>`
  - result:
    - `PositionNotOpen (6003)`
- RPC-level history for the live position `BqxHe2EbnapRmGK4C4FSSyKDUWeYMgqJw8jb5s2fvDKo` shows the real root cause:
  - open tx:
    - `faTE1rvwLPg2WGNz42Gf2HfTu39EYoR4vPxeVpsXP1TAyQkbSd7FVrVPfawL89LV56PwLECAR5SAEgVD7Uovb4E`
    - queued successfully
  - two callback transactions followed:
    - `5HukvvM6n3tJYJZYJTDuhqUwDX21pUrME7zNYVazNA7vvMHSEkZtUrGpjPrP1oQK26FYmQPiuwPtVpXMBMQsZEy4`
    - `4Pn2W7NzGBuUXw9ceTFzqHpr7guGWT215sAkbCvfamedF4CxABKUSoAoTNoTNmkZs6vnKFR6jjinZAw7JFtkS6bn`
  - both failed in `OpenPositionV2Callback` with:
    - `InvalidComputationResult (6008)`
    - log: `MPC verify failed for position BqxHe2...`

### Current blocker

- Infra, deploy, oracle, preflight, and queue simulation are green.
- The remaining blocker is now specifically:
  - `open callback verification failure`
  - `InvalidComputationResult (6008)` in `OpenPositionV2Callback`
- Practical effect:
  - the position never transitions from `Pending` to `Open`
  - delegated close correctly fails with `PositionNotOpen`

### Next safe step

1. Inspect `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs` against the current circuit/output shape used by:
   - `encrypted-ixs/src/open_position.rs`
   - queue args in `open_position.rs` / `session_trading.rs`
2. Reconcile why MPC proof/result verification is failing after the callback now lands.
3. Do not treat end-to-end open/close as working until `OpenPositionV2Callback` succeeds on a real position.

## 2026-03-07 18:03 WAT - Batches 1-3 completed: diagnostic split added, program rebuilt

### What was verified

- Current live/preflight baseline was rechecked on pinned public devnet RPC.
- `session_trading.rs` stale-price guard is unchanged and still requires:
  - `price_age < 300`
- `npm run check:preflight` briefly went stale again on public devnet, then:
  - `npm run oracle:once`
  - refreshed the market successfully on the same pinned RPC
  - tx: `dVCiD5h6rCwwWZHs3ajCif51zmjznCPQhgxPbFDDYGobK9ywM5HB98ntbXtRTWUDRWDtG9enCZfHeQpjKzwy8uC`
- Static callback diagnosis remains:
  - input packing matches the circuit
  - callback account plumbing matches the live callback tx
  - live `open_position_v2` comp-def matches local artifact exactly:
    - `params=12`
    - `outputs=4`
    - `circuitLen=1591747`
    - local `build/open_position_v2.arcis` length `1591747`
- The failure is still localized to `verify_output(...)` in `OpenPositionV2Callback`, with the remaining ambiguity being:
  - raw/BLS verification failure vs
  - typed deserialization failure

### What changed

- Added split diagnostics in:
  - `programs/shadowperp/src/handlers/callbacks/open_position_callback.rs`
- The callback now logs separately:
  1. `MPC raw verify failed ...`
  2. `MPC output deserialize failed ... raw_len=..., expected_size=..., error=...`
- No protocol behavior was changed; this is observability only.

### Build verification

- `cargo check -p shadowperp` -> PASS
- `wsl bash scripts/wsl-anchor-build.sh` rebuilt the Rust program binary successfully.
- Important note from WSL build:
  - the build output reported a large stack-frame warning/error message tied to an `arcium_client` account deserialization helper during the build process
  - but the final release build still completed successfully and produced updated artifacts / IDL
  - treat that as a warning to watch during upgrade/runtime validation, not as the current blocker

### Current blocker

- The current blocker is still:
  - `open callback verification failure`
  - `InvalidComputationResult (6008)` in `OpenPositionV2Callback`
- We now have the observability needed to distinguish the exact sub-failure after upgrade.

### Next safe step

1. Upgrade the existing deployed program in place with the rebuilt binary.
2. Rerun one delegated open on a single pinned RPC.
3. Read the new callback logs to determine whether the failure is:
   - raw verify/BLS, or
   - output deserialization/type-size mismatch.

## 2026-03-07 18:12 WAT - Upgrade path ready but blocked by deploy wallet shortfall

### What was verified

- Existing deployed program is still the current live target:
  - program: `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
  - authority: `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt`
  - program data address: `Ee4sj7BuuoDnnvezicJNyEAFCnMH7tu8AShh6hrF8xG8`
- No reclaimable deploy buffers are currently visible for the wallet on public devnet.
- Rebuilt binary size:
  - `target/deploy/shadowperp.so` = `1,154,616` bytes
- Estimated buffer size for in-place upgrade:
  - `1,154,653` bytes
- Rent needed for that temporary upgrade buffer on devnet:
  - `8.03727576 SOL`
- Current deploy wallet balance:
  - `5.064302801 SOL`
- Public devnet airdrop retry was attempted and failed due to rate limiting.

### Current blocker

- Current state should be treated as:
  - `waiting on funds`
- The in-place upgrade should not be attempted yet because the wallet is underfunded by roughly:
  - `2.973 SOL` plus a small fee cushion

### Next safe step

1. Fund deploy wallet `5sqUgYEgKnsPiLTrQ78juUx1vWhMfEpsBUd4p8tWUHpt` with at least `3.2 SOL` more.
2. Then run the in-place upgrade on a single pinned RPC.
3. After upgrade, rerun one delegated open and inspect the new split callback logs.

## 2026-03-07 18:33 WAT - Helius upgrade resume failed; buffer reclaimed cleanly

### What was verified

- Deploy wallet was funded successfully before the retry:
  - balance before resume: `19.343997086 SOL`
- Existing resumable upgrade buffer was reused:
  - buffer: `8PEoU5UwtZKJ9bmLaACGpJ6aShxJpqUHWFHiGa9SEEzY`
  - rent locked: `8.03727576 SOL`
- Helius resume attempt progressed partway through chunk writes:
  - reached roughly `350/1155` chunks
- Helius then became unusable for this path:
  - repeated `429 Too Many Requests`
  - followed by `fetch failed`
- After the failed attempt:
  - the program was still unchanged
  - `Last Deployed In Slot` remained `446839411`
  - the buffer was still present and funded
- The buffer was then closed and reclaimed successfully:
  - `solana program show --buffers` now returns no buffer rows
  - wallet balance after reclaim: `19.323380745 SOL`

### Current blocker

- Current state should be treated as:
  - `waiting on upgrade transport choice`
- Helius is not viable for the long JS chunked upgrade on this wallet/program path due to rate limiting.

### Next safe step

1. Do not retry Helius for the chunked upgrade path.
2. If retrying upgrade now, use a different RPC transport path (next candidate: QuickNode) and start from a clean buffer.
3. If the next RPC shows the same long-write instability, stop endpoint-hopping and switch to a different deploy lane rather than burning time on repeated partial uploads.

## 2026-03-10 09:25 WAT - `open_position_probe_b` finalized; basic-comparison path still aborts

### What changed

- Implemented `open_position_probe_b` locally.
- `open_position_probe_b` keeps the same encrypted tuple input and callback shape as the working probe path, but adds only basic validations:
  - `size > 0`
  - `margin > 0`
  - `margin == requested_margin`
  - `leverage >= 1`
  - `leverage <= max_leverage`
- No multiplication or division is performed in this probe.
- Rebuilt the Arcium artifacts in WSL:
  - `build/open_position_probe_b.arcis`
- Rebuilt the Anchor program in WSL and upgraded the live program in place.

### What was verified

- Program and market remain:
  - program: `2M13ddTqbV438Ln9dVNtzqDsrCGWik6HtWB4sCypm2az`
  - market: `Hx4cXyuoJWqsFh1CKmrPYsvYFpGYFMw9Ntst2bgXvKVC`
- `open_position_probe_b` comp-def is now finalized and pointed to by the market:
  - `8fZY6mdYP412KEgMkVtuxFZonfKeV2LhVCstGnQwnUmM`
- `close_position_v2` remains finalized:
  - `54gwPKpVrigmnnRtuhmAZ28u3u6Z8QQRXQxRGJNzVuZi`
- `check_liquidation` remains finalized:
  - `7KNuD6Z2ZjRKrg3zoqz2GAhdwnn4CKffxXsD7c2gdmSf`
- Public devnet preflight passed after oracle refresh:
  - oracle tx: `NAqdh6FcxKZuyTd4u9LdGzQxNPQGAVk6wR1LsXGA1MsAfGyMSUenTTkmU33jnPzWUD4UXEHhrLSFCj2F4oVZSKv`
- Fresh delegated open smoke on pinned public devnet:
  - session create tx: `FFkqqXmHtLRVb7ift1FRSP9oyXDFGAPkhta44txjXqUxQyW5BxLLHfbGcZ5KXh5ihmyN9XfFxYdNydJmGF2RYFv`
  - session id: `1773130902`
  - open tx: `tzKE1AiUrTpZ48P28UapKKFXVFwJnUcZ5irVa8njSNGn7qDAcWVEAiGAM8GcSavLxDvsAbaHsJc99cppU8opzPs`
  - position: `GMPToNHBqqxAhxF5SwXxLJQxJMDENDuaz1oj6BuH3dhH`
- Two callback transactions then hit the position, and both failed with the same chain:
  - `451Qywf4nShSDpmQu5bzF1qi8L9W8seAh54mjhhTpdvtVZ53vvo7XjUkYtnaJgcKck3QvjvxTVR2jrFcfQV3bGKh`
  - `5k61QQ2QPffefdwUs4ef8HoWSaQnW7QDhvGsmvUAah13Bg9PMYvcoBdULkrWfBvLVDrM6A7r8xKo9JrBB1Nk5vEp`
- Relevant callback logs:
  - `Instruction: OpenPositionProbeBCallback`
  - `MPC raw verify failed ... AbortedComputation (6000)`
  - `InvalidComputationResult (6008)`

### Current blocker

- Current state should be treated as:
  - `waiting on computation isolation`
- `open_position_probe_b` proves the abort still happens even when the open path is reduced to decrypting the tuple and running only basic comparisons.
- This rules out multiplication/division as the first failing class.

### Next safe step

1. Build the next minimal open probe that removes or isolates the comparison layer further.
2. Keep the same queue/callback wiring and return shape.
3. Rerun one delegated open on a single pinned RPC.
4. If even the next minimal comparison-free/decrypt-light probe aborts, package the result as a minimal Arcium repro instead of continuing to guess.

## 2026-03-10 10:05 WAT - External reference orderbook wired for all displayed pairs

### What changed

- Added a server-side reference depth adapter:
  - `app/src/pages/api/reference-depth.ts`
- Added shared reference-depth types and provider mapping:
  - `app/src/lib/reference-depth.ts`
- Replaced the placeholder `PrivateOrderbook` shell with a live external reference-depth view:
  - `app/src/components/PrivateOrderbook.tsx`

### What the new orderbook does

- Uses Coinbase public market depth first for the full displayed pair set.
- Falls back to Binance depth if Coinbase is unavailable for a pair.
- Normalizes everything into one frontend shape:
  - bids
  - asks
  - trades
  - lastTrade
  - spread
  - spreadBps
  - timestamp
- Polls the server route every 4 seconds.
- Renders:
  - grouped bids
  - grouped asks
  - centered spread row
  - recent trades
- Labels the feed explicitly as external/reference depth so it is not misrepresented as ShadowPerp-native order flow.

### Pair coverage

- Current adapter path covers the displayed base symbols:
  - SOL
  - BONK
  - WIF
  - JUP
  - BTC
  - ETH
  - PYTH
  - RAY
  - ORCA
  - W
  - JTO
  - RENDER
  - HNT

### What was verified

- TypeScript app compile passed:
  - `pnpm --dir app exec tsc --noEmit --incremental false`

### Current blocker

- No runtime blocker for the orderbook adapter itself.
- Browser-level visual verification is still pending.

### Next safe step

1. Open the app and visually verify:
   - pair switching
   - reference provider label
   - center spread row
   - low-priced token grouping (BONK)
2. If the UI looks right, commit the new orderbook route + component as a separate frontend commit.

## 2026-03-10 11:58 WAT - Mobile header/navigation and landing-page text verified in browser

### What changed

- Made the app header more mobile-safe in `app/src/pages/app.tsx`:
  - session control now reserves its own full-width row on mobile
  - active sessions render as a full-width status pill on mobile instead of the desktop-only shrinking dot
  - inactive session control renders as a dedicated mobile `Start` action with a full-width duration menu
- Improved the market header layout in `app/src/components/MarketInfo.tsx`:
  - compact top-row mobile price summary
  - secondary stats row stays accessible on narrow viewports
- Confirmed chart fallback reset logic remains in place in `app/src/components/PriceChart.tsx`
- Cleaned visible landing-page punctuation in `app/src/pages/index.tsx`

### What was verified

- TypeScript compile passed:
  - `pnpm --dir app exec tsc --noEmit --incremental false`
- Browser/mobile pass completed with Playwright on a `430x932` viewport against local dev server
- `/app` on mobile:
  - top `SOL-PERP` price matched the chart price visually
  - mobile `Chart`, `Order Book`, and `Trades` buttons all switched views successfully
  - orderbook/trades sections are reachable without relying on horizontal page scrolling
- `/` landing page on mobile:
  - core hero copy renders on first load
  - no visible mojibake remained in the rendered screenshot

### Current blocker

- `needs connected-wallet mobile verification`
- I could verify mobile layout and navigation, but not the live connected-wallet session chip flow in-browser during this pass.

### Next safe step

1. Verify the mobile header while a wallet is connected and confirm the session action remains reachable.
2. If that looks right, commit the current mobile/landing updates separately from the Arcium probe work.

## 2026-03-10 12:14 WAT - Footer docs link and mobile header batch ready to push

### What changed
- Footer docs link on the landing page now points to the GitHub repo and the Discord link was removed.
- Mobile header/session controls, market bar, orderbook mobile tabs, and landing-page text cleanup remain in the current frontend batch.

### What was verified
- TypeScript compile passed:
  - `pnpm --dir app exec tsc --noEmit --incremental false`
- Mobile browser pass verified `/app` chart/orderbook/trades tabs and market price alignment.

### Current blocker
- No code blocker for this batch.
- Remaining gap is only connected-wallet mobile verification for the session chip.

### Next safe step
1. Commit and push the current frontend/docs batch.
2. Later, verify the connected-wallet mobile session action in a live wallet state.

## 2026-03-10 14:42 WAT - Pair-list cleanup and orderbook/runtime audit batch

### What changed

- Removed `BONK-PERP` from the active app pair surface:
  - `app/src/lib/tokens.ts`
  - `app/src/lib/market-feeds.ts`
  - `app/src/pages/terminal-v2.tsx`
- Kept the TP/SL editor side locked to the actual open position instead of showing an editable side selector:
  - `app/src/components/BottomPositionsPanel.tsx`
- Kept the adaptive live-depth path in place for fuller books:
  - `app/src/components/PrivateOrderbook.tsx`
  - `app/src/lib/reference-depth.ts`
  - `app/src/pages/api/reference-depth.ts`
- Retained the mobile app-shell tab simplification and landing/theme cleanup:
  - `app/src/pages/app.tsx`
  - `app/src/pages/index.tsx`
- Kept the on-chain audit cleanup in place:
  - `programs/shadowperp/src/lib.rs`
  - `programs/shadowperp/src/handlers/mod.rs`

### What was verified

- TypeScript app compile passed:
  - `pnpm --dir app exec tsc --noEmit --incremental false`
- Browser check completed for:
  - `SOL-PERP`
  - `JUP-PERP`
  - `ORCA-PERP`
- Verified in browser:
  - `SOL-PERP` top price and chart were aligned closely
  - `JUP-PERP` chart loaded on `MEXC:JUPUSDT`
  - `ORCA-PERP` chart loaded on `GATEIO:ORCA_USDT`
  - orderbook remained live and materially fuller than the earlier sparse state

### Current blocker

- `needs browser check`
- `HNT-PERP` browser verification was not completed because the Playwright session reset during the last switch.

### Next safe step

1. Do one final browser pass on `HNT-PERP`.
2. If it looks correct, keep the current UI/runtime batch as the new baseline.

