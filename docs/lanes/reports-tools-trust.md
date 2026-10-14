# Lane: reports-tools-trust

Reports (RP-01..RP-08), Tools (TL-01..TL-10) and Trust (TR-01..TR-15).

This document is the lane's one document. Section 1 is the exact engine contract (the
`reportsx.*` and `trustx.*` families), which other lanes may code against. Later
sections describe what was built, how a person uses it, the supported and experimental
labels, and what is still missing.

## 1. Engine contract

Conventions for every method below.

- All dates are `YYYY-MM-DD`; all instants are ISO 8601 UTC strings.
- Money is whole paise as a decimal string (`"12345"` is ₹123.45). Never a JS number.
- A figure on the wire is `EngineFigure`:
  - `{ "kind": "money" | "count" | "percent", "exact": "<integer string>", "receiptId": "<calculation receipt id>", "labels": string[] }`
    (`percent` is hundredths of a percent), or
  - `{ "kind": "missing", "missing": "absent" | "null" | "unknown" | "withheld" | "not-applicable" | "not-loaded-yet" | "not-counted" }`.
  A known figure always has a calculation receipt id that `receipts.get` opens. A value
  that has no calculation receipt (a model cost, a byte count) is never an `EngineFigure`;
  it travels as a plain field named for what it is (`costMinor`, `bytes`).
- Words a person reads that the engine writes (page titles, notes, sentences) are English
  unless the request carries `"language": "hi"`, in which case report pages are written in
  Hindi where a translation exists. Screens keep their own words in their own catalogues.
- Refusals are `ChausarError` codes thrown with `check(...)`. Each method lists its own.
- Permission is the module permission the engine checks before the handler runs:
  `read`, `prepare`, `approve` or `admin`. `admin` means owner or cofounder.
- Every list is newest first unless stated.

### 1.1 Reports (`platform/runtime/reports-ext/`)

| Method | Perm | Request | Reply |
|---|---|---|---|
| `reportsx.packs` | read | `{}` | `{ packs: Pack[], checkedAt }` |
| `reportsx.page` | read | `{ pack, page, language?, period? }` | `ReportPage` |
| `reportsx.export` | prepare | `{ pack, page, format, language?, period? }` | `ExportedFile` |
| `reportsx.weekAhead` | read | `{ onDate? }` | `WeekAhead` |
| `reportsx.friday` | read | `{ onDate? }` | `FridayReview` |
| `reportsx.rhythm` | read | `{}` | `Rhythm` |
| `reportsx.setRhythm` | admin | `Partial<RhythmSettings>` | `Rhythm` |
| `reportsx.verifyChannel` | admin | `{ channel: "mail" \| "whatsapp" }` | `{ channel, verified }` or `RELAY_NOT_AVAILABLE` |
| `reportsx.due` | read | `{ from?, days?, profile? }` | `DueDates` |
| `reportsx.setDueProfile` | admin | `DueProfile` | `DueProfile` |
| `reportsx.exports` | read | `{}` | `{ warning, items: ExportRecord[] }` |
| `reportsx.exportAll` | admin | `{ confirmed: true, locked?: boolean }` | `ExportRecord` |
| `reportsx.askPerson` | prepare | `{ question, reason, receiptId? }` | `{ file: FileRef, sent: false }` |

Types.

