# ShadowPerp Developer Notes

Internal handoff notes for the next engineer. Do not publish secrets.

## Last Updated

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
- Ran a live user-facing smoke against `https://shadowperp.vercel.app`.
- Added a standing local reminder for future passes: every UI/product change should be checked on mobile as well as desktop before sign-off.

### What was verified

- Live site reachable: `https://shadowperp.vercel.app` -> HTTP `200`
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
