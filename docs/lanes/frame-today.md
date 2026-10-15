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
| Link dialog SH-10, mounted by the host behind `openLink(url)` on `PlaceRenderProps`; opens through `shell.openExternal` only after "Open in your browser"; a refused address keeps the dialog open with the reason | supported (no place module calls `openLink` yet) | `app/LinkDialog.tsx`, `host/bootstrap.tsx`, `places/types.ts` |
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
| FR-01 Welcome | `todayx.workspaces` (folders first, when the host passes `onOpenFolder`); language and view held in memory, saved with `todayx.device.set` once the vault exists | supported |
| FR-02 Identity card and GST mode | `todayx.identity.check` (before the vault), `todayx.identity.save` (after it) | supported |
| FR-03 Vault, FR-04 recovery kit | `todayx.diskCheck`, `workspace.create` (via the host controller), recovery acknowledgement | supported (disk check: experimental on real machines, see round 2) |
| FR-05 AI model | `models.list`, `models.configure` | supported for listing and the CLI/local rows; API key rows experimental (key passes once to `models.configure`) |
| FR-07 Bring a file | `sources.preview`/`sources.import`, `sources.workbookPreview`/`sources.workbookImport`; PDFs through connectors-ext `imports.*` | supported for CSV and Excel; PDF experimental (offered only when `imports.readerStatus` answers); encrypted workbooks: password needed, not built |
| FR-07 "Proposed meanings (draft)" | `learningx.dictionaryProposals`, else `learningx.dictionaryBuild` (learning-ext), behind `screens/first-run/proposals.ts` | supported for CSV (Excel says CSV only); shown after the file is taken, and on Meanings while the file is held; "not built yet" without learningx |
| FR-06/FR-08 Meanings | `ontology.packs`, `ontology.get`, `ontology.publish` (existing slice, embedded) | supported |
| FR-09 First answer | `ontology.get`, `calculation.run`, `receipts.get` | supported |
| FR-12 Setup checklist | `todayx.setupChecklist` | supported |
| FR-13 Open with the recovery kit | `workspace.recover`, `workspace.restore`, `todayx.recoveryContact.request` | experimental (backup picking needs the shell; the recovery contact refuses until the hosted relay exists) |
| FR-11 An idea | none | not built (shows "not built yet") |

The real engine reads a file only after meanings are published (`DICTIONARY_REQUIRED`), so the journey holds the picked file, goes to Meanings with a line saying so, and reads it right after publication.

**FR-07 proposed meanings.** For a held or taken CSV sheet the journey asks learning-ext for its builder's draft: `learningx.dictionaryProposals` first (a draft for the same text, by SHA-256, is shown again), else `learningx.dictionaryBuild` with the sheet's text. The thin list shows each column header as written (data), what it seems to be (text, money, date, whole number, yes or no) and how sure, the starter pack it looks like, and the columns used for the record itself. Nothing is adopted here: FR-08 settles meanings, and learning-ext's own adoption stays the owner's click. One request per sheet per journey (`proposalCache`).

**FR-11 an idea.** The founder's path is Welcome → vault → recovery kit → model → the idea, so the vault exists first and the idea is kept in the workspace (frame-today module state, `idea`). Built without a model (`platform/runtime/frame-today/idea.ts`): the owner types one thing at a time and picks where it goes (the business, money for one sale, the first 90 days, not known yet, or one of the standard unknowns: price of one sale, cost of one sale, first customers, licences). Each statement is kept exactly as typed and labelled "told by owner", or "assumption" when the owner ticks "this is my guess". The draft on the right (TwoSides) is only those words in their sections; a standard unknown is blank until told. Nothing parses a number out of the text or computes one: a figure exists only inside the owner's own words (tested: every digit run in the draft was typed). A range shows only from `IDEA_RANGES`, a dated table naming its official source; **the table ships empty**, because this build fetched no source and an unchecked range is not shown, so every untold unknown is a blank. Correct keeps the old words in the conversation (marked corrected) and puts the new ones on the draft; Take back withdraws a statement. Only a founder (owner or cofounder) tells the idea, inside the app (`IDEA_FOUNDER_ONLY`, `IDEA_APP_ONLY`); a viewer reads it. The idea is owner text, derived from no source: a source purge leaves it and it is deleted with the workspace (`workspace.delete`).

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

