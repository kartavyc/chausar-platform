# Full-product build: lanes

This is the working brief for the full-product build of 14 October 2026. Eleven lanes build in parallel, each in its own cloud session on its own branch. A coordinator merges them into `claude/clever-goldberg-49qobq`. The specifications are in `docs/specs/`:

- `CHAUSAR-ARCHITECTURE.md`: the sixteen pieces.
- `CHAUSAR-LIVE-BUILD-PLAN.md`: what each day promises. Day numbers below point into it.
- `CHAUSAR-APP-DESIGN.md`: every screen, the parts, the words and the states. It is the text extract of `Chausar-App-Design.html`, which holds the pictures. Screen IDs such as `WK-02` come from this document. Each screen's `Engine:` line names the methods its design proposed.
- `CHAUSAR-FINAL-IN-DEPTH-PLAN.md` and `GAP-REGISTER.md`: the detailed requirements and the gap findings, to consult when a detail is unclear.

The founder's decisions for this build:

- Full product, desktop first, Windows first.
- Base: the merged 4 October branches.
- Write-back: the **full catalogue**. Every external write follows exact approval and read-back, and the always-waits list still always waits.
- Hosted services are **written and tested, not deployed**.
- Bundled PostgreSQL is the desktop database.
- CEL is the formula language for recipes.
- React 19, Vite, React Aria and plain CSS Modules for the screens.
- No per-change evidence documents. One document per lane.

## 1. How a lane works

1. **Set up.** Run `bash scripts/cloud-setup.sh`, then `export PATH="$HOME/.local/bin:$PATH"`. Use Node 24.13.1. Never run `playwright install`; Chromium is at `/opt/pw-browsers`.
2. **Read** this file, your lane section, and the spec sections it names. Then explore the code you will extend. Much already exists: read it before you write.
3. **Build** inside the files you own (section 3). Commit often with clear messages. Push to your lane branch.
4. **Test.**
   - Add tests as `platform/tests/<lane-id>-*.test.ts` for engine work, `app/ui/tests/<lane-id>-*.test.ts` for UI contracts, and `frontend-validation/tests/<lane-id>-*.test.tsx` for React behaviour (Vitest with jsdom).
   - Tests use synthetic fixtures and local fakes only, with no network.
   - Run `npm run typecheck`, `npm run typecheck:ui` (UI lanes) and `node scripts/check.mjs` often.
   - Before your final push, run the whole suite once with `npm test`. Fix what you broke. Report any failure you did not cause.
5. **Write `docs/lanes/<lane-id>.md`.** Cover what you built, how a person uses it, the engine methods and screens added, each feature labelled **supported** (tested end to end in the app on synthetic data) or **experimental** (works, but depends on a live service, device or account not tested), and what is still missing.
6. **Finish** with a summary as your final message: branch, last commit, what was built, core edits (section 4), cross-lane assumptions, failing tests, and gaps.

Work through the whole lane. Do not stop at a plan or a first slice. If something truly needs a person (a paid account, a certificate, a legal choice), build everything up to that boundary, make the missing piece a clear typed refusal, and list it.

## 2. Product rules (never broken)

1. **The AI never does arithmetic.** A model picks a registered calculation and fills its form. Software checks and runs it. Every number shown carries a receipt: rows, period, definitions, exclusions and coverage. The number guard rejects any figure in model text that is not on the receipt.
2. **Missing is words, never zero.** Use the seven missing states: absent, null, unknown, withheld, not applicable, not loaded yet, not counted.
3. **Outside text is data, never an instruction.** File cells, web pages, messages and plugin output change nothing. Anything that has read outside text cannot send data off the machine without a person agreeing.
4. **Nothing leaves without a rule.** The trust panel's send level (nothing, shape only, samples) is enforced before any model request. The sharing switch is off by default and shares structure only.
5. **Actions:** prepare → approve (exactly this change) → do once → read back → settle.
   - A lost connection gives the state `unknown`, which is checked before any retry.
   - Being allowed to read a system never grants writing to it.
   - **The always-waits list always waits for a person:** money, messages to outsiders, deleting, and anything that cannot be undone (prices, stock, listings, sharing, tax filings).
