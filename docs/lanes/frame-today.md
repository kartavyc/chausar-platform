# Lane: frame-today

The app frame, first run, Today, the parts library, the fake engine, the UI rule checks, and the new UI as the default renderer. Branch `claude/lane-frame-today`.

Every feature below is labelled **supported** (tested end to end in the app on synthetic data: the real host on the fake engine, the real engine module on a demo workspace, or both) or **experimental** (works, but depends on something not tested here: a live service, a device, a browser layout measurement or a native reader).

## How a person uses it

- **Starting the app.** Electron and `npm start` open the new UI. A workspace that is locked shows the lock screen: one passphrase field, "Forgot it?", and the line about what pauses while locked. A new computer goes through first run: Welcome → identity card and GST mode → create the vault → recovery kit → AI model (or skip) → bring a file → agree what the words mean → the first answer with its receipt open → Today.
- **Today.** The date, "Awaiting your review" with up to four rows, "Worth a look" (review and worth rows together never more than five at rest; "See all" opens the rest), "This month" as three charts whose tiles open receipts, and "Earlier today" on one line. Simple has taller rows and today's cash; Books has the queue as a table, the waiting line, the month's close and the keys line.
- **Activity.** Today · Activity lists every step newest first, one sentence each in English or Hindi, with its state square, who acted, the model route and cost, and "read outside text" where a run read outside text. Filters by state, person and day; "Show more" pages; each line opens its proof.
- **The frame.** Banners above the page and the sheet (at most two, the rest behind "and N more"); in a demo workspace the Demo clock banner opens the clock (set once, then forward a day or a week, never back). The workspace menu holds the view, the language, Help, Lock now and About. Help lists the keys, the plain word list, and what works with no internet. The app locks itself after the idle time (10 minutes by default).
- **Legacy renderer.** Only behind `--legacy-renderer` (Electron or `node platform/runtime/server.ts --legacy-renderer`). The older `--ui-preview` flag still opens the new UI and keeps a return link.

## What was built, by build-list item

### 1. Finish the frame

