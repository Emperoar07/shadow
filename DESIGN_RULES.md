# ShadowPerp Design Rules

These are hard rules for product, code, and operational quality.

## 1. Privacy-First Product Rules

- Privacy is default behavior, not optional marketing copy.
- Do not expose sensitive position internals in public event payloads unless strictly required.
- Keep privacy indicators minimal in the primary trading flow.
- Never store sensitive trading automation data in plaintext persistent storage.

## 2. Solana/Arcium Integration Rules

- Circuit artifacts, deployed program binary, and comp-def signatures must stay in sync.
- Any change in encrypted instruction shape requires:
  1. circuit rebuild
  2. anchor rebuild
  3. program deploy
  4. comp-def re-init/sync
  5. preflight + smoke
- Callback verification is mandatory before state mutation.
- Cluster and comp-def account bindings must be constrained to expected market config.

## 3. UI/UX Rules

- Trading panel stays compact and high signal.
- Open-position workflow order is fixed and consistent.
- Submit controls must be close to TP/SL and summary context.
- Show explicit, actionable errors for tx and network failures.
- Never silently switch to fake data without a visible warning.

## 4. RPC Reliability Rules

- Support multiple RPC endpoints (`*_RPC_URLS`) for failover.
- Scripts should probe and select healthy endpoints.
- UI should support safe endpoint switching and persist preference.
- Keep fallback behavior deterministic and observable.

## 5. Config and Secrets Rules

- Never commit real API keys, seed phrases, or private key JSON.
- Keep secrets in local env or GitHub secrets only.
- Keep `app/.env.example` updated whenever runtime vars change.

## 6. Release Safety Rules

- Required checks before declaring stable:
  1. `npm run check:preflight`
  2. `npm run check:oracle`
  3. open/close smoke success on current namespace
- If deploy fails and buffer account is created, reclaim SOL before retrying.
- Do not claim "fully live" unless open and close both succeed through MPC callbacks.

## 7. Documentation Rules

- Every meaningful change updates:
  - local untracked `DEV_NOTES.md` (live status + actions + blockers)
  - relevant onboarding docs in repo root
- Keep documentation ASCII and explicit.
- Prefer concrete addresses, script names, and file paths over vague text.