6. **Demo mode** (`--demo`) keeps every external system and provider disabled.
7. **Exact money:** whole paise as strings and BigInt, never JavaScript floats.
8. **Errors** are fixed upper-case codes thrown with `check(condition, 'CODE', 'Plain sentence.')`. A message never carries data from outside.
9. **Supported or experimental:** every feature you add carries one of the two labels in your lane document.

## 3. Ownership and extension seams

So that lanes can merge cleanly, each lane adds code through the seams below and stays inside the paths it owns.

### Engine methods

- Add new engine methods in **`platform/runtime/modules/lane-<lane-id>.ts`** (see `modules/types.ts`).
  - Declare each method with its permission (`read`, `prepare`, `approve` or `admin`), plus `phone: true` or `external: true` when relevant.
  - The engine authorizes the caller before your handler runs.
  - Use `host.services` for the existing services and `host.call(...)` to call another method as the same caller.
- Keep private durable state in your namespace with `moduleState(state, '<lane-id>', init)` inside `host.store.update(...)`.
- Implement `purge` so source deletion or revocation removes anything you derived from that source.
- Implement `tick` for scheduled work. It runs only while autonomy is on.
- Mark a method `preVault: true` only when it must work before any workspace is open (a workspace list, format checks during first run). Only the trusted local desktop can call it then; no member is authorized and `host.store` throws.
- Implement `hostOptions` when your module needs trusted start-up options (a credential broker, sign-in client registrations, update keys, endpoints). The engine calls it once, with only its directory, demo flag and process environment, when the embedding host passed no `EngineOptions.modules[<lane-id>]`. This is how the installed desktop app wires your module; do not edit `main.cjs` or the worker for it.
- List every method you add in **`app/desktop/module-methods/<lane-id>.json`**. `platform/tests/engine-modules.test.ts` checks the two match.
- Put larger engine code in your own files, under `platform/runtime/<lane-folder>/` (named in your lane section).
- Never add a `case` to `engine.ts` for new work.

### Screens

- Add new screens through **`app/ui/src/places/lane-<lane-id>.tsx`**, which exports `PlaceModule`s (see `places/types.ts`).
  - The host draws the first module whose `handles(address)` is true.
  - A module receives `rpc`, `live`, `openReceipt`, `navigate`, `language`, `view`, `member` and `viewer`.
- Put screen code in `app/ui/src/screens/<place>/` for the places you own.
- Keep your words in your own catalogue files (`places/types.ts` has a `Catalogue` helper), in English and Hindi.
- Use the shared parts in `app/ui/src/parts` and `app/ui/src/patterns` (Row, RowList, Sheet, Stat, charts, ApprovalSheet, States, ListWithSheet and so on).
  - If a part your screen needs is missing, build it in `app/ui/src/screens/<your place>/parts/` with the props the design's part list gives ("for the builders", part 5). The coordinator will promote it.
  - Only the **frame-today** lane edits `app/ui/src/parts`, `app/ui/src/patterns`, `app/ui/src/app`, `app/ui/src/host`, `app/ui/src/tokens` and `app/ui/src/views`.
- Each screen draws correctly in the three views (Simple, Guided, Books) and in both languages.
- Each screen handles the design's common states: loading, empty, not built, locked, read only, error, stale, and partial coverage.
- A screen whose engine method does not exist yet shows the design's "not built yet" state when the reply is `UNKNOWN_METHOD`, `INVALID_REQUEST` or `METHOD_UNAVAILABLE`.
- Screens call engine methods only through `rpc`, and validate every reply before drawing it.
- Over the desktop bridge only listed refusal codes reach a screen; any other code arrives as `REQUEST_FAILED`. To let a screen tell your own refusals apart, add the codes to **your lane's own line** in `laneRefusals` in `app/desktop/preload.cjs`. That is the one permitted edit there. Then run `node scripts/sync-lane-refusals.mjs`, which copies the lines into the renderer's own check (`laneRefusalCodes` in `app/ui/src/bridge/client.ts`); `desktop-bridge-error.test.ts` fails until they agree.