| Feature | Label | Where |
|---|---|---|
| Rail, page, sheet, ask line, status line (existing), status line facts from `todayx.status` with 24 px targets, Simple's two sentences | supported | `app/Frame.tsx`, `app/status-line.ts`, `host/frame-reads.ts` |
| Banners SH-03: fixed order, at most two shown, "and N more", full width above the sheet; adapter from `todayx.shell` | supported | `parts/Banner.tsx`, `app/shell-banners.ts` |
| Demo clock control (set once, forward only, real-workspace words) | supported | `app/DemoClockControl.tsx` |
| Jobs-paused dismissal | supported | `todayx.jobsPaused.dismiss` |
| Lock screen with the trusted unlock control (`workspace.open`), wrong passphrase without a count, the field cleared at once; `controller.unlocked()` leaves the lock with a fresh read | supported | `app/LockScreen.tsx`, `host/UnlockControl.tsx`, `host/controller.ts` |
| Idle auto-lock | supported | `app/useIdleLock.ts` |
| Windows Hello / Touch ID unlock link (drawn only when the host says the device supports it) | experimental: no native provider is wired | `host/UnlockControl.tsx` |
| Workspace menu: views, languages, Help, Lock now, About, workspace list when more than one | supported (list: experimental, the engine has no workspace list) | `app/WorkspaceMenu.tsx` |
| Keyboard map (one `KEY_MAP` drives the handler and Help) | supported | `app/keys.ts` |
| Help SH-12 with offline lists from `todayx.help` | supported | `app/HelpSheet.tsx` |
| Link dialog SH-10 | supported (component; no screen opens outside links yet) | `app/LinkDialog.tsx` |
| Fault report SH-11 from `todayx.faultReport` | supported (component and method; Save/Send need the shell's file and send paths) | `app/FaultReport.tsx` |
| Not built yet SH-13 with the day and the missing part from `todayx.capabilities` | supported | `patterns/States.tsx`, `app/shell-banners.ts` |
| Narrow layout (1024–1315: rail 176, column 640, sheet over the list; under 1024: top bar; down to 360) | experimental: CSS rules, checked only at 1366 and 1024 by the policy checker | `app/Frame.module.css`, `app/Rail.module.css` |
| Reduced motion and more contrast | supported (tokens zero every time; `--line`/`--line2` swap) | `tokens/tokens.css` |

### 2. The parts library

| Part | Label |
|---|---|
| Charts: Columns, Line, OrderedBar (existing, now with arrow keys), RankedBars, Bridge (measured and guess never mixed), GoalLine, StepLine, PairBars, Strip (twelve months; failed is an amber ring), Spark, RuleBar | supported |
| Receipt (the six parts; small print shown only when supplied) and `bridge/receipt-view.ts` (engine receipt → view) | supported |
| Table (virtualized, 32 px rows, column kinds, exact sorting with BigInt, grid keyboard) | supported |
| Drawing (typed nodes and links, at most six parts, one to four words each) | supported |
| TwoSides, SettingsRows | supported |
| ApprovalSheet variants: message, record change, money (second ask), prepare-only, voucher preview (Dr/Cr), job, group ("1 of 3"), practice | supported |
| Steps, KeyValue, Banner (existing; Steps' unreached dot now meets 3:1) | supported |

### 3. First run end to end

`screens/first-run/FirstRunJourney.tsx` with the state machine in `journey.ts`. The product entry (`host/shell.js`) mounts the host with `firstRun: 'journey'`.

| Step | Engine methods | Label |
|---|---|---|
| FR-01 Welcome | none (language and view held in memory) | supported |
| FR-02 Identity card and GST mode | `todayx.identity.check`, `todayx.identity.save` (after the vault) | supported |
| FR-03 Vault, FR-04 recovery kit | `workspace.create` (via the host controller), recovery acknowledgement | supported |
| FR-05 AI model | `models.list`, `models.configure` | supported for listing and the CLI/local rows; API key rows experimental (key passes once to `models.configure`) |
| FR-07 Bring a file | `sources.preview`/`sources.import`, `sources.workbookPreview`/`sources.workbookImport` | supported for CSV and Excel; PDF and passwords not built |
| FR-06/FR-08 Meanings | `ontology.packs`, `ontology.get`, `ontology.publish` (existing slice, embedded) | supported |
| FR-09 First answer | `ontology.get`, `calculation.run`, `receipts.get` | supported |
| FR-12 Setup checklist | `todayx.setupChecklist` | supported |
| FR-13 Open with the recovery kit | `workspace.recover`, `workspace.restore` | experimental (backup picking needs the shell) |
| FR-11 An idea | none | not built (shows "not built yet") |

The real engine reads a file only after meanings are published (`DICTIONARY_REQUIRED`), so the journey holds the picked file, goes to Meanings with a line saying so, and reads it right after publication.

### 4. Today in all three views

| Feature | Label |
|---|---|
| Awaiting your review, "See all", setup and update rows | supported |
| Worth a look from `todayx.worthALook` (at most five; with review rows, five at rest) | supported |
| This month: three charts with receipts (from `today.prepareTiles`) | supported |
| Earlier today day line | supported |
| Simple: cash bar open until entered, "told by owner" | supported |
| Books: table, waiting line, the four close rows, keys line | supported |
| Activity (TD-04) with `format/sentences.ts` (19 event types, English and Hindi, fallback) | supported |
| Phone, desktop side: the four fixed messages (no digit in any body, tested), mail fallback, the link page | supported (components; channels show not built until hosted-link registers `hosted.*`) |

### 5. The fake engine

`app/ui/src/bridge/fake.ts` with `bridge/fixtures/*`: every method the host controller and Today call, every `todayx.*` method, `workspace.open` for the lock screen, five scenarios (populated, empty, first-run, locked, read-only), and `registerFakeMethods(family, handlers)` for other lanes. Unknown methods refuse with `UNKNOWN_METHOD`. No production file imports it (tested). **Supported.** Preview: `npx vite --config frontend-validation/preview.vite.config.mjs`, then `/preview/?scenario=populated&lang=hi&view=books&theme=dark`.

### 6. The new UI as the default renderer

Electron opens `chausar://app/ui/index.html`; the loopback server answers `/` and `/ui/index.html` with the host. The legacy renderer and its files are served only behind `--legacy-renderer` (or the older `--ui-preview`), and only then does the host document carry `data-legacy="available"` and the host draw a return link. **Supported** (desktop and server tests updated).

### 7. UI rule checks

`app/ui/ui-policy.json` is derived from the tokens (`node frontend-validation/policy/derive.mjs --write`; a node test fails on drift and checks every declared colour pair against WCAG 2.2 AA in both themes). The Playwright checker `node frontend-validation/policy/check.mjs [--allow-not-built]` builds the preview, self-tests every rule on a planted page, then walks every place and sub-place from the place registry (other lanes' place modules are picked up automatically), first run, the lock screen, the empty workspace and the viewer seat, in both themes × three views × two languages at 1366×768, plus 1024×768. Report: `frontend-validation/dist/policy-report.json`. **Supported.**

Last run (582 states): 22 findings, 10 distinct.
- Words at rest a little over the limit: Simple Today with the figures prepared and the receipt open (93 of 90), Simple first run (106 of 90 English, 115 Hindi), and Hindi on Simple Activity, Ask · Saved, Work · Approvals and Reports · The week ahead (92 to 106). Hindi word segmentation counts more words than English for the same text.
- The status line wraps and is cut at the frame's foot in the Books view, English, 1366 wide.
- 31 addresses show "not built yet" (other lanes' places).

## Engine methods added (`todayx.*`, module `frame-today`)

| Method | Permission | What it does |
|---|---|---|
| `todayx.shell` | read | Demo flag, demo clock, banners in fixed order, auto-lock minutes |
| `todayx.clock.set` / `todayx.clock.advance` | admin | Demo only; set once; forward a day or a week; never back |
| `todayx.jobsPaused.dismiss` | read | This seat's dismissal |
| `todayx.lock.settings` | admin | Auto-lock minutes, 1 to 240 |
| `todayx.status` | read | Sources freshness, the model route and send level, what left this computer today (or who holds the pen) |
| `todayx.capabilities` | read | Each method family live, partial or missing, with its plan day |
| `todayx.worthALook` | read | At most five rows from real state |
| `todayx.activity` | read | Typed events newest first, 50 a page, filters |
| `todayx.firstRun.status` | read | The six steps, the blocked code, whether anything left this computer |
| `todayx.identity.check` / `.save` / `.get` | read / prepare / read | PAN, GSTIN (with checksum), Udyam, CIN, FSSAI, IEC format checks; nothing looked up online |
| `todayx.setupChecklist` | read | FR-12 rows from a dated rule table |
| `todayx.help` | read | Offline lists as codes |
| `todayx.faultReport` | read | Version, OS, event kinds, route health, error codes; never names, amounts, file names, cell values or questions (tested) |
| `todayx.phoneMessages` | read | The four fixed kinds, channel states, the monthly budget of 30 |

Reply shapes and validators: `app/ui/src/bridge/todayx-contract.ts`. Refusals: `DEMO_CLOCK_REAL_WORKSPACE`, `DEMO_CLOCK_ALREADY_SET`, `DEMO_CLOCK_NOT_SET`, `IDENTITY_INVALID`, `FAULT_REPORT_UNAVAILABLE`, `INVALID_TODAYX_REQUEST`.

## What is still missing

- **Not served from real state** (the engine has no record behind them yet): banners driving, no connection, sending closed and update needed; worth-a-look rows approval expired, update ready, moved, due soon and brief late; activity types lesson decided, backup done, update checked, lock and unlock. The screens draw them as soon as the engine sends them.
- **Engine methods the design names that do not exist:** `vault.diskCheck`, PIN quick unlock, `shell.print`, `shell.openExternal`, `shell.setLanguage`/`setView` (kept in host memory), `models.setLadder`, `models.localList`, a workspace list while locked, `imports.providePassword`, the PDF reader, `dictionary.proposals`, the FR-11 idea conversation, the recovery contact, device unlock.
- `todayx.identity.check` needs an open vault (the engine authorizes before any module method), so FR-02 checks formats only after the vault exists; before it, typed values are kept and checked at save.
- The receipt's small print beyond the source names and id (question, recipe, meaning, rate, forecast, number guard, allowed by, route) is not in the engine's receipt yet.
- Activity times are drawn in Asia/Kolkata; neither the reply nor `ui.context` carries the workspace time zone.
- Not built: the daily closing row on Today, cash by voice, grouped approval stepping (WK-03 lives with work-books), PH-04 and PH-05.
- No pixel comparison against the reference pictures, no screen-reader pass, no axe run; the Hindi text needs a native reader.
- The final Electron package config (`app/desktop/builder.json`, release lane) must include `app/ui/host`, `app/ui/public` and `app/ui/assets/fonts`, as the preview config already does; `scripts/desktop-launch.mjs` (release lane) does not yet accept `--legacy-renderer`.
