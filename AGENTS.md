# ShadowPerp Agent Onboarding

This file is the required operating guide for any incoming coding agent.

## Read Order (Do Not Skip)

1. local `DEV_NOTES.md` if present, otherwise `DEV_NOTES.template.md` (current live status format, blockers, recent actions)
2. `ARCHITECTURE.md` (system boundaries and component map)
3. `DATA_FLOW.md` (execution paths and failure classes)
4. `PERP_UI_SYSTEM.md` (UI behavior and layout conventions)
5. `DESIGN_RULES.md` (non-negotiable guardrails)
6. `NO_TOUCH_LIST.md` (sensitive files to avoid during UI-only work)

## Project Goal

Ship a privacy-first perpetual DEX on Solana devnet with Arcium-powered confidential computation, stable UX, and deterministic operational runbooks.

## Current Repo Expectations

- Keep runtime and deployment paths safe by default.
- Keep docs and code aligned.
- Prefer idempotent scripts and explicit checks.
- Never assume chain state from old logs; verify live each session.

## Session Stall Policy

- Keep working context lean after the required doc pass; summarize prior findings and avoid repeatedly re-reading stale history unless something changed.
- Surface blocked states explicitly instead of silently looping. Use concrete labels such as `waiting on tool`, `need user input`, `permission denied`, `stale oracle`, or `missing env`.
- Use bounded timeouts for long-running commands. If a command stalls, stop waiting, report the stall, and retry only the smallest safe step.
- After inactivity or a hung step, prefer a targeted restart (`oracle:once`, `check:preflight`, `hosting:restart`, or a single command retry) over unbounded replanning.
- Treat these rules as mandatory for every new repo-scoped chat session. If host tooling supports stronger inactivity cancellation, use it; if not, emulate it operationally with explicit timeout and restart behavior.

## Mandatory Session Checklist

At the start of every session:

1. read local `DEV_NOTES.md` if present, otherwise `DEV_NOTES.template.md`
2. run `git status --short`
3. verify active program/market env values
4. run `npm run check:preflight`
5. if stale oracle, run `npm run oracle:once`

Before ending a session:

1. update local `DEV_NOTES.md` with:
   - what changed
   - what was verified
   - current blocker (if any)
   - next safe step
2. update relevant root docs if architecture/flow/rules changed

## Safe Command Baseline

- `npm run check:preflight`
- `npm run check:oracle`
- `npm run oracle:once`
- `npm run oracle:daemon`
- `npx ts-node scripts/init-comp-defs.ts ...`
- `npx ts-node scripts/deploy-devnet.ts ...`

## Deployment Rules

- Prefer explicit RPC URL during deploy operations.
- If deploy errors create a buffer account, close it and reclaim SOL before retry.
- Do not mix namespaces casually; if comp-def signatures changed, use fresh reset flow.
- Do not introduce localnet workflows, tests, or migration steps unless the user explicitly asks for localnet.
- Default all validation and smoke coverage to devnet-safe paths.

## Arcium/Circuit Rules

- Do not change `ArgBuilder` layout without matching circuit updates.
- Do not reinitialize finalized comp-defs unsafely.
- If signature mismatch appears, follow full rebuild/deploy/re-init sequence.

## UI Rules for Agents

- Keep privacy indicators minimal and non-redundant.
- Preserve horizontal open-position UX organization.
- Maintain chart behavior only where intended by trade context.
- Avoid introducing feature copy that contradicts privacy-by-default behavior.

## Forbidden Actions

- no plaintext secret storage in repo
- no destructive git resets unless explicitly requested
- no undocumented architecture-level changes
- no "fully live" claim without successful end-to-end open and close verification

## Single Source of Live Truth

Local `DEV_NOTES.md` is the live operational log and is intentionally not tracked publicly. `DEV_NOTES.template.md` exists only as the public structure reference. If docs disagree with code or chain state, update the local notes immediately after verification.