```
Pack = { id: "lender" | "ca" | "investor", title, gstModes: ("regular"|"composition"|"none")[],
         pages: { id, title, state: "ready-tested" | "ready-untested" | "not-started", reason?: string }[] }
ReportPage = { pack, page, title, language: "en"|"hi", period: { from, to } | null, generatedAt,
  state: "ready-tested" | "ready-untested" | "not-started",
  sections: { id, title, projection: boolean,
              lines: { id, label, figure: EngineFigure, side?: "Dr" | "Cr" }[],
              gaps: string[] }[],                 // printed beside the total they affect
  notes: { id, text, source?: { title, url, checkedOn }, notLegalAdvice: boolean }[],
  disclaimer: string | null,                     // "This is not a loan offer or a promise of one." on ready-for-loan
  gaps: string[], markings: ("personal"|"financial"|"confidential")[],
  footer: { checkCode: string | null, at: string | null },   // from the tamper-evident record head
  receiptIds: string[] }
ExportedFile = { format: "csv"|"xlsx"|"html", name, path, bytes, sha256, encrypted: false, textCellsProtected: true }
  // format "pdf" refuses PDF_USES_PRINT (use print from the app); "tally" refuses TALLY_PAGE_EXPORT_NOT_AVAILABLE
WeekAhead = { id, period: { from, to }, scheduledFor, builtAt, late: boolean,
  changed: BriefItem[], decide: BriefItem[], due: BriefItem[], inbox: { id, text, reviewDate }[],
  missed: { id, what, at }[], explanation: "not-written" , receiptIds: string[] }
BriefItem = { id, text, figure?: EngineFigure, chart?: { id, label, figure: EngineFigure }[] }
FridayReview = { id, period, builtAt, decisions: { id, text, reviewDate, observed: string | null, receiptIds }[],
  lessons: { available: boolean, items: { id, title, evidence: number, change: string }[] } }
RhythmSettings = { days: number[] /* 0 Sun..6 Sat */, time: "HH:MM", dailyClosing: boolean,
  financialYearStart: "MM-DD", missedRule: "run-late" | "skip",
  mail: { on: boolean, address: string | null }, whatsapp: { on: boolean, phone: string | null } }
Rhythm = RhythmSettings & { mailVerified: boolean, whatsappVerified: boolean, whatsappTemplate: "not-approved",
  previews: { mail: string, whatsapp: string }, testMode: boolean, relay: "not-available" | "available" }
DueProfile = { kind: string, gstMode: "regular" | "composition" | "none", state: string }   // state is a 2-letter code
DueDates = { caNote, table: { version, publishedAt }, profile: DueProfile | null, covered: boolean, coveredKinds: string[],
  rows: { id, what, dueOn, source: { title, url }, lastChecked, checkOld: boolean,
          appliesTo: { kinds: string[], gstModes: string[], states: string[] } }[] }
ExportRecord = { id, at, locked: boolean, encrypted: boolean, folder, stores: { name, rows, checkNumber, file }[] }
FileRef = { name, path, bytes, sha256 }
```

### 1.2 Trust and Tools (`platform/runtime/trust-ext/`)

| Method | Perm | Request | Reply |
|---|---|---|---|
| `trustx.rules` | read | `{}` | `Rules` |
| `trustx.markings` | read | `{}` | `Markings` |
| `trustx.setMarking` | admin | `{ kind, target, on }` | `Markings` |
| `trustx.setSeatMarking` | admin | `{ seat, kind, sees }` | `Markings` |
| `trustx.sendLevels` | read | `{}` | `SendLevels` |
| `trustx.setSend` | admin | `{ level?, localOnly?, financialRoutes? }` | `ChangeResult` |
| `trustx.pendingChanges` | read | `{}` | `{ items: PendingChange[] }` |
| `trustx.confirmChange` | admin | `{ id }` | `ChangeResult` |
| `trustx.keep` | read | `{}` | `Keep` |
| `trustx.setKeep` | admin | `{ kind, days }` | `Keep` |
| `trustx.autonomy` | read | `{}` | `Autonomy` |
| `trustx.setAutonomy` | admin | `{ preset? , kind?: KindRule, caps?: Partial<Caps> }` | `Autonomy` |
| `trustx.seats` | read | `{}` | `Seats` |
| `trustx.invite` | admin | `{ seat, name, endsOn? }` | `ChangeResult & { invite?: { id, token, expiresAt }, guide?: { html } }` |
| `trustx.removeSeat` | admin | `{ memberId }` | `ChangeResult` |
| `trustx.models` | read | `{}` | `Models` |
| `trustx.setModelCap` | admin | `{ monthlyCapMinor: string \| null }` | `Models` |
| `trustx.network` | read | `{ kind?, pluginId?, limit? }` | `Network` |
| `trustx.plantCanary` | admin | `{}` | `{ planted: true, at }` |
| `trustx.checkCanary` | admin | `{}` | `{ alert: CanaryAlert \| null }` |
| `trustx.record` | read | `{ memberId?, day? }` | `Record` |
| `trustx.verifyRecord` | read | `{}` | `{ verified, brokenAt: number \| null, head }` |
| `trustx.sharing` | read | `{}` | `Sharing` |
| `trustx.cleanSample` | read | `{ text }` | `{ cleaned, hits: { line, kind }[], uploaded: false }` |
| `trustx.withdrawSharing` | admin | `{}` | `Sharing` |
| `trustx.vault` | read | `{}` | `VaultView` |
| `trustx.backupNow` | admin | `{}` | `Backup` |
| `trustx.testRestore` | admin | `{ file, passphrase }` | `Backup` |
| `trustx.setLock` | admin | `{ idleMinutes?, deviceCheck? }` | `VaultView` |
| `trustx.setRecoveryContact` | admin | `{ name: string \| null }` | `VaultView` |
| `trustx.deleteSource` | admin | `{ sourceId, confirmation }` | `DeletionReport` |
| `trustx.deletions` | read | `{}` | `{ items: DeletionReport[] }` |
| `trustx.exportDeletion` | admin | `{ id }` | `FileRef` |
| `trustx.hosted` | read | `{}` | `Hosted` |
| `trustx.agreements` | read | `{}` | `Agreements` |
| `trustx.withdraw` | admin | `{ id }` | `Agreements` |
| `trustx.assistants` | read | `{}` | `Assistants` |
| `trustx.setAssistants` | admin | `{ on }` | `Assistants` |
| `trustx.pairAssistant` | admin | `{ name }` | `{ id, name, token, expiresAt }` (token shown once) |
| `trustx.revokeAssistant` | admin | `{ id }` | `Assistants` |
| `trustx.plugins` | read | `{}` | `Plugins` |
| `trustx.inspectPlugin` | admin | `PluginPackage` | `PluginInspection` |
| `trustx.installPlugin` | admin | `PluginPackage & { answers: Record<string, boolean>, digest }` | `PluginRow & { missing: string[] }` (ask ids not answered Yes; the plugin stays disabled while any is missing) |
| `trustx.removePlugin` | admin | `{ id }` | `{ removed: true, kept: string }` |
| `trustx.languagePacks` | read | `{}` | `{ packs: LanguagePack[] }` |

