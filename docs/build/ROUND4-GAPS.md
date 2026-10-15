# Round 4: everything not finished (compiled 15 October 2026 from the lane documents, LANES.md and the spec)

**How this was compiled.** I read all 12 lane docs in full, LANES.md §7 and every spec screen (SH, FR, TD, AS, WK, BK, RP, TL, TR, PH, plus the CA-01..CA-11 console table). I checked lane-doc claims against current code wherever a claim could have gone stale.

**What counts as "registered".** I imported `platform/runtime/modules/registry.ts`, which gives 484 lane methods; `app/desktop/module-methods/*.json` matches it exactly. To those I added the `case '…'` labels in `platform/runtime/engine.ts` and the `METHODS` list in `app/desktop/ipc-contract.cjs`.

**Excluded.** The 5 items you listed as already fixed. Also excluded are lane-doc items I found already resolved in code; they are listed at the end so nobody reassigns them.

**Three contract mismatches turned up in code that no lane doc reports.** Each is listed below in its lane's group:
- work-books calls `learningx.accountsProposals`, which is not registered.
- jobs-ext calls `modelsx.price`, which is not registered.
- frame-today's update banner reads core `updates.status` instead of `release.status`.

Format: `[ID or area] item — owning lane — BUILDABLE / NEEDS-FOUNDER (reason) — source`

---

## core (cross-cutting core work)

**BUILDABLE**
- [SH-01/TD-01/TD-03/TD-04/WK-01/WK-04/WK-07/BK-01] Live refresh: `events.subscribe` is registered nowhere and place modules have no event seam — core — BUILDABLE (core edit: platform/runtime/engine.ts, app/desktop/ipc-contract.cjs, app/ui/src/places/types.ts) — CHAUSAR-APP-DESIGN.md Engine lines; work-books.md: Still missing + audit WK-01/WK-04
- [TR-07/SH-03/FR-14] No `devices.*` methods: no machine list, pen hand-over, device remove or sync set-up — core — BUILDABLE (core edit: platform/runtime/sync.ts, engine.ts) — reports-tools-trust.md: §4 + audit TR-07
- [WK-15] Re-applying deletions after a restore (`deletion.reapply`) has no method in core or trust — core — BUILDABLE (core edit: engine.ts/trust.ts) — work-books.md: audit WK-15
- [BK-20] No core method deletes one customer's facts, receipts, answers, actions or conversations — core — BUILDABLE (core edit: engine.ts/vault) — work-books.md: Still missing + audit BK-20
- [BK-19] The calculator does not read exchange rates, and the "not counted" count is not on each receipt — core — BUILDABLE (core edit: platform/runtime/calculator.ts) — work-books.md: Still missing + audit BK-19
- [RP-02/AS-19] No calculation receipts for connector bank totals, GSTR-3B turnover or the GSTR-2B match — core — BUILDABLE (core edit: calculator.ts). Effect: lines show "not counted" and the 3 connector pages stay "ready, not tested" — reports-tools-trust.md: §4 Other lanes; ask.md: audit AS-19
- [jobs-ext stock-check] No quantity measure kind; every definition binds a money field — core — BUILDABLE (core edit: platform/runtime/ontology.ts, calculator.ts) — jobs-ext.md: Still missing
- [BK-08] A definition has no worked-example field and no date-used field; release history names the publisher, not the reviewer — core — BUILDABLE (core edit: ontology.ts) — work-books.md: audit BK-08
- [AS-05/receipt small print] These are not recorded anywhere, so they never show:
  - recipe "accepted by", meaning reviewer and co-signer (import and dictionary records do not carry them);
  - the forecast line;
  - the decision rule id, check step and device.

  — core — BUILDABLE (core edit: ontology/import records, receipts) — ask.md: audit AS-05; frame-today.md: What is still missing (receipt small print, round 2)
- [WK-08/WK-09/WK-16] Core jobs are missing several things — core — BUILDABLE (core edit: platform/runtime/jobs.ts) — work-books.md: Still missing + audit WK-08/09/16:
  - the job ledger records no durations (clock time "not counted");
  - no job names its actions (exposure "not counted");
  - no review date on the core job card;
  - no method marks a person step done;
  - no child-task results.
- [WK-11] Month-end calendar jobs are unavailable in the installed app: `worker.ts` passes `durableJobs` but never `jobCalendar` — core — BUILDABLE (core edit: platform/runtime/worker.ts) — work-books.md: Still missing; worker.ts:13
- [WK-02] Core money actions use a typed-amount second ask; there is no core passphrase check — core — BUILDABLE (core edit: platform/runtime/actions.ts, vault) — work-books.md: Still missing + audit WK-02
- [writeback second ask] Only the owner can answer the second ask (`REAUTH_OWNER_ONLY`) until members have their own secrets — core — BUILDABLE (core edit: vault) — writeback.md: How it protects (Second ask)
- [TD-04] Nothing writes `state.workspace.timeZone`, so `ui.context.timeZone` is null and Activity shows UTC — core — BUILDABLE (core edit: workspace settings/engine.ts) — frame-today.md: What is still missing
- [WK-02 exports] The engine's purge of `exports/` on workspace delete skips `approvals.exportPrepared` files — core — BUILDABLE (core edit: engine.ts) — work-books.md: Still missing
- [TR-09] No core method discards a waiting model send; it can only be released or left to expire — core — BUILDABLE (core edit: platform/runtime/gateway.ts) — reports-tools-trust.md: §4 + audit TR-09
- [TR-08] The monthly model cap is recorded but not enforced (`capEnforced: false`) — core — BUILDABLE (core edit: gateway.ts) — reports-tools-trust.md: §4 + audit TR-08
- [canary] The outbound canary check covers only the model gateway. Plugin network calls, the learning upload and the hosted allowance client bypass it — core — BUILDABLE (core edit: platform/runtime/plugins.ts, plus the learning-ext and hosted-link callers) — reports-tools-trust.md: §4
- [TL-08] The MCP server removes nothing from answers, so "removed" is always empty — core — BUILDABLE (core edit: platform/runtime/mcp.ts) — reports-tools-trust.md: audit TL-08
- [TR-06/TR-02/TR-04] Three trust rules are not enforced — core — BUILDABLE (core edit: platform/runtime/trust.ts, retention) — reports-tools-trust.md: §4 + audit:
  - staff "sees their own";
  - record- and field-level markings only label pages (only source-level markings hide data);
  - keep periods for kinds other than facts are stored, not enforced.
- [jobs-ext deciding agent] The live gateway agent can only look up. A deciding agent needs a new gateway purpose — core — BUILDABLE (core edit: gateway.ts) — jobs-ext.md: Still missing
- [AS-15] The decision journal has no "recorded later" date and no "cancelled" state; the ask lane keeps both itself — core — BUILDABLE (core edit: decisions journal) — ask.md: Still missing
- [connector credentials] The sealed credential key is protected only by file permissions; using the OS keychain needs a general secret store — core/release — BUILDABLE (core edit + existing platform/native/keychain helper) — connectors-ext.md: Host wiring + Boundaries

---

## frame-today