Last run (582 states): 18 findings, 9 distinct, all of one rule: words at rest a little over the limit. Simple Today with the figures prepared and the receipt open (93 of 90), Simple first run (106 of 90 in English, 115 in Hindi), and Hindi on Simple Activity, Ask · Saved, Work · Approvals and Reports · The week ahead (92 to 106; Hindi word segmentation counts more words than English for the same text). 31 addresses show "not built yet" (other lanes' places). Fixed from earlier runs: button labels over 22 characters, the step dot's contrast, the start heading's size, the status facts' 24 px targets, and a real overflow: the wide Books column ran past its slot at 1024 wide.

## The shell surface: `shell.openExternal` and `shell.print`

Two functions on the existing `window.chausar` (preload), each on its own IPC channel, never the engine request channel; main handles them in `app/desktop/shell-ipc.cjs`. The host reaches them only through `bridge/shell.ts` (`createShellPort(window.chausar | null)`), passed from `host/shell.js` to `mountHost` as the optional `shell` option. **Supported** (desktop main, preload and host tested with synthetic Electron; no real browser or printer).

| | Desktop | Browser (loopback server, design part 15) |
|---|---|---|
| `openExternal(url)` → `'opened' \| 'refused'` | preload: a string of 1–2048 characters; main: trusted main frame only (`assertTrustedSender`), the address rule below, one call a second, refused while no workspace is open (main asks the engine `workspace.status`), then `shell.openExternal` with the `URL`-re-serialized address | the same address rule and one a second, then `window.open(url, '_blank', 'noopener,noreferrer')` |
| `print(kind)`, kind `'recovery-kit'` or `'page'` | preload and main accept only those two kinds; main calls `webContents.print({ silent: false }, callback)` on the trusted window: the system print dialog, nothing from the renderer in its options, no HTML and no file path; one at a time, one a second | `window.print()` |

The address rule (same code shape in main and in `bridge/shell.ts`; a test checks they agree): `https:` only; no user name or password; no whitespace or control characters; a named host with a dot that is not `localhost`, `*.localhost`, an IPv4 or IPv6 literal, or a bare one-label name, so text in an answer or a file cannot point the person's browser at a service on this computer or the local network; at most 2048 characters before and after re-serialization. **Refused on purpose:** `http:` (also for `localhost`), `mailto:` (no design screen opens a mail client; the mail fallback goes through the hosted relay, and a `mailto:` from outside text could prefill a message carrying data off the machine), `javascript:`, `file:`, `data:`, `chausar:`.

While a print is asked for, the host marks the document `data-print="<kind>"`. For the recovery kit, Vault draws a print-only copy at the end of the page (the code and the three lines in English and Hindi) and the `@media print` rule in `Journey.module.css` hides everything else, so one page holds only the kit; the copy is removed when the print returns. Window navigation is unchanged: `will-navigate` stays denied, `setWindowOpenHandler` stays deny, `connect-src 'none'` stays.
**axe-core (round 2), supported.** The checker also runs axe-core 4.10.3 (exact-pinned devDependency) with the WCAG 2.0/2.1/2.2 A and AA tags on every state it walks at 1366×768 (532 states), with the window grown for the run so text below the fold is checked too; it fails on serious or critical violations (`--axe-fail=`), and the self-test plants a nameless button, an unlabelled field and faint text. Result before and after this round: 0 violations at any impact, in every place, theme, view and language, including other lanes' screens. axe leaves for a person the contrast of chart text drawn in SVG (492 nodes on Today and the empty workspace; the policy's own contrast rule measures these), and before this round also left Books Today's queue table drawn with headers and no rows (`th-has-data-cells`, 20 states; fixed: the table is drawn only with rows). An exploratory run over the first-run walk (welcome, identity, model, file, packs, meanings, a meaning open), a Today row open and the workspace menu open, in both themes, views and languages (120 states), also found none.

**Reference pictures (round 2), supported.** `frontend-validation/visual/extract.mjs` extracts the design's 19 reference pictures (light and dark), `capture.mjs` captures the matching preview screens at 1366×768 (Today Guided S01, Simple S14 in Hindi, Books S15, first-run Meanings S09 by a scripted walk, and other lanes' screens at their addresses), and `page.mjs` writes the side-by-side review page [`frame-today-visual.html`](frame-today-visual.html) (self-contained, 3 MB). Fixed from the pairs: the host's "Read again" bar above the frame is gone once a workspace is open (it is in the workspace menu); the scoped Today controls (Open review list, Prepare figures with its note) no longer stack as full-width blocks between the title and the rows; the date, title and rows read as one block; figure tiles keep their figures on one line; "See all" sits at the start; wrapped status facts sit 4 px apart; rail places step 48 in Simple and 32 in Books (`--rail-gap`); the wordmark keeps its mono face in Hindi; first-run rows are vertically centred and the step names and walking square sit on the dots' line. The fake engine answers `sources.preview` with `DICTIONARY_REQUIRED` before meanings are agreed, as the real engine does, so the journey reaches Meanings in the preview.

