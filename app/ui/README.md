# Chausar app, the new screens: implementation notes

This directory holds the first bounded slice of the finalized frontend design of 1 October 2026: tokens, the frame, the parts, four patterns, and Today in its three views, as React 19 strict TypeScript source with CSS Modules. It is isolated source. It is not wired into the existing plain-DOM renderer, the Electron asset allowlist or the loopback server, and no old screen is removed. Activation belongs to the coordinator after font and host journey checks. The exact scoped packages are provisioned and the isolated strict library build passes.

## What is here

| Folder | Holds |
|---|---|
| `src/tokens/` | `tokens.css` (colours, sizes, times), `type.css`, `motion.css`, `fonts.css`, `index.css` |
| `src/app/` | `presentation.ts` (the typed DTOs the screen draws), `routes.ts` (hash addresses), `places.ts` (rails and gates per shell), `keys.ts` (global keys), `plural.ts` (plural form from exact digits), `text.tsx` (react-intl wrapper), `Frame.tsx`, `Rail.tsx`, `AskLine.tsx`, `StatusLine.tsx`, `WorkspaceMenu.tsx`, `LockScreen.tsx`, `PageHeader.tsx`, `App.tsx`, `main.tsx` |
| `src/parts/` | Square, Row, RowList, Sheet, Button, Field, Choice, Label, KeyValue, Banner, Steps, DayLine, TimeLine, Figure, Stat, Strip, and `charts/` (Columns, Line, OrderedBar, marks, `scale.ts`) |
| `src/patterns/` | States, ListWithSheet, ApprovalSheet, Lens and Whose (enterprise), FirmTable (CA console) |
| `src/screens/today/` | `TodayData.ts` (contract), `Today.tsx` (Guided), `TodaySimple.tsx`, `TodayBooks.tsx`, `shared.tsx`, `fromView.ts` (a thin typed wrapper over the checked projection), `fixture.ts` (test fixture only) |
| `src/views/` | `simple.css`, `books.css`: sizes only, under `data-view` |
| `src/text/` | `en.json`, `hi.json`: every word a person reads, as complete ICU templates |

`src/bridge/`, `src/format/` and `tests/` provide the checked data boundary and executable foundation checks.

The ce5 synthesis seam adds `bridge/conversation-contract.ts`, `conversation-host.ts` and `today-host.ts`, plus `patterns/ModelConsentSheet` and `screens/ask/ConversationAnswer`. `main.tsx` also exports opt-in `mountConversationWorkspace`/`updateConversationWorkspace`. Planning and final writing have separate reviewed previews and single-use consent; continuation is an Engine-retained ID. Legacy Saved lists remain available until an explicit checked readback selection owns the answer surface. `frontend-seam-handoff.md` records the host context/selection contracts and validation limits. Source existence does not activate this renderer.

## Rules the source keeps

- **The screen only shows.** Parts receive props and call back intents. No part calls the bridge, formats a number, reads a file, holds a key, touches storage or opens the network. No component casts unknown engine data into a DTO.
- **Every known figure opens its receipt.** `onReceipt` is required on Figure, Row, RowList, Stat, every chart, KeyValue, TimeLine, DayLine, the approval sheet and Today. A known value is always a button; there is no static amount and no mark with `role="button"` that does nothing. A value that arrives without a receipt id is shown as missing words, not as an amount.
- **Missing is words.** One of the fixed words, never zero and never blank. A count that is not known keeps `exact: null` and shows its word.
- **Two controls are never one inside the other.** The control that opens a row and the control that opens its figure are separate buttons side by side, in rows, in the Books queue, on the day line and on the time line. A row that opens nothing has no row button at all.
- **Squares are hidden from screen readers** and always carry state words beside them.
- **One sheet at a time.** Focus moves to its title on opening and returns to the originating row on close. Deeper content replaces the sheet's content with a way back; sheets never stack.
- **Motion happens once.** Chart 360 ms, step 240 ms, sheet 200 ms. Receipt rows are 30 ms apart and the last has finished by 400 ms, delay and duration together. Ordinary history (TimeLine) does not stagger. Reduced motion sets every time to 0.

## The DTOs and the checked projection

`app/presentation.ts` is aligned with the bridge lane's checked contract, and imports its canonical types (`FigureLabel`, `MissingState`, `ViewState`, `Capability`, the approval kinds, states and actions) as types only.

