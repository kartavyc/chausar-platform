# Ink, Chausar's React frontend

One app for desktop (Electron) and the web, built to `app/ui/dist`. Spec: `docs/superpowers/designs/2026-10-21-chausar-frontend-ink.md`. Plan: `docs/superpowers/plans/2026-10-21-chausar-frontend-ink.md`. Visual reference: mockup A "Ink".

## Commands (from the repo root)

| Command | What it does |
|---|---|
| `npm run dev:ui` | Vite dev server on port 5178 with the fake engine (sample data, said so on screen) |
| `npm run build:ui` | Builds to `app/ui/dist` (relative paths, no inline script or style) |
| `npm run test:ui` | Vitest + jsdom + Testing Library, everything under `app/ui/tests` |
| `npm run typecheck:ui` | `tsc --noEmit` with `app/ui/tsconfig.json` (strict) |

Serving the built app: `npm run build:ui`, then `npm start -- --ink` (local server, Ink at `/`, `/api/rpc` unchanged) or Electron with `--ink`, or set `CHAUSAR_UI=ink` for either (`npm run desktop` passes the variable through). Without the switch, the old renderer stays the default.

## Structure

```
index.html, public/theme.js    page shell; theme.js sets data-theme before the first paint
assets/fonts                   7 OFL faces, notices and manifest (from the lane branch)
src/tokens                     tokens.css (spec section 5 values), fonts.css, motion.css, base.css
src/text                       en/*.json, hi/*.json (common.json plus one file per place), t() and plurals
src/engine                     types.ts (shared contract), client.ts, events.ts, context.tsx, fake.ts, fixtures.ts
src/shell                      App, Rail, BusinessMenu, routes, navigation, keys, sheets, places registry
src/parts                      Row, ApprovalRow, Change, Receipt, ModelEstimate, Button, Sheet, RunSheet, Steps,
                               JobList, EmptyState, Field, Gate, Provenance, ConnectorLabel, StatusLine, PageTitle
src/places/<place>/index.tsx   one folder per place, exporting Place (and optionally sheets)
tests                          one file per area; parts, shell, engine, text, tokens, source rules
```

## How a place plugs in

- `src/places/<place>/index.tsx` exports `Place()`. It may also export `sheets: Record<kind, SheetComponent>` for its own sheet kinds (`agent`, `client`...). `run` and `receipt` belong to the shell.
- Text goes in `src/text/en/<place>.json` and `src/text/hi/<place>.json`; every key starts with `<place>.`. The parity test fails if a key is missing in Hindi.
- Read the engine with `useResource(method, params, { refreshOn })`; act with `useEngine().request(...)`. Methods and shapes are in `src/engine/types.ts`; add a method there and to the fake when the engine gains one.
- Open a sheet with `openSheet(kind, id, originElement)`; the shell shows it beside the page and returns focus on close.
- Rows use `Row` or `ApprovalRow` inside a `<ul>`; keys J/K/Enter/A/D/Esc work on them without extra code.

## Rules (tests enforce most of them)

- Text nodes only: no `innerHTML`, no `dangerouslySetInnerHTML`.
- No inline styles at runtime (strict CSP): CSS Modules and tokens only; no colour outside `tokens.css`.
- No money arithmetic: figures arrive formatted from the engine, each with its receipt id; a model-written number says "model estimate" and never has a receipt.
- Approvals send the digest of what was shown; a stale digest shows "This changed since you opened it" and the new version.
- Nothing in browser storage. The pairing token stays in memory and leaves the address bar at once.
- Exactly one filled button per row. Keyboard A and D never act on a row that takes a second ask.
- Text at 12 px or more (13 for reading). Motion once, 400 ms or less, none with reduced motion.
- Plain words, no em dashes, no AI personality. Hindi is machine-drafted and needs a native reader.
