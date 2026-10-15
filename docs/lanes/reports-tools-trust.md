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
  keep: { days: number }, do: { preset: string | null }  /* jobs-ext's preset from jobsx.autonomy, null when it does not answer */, leftToday: { date, items: { destination, kind, count, bytes, stopped }[] },
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
- `trustx.pairAssistant` issues a session scoped to the numbers server (`/mcp`) only, for one day (the AuthService maximum), and returns its token once. The owner pairs alone. `Assistants.calls[]` carries `code: string | null` and lists refused calls from the per-call MCP record.
- `reportsx.weekAhead` refuses `WEEK_TOO_OLD` for weeks before last week, compares the last completed week with the one before it, and carries `gaps: string[]`.
- Figures from a source marked with a kind the caller's seat does not see print as `withheld` on pages, briefs and exports, with a gap saying so.
- The projection line is always `not-counted`; a passed forecast is named in a gap and opens in Ask.
- `trustx.models` gives `spendThisMonthMinor: null` to seats other than owner and cofounder, `voice.minutesThisMonth: null`, and `capEnforced: false`.
- `trustx.checkCanary` also looks for GSTINs, mail addresses and phone numbers from the books in what left, with or without a planted value.
- A seat past its end date ends before any request of this lane runs, and that seat's own request is refused.
- Validation refusals in the trust part use `INVALID_FIELDS`, never `INVALID_REQUEST`, which screens read as "not built yet".
- `trustx.confirmChange` on an invite also returns `invite` and `guide`; an applied `removeSeat` also returns `removedOn` and `kept`.
- Exported for other lanes: `markingsForSources(state, sourceIds)` (`core-markings.ts`). Dual control can be extended with `requestChange` / `onApplyChange` from `core-dual.ts`. Autonomy is owned by jobs-ext (`jobsx.*`); this lane keeps no decision engine of its own.
- `trustx.autonomy` and `trustx.setAutonomy` were removed in round 2: TR-05 is drawn over jobs-ext's `jobsx.autonomy`, `jobsx.setAutonomy`, `jobsx.autonomyPreset` and `jobsx.setCaps`.
- `trustx.network` also lists writeback's ledger (`action`), relay messages (`phone`) and hosted backup uploads (`sync`); `trustx.record` reads writeback, hosted-link and jobs-ext events in plain words; `trustx.agreements` lists phone opt-ins and invoice reminder consents, withdrawn through `phone.channels.set` and `writeback.followUp.consent`.
- `reportsx.due` rows carry `source: { title, url, date, confirmed }`; `caNote` is "This table has not been checked by a CA yet. Each row links to the official source."
- Report pages take any `period`; the lender GST turnover and bank summary pages and the CA purchases against GSTR-2B page are built from `connectorsx.envelopes`, `connectorsx.gstMatch` and `connectorsx.freshness`. A connector reply that does not validate refuses `CONNECTOR_REPLY_INVALID`.
- `VaultView.lock.idleMinutes` is frame-today's own idle-lock setting (`todayx.lock.settings`), read and written through; it may be null.
- `trustx.deleteSource` uses the engine's module-callable source deletion, which also removes managed copies.
- Core paths refuse `SECOND_PERSON_REQUIRED` when a change to Send, Sharing or seats needs the owner and the cofounder; the gateway refuses `CANARY_BLOCKED` before a payload carrying the canary or a guarded value leaves; an MCP-scoped token on any other channel gets `SESSION_SCOPE_FORBIDDEN` (401 over HTTP).