- A known `Figure` is `money`, `count`, `percent` or `points`. There is no text figure and no guess figure.
- A figure carries `labels`, a readonly array of the seven canonical qualifications, and all of them are drawn. The broader fixed words for a statement are `StatementLabel`, passed separately (`statement`), never mixed into a figure's own labels.
- `Count` is `{ exact: string | null, display }`. It is never turned into a number. `plural.ts` picks a plural form from the exact digits (0, 1, or "any larger") for English and Hindi, while the message shows the full `display`.
- `StatTile.change` is a `FigureOrMissing` with its own receipt; `changeLabel` holds the words. `DayEvent.figure` is a `FigureOrMissing`; `note` holds a short state in words.
- `ChartValue.id` is the canonical point id. It is the React key, so a mark keeps its identity and focus across data updates. `values` arrays are readonly.
- `StatTile.chartState` is required. A stat with no chart writes the reason in the chart's place: `CHART_NOT_PROVIDED`, `CHART_FORM_NOT_IMPLEMENTED`, `CHART_HAS_NO_POINTS`, `CHART_HAS_NO_KNOWN_POINTS`, each with its own sentence in both catalogues.
- `ScreenState` has a neutral `boundary-state` variant carrying the canonical `ViewState`. It shows the fixed sentence for the state, then the supplied reason code and the supplied `asOf`, as given. It names no holder, rule owner, month count or date that was not supplied. `asOf` is shown as supplied (an ISO instant); a formatted time needs the adapter to supply one.

`screens/today/fromView.ts` no longer formats anything. It calls `projectTodayForUi` from `bridge/project-ui.ts` and assigns its `data` to `TodayData` with no cast, so the two lanes cannot drift without a type error. It returns the row and day action lists and the chart states separately, as the projection does. There is one formatter projection.

## Decisions to know about

- **Spacing tokens are `--sp1` to `--sp8`.** `--s1` to `--s3` are reserved for the three series hues. Their values were not supplied, so they are not declared, and no chart in this slice uses a hue.
- **Ordered greys.** Two steps are backed by the reference picture's pixels: the last stage is ink (`--r1` = `--fg`) and the first grey of the two-stage bar is `--r3` = `--mute` (light `#646B71`, dark `#8B9197`). `--r2` (`--fg2`) and `--r4` (`--dim`) are reconstructions for a third and fourth stage and are named so in `tokens.css`. Every stage carries a written label.
- **Chart geometry is exact before it is a number.** `charts/scale.ts` keeps values as `BigInt`, normalises them against their own domain, and converts only the bounded result. The new functions are `toExact`, `exactExtent`, `includeZero`, `exactLinear` and `exactShares`. `toNumber` now returns a value only inside the safe integer range and is not used for positions. `extent` and `linear` serve plain coordinates such as an index; finite extremes, reverse domains and subnormal spans are checked.
  - Columns share one zero baseline. A known zero has no height; a value below zero hangs from the baseline. Every bar has a transparent 24 pixel target.
  - Line draws a known point that has gaps on both sides as a small grey point.
  - OrderedBar draws a width only for a known whole value of zero or more. A missing stage is a dashed gap with its words. When a value is below zero or is not a whole number, or when every stage is zero, no share is invented: the values are written out, each still opening its receipt.
  - No total, sum or domain is returned or shown.
- **Approvals.** What the sheet offers comes from the approval's `state`, `can`, `readOnly` and `prepareOnly`; a supplied callback never makes an action available. Approve, Not now, Change and Drop exist only for a `prepared` action. Kind `money` or `needsSecondAsk`, either one, routes the press to the second ask and marks the primary `money`, so Ctrl Enter never runs it. Prepare-only has no Approve. An unknown result offers the check only when the engine offered `reconcile` for state `unknown`. Read only shows no mutation control. When every step is done the walking square rests on the last step.
- **ListWithSheet derives its sheet in the parent.** The parent calls `useListWithSheet`, passes the controller to `ListWithSheet` for the list, and builds the sheet from `controller.render` in the same render. The render-prop that handed nodes upward is gone, and nothing calls an ancestor's setter while rendering.
- **The lock screen holds no secret.** `LockScreen` has no field, no state and no callback for the passphrase or PIN. It renders `unlockControl`, a slot the trusted host fills with its own control. Until a replacement is qualified, that is the existing host unlock, mounted by the integration adapter. This source creates no credential transport and launches no native flow. Either lock state shape suppresses the frame, identity, counts and sheet. Without a trusted unlock slot, only the fixed locked sentence appears.
- **Keys.** A key release maps only to the end of hold-to-talk, and to that for Space, Ctrl or Meta coming up, so a hold ends even when Ctrl is released first. Presses are ignored while composing, when already consumed, and with a modifier the chord does not name. Esc closes the sheet from inside a field unless the field consumed it. Shift F6 with no current region starts at the last one. In the narrow bar F6 lands on the visible place menu control.
- **Voice** is absent unless supplied and off unless the supplied capability says on. One tracked hold serves the microphone and the chord. It ends on pointer release (the button captures the pointer), pointer cancel, lost capture, either key coming up, window blur, the page being hidden, voice being switched off, and unmount.
- **Places.** In Simple, More stays the current entry for Books, Reports, Tools and Trust and lists them; the narrow bar names the actual place. In the enterprise version the grant list gates places, sub-places, the place keys and incoming addresses through `placeAllowed`, `subAllowed` and `resolveAddress`. A limited role defaults to its first explicitly allowed sub-place. Empty grants yield no private surface, including Today. The CA firm has no Ask and no Books. A rail count is drawn only on Today, and on Clients in the CA firm.
- **Geometry under 480.** The sheet is as wide as its slot: 480 beside or over the list, the whole window when narrow. The narrow column pads only its sides, so the page keeps its space above and below. In Simple with Hindi a row may take two lines above its 68 pixel minimum.
- **`data-theme` is for pictures only.** The app follows the computer's colour scheme, contrast and motion settings.
- **Setup and update rows** offer Continue or Update only when the data offers it (`setup.can`, `update.can`) and the adapter supplied the callback.
- **Read only** removes retained Prepare, Continue, Update and cash-save callbacks in all three Today forms. Rows, charts, review navigation and receipt access remain available. Books close-step action controls are hidden.
- **Ctrl Enter** cancels the native Enter default whenever a sheet primary is registered, before deciding whether it may run. Money and disabled primaries cannot activate a focused native button through the shortcut.

