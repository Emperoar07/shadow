# ShadowPerp Security Review

Date: 2026-05-09

Scope: repo-local review of Next.js API routes, Solana signer/faucet/oracle boundaries, secret handling, browser CSP/XSS surface, dependency audit output, and current framework advisories.

## Findings

### Fixed in this pass: gas sponsor is now fee-payer-only

Previous finding: `app/src/pages/api/sponsor-solana.ts` allowed top-level `SystemProgram`, SPL Token, ATA, Compute Budget, and the ShadowPerp program by program id only, then called `tx.partialSign(sponsor)`. An authenticated user could potentially include an allowed instruction that used the sponsor key as an instruction signer/account.

Status: fixed locally. `app/src/pages/api/sponsor-solana.ts:128` now rejects any instruction that uses the sponsor as a signer or writable account, while still allowing the sponsor to be the transaction fee payer. `app/src/pages/api/sponsor-solana.ts:248` also verifies all required signatures after sponsor signing and before broadcast.

Residual recommendation: if gas sponsorship is re-enabled beyond devnet, replace the broad program-id allowlist with exact instruction/account allowlists for the specific ShadowPerp flows that should be sponsored.

### Fixed in this pass: hosted oracle refresh no longer shares one global in-flight promise

`app/src/pages/api/oracle-refresh.ts:43` now stores in-flight refreshes by request key instead of using one global promise for all markets. `app/src/pages/api/oracle-refresh.ts:408` builds the key from market, pair, max age, and force flag. This prevents a BTC/JUP/ETH refresh request from accidentally awaiting a concurrent SOL refresh response.

`app/src/pages/api/oracle-refresh.ts:143` also accepts `FAUCET_WALLET_SECRET_KEY` as a devnet-compatible fallback feeder key because the fresh namespace uses the same operator key for faucet and oracle feeder. This avoids hosted refresh failure on the new Vercel project if `ORACLE_FEEDER_SECRET_KEY` has not been separately added yet.

### High: public signer/faucet limits can degrade to per-instance memory

The shared limiter intentionally falls back to memory when durable Redis/KV is absent and durable limits are not required (`app/src/lib/server/rate-limit.ts:60`, `app/src/lib/server/rate-limit.ts:104`). The SOL and mUSDC faucets also rely on durable state for one-time/cooldown semantics but keep local fallbacks (`app/src/pages/api/faucet-sol.ts:91`, `app/src/pages/api/faucet-sol.ts:155`, `app/src/pages/api/faucet-mock-usdc.ts:46`, `app/src/pages/api/faucet-mock-usdc.ts:222`). If production/devnet hosting disables `REQUIRE_DURABLE_RATE_LIMITS` or runs without KV, every cold start or serverless instance gets independent counters.

Impact: authenticated users can multiply requests across instances and cold starts against routes that spend server keys: `/api/sponsor-solana`, `/api/faucet-sol`, `/api/faucet-mock-usdc`, and `/api/oracle-refresh`.

Recommended fix: fail closed for all server-key spending routes unless durable rate limiting and durable claim/cooldown state are configured. Keep the memory fallback only for local development, and add a boot-time/env preflight that refuses to enable sponsor/faucet/oracle mutation endpoints without KV.

### Medium: CSP still permits broad script execution and broad outbound connections

`app/next.config.js:44` includes both `'unsafe-eval'` and `'unsafe-inline'` in `script-src`, and `app/next.config.js:48` allows `connect-src 'self' https: wss:`. This is understandable for Privy/TradingView compatibility, but it weakens the blast-radius control for any future XSS or dependency-injected script issue in a wallet app.

Recommended fix: split dev and production CSP. For production, remove `unsafe-eval`, migrate inline scripts/styles to nonces or hashes where feasible, and replace broad `https:`/`wss:` with the explicit RPC, Privy, TradingView, CEX-reference, and hosted API origins the app actually needs.

### Medium: unresolved production dependency advisories remain

`npm audit --omit=dev` currently reports high-severity production findings in both root and app installs. Root reports 7 high and 1 moderate advisories, including `bigint-buffer` via Solana/Pyth dependencies. App reports 3 high, 1 moderate, and 20 low advisories, with the high set centered on `bigint-buffer`, `elliptic` through Privy/Ethers, and `web3-core-subscriptions`. GitHub tracks `bigint-buffer` as a high-severity buffer overflow advisory (`GHSA-3gc7-fjrx-p6mg`).

Recommended fix: do not apply the suggested unsafe major downgrades blindly. Instead, pin a migration path for Solana/Pyth/Privy dependencies, remove unused Pyth/Jito transitive paths if possible, and re-run both audits after lockfile regeneration.

### Low: IP rate limits assume a trusted proxy

`getRequestIp` trusts `x-forwarded-for` as supplied by the hosting edge (`app/src/lib/server/privy-auth.ts:39`). That is reasonable on Vercel or another trusted reverse proxy, but would be spoofable on direct/self-hosted deployments.

Recommended fix: document Vercel/trusted-proxy as a deployment assumption, or make the trusted-header behavior conditional on an explicit deployment mode.

## Positive Notes

Authentication is present on the routes that matter most: faucet and history routes bind the requested Solana wallet to the authenticated Privy user, and oracle refresh requires a Privy user before reaching feeder-key signing. Secrets are also ignored by `.gitignore`, and local `app/.env.local` is not tracked.

The installed Next.js version is `15.5.15`, which is patched for the December 2025 React Server Components RCE line (`15.5.7` fixed that line) and the April 2026 Server Components DoS advisory (`15.5.15` is listed as patched).

## Verification

Commands run:

```text
git status --short --branch
rg security-sensitive patterns across app/src, scripts, programs, package files
npm audit --omit=dev --audit-level=moderate
cd app; npm audit --omit=dev --audit-level=moderate
cd app; tsc --noEmit
cd app; npm run lint -- --max-warnings=0
cargo check -p shadowperp
npx ts-node scripts/verify-markets.ts
npm run oracle:once
npm run check:preflight
git diff --check
```

External references checked:

- https://nextjs.org/blog/CVE-2025-66478
- https://github.com/advisories/GHSA-9qr9-h5gf-34mp
- https://github.com/vercel/next.js/security/advisories/GHSA-q4gf-8mx6-v5v3
- https://github.com/advisories/GHSA-3gc7-fjrx-p6mg
