# ShadowPerp Perp UI System

This document defines the UI system for the trading terminal and landing flow.

## Product Surfaces

### 1. Landing

Goals:

- communicate privacy-first perpetual trading
- route user into terminal quickly
- keep branding consistent with terminal theme

### 2. Trading Terminal

Primary views:

- `Trade` view
- `Positions` / history in bottom panel

Primary components:

- market selector
- chart section
- open-position panel
- collateral modal
- open positions/history panel
- network/rpc indicator

## Layout Rules

### Trade Page

- top bar: brand, network status, wallet/rpc indicators
- main content: chart + trading controls
- positions and history: horizontal panel below trading area

### Open Position Panel

- horizontal organization preferred
- order of controls:
  1. side (long/short)
  2. order type (market/limit)
  3. size
  4. TP/SL inputs
  5. leverage controls
  6. summary metrics
  7. submit action
- submit CTA (`Open Long` / `Open Short`) sits directly under TP/SL region per product preference

## Privacy UX Policy

Default rule: privacy is on by default and should not require repeated user explanation in primary flow.

- keep privacy indicators minimal
- avoid cluttering panel with repeated privacy banners
- show detailed privacy explanations only in optional tooltips/help panes

Practical examples:

- acceptable: compact badge in header or status row
- avoid: large repeated "privacy enabled" cards near every action

## Chart Rules

- chart should be active in trade context
- avoid unnecessary chart duplication in non-trade views
- symbol mappings must be valid per selected provider
- if symbol unavailable, fallback gracefully and show actionable message

## Interaction Rules

- optimistic UI only when safe; keep clear pending states
- prevent duplicate submissions during async tx flow
- preserve user input on async failure
- show deterministic error copy (what failed + what to do next)
- do not present mock pair prices as executable market price
- label reconstructed position-history data clearly when a durable ledger is not yet available

## Visual System

Theme direction:

- dark/navy base with cyan/indigo accent family
- privacy cues are subtle and consistent
- no visual conflict between landing and terminal color systems

Typography and spacing:

- compact and high-density for desktop trading
- preserve readability on 13-15 inch laptop widths
- avoid oversized decorative elements in terminal core

## Runtime Network UX

- support multi-RPC endpoint list
- show active endpoint index as `RPC x/y`
- manual switch should be one click and persist in local storage
- endpoint switch must rebind wallet connection provider cleanly

## UI Implementation References

- `app/src/components/TradingPanel.tsx`
- `app/src/components/BottomPositionsPanel.tsx`
- `app/src/components/NetworkIndicator.tsx`
- `app/src/lib/runtime.ts`