Types.

```
Rules = { see: { allSources: boolean, allowed: number, refused: number }, send: { level: "nothing"|"shape"|"samples", localOnly: boolean },
  keep: { days: number }, do: { preset: Preset }, leftToday: { date, items: { destination, kind, count, bytes, stopped }[] },
  canChange: boolean, ownerOnly: ("send" | "sharing" | "seats")[] }
Markings = { kinds: ["personal","financial","confidential"],
  marks: { id, kind, target: { type: "source"|"record"|"field", sourceId, recordId?, field? }, auto: boolean, by, at }[],
  seats: { seat, sees: { personal: boolean, financial: boolean, confidential: boolean } }[],
  where: { source: "books/sources", record: "books/customers", field: "books/meanings" } }
SendLevels = { current, localOnly, financialRoutes: string[], synthetic: boolean,
  levels: { id: "nothing"|"shape"|"samples", headings: string[], rows: string[][], memory: string, question: string }[],
  voice: { on: false, note } }
ChangeResult = { state: "applied" | "waiting-for-second", change?: PendingChange }
PendingChange = { id, what: "send" | "sharing" | "seats", summary, by, at, needs: "owner" | "cofounder" }
Keep = { kinds: { kind, days: number | null, note }[], inventory: { path, bytes, what }[] }
Preset = "ask-everything" | "routine" | "all-but-waits" | "custom"
KindRule = { kind, on: boolean, maxPerDay: number, maxAmountMinorPerDay: string | null }
Caps = { remindersPerCustomerPerDay: number, remindersPerDay: number, activeJobs: number, monthlyAiCapMinor: string | null }
Autonomy = { preset: Preset, kinds: (KindRule & { agreement: { agreed: number, total: number } | null })[],
  alwaysWaits: { id, words }[], caps: Caps }
Seats = { seats: { memberId, name, seat: "owner"|"cofounder"|"accountant"|"ca"|"staff"|"viewer"|"assistant",
  limits: string[], endsOn: string | null, ended: boolean, removedOn: string | null, active: boolean, you: boolean }[],
  templates: { seat, limits: string[] }[] }
Models = { routes: { id, kind, label, health, order: number, terms: { keeps, keepsFor, trains, country, termsUrl, readOn } | null,
  lastAnswerCostMinor: string | null }[], spendThisMonthMinor: string, monthlyCapMinor: string | null,
  voice: { provider: string | null, minutesThisMonth: number } }
Network = { items: { id, at, kind: "model"|"connector"|"action"|"sharing"|"phone"|"sync"|"plugin",
  destination, why, bytes: number | null, outcome: "allowed" | "stopped" | "waiting", pluginId?, waitingContent?: string }[],
  canary: { planted: boolean, alert: CanaryAlert | null } }
CanaryAlert = { at, callId }
Record = { items: { seq, at, who, what, rule, computer }[], head: { hash, short, at, count }, limit }
Sharing = { on: boolean, intake: { open: false, words }, preview: { digest, bytes, events } | null,
  batches: { id, at, bytes, events }[], totals: { events, names: 0, amounts: 0 }, withdrawnAt: string | null }
VaultView = { backups: Backup[], lock: { idleMinutes, deviceCheck }, disk: { freeBytes, totalBytes } | null,
  limit, recoveryContact: { name: string | null, experimental: true }, version }
Backup = { file, at, bytes, testRestore: "passed" | "failed" | "not-tested", testedAt: string | null }
DeletionReport = { id, at, sourceId, rows: { place, state: "deleted"|"pending"|"not-possible"|"not-built", reason }[] }
Hosted = { blind: string, notBlind: string, jobs: { id, name, on: false }[], plan: "planned-not-available", keeps: string }
Agreements = { notice: { version, en, hi }, items: { id, person, purpose, at, withdrawnAt: string | null }[] }
Assistants = { on: boolean, server: { version, scope: "this-computer" },
  assistants: { id, name, pairedAt, lastCall: string | null, active: boolean }[],
  calls: { id, at, client, calculation, receiptId: string | null, removed: string[], refused: boolean }[] }
Plugins = { plugins: PluginRow[], blockedList: { version, checkedAt } }
PluginRow = { id, name, maker, level: "built-in"|"checked"|"community"|"blocked", kind: "data"|"code", status, blockedReason?: string }
PluginPackage = { manifest, moduleBase64, publisher?: { name, publicKey }, signature?: string, licence?: string }
PluginInspection = { maker, level, version, licence, signature: "valid"|"invalid"|"missing"|"key-changed", digest,
  doors: { id, open: boolean }[], asks: { id, kind: "calculation"|"action"|"site", name, answer: false }[],
  flagged: { field, text }[], refused: string | null }
LanguagePack = { id, name, cases: { passed, total }, supported: boolean, reviewed: boolean }
```