## How the integration adapter feeds it

`App` takes `AppProps`: the shell kind and role flags, the controlled view and language, the lock state with its trusted unlock control, the workspace menu data, counts, banners, the ask line and status line data, per-place capabilities, the Today data and intents, an optional sheet `{ address, content }` bound to the exact place/sub-place/sheet it was read for, and `renderPlace` for legacy journeys that stay alive. Late or unbound sheet content is never rendered. `onAddress` receives the checked address for initial, keyboard and hash-history changes; null means lock or no access and must invalidate retained host evidence. `main.tsx` exports `mount` and `update`. Nothing mounts by itself, and nothing mounts with sample data: `fixture.ts` is labelled test-only and no app file imports it.

The address is the hash: `#/<place>[/<sub>][?sheet=<id>]`. Parsing unknown places drops foreign action context. The shell then chooses an allowed address or returns null. Sheet IDs preserve the engine's opaque underscore/UUID identity; sub-place slugs retain their separate constrained grammar.

`tsconfig.json` is strict with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `allowImportingTsExtensions` and `noEmit`. Component props that may be passed `undefined` say so (`?: T | undefined`). The DTOs do not: an optional DTO field is absent or present. Pure modules import each other with `.ts` extensions so Node can run them with type stripping.

## Verification and remaining checks

Claude authored the main source using the requested Fable 5.1 / High / Fast off settings. Coordinator lanes corrected reviewed route, lock, read-only and sheet boundaries. On 3 October the existing Claude Max session reported its weekly limit with overage disabled before making any edit; the coordinator made the narrow strict CSS-class prop correction. Styles, callbacks, choices and strict compiler settings stayed unchanged. Final results and the additive patch manifest are recorded in the handoff.

- **Exact geometry tests** exercise `toExact`, `exactExtent` and `exactLinear` for adjacent large positive/negative values, including 101-digit pairs, without weakening the precision assertion. `toNumber` is checked separately for safe-integer rejection.
- **Strict source and library build pass.** The user installed the 131 selected packages from the genuine scoped graph. Their receipt, source pins, manifests, archive hashes and ordinary tree were independently verified. A hash-verified ordinary C-local copy runs TypeScript 5.9.3 and Vite 8.3.1 without writing to the acquired D tree. Full React, foundation and interaction typechecks pass under their unchanged strict settings. The production library exports opt-in mount/update functions and does not activate the host. Local font assets are now present; browser and host acceptance remain separate.
- **Executable behavior checks pass.** A fresh run passes all 214 pure contract tests. Nine React 19.3/jsdom cases pass for Today keyboard navigation, distinct receipt controls, sheet focus return, read-only cash controls, exact cash strings, Ask submission, voice-off behavior, unknown figures and typed conversation references. Their strict test compilation also passes with `skipLibCheck:false`. These synthetic DOM checks do not qualify browser layout, live host journeys, accessibility conformance, microphone input or pixel fidelity. No contrast level is claimed.
- **Local font data and shaping pass.** Eight faces and four unchanged OFL notices are in `assets/fonts`, with immutable source and output hashes in its manifest. Their total is 300,672 bytes. All original glyphs are retained, normal weights and widths pass, and 448 Hindi strings at both weights plus English/numeric cases match the sources with zero glyph, cluster or position differences. Local fallback faces supply rupee, Hindi and arrows while retaining the original primary fonts and equal-width DM digits. Actual host loading, fallback runs, clipping and pixels are pending.
- **Hindi was written by the implementer** and is pending a native reader. Both catalogues have the same keys. Rendered ICU values, rendered button-label lengths and the reading budgets (Guided 120, wide 150, Simple 90, Books 170, sheet 110) are pending a rendered count.
- **`text/banned.txt` is not present** in the inputs, so banned terms are not checked. It was not invented.
- **Pixel comparison** against the reference pictures, in both themes and all three views, is pending.

Current engine limits the source respects and never marks live: the bridge is `window.chausar.request`, not the proposed `window.chausarEngine`; there is no chart time series and no aggregate pending count yet, so a real Today shows the chart reasons and an unknown count in words; desktop and enterprise receipts are separate; the phone endpoint is unwired and the finalized phone is headlines only.