- Round 2, later: `reportsx.packs`, `weekAhead`, `friday`, `rhythm` and `due` take `language: 'en' | 'hi'` and write their words in Hindi when asked. Brief items carry `movement` (`moved`, `same`, `not-enough`, decided by comparing exact strings) and `coverage`; `friday` lessons carry `changeText`; `due` adds `tableNote`, `profileWords`, `kinds[{ id, name }]`, `states[{ code, name }]` and `appliesToWords` per row, and `caNote` is "Not yet checked by a CA.".
- `reportsx.questions {}` → `{ items: [{ name, bytes, at }] }` and `reportsx.openQuestion { name }` → `{ name, bytes, sha256, at, text }` (read; accountant or CA seat): only `question-*.html` files in `<directory>/exports/questions/`; anything else refuses `INVALID_QUESTION_FILE` or `QUESTION_FILE_NOT_FOUND`.
- `reportsx.exports` gives row counts only to an owner with every branch; other seats get each item with `stores: []`.
- `trustx.setPolicy { allowedSources?, autonomy? }` (admin): source access and autonomy. The design puts Send, Sharing and seats under two people; See and autonomy are one admin's, made in the app.
- `trustx.confirmChange { id, decline: true }`: the needed person declines, or the author withdraws; the reply is `{ state: 'declined' }`. Removing a seat (any seat, the only cofounder included) applies at once with one admin: it only takes access away, and a compromised seat must be cut off without waiting. `coolsOffAt` is always null (kept for screens).
- `PendingChange` carries `what: 'send' | 'sharing' | 'seats' | 'markings' | 'policy'` and `coolsOffAt: string | null`. Widening a marking (`setMarking` with `on: false`, `setSeatMarking` with `sees: true`) waits for the second person; narrowing applies at once.
- Widening changes (Send up, sharing on, autonomy on, more sources, new seats) from a tainted request or a non-desktop channel refuse `APP_CONSENT_REQUIRED`. A session one person issues for another is marked with its issuer (`Context.issuedBy`); a change cannot be confirmed by its author, nor through a session either of them issued for the other (`SELF_CONFIRM`). A paired assistant is a numbers-only member (`scope: 'mcp'`) whose sessions work only on `/mcp`; pairing a name again revokes the earlier assistant, and an expired assistant is revoked.
- The gateway runs the outbound check before reserving budget; a blocked call is `failed` / `CANARY_BLOCKED`, spends nothing, shows as `stopped`, and is recorded as a block, not a leak alert.
- Dates in the trust part (CA end dates, today's counts, the month's spend) are India dates.

## Round 4 contracts

New or changed methods in round 4. Other lanes may code against these.

### `trustx.explain` (read) — for ask AS-09

Request: `{ rule: 'branch' | 'source' | 'seat' | 'access' | 'marking', sourceId?: string, language?: 'en' | 'hi' }`.
`rule` is the `RuleKind` ask's `askx.run` returns with `ASK_STOPPED_BY_RULE`. Unknown properties or kinds refuse
`INVALID_EXPLAIN_REQUEST`; a member no longer in the workspace refuses `ACCESS_REVOKED`.

Reply, always about the caller's own seat, in fixed words built from this workspace's settings (no outside text):

```
{ rule, check: 'see' | 'people',             // which of the five checks (see, send, keep, do, people) decided
  seat: 'owner' | 'cofounder' | 'accountant' | 'ca' | 'staff' | 'viewer' | 'assistant',
  sentence: string,                            // "Anything marked personal or confidential is hidden from the accountant seat."
  hidden?: ('personal' | 'financial' | 'confidential')[],  // rule 'marking' only: kinds this seat does not see
  source?: { known: boolean, allowed: boolean },           // rule 'source' with sourceId only
  whoCanChange: { seats: ('owner' | 'cofounder')[], both: boolean, sentence: string },
  youCanChange: boolean,                       // the caller is owner or cofounder
  where: { place: 'trust', sub: 'markings' | 'rules' | 'people' },  // the Trust address that holds the rule
  language: 'en' | 'hi' }
```

`both` is true when an active cofounder exists and the rule is seats, branches, access or markings (widening those
waits for the second person); allowed sources are one admin's change. Hindi sentences await the founder's review.

## 2. What was built