After this round (582 states): 42 findings, 11 distinct, all words at rest. More of Today now fits above the fold (no host bar, tighter top), so Simple Today shows 96 words in English and 102 in Hindi (limit 90; the scoped producer's partial-scope note is 18 of them) and the empty workspace's Guided Today shows 123 (limit 120); the others are as before.

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
| `todayx.idea.start` / `.tell` / `.correct` / `.get` | prepare / prepare / prepare / read | FR-11: the owner's statements as typed, by section; standard unknowns blank until told; ranges only with source and date (none shipped) |
| `todayx.receiptDetail` | read | Round 2. The receipt's small print from existing records only: question (a conversation record of this seat), sources with way in and read time, recipe (id, state, who accepted it, grade), meaning (dictionary version, publisher), rate (one recorded rate), number guard and route (only when a model turn this seat may see linked the answer), allowed by (the recorded send approval, else the read access the receipt was made under). Reads the receipt through `receipts.get`, so its refusals apply. **Supported** |
| `todayx.closing` / `todayx.closing.set` | read / admin | Round 2. TD-01 daily closing: on or off (off by default) and today's cash, bank and entries states. Cash is always `not-loaded-yet` (the engine keeps no cash capture). **Supported** |

Reply shapes and validators: `app/ui/src/bridge/todayx-contract.ts`. Refusals: `DEMO_CLOCK_REAL_WORKSPACE`, `DEMO_CLOCK_ALREADY_SET`, `DEMO_CLOCK_NOT_SET`, `IDENTITY_INVALID`, `FAULT_REPORT_UNAVAILABLE`, `INVALID_TODAYX_REQUEST`, and for the idea `IDEA_APP_ONLY`, `IDEA_FOUNDER_ONLY`, `IDEA_NOT_STARTED`, `IDEA_FULL`, `IDEA_CLAIM_NOT_FOUND`, `IDEA_CLAIM_DECIDED` (all on frame-today's line in `preload.cjs`).

## Round 2: this computer, before the vault

The engine's `preVault` seam (`MethodSpec.preVault`) lets the trusted local desktop call a module method before any workspace is open; no member is authorized then and `host.store` throws. Any other caller (phone, MCP, a tainted context) is refused with `OPEN_DESKTOP`. Once a vault is open the same methods are authorized normally.

| Method | Permission | preVault | What it does | Label |
|---|---|---|---|---|
| `todayx.identity.check` | read | yes | FR-02 format checks now answer before the vault exists | supported |
| `todayx.diskCheck` | read | yes | `{ disk: 'encrypted' \| 'not-encrypted' \| 'unknown', platform, keyring: 'safe' \| 'none' \| 'unknown' }` for the data directory's disk. Read-only tools behind an injectable probe, no shell, a fixed argument list, a 4 s timeout and a small fixed environment: Windows `Get-BitLockerVolume` (untranslated enum) then `manage-bde -status X:` (English only), macOS `fdesetup status`, Linux `lsblk -J -s -o TYPE,MOUNTPOINT` (the longest mount holding the directory, encrypted when it is or sits on a `crypt` device). Any failure, timeout, non-zero exit or wording not recognised is `unknown`. Keyring: Windows and macOS `safe`; Linux `none` with no session bus, else `unknown` | supported for the mapping (fake probe); experimental on real machines (BitLocker usually needs elevation, so Windows mostly reads `unknown`) |
| `todayx.device.get` / `.set` | read | yes | The language (`en`/`hi`) and view (`simple`/`guided`/`books`) for this computer, in `frame-today-device.json` under the engine directory: `{ format, language, view }`, strictly validated, written to a private temporary file, flushed, then renamed. A missing, oversized, linked or malformed file reads as `{ saved: false }`. Never workspace data | supported |
| `todayx.workspaces` | read | yes | `{ folders: [{ folder, main }] }`: the workspace folders under the engine directory, main first, at most 50. A folder counts when it is a plain directory (not a link) with a valid name, not `backups`/`exports`/`updates`, holding only what a workspace keeps (`authority.encrypted.json`, `writer.lock`, `private-artifacts`, temporary dot files; with PostgreSQL storage the folder may be empty). Names only: nothing is opened or decrypted | supported |
| `todayx.recoveryContact.get` / `.set` | admin | no | The recovery contact `{ name ≤ 100, reach ≤ 200, savedAt }` (one line each), or `{ contact: null }` to remove. Personal data about someone else: kept only in the frame module's namespace of the encrypted workspace; never in an error, audit detail, fault report or the device file (tested). Reply carries `confirmation: 'relay-required'` | supported |
| `todayx.recoveryContact.request` | admin | yes | Always refuses `RECOVERY_CONTACT_RELAY_REQUIRED` | supported (as a refusal) |

New refusals (`TODAYX_REFUSALS` and the frame-today `laneRefusals` line): `RECOVERY_CONTACT_INVALID`, `RECOVERY_CONTACT_RELAY_REQUIRED`.

**Boundary: the recovery contact needs the hosted relay.** A contact confirms a recovery through the hosted relay (hosted-link lane), which is written but not deployed. Until a relay method exists, `todayx.recoveryContact.request` refuses with `RECOVERY_CONTACT_RELAY_REQUIRED` and nothing is sent; FR-13 and the lock screen say "Your recovery contact cannot confirm yet. That needs the Chausar relay, which is not running yet. Use your recovery kit." When hosted-link ships a confirmation method, this handler calls it as the same caller and the refusal goes away.

**Screens.**
- FR-01: with `onOpenFolder`, the folders come first as "Open <folder>" (the host draws its lock screen for that folder). The language and view stay in memory before the vault (FR-01 rule) and are written with `todayx.device.set` once the vault exists, and again on change while it is open.
- FR-03: the disk result line (BitLocker, FileVault or disk encryption named by platform; "could not be checked" when unknown), the keyring line on Linux with no safe keyring, and the honest line under it.
- FR-13: "Ask recovery contact" with the refusal words (`AskRecoveryContact`).
- `screens/first-run/ThisComputer.tsx` exports `LockFolderChoice` (lock screen), `AskRecoveryContact` (lock screen, FR-13) and `RecoveryContactSettings` (for Trust · Vault; words in the shared catalogue under `SH-02.*`, so it draws under any place's text provider). Helpers in `this-computer.ts` (`readDeviceChoices`, `saveDeviceChoices`, `readWorkspaceFolders`, ...).
- FR-07 PDFs (`PdfStatement.tsx`): offered only when `imports.readerStatus` answers (connectors-ext), aligned to the real shapes in docs/lanes/connectors-ext.md "FR-07 contract" (`platform/runtime/connectors-ext/fr07.ts`). The reader not installed: the text reader, OCR for scanned pages (experimental) and the reason (`PYTHON_NOT_CONFIGURED`, `PDF_LIBRARY_MISSING`, or the helper's code) in words; Install calls `imports.installReader`, which always refuses (`READER_INSTALL_UNAVAILABLE`, or `DEMO_EXTERNAL_DISABLED` in demo), and the screen says the reader comes with the app installer. Password needed: one uncontrolled field read once and emptied at once, its value passed straight to `imports.providePassword` (`{ held, sourceId, expiresInSeconds, usedOnce }`; `PASSWORD_INVALID`, `OPEN_DESKTOP`) and never put in state or storage; the next preview uses it once and says `WRONG_PASSWORD` without a count. `imports.preview` → the envelope's `id`, `status` and `fr07` (lines read, opening and closing balance, the check, "read from a picture (experimental)" when `readByOcr`). Refused whole: thrown (`PICTURE_ONLY`, `INVALID_PDF`, `PDF_LINE_UNREADABLE`, `PDF_PAGE_LIMIT`) or by content (`CUT_SHORT`; `FILTERED` with both totals as money, or as line counts when the row count differed; `DOES_NOT_ADD_UP` at line N), with where the refused file is kept. `imports.commit({ sourceId, envelopeId })` → rows taken, or taken before (duplicate); `IMPORT_NOT_ACCEPTED`, `ENVELOPE_NOT_FOUND`, `ENVELOPE_EXPIRED` have their own words. Every reply is validated strictly; anything else is a failure with `INVALID_REPLY`. The typed fixture (`bridge/fixtures/imports.ts`, `registerFakeMethods('imports', importsFixture())`) serves the same shapes, chosen by marker words. **Experimental**: not yet run against the real engine module end to end from the screen. `PDF_PAGE_LIMIT` is not yet on connectors-ext's `laneRefusals` line in `preload.cjs`, so over the desktop bridge it arrives as a generic failure until that lane adds it.
- FR-07 sheets: the engine has no password path for workbooks (`readWorkbook` refuses encrypted Office files and `ENCRYPTED_ZIP`). An encrypted workbook (recognised by its OLE header before anything is sent, or `ENCRYPTED_ZIP`) shows "This file needs its password" with the not-built words and "Save a copy of the file without its password, then bring that copy." No field is drawn. The old call to the non-existent `imports.providePassword` on a `PASSWORD_REQUIRED` sheet refusal is gone.

The fake engine serves every new method; `FAKE_PRE_VAULT` lists those served while locked (the locked scenario has two folders).

## What is still missing

- **Shell:** no place module renders an outside link yet, so `openLink` has no caller in the product; the reports lane's report page (RP-02) still calls `window.print()` itself rather than `print('page')` (its own `@media print` rule is what hides the frame); the printed recovery kit has not been checked on a real printer or saved PDF; `shell.openExternal` is refused before a workspace is open (no first-run screen links out today).
- **Not served from real state** (the engine has no record behind them yet): banners driving, no connection, sending closed and update needed; worth-a-look rows approval expired, update ready, moved, due soon and brief late; activity types lesson decided, backup done, update checked, lock and unlock. The screens draw them as soon as the engine sends them.
- **Engine methods the design names that do not exist:** PIN quick unlock, `models.setLadder`, `models.localList`, device unlock. (`vault.diskCheck`, `shell.setLanguage`/`setView`, a workspace list while locked and the recovery contact are `todayx.*`; `shell.print` and `shell.openExternal` are narrow IPC; `dictionary.proposals` is learning-ext's `learningx.dictionaryProposals`/`dictionaryBuild`; the FR-11 idea conversation is `todayx.idea.*`; `imports.providePassword` and the PDF reader belong to connectors-ext.)
- **FR-11 gaps.** No model proposes plan steps or reads the owner's words: the draft is the owner's statements, placed by the owner. A model route could suggest plan steps as labelled assumptions later; it is deliberately not used. No range is shipped: `IDEA_RANGES` is empty until a person checks an official source (for example registration or licence fees) and adds the row with its source and date. Proposed meanings read CSV only (Excel would need the sheet's text sent to learning-ext). The fake engine does not serve `learningx`; previews and tests register `bridge/fixtures/learningx.ts`.
- `todayx.identity.check` needs an open vault (the engine authorizes before any module method), so FR-02 checks formats only after the vault exists; before it, typed values are kept and checked at save.
- The receipt's small print beyond the source names and id (question, recipe, meaning, rate, forecast, number guard, allowed by, route) is not in the engine's receipt yet.
- Activity times are drawn in Asia/Kolkata; neither the reply nor `ui.context` carries the workspace time zone.
- Not built: the daily closing row on Today, cash by voice, grouped approval stepping (WK-03 lives with work-books), PH-04 and PH-05.
- The reference pictures are compared by eye on the review page, not by pixels; there is no screen-reader pass; the Hindi text needs a native reader.
- Words at rest over the limit on Simple Today and the empty workspace's Today: the scoped producer's partial-scope note is long; it is required text until the producer knows the whole-app count.
- Receipt small print (round 2, `todayx.receiptDetail`): review and co-sign of meanings, the forecast line, the decision's rule id, check step and device are not recorded by the engine, so they never show. The number guard is shown only for a model-linked answer and only when it passed (a failed guard never reaches a stored answer).
- `ui.context` now carries `timeZone` (round 2, a core edit): the workspace's IANA zone only when `state.workspace.timeZone` holds one. Nothing writes that field yet, so it is `null` in practice and Activity shows times in UTC with the word "UTC".
- Daily closing row (round 2): drawn in all three views from `data.closing`; the host reads `todayx.closing` in `host/frame-reads.ts`, but `host/bootstrap.tsx` does not yet put `frame.reads.closing` into Today's data (one line, left to the coordinator). No screen control calls `todayx.closing.set` yet.
- Cash by voice (round 2, **experimental**): `screens/today/voice-cash.ts` and `CashVoice.tsx` behind `intents.cashVoice` (off by default). It sends the heard words to the models-ext lane's `modelsx.speechInterpret` { text } (its real reply, checked by `isSpeechInterpretReply`), takes a cash amount only from a reading with exactly one number and no negation, ambiguity or unclear part (a unit-less number is rupees), and on Yes records `modelsx.speechConfirm` { text, digest } before saving. A missing method shows "not built yet". It also needs a host listener that turns one hold into text, which no host supplies yet. The Simple cash field itself is only drawn when the host supplies `onSaveClosing`, which the real host does not yet.
- Not built: grouped approval stepping (WK-03 lives with work-books), PH-04 and PH-05.
- No pixel comparison against the reference pictures, no screen-reader pass, no axe run; the Hindi text needs a native reader.
- The final Electron package config (`app/desktop/builder.json`, release lane) must include `app/ui/host`, `app/ui/public` and `app/ui/assets/fonts`, as the preview config already does; `scripts/desktop-launch.mjs` (release lane) does not yet accept `--legacy-renderer`.
- Round 2: the host still has to wire the device choices at start, the folder choice on the lock screen and `onOpenFolder` (instructions in the round-2 hand-off; `bootstrap.tsx` was not edited). Trust · Vault (reports-tools-trust) has to place `RecoveryContactSettings`. The recovery contact cannot confirm anything until the hosted relay is deployed. The disk check is not tested on real Windows, macOS or Linux disks.

## Adversarial review (round 2)

An independent read-only review covered the IPC surface, CSP and serving, rendering of untrusted engine text, and lock-screen and secret leaks. Findings and what was done:

| Finding | Severity | Fix |
|---|---|---|
| The lock failed open: a refused `workspace.lock` (`VAULT_BUSY` while another request runs) turned the screen "unavailable", and Refresh brought the workspace back without the passphrase | high | `lock()` holds the lock locally and asks the engine again (up to 30 times, a second apart); an invalidation never downgrades a held lock; only `unlocked()` after an accepted unlock leaves it. Test: `app/ui/tests/frame-today-lock-security.test.ts` |
| A wrong passphrase on the desktop was never reported (the renderer dropped every lane refusal) and sent the person into first run | medium | The renderer mirrors every lane's `laneRefusals` line (`laneRefusalCodes`, parity test in `desktop-bridge-error.test.ts`); `UNLOCK_FAILED`, `VAULT_OPEN`, `VAULT_BUSY` are on this lane's line; any other unlock refusal keeps the lock screen with "could not unlock" |
| The idle lock was off when the `todayx.shell` read failed | medium-low | The idle lock always runs, 10 minutes by default |
| The link dialog showed one address and opened another (look-alike letters, `\`, direction marks) | low | Non-ASCII and `\` are refused; the dialog shows the normalized address, or a refused address with every non-plain character replaced |
| Local-network names and other ports were accepted | low | `.local`, `.lan`, `.internal`, `.localdomain`, `.home.arpa`, `.intranet`, `.corp` and any non-default port are refused (in main and the renderer, tested together). Names that resolve to a private address cannot be caught without resolving them; the person's confirmation is the control there |
| Before-the-vault methods answered any member once a vault was open; viewers read the identity card | low | `todayx.workspaces`, `todayx.diskCheck`, `todayx.device.set` need an admin once a vault is open; `todayx.identity.get` needs a preparing seat. A seat's own banner dismissal and reading the idea stay read-level, as designed |

Checked and sound: trusted-sender checks, the shell channels' rate limit and print options, the protocol handler's exact file map, the loopback server's CSP and legacy flag, the disk probe (fixed arguments, no shell), the device file, receipt detail reading as the caller, `react-intl` given catalogue keys only, and no secret in state, storage, logs or the URL. Not fixed (hunches, fail-closed): a cancelled legacy navigation leaves the window refusing IPC until restart; the fault report reads recent activity without filtering by caller (codes only).

## Round 4: banners, updates, route states, tray, fault report

| Item | What exists now | Label |
|---|---|---|
| SH-03 banners | `todayx.shell` reads `session.status` (driving), `approvals.afterRestore` (sending closed; count of the actions this seat may see, no restore date until one is served), `network.online` (no connection) and `release.status` (update needed: expired build, withdrawn release, vault written by a newer build). Core `updates.status` is read only when no lane serves `release.status`. An absent or failing source shows no banner. | supported (driving and no-connection: experimental, their lanes are not built) |
| SH-08 updates | `todayx.updates` state read over `release.status`; `todayx.updates.stage` and `.apply` call `release.stageUpdate` / `release.applyUpdate` with exactly `{ confirmed: true }`; the attempt is remembered so the next start says "The update did not finish. Your data is as it was."; `.dismiss` forgets it. Today's "Update ready. Your data is saved first." row opens the Updates sheet (steps in words: checking, saving a copy, updating; then restart). Refusals in words: not signed, older, withdrawn, older than the vault, Mac cannot update itself, owner only. The sheet is reachable from About and the Update needed banner. | experimental (no signed feed or release key in this build) |
| SH-09 route states | `app/RouteStates.tsx` (`RouteStateRow` for the ask lane to place where the answer would be, `RouteStates` list); drawn on Ask, New under the route picker from `models.probe`, read once per context. "Sign in again" is a button only when a sign-in method is supplied; none exists, so the row says signing in from here is not built. | experimental (fixture-only until core-gateway-auth serves `models.probe`) |
| SH-07 tray | `main.cjs`: the review count from `today.review` (shown only when the count is complete), Pause jobs / Resume jobs (the host job lifecycle reports the computer as not awake while paused, so the engine runs no job), Stop while `session.status` reports driving (`session.stop`), "Paused while locked" after a workspace that was open is locked. Re-read on engine status, on workspace/approval/job requests and once a minute. | supported (desktop test with synthetic Electron) |
| Cancelled navigation | `selectedDocument` changes only on `did-navigate` of the pending legacy address; `did-fail-load` clears it. | supported |
| Links before a vault | `shell.openExternal` is allowed while no workspace folder exists (`todayx.workspaces` empty) only from `chausar://app/ui/index.html`; https, ASCII, one a second and the renderer dialog still apply. The first-run journey does not pass `openLink` to its screens yet. | supported (main side) |
| SH-11 fault report | `shell.saveText('fault-report', text)` writes the shown text through the system save dialog (fixed name, no path from the renderer). `todayx.faultReport.send` refuses `FAULT_REPORT_SEND_UNAVAILABLE` (needs a reporting endpoint: founder). Main writes a marker beside the vaults folder at start and removes it on a clean quit; on the next start the fault report opens once with Send report / Don't send. `todayx.faultReport` now reads only this caller's audit records and model receipts. | supported (send: typed refusal) |

### Round 4 contracts

| Method | Payload | Reply | Owner | Present? |
|---|---|---|---|---|
| `session.status` | `{}` | `{ state: 'idle'\|'driving'\|'sign-in'\|'paused-by-you'\|'stopped-by-key'\|'stopped'\|'step-failed'\|'done', window: { id, title } \| null, steps }` (as work-books' `work-driving.ts`) | driving | absent (banner and tray Stop never show) |
| `session.stop` | `{}` | any | driving | absent |
| `approvals.afterRestore` | `{}` | `{ sendingClosed: boolean, items: [...], restoredFrom?: ISO }` (`restoredFrom` not served yet) | work-books | present |
| `network.online` | `{}` | `{ online: boolean }` | core-gateway-auth | absent |
| `release.status` | `{}` | `{ configured, version, channel, build: { expiresAt, updateNeeded }, vaultCompatible, candidate: { version } \| null, withdrawn?: boolean }` (`withdrawn` not served yet) | release | present |
| `release.stageUpdate` / `release.applyUpdate` | `{ confirmed: true }` | `{ staged, version, installMode }` / `{ applied, version, restartRequired }` | release | present |
| `models.probe` | `{}` | `{ routes: [{ routeId, label, kind, state: 'ready'\|'signed-out'\|'not-installed'\|'version-not-tested'\|'timed-out'\|'error'\|'chat-only'\|'answers-only'\|'skipped-send', send: { route, yours } \| null, resumesAt: ISO \| null }], checkedAt }` | core-gateway-auth | fixture-only |
| `today.review` (tray) | `{ limit: 1 }` | `{ count: number \| null, ... }` | core | present |
| `todayx.updates`, `.stage`, `.apply`, `.dismiss`, `todayx.faultReport.send` | see `todayx-contract.ts` | | frame-today | present |