Notes on the contract as built (additive to the tables above):

- A known `EngineFigure` may also carry `measure: { operation, key }` naming the calculation and figure. `labels` holds only the seven canonical figure labels.
- `reportsx.due` rows run soonest first, and `table` carries `reviewed: false`.
- `reportsx.weekAhead` keeps one brief per period **per member** (receipts open only for the member who made them). A future week refuses `WEEK_NOT_STARTED`. The scheduled brief is built by the tick only after an owner has saved a rhythm.
- Report page times and "today" are India Standard Time; the default period is the financial year to date.
- `trustx.record` items may have `rule: null`; `head.at` is null for an empty record. `record` and `verifyRecord` extend the stored chain.
- `trustx.installPlugin` also returns `missing: string[]`, the asks not answered Yes.
- `trustx.deleteSource` and `trustx.pairAssistant` need the owner, not only an admin.
- `trustx.pairAssistant` refuses `ASSISTANT_SCOPE_NOT_AVAILABLE` after its checks: a member session would also open every read request on `/api/rpc`, so pairing waits for a session that reaches only the numbers server. No token is issued.
- `reportsx.weekAhead` refuses `WEEK_TOO_OLD` for weeks before last week, compares the last completed week with the one before it, and carries `gaps: string[]`.
- Figures from a source marked with a kind the caller's seat does not see print as `withheld` on pages, briefs and exports, with a gap saying so.
- The projection line is always `not-counted`; a passed forecast is named in a gap and opens in Ask.
- `trustx.models` gives `spendThisMonthMinor: null` to seats other than owner and cofounder, `voice.minutesThisMonth: null`, and `capEnforced: false`.
- `trustx.checkCanary` also looks for GSTINs, mail addresses and phone numbers from the books in what left, with or without a planted value.
- `trustx.setAutonomy` never turns the engine's one autonomy switch on (that would run every scheduled job); switching every kind off turns it off.
- A seat past its end date ends before any request of this lane runs, and that seat's own request is refused.
- Validation refusals in the trust part use `INVALID_FIELDS`, never `INVALID_REQUEST`, which screens read as "not built yet".
- `trustx.confirmChange` on an invite also returns `invite` and `guide`; an applied `removeSeat` also returns `removedOn` and `kept`.
- Exported for other lanes: `autonomyDecision(state, { kind, amountMinor?, countToday, customerCountToday? })` → `{ allowed, reason }` and `markingsForSources(state, sourceIds)`, from `platform/runtime/trust-ext/methods-core.ts`. Dual control can be extended with `requestChange` / `onApplyChange` from `core-dual.ts`.

