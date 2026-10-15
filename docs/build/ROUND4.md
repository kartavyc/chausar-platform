# Round 4: finishing everything that needs no founder input

All eleven lanes are merged into `claude/clever-goldberg-49qobq`. The full suite is green. Round 4 builds every item in [ROUND4-GAPS.md](ROUND4-GAPS.md) marked BUILDABLE. It does this across the eleven lanes plus five new ones: core-data, core-sync-jobs, core-gateway-auth, driving and ca-enterprise.

Items marked NEEDS-FOUNDER stay out of scope. Build everything up to that boundary, and keep or make the missing piece a typed refusal.

Read [LANES.md](LANES.md) first; its rules all still apply. Then read your section below. For the source and detail behind each item, read your lane's section of ROUND4-GAPS.md.

## New seams (in the base from this round)

### Your own sub-places

A lane adds rail sub-places in `app/ui/src/places/subplaces/<lane>.ts`. Each entry is `{ place, id, shells? }`, and `shells` defaults to the desktop shell. The lane names each sub-place under `SH-01.sub.<place>.<id>` in its own words file, `app/ui/src/text/lanes/<lane>.ts`, in both English and Hindi. Your new place module then draws that address.

`app/ui/tests/lane-seams.test.ts` refuses:
- a key that repeats `text/en.json` or another lane's key;
- a missing Hindi key;
- a sub-place that repeats an authored one.

### Your own words

Put any new screen words a lane needs in `app/ui/src/text/lanes/<lane>.ts` rather than in the shared JSON. They join the catalogue that `useT()` reads.

### Place modules for every UI lane

Some lanes have not drawn screens before. Each of them now has an empty place-module file, already listed in `app/ui/src/places/registry.ts`, in lookup order:

`app/ui/src/places/lane-{connectors-ext,writeback,jobs-ext,learning-ext,hosted-link,models-ext,release,driving,ca-enterprise}.tsx`

### Engine modules for the new lanes

These modules are registered with empty allowlist JSON files and empty preload lines:

`platform/runtime/modules/lane-{driving,ca-enterprise,core-data,core-sync-jobs,core-gateway-auth}.ts`

Core lanes put **new RPC methods in their module**, never in the engine's `switch`, so three core lanes never edit the same lines of `engine.ts`. Core changes stay in the core files that lane owns (listed below). If you must touch `engine.ts`, make one small, additive, fenced edit and list it.

### Refusal codes

After changing your `laneRefusals` line in `app/desktop/preload.cjs`, run `node scripts/sync-lane-refusals.mjs`.

## Who owns what this round

Each item names its lane. Where one item needs another lane's method, the owner of the method builds it first and the caller adapts, with a typed refusal until it exists. Put the exact contract in your lane doc under "Round 4 contracts".

### core-data (new)

**Owns:** `calculator.ts`, `ontology.ts`, `workbook.ts`, `trust.ts`, `mcp.ts`, the decision journal, and deletion in `vault`/engine. New methods go in `lane-core-data.ts`.

1. Exchange rates applied by the calculator (BK-19), with the not-counted count on every receipt.
2. Receipts for connector bank totals, GSTR-3B turnover and the GSTR-2B match (RP-02, AS-19).
3. A quantity measure kind and calculation (stock on hand), so the jobs-ext stock check can run.
4. Definitions gain a worked-example field and a date-used field, and release history names the reviewer (BK-08).
5. Provenance recorded and shown on receipts (AS-05 and the receipt small print):
   - recipe "accepted by";
   - meaning reviewer and co-signer;
   - forecast line;
   - decision rule id, check step and device.
6. Deletion:
   - delete one customer's core rows, meaning facts, receipts, answers, actions and conversations (BK-20; `records.delete` in work-books calls it);
   - `deletion.reapply` after a restore (WK-15).
7. Workspace time zone, stored and served:
   - a method to set it, which writes `state.workspace.timeZone`;
   - `ui.context.timeZone` serves it.

   frame-today draws the setting in first run and the settings screen.
8. Workspace delete purges `approvals.exportPrepared` files (WK-02 exports).
9. The decision journal gains a "recorded later" date and a "cancelled" state (AS-15).
10. Trust rules enforced:
    - staff see only their own (TR-06);
    - record- and field-level markings hide data, not only label it (TR-02);
    - keep periods are enforced for every kind (TR-04).
