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
