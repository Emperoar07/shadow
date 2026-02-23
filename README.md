# ShadowPerp

Privacy-first perpetual DEX on Solana, powered by Arcium confidential computation.

## Current Status

- Network target: `Solana devnet`
- UI/runtime: active
- Oracle automation: implemented (`once`, `daemon`, canary/preflight)
- Session model: delegated session required for trading (no direct wallet-trade fallback)
- Known protocol blocker: Arcium queue path for `open_position` may fail on devnet with `AccountDidNotSerialize` (`comp` serialization path)

Do not claim fully live until end-to-end `deposit -> open -> close` passes on-chain under current deployment.

## Repository Layout

- `programs/shadowperp/` - Anchor on-chain program
- `encrypted-ixs/` - Arcium/Arcis MPC circuits
- `app/` - Next.js trading app
- `scripts/` - deploy/oracle/preflight/canary/ops scripts
- `DEV_NOTES.md` - live operational log (source of truth)
- `ARCHITECTURE.md` / `DATA_FLOW.md` / `PERP_UI_SYSTEM.md` / `DESIGN_RULES.md` - system docs

## Quick Start (Devnet)

1. Install deps

```bash
npm install
cd app && pnpm install && cd ..
```

2. Configure env

```bash
cp app/.env.example app/.env.local
# fill required NEXT_PUBLIC_* values
```

3. Run readiness checks

```bash
npm run check:preflight
npm run canary:devnet
```

4. Start local hosting stack

```bash
npm run hosting:start
npm run hosting:status
# when done
npm run hosting:stop
```

## Core Ops Commands

- `npm run check:preflight` - full runtime/account/oracle checks
- `npm run check:oracle` - oracle freshness check
- `npm run oracle:once` - one-shot oracle publish
- `npm run oracle:daemon` - continuous oracle feed
- `npm run canary:devnet` - pre-trade health check
- `npm run hosting:start|status|stop|restart` - unified local runtime control

## Security and Repo Rules

- Never commit secrets (`.env.local`, keypairs, tokens)
- Keep privacy claims aligned with verified behavior
- If live chain state differs from docs, update docs after verification

## Developer Onboarding Order

1. `AGENTS.md`
2. `DEV_NOTES.md`
3. `ARCHITECTURE.md`
4. `DATA_FLOW.md`
5. `PERP_UI_SYSTEM.md`
6. `DESIGN_RULES.md`
7. `NO_TOUCH_LIST.md`

## Deployment Notes

- Deploy + comp-def init are script-driven (`scripts/deploy-devnet.ts`, `scripts/init-comp-defs.ts`)
- Prefer explicit RPC URL during deploy/ops
- If comp-def signatures change, use fresh reset/re-init flow from `DEV_NOTES.md`

## References

- Arcium docs: https://docs.arcium.com/
- Arcium: https://www.arcium.com/
- Solana docs: https://docs.solana.com/
- Anchor docs: https://www.anchor-lang.com/