11. The MCP server removes withheld fields from answers and reports them (TL-08).
12. Encrypted Excel workbooks (ECMA-376 agile encryption) can be opened with a one-time password in `workbook.ts`. `sources.workbookPreview` and `sources.workbookImport` accept a `password` that is never stored. connectors-ext passes the password held by `imports.providePassword`.

### core-sync-jobs (new)

**Owns:** `sync.ts`, `auth.ts`, `jobs.ts`, `worker.ts`, and a new engine event bus. New methods go in `lane-core-sync-jobs.ts`.

1. Live refresh:
   - `events.subscribe`: an engine event bus;
   - its desktop status-channel delivery;
   - a `subscribe(kinds, onEvent)` prop on `PlaceRenderProps`, an additive edit to `app/ui/src/places/types.ts` (the host supplies it).

   This covers SH-01, TD-01, TD-03, TD-04, WK-01, WK-04, WK-07 and BK-01.
2. Devices (TR-07, SH-03, FR-14):
   - `devices.list`, `devices.pen`, `devices.handOver` and `devices.remove`;
   - `sync.setup`;
   - `seats.inviteVerify` and `devices.join`.

   The installed app enrols as a sync writer through the pen hand-over in the spec. `worker.ts` passes a device signing key and writer admission. Sync stays off until the owner turns it on.
3. Core jobs (WK-08, WK-09, WK-16):
   - ledger durations;
   - actions named per job;
   - a review date on the job card;
   - a method that marks a person step done;
   - child-task results.

   `worker.ts` also passes `jobCalendar`, so month-end jobs work in the installed app (WK-11).
4. Audit events for lesson decided, backup done, update checked, lock and unlock (TD-04).

### core-gateway-auth (new)

**Owns:** `gateway.ts`, `actions.ts` (second ask), `vault.ts` (secrets and PIN), `plugins.ts` (canary) and the keychain/secret store. New methods go in `lane-core-gateway-auth.ts`.

1. Gateway:
   - discard a waiting send (TR-09);
   - enforce the monthly model cap (TR-08);
   - add a "decide" purpose, limited to the offered options, for the jobs-ext deciding agent;
   - bench selectors from fixtures, so all 50 bench questions can run;
   - `models.setLadder`, `models.probe` and the route-down/sign-in-again states (SH-09, FR-05).
2. Canary coverage for plugin network calls, the learning upload and the hosted allowance client.
3. Second ask:
   - a core passphrase second ask for money actions (WK-02);
   - per-member approval secrets, so a co-founder can answer a second ask. writeback then accepts them in place of `REAUTH_OWNER_ONLY`.
4. PIN quick unlock (SH-02, TR-12):
   - the vault key is wrapped with a PIN-derived key on this device only;
   - attempts are limited;
   - after too many wrong tries, only the passphrase unlocks.
5. A general secret store backed by the OS keychain helper, with file fallback as today. Connector and writeback credentials use it.
6. `network.online`, for the no-connection banner (SH-03).

### frame-today

**Banners** (SH-03, SH-08):
- Chausar is driving (from `session.status`);
- Sending is closed (from `approvals.afterRestore`);
- No connection (from `network.online`);
- Update needed, read from `release.status`, plus the full Updates surface (SH-08).

**Ask line and voice** (SH-04, SH-05):
- the ask line gains suggestions, an "About:" context a place can set (a new `setAbout` prop), voice, and "telling, not asking";
- Talking to it uses models-ext's `voice.*`.

**Shell:**
- tray menu (SH-07);
- `workspaces.switch` (SH-06);
- the PIN unlock UI;
- the route ladder and local list UI (FR-05);
- SH-09 states;
- fault report save, send and crash report (SH-11), with recent activity filtered by caller;
- a fix for the IPC bug after a cancelled navigation;
- outside links before a workspace is open, for first run.

**Today:**
- the review rows join `approvals.list`;
- all worth-a-look kinds, including `jobsx.missed`;
- close status (`reports.closeStatus` as a todayx read model);
- cash capture and `onSaveClosing`, the closing switch and cash by voice (TD-02);
- grouped approval stepping;
- Activity filters by job and record, and the new event types.

