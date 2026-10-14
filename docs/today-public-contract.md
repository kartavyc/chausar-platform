# Today public contract — frozen source 5edf751b5fc5

This is a portable transcription of the source contract at **`5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd`**, tree **`2d0d8d438111e9f404b2238d4ab2360e220f8a50`**, base **`2bc59dc1f527ec67dafa8fa350fd9832f3f705ba`**. The declarations below are copied literally from that source and grouped for review; they are not a new production module. All source links point to that immutable remote source SHA. The publishing coordinator verified its remote presence and a separate skip-CI checkpoint; documentation publication is tracked separately.

The publishing coordinator verified the exact source commit on the private repository. The new non-force checkpoint [private/today-engine-5edf751b-20261004-55644bf6d0b3](https://github.com/kartavyc/chausar-platform/tree/private/today-engine-5edf751b-20261004-55644bf6d0b3) points to metadata-only skip-CI child [8d9dfb7078c00b05f6ddf3454fb3662e2a123114](https://github.com/kartavyc/chausar-platform/commit/8d9dfb7078c00b05f6ddf3454fb3662e2a123114), retaining the exact frozen source tree. All 55 prior refs, including main at 87c400870563b92803841d3a198cee801f7740df, were verified unchanged; the coordinator reported zero workflow runs for the checkpoint. These are publication observations, not native acceptance.

Actual Engine composition installs the Tiles, Attention, Events and persistent Review services over the same current Vault State. The desktop RPC allowlist contains these six methods. Renderer requests cannot supply host options, guards, producer output or authority assertions.

| Named method | Payload | Result |
|---|---|---|
| `today.get` | `EngineTodayGetRequest` | `EngineTodayResponse` |
| `today.prepareTiles` | `TodayPrepareTilesRequest` | `TodayPreparedTiles` |
| `today.review` | Optional `TodayReviewPageRequest` | `TodayReviewQueue` |
| `today.resolveReview` | `{ reference: TodayReviewReference }` | `TodayReviewRow` |
| `today.resolveEvent` | `TodayEventsRequest & { eventId: string }` | `TodayDayEvent['reference']` |
| `today.resolveAttention` | `TodayAttentionResolveRequest` | `TodayAttentionResolved` |

Exact named typing is in [app/desktop/types.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/app/desktop/types.ts); runtime allowlisting is in [ipc-contract.cjs](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/app/desktop/ipc-contract.cjs) with [its declaration](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/app/desktop/ipc-contract.d.cts). Unknown request fields are refused before producer dispatch, with current member epoch validated first.

## Integration rules

- Keep actual metrics per starter pack, chart periods/buckets/comparisons, business timezone and attention lifecycle/order defaults **unconfigured** pending the owner's choices. Three tiles is a configuration/layout bound, not selected financial metrics.
- Every read specifies `date` and a named `timeZone`. Begin with `today.get({ date, timeZone })`; absent tile custody gives `capture-required`.
- Custom preparation requires current exact starter-pack `id`, `dictionaryHash` and `version`, and `configurationDigest === hash(request)`. Engine preparation accepts exactly three tiles with at most 120 explicit buckets per tile. It generates no periods or chart points. Tile validation also bounds requested sources to 64 and all calculations to 512.
- Keep primary, comparison and chart figures from current receipts. A null figure is missing evidence. Do not calculate totals, interpolate offscreen points, substitute zero, or turn a section timestamp into a whole-dashboard timestamp.
- `prepareTiles` deliberately writes receipts; a failed preparation can leave earlier private receipts. `get`, pagination and resolvers are read-only; they must not invoke preparation, approvals, calculations, jobs or effects implicitly.
- Use the returned tile capture reference for subsequent reads. Private custody holds at most 64 captures. Lock/reopen or a fresh process discards it; a fresh process must explicitly prepare again. Serialized prior responses cannot restore custody.
- Preserve `atomic: false`, `noAction: true`, global partial state with `asOf: null`, section coverage and `productReviewCount: null`. These scoped services do not establish a whole-app count or whole-dashboard snapshot.
- Render attention cards from `attention.selection.rows`. The full authorized `attention.value` is retained projection/evidence, including cleared or retracted history. Missing selection policy stays unavailable. Configured selection order is explicit; combined selected attention and initial Review rows is capped at five.
- Embedded Review is the first four rows of the same eligible set used by `today.review`. Pagination defaults to four and caps at 100. `knownCount` is scoped; `count` stays null with incomplete coverage. Dedicated invoice mutation domains are excluded before counting, paging and cursor creation.
- Events show at most six authorized supported entries. `total` counts that supported set before the six-event cut. Preserve complete/partial/unavailable coverage. Full-day activity paging is not supplied by these six RPCs.
- Resolve references freshly before drilldown. Resolvers return exact domain destinations and do not open arbitrary URLs or execute requests. Preserve complete job acceptance pins, including `deliverableDigest`; mutations must reauthorize and compare pins inside their serialized mutation.
- Starter-pack IDs and reviewed calendar IDs/entry IDs/version are exact opaque nonblank source identities. Supported custom packs and reviewed calendar identities can contain spaces or Unicode. Do not narrow those fields to a new frontend identifier grammar.

The literal production digest helper is below. For JSON requests it hashes UTF-8 `JSON.stringify(request)` using SHA-256, preserving actual property order. Do not substitute a sorted-key canonicalizer or different encoding. The current RPC requires the exact digest; this handoff adds no renderer hashing API.

~~~ts
export const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
~~~

`createHash` is the existing `node:crypto` import in [contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/contracts.ts). Financial minor-unit values remain decimal integer strings.

## Combined public request, response, reference and method types

Exact declarations from [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts).

~~~ts
export type TodayDisplay = { date: string; timeZone: string };

export type TodayTileCaptureReference = { id: string; digest: string };

export type TodayStarterPackBinding = { id: string; dictionaryHash: string; version: number };

export type TodayPrepareTilesRequest = TodayDisplay & {
  configurationId: string; configurationDigest: string; starterPack: TodayStarterPackBinding; request: TodayTilesRequest;
};

export type TodayPreparedTiles = {
  reference: TodayTileCaptureReference; display: TodayDisplay;
  configuration: { id: string; digest: string; starterPack: TodayStarterPackBinding; origin: 'custom' }; result: TodayTilesResult;
};

export type EngineTodayGetRequest = TodayDisplay & { tileCapture?: TodayTileCaptureReference };

export type TodayAttentionRowReference = AttentionAlertEpisode['reference'] | AttentionDueDecision['reference'] | AttentionCalendarRow['reference'];

export type TodayAttentionReference = TodayAttentionRowReference | Extract<AttentionCalendar, { state: 'reviewed' }>['reference'];

export type TodayAttentionRow =
  | { id: string; kind: 'alert-episode'; value: AttentionAlertEpisode }
  | { id: string; kind: 'due-decision'; value: AttentionDueDecision }
  | { id: string; kind: 'compliance-entry'; value: AttentionCalendarRow };

export type TodayAttentionSelectionPolicy = {
  id: string; revision(): string;
  select(context: Context, projection: TodayAttention): readonly TodayAttentionRowReference[];
};

export type TodayAttentionSelection =
  | { state: 'unavailable'; reason: 'selection-policy-required'; rows: [] }
  | { state: 'configured'; policyId: string; policyRevision: string; eligibleCount: number; rows: TodayAttentionRow[] };

export type EngineTodayResponse = {
  kind: 'today-engine-v1'; display: TodayDisplay; atomic: false; noAction: true;
  starterPack: TodayStarterPackBinding | null;
  defaults: { state: 'unconfigured'; reason: 'pack-defaults-not-configured' };
  state: { kind: 'partial'; asOf: null; reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' };
  /** The supported scoped review producer does not establish a whole-app total. */
  productReviewCount: null;
  tiles: { state: 'prepared'; value: TodayPreparedTiles }
    | { state: 'unavailable'; reason: 'capture-required' | 'tiles-service-unavailable' };
  attention: { state: 'available'; value: TodayAttention; selection: TodayAttentionSelection }
    | { state: 'unavailable'; reason: 'attention-service-unavailable' | 'attention-guards-required' };
  review: { state: 'available'; value: TodayReviewQueue }
    | { state: 'unavailable'; reason: 'review-service-unavailable' };
  dayEvents: { state: 'available'; value: TodayDayEvents }
    | { state: 'unavailable'; reason: 'events-service-unavailable' };
};

export type TodayAttentionResolveRequest = TodayDisplay & { reference: TodayAttentionReference };

export type TodayAttentionResolved = AttentionAlertEpisode | AttentionDueDecision | AttentionCalendarRow | Extract<AttentionCalendar, { state: 'reviewed' }>;

export type EngineTodayMethods = {
  prepareTiles(context: Context, request: TodayPrepareTilesRequest): Promise<TodayPreparedTiles>;
  get(context: Context, request: EngineTodayGetRequest): EngineTodayResponse;
  review(context: Context, request?: TodayReviewPageRequest): TodayReviewQueue;
  resolveReview(context: Context, reference: TodayReviewReference): TodayReviewRow;
  resolveEvent(context: Context, request: TodayEventsRequest & { eventId: string }): TodayDayEvent['reference'];
  resolveAttention(context: Context, request: TodayAttentionResolveRequest): TodayAttentionResolved;
};

~~~

## Tiles: configuration and every nested response value

Exact declarations from [platform/runtime/today-tiles-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-tiles-contracts.ts).

~~~ts
export type TodayTileBucket = { id: string; label: string; period: Period };

export type TodayTileComparison = { operation: string; figureKey: string; period: Period };

export type TodayTileConfiguration = {
  id: string; label: string; operation: string; figureKey: string; period: Period;
  buckets: TodayTileBucket[]; comparison?: TodayTileComparison;
};

export type TodayTilesScope = { sourceIds: string[]; branch: string | null };

export type TodayTilesRequest = {
  dictionaryHash: string;
  /** One canonical ISO knowledge timestamp for every receipt, including comparisons. */
  asOf: string;
  scope: TodayTilesScope;
  tiles: TodayTileConfiguration[];
};

export type TodayTileDefinition = {
  dictionaryHash: string; ontologyVersion: number; definitionHash: string;
  definitions: Definition[]; operationId: string; operationType: Operation['type'];
};

export type TodayTileGap = { code: string; message: string; definitionName?: string; period?: Period };

export type TodayTileValue = {
  status: 'available' | 'partial' | 'unavailable';
  /** Copied from a currently authorized receipt. Empty evidence never supplies a figure. */
  figure: Figure | null; receiptId: string | null;
  definition: TodayTileDefinition | null;
  coverage: CalculationReceipt['coverage'] | null;
  gaps: TodayTileGap[];
};

export type TodayTile = {
  id: string; label: string; operation: string; figureKey: string; period: Period;
  value: TodayTileValue;
  points: (TodayTileBucket & { value: TodayTileValue })[];
  comparison?: TodayTileComparison & { value: TodayTileValue };
};

export type TodayTilesResult = {
  version: 1; asOf: string; dictionary: { hash: string; version: number }; scope: TodayTilesScope;
  /** Receipts are saved sequentially. A failed assembly can leave earlier private receipts. */
  atomic: false;
  /** Presence of the installed verifier, never a native database qualification claim. */
  verification: 'configured' | 'not-configured';
  tiles: TodayTile[];
};

~~~

## Tile dependencies: periods and calculation filters

Exact declarations from [platform/runtime/memory.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/memory.ts).

~~~ts
export type Period = { from: string; to: string };

export type FactFilter = { period?: Period; asOf?: string; branch?: string; customerId?: string; orderId?: string; kinds?: string[] };

~~~

## Tile dependencies: receipt figures and coverage

Exact declarations from [platform/runtime/calculator.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/calculator.ts).

~~~ts
export type CalculationRequest = FactFilter & { operation: string; sourceIds?: string[]; comparePeriod?: Period; onDate?: string; assumptions?: { priceChangeBps: string } };

export type Figure = { key: string; label: string; minor: string; display: string; unit: 'money' | 'basis-points'; currency?: string };

export type ReceiptRow = { factId: string; entityId: string; sourceId: string; sourceRow: number; kind: string; amountMinor: string; measureField?: string; validFrom: string; dueDate?: string; invoiceId?: string; customerId?: string; orderId?: string; status?: string; branch?: string; normalization?: { sourceCurrency: string; targetCurrency: string; rate: unknown } };

export type CalculationReceipt = { id: string; memberId: string; epoch: number; sourceIds: string[]; requestedSourceIds?: string[]; operation: string; createdAt: string; asOf: string; period: Period | null; comparePeriod: Period | null; branch: string | null; currency: string; ontologyVersion: number; dictionaryHash: string; definitionHash: string; definitions: Definition[]; compiledCalculation?: CompiledCalculationBinding; figures: Figure[]; valueMinor: string; totalMinor: string; rowIds: string[]; rows: ReceiptRow[]; exclusions: { rowId: string; reason: string }[]; coverage: { selectedRows: number; countedRows: number; excludedRows: number; unresolvedConflicts: number; importIds: string[]; completeness: 'reconciled-imports' | 'unreconciled-facts' | 'empty' | 'partial'; gaps: string[] }; assumptions: Record<string, unknown>; explanation: string; stale: boolean; staleReason?: string; allowedNumbers: string[]; databaseProof?: unknown; restatement?: ReceiptRestatement };

export type ReceiptRestatement = { version: 1; interpretation: 'restated-private-diagnostic'; trialId: string; forkDigest: string;
  candidateStateDigest: string; publicationId: string; originalAnswerId: string; originalReceiptId: string };

~~~

Only the literal coverage member of CalculationReceipt is exposed through TodayTileValue's indexed access. The full declaration resolves that type without rewriting production. ReceiptRow, restatement and compiled bindings resolve its other members; they add no Today tile payload fields.

## Tile dependencies: published definitions and operation kind

Exact declarations from [platform/runtime/ontology.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/ontology.ts).

~~~ts
export type Definition = { name: string; label: string; meaning: string; kind: string; field: string; currency: string; nulls: 'exclude' | 'reject'; sign?: 1 | -1 };

export type Operation = { id: string; label: string; type: 'sum' | 'margin' | 'aging' | 'change' | 'scenario'; definitions: string[]; parameters: string[] };

~~~

## Receipt dependency: closed compiled sum binding

Exact declarations from [platform/runtime/compiled-calculation.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/compiled-calculation.ts).

~~~ts
export type CompiledSingleSum = {
  contractVersion: 1; compilerVersion: 'chausar-single-sum/1'; type: 'single-definition-sum';
  operationId: string; definitionName: string; recordKind: string; moneyField: string;
  currency: string; sign: 1 | -1; nullPolicy: 'reject' | 'exclude';
  dictionaryVersion: number; definitionHash: string; digest: string;
};

export type CompiledCalculationBinding = { dictionaryHash: string; sum: CompiledSingleSum };

~~~

## Attention: retained episodes, due decisions and reviewed calendar

Exact declarations from [platform/runtime/today-attention.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-attention.ts).

~~~ts
export type TodayAttentionRequest = { displayedDate: string; timeZone: string; branch?: string };

export type AttentionObservation = Pick<AlertObservation, 'id' | 'anchorId' | 'observedAt' | 'recordedAt' | 'state' | 'issues' | 'amends' | 'amendmentReason'> & { receiptId: string | null };

export type AttentionAlertEpisode = {
  reference: { kind: 'alert-episode'; alertId: string; episodeId: string };
  conditionId: string; label: string; revision: number; definitionDigest: string;
  branch: string | null; sourceIds: string[]; receiptIds: string[];
  /** Retained lifecycle, including cleared/retracted history; presence is not a new breach assertion. */
  episode: AlertEpisode;
  lastObservation: AttentionObservation | null;
  amendments: AttentionObservation[];
  notices: AlertNotice[];
  evidence: { state: 'current' | 'uncertain'; issues: string[] };
};

export type AttentionDueDecision = {
  reference: { kind: 'decision'; decisionId: string };
  text: string; reviewDate: string; due: 'today' | 'overdue'; status: 'open';
  branch: string | null; revision: number | null; receiptIds: string[];
};

export type ReviewedComplianceEntry = {
  entryId: string; title: string; dueDate: string; sourceUrl: string; publishedAt: string;
  lastCheckedAt: string; reviewedAt: string; reviewedBy: string;
  /** Supplied reviewed source meaning, never inferred from a due date or a business name. */
  applicability: { state: 'applicable' | 'not-applicable' | 'unknown'; basis: string };
};

export type TodayAttentionCalendarInput =
  | { state: 'unavailable' }
  | { state: 'unsupported' }
  | { state: 'reviewed'; calendarId: string; version: string; sourceIds: string[];
      reviewedAt: string; reviewedBy: string; lastCheckedAt: string;
      applicability: ReviewedComplianceEntry['applicability'];
      coverage: { from: string; through: string; timeZone: string }; entries: ReviewedComplianceEntry[] };

export type AttentionCalendarRow = ReviewedComplianceEntry & {
  reference: { kind: 'compliance-entry'; calendarId: string; entryId: string };
};

export type AttentionCalendar = {
  window: { from: string; through: string; days: 7; timeZone: string };
} & (
  | { state: 'unavailable'; reason: 'no-reviewed-calendar' | 'current-authority-unavailable'; rows: [] }
  | { state: 'unsupported'; reason: 'calendar-source-contract-required' | 'calendar-provenance-incomplete' | 'calendar-window-not-covered'; rows: [] }
  | { state: 'reviewed'; reference: { kind: 'reviewed-compliance-calendar'; calendarId: string; version: string };
      sourceIds: string[]; reviewedAt: string; reviewedBy: string; lastCheckedAt: string;
      applicability: ReviewedComplianceEntry['applicability'];
      coverage: { from: string; through: string; timeZone: string }; rows: AttentionCalendarRow[] }
);

export type TodayAttention = {
  kind: 'today-attention-v1'; request: TodayAttentionRequest;
  authority: { workspaceId: string; memberId: string; epoch: number; stateRevision: number };
  /** Stable AlertsService.brief alert order, then retained episode order; no severity rank. */
  alertEpisodes: AttentionAlertEpisode[];
  /** ReportService.dueDecisions retained order; no added overdue/severity rank. */
  dueDecisions: AttentionDueDecision[];
  calendar: AttentionCalendar;
  counts: { alertEpisodes: number; dueDecisions: number; calendarEntries: number };
  alertsCheckedAt: string;
  evaluated: false;
  pin: string;
};

~~~

## Attention dependencies: exact alert lifecycle and notices

Exact declarations from [platform/runtime/alerts-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/alerts-contracts.ts).

~~~ts
export type AlertSeverity = 'warning' | 'critical';

export type AlertReceiptPin = {
  receiptId: string;
  digest: string;
  request: CalculationRequest;
  asOf: string;
  period: Period | null;
  comparePeriod: Period | null;
  rowIds: string[];
  sourceIds: string[];
};

export type AlertObservation = {
  id: string;
  anchorId: string;
  observedAt: string;
  recordedAt: string;
  payloadHash: string;
  evidenceHash?: string;
  receipt?: AlertReceiptPin;
  valueMinor?: string;
  state: 'breach' | 'clear' | 'band' | 'unknown';
  severity?: AlertSeverity;
  issues: string[];
  amends?: string;
  amendmentReason?: string;
};

export type AlertEpisode = {
  id: string;
  status: 'open' | 'cleared' | 'retracted';
  severity: AlertSeverity;
  openedAt: string;
  clearedAt?: string;
  reopenedAt?: string;
  reopenCount: number;
  uncertain: boolean;
  observationIds: string[];
};

export type AlertNotice = {
  id: string;
  kind: 'local-alert-notice-v1';
  transition: 'opened' | 'cleared' | 'escalated' | 'deescalated' | 'reopened' | 'uncertain' | 'evidence-restored' | 'amended';
  alertId: string;
  episodeId: string;
  at: string;
  observationId: string;
  before: AlertEpisode | null;
  after: AlertEpisode;
  delivery: 'local-only';
};

~~~

AttentionObservation uses only the literal Pick fields listed above plus receiptId. The full AlertObservation declaration resolves that Pick without granting alert evaluation or publication.

## Review: scoped queue, exact references and mutation request descriptions

Exact declarations from [platform/runtime/today-review.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-review.ts).

~~~ts
export const TODAY_REVIEW_SCOPE = 'prepared-actions-job-mandates-deliverables-lessons-v1' as const;

export type TodayReviewKind = 'action-approval' | 'job-approval' | 'job-acceptance' | 'lesson-decision';

export type TodayReviewReference =
  | { kind: 'action-approval' | 'job-approval'; id: string; revision: number; digest: string }
  | { kind: 'job-acceptance'; id: string; revision: number; digest: string; deliverableDigest: string }
  | { kind: 'lesson-decision'; id: string; revision: number; digest: string; reviewId: string; reviewDigest: string; evaluationDigest: string };

export type TodayReviewRequest =
  | { method: 'actions.approve' | 'jobs.approve'; payload: { id: string; digest: string } }
  | { method: 'jobs.accept'; payload: { id: string; reference: JobAcceptanceReference } }
  /** Decision and reason must be supplied by the human, never by this read. */
  | { method: 'memory.decideLesson'; payload: { candidate: { id: string; revision: number; digest: string }; reviewId: string; reviewDigest: string }; requiredHumanFields: ['decision', 'reason'] };

export type TodayReviewProvenance =
  | { producer: 'actions' | 'jobs' | 'lessons'; id: string; revision: number; digest: string }
  | { producer: 'job-action-preview'; id: string; revision: number; digest: string; stepId: string; operationKey: string; actionId: string; actionDigest: string; deliverableDigest: string };

export type TodayReviewRow = {
  kind: TodayReviewKind; title: string; since: string; reference: TodayReviewReference;
  request: TodayReviewRequest; canApprove: boolean; provenance: TodayReviewProvenance[];
};

export type TodayReviewProducer = {
  status: 'complete' | 'incomplete' | 'unavailable';
  reason?: 'PRODUCER_AUTHORITY_UNAVAILABLE' | 'PRODUCER_READ_UNAVAILABLE' | 'REVIEW_EVIDENCE_UNAVAILABLE' | 'UNSUPPORTED_MUTATION_CONTRACT';
};

export type TodayReviewQueue = {
  scope: typeof TODAY_REVIEW_SCOPE; completeness: 'complete' | 'incomplete' | 'unavailable';
  /** Null until every producer in this scoped set is available. */
  count: number | null; knownCount: number; rows: TodayReviewRow[]; nextCursor: string | null;
  producers: Record<'actions' | 'jobs' | 'lessons', TodayReviewProducer>;
};

export type TodayReviewPageRequest = { limit?: number; cursor?: string };

~~~

## Review dependency: exact job acceptance pins

Exact declarations from [platform/runtime/jobs.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/jobs.ts).

~~~ts
export type JobAcceptanceReference = { kind: 'job-acceptance'; id: string; revision: number; digest: string; deliverableDigest: string };

~~~

The desktop `jobs.accept` payload is `{ id: string; repeat?: boolean; reference?: JobAcceptanceReference }`. Legacy id-only acceptance remains supported outside this Today pin contract. A Today Review acceptance must retain the complete returned reference. Real JobService compares objective revision/digest and exact deliverable digest inside its serialized mutation before acceptance status, audit or repeat changes. `TodayReviewRequest` describes an available mutation; this read never submits it. Lesson decision and reason are human inputs.

## Events: all supported event variants, destinations and coverage reasons

Exact declarations from [platform/runtime/today-events.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-events.ts).

~~~ts
export interface TodayEventsRequest { readonly date: string; readonly timeZone: string }

export type TodayEventActor = { readonly kind: 'member'; readonly memberId: string } | { readonly kind: 'not-recorded' };

type EventBase = { readonly id: string; readonly at: string; readonly actor: TodayEventActor };

export type TodayActionKind = 'action.prepared' | 'action.revised' | 'action.approved' | 'action.attempt' | 'action.settled' | 'action.reconciled' | 'action.cancelled' | 'action.interrupted';

export type TodayActionOutcome = 'prepared' | 'approved' | 'executing' | 'verified' | 'unknown' | 'rejected' | 'blocked' | 'cancelled';

export type TodayDecisionOutcome = 'accepted' | 'rejected' | 'continue' | 'completed';

export type TodayDayEvent = EventBase & (
  | { readonly kind: 'source.imported'; readonly args: { readonly sourceId: string; readonly format: ImportFormat; readonly rowCount: number; readonly qualification: 'experimental' }; readonly reference: { readonly kind: 'import'; readonly importId: string; readonly sourceId: string } }
  | { readonly kind: 'source.import-refused'; readonly args: { readonly sourceId: string; readonly reasonCode: typeof REASON_CODES[number]; readonly qualification: 'experimental' }; readonly reference: { readonly kind: 'import-refusal'; readonly learningEventId: string } }
  | { readonly kind: 'calculation.completed'; readonly args: { readonly operation: string; readonly stale: boolean }; readonly reference: { readonly kind: 'receipt'; readonly receiptId: string } }
  | { readonly kind: TodayActionKind; readonly args: { readonly connector: string; readonly operation: string; readonly outcome?: TodayActionOutcome; readonly businessSuccess?: boolean | null }; readonly reference: { readonly kind: 'action'; readonly actionId: string } }
  | { readonly kind: 'decision.created' | 'decision.revised'; readonly args: { readonly revision?: number }; readonly reference: { readonly kind: 'decision'; readonly decisionId: string } }
  | { readonly kind: 'decision.reviewed'; readonly args: { readonly outcome: TodayDecisionOutcome; readonly revision?: number }; readonly reference: { readonly kind: 'decision'; readonly decisionId: string } }
  | { readonly kind: 'job.delivered'; readonly args: { readonly spentMinor: string }; readonly reference: { readonly kind: 'job-delivery'; readonly jobId: string } }
);

export type TodayEventsReason = 'CALENDAR_RULES_UNAVAILABLE' | 'AUTHORITY_RESOLVER_UNAVAILABLE' | 'UNSUPPORTED_EVENT_KIND' | 'EVENT_EVIDENCE_UNRESOLVED' | 'ACTOR_NOT_RECORDED' | 'PROJECTION_CAPABILITY_PARTIAL';

export interface TodayDayEvents {
  readonly date: string;
  readonly timeZone: string;
  /** Calendar revision identifies the installed display rules, not scheduling qualification. */
  readonly calendarRevision: string | null;
  readonly events: readonly TodayDayEvent[];
  /** Count only the complete authorized supported set, before its six-mark cut. */
  readonly total: number;
  readonly state: { readonly kind: 'complete' | 'partial' | 'unavailable'; readonly reasonCodes: readonly TodayEventsReason[] };
}

~~~

## Event dependency: import formats

Exact declarations from [platform/runtime/ingest.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/ingest.ts).

~~~ts
export type ImportFormat = 'csv' | 'tally-xml' | 'zoho-json' | 'gst-json' | 'bank-csv' | 'shopify-json' | 'xlsx';

~~~

## Event dependency: import/refusal learning reason codes

Exact declarations from [platform/runtime/learning.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/learning.ts).

~~~ts
export const REASON_CODES = ['manual_confirmation', 'ambiguous_field', 'type_match', 'date_format', 'currency_mismatch', 'duplicate_record', 'exact_reference', 'reconciliation', 'unsupported_shape', 'verified_readback'] as const;

~~~

## Trusted host configuration

`EngineOptions.today` is a constructor-only installed capability. Its exact member declaration in [engine.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine.ts) is:

~~~ts
  today?: EngineTodayHostOptions;
~~~

The following fields install qualified display rules, a reviewed calendar adapter, an explicit attention selection policy and live external authority generation. They are not IPC payloads or renderer-accessible permissions. Public method `Context` parameters are injected by Engine; no Today RPC accepts them.

## Engine host option type

Exact declarations from [platform/runtime/engine.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine.ts).

~~~ts
export type EngineTodayHostOptions = {
  calendarRules?: CalendarRules;
  calendar?: TodayAttentionOptions['calendar'];
  selection?: TodayAttentionSelectionPolicy;
  /** Advance for every outside-State report, job, lesson or calendar guard change. */
  authorityRevision?: () => string;
};

~~~

## Explicit calendar rules and constructor configuration

Exact declarations from [platform/runtime/calendar-zone.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/calendar-zone.ts).

~~~ts
export interface CalendarRules {
  revision: string;
  minYear: number;
  maxYear: number;
  canonicalZone(zone: string): string;
  localAt(instant: number, zone: string): string;
  candidates(local: string, zone: string): number[];
}

export type IntlCalendarRulesOptions = {
  timeZones: string[]; minYear: number; maxYear: number; maxCachedLocalTimes: number;
};

~~~

`IntlCalendarRules` implements `CalendarRules` from the same source file. Its constructor needs exact `IntlCalendarRulesOptions`: an explicit nonempty named-zone list, a declared civil-year range within 2000–2100, and bounded nonnegative cache capacity. No business zone, year range, cache capacity or scheduling occurrence policy is inferred here. Its revision identifies installed runtime tzdb/ICU rules; it is not scheduling/native qualification.

## Trusted attention adapter option signature

Exact declarations from [platform/runtime/today-attention.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-attention.ts).

~~~ts
export type TodayAttentionOptions = {
  /** Factories bind existing receipt/readiness/execution guards to the read-only current view. */
  alertsOptions?: (view: StateStore) => AlertsOptions;
  reportOptions?: (view: StateStore) => ReportOptions;
  calendar?: (ctx: Context, request: TodayAttentionRequest, view: StateStore) => TodayAttentionCalendarInput;
};

~~~

## Host-only context and actual StateStore interface

Exact declarations from [platform/runtime/contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/contracts.ts).

~~~ts
export type Role = 'owner' | 'cofounder' | 'accountant' | 'viewer';

export type Context = { memberId: string; role: Role; epoch: number; channel?: 'desktop' | 'phone' | 'mcp'; sourceTainted?: boolean };

export interface StateStore {
  read(): State;
  update<T>(change: (state: State) => T | Promise<T>): Promise<T>;
}

~~~

## Standalone installed Engine Today service option type

Exact declarations from [platform/runtime/engine-today.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today.ts).

~~~ts
export type EngineTodayOptions = {
  store: StateStore; tiles?: TodayTilesService; attention?: TodayAttentionService;
  events?: TodayEventsService; review?: TodayReviewService;
  /** Pure synchronous live generation covering ALL installed outside-State read authority.
   * Supplied by the trusted host, never accepted from an RPC caller. */
  authorityRevision(): string;
  selection?: TodayAttentionSelectionPolicy;
};

~~~

The already quoted `TodayAttentionSelectionPolicy` is the exact installed selection configuration: `id`, synchronous live `revision()`, and pure `select(context, projection)` returning already-authorized references. Reviewed calendar outputs use the already quoted `TodayAttentionCalendarInput` and `ReviewedComplianceEntry`. Applicability and provenance come from reviewed sources, not due-date or business-name inference.

Engine composition uses explicit `today.calendarRules`, or already explicitly installed `jobCalendar.rules`. Live `today.authorityRevision` is required when reports execution-receipt, durable jobs, lessons, calendar or selection ports have authority outside State. It must change on every grant/release/revocation of all such installed authorities. Engine host revisions are synchronous trimmed strings of 1–200 characters without control characters; selection revisions are synchronous trimmed strings of 1–4096 characters without control characters. The standalone EngineTodayService generation is a synchronous nonblank string bounded to 4096 characters; this does not relax the Engine host option checks.

Engine brackets real connector readiness with external and selection revisions, checks installed option/function/port identities, and renews full State and current membership at release. All guards and generation/selection/calendar callbacks are pure synchronous read ports. A permissive guard, generated constant, fixture callback or fabricated generation is not a production fallback. Late withdrawal, port replacement, changed selection, changed membership, stale receipts or elapsed retention withhold the response. No authority-changing callback runs after the final fence.

Host-only dependencies retain real source identity instead of being flattened into renderer JSON:

| Dependency | Authoritative source | Boundary |
|---|---|---|
| `State` referenced by `StateStore` | [contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/contracts.ts) | Complete encrypted workspace with optional Scenario/Lesson namespaces and existing `any` collections. It is not a Today response or IPC installation payload. |
| `AlertsOptions` / `CalculatorOptions` | [alerts-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/alerts-contracts.ts), [calculator.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/calculator.ts) | Actual installed readiness/receipt/verifier callbacks; TodayAttentionOptions rebinds them to a read-only current view. |
| `ReportOptions` / `JournalExecutionReceipt` | [reports.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/reports.ts), [decision-journal.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/decision-journal.ts) | Existing trusted execution/current-access resolver and retained alert reader, not caller assertions. |
| `TodayTilesService`, `TodayAttentionService`, `TodayEventsService`, `TodayReviewService` | [today-tiles.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-tiles.ts), [today-attention.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-attention.ts), [today-events.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-events.ts), [today-review.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-review.ts) | Real class identity and exact shared StateStore identity are checked. Detached JSON cannot install a service. |
| Other `EngineOptions` members | [engine.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine.ts) | Existing host composition, credentials, storage and worker options are outside this Today contract; this handoff adds none. |

All named types used by public Today JSON request/response/reference structures are literal declarations above, including indexed receipt coverage, picked observations, event reason constants and exact acceptance pins. The linked dependencies occur only in host/service/method capability types. Do not replace them with empty/unknown stand-ins or clone them as renderer capabilities.

## Fixed supported refusal codes

Preload `requestEnvelope` is the safe code-preserving transport. It returns `{ version: 1, ok: true, result }` or `{ version: 1, ok: false, error: { code } }`. It accepts exact reply/error fields and fixed allowlist membership, and drops exception messages, stacks, causes and metadata. Unknown codes or malformed/extra-property replies become `REQUEST_FAILED`. Do not accept arbitrary `TODAY_` or `REVIEW_` prefixes. Older `request()` throwing-Error transport remains present; a renderer adapter must not depend on thrown `.code` surviving contextBridge.

The exact [preload.cjs](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/app/desktop/preload.cjs) allowlist contains **121 unique fixed codes**, including **43 Today/Review/job-pin codes**. Existing fixed access/source/receipt/lesson/transport codes also apply when domain guards refuse. Not every allowlisted code is promised for every Today method.

~~~js
const refusalCodes = new Set([
  'INVALID_REPLY', 'READ_INVALIDATED', 'ACCESS_DENIED', 'VAULT_LOCKED', 'UNAUTHENTICATED', 'EVIDENCE_UNAVAILABLE',
  'ACCESS_REVOKED', 'SOURCE_REVOKED', 'BRANCH_FORBIDDEN', 'RECEIPT_FORBIDDEN', 'FORBIDDEN', 'RECEIPT_NOT_FOUND',
  'INVALID_SESSION', 'ROUTE_REVOKED', 'OUTBOUND_APPROVAL_REQUIRED', 'CONVERSATION_CONTINUATION_RESOLVED',
  'CONVERSATION_CONTINUATION_LIMIT', 'PREVIEW_STALE', 'PAYLOAD_CHANGED', 'PREVIEW_REQUEST_CHANGED', 'SYNTHESIS_STALE',
  'CONVERSATION_CONTINUATION_STALE', 'MODEL_RECEIPT_EXPIRED', 'CALCULATION_STALE', 'CONVERSATION_NOT_FOUND',
  'CONVERSATION_CONTINUATION_UNAVAILABLE', 'MODEL_RECEIPT_NOT_FOUND', 'SYNTHESIS_UNAVAILABLE',
  'SCENARIO_UNAVAILABLE', 'SCENARIO_REVISION_UNAVAILABLE', 'SCENARIO_EVIDENCE_UNAVAILABLE', 'SCENARIO_FORBIDDEN', 'SCENARIO_AUTHORITY_CHANGED',
  'SCENARIO_ARTIFACT_CHANGED', 'SCENARIO_RETENTION_EXPIRED', 'SCENARIO_HOST_REQUIRED', 'SCENARIO_CUSTODY_INVALID', 'SCENARIO_CUSTODY_CONFLICT',
  'SCENARIO_TAINTED_CONTEXT', 'SCENARIO_WORKSPACE_CHANGED', 'SCENARIO_RUN_UNAVAILABLE', 'SCENARIO_READ_ONLY', 'SCENARIO_HEAD_CHANGED',
  'SCENARIO_JOB_UNAVAILABLE', 'SCENARIO_BRANCH_UNAVAILABLE', 'SCENARIO_GRAPH_INVALID', 'SCENARIO_VECTOR_MISMATCH', 'INVALID_SCENARIO',
  'LESSON_AUTHORITY_REQUIRED', 'LESSON_AUTHORITY_REVISION_REQUIRED', 'LESSON_AUTHORITY_CHANGED', 'LESSON_REVIEW_CHANGED',
  'LESSON_EVALUATION_BLOCKED', 'EVALUATION_AUTHORITY_REQUIRED', 'EVALUATION_CHANGED', 'EVALUATION_CANDIDATE_MISMATCH', 'EVALUATION_PROVENANCE_REQUIRED',
  'EVALUATION_COMPARISON_MISMATCH', 'INVALID_LESSON_EVALUATION', 'LESSON_EVIDENCE_UNAVAILABLE', 'LESSON_EVIDENCE_CHANGED', 'LESSON_TARGET_CHANGED',
  'LESSON_OWNER_REQUIRED', 'LESSON_WORKSPACE_CHANGED', 'LESSON_NOT_FOUND', 'LESSON_CHANGED', 'INVALID_LESSON', 'INVALID_LESSON_DECISION',
  'INVALID_LESSON_STATE', 'INVALID_LESSON_TARGET', 'APP_LESSON_REVIEW_REQUIRED', 'TAINTED_LESSON', 'LESSON_CONFLICT', 'INVALID_SUPERSESSION',
  'TODAY_INVALID_REQUEST', 'INVALID_TODAY_REQUEST', 'TODAY_AUTHORITY_REQUIRED', 'TODAY_HOST_AUTHORITY_REQUIRED',
  'TODAY_SERVICE_REQUIRED', 'TODAY_AUTHORITY_STORE_MISMATCH', 'TODAY_AUTHORITY_UNAVAILABLE', 'TODAY_AUTHORITY_CHANGED', 'TODAY_READ_ONLY',
  'TODAY_SELECTION_POLICY_REQUIRED', 'TODAY_SELECTION_INVALID', 'TODAY_CONFIGURATION_INVALID', 'TODAY_PREPARATION_FORBIDDEN',
  'TODAY_CAPTURE_UNAVAILABLE', 'TODAY_TILES_SERVICE_UNAVAILABLE', 'TODAY_TILES_CALCULATOR_REQUIRED', 'TODAY_TILES_INVALID_REQUEST',
  'TODAY_TILES_DEFINITION_CHANGED', 'TODAY_TILES_INPUT_CHANGED', 'TODAY_TILES_RECEIPT_CHANGED', 'TODAY_TILES_HELD_RESULT_FORBIDDEN',
  'TODAY_TILES_RECEIPT_MISMATCH', 'TODAY_TILES_RETENTION_EXPIRED', 'TODAY_ATTENTION_SERVICE_UNAVAILABLE', 'INVALID_TODAY_ATTENTION',
  'TODAY_ATTENTION_STALE', 'TODAY_ATTENTION_REFERENCE_UNAVAILABLE', 'TODAY_EVENTS_SERVICE_UNAVAILABLE', 'INVALID_TODAY_DAY',
  'INVALID_TODAY_EVENT_REFERENCE', 'TODAY_VIEW_CHANGED', 'TODAY_HELD_RESULT_FORBIDDEN', 'TODAY_EVENT_REFERENCE_UNAVAILABLE',
  'TODAY_REVIEW_SERVICE_UNAVAILABLE', 'REVIEW_WORKSPACE_CHANGED', 'REVIEW_AUTHORITY_UNAVAILABLE', 'REVIEW_AUTHORITY_CHANGED',
  'INVALID_REVIEW_PAGE', 'REVIEW_QUEUE_CHANGED', 'REVIEW_REFERENCE_UNAVAILABLE',
  'INVALID_JOB_ACCEPTANCE_REFERENCE', 'PREVIEW_CHANGED', 'JOB_EVIDENCE_REVOKED',
  'INVALID_REQUEST', 'REQUEST_TOO_LARGE', 'UNTRUSTED_SENDER', 'REQUEST_FAILED',
]);
~~~

The 43 Today/Review/job-pin members, in installed order:

~~~text
TODAY_INVALID_REQUEST
INVALID_TODAY_REQUEST
TODAY_AUTHORITY_REQUIRED
TODAY_HOST_AUTHORITY_REQUIRED
TODAY_SERVICE_REQUIRED
TODAY_AUTHORITY_STORE_MISMATCH
TODAY_AUTHORITY_UNAVAILABLE
TODAY_AUTHORITY_CHANGED
TODAY_READ_ONLY
TODAY_SELECTION_POLICY_REQUIRED
TODAY_SELECTION_INVALID
TODAY_CONFIGURATION_INVALID
TODAY_PREPARATION_FORBIDDEN
TODAY_CAPTURE_UNAVAILABLE
TODAY_TILES_SERVICE_UNAVAILABLE
TODAY_TILES_CALCULATOR_REQUIRED
TODAY_TILES_INVALID_REQUEST
TODAY_TILES_DEFINITION_CHANGED
TODAY_TILES_INPUT_CHANGED
TODAY_TILES_RECEIPT_CHANGED
TODAY_TILES_HELD_RESULT_FORBIDDEN
TODAY_TILES_RECEIPT_MISMATCH
TODAY_TILES_RETENTION_EXPIRED
TODAY_ATTENTION_SERVICE_UNAVAILABLE
INVALID_TODAY_ATTENTION
TODAY_ATTENTION_STALE
TODAY_ATTENTION_REFERENCE_UNAVAILABLE
TODAY_EVENTS_SERVICE_UNAVAILABLE
INVALID_TODAY_DAY
INVALID_TODAY_EVENT_REFERENCE
TODAY_VIEW_CHANGED
TODAY_HELD_RESULT_FORBIDDEN
TODAY_EVENT_REFERENCE_UNAVAILABLE
TODAY_REVIEW_SERVICE_UNAVAILABLE
REVIEW_WORKSPACE_CHANGED
REVIEW_AUTHORITY_UNAVAILABLE
REVIEW_AUTHORITY_CHANGED
INVALID_REVIEW_PAGE
REVIEW_QUEUE_CHANGED
REVIEW_REFERENCE_UNAVAILABLE
INVALID_JOB_ACCEPTANCE_REFERENCE
PREVIEW_CHANGED
JOB_EVIDENCE_REVOKED
~~~

Refusal codes are distinct from section state/reason fields: `capture-required`, `pack-defaults-not-configured`, `selection-policy-required`, `TODAY_ENGINE_CONTRACT_PARTIAL`, Review producer coverage reasons and Events coverage reasons. Render those fields faithfully; unavailable sections are not fabricated request failures. Tile `gaps[].code` is an evidence diagnostic string, not an extension to the preload refusal allowlist.

Concrete underlying errors outside this fixed transport allowlist include `FORBIDDEN_BRANCH`, `SOURCE_NOT_READY`, `CONNECTOR_DOMAIN_INCOMPLETE`, `CONNECTOR_DOMAIN_REQUIRED`, `CONNECTOR_PROFILE_NOT_INSTALLED`, `CONNECTOR_BRANCH_FORBIDDEN`, `CALENDAR_ZONE_UNSUPPORTED`, `INVALID_CALENDAR_LOCAL`, `CALENDAR_INSTANT_UNSUPPORTED` and `INVALID_CALENDAR_RULES`. If propagated through `requestEnvelope`, they become `REQUEST_FAILED`; this handoff does not add them to the allowlist. Tiles can instead return unavailable values and evidence gaps for `INVALID_CURRENCY`, `CURRENCY_PRECISION_UNSUPPORTED`, `CURRENCY_MISMATCH`, `MISSING_MEASURE_VALUE`, `INVALID_MINOR_UNITS` and `INVALID_EVENT_SIGN`. Gap diagnostics must not be confused with fixed transport refusals.

## Verification and scope

The frozen source coordinator recorded **615 distinct passing source tests**, zero failures/skips in selected green runs, plus runtime and UI strict checks. Focused coverage includes 22 producer tests, four actual Engine/Vault dispatch tests, four real Engine authority-fence tests, nine atomic acceptance-pin/domain-eligibility tests, and 46 preload refusal tests. The preload suite exercises all 43 fixed Today/Review/job-pin codes plus malformed/unknown reply behavior. This handoff copies frozen declarations and the source allowlist. An independent source review and an automated AST comparison verified all 79 named declarations, 18 source-file hashes and the exact 121-code allowlist.

The closed public JSON types are also supplied in [today-public-types.ts](today-public-types.ts). This literal type extraction includes the public requests, nested responses, references, method types, host-injected Context, and selection signature; it omits only service-installation capability types and the Node digest helper. It passed standalone strict checking with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly` and `skipLibCheck: false`, with zero diagnostics. See [contract verification](verification/today-public-contract-5edf751b.json) and [checkpoint publication evidence](verification/today-engine-checkpoint-5edf751b.json). No native launch or package command ran for this handoff.

Fixtures establish source behavior only. This document claims no PostgreSQL transfer/native GUI/provider effect acceptance, whole-workspace portability or native publication qualification. `fullNativeAcceptance=false`, `fullWorkspacePortable=false`, `pgliteDefault=false`. Independent acceptance and publication remain separately coordinated.

See [engine-today.md](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/docs/engine-today.md) for authority fences, private capture custody, retention and release semantics.

## Literal extraction inventory

Every copied named declaration is listed below. Lines refer to frozen SHA above. TypeScript built-in `Pick`, `Extract`, `Record`, `Promise`, indexed-access and union/intersection semantics remain unchanged.

The inventory contains **79 distinct named declarations/constants**, with no duplicate name. The digest helper, EngineOptions.today member and complete fixed preload allowlist are three additional exact source excerpts outside this inventory.

| Declaration | Frozen source | Line |
|---|---|---|
| TodayDisplay | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 7 |
| TodayTileCaptureReference | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 8 |
| TodayStarterPackBinding | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 9 |
| TodayPrepareTilesRequest | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 10 |
| TodayPreparedTiles | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 13 |
| EngineTodayGetRequest | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 17 |
| TodayAttentionRowReference | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 18 |
| TodayAttentionReference | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 19 |
| TodayAttentionRow | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 20 |
| TodayAttentionSelectionPolicy | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 26 |
| TodayAttentionSelection | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 30 |
| EngineTodayResponse | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 33 |
| TodayAttentionResolveRequest | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 49 |
| TodayAttentionResolved | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 50 |
| EngineTodayMethods | [platform/runtime/engine-today-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today-contracts.ts) | 51 |
| TodayTileBucket | [platform/runtime/today-tiles-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-tiles-contracts.ts) | 6 |
| TodayTileComparison | [platform/runtime/today-tiles-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-tiles-contracts.ts) | 7 |
| TodayTileConfiguration | [platform/runtime/today-tiles-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-tiles-contracts.ts) | 8 |
| TodayTilesScope | [platform/runtime/today-tiles-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-tiles-contracts.ts) | 12 |
| TodayTilesRequest | [platform/runtime/today-tiles-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-tiles-contracts.ts) | 13 |
| TodayTileDefinition | [platform/runtime/today-tiles-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-tiles-contracts.ts) | 20 |
| TodayTileGap | [platform/runtime/today-tiles-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-tiles-contracts.ts) | 24 |
| TodayTileValue | [platform/runtime/today-tiles-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-tiles-contracts.ts) | 25 |
| TodayTile | [platform/runtime/today-tiles-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-tiles-contracts.ts) | 33 |
| TodayTilesResult | [platform/runtime/today-tiles-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-tiles-contracts.ts) | 39 |
| Period | [platform/runtime/memory.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/memory.ts) | 5 |
| FactFilter | [platform/runtime/memory.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/memory.ts) | 6 |
| CalculationRequest | [platform/runtime/calculator.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/calculator.ts) | 8 |
| Figure | [platform/runtime/calculator.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/calculator.ts) | 9 |
| ReceiptRow | [platform/runtime/calculator.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/calculator.ts) | 10 |
| CalculationReceipt | [platform/runtime/calculator.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/calculator.ts) | 11 |
| ReceiptRestatement | [platform/runtime/calculator.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/calculator.ts) | 19 |
| Definition | [platform/runtime/ontology.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/ontology.ts) | 5 |
| Operation | [platform/runtime/ontology.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/ontology.ts) | 7 |
| CompiledSingleSum | [platform/runtime/compiled-calculation.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/compiled-calculation.ts) | 5 |
| CompiledCalculationBinding | [platform/runtime/compiled-calculation.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/compiled-calculation.ts) | 11 |
| TodayAttentionRequest | [platform/runtime/today-attention.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-attention.ts) | 8 |
| AttentionObservation | [platform/runtime/today-attention.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-attention.ts) | 9 |
| AttentionAlertEpisode | [platform/runtime/today-attention.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-attention.ts) | 10 |
| AttentionDueDecision | [platform/runtime/today-attention.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-attention.ts) | 21 |
| ReviewedComplianceEntry | [platform/runtime/today-attention.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-attention.ts) | 26 |
| TodayAttentionCalendarInput | [platform/runtime/today-attention.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-attention.ts) | 33 |
| AttentionCalendarRow | [platform/runtime/today-attention.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-attention.ts) | 40 |
| AttentionCalendar | [platform/runtime/today-attention.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-attention.ts) | 43 |
| TodayAttention | [platform/runtime/today-attention.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-attention.ts) | 53 |
| AlertSeverity | [platform/runtime/alerts-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/alerts-contracts.ts) | 7 |
| AlertReceiptPin | [platform/runtime/alerts-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/alerts-contracts.ts) | 36 |
| AlertObservation | [platform/runtime/alerts-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/alerts-contracts.ts) | 46 |
| AlertEpisode | [platform/runtime/alerts-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/alerts-contracts.ts) | 61 |
| AlertNotice | [platform/runtime/alerts-contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/alerts-contracts.ts) | 72 |
| TODAY_REVIEW_SCOPE | [platform/runtime/today-review.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-review.ts) | 11 |
| TodayReviewKind | [platform/runtime/today-review.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-review.ts) | 12 |
| TodayReviewReference | [platform/runtime/today-review.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-review.ts) | 13 |
| TodayReviewRequest | [platform/runtime/today-review.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-review.ts) | 17 |
| TodayReviewProvenance | [platform/runtime/today-review.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-review.ts) | 22 |
| TodayReviewRow | [platform/runtime/today-review.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-review.ts) | 25 |
| TodayReviewProducer | [platform/runtime/today-review.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-review.ts) | 29 |
| TodayReviewQueue | [platform/runtime/today-review.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-review.ts) | 33 |
| TodayReviewPageRequest | [platform/runtime/today-review.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-review.ts) | 53 |
| JobAcceptanceReference | [platform/runtime/jobs.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/jobs.ts) | 21 |
| TodayEventsRequest | [platform/runtime/today-events.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-events.ts) | 13 |
| TodayEventActor | [platform/runtime/today-events.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-events.ts) | 14 |
| EventBase | [platform/runtime/today-events.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-events.ts) | 15 |
| TodayActionKind | [platform/runtime/today-events.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-events.ts) | 16 |
| TodayActionOutcome | [platform/runtime/today-events.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-events.ts) | 17 |
| TodayDecisionOutcome | [platform/runtime/today-events.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-events.ts) | 18 |
| TodayDayEvent | [platform/runtime/today-events.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-events.ts) | 19 |
| TodayEventsReason | [platform/runtime/today-events.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-events.ts) | 28 |
| TodayDayEvents | [platform/runtime/today-events.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-events.ts) | 29 |
| ImportFormat | [platform/runtime/ingest.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/ingest.ts) | 9 |
| REASON_CODES | [platform/runtime/learning.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/learning.ts) | 7 |
| EngineTodayHostOptions | [platform/runtime/engine.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine.ts) | 89 |
| CalendarRules | [platform/runtime/calendar-zone.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/calendar-zone.ts) | 3 |
| IntlCalendarRulesOptions | [platform/runtime/calendar-zone.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/calendar-zone.ts) | 37 |
| TodayAttentionOptions | [platform/runtime/today-attention.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/today-attention.ts) | 66 |
| Role | [platform/runtime/contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/contracts.ts) | 26 |
| Context | [platform/runtime/contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/contracts.ts) | 27 |
| StateStore | [platform/runtime/contracts.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/contracts.ts) | 39 |
| EngineTodayOptions | [platform/runtime/engine-today.ts](https://github.com/kartavyc/chausar-platform/blob/5edf751b5fc58181e0a0c1e4c025dcc8ad5bcbfd/platform/runtime/engine-today.ts) | 14 |

Source-file SHA-256 hashes for this extraction:

| Frozen source | SHA-256 |
|---|---|
| platform/runtime/alerts-contracts.ts | f791aecc4f4022f413077871858ad0f4fda9b638c68254fcec39fd85bc44b682 |
| platform/runtime/calculator.ts | 26191ee3976349a94ddc534bf4767f770f437974ae99098565a7941369687acb |
| platform/runtime/calendar-zone.ts | 05cc020a5128da0d86e135396b56d357c349723c756ac3a3ba21be1e1b32abed |
| platform/runtime/compiled-calculation.ts | b649f4fe4c8a10ab1691ad24cc2a9ccbf5d25f83f8476c9066a65139218747e2 |
| platform/runtime/contracts.ts | 52d930eac796f0edaf65ddf2d8e63dfc01a697e1cb6152b999eb33b550423c09 |
| platform/runtime/engine-today-contracts.ts | 6966243302942c285d5d1691073fdb947a8c42d7931c457140fe24b031face6b |
| platform/runtime/engine-today.ts | d6e43c0a8771f6fbc79d99cb8b5d2dbbc1ab3a4da84a43fa4bae2bdb34b2c0fd |
| platform/runtime/engine.ts | 3c388acc93645a11f9b388899a4505ec522454e9f5f568231a358cff3310e076 |
| platform/runtime/ingest.ts | cad75ee403d60ce1701ddafee3268c24c8749a8f2979003ec78e08d265a23cf9 |
| platform/runtime/jobs.ts | 4224ff07d3dae00ed8d5039799f35e0627eb7219daf069f3014eea74d044ba51 |
| platform/runtime/learning.ts | 9a3d9e5abe34852b6e5294b58011de0c90bda5883713569272cdd8257b1b90dc |
| platform/runtime/memory.ts | 6e4473554be7f4858c3ba838f37e2431bda345aa4d713928983d969fecd93221 |
| platform/runtime/ontology.ts | 47fd4a1de0c6f52237650d2edc293ffcffd3188efd0af9fb9d16a7bb2c720e67 |
| platform/runtime/today-attention.ts | f5984aef96f05797aaa34867f90de5ede1ad1ec031284f12c89df0f7d23da616 |
| platform/runtime/today-events.ts | b809a0354f2ce94dd1b8f4ef598613b235d327a70ed6cc543fa5f803e9c3255f |
| platform/runtime/today-review.ts | 8ab12d302048d88cdbf58ff44571c5bc38e49dff1020ad6f18a3b622d7f7739b |
| platform/runtime/today-tiles-contracts.ts | d0db1c358aa32977b07c4b144c2fe2d9542d46d431a34c636307c8e9e3a22b17 |
| app/desktop/preload.cjs | 0a87dc8e456a2b212887cbe0068a9749cdcc3d50f315efbd32c7f6219a19a701 |