## 2. What was built

Engine: 58 module methods in `platform/runtime/modules/lane-reports-tools-trust.ts`, listed in `app/desktop/module-methods/reports-tools-trust.json`. Code in `platform/runtime/reports-ext/` (packs, pages, exports, XLSX writer, briefs, due dates) and `platform/runtime/trust-ext/` (`core-*` for rules, markings, send, dual control, keep, do, seats; `tools-*` for models, network and canary, the record, sharing and the cleaner, vault and deletion, assistants, plugins, language packs; `lifecycle.ts` for purge and tick; `lane-state.ts` for the private namespace).

Screens: place modules in `app/ui/src/screens/reports/`, `tools/` and `trust/`, joined in `app/ui/src/places/lane-reports-tools-trust.tsx`, with a shared kit in `app/ui/src/screens/trust/kit/` (engine read hook, reply checks, figure conversion, page frame). Every screen has English and Hindi words, draws in Simple, Guided and Books, and handles loading, not built, locked, failed, read only and invalid replies.

### Reports

| Screen | Address | Label |
|---|---|---|
| RP-01 Packs: lender (CMA-style key financials, 12 months of sales, ageing, collections, GST turnover, bank summary, ready for a loan, projections), CA, investor; page states and GST modes | `reports/packs` | supported |
| RP-02 A report page: every figure opens its receipt, gaps beside totals, projection apart, loan disclaimer, 43B(h) and TReDS notes with sources, markings, record check code; English or Hindi; print; CSV, XLSX and HTML export with formula-safe text cells | `reports/packs?sheet=<pack>.<page>` | supported |
| RP-03 The week ahead and RP-04 the Friday review | `reports/weekahead` | supported (engine); see gap on the host's retained surface |
| RP-05 Rhythm and delivery | `reports/weekahead?sheet=rhythm` | supported for settings; delivery experimental (needs the hosted relay) |
| RP-06 Due dates from a shipped, sourced table | `reports/duedates` | experimental until a CA checks the table |
| RP-07 Export everything, plain or locked | `reports/exports` | supported |
| RP-08 Ask a person: a question file, nothing sent | `reports/exports?sheet=ask-a-person` | supported |

### Tools

| Screen | Address | Label |
|---|---|---|
| TL-01..TL-03 Small apps, a small app, the follow-up book | `tools/smallapps` | not built yet until models-ext serves `smallapps.*`; screens built against an adapter |
| TL-04 Plugins, TL-05 Install a plugin (inspection without install, signature, locked-box drawing, Yes/No asks, flagged text), TL-10 Language packs | `tools/plugins` | supported |
| TL-06 A tool from outside | `tools/plugins` | not built yet until models-ext serves `plugins.wrapped` |
| TL-07 A request from a connected tool | `ToolRequestSheet` | supported as a component; nothing raises it yet |
| TL-08 Other assistants: off by default, server card, call list | `tools/assistants` | experimental: pairing refuses `ASSISTANT_SCOPE_NOT_AVAILABLE` until core issues numbers-only sessions |
| TL-09 Phone | `tools/phone` | not built yet until hosted-link serves `phone.*`; the relay sentence shows |

### Trust