**First run:**
- the FR-10 sharing step;
- the FR-14 join UI;
- the time zone;
- `imports.pickFile`, a native picker. FR-07 is exposed to places (BK-04), and FR-13 can pick a backup;
- proposed meanings for Excel files;
- an FR-07 PDF run end to end against the real engine.

**Also:**
- PH-05 "Awaiting your review" rows;
- the narrow layout at every width;
- words at rest within limits;
- pixel comparison with the reference pictures;
- a recovery-kit PDF check through `printToPDF`;
- `learningx` in the fake engine.

### ask

- AS-05: receipts show the provenance fields from core-data.
- AS-08: "needs data: …" reasons, plus a link to Ask a person.
- AS-09: the rule's text, via `trust.explain` from reports-tools-trust.
- AS-11: a branch picker.
- AS-19: lines become receipts (core-data). Check the GSTR-2B shape against what connectors-ext's recipes actually write.
- AS-04: two meanings shown side by side.
- `books.memoryPropose` is called for statements typed on the ask line.
- An unknown receipt id and a forbidden one give the same answer.
- AS-02 gains `ask.change`; SH-04 gains `ask.stop`.

### work-books

- BK-11: call learning-ext's real methods (`accountsPropose`/`accountsList`).
- WK-09: offers jobs-ext's ready-made jobs (`jobsx.types`/`card`).
- BK-03: Tally company list (the adapter has the read).
- BK-02:
  - where refused files are kept;
  - the sign-in path before the button is pressed;
  - the data's age.
- BK-05: answer in place, version diff and reconcile, over connectors-ext methods.
- BK-09: publish strategies.
- BK-12:
  - the time line shows reminders and notes;
  - "ask about this record", via frame-today's `setAbout`.
- BK-15: the demo clock.
- WK-02: practice for core actions.
- WK-03: each grouped item gets its own five-step strip.
- WK-08:
  - a local model shows as priced at zero, with its minutes;
  - an untested route is drawn;
  - child results (core-sync-jobs).
- WK-12: the reminder items.
- Bill photo:
  - word boxes from the helper, and every page;
  - run tesseract for real if it can be installed.
- Tests through the real merged engine for lane-job questions, person steps, edit, missed-run rule and accept.
- Keep the WK-14 screen, now against the driving lane's real `session.*`.

### reports-tools-trust

- TR-08:
  - the route ladder;
  - comparison over `bench.*`;
  - the FX and pricing screens;
  - choosing the voice provider and its key.
- TR-12:
  - start at login, through release's `shell.startAtLogin`;
  - background mode (`jobsx.setBackground`);
  - wake for jobs;
  - restore from the lock screen;
  - hosted backup screens.
- TR-14:
  - the plan from `hosted.status`;
  - the `hosted.worker.*` consent screen.
- TR-07: Drive sync and devices screens, over hosted-link and core-sync-jobs.
- Screens for:
  - Trust keys (connector credentials);
  - the allowance route.
- TL-09: mail verification and cost detail.
- TL-02:
  - a separate-origin frame;
  - charts and forms;
  - real action payloads.
- TL-03: delete and export.
- TL-06: wrap a skill or MCP tool.
- TL-07: the request sheet, over models-ext's pending list.
- Plugin network-door screens.
- RP-02:
  - Tally page export;
  - stop recalculating on every draw.
- Engine words become codes.
- Provide `trust.explain` for ask's AS-09.

### connectors-ext

- The Tally exporter and its one-page guide.
- Zoho reads split automatically.
- Declared totals without a typed total, where the source allows.
- `readerStatus.sizeBytes`.
- `recipes.answer`, `recipes.reconcile` and `recipes.upgradeDiff`, for work-books BK-05.
- Pass the held password to `sources.workbook*` (with core-data).
- Draw your own Books sub-places for scheduled reads (`connectorsx.schedule`) and the database road (`plainDb.*`).
- Replace `SCREEN_EXPORT_NOT_BUILT` with a screen export over the driving lane's `session.*`.

### writeback

- A place for write connections (WK-06): connect, link to a read connection, credentials, grants action by action, and the sandbox qualification run.
- Caps editing (WK-12), shown in the write-back time zone.
- Accept core-gateway-auth's per-member secrets for the second ask.

### jobs-ext