Engine: the `reportsx.*` and `trustx.*` methods above, in `platform/runtime/modules/lane-reports-tools-trust.ts` and listed in `app/desktop/module-methods/reports-tools-trust.json`. Code in `platform/runtime/reports-ext/` (packs, pages, connector pages, exports, the XLSX writer, briefs, due dates, withholding) and `platform/runtime/trust-ext/` (`core-*`: rules, markings, send, dual control, keep, seats, the core hooks; `tools-*`: models, network and canary, the record, sharing and the cleaner, vault and deletion, assistants, plugins, language packs; `adapters.ts` for other lanes' reads; `lifecycle.ts`; `lane-state.ts`).

Screens: place modules in `app/ui/src/screens/reports/`, `tools/` and `trust/`, joined in `app/ui/src/places/lane-reports-tools-trust.tsx`, with a shared kit in `app/ui/src/screens/trust/kit/` and adapters for other lanes' methods (`tools/adapters/phone.ts`, `smallapps.ts`, `wrapped.ts`; `trust/adapters/jobs.ts`). Every screen has English and Hindi words and draws in Simple, Guided and Books; Tools and Do differ by view as the design asks.

### Core edits (authorized by the coordinator in round 2; each minimal and additive)

| File | What | Why |
|---|---|---|
| `platform/runtime/contracts.ts` | `registerCoreHook` (change, seatEnded, sourceHidden), `guardChange`, `sourceHidden`; `authorize` asks the seat-ended hook | dual control on core paths; CA end dates at authorization |
| `platform/runtime/trust.ts` | `sourceHidden` in `sourceAllowed`; `guardChange` in `updatePolicy`, `addMember`, `revokeMember` | marking visibility in every fact read; dual control |
| `platform/runtime/auth.ts` | `guardChange` in `invite`; `issueSession` option `scope: 'mcp'`; `authenticate` refuses a scoped session on another channel | dual control on invites; numbers-only assistant sessions |
| `platform/runtime/learning.ts` | `guardChange` in `setSharing` | dual control on sharing |
| `platform/runtime/mcp.ts` | `registerMcpCallHook` and a structure-only per-call record | the assistants' call list, refused calls included |
| `platform/runtime/gateway.ts` | `registerOutboundCheck`, called once on the exact payload before dispatch | the canary blocks a leak before it leaves |
| `platform/runtime/server.ts` | `/mcp` authenticates on the `mcp` channel | numbers-only sessions |
| `platform/runtime/engine.ts` | `moduleHost` adds `sourceDeletion` bound to the calling request | source deletion with managed-copy cleanup from a module |
| `app/desktop/preload.cjs` | this lane's line in `laneRefusals` | screens tell the lane's refusals apart |
| `platform/runtime/contracts.ts` (later) | optional `scope?: 'mcp'` on `Member`; optional `issuedBy` on `Context` | numbers-only assistant members; a session issued by the change's author cannot confirm it |
| `platform/runtime/auth.ts` (later) | `issueSession` records `issuedBy` for a session issued for someone else and `authenticate` carries it on the context; both honour `scope: 'mcp'` members | the owner cannot confirm their own change as the cofounder; assistants stay on `/mcp` |
| `platform/runtime/trust.ts` (later) | `addMember` takes an optional `scope`; `visibleFacts` asks the marking hook once per source | assistant members; fact reads stay linear |
| `platform/runtime/gateway.ts` (later) | the outbound check runs before the reservation | a blocked call spends no budget and uses no approval |
| `platform/runtime/mcp.ts` (later) | call records are buffered and written in batches; `flushMcpCalls` | one assistant token cannot flood vault writes |
| `platform/runtime/engine.ts` (later) | module source deletion needs the owner, a confirmation equal to the source id, and the caller's own single request | deletion from a module cannot run outside its request |
| `platform/tests/import-learning-http.test.ts`, `ask-engine.test.ts`, `models-ext-plugins.test.ts`, `auth.test.ts` | a seat invited before the cofounder joins; raising Send through Trust with the cofounder confirming; a session test uses an accountant | the two-person rule now holds on core paths |

## 3. How a person uses it

- **Reports · Packs**: open a pack and a page; choose the period and the language; press any figure for its receipt; print, or export to Excel, CSV or HTML. GST turnover, the bank summary and purchases against GSTR-2B fill in once those sources are imported.
- **Reports · The week ahead**: Monday's three sections, or Friday's review; Rhythm sets the days, time and delivery.
- **Reports · Due dates**: set the kind of business, GST mode and state; each row links to its official source and its date.
- **Reports · Exports**: Export everything (owner), plain or as a locked archive; Ask a person makes a question file.
- **Tools · Small apps**: write one line, read what it would use, make it; open it; the follow-up book.
- **Tools · Plugins**: choose a plugin file, read who made it and what it asks for, answer each ask, install; remove; outside tools set aside until approved again; language packs with their test counts.
- **Tools · Other assistants**: switch on, pair an assistant (the owner), copy the code once; see each call, refused ones included.
- **Tools · Phone**: switch WhatsApp, Telegram or mail on after agreeing to its text; verify your number; see the month's count against 30.
- **Trust · Rules**: See, Send, Keep and Do; Send, Sharing and seat changes need the owner and the cofounder when there is a cofounder.
- **Trust · People**: invite a cofounder, accountant, CA until a date, or staff; remove a person.
- **Trust · Models, Network, Record, Sharing, Vault**: route terms and spend; every call that left and the canary; the verifiable record; the cleaner and agreements; backups, restore test, lock, and delete-everywhere with its report.

## 4. What is still missing

- **Reachability**: resolved in round 2 — the host now lets a lane's place module win its address, so the week ahead, the Friday review and Rhythm are reached at `reports/weekahead`; the retained lesson review keeps its own address. Outside links open through the host's link dialog (`openLink`, SH-10), report pages print through the guarded shell port (`print('page')`), and Vault places frame-today's recovery contact (`RecoveryContactSettings`), so `trustx.setRecoveryContact` remains only for older callers.
- **Needs a person**: a CA must check `platform/runtime/reports-ext/due-dates.v1.json` (shipped `reviewed: false`; 10 of 25 sources could not be opened and are marked unconfirmed: EPFO, ESIC, Maharashtra and Karnataka professional tax, MCA, two income-tax rows), and decide whether extensions such as CBDT Circular 07/2026 are shown; the 43B(h) and TReDS notes; the model terms in `tools-terms.v1.json`; a native reader's review of Hindi and Hinglish.
- **Other lanes**: connectors-ext issues no calculation receipts for bank totals, GSTR-3B turnover or the GSTR-2B match, so those lines are "not counted" and the three connector pages stay "ready, not tested". jobs-ext has no daily amount limit, so Do limits by count. hosted-link gives no per-message cost and no log of messages whose result was lost, and cannot verify a mail address. models-ext's meters do not measure voice minutes or the month's spend; there is no method listing pending plugin network requests or tool requests, so TL-07's sheet is never raised; small-app action buttons send an empty payload. Core has no `devices.*` methods, so TR-07 shows only this computer's sync role. No core method discards a waiting model send (it expires).
- **The outbound check** covers the model gateway only; plugin network calls (models-ext), the learning upload (learning-ext) and hosted-link's allowance client are not routed through it.
- **Within the lane**: staff "sees their own" is not enforced; keep periods for kinds other than facts are stored, not enforced; record- and field-level markings label pages but only source-level markings hide data; the monthly model cap is recorded, not enforced; the connector pages recalculate when the packs list is drawn; deletion places and seat limits are matched to screen words by the engine's English sentences.

## 5. Screen audit (round 2)

Each screen was checked against every Shows, You can, States and Rules line of the design, in Simple, Guided and Books and in English and Hindi. All screens have their own words in both languages and render tests; "Engine" names the methods drawn over. The full audit with every design item is kept with the build notes; this is its outcome after the round-2 fixes.

| Screen | Address | Status | Open items |
|---|---|---|---|
| RP-01 Packs | `reports/packs` | met | — |
| RP-02 A report page | `reports/packs?sheet=<pack>.<page>` | met | Tally export refused; PDF through Print |
| RP-03 The week ahead | `reports/weekahead`, `reports/briefs` | met | — |
| RP-04 The Friday review | same | met | Approve and Not now stay in Work · Approvals |
| RP-05 Rhythm and delivery | `?sheet=rhythm` | met | delivery depends on the hosted relay |
| RP-06 Due dates | `reports/duedates` | met | table needs a CA |
| RP-07 Exports | `reports/exports` | met | — |
| RP-08 Ask a person | `?sheet=ask-a-person` | met | no link from Ask's Not yet page (ask lane) |
| TL-01 Small apps | `tools/smallapps` | met | — |
| TL-02 A small app | `tools/smallapps?sheet=<id>` | partial | drawn in a sandboxed box, not a separate-origin frame; no charts or forms yet |
| TL-03 The follow-up book | `?sheet=follow-up-book` | partial | entries cannot be deleted or exported from here |
| TL-04 Plugins | `tools/plugins` | met | — |
| TL-05 Install a plugin | `tools/plugins?sheet=install` | met | no "No internet" state |
| TL-06 A tool from outside | Plugins page | met | — |
| TL-07 A request from a connected tool | component | built, not raised | needs a models-ext list of pending requests |
| TL-08 Other assistants | `tools/assistants` | met | the MCP server removes nothing from answers, so "removed" is always empty |
| TL-09 Phone | `tools/phone` | met | mail not verifiable; cost is a month total |
| TL-10 Language packs | Plugins page | met | packs not reviewed by a native reader |
| TR-01 Rules | `trust/rules` | met | — |
| TR-02 See | `?sheet=see` | met | — |
| TR-03 Send | `?sheet=send` | met | — |
| TR-04 Keep | `?sheet=keep` | met | non-fact kinds stored, not enforced |
| TR-05 Do | `?sheet=do` | met over jobs-ext | no amount limit in jobs-ext |
| TR-06 People | `trust/people` | met | staff "sees their own" not enforced |
| TR-07 Machines and the pen | People page | partial | no `devices.*` in core: no hand-over, machine list or sync set-up |
| TR-08 Models | `trust/models` | partial | routes cannot be reordered here; cap not enforced; no comparison table |
| TR-09 Network | `trust/network` | met | a waiting send can be released, not discarded |
| TR-10 Record | `trust/record` | met | — |
| TR-11 Sharing | `trust/sharing` | met over learning-ext | — |
| TR-12 Vault | `trust/vault` | met | restore from the lock screen; PIN not built in frame-today |
| TR-13 Delete and the report | `?sheet=delete` | met | — |
| TR-14 What the paid plan can see | Sharing page | met | no engine sends "plan ended" yet |
| TR-15 Notice and agreements | Sharing page | met | — |