### Ownership

| Lane id | Owns (create and edit freely) |
|---|---|
| `frame-today` | `app/ui/src/{app,host,parts,patterns,tokens,views,bridge,format,text}`, `app/ui/src/screens/{today,first-run}`, `app/ui/src/places/lane-frame-today.tsx`, `app/ui/tests/**` (other lanes add files only), `frontend-validation/**` config, `app/renderer/**` (retirement), `app/desktop/main.cjs` (renderer switch only), `platform/runtime/server.ts` (static serving of the new UI only), lane module files |
| `ask` | `app/ui/src/screens/ask/**`, `places/lane-ask.tsx`, `platform/runtime/ask/**`, lane module files |
| `work-books` | `app/ui/src/screens/{work,books}/**`, `places/lane-work-books.tsx`, `platform/runtime/work-books/**`, lane module files |
| `reports-tools-trust` | `app/ui/src/screens/{reports,tools,trust}/**`, `places/lane-reports-tools-trust.tsx`, `platform/runtime/reports-ext/**`, `platform/runtime/trust-ext/**`, lane module files |
| `connectors-ext` | `platform/runtime/connectors-ext/**`, `platform/runtime/adapters/**` (read side), `platform/runtime/connector-framework/{read,import,registry,profiles}.ts`, `fixtures/connectors/**`, lane module files |
| `writeback` | `platform/runtime/writeback/**`, `platform/runtime/connector-framework/write.ts`, `platform/fakes/**` (stateful fake systems), `fixtures/writeback/**`, lane module files |
| `jobs-ext` | `platform/runtime/jobs-ext/**`, `platform/runtime/procedures/**`, lane module files |
| `learning-ext` | `platform/runtime/learning-ext/**`, `hosted/learning-intake/**`, lane module files |
| `hosted-link` | `hosted/**` (except `hosted/learning-intake`), `platform/runtime/hosted-link/**`, `platform/runtime/phone/**`, lane module files |
| `release` | `scripts/release/**`, `scripts/desktop-*.mjs`, `app/desktop/builder*.json`, `runtime-binaries/**`, `.github/workflows/**`, `platform/runtime/native/**`, `enterprise/server/**`, `docs/releases.md`, lane module files |
| `models-ext` | `platform/runtime/models-ext/**`, `platform/runtime/providers/**`, `platform/runtime/speech*.ts`, `platform/benchmarks/**`, `platform/runtime/smallapps/**`, lane module files |

"Lane module files" means `platform/runtime/modules/lane-<id>.ts`, `app/desktop/module-methods/<id>.json`, `app/ui/src/places/lane-<id>.tsx` (UI lanes), `docs/lanes/<id>.md` and tests named for the lane.

## 4. Core files: minimal, additive edits only

These files are shared: `platform/runtime/engine.ts`, `contracts.ts`, `private-state-lifecycle.ts`, `trust.ts`, `actions.ts`, `jobs.ts`, `learning.ts`, `gateway.ts`, `calculator.ts`, `ontology.ts`, `vault.ts`, `app/desktop/ipc-contract.cjs`, `preload.cjs`, `package.json`, the `tsconfig` files and the registry `index.ts` files.

You may change one only when your lane cannot work otherwise. In that case:

- Keep the change additive and as small as possible: a new optional field, a new hook, a new export.
- Never reformat, reorder or rename existing code.
- List every core edit in your final summary under "Core edits", with the reason.

A new dependency is a core edit: pin an exact version, prefer none, and say why. Do not edit another lane's owned paths. If you need something from another lane, assume its contract from section 6, code against it behind a small adapter in your own folder, and list the assumption.

## 5. Engineering standard