- Fix the `modelsx.price` mismatch together with models-ext, which adds `modelsx.price` in your shape.
- A daily amount limit (TR-05).
- GST matching: relabel it and add an end-to-end test.
- Stock check over core-data's quantity measure.
- The deciding agent, over core-gateway-auth's "decide" purpose.
- Your own place for procedures:
  - propose;
  - approve the exact digest;
  - reject and retire;
  - routed share and cost.
- Your own place for job controls: detect, stop rules, SKILL.md export, budget, and missed-run notes seen.

### learning-ext

- Your own Books place for dictionary edits, first-dictionary adoption, the answer key and account model asks.
- Reduce the covert channel through event counts in a batch.

### hosted-link

- The recovery-contact confirmation method on the relay (FR-13).
- PH-05: PDFs and photos through connectors-ext `imports.preview` and work-books `books.billRead`.
- A log of messages whose result was lost.
- Mail STOP trusts only authenticated senders.
- **PH-04, the phone page**: built in the companion app as the spec describes, marked experimental. The spec leaves it to the founder's decision after day 10; build it so it can ship when they decide.

### release

- Exclude dotfiles from the inventory.
- Write the Windows launcher `.cmd`.
- The PostgreSQL orphan sweep on macOS and Windows (code only).
- A relocatable or vendored-library Linux PostgreSQL, plus a PostgreSQL 16 pin with the `lib/` layout.
- Bundle Python's PDF packages and tesseract, and make `imports.installReader` and `readerStatus` real.
- Windows and macOS runtime pins, hashed against the publishers' checksums.
- The OS wake timer behind `jobsx.setWake` (code).
- `shell.startAtLogin`.
- Enterprise:
  - the identity map in PostgreSQL;
  - remote PostgreSQL for investigation search.
- Remove the three public-copy markers.
- Run the libsecret provider against a real Secret Service in the container.

### models-ext

- `modelsx.price` in jobs-ext's shape.
- The pending plugin and tool request list (TL-07).
- Meters for voice minutes and the month's spend.
- The WebRTC live voice client, with the minute cap enforced.
- Re-supply a speech key without moving the revision.
- Speak MCP to remote MCP servers.
- Test the network door against a real local HTTPS endpoint.
- Check the small-apps writeback contract against merged writeback.
- The `voice.*` engine family for SH-05: status, start, stop, confirm, drop note, speak, stop speaking and usage.
- `modelsx.localList`.

### driving (new)

**WK-14 "Chausar is driving" and screen export (experimental).**

- Engine: `session.windows`, `start`, `status`, `stop` and `resume`.
- A desktop driver interface in the main process:
  - a Linux X11 driver (AT-SPI or xdotool), tested under Xvfb against a real window;
  - Windows UI Automation and macOS Accessibility drivers, written but not run;
  - a list of windows the person may choose from;
  - a thin always-on-top strip with Stop;
  - a Ctrl Alt Pause stop key and a tray Stop;
  - an immediate pause when the person moves the mouse or types.
- Rules:
  - one window only;
  - read and export only;
  - it never types a password, answers a one-time code or solves a captcha.
- Give connectors-ext the hook for screen export.

### ca-enterprise (new)

**Experimental.** The full "Enterprise and CA console" design file is not in the repo. Build from spec §13, the CA-01..CA-11 table in `docs/specs/CHAUSAR-APP-DESIGN.md` and the existing shell scaffolding:
- `ShellKind` `enterprise` and `ca-firm` in `app/ui/src/app/places.ts`;
- `patterns/FirmTable.tsx`.

**CA console (ca-firm shell):**
- `clients.*`: a client list showing status only, never figures:
  - last read;
  - how far the close has got;
  - how many things await the firm;
  - what is due next.
- Stepping into a client's workspace with the seat that client gave.
- The firm's places: Today, Clients, Work (co-sign, many, questions), Reports (handover), Tools (library, invite), Trust (people, firm name).

**Enterprise shell:**
- the lens at the top of Today;
- the company switcher;
- "Whose" (Mine, My team, Everyone);
- the Company place's sub-places;
- Trust's access, markings, retention and channels sub-places.

## Done

Section 8 of LANES.md applies. Before your final report:
1. Merge the latest base.
2. Run the full `npm test`, `npm run test:ui`, the three typechecks and `node scripts/check.mjs`.
3. Run `node scripts/sync-lane-refusals.mjs --check`.