| Screen | Address | Label |
|---|---|---|
| TR-01 Rules with "what left this computer today" | `trust/rules` | supported |
| TR-02 See with markings and per-seat visibility | `trust/rules?sheet=see` | supported (markings follow data into this lane's pages; enforcement in other reads is a gap) |
| TR-03 Send with stand-in tables, local only, financial routes, dual control | `trust/rules?sheet=send` | supported on the `trustx.*` path; dual control is experimental because core `trust.update`, `learning.sharing` and `auth.invite` still let a cofounder change these alone |
| TR-04 Keep with the on-disk inventory | `trust/rules?sheet=keep` | supported (non-fact kinds stored, not yet enforced) |
| TR-05 Do: presets, kinds with limits, the always-waits list, caps, agreement | `trust/rules?sheet=do` | experimental: the rules are stored and `autonomyDecision` answers them, but no job or action path calls it yet |
| TR-06 People and seats (cofounder, accountant, CA with end date, staff), invite guide, TR-07 the pen | `trust/people` | supported; CA end dates enforced on this lane's requests only; staff "sees their own" not enforced; seat dual control experimental as for Send |
| TR-08 Models with terms cards and spend | `trust/models` | supported; terms texts need checking |
| TR-09 Network ledger and the canary (planted value and the books' own GSTINs, mail addresses and phone numbers) | `trust/network` | supported for the ledger; canary experimental: it finds a leak after it left |
| TR-10 The tamper-evident record | `trust/record` | supported |
| TR-11 Sharing, the local cleaner, TR-14 hosted promises, TR-15 notice and agreements | `trust/sharing` | supported; intake closed ("Nothing is sent.") |
| TR-12 Vault: backups, test restore, lock, disk, recovery contact | `trust/vault` | supported; lock settings stored, not enforced; recovery contact experimental |
| TR-13 Delete and the deletion report | `trust/vault?sheet=delete` | supported (see gap on managed copies) |

## 3. How a person uses it

- **Reports · Packs**: open a pack, open a page, read it as it will print, press any figure to see its receipt, choose Hindi, then Print or export.
- **Reports · The week ahead**: read Monday's three sections or switch to Friday; set the days, time and delivery in Rhythm.
- **Reports · Due dates**: set the kind of business, GST mode and state once; the dates follow from the table. "Not yet checked by a CA."
- **Reports · Exports**: Export everything (owner), with the warning that plain files are not encrypted, or a locked archive.
- **Tools · Plugins**: choose a plugin file, read who made it and what it asks for, answer each ask, install. Remove takes its permissions away at once.
- **Tools · Other assistants**: switch on, pair an assistant, copy the code once.
- **Trust · Rules**: the four rows; Send and Sharing changes need the owner, and both owner and cofounder when there is a cofounder.
- **Trust · People**: invite a cofounder, accountant, CA until a date, or staff; remove a person.
- **Trust · Network / Record**: see every call that left, plant a test value; verify the record.
- **Trust · Vault**: back up now, test a restore with the passphrase, delete a source everywhere and keep the report.

## 4. What is still missing

- **Host precedence**: `reports/weekahead` is still drawn by the retained lesson review (`retainedSurface` in `app/ui/src/screens/retained/RetainedPlace.tsx`, used by `bootstrap.tsx`, owned by frame-today) before any place module. The week ahead module is reached once that precedence is changed. `trust/models` is now drawn by this lane, which supersedes the host's route picker there.
- **Other lanes' methods** assumed by the screens behind adapters: `smallapps.list/make/create/get/rebuild/view/act` (models-ext), `plugins.wrapped/reapprove` (models-ext), `phone.channels/preview/usage/optIn/verify` (hosted-link). They show "not built yet" until served.
- **Core hooks that would be needed** (not made): numbers-only (MCP) sessions, so assistant pairing can be turned on; dual control on the core `trust.update` (send, sharing), `learning.sharing`, `auth.invite`, `members.add` and `members.revoke` paths; a call to `autonomyDecision` from the job runner and the action path; seat visibility of markings in `visibleFacts` (this lane withholds marked figures only on its own pages, briefs and exports); a deletion entry point a module can call (`sources.delete` refuses `VAULT_BUSY` from inside a module request, so `trustx.deleteSource` calls the trust service directly and skips the engine's managed-copy cleanup; older backups and exports are reported `pending`); a gateway hook to block a payload carrying the canary before it leaves; a per-call MCP record (what the disclosure check removed, refused write calls) and MCP-only tokens; enforcement of the idle lock, CA end dates at authorization time and seat visibility of markings in `visibleFacts`.
- **Needs a person**: a CA must check every row of `platform/runtime/reports-ext/due-dates.v1.json` (shipped `reviewed: false`, several sources linked to home pages) and the 43B(h) note; the model terms in `tools-terms.v1.json` must be checked against each provider; Hindi and Hinglish need a native reader's review.
- Report pages for GST turnover, bank statements and purchases against GSTR-2B stay "not started" until the connector lanes register those calculations.
- No period picker on report pages; Simple and Guided look nearly alike on Tools; phone items in the network ledger and phone opt-ins in agreements wait for the hosted-link record shape; voice minutes read 0.