**BUILDABLE**
- [SH-03] Three banners are never served: "Chausar is driving", "Sending is closed" and "No connection". `frame.ts` emits only demo-clock, read-only, jobs-paused and update-needed. Sending-closed could read `approvals.afterRestore.sendingClosed` — frame-today — BUILDABLE — frame-today.md: What is still missing; platform/runtime/frame-today/frame.ts: shell()
- [SH-03/SH-08] The update-needed banner reads core `updates.status`. The release lane's `release.status` (`build.updateNeeded`, withdrawn) is never read — frame-today + release — BUILDABLE — frame.ts: updateNeeded(); release.md: What a person gets
- [SH-08] The Updates surface is claimed by no lane. No UI calls `release.status`, `checkUpdate`, `stageUpdate`, `applyUpdate` or `rollback`. Not drawn: the Today "Update ready" row, and the updating, rolled-back and older-build-than-vault states — frame-today (Today/banner) + reports-tools-trust (Vault rows) — BUILDABLE — CHAUSAR-APP-DESIGN.md: SH-08; release.md ("the Trust and Tools lanes and the frame draw these"); code search
- [SH-09] "Sign in again, and a route that is down" is claimed by no lane and not built. Missing: the states (signed out, not installed, timed out, skipped by send setting, resumes at) and `models.probe` — frame-today — BUILDABLE — CHAUSAR-APP-DESIGN.md: SH-09; code search (SH-09 is in no lane doc and not in app/ui/src)
- [SH-04] The host's ask line passes only onAsk, noModel and readOnly. Missing: suggestions (`askx.suggest` exists), the "About:" context a place can set (needed by BK-12), voice, and "telling, not asking" — frame-today — BUILDABLE — CHAUSAR-APP-DESIGN.md: SH-04; app/ui/src/host/bootstrap.tsx ask props (~line 904); work-books.md: Still missing BK-12
- [SH-05] Talking to it is claimed by no lane. Missing: hold-to-talk on the ask line, words as heard, amount/date read-back with Yes/Change, speaking the answer, dropping a voice note. Only the TD-02 cash voice exists — frame-today (over models-ext speech) — BUILDABLE (local whisper/browser transcript exist; paid providers need keys) — CHAUSAR-APP-DESIGN.md: SH-05; code search
- [SH-07] The tray menu has only "Open" and "Quit". Missing: the awaiting-review count, Pause jobs, Stop (while driving), and "Paused while locked" — frame-today — BUILDABLE — CHAUSAR-APP-DESIGN.md: SH-07; app/desktop/main.cjs: createBackgroundTray
- [SH-06] Switching between workspaces from the menu (`workspaces.switch`) is not built; the list is labelled experimental — frame-today — BUILDABLE — frame-today.md: §1 table (workspace menu)
- [SH-02/TR-12] PIN quick unlock is not built — frame-today — BUILDABLE — frame-today.md: What is still missing; reports-tools-trust.md: audit TR-12
- [FR-05/TR-08] `models.setLadder` (route order) and `models.localList` (local model list) do not exist — frame-today/models-ext — BUILDABLE — frame-today.md: What is still missing
- [SH-11] Fault report Save and Send, and the crash report (`support.saveFaultReport`, `support.crashReport`), need shell file and send paths — frame-today — BUILDABLE — frame-today.md: §1 table (Fault report)
- [SH-11] The fault report reads recent activity without filtering by caller — frame-today — BUILDABLE — frame-today.md: Adversarial review (not fixed)
- [shell] A cancelled legacy navigation leaves the window refusing IPC until restart — frame-today — BUILDABLE — frame-today.md: Adversarial review (not fixed)
- [SH-10] `shell.openExternal` is refused before a workspace is open, so no first-run screen can link out — frame-today — BUILDABLE (low) — frame-today.md: What is still missing (Shell)
- [TD-01/SH-01] Today's review rows and count read core `today.*` only. `approvals.list` (write-back items, jobs-ext proposals, bills) never joins, though the spec has it join from day 7 — frame-today — BUILDABLE — CHAUSAR-APP-DESIGN.md: TD-01/SH-01; app/ui/src/host/today-controller.ts (no approvals read)
- [TD-01] Five worth-a-look kinds are not served: approval expired, update ready, figure moved, due soon (`reportsx.due`), brief late (`reportsx.weekAhead.late`). `frame.ts` serves only file-refused, decision-due, missed-while-asleep and setup — frame-today — BUILDABLE — frame-today.md: What is still missing; frame.ts: worthALook()
- [TD-01/WK-11] The "N runs were missed while this computer slept" row reads only core ledger `catchup-skipped` entries, never jobs-ext's `jobsx.missed` notes — frame-today — BUILDABLE — work-books.md: audit WK-11 + Still missing; frame.ts: worthALook()
- [TD-03] In the real host, the Books Today queue table and month's close are always "unknown" (`queueMissing` and `closeMissing` are 'unknown'). No close-status read model exists (spec `reports.closeStatus`) — frame-today — BUILDABLE — CHAUSAR-APP-DESIGN.md: TD-03; app/ui/src/host/today-controller.ts:180
- [TD-02] Today's cash is never captured. `todayx.closing` always says cash not-loaded-yet and there is no `briefs.saveClosing`. The real host never supplies `onSaveClosing`, so the Simple cash field and the week's 7 bars never draw — frame-today — BUILDABLE — frame-today.md: Engine methods (`todayx.closing`) + What is still missing; app/ui/src/screens/today/permissions.ts
- [TD-01] No screen control calls `todayx.closing.set` (daily closing on/off) — frame-today — BUILDABLE — frame-today.md: What is still missing
- [TD-02] Cash by voice has no host hold-to-talk listener, and `intents.cashVoice` is never supplied — frame-today — BUILDABLE — frame-today.md: What is still missing (Cash by voice)
- [TD-01/WK-03] Grouped approval stepping from a Today summary row ("3 payment reminders") is not built — frame-today — BUILDABLE — frame-today.md: What is still missing
- [TD-04] Activity filters by job and by record are not built (only state, person, day) — frame-today — BUILDABLE — CHAUSAR-APP-DESIGN.md: TD-04; frame-today.md: How a person uses it
- [TD-04] Activity types not served: lesson decided, backup done, update checked, lock, unlock — frame-today — BUILDABLE (core edit: audit events in engine.ts) — frame-today.md: What is still missing
- [FR-10] The sharing question in first run is not built: no journey step and no UI references FR-10 (`learningx.consent`/`preview`/`intakeStatus` exist) — frame-today — BUILDABLE — CHAUSAR-APP-DESIGN.md: FR-10; learning-ext.md ("draws no screens"); code search
- [FR-14] Joining a workspace from another computer is claimed by no lane and not built (`seats.inviteVerify`, `devices.join` absent) — frame-today + core — BUILDABLE (core edit: auth.ts/sync.ts) — CHAUSAR-APP-DESIGN.md: FR-14; code search
- [FR-07/BK-04/FR-13] There is no native file picker (`imports.pickFile`). As a result:
  - BK-04 cannot be reached from a place, because FR-07 needs the host's file picker and journey port;
  - FR-13 cannot pick a backup file.

  — frame-today — BUILDABLE (desktop IPC; expose FR-07 to places) — connectors-ext.md: Not built here; work-books.md: audit BK-04; frame-today.md: §3 (FR-13 row)
- [FR-07] Encrypted workbooks have no password path (`readWorkbook` refuses them) — frame-today — BUILDABLE (core edit: platform/runtime/workbook.ts) — frame-today.md: §3 table + Round 2 Screens (FR-07 sheets)
- [FR-07] Proposed meanings work for CSV only; Excel would need the sheet's text sent to learning-ext — frame-today — BUILDABLE — frame-today.md: What is still missing (FR-11 gaps bullet)
- [FR-07] The PDF statement flow has not been run end to end from the screen against the real engine module — frame-today — BUILDABLE — frame-today.md: Round 2 Screens (FR-07 PDFs, "Experimental")
- [PH-05] There is no desktop "Awaiting your review" row for a document sent from the phone; `phone.documents.*` has no UI caller — frame-today (with hosted-link) — BUILDABLE — frame-today.md: What is still missing; hosted-link.md: Engine table; code search
- [layout] The narrow layout (1024–1315, under 1024, down to 360) is checked only at 1366 and 1024 — frame-today — BUILDABLE — frame-today.md: §1 table
- [UI policy] Words at rest are over the limit: 42 findings, 11 distinct. Simple Today shows 96 (English) and 102 (Hindi) of 90; empty Guided Today 123 of 120; Simple first run 106/115; several Hindi pages 92–106 — frame-today — BUILDABLE — frame-today.md: §7 + What is still missing
- [visual] Comparison with the 19 reference pictures is by eye only, not by pixels — frame-today — BUILDABLE — frame-today.md: What is still missing
- [FR-04] The printed recovery kit has not been checked as a saved PDF — frame-today — BUILDABLE (Electron printToPDF) — frame-today.md: What is still missing (Shell)
- [fake engine] The fake engine does not serve `learningx`; previews register fixtures instead — frame-today — BUILDABLE (low) — frame-today.md: What is still missing

