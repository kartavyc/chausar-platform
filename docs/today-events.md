# Today day-event projection

`platform/runtime/today-events.ts` implements the read-only event portion of TD-01 and TD-04 from the approved `app/ui/design-screen-inventory.json`: up to six earlier-today marks, with typed arguments that the screen localizes. It does not register Engine methods, change the shared Today DTO, add desktop permissions, implement the frontend, or establish full Today acceptance. Existing preview partial flags must remain.

## Host interface

```ts
const events = new TodayEventsService({
  store: currentStore,
  rules: explicitlyInstalledCalendarRules,
  services: {
    learning: installedLearningService,
    calculator: installedCalculatorService,
    actions: installedActionService,
    reports: installedReportService,
    jobs: installedJobService,
  },
});
const request = { date: explicitlyDisplayedDate, timeZone: explicitlySelectedZone };
const held = events.day(context, request);
// If the parent awaits other Today sections, it must use the fresh result:
const current = events.release(context, held);
// An open request carries eventId and display scope, never an arbitrary reference:
const reference = events.resolveReference(context, { ...request, eventId });
```

All services must use the exact same current `StateStore`. Ports are constructor-only and unavailable to IPC callers. The host installs real services and their existing guards; absence fails closed. Calendar rules must explicitly install the selected named zone and civil-year range. There is no fallback zone, date, schedule, qualification, threshold, or tile selection. Display-rule revision is returned as `calendarRevision`; it does not certify scheduling.

`day(context, { date, timeZone })` returns `TodayDayEvents`: the explicit display scope, installed calendar revision, immutable `TodayDayEvent[]`, `total`, and a typed state. All currently authorized supported events are resolved before sorting newest-first and cutting to six. Ties use ascending stable audit ID with direct string comparison; locale and input order cannot change the tie order. Local date membership is determined independently for each instant through the installed calendar rules, preserving fractional-offset midnight and both DST folds without assuming a 24-hour day.

`release(context, held)` accepts only an authentic result issued by this service for the same workspace, member, role, epoch, channel and source-taint context. It rereads and returns a new projection; the caller must discard the held value for release. Serialized copies are not grants. `resolveReference` rescans the entire authorized day, including events outside the six-mark cut, and releases only the exact typed domain reference. The subsequent source, receipt, action, decision or job read must reauthorize again. References are navigation hints, not durable capabilities or business-effect authorization.

## Required current authority

| Family | Installed resolver and evidence requirement |
| --- | --- |
| `source.imported` | `LearningService.list(context)` and canonical `assertLearningDecisionRecord` validation. Match exactly one accepted import identity to import ID/source, hashes, format and authoritative row count. Reader and recorded author retain current source, identity-branch and epoch authority. |
| `source.import-refused` | The same Learning authority, matching the rejected record's learning ID/source and enumerated structural reason. No rejected content, raw parser errors, or invented import row is released. |
| `calculation.completed` | `CalculatorService.receipt(context, id)` with the installed `receiptGuard`, normally `EngineConnectorService.assertReceiptReady`. Match receipt operation/row count and recheck source IDs, including empty requested scopes. Private member and epoch ownership, counted/excluded rows, and current acquisition readiness remain enforced. |
| Action events | `ActionService.access`, the installed catalogue operation's read authorization, and `ActionService.list`. Preparation/approval attribution binds to retained creator/approval evidence. Other actors remain unrecorded. Settlement outcome and business-success fields are bounded historical audit types, never inferred from current action state. No provider is invoked. |
| Decision events | `ReportService.decisions` with installed `options.receiptGuard`; rich execution links additionally need the installed `options.executionReceipt`, normally `createJournalExecutionResolver(actions)`. Current branch/source/receipt checks remain. Rich revisions/reviews must match retained revision, actor and outcome history. Ambiguous legacy actors remain unrecorded. |
| `job.delivered` | `JobService.list` with installed `deliverableGuard`, normally the current durable runner's `canRelease` or Engine's complete brief guard. Require the exact owner/role/epoch and an actually released deliverable. Job ownership does not identify a worker actor. |

Supported action kinds are prepared, revised, approved, attempt, settled, reconciled, cancelled and interrupted. Supported decision kinds are created, revised and reviewed. `learning.logged` is ancillary to the source import/refusal and is omitted to avoid duplicate marks. Other event kinds have no fabricated fallback.

The module sends only discriminated events, identifiers, bounded enums, exact historical job cost text, and explicit receipt staleness. It never sends arbitrary audit details, raw errors, payloads, actor names, source narration, amounts from import records, or Engine prose. A missing actor is `{ kind: 'not-recorded' }`. A retained stale calculation remains historical evidence with `args.stale: true`; stale or obsolete job deliverables are withheld. A repeated delivery whose historical proof cannot be released through the current service remains unresolved.

## Empty, partial and unavailable

`complete` means this supported authorized projection is complete for the requested day; it does not establish whole-product acceptance or source acquisition completeness. `total` counts only released events. Denied events contribute no identifiers, timestamps, source names, counts or denial reasons.

Unsupported kinds, corrupt canonical records, unresolved references and missing actors remain typed partial reasons rather than a successful no-activity claim. Missing installed resolvers/calendar rules may yield `unavailable`. Explicit denial preflights distinguish ordinary permission filtering from real service list misses, which can also represent corruption or missing readiness proof. For seats other than an unrestricted owner, audit rows without a visibility proof cannot safely produce event-dependent diagnostics. This includes owners with source grants, policy restrictions or deleted-source authority. Such seats receive the constant `PROJECTION_CAPABILITY_PARTIAL` reason even on an otherwise empty day; hidden rows cannot change that diagnostic.

Every read rechecks membership and the complete detached store before release. A resolver that mutates state, replaces the workspace, or changes authority fails the read. Per-read list caches avoid rescanning whole service histories for every event; no cache survives release.

Parent integration must also keep Today assembly read-only. Calling existing dashboard/report calculation paths on every Today read would create new `calculation.completed` audit records before this module reads them. This module cannot truthfully identify those records as display-only because the existing audit does not record that purpose. Parent must avoid such writes or separately supply truthful purpose evidence; it must not infer or hide user calculations based on timing or operation name.

## Evidence and limits

`platform/tests/today-events.test.ts` exercises explicit local midnight, spring/fall DST, more than six events, same-time ordering, unknown kinds, corrupt audit records, missing resolvers/rules, immutable held results and safe reference release. Audit instants are transplanted into real synthetic import evidence only for date-boundary tests.

`platform/tests/today-events-services.test.ts` uses actual Import, Learning, Calculator, Action, Report and Job services over synthetic CSV. Calculator guards come from `EngineConnectorService`; the action registry comes from the shipped Engine local registry; execution evidence uses `createJournalExecutionResolver`; jobs use `createEngineJobRunner.canRelease`. `FixtureStateStore` is labeled synthetic custody, not a substitute source service or a database qualification. The tests verify restrictions, source deletion, other owners' receipts, epoch revocation, held stale deliveries, and retained managed captures lacking a current readiness profile.

No native app, browser, live provider, credentials, external sends, package acquisition, or CI rerun is needed by this implementation. Native database durability, renderer/desktop integration, and full Today acceptance remain unverified. Strict compiler availability and exact final validation are recorded in the private handoff evidence for this branch.
