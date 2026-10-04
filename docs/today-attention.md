# Retained Today attention projection

`platform/runtime/today-attention.ts` supplies the retained alert episodes and due
decision portion of TD-01's “Worth a look”. TD-04's typed-reference requirement is
preserved: rows carry domain references and authored labels/text, not new Engine
narration. Engine registration, the shared Today DTO, desktop allowlist, layout,
row limits and cross-section selection remain integration work. The user preview
remains partial; this module does not change its flags or establish full acceptance.

## Host contract

```ts
const attention = new TodayAttentionService(store, {
  alertsOptions: currentView => ({
    calculatorOptions: receiptView => currentCalculatorGuards(receiptView),
  }),
  reportOptions: currentView => currentReportGuards(currentView),
  // Optional trusted host resolver; never a renderer/RPC input:
  // calendar: (context, request, currentView) => reviewedCalendarSource(...),
});
const held = attention.read(context, {
  displayedDate: displayedDay,
  timeZone: reviewedTimeZone,
  branch: selectedBranch,
});
// After any await, immediately before the host releases rows, references or counts:
const current = attention.assertCurrent(context, held);
```

The example guard factories stand for the host's existing connector readiness,
receipt and execution resolvers, bound to the supplied current snapshot. They are
not implementations or alternate permissions. Managed-source production hosts
must carry their existing guards through these factories. Neither displayed day
nor timezone has a default. The date is the displayed civil date; it is not
derived from alert observation timestamps or converted from server midnight.

The result contains `alertEpisodes`, `dueDecisions`, `calendar`, visible `counts`,
`alertsCheckedAt`, an authority binding, and a content `pin`. The service creates
no durable Today object. `read` rejects a source snapshot changed by a trusted hook
before return. `assertCurrent` validates held content, rebuilds it through the real
services, and refuses changed authority, retained content, evidence uncertainty,
decision lifecycle or calendar provenance. It returns freshly guarded content.
The changing alert read timestamp is excluded from the pin; evidence issues are
included. State revision is included, so intervening writes conservatively require
a fresh read. Hosts must not release a held response before this final check.

## Retained alerts and decisions

Each retained episode produces exactly one row, regardless of observation count.
The service uses `AlertsService.brief` and guarded `get`, retaining the episode ID,
status, severity, uncertainty, reopen history, related notices and corrections.
Corrections are associated by observation anchors and episode notices, including
retractions whose retained observation IDs still refer to the original sample.
`lastObservation` is the latest related measurement, with retained append order
choosing its latest correction. It preserves raw observation state and amendment
reason; an unavailable correction can be `unknown` while the retained measured
episode remains open. Staleness adds uncertainty without clearing a breach.

Cleared and retracted episodes remain explicitly labelled history. Their presence
does not mean they currently need action. Alert counts count visible retained
episodes, not observations or unresolved breaches. Alert order is the existing
brief's alert-ID order followed by retained episode order. No threshold, new
severity, cause or ranking is inferred.

Decisions come from `ReportService.dueDecisions` with the required
`dueOn: displayedDate`. Only open decisions with `reviewDate <= displayedDate`
appear; equality is `today`, earlier is `overdue`. The existing service retains
branch, receipt, source, owner and execution-reference authority. The projection
does not invent an epoch field for legacy or rich decision records. Old private
receipt epochs remain inaccessible through their existing guards. Decision order
is the existing retained service order. There is no cross-kind rank policy.

## Optional reviewed compliance source

The calendar interval is exactly seven civil dates: the displayed day through day
plus six, inclusive. It does not use a 168-hour timezone/DST interval. Calendar rows
keep the adapter's reviewed order.

Without a calendar resolver, an absent retained calendar is `unavailable` with
`no-reviewed-calendar`. An existing Report calendar is `unsupported` with
`calendar-source-contract-required`: its `ComplianceEntry` carries a source URL,
publication timestamp and named reviewer, but lacks a last-check, applicability
and reviewed coverage contract. No legacy dates or identifiers are released as
supported calendar rows, and `publishedAt` is never renamed as `lastCheckedAt`.

The optional trusted resolver returns `TodayAttentionCalendarInput`. A reviewed
source explicitly supplies calendar ID/version, permitted source IDs, reviewer,
review time, last-check time, applicability state/basis, timezone and complete date
coverage. Every entry also supplies its own ID, title, due date, linked publication,
publication time, review and last-check provenance, and applicability state/basis.
Missing required provenance is `calendar-provenance-incomplete`; inadequate or
differently zoned coverage is `calendar-window-not-covered`. Unknown and
not-applicable states remain explicit published-entry metadata; neither becomes
an assertion that the business must comply. Review provenance is not a claim of
legal, connector or production qualification.

A reviewed empty source retains its provenance and coverage with zero rows. It is
distinct from a missing or unsupported calendar. Revoked calendar sources return
`current-authority-unavailable` with zero rows and no private references. All
counts derive only from released rows; no hidden count is included. Extra adapter
properties are not forwarded.

## Effects and limits

Reads use the current real Alerts and Reports services against a read-only state
view. They never evaluate an alert, calculate a new receipt, build a report, invoke
a model, dispatch a job, send a message, or update/audit the store. Tests exercise
real import, calculation, ontology, alert and decision services over synthetic CSV
in encrypted experimental-file Vault storage. This proves the source-service path,
not native SQL, production storage, installed desktop, UI or connector qualification.
Calendar adapter tests prove the explicit contract and boundaries; they do not
qualify an external calendar feed.

Dated authorized import refusals require a separate historical event contract;
they are not inferred to remain unresolved. Late briefs and missed schedules need
business-period/occurrence lifecycle evidence and are out of this module's scope.
No tile choice, alert threshold, scheduling policy or qualification default is added.

## Verification receipt

The [test output](verification/today-attention-tests.tap) records 84 passing tests:
16 focused Today cases and 68 affected Alerts/decision regressions, with no failed
or skipped tests. [The verification receipt](verification/today-attention.json)
records commands, source hashes, independent source review and tooling limits.
Repository syntax/JSON validation passed. The installed environment has no
TypeScript compiler or TypeScript package, so strict compilation was unavailable;
no dependency was acquired to fill that gap.