**NEEDS-FOUNDER**
- [SH-02] Windows Hello / Touch ID unlock: no native provider is wired — frame-today — NEEDS-FOUNDER (real Windows/macOS machine with biometrics) — frame-today.md: §1 table
- [FR-03] The disk check has not been tested on real Windows, macOS or Linux disks; BitLocker needs elevation — frame-today — NEEDS-FOUNDER (real machines) — frame-today.md: Round 2 table
- [FR-13] The recovery contact cannot confirm until the hosted relay is deployed — frame-today — NEEDS-FOUNDER (deployment) — frame-today.md: Round 2 boundary
- [FR-11] `IDEA_RANGES` ships empty; a person must check official sources (registration and licence fees) and add dated rows — frame-today — NEEDS-FOUNDER (sourced real-world data) — frame-today.md: §3 FR-11 + What is still missing
- [FR-04] The recovery kit has not been printed on a real printer — frame-today — NEEDS-FOUNDER (hardware) — frame-today.md: What is still missing
- [a11y] No screen-reader pass — frame-today — NEEDS-FOUNDER (human run with NVDA/VoiceOver on a real OS) — frame-today.md: What is still missing
- [Hindi] Hindi text needs a native reader — frame-today — NEEDS-FOUNDER (native Hindi speaker) — frame-today.md: What is still missing
- [PH-04] The phone page is not built — frame-today/hosted-link — NEEDS-FOUNDER (founder decision, after day 10) — frame-today.md; hosted-link.md: Gaps
- [CA-01..CA-11] The CA console is claimed by no lane; only `patterns/FirmTable.tsx` exists for CA-01 — none — NEEDS-FOUNDER (after day 10; hosting and client-consent decision) — CHAUSAR-APP-DESIGN.md: §9 The CA console

---

## ask

**BUILDABLE**
- [AS-05] The receipt lacks:
  - recipe "accepted by", meaning reviewer and co-signer;
  - the forecast method (it sits on the forecast page);
  - the Allowed-by rule id and deciding check.

  — ask (plus the core group item) — BUILDABLE (core edit: ontology/import records) — ask.md: Audit AS-05
- [AS-08] Not yet has no "needs data: …" reason — ask — BUILDABLE — ask.md: Audit AS-08
- [AS-08/RP-08] Not yet does not link to Ask a person, although `reportsx.askPerson` exists and RP-08 is met — ask — BUILDABLE — ask.md: Audit AS-08; reports-tools-trust.md: audit RP-08
- [AS-09] The rule's own text needs `trust.explain`, which is not built anywhere; the screen shows a fixed kind sentence — ask (method owned by reports-tools-trust) — BUILDABLE — ask.md: Audit AS-09 + Cross-lane assumptions
- [AS-11] The What-if form has no branch picker; the engine already takes `branch` — ask — BUILDABLE — ask.md: Audit AS-11
- [AS-19] A GSTR-2B line opens its two source rows, not a calculator receipt; group and line amounts are text, not figures — ask (plus the core receipt item) — BUILDABLE — ask.md: Audit AS-19
- [AS-19] `TWO_B_KINDS`/`key()` in platform/runtime/ask/gst2b.ts assume the shape kind gstr2b with gstin/invoiceId/amountMinor/taxMinor. Check this against what connectors-ext's GSTR-2B recipes actually write — ask — BUILDABLE (integration test) — ask.md: Labels + Cross-lane assumptions
- [AS-04] The two meanings of "sales" come as one question back, not as two answers side by side — ask — BUILDABLE (low) — ask.md: Audit AS-04
- [BK-17/SH-04] Nothing calls `books.memoryPropose` for statements typed on the ask line — ask — BUILDABLE — work-books.md: Still missing + audit BK-17; code search (no caller)
- [receipts] Asking about another member's receipt id says "stopped by a rule", while an unknown id says "not found", so the two can be told apart — ask — BUILDABLE (low) — ask.md: Still missing

**NEEDS-FOUNDER**
- [AS-07] `askx.sent` for a model-written answer is experimental — ask — NEEDS-FOUNDER (live model route/key) — ask.md: Labels
- [AS-15] `askx.decisions.forward` (from the phone) is experimental — ask — NEEDS-FOUNDER (hosted phone channel deployed) — ask.md: Labels
- [AS-19] Has not been checked against real GSTR-2B portal files — ask — NEEDS-FOUNDER (real data) — ask.md: Labels

---

## work-books

**BUILDABLE**
- [BK-11] Account-class proposals from learning never appear. `books-accounts.ts:99` calls `learningx.accountsProposals`, which is not registered; learning-ext has `accountsPropose`/`accountsList` — work-books (+learning-ext) — BUILDABLE — platform/runtime/work-books/books-accounts.ts:99; learning-ext.md: Engine methods; work-books.md: audit BK-11
- [WK-09] Start a job lists only core owner-brief templates. The jobs-ext ready-made jobs (receivables-week, cash-position, weekly-close, stock-check, gst-matching) cannot be picked; there is no `jobsx.types`/`jobsx.card` caller, so they are reachable only via "from one sentence" — work-books — BUILDABLE — work-books.md: approvals.jobTemplates; jobs-ext.md: Ready-made jobs; code search
- [procedures] No screen or queue item for `procedures.*` (propose, approve the exact digest, reject, retire, routed share and cost), though LANES §7 has Work call them — work-books — BUILDABLE — LANES.md: §7 work-books; jobs-ext.md: How it works (Procedures); code search
- [learning-ext edits] No screen or queue item for:
  - dictionary edits (`learningx.editsPropose`, `edits`, `editApprove`, `editReject`);
  - first-dictionary adoption (`dictionaryAdopt`);
  - the answer key (`answerKey`, `answerKeySet`);
  - account model asks.

  — work-books — BUILDABLE — learning-ext.md: intro ("the Meanings screens and the approvals queue (work-books) call the methods"); code search
- [jobs-ext controls] Nothing on screen calls `jobsx.detect` (propose on request), `jobsx.stopRules`/`setStopRules` (set aside after N failures), `jobsx.templateSkill` (export SKILL.md), `jobsx.budget` or `jobsx.missed.seen` — work-books — BUILDABLE — jobs-ext.md: What a person can do + Engine methods; code search
- [WK-06/write grants] No screen connects a write system or grants writing action by action (`writeback.connect`, `grant`, `credentials.set`, `configure`, `qualifySandbox` have no caller) — work-books — BUILDABLE — writeback.md: What a person can do §2; LANES.md: §7 work-books; code search
- [BK-02/BK-03] No screen for `connectorsx.schedule` (repeating reads) or `connectorsx.plainDb.tables`/`read` (the database road) — work-books — BUILDABLE — connectors-ext.md: Engine methods + Scheduled refresh; code search
- [WK-14] No lane provides `session.*`; `work-driving.ts` calls status, windows, start, resume and stop. The contract and a driver need building — work-books + core/desktop — BUILDABLE (new engine family, desktop main.cjs) — work-books.md: audit WK-14 + Still missing
- [BK-03] "Which company?" is typed by hand. Connectors-ext's Tally adapter already has a "list companies" read, but it is not wired — work-books — BUILDABLE — work-books.md: audit BK-03; connectors-ext.md: Read adapters table
- [BK-02] Not drawn: where refused files are kept, the sign-in path before pressing the button, and the data's age — work-books — BUILDABLE — work-books.md: audit BK-02
- [BK-05] Missing:
  - answering a recipe question in place (`recipes.answer`);
  - a version diff (`recipes.upgradeDiff`);
  - `recipes.reconcile`;
  - "who accepted" on seed recipes;
  - tax registration in the recipe's scope.

  — work-books + connectors-ext — BUILDABLE — work-books.md: audit BK-05 + Still missing
