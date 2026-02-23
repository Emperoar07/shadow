# ShadowPerp No-Touch List

Guardrail for UI adaptation work. These files are sensitive and should not be modified during presentation-layer changes unless explicitly requested.

## Critical Execution / Privacy Paths

- `app/src/lib/client.ts`
- `app/src/hooks/useArcium.ts`
- `app/src/lib/runtime.ts`
- `app/src/lib/create-client.ts`
- `app/src/lib/trade-automation.ts`
- `app/src/idl/shadowperp.json`

## Core Trading Data Components

- `app/src/components/TradingPanel.tsx`
- `app/src/components/PriceChart.tsx`
- `app/src/components/BottomPositionsPanel.tsx`

## On-Chain Program / Circuits

- `programs/shadowperp/src/**`
- `encrypted-ixs/src/**`
- `build/*.arcis`
- `build/*.idarc`

## Allowed For UI V2

- `app/src/components/ui-v2/**`
- `app/src/pages/app.tsx` (layout wrapper wiring only)
- `app/src/styles/**` and token-level styling updates
- docs: `DEV_NOTES.md`, `PERP_UI_SYSTEM.md`, this file

## Enforcement Rule

If a task is "UI adaptation", treat this list as immutable. Add wrappers around existing components instead of editing these files directly.