- Strict TypeScript as the repository already uses it. Native Node type stripping runs `.ts` directly.
- Validate untrusted input and replies at the boundary.
- Reuse existing services rather than copying them. Read `platform/runtime/*.ts` first.
- External systems sit behind an adapter interface with:
  - a real HTTP client (credentials only through the engine's credential broker),
  - recorded-response fixtures for reads,
  - a stateful fake (in `platform/fakes/`, owned by writeback) for writes and read-back.
- Production code never calls a fake. Fakes are wired only in tests, in demo mode and in Practice mode.
- Keep code at the density of the surrounding files. No speculative abstraction. No placeholder functions that pretend to work: a capability that cannot work yet refuses with a typed code.

## 6. Cross-lane contracts

These method families are reserved so lanes can code against each other. The owning lane defines the exact payloads and documents them in its lane document. Consumers adapt at merge.

| Family | Owner | Purpose |
|---|---|---|
| `approvals.*` | work-books | One queue over actions, jobs, dictionary releases and lessons awaiting review. `list`, `get`, `approve`, `notNow`, `change`, `drop`, `group`, `approveGroup`, `practice`. Built over the existing `actions.*`, `jobs.*` and `ontology.*`. |
| `books.*`, `accounts.*`, `records.*`, `history.*` | work-books | Sources freshness, chart of accounts view, customers and suppliers, as-known history. |
| `writeback.*` | writeback | `catalogue` (one row per action per system, with its write table), `prepare`, `execute`, `readBack`, `reconcile`, `practice` (run against the fake). The adapters plug into `ActionService` and `connector-framework/write.ts`. |
| `connectorsx.*` | connectors-ext | `systems` (the 56 groups with depth per operation), `connect`, `read`, `freshness`, `plainDb.*`. |
| `jobsx.*`, `procedures.*` | jobs-ext | Job types, proposals, catch-up policy, budgets, autonomy view, AgentRun-style procedures (`procedures.list`, `get`, `propose`, `approve`, `route`, `runs`). |
| `learningx.*`, `dictionary.mcp.*` | learning-ext | Decision log views, consent preview, recipe library lookup, accounts-label proposals, dictionary edit proposals with answer-key evaluation, dictionary over MCP. |
| `hosted.*`, `phone.*` (additions) | hosted-link | Pairing with the hosted relay, channel settings (WhatsApp, Telegram, mail), message templates and counts, encrypted backup upload and download, allowance account. |
| `release.*`, `native.*`, `service.*` | release | Update channel, background service install, keychain status, bundled database status. |
| `modelsx.*`, `bench.*`, `smallapps.*` | models-ext | Route catalogue (including SubQ Snap), route test and comparison, cost and budget meters in rupees, speech providers, small apps from one line, plugin wrapping. |
| `reportsx.*`, `trustx.*` | reports-tools-trust | Lender, CA and investor packs, the week ahead, due dates, exports, markings, network ledger, the readable record. |
| `askx.*` | ask | Suggested questions from the menu, saved checks, "Not yet" questions, why-changed bridges, what-ifs. |
| `todayx.*`, `ui.*` | frame-today | Anything the frame, first run and Today need beyond the existing `today.*`. |

## 7. The lanes

### frame-today: the app frame, first run, Today, and the new UI as the default

**Spec:** the design's main file parts 1–14, "for the builders" (all), "every screen": The shell (SH-01..SH-13), First run (FR-01..FR-14), Today (TD-01..TD-04), Phone (PH-01..PH-03 on the desktop side; PH-04 and PH-05 are after day 10, so draw them only if time allows). Plan days 1–2 and 5.

**Build:**

- **Finish the frame:** rail, page, sheet, ask line and status line. Add every banner in SH-03 (demo clock, driving, sending closed, jobs paused, read only, update needed), lock and unlock, the workspace menu, keyboard map, help, the narrow layout and reduced motion.
- **Complete the parts library** to the design's list. The eleven chart forms, of which Columns, Line and OrderedBar already exist; the rest are RankedBars, Bridge, GoalLine, StepLine, PairBars, Strip, Spark and RuleBar. Also Receipt (all six parts), Table (virtualized), Steps, KeyValue, Banner, Drawing (typed nodes and links), TwoSides and the full ApprovalSheet variants.
- **First run end to end:** install → vault and recovery kit → model route → first source → meanings → first answer with a receipt.
- **Today in all three views,** with "awaiting your review", "worth a look", three charts and "earlier today".
- **A fake engine** (`app/ui/src/bridge/fake.ts`) that serves every place's methods from synthetic data, for previews and screenshots.
- **Make the new UI the default renderer** in Electron and in the loopback server. Keep the legacy renderer reachable behind an explicit flag until the coordinator removes it, and update the desktop and server tests.
- **UI rule checks** (from lintapple). Write a `ui-policy.json` derived from the tokens:
  - text sizes 13.5, 15 and 18 per view,
  - WCAG 2.2 AA contrast in both themes,
  - minimum control size,
  - figures contained in their boxes,
  - the design's word-count limits.
  Add a Playwright checker (Chromium at `/opt/pw-browsers`) that walks every place in the fake-engine preview in both themes, three views and both languages. Other UI lanes' screens are picked up automatically through the place registry.

**Owns:** see section 3.

### ask: Ask, saved answers, decisions, checks, Not yet

**Spec:** "every screen" Ask (AS-01..AS-19). Plan days 1, 2 and 5 (answers, what-ifs, why it changed, decisions, forecasts). Architecture pieces 8–9.

**Build:**

- Every Ask screen as place modules:
  - New: suggested questions from the published menu, the answer page with its receipt, the number guard's output, and "Not yet".
  - Saved answers with stale marks.
  - Why-changed investigations with the Bridge chart (measured on one side, the guess labelled on the other).
  - What-ifs that change assumptions, never facts.
  - Forecasts shown only when they beat the baseline.
  - The decision journal with review dates and the inbox.
  - Checks: your own questions with known answers, rerun when a model, meaning, recipe or the app changes.
- Reuse the existing conversation host, the scenarios, investigations, bridge, forecast and decision-journal engine services. Add `askx.*` methods only where a screen needs data nothing serves yet.

**Owns:** see section 3.

### work-books: Work and Books

**Spec:** "every screen" Work (WK-01..WK-16) and Books (BK-01..BK-20). Plan days 2, 3, 4, 6 and 7. Architecture pieces 5–7 and 10–11.

**Build:**

- **Work:**
  - Approvals: the one queue, the approval sheet with all variants (including the Practice variant and the voucher preview), grouped approvals, and "after Approve" with the five steps and the unknown state.
  - Jobs: list, card, proposal, budget, pause and resume, accept and reject.
  - Actions: the record of every action.
  - "What it can do": the catalogue, one row per action per system, with its status.
- **Books:**
  - Sources with freshness, loaded and refused rows.
  - Meanings with drafts, releases and co-sign.
  - Accounts: the chart of accounts with class proposals to confirm.
  - Customers and suppliers: records, matches to confirm, sources that disagree.
  - History: as known on a date, versions, stale answers.
  - Memory: what Chausar believes, each line with source, edit and delete.
- **Engine `approvals.*` and `books.*`** as the read models these screens need, over the existing services. Call `writeback.*`, `jobsx.*`, `procedures.*`, `connectorsx.*` and `learningx.*` through adapters, with not-built states when they are absent.

**Owns:** see section 3.

### reports-tools-trust: Reports, Tools, Trust

**Spec:** "every screen" Reports (RP-01..RP-08), Tools (TL-01..TL-10), Trust (TR-01..TR-15), plus the phone settings screen under Tools. Plan days 5, 6 and 9. Architecture pieces 4, 9 and 12.

**Build:**

- **Reports:**
  - Packs: the lender pack in the layouts Indian banks ask for, the CA pack and the investor update. Every number has a receipt and every gap is stated on the page.
  - "The week ahead": the Monday brief and the Friday review.
  - Due dates: a compliance calendar from a published, sourced list, with the date it was last checked. Never AI-made.
  - Exports.
- **Tools:** small apps, plugins (install, permissions, the locked-box drawing), other assistants (the verified-numbers MCP server) and Phone (channels, templates, counts against the budget of 30).
- **Trust:**
  - The four switches: See, Send, Keep, Do.
  - People and seats, including the accountant seat that prepares but cannot approve, and markings.
  - Models (route cards with cost per answer).
  - The Network ledger of what left this computer.
  - The readable Record.
  - Sharing (the learning consent preview).
  - Vault: backup, restore, export, delete, the recovery kit.
- **Engine `reportsx.*` and `trustx.*`** where screens need more than the existing `reports.*`, `trust.*`, `members.*`, `models.*`, `plugins.*`, `mcp.*` and `learning.*`.

**Owns:** see section 3.

### connectors-ext: every system, read and import depth

**Spec:** plan section 6 (the 50 systems in nine families) plus the founder's six additions: Khatabook, OkCredit, myBillBook, BharatPe, Petpooja, and Form 26AS/AIS. QuickBooks is kept, so there are 56 groups in all. Plan day 4 and day 3 (bank statement PDF). Architecture piece 6.

**Build:**

- **The connector factory:**
  - A catalogue in which every group has its operations and a depth per operation: import, read or full.
  - Typed recipes in the mapping language, with assertions against the source's own report totals, abstention and an unmapped-fields list.
  - A fixture harness.
- **Read adapters with real HTTP clients** and recorded-response fixtures:
  - Tally (XML interface; extend the existing adapter), Zoho Books, Razorpay, Shopify, Google Workspace (Sheets and Drive with the `drive.file` scope; Calendar), Xero, QuickBooks, Stripe, Cashfree, PayU, Zoho CRM, HubSpot and WooCommerce.
  - Tests use fixtures only.
- **Import depth through recipes** for every other group's exports:
  - Vyapar, Busy, Marg, myBillBook, Khatabook, OkCredit, BharatPe and Petpooja.
  - Amazon, Flipkart and Meesho settlement reports.
  - Bank statements as CSV, Excel and PDF from any bank, through the Python helper, with balance continuity checks.
  - GST: GSTR-1, GSTR-2B, GSTR-3B, e-invoice and e-way bill JSON.
  - Form 26AS and AIS.
  - Shiprocket, Delhivery, Unicommerce, Zoho Inventory, Keka, GreytHR, Zoho Payroll, RazorpayX Payroll, Chargebee, Freshdesk, Meta and Google Ads, Google Analytics, YouTube, Instagram, Mailchimp, Notion, Slack, Microsoft 365, WATI/Interakt, PostHog and GitHub.
- **A plain database connector** (from Helix Foundry): read-only PostgreSQL, MySQL and SQLite, with the same recipe and source-total checks.
- **GST matching:** purchase register against GSTR-2B.
- **Cut-short refusal:** a cut-short file or report is refused and the reason is stated.

**Owns:** see section 3.

### writeback: the full write catalogue, fakes, Practice

**Spec:** plan day 7 (actions, the catalogue, the write table, unknown outcomes). Architecture piece 10. Founder decision: full catalogue.

**Build:**

- **A write catalogue per full-depth system.** Each entry states:
  - its idempotency method,
  - how it reads back the result,
  - its retry window,
  - its tier, and whether it is on the always-waits list.
- **Adapters, each with a real client and a stateful fake** in `platform/fakes/<system>/` that serves reads and writes for read-back:
  - **Tally:** voucher and ledger import through XML on port 9000, with read-back by voucher number.
  - **Zoho Books:** invoices, payment reminders, recorded payments, contacts.
  - **Razorpay:** payment links, refunds.
  - **Shopify:** price, inventory level, product status.
  - **Google Workspace:** Sheets append and update, Calendar events, Drive file create.
  - **WhatsApp Business Cloud API:** template messages.
  - **Email over the user's own SMTP server.**
- **Plug every adapter into** `ActionService` and `connector-framework/write.ts` with exact payload approval, a stable effect key, single execution, read-back and unknown-state reconciliation.
- **Practice mode** (from DigitalOcean's Simulations): run any action, or a whole job, against the fake and show exactly what would happen, with nothing sent. Expose it as `writeback.practice` and as job practice runs.
- **Generalize invoice follow-up** from synthetic-only to production with consent and the real email and WhatsApp adapters. Coordinate with jobs-ext through `writeback.*`.

**Owns:** see section 3.

### jobs-ext: jobs, autonomy, procedures

**Spec:** plan days 7–8. Architecture piece 11. The AgentRun write-up summarised in this section.

**Build:**

- **Job types and proposals.** Chausar proposes repeating jobs, which you can see, pause or delete.
- **Catch-up rule.** A written rule decides whether a job missed during sleep runs late or is skipped.
- **Background mode semantics.** The OS service install itself belongs to the release lane.
- **Rupee budgets across every model route.** Read the costs from `modelsx.*`.
- **Stop rules** for every job.
- **Acceptance.** A job is done only when its owner accepts the result.
- **The autonomy switch.** Safe, undoable work runs on its own, and the always-waits list still waits.
- **Chasing unpaid invoices for a week.**
- **Procedures** (from AgentRun):
  - A job runs a few times with a strong route, recording a trace and the cost, latency and outcome of each run, plus a one-to-three-sentence note.
  - It then proposes a **procedure** of typed steps:
    - calculator calls,
    - typed questions (a decision with a confidence and allowed options),
    - steps from the action catalogue,
    - agent steps only for lookups.
  - The owner approves the procedure.
  - Cases are routed through the procedure. Unmatched or low-confidence cases fall back to the full agent.
  - The share of routed cases and their cost are shown.
- Feed every run's trace into the learning log in structure-only form.

**Owns:** see section 3.

### learning-ext: the learning loop and the self-improving dictionary

**Spec:** architecture piece 13 and the training ladder. Plan days 1, 2, 4 and 8. EvoOntology (arXiv 2609.15779, code at github.com/ruc-datalab/EvoOntology).

**Build:**

- **The decision log.** Every mapping, identity, accounts-label, action and procedure decision is logged on the machine, structure-only by construction.
- **The consent preview.** It shows the exact bytes that would be shared.
- **The intake service** in `hosted/learning-intake/`, written and tested but not deployed. It accepts structure-only records, checks them for values and names, and stores them with credits.
- **Ladder step 1, recipe lookup.** Find similar past recipes before proposing a new one.
- **Ladder step 2, grammar-constrained proposals.** Proposals must follow the mapping language's grammar.
- **Ladder step 3, preparation only.** A dataset export for the accounts-label classifier.
- **AI-proposed sorting of the chart of accounts** into classes, with evidence and confidence. You or your accountant decide, and the decision is logged.
- **EvoOntology:**
  - Serve the dictionary through the existing MCP server, read-only, in three layers: schema, sample content (governed by the send level) and allowed operations.
  - A builder agent proposes a first dictionary from imported files.
  - A self-evolution loop proposes small typed edits. Each edit is shown to the owner only after it passes the hand-worked answer key in a before-and-after run. The owner still approves every edit.

**Owns:** see section 3.

### hosted-link: hosted services (written, not deployed) and phone channels

**Spec:** architecture section 4 (what runs where). Plan days 5, 6 and 9. The design's Phone part (12) and PH screens. N7 and the WhatsApp narrowing.

**Build:** `hosted/` as a Node and TypeScript service set on PostgreSQL, with a job queue on the database, a Docker Compose file and a deploy guide. Nothing is deployed.

- **Relay for briefs and simple approvals:**
  - Channels: WhatsApp Cloud API templates, a **Telegram** bot (from Xiryn; it needs no Meta verification), and mail.
  - Every message is a headline and a link: no amounts, names, counts or money dates. A test fails on any digit in a message body.
  - Approve, Not now and Open the app buttons are single-use and expire in 30 minutes. They are offered only for small, undoable changes inside the workspace.
  - Free text gets a fixed reply. HELP and STOP are handled.
- **The link page:** it holds no data and hands over to the desktop app.
- **Encrypted backup storage:** the client encrypts and the server never sees the key.
- **The model allowance proxy:** metered in rupees, with provider keys held on the server.
- **The always-on jobs worker,** clearly labelled as not end-to-end encrypted.
- **Accounts:** phone OTP behind a provider interface. **Billing** behind a payment-partner interface, with a fake.
- **Desktop side** (engine module `hosted-link` and `platform/runtime/hosted-link/`): pairing, channel settings and opt-in, message preview, counts against the monthly budget, backup upload and restore, the allowance route client, and a Google Drive transport for the existing encrypted one-writer sync.

**Owns:** see section 3.

### release: installers, bundled database, updater, native pieces, enterprise server

**Spec:** plan days 1, 3 and 10, and sections D3 and D9. Architecture pieces 1, 2 and 15 and section 8. `runtime-binaries/README.md` and `docs/releases.md`.

**Build:**

- **Release build configs** for Windows (NSIS), macOS (dmg) and Linux (AppImage). CI workflows build unsigned artifacts with published checksums. Signing steps run only when secrets exist: a Windows cloud key service and Apple notarization.
- **Runtime-binary staging scripts** for official PostgreSQL and Python per OS, with checksum inventories. They run in CI and are never committed.
- **The bundled PostgreSQL lifecycle:** initdb, start and stop, a port, a data directory, crash recovery, and an upgrade path.
- **The updater:**
  - signed manifests, staging, atomic swap and rollback,
  - an expiry date on preview builds,
  - a vault copy before any schema change,
  - an older app refusing a newer vault.
- **Native keychain providers:** Windows Credential Manager/DPAPI, macOS Keychain and Linux libsecret, behind the existing keychain interface.
- **OS background service install** for background mode, in `platform/runtime/native/`: Windows Task Scheduler, a launchd agent and a systemd user unit.
- **The public releases page generator.**
- **The supported and experimental lists generator.**
- **A clean public copy script** with an allowlist of paths. The licence is left as a draft for the founder.
- **Enterprise server mode** (`enterprise/server/`): the same engine for many users over HTTPS, with OIDC sign-in, roles and branch scope, serving the new UI in a browser, plus a Docker image.

**Owns:** see section 3.

### models-ext: model routes, bench, cost, speech, small apps

**Spec:** architecture pieces 3 and 12. Plan days 1, 8 and 9. `docs/model-routes.md`.

**Build:**

- **The route catalogue:**
  - Codex CLI and Claude Code CLI (existing).
  - API key routes for the OpenAI Responses API, the Anthropic Messages API and OpenAI-compatible APIs.
  - Local Ollama (existing).
  - The managed allowance route client (calls hosted-link's proxy).
  - **SubQ Snap** as an experimental decision-model route for choosing calculations and filling forms. Read its API from subq.ai's documentation.
- **Every route** keeps a single attempt, the privacy gate and a word-for-word receipt.
- **A route comparison bench:** the same open questions across routes, against pass bars stated beforehand, using recorded transcripts offline. Extend the 50-question open bench with hand-worked answers.
- **Cost per request in rupees,** from a dated pricing table and an FX setting. Expose budget meters for jobs-ext.
- **Speech providers:** paid live, recorded upload, Sarvam and Bhashini clients, and local whisper.cpp. Each has privacy gates and the Hindi traps ("nahi" flips the meaning; "do lakh" becomes 2,00,000).
- **Small apps from one line:** a typed app descriptor over published data and approved actions, with the user's permissions. No arbitrary code.
- **Plugin wrapping** for Agent Skills and MCP-format add-ons into the WebAssembly locked box.

**Owns:** see section 3.

## 8. Done

A lane is done when its build list is implemented, its own tests pass, the typecheck and source checks pass, the full suite has been run once, its lane document is written, and everything is pushed to `claude/lane-<lane-id>`.