- [BK-09] Publishing a copy uses the prospective strategy only — work-books — BUILDABLE — work-books.md: Still missing
- [BK-12] The record's time line shows invoices and payments only, not reminders or notes. Asking about the record needs frame-today's "about" context — work-books — BUILDABLE — work-books.md: audit BK-12
- [BK-15] History does not draw the demo clock state — work-books — BUILDABLE — work-books.md: audit BK-15
- [WK-02] Practice exists only for write-back actions; core actions have no practice systems — work-books — BUILDABLE — work-books.md: audit WK-02
- [WK-03] Each grouped item shows its outcome word, not its own five-step strip — work-books — BUILDABLE — work-books.md: audit WK-03
- [WK-08] Not drawn apart: a local model "priced at zero with its minutes", and an untested route (shown only as a time-line line). A child task's missing result is not built — work-books — BUILDABLE — work-books.md: audit WK-08
- [WK-12] Reminders:
  - `approvals.prepareReminder` has no screen entry point;
  - "Record the agreement" opens Customers, not the exact record (write-back's customer id is the connected system's);
  - no screen changes the caps (Trust's job);
  - the caps line ignores write-back's configured time zone.

  — work-books — BUILDABLE — work-books.md: Still missing + audit WK-12
- [WK-13/BK-18] Bill photo:
  - the outline is the line's band, because the helper's `pdf.ocr` gives lines, not word boxes;
  - only page 1 is outlined;
  - the Zoho vendor id is typed by hand;
  - tesseract has never been run for real.

  — work-books — BUILDABLE (platform/helpers/analytics.py change; install tesseract) — work-books.md: Still missing (Bill photo)
- [WK-08/10/11/16] Lane-job questions, person steps, edit, missed-run rule and lane accept are tested only against stubs copied from jobs-ext — work-books — BUILDABLE (tests through the real merged engine) — work-books.md: Still missing

**NEEDS-FOUNDER**
- [WK-13/BK-18] The Zoho Books bill route has not been run against a real Zoho account — work-books — NEEDS-FOUNDER (account) — work-books.md: Supported and experimental
- [WK-14] Real screen driving of Tally or other desktop apps — work-books — NEEDS-FOUNDER (real Windows machine with the target apps) — work-books.md: audit WK-14

---

## reports-tools-trust

**BUILDABLE**
- [TR-08] Route order cannot be set; there is no `models.setLadder` — reports-tools-trust — BUILDABLE — reports-tools-trust.md: audit TR-08
- [TR-08] No route comparison table, although `bench.*` exists with no UI caller — reports-tools-trust — BUILDABLE — reports-tools-trust.md: audit TR-08; code search
- [TR-08] No screen for the FX rate or pricing (`modelsx.catalogue`, `setFx`, `setPrice`, `applyPricing`, `cost`; models-ext says Trust · Models shows them) — reports-tools-trust — BUILDABLE — models-ext.md: How a person uses it; code search
- [TR-08/SH-05] The voice row is read-only. Choosing the speech provider and its key (`speech.configure`, `modelsx.speechCatalogue`, `speechRevoke`) is not on screen — reports-tools-trust — BUILDABLE — CHAUSAR-APP-DESIGN.md: SH-05 Rules / TR-08; app/ui/src/screens/trust/Models.tsx
- [TR-12/SH-07] Vault's "This computer" section is incomplete — reports-tools-trust (engine: jobs-ext/release) — BUILDABLE — CHAUSAR-APP-DESIGN.md: TR-12/SH-07; code search:
  - start at login: no method anywhere;
  - background mode: `jobsx.setBackground` has no UI caller (only `service.install` is drawn);
  - wake for jobs: words only.
- [TR-12] Open item from the audit: "restore from the lock screen" — reports-tools-trust — BUILDABLE — reports-tools-trust.md: audit TR-12
- [TR-12] No screen for hosted backup upload, list, restore or key export (`hosted.backup.*`) — reports-tools-trust — BUILDABLE — hosted-link.md: Engine table; code search
- [TR-14] No engine sends "plan ended": `trustx.hosted` plan is fixed at "planned-not-available" and `hosted.status` plan/entitlements are not read. `hosted.worker.*` (always-on jobs consent) has no screen — reports-tools-trust — BUILDABLE — reports-tools-trust.md: audit TR-14; hosted-link.md: Engine table
- [TR-07] No screen for Drive sync connect, status or disconnect (`hosted.drive.*`) — reports-tools-trust — BUILDABLE — hosted-link.md: Engine table; code search
- [Trust · keys] No screen for connector credentials (`connectorsx.credentials.set`/`remove`/`status`), though connectors-ext says keys are typed in Trust — reports-tools-trust — BUILDABLE — connectors-ext.md: Engine methods; code search
- [allowance] No screen for the allowance route (`modelsx.connectAllowance`, `hosted.allowance.status`, `hosted.allowanceRevoke`) — reports-tools-trust — BUILDABLE — models-ext.md + hosted-link.md: Cross-lane contracts; code search
- [TL-09] The mail channel always says "not checked", though `phone.verify {channel:'mail'}` exists. Cost is a month total only — reports-tools-trust — BUILDABLE — reports-tools-trust.md: audit TL-09; app/ui/src/screens/tools/Phone.tsx:49; hosted-link.md: phone.verify
- [TL-02] The small app runs in a sandboxed box, not a separate-origin frame; no charts or forms; action buttons send an empty payload — reports-tools-trust — BUILDABLE — reports-tools-trust.md: audit TL-02 + §4
- [TL-03] Follow-up book entries cannot be deleted or exported from the screen — reports-tools-trust — BUILDABLE — reports-tools-trust.md: audit TL-03
- [TL-06] No screen wraps a SKILL.md or an MCP tools/list into a plugin (`smallapps.pluginWrap` has no caller) — reports-tools-trust — BUILDABLE — models-ext.md: Plugins (Wrapping); code search
- [TL-07] The tool-request sheet is built but never raised; it needs the models-ext pending-request list — reports-tools-trust — BUILDABLE — reports-tools-trust.md: audit TL-07 + §4
- [plugin network door] No screen for prepare, approve-exactly-this, send once and the ledger (`smallapps.pluginPrepareRemote`, `ApproveRemote`, `CallRemote`, `RemotePreview`, `Ledger`) — reports-tools-trust — BUILDABLE — models-ext.md: Plugins (Network requests); code search
- [RP-02] Tally page export is refused (`TALLY_PAGE_EXPORT_NOT_AVAILABLE`) — reports-tools-trust — BUILDABLE — reports-tools-trust.md: §1.1 ExportedFile + audit RP-02
- [RP-02] The connector pages recalculate every time the packs list is drawn — reports-tools-trust — BUILDABLE (performance) — reports-tools-trust.md: §4 Within the lane
- [engine words] Deletion places and seat limits are matched to screen words by the engine's English sentences, not by codes — reports-tools-trust — BUILDABLE — reports-tools-trust.md: §4 Within the lane

**NEEDS-FOUNDER**
- [RP-06] A CA must check due-dates.v1.json (shipped `reviewed: false`). 10 of 25 sources could not be opened and are unconfirmed: EPFO, ESIC, Maharashtra and Karnataka professional tax, MCA, two income-tax rows. The CA also decides whether to show extensions such as CBDT Circular 07/2026 — reports-tools-trust — NEEDS-FOUNDER (CA review) — reports-tools-trust.md: §4 Needs a person
- [RP/WK-12] The 43B(h) and TReDS notes, and the MSMED/43B(h) payment notes in work-writeback.ts, need a CA or lawyer — reports-tools-trust/work-books — NEEDS-FOUNDER (CA/lawyer) — reports-tools-trust.md: §4; work-books.md: Write-back in Work (Reminders)
- [TR-08] The model terms in tools-terms.v1.json need a legal reading — reports-tools-trust — NEEDS-FOUNDER (legal reading) — reports-tools-trust.md: §4
- [TL-10/Hindi] Hindi and Hinglish words and the language packs have not been reviewed by a native reader — reports-tools-trust — NEEDS-FOUNDER (native Hindi speaker) — reports-tools-trust.md: §4 + audit TL-10
- [TL-05] The "No internet" state needs the founder's rule for checking the blocked list — reports-tools-trust — NEEDS-FOUNDER (product decision) — CHAUSAR-APP-DESIGN.md: TL-05; reports-tools-trust.md: audit TL-05
- [RP-05] Brief delivery by mail or WhatsApp depends on the hosted relay — reports-tools-trust — NEEDS-FOUNDER (deployment and WhatsApp templates) — reports-tools-trust.md: audit RP-05

---

## connectors-ext

**BUILDABLE**
- [BK-03] The exporter and one-page guide for Tally on another computer are not built — connectors-ext — BUILDABLE — work-books.md: audit BK-03 + Still missing
- [screen export] Screen-driving export is not built (`SCREEN_EXPORT_NOT_BUILT`); it pairs with WK-14 `session.*` — connectors-ext — BUILDABLE (desktop driver) — connectors-ext.md: Boundaries
- [Zoho Books] Net reads are capped at 59 invoices per read; larger periods must be read in parts by hand — connectors-ext — BUILDABLE (split automatically) — connectors-ext.md: Known gaps
- [declared totals] A `declared` total with a count but no amount still needs a typed report total — connectors-ext — BUILDABLE (low; source-dependent) — connectors-ext.md: Known gaps
- [FR-07] `imports.installReader` always refuses. The release must bundle Python with pdfplumber, pypdfium2 and Pillow, plus tesseract with English data — connectors-ext/release — BUILDABLE (Linux staging) — connectors-ext.md: FR-07 contract (`imports.installReader`)
- [FR-07] `imports.readerStatus.sizeBytes` is always null — connectors-ext — BUILDABLE (low) — connectors-ext.md: FR-07 contract (`imports.readerStatus`)

**NEEDS-FOUNDER**
- [layouts] 26 export layouts are unconfirmed; each needs a real export from a user or a made-to-order book — connectors-ext — NEEDS-FOUNDER (sourced real data) — connectors-ext.md: Export layouts + Known gaps
- [live reads] No live account was used. Never run live: Tally, Zoho Books and CRM, Xero, QuickBooks, Razorpay, Stripe, Cashfree, PayU, Shopify, WooCommerce, Google, HubSpot — connectors-ext — NEEDS-FOUNDER (accounts) — connectors-ext.md: Read adapters + Boundaries
- [sign-in] OAuth sign-in apps or a sign-in helper must be registered (`OAUTH_CLIENT_REQUIRED`) — connectors-ext — NEEDS-FOUNDER (product decision and accounts) — connectors-ext.md: Boundaries
- [Google Calendar] `calendar.readonly` needs Google's app verification — connectors-ext — NEEDS-FOUNDER — connectors-ext.md: Boundaries
- [GST live] Live e-invoice and e-way bill reads need a licensed GST service provider — connectors-ext — NEEDS-FOUNDER — connectors-ext.md: Boundaries
- [labels] Nothing moves to "supported" without the bench and a hidden business run by a person — connectors-ext — NEEDS-FOUNDER (hidden businesses) — connectors-ext.md: intro + Boundaries

---

## writeback

**NEEDS-FOUNDER** (no remaining buildable items in this lane; its second-ask and screen items sit in core and work-books)
- [adapters] No adapter has run against its real system: Tally, Zoho Books, Razorpay, Shopify, Google Workspace, WhatsApp Cloud, SMTP/IMAP — writeback — NEEDS-FOUNDER (accounts) — writeback.md: Supported and experimental
- [live rows] Promoting the four planned-live rows needs a sandbox run (`qualifySandbox`) on the Zoho trial organisation, the test sheet and the test mailbox — writeback — NEEDS-FOUNDER (sandbox accounts) — writeback.md: Status + What still needs a person + Gaps
- [sign-ins] Zoho, Google and Shopify OAuth apps, Razorpay keys, and Meta WhatsApp verification with template approval — writeback — NEEDS-FOUNDER — writeback.md: What still needs a person
- [catalogue] Whether `zoho-books payment.record` stays an undoable change (tier 2) or becomes money — writeback — NEEDS-FOUNDER (product decision) — writeback.md: Decisions for the founder
- [Drive] The multipart base64 upload is untested against live Google Drive — writeback — NEEDS-FOUNDER (account) — writeback.md: Gaps
- [WhatsApp read-back] A WhatsApp send stays "not sure" until the relay's status callbacks are deployed — writeback — NEEDS-FOUNDER (deployment) — writeback.md: Gaps

---

## jobs-ext

**BUILDABLE**
- [budgets] Model costs from models-ext never arrive: `jobs-ext/adapters.ts:48` calls `modelsx.price`, which models-ext does not register (it has `cost`, `meters`, `jobCost`). Budgets fall back to host prices — jobs-ext (+models-ext) — BUILDABLE — platform/runtime/jobs-ext/adapters.ts:48; jobs-ext.md: Cross-lane assumptions; models-ext.md: Cross-lane assumptions
- [TR-05] There is no daily amount limit; Do limits by count only — jobs-ext — BUILDABLE — reports-tools-trust.md: §4 + audit TR-05
- [gst-matching] Still labelled "refused until the connectors method exists", but `connectorsx.gstMatch` is now registered. Needs an end-to-end test and a relabel — jobs-ext — BUILDABLE — jobs-ext.md: Supported and experimental

**NEEDS-FOUNDER**
- [reminders] Real reminders need a live or sandbox mail or WhatsApp connection with a writeback grant — jobs-ext — NEEDS-FOUNDER (account) — jobs-ext.md: Still missing
- [always-on] Always-on jobs while every laptop is closed, and the home box — jobs-ext — NEEDS-FOUNDER (paid hosting and product decision) — jobs-ext.md: Supported and experimental + Still missing
- [live agent] The live gateway agent and procedures have not run with a live provider; an imported skill as a job needs an agent route — jobs-ext — NEEDS-FOUNDER (paid key) — jobs-ext.md: Supported and experimental

---

## learning-ext

**BUILDABLE**
- [sharing] A residual covert channel remains: the count of each distinct event in a batch — learning-ext — BUILDABLE (low) — learning-ext.md: Round 2 (smuggling review)

**NEEDS-FOUNDER**
- [intake] Deploying the intake needs a domain, certificate, hosting and PostgreSQL (`INTAKE_NOT_OPEN`) — learning-ext — NEEDS-FOUNDER (deployment) — learning-ext.md: Still missing
- [consent] The consent text needs a lawyer. The two extra boxes need the founder switch. Open founder questions: licence, credits, who may agree — learning-ext — NEEDS-FOUNDER (legal reading and decisions) — learning-ext.md: Still missing; learning-consent-draft.md: §7–8
- [samples] Uploading cleaned samples waits for a reviewed receiving service — learning-ext — NEEDS-FOUNDER — learning-ext.md: Still missing
- [ladder] Step 3 training needs about 20,000 checked labels; step 4 is not built — learning-ext — NEEDS-FOUNDER (sourced data) — learning-ext.md: Still missing
- [library] A shared recipe library across businesses needs the deployed intake and a reviewed qualification step; lookup quality is unproven while the library is small — learning-ext — NEEDS-FOUNDER — learning-ext.md: Still missing + Supported and experimental
- [model routes] Accounts sorting and dictionary edits have not run with a live provider — learning-ext — NEEDS-FOUNDER (paid key) — learning-ext.md: Supported and experimental

---

## hosted-link

**BUILDABLE**
- [FR-13/SH-02] There is no recovery-contact confirmation method on the relay, so `todayx.recoveryContact.request` refuses until one exists — hosted-link — BUILDABLE (code; the deployment itself is a founder item) — frame-today.md: Round 2 boundary
- [PH-05] PDF and photo documents cannot be previewed (`DOCUMENT_PREVIEW_UNAVAILABLE`). They could go through connectors-ext `imports.preview` and `books.billRead` — hosted-link — BUILDABLE — hosted-link.md: Gaps
- [TR-09/TL-09] There is no log of messages whose result was lost — hosted-link — BUILDABLE — reports-tools-trust.md: §4 Other lanes
- [mail STOP] STOP by mail trusts the From address — hosted-link — BUILDABLE (low) — hosted-link.md: Gaps

**NEEDS-FOUNDER**
- [deploy] Nothing is deployed: a host in India, a link domain with no digit, TLS — hosted-link — NEEDS-FOUNDER (hosting) — hosted-link.md: What still needs a person
- [OTP] Twilio account with DLT registration — hosted-link — NEEDS-FOUNDER (account) — hosted-link.md: What still needs a person
- [billing] Razorpay account, plan and webhook; the plan price (`PRICE_NOT_SET`) — hosted-link — NEEDS-FOUNDER — hosted-link.md: What still needs a person
- [channels] Meta business verification, the WhatsApp number and approval of 4 templates; a written reading of WhatsApp's terms; the Telegram bot; Postmark sending domain and inbound credentials — hosted-link — NEEDS-FOUNDER — hosted-link.md: What still needs a person + labels table
- [allowance and cost] Provider keys and a checked, dated pricing table; the per-message price table (cost shows "unknown") — hosted-link — NEEDS-FOUNDER — hosted-link.md: What still needs a person
- [Drive] Google OAuth app verification for the Drive transport — hosted-link — NEEDS-FOUNDER — hosted-link.md: What still needs a person
- [Drive sync] In the installed app, `sync.enable` refuses `SYNC_WRITER_ADMISSION_REQUIRED`: `worker.ts` passes no sync options, and configured sync trips core gates — hosted-link/core — NEEDS-FOUNDER (the doc calls it a core and product decision; core edits follow) — hosted-link.md: Gaps

---

## release

**BUILDABLE**
- [staging] The `stage-runtime.ts` inventory should exclude dotfiles, and `runtime-binaries/.gitignore` should not be packaged; `inventoryFiles()` still includes them — release — BUILDABLE — release.md: Real Linux runs (Dotfiles note); scripts/release/stage-runtime.ts:231
- [launcher] The Windows launcher (`chausar-launcher.cmd`) is documented but not built — release — BUILDABLE (writing it; running it needs Windows) — release.md: Still missing + Launcher design
- [PostgreSQL] The orphaned-backend sweep after a crash is Linux-only; macOS and Windows still fail with `POSTGRES_START_FAILED` — release — BUILDABLE (code) — release.md: What this does not prove
- [PostgreSQL] The theseus-rs Linux build links system OpenSSL, libxml2, zstd, lz4, GSSAPI and zlib and needs glibc 2.34+ — release — BUILDABLE (vendor the libraries or pin a relocatable build) — release.md: Still missing + What this does not prove
- [PostgreSQL] No relocatable PostgreSQL 16 archive is pinned for the upgrade's old runtime, and the `postgres-<major>/bin` layout also needs `lib/` — release — BUILDABLE — release.md: What this does not prove
- [Python] Staged Python has been launched but not exercised. The PDF reader packages and tesseract need bundling (pairs with `imports.installReader`) — release — BUILDABLE — release.md: What this does not prove; connectors-ext.md: FR-07 contract
- [pins] Windows and macOS PostgreSQL and Python SHA-256 pins (`RUNTIME_SOURCE_UNPINNED`) — release — BUILDABLE. release.md lists these as founder-waiting, but they can be hashed and checked against publisher checksums exactly as was done for Linux — release.md: What waits for the founder
- [wake] The OS wake timer behind `jobsx.setWake` (refuses `WAKE_TIMER_UNAVAILABLE`) — release — BUILDABLE (code; verifying needs real OSes) — jobs-ext.md: Still missing
- [enterprise] One writer per workspace: there are no active-active engines behind the HTTPS front ends — release — BUILDABLE (core edit: engine.ts/storage; large) — release.md: Real Linux runs, enterprise (What could not run)
- [enterprise] The identity map (`identities.json`) lives on one server's disk — release — BUILDABLE — release.md: Still missing + enterprise section
- [enterprise] Private token search (`PostgresInvestigationSearch`) accepts only a loopback database — release — BUILDABLE (core edit: platform/runtime/investigation-search.ts) — release.md: enterprise (What could not run)
- [public copy] Three private-detail markers in `platform/runtime/invoice-follow-up.md` — release — BUILDABLE — release.md: Still missing
- [keychain] Run the Linux libsecret provider against a real Secret Service store — release — BUILDABLE (container with dbus and a keyring) — release.md: Build list (Native keychain providers)

**NEEDS-FOUNDER**
- [signing] Windows code-signing certificate in a cloud key service, signer settings and publisher name (`WINDOWS_SIGNING_UNCONFIGURED`) — release — NEEDS-FOUNDER (certificate) — release.md: What waits for the founder
- [signing] Apple Developer ID and notarization credentials (`MAC_SIGNING_IDENTITY_MISSING`) — release — NEEDS-FOUNDER — release.md: What waits for the founder
- [updates] The Ed25519 release key pair (`RELEASE_KEY_UNCONFIGURED`), and a public update feed and artifact host (GitHub release URLs redirect) — release — NEEDS-FOUNDER (key and hosting) — release.md: What waits for the founder + Still missing
- [licence] The licence choice (`LICENCE_UNDECIDED`), and what to do with the npm author's email in package-lock.json — release — NEEDS-FOUNDER (decision) — release.md: What waits for the founder + Still missing
- [CI] The release CI and the Windows/macOS packaging have never run on GitHub — release — NEEDS-FOUNDER (GitHub Actions with secrets on real Windows/macOS runners) — release.md: Build list
- [OS runs] Nothing has run on Windows or macOS: installer, signing, keychain store, service manager, launcher. On Linux, nothing ran with Chromium's sandbox as a non-root user, under FUSE (AppImage), or through a power cut — release — NEEDS-FOUNDER (real machines) — release.md: Still missing + Could not run
- [final package] The final (non-preview) packaged app with runtime-binaries has not been built; it needs signing — release — NEEDS-FOUNDER — release.md: Could not run
- [Windows on Arm] No PostgreSQL build exists for Windows on Arm — release — NEEDS-FOUNDER (sourcing decision) — release.md: What waits for the founder
- [enterprise] Not run: a real identity provider, a managed PostgreSQL service, CI, IPv6, client-certificate authentication, deployment — release — NEEDS-FOUNDER — release.md: enterprise (What could not run)

---

## models-ext

**BUILDABLE**
- [TL-07] There is no method listing pending plugin network requests or tool requests, so the TL-07 sheet is never raised — models-ext — BUILDABLE — reports-tools-trust.md: §4 + audit TL-07
- [meters] `modelsx.meters` does not measure voice minutes or the month's spend — models-ext — BUILDABLE — reports-tools-trust.md: §4 Other lanes
- [live voice] The renderer's WebRTC client and minute-cap enforcement are not built (`LIVE_VOICE_CAP_NOT_ENFORCED`) — models-ext — BUILDABLE (code; a paid account is needed to test) — models-ext.md: Still missing
- [bench] 18 of the 50 branch/customer questions cannot run live, because the gateway offers those selectors only from workspace facts — models-ext — BUILDABLE (core edit: platform/runtime/gateway.ts) — models-ext.md: Still missing (Live comparison limits)
- [speech] A missing speech key can only be re-supplied by reconfiguring, which moves the revision and voids earlier previews — models-ext — BUILDABLE — models-ext.md: Still missing
- [plugins] Remote MCP servers are not spoken to over the MCP protocol, only through declared HTTPS requests — models-ext — BUILDABLE — models-ext.md: Still missing
- [plugins] The plugin network door has been tested only against an injected fake transport — models-ext — BUILDABLE (test against a real HTTPS endpoint) — models-ext.md: Labels
- [small apps] Confirm the writeback contract assumed in `smallapps/catalogue-adapter.ts` against merged writeback's shapes — models-ext — BUILDABLE — models-ext.md: Cross-lane assumptions + Still missing

**NEEDS-FOUNDER**
- [routes] Paid accounts: OpenAI, Anthropic, SubQ, Sarvam, Bhashini (integrator ID and ULCA key), OpenAI realtime — models-ext — NEEDS-FOUNDER (accounts) — models-ext.md: Still missing
- [bench] Real recorded transcripts need paid keys and installed CLIs (platform/benchmarks/routes/README.md). The Claude CLI cannot qualify without host evidence — models-ext — NEEDS-FOUNDER — models-ext.md: Still missing
- [speech] Real speech clips must be recorded for the clip bench — models-ext — NEEDS-FOUNDER (human recording) — models-ext.md: Still missing
- [prices] The SubQ price comes from a third-party listing and is unverified — models-ext — NEEDS-FOUNDER (sourced data) — models-ext.md: Still missing
- [plugins] A production publisher signing key must be created and held; recipe checks inside plugins need evidence supplied by a person — models-ext — NEEDS-FOUNDER — models-ext.md: Still missing

---

## Unregistered spec engine methods, by screen

Names from each spec "Engine:" line that are in no lane registry, no engine.ts case label and no ipc METHODS list. "→ X" gives the nearest registered method I found; **NONE** means I found no equivalent. Screens left out had every name registered: WK-02, WK-03, BK-15, BK-16, TL-04, TL-10. AS-03, WK-16, BK-04, BK-18, TL-07 and PH-01..PH-05 have no Engine line.

- **SH-01**: capabilities→todayx.capabilities; workspaces.current→workspace.status; trust.leftToday→todayx.status; sources.freshness→todayx.status/connectorsx.freshness; models.current→todayx.status; review.count→today.review; approvals.count→approvals.list counts; events.subscribe **NONE**
- **SH-02**: vault.status→workspace.status; vault.unlock→workspace.open; vault.unlockWithDevice **NONE**; vault.lock→workspace.lock; vault.lockSettings→todayx.lock.settings/trustx.setLock; vault.recoveryContact→todayx.recoveryContact.*; seats.onThisComputer **NONE**
- **SH-03**: session.status **NONE**; history.clock/setClock/advanceClock→todayx.shell/todayx.clock.set/advance; devices.pen **NONE**; actions.afterRestore→approvals.afterRestore; jobs.background→jobsx.background; network.online **NONE**
- **SH-04**: ask.suggest→askx.suggest; ask.question→askx.understand; ask.stop **NONE**; ask.menu→askx.menu; memory.propose→books.memoryPropose; models.spend→trustx.models; models.setCap→trustx.setModelCap; voice.start **NONE**; voice.stop **NONE**
- **SH-05**: voice.status **NONE**; voice.start **NONE**; voice.stop **NONE**; voice.confirm→modelsx.speechConfirm; voice.dropNote **NONE**; voice.providers→speech.list/modelsx.speechCatalogue; voice.speak **NONE**; voice.stopSpeaking **NONE**; voice.usage **NONE**
- **SH-06**: workspaces.list→todayx.workspaces; workspaces.switch **NONE**; workspaces.create→workspace.create; shell.setView/shell.setLanguage→todayx.device.set
- **SH-07**: jobs.background/jobs.setBackground→jobsx.background/setBackground; approvals.count→approvals.list counts; shell.startAtLogin **NONE**; jobs.setWake→jobsx.setWake (always refuses)
- **SH-08**: updates.check→release.checkUpdate; updates.apply→release.applyUpdate; updates.notes **NONE**
- **SH-09**: models.routes→models.list/modelsx.catalogue; models.connect→models.configure; models.probe **NONE** (core models.test exists)
- **SH-10**: shell.openExternal → narrow IPC (not an engine method)
- **SH-11**: support.faultReport→todayx.faultReport; support.saveFaultReport **NONE**; support.crashReport **NONE**
- **SH-12**: support.offlineList→todayx.help
- **SH-13**: capabilities→todayx.capabilities
- **FR-01**: vault.status→workspace.status; workspaces.list→todayx.workspaces; shell.setLanguage/shell.setView→todayx.device.set
- **FR-02**: onboarding.saveIdentity→todayx.identity.save; dictionary.gstMode→todayx.identity.save (GST mode)/books.gst
- **FR-03**: vault.create→workspace.create; vault.diskCheck→todayx.diskCheck
- **FR-04**: vault.create→workspace.create; shell.print → narrow IPC
- **FR-05**: models.routes→models.list; models.connect→models.configure; models.setLadder **NONE**; models.cards→modelsx.catalogue/trustx.models; models.saveKey→models.configure; models.localList **NONE**
- **FR-06**: packs.list→ontology.packs/books.packs; packs.choose→ontology.publish (the FR-06/08 slice)
- **FR-07**: imports.pickFile **NONE**; dictionary.proposals→learningx.dictionaryProposals
- **FR-08**: recipes.proposals→learningx.recipePropose/books.recipes; dictionary.proposals→learningx.dictionaryProposals; accounts.proposals→accounts.list/learningx.accountsPropose; recipes.decide→books.decideProposal; dictionary.decide→ontology.publish/learningx.dictionaryAdopt; onboarding.blocked→todayx.firstRun.status; trust.leftToday→todayx.status
- **FR-09**: ask.menu→askx.menu; ask.question→askx.understand; ask.receipt→askx.receipt (FR-09 uses calculation.run/receipts.get)
- **FR-10**: sharing.consent→learningx.consent; sharing.preview→learningx.preview; sharing.intakeStatus→learningx.intakeStatus (no first-run screen)
- **FR-11**: onboarding.describeIdea/draft/correctClaim→todayx.idea.start/tell/get/correct
- **FR-12**: onboarding.setupChecklist→todayx.setupChecklist
- **FR-13**: vault.unlockWithKit→workspace.recover; vault.restore→workspace.restore; vault.recoveryContact→todayx.recoveryContact.request (refuses)
- **FR-14**: seats.inviteVerify **NONE**; devices.join **NONE**
- **TD-01**: review.list→today.review; review.count→today.review; briefs.daily→today.get; briefs.tiles→today.prepareTiles; activity.day→todayx.activity; calendar.due→reportsx.due; decisions.inbox→askx.decisions.inbox; events.subscribe **NONE**
- **TD-02**: briefs.saveClosing **NONE** (todayx.closing.set only switches closing on/off)
- **TD-03**: review.list→today.review; reports.closeStatus **NONE**; events.subscribe **NONE**
- **TD-04**: activity.day→todayx.activity; events.subscribe **NONE**
- **AS-01**: ask.menu→askx.menu; ask.suggest→askx.suggest
- **AS-02**: ask.question→askx.understand; ask.run→askx.run; ask.change **NONE**
- **AS-04**: ask.run/ask.answer/ask.receipt→askx.run/answer/receipt; ask.guardList→askx.guard; ask.save→askx.save; checks.saveAsCheck→askx.checks.save
- **AS-05**: ask.receipt/ask.sourceRows/ask.sent→askx.*; reports.export→askx.receipt.export
- **AS-06**: ask.sourceRows→askx.sourceRows
- **AS-07**: ask.sent→askx.sent
- **AS-08**: ask.question→askx.understand; ask.wanted→askx.wanted; support.askAPerson→reportsx.askPerson (not linked from Ask)
- **AS-09**: ask.question→askx.understand; trust.explain **NONE**
- **AS-10**: investigations.start→askx.why.start; decisions.capture→askx.decisions.draft
- **AS-11**: scenarios.compare→askx.whatIf
- **AS-12**: forecasts.run→askx.forecast/forecasts.evaluate
- **AS-13**: scenarios.optimise→askx.plan
- **AS-14**: ask.saved→askx.saved
- **AS-15**: decisions.capture→askx.decisions.draft; decisions.confirm/inbox/get→askx.decisions.confirm/inbox/get
- **AS-16**: checks.list/checks.run→askx.checks.list/run; checks.results→askx.checks.get
- **AS-17**: ask.wanted→askx.wanted; actions.wanted→approvals.wantedList
- **AS-18**: investigations.search→askx.search
- **AS-19**: gst.match2b→askx.gst2b; gst.imsList→askx.gst2b.exportIms; gst.setTolerance→askx.gst2b.tolerance; ask.receipt→askx.receipt
- **WK-01**: events.subscribe **NONE**
- **WK-04**: actions.get→approvals.action; actions.resolveUnknown→approvals.resolveUnknown; events.subscribe **NONE**
- **WK-05**: actions.ledger/get/reverse→approvals.ledger/action/reverse
- **WK-06**: actions.catalogueEntry→approvals.catalogueEntry; actions.wanted→approvals.wanted
- **WK-07**: jobs.edit→approvals.editJob; jobs.delete→approvals.deleteJob; events.subscribe **NONE**
- **WK-08**: jobs.get→approvals.job; jobs.timeline→jobsx.timeline; jobs.stop→jobs.cancel; jobs.answer→approvals.answerQuestion; jobs.edit/jobs.delete→approvals.editJob/deleteJob; budget.get→jobsx.budget
- **WK-09**: jobs.propose→approvals.proposeJob/jobsx.propose; jobs.templates→approvals.jobTemplates/jobsx.types; jobs.card→jobsx.card
- **WK-10**: jobs.result→jobsx.result/approvals.job
- **WK-11**: jobs.schedules→jobsx.schedules; jobs.setMissedRule→approvals.setMissedRule
- **WK-12**: trust.caps→writeback.settings/jobsx.caps (no edit screen)
- **WK-13**: imports.readBill→books.billRead; imports.confirmBill→books.billConfirm
- **WK-14**: session.windows, session.start, session.status, session.stop, session.resume — all **NONE** (work-books calls them)
- **WK-15**: actions.afterRestore→approvals.afterRestore; actions.resolveUnknown→approvals.resolveUnknown; deletion.reapply **NONE**
- **BK-01**: sources.coverage→books.sources; events.subscribe **NONE**
- **BK-02**: sources.get→books.source; sources.envelopes→connectorsx.envelopes; sources.readNow→books.readNow; sources.signIn→books.signIn; sources.remove→sources.delete
- **BK-03**: sources.options→books.systems; sources.add→books.connect; sources.signIn→books.signIn
- **BK-05**: recipes.get→books.recipe; recipes.proposals→books.recipes; recipes.decide→books.decideProposal; recipes.questions→books.recipe (questions field); recipes.answer **NONE**; recipes.reconcile **NONE**; recipes.upgradeDiff **NONE**
- **BK-06**: sources.unmappedFields→books.unmapped
- **BK-07**: dictionary.words→books.meanings
- **BK-08**: dictionary.get→books.meaning; dictionary.draft→books.draft; dictionary.diff/dictionary.check/dictionary.history→fields of books.meaning/books.draft; dictionary.review **NONE** (no method requests an AI opinion); dictionary.publish→books.publish; dictionary.cosign→books.cosign
- **BK-09**: trial.start/compare/publish/discard→books.trial/trialRead/trialPublish/trialDiscard
- **BK-10**: packs.list→books.packs
- **BK-11**: accounts.proposals→accounts.list (its learning feed calls the unregistered learningx.accountsProposals)
- **BK-12**: records.timeline→records.get
- **BK-13**: identity.suggestions/decide/undo→records.matches/decideMatch/undoMatch; identity.rules **NONE**
- **BK-14**: conflicts.list/get→records.conflicts; conflicts.rules→records.setPrecedence
- **BK-17**: memory.edit→books.memoryEdit; memory.delete→books.forget; memory.add→books.remember; memory.propose→books.memoryPropose
- **BK-19**: dictionary.gstMode→books.gst; dictionary.rates→books.rates
- **BK-20**: deletion.request→records.delete
- **RP-01**: reports.packs/reports.pages→reportsx.packs
- **RP-02**: reports.page/reports.export→reportsx.page/export; shell.print → narrow IPC
- **RP-03**: briefs.weekAhead→reportsx.weekAhead
- **RP-04**: briefs.friday→reportsx.friday
- **RP-05**: briefs.rhythm/briefs.delivery→reportsx.rhythm/setRhythm; phone.preview→phone.templates.preview; jobs.setMissedRule→reportsx.setRhythm (missedRule)
- **RP-06**: calendar.due/calendar.rows→reportsx.due
- **RP-07**: vault.export→reportsx.exportAll; vault.exports→reportsx.exports
- **RP-08**: support.askAPerson→reportsx.askPerson; support.openQuestionFile→reportsx.openQuestion
- **TL-01**: apps.list/make/create→smallapps.list/propose/create
- **TL-02**: apps.get/view/rebuild→smallapps.get/open/rebuild
- **TL-03**: apps.view→smallapps.open; apps.act→smallapps.pressAction/records.*
- **TL-05**: plugins.inspect→trustx.inspectPlugin/smallapps.pluginInspect
- **TL-06**: plugins.wrapped→smallapps.pluginList/pluginGet; plugins.reapprove→smallapps.pluginGrant
- **TL-08**: numbers.status/pair/revoke/calls→trustx.assistants/pairAssistant/revokeAssistant
- **TL-09**: phone.channels→phone.channels.list; phone.preview→phone.templates.preview; phone.optIn→phone.channels.set; phone.usage→phone.messages.counts
- **TR-01**: trust.set→trustx.setPolicy/setSend; trust.leftToday→trustx.rules
- **TR-02**: trust.set→trustx.setPolicy; markings.list→trustx.markings; markings.set→trustx.setMarking/setSeatMarking
- **TR-03**: trust.sendLevels→trustx.sendLevels; trust.set→trustx.setSend
- **TR-04**: trust.keep→trustx.keep; vault.inventory→trustx.keep (inventory)
- **TR-05**: trust.autonomy/setAutonomy/alwaysWaits/agreement/caps→jobsx.autonomy/setAutonomy/caps/setCaps; models.setCap→trustx.setModelCap
- **TR-06**: seats.list/invite/get/remove/templates→trustx.seats/invite/removeSeat
- **TR-07**: devices.list **NONE**; devices.pen **NONE**; devices.handOver **NONE**; devices.remove **NONE**; sync.setup **NONE** (core sync.enable exists)
- **TR-08**: models.routes→trustx.models; models.cards→modelsx.catalogue; models.setLadder **NONE**; models.spend→trustx.models; models.setCap→trustx.setModelCap; models.comparison→bench.* (no screen); voice.providers→speech.list/modelsx.speechCatalogue; voice.usage **NONE**
- **TR-09**: network.ledger→trustx.network; network.canary→trustx.plantCanary/checkCanary
- **TR-10**: record.list/verify/head→trustx.record/verifyRecord
- **TR-11**: sharing.consent/preview/batches/deleteBatch/withdraw/log/intakeStatus/cleanSample→learningx.* (through trustx.sharing)
- **TR-12**: vault.backups/backupNow/testRestore→trustx.vault/backupNow/testRestore; vault.restore→workspace.restore; vault.lockSettings→trustx.setLock; vault.diskCheck→todayx.diskCheck; vault.recoveryContact→todayx.recoveryContact.*; shell.startAtLogin **NONE**; jobs.setBackground→jobsx.setBackground (no UI); jobs.setWake→jobsx.setWake (refuses)
- **TR-13**: deletion.request→trustx.deleteSource; deletion.report→trustx.deletions
- **TR-14**: trust.hosted→trustx.hosted
- **TR-15**: sharing.consentRecord→trustx.agreements

---

## Stale lane-doc items, resolved in code (left out above)

`openLink` now has callers (ReportPage, DueDates, Trust Models); `window.print()` is gone from reports; Vault places `RecoveryContactSettings`; `bootstrap.tsx` passes `frame.reads.closing` to Today; device choices, `LockFolderChoice` and `onOpenFolder` are wired; Ask › New now renders the ask lane's menu; builder.json includes app/ui/host, public and fonts and the Linux tar.gz target; `desktop-launch.mjs` accepts `--legacy-renderer`; `PDF_PAGE_LIMIT` is on the preload line; AppImage x86_64 naming is handled in desktop-package.mjs; main.cjs starts PostgreSQL through desktop-database.ts; the work contract accepts the `bill` source; write-back money uses the passphrase second ask; `ModuleHost.call` carries `{tainted}`; `ModelGateway.approveOutbound` refuses tainted contexts; `todayx.identity.check` runs before the vault (preVault).
