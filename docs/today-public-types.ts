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

export type Period = { from: string; to: string };

export type FactFilter = { period?: Period; asOf?: string; branch?: string; customerId?: string; orderId?: string; kinds?: string[] };

export type CalculationRequest = FactFilter & { operation: string; sourceIds?: string[]; comparePeriod?: Period; onDate?: string; assumptions?: { priceChangeBps: string } };

export type Figure = { key: string; label: string; minor: string; display: string; unit: 'money' | 'basis-points'; currency?: string };

export type ReceiptRow = { factId: string; entityId: string; sourceId: string; sourceRow: number; kind: string; amountMinor: string; measureField?: string; validFrom: string; dueDate?: string; invoiceId?: string; customerId?: string; orderId?: string; status?: string; branch?: string; normalization?: { sourceCurrency: string; targetCurrency: string; rate: unknown } };

export type CalculationReceipt = { id: string; memberId: string; epoch: number; sourceIds: string[]; requestedSourceIds?: string[]; operation: string; createdAt: string; asOf: string; period: Period | null; comparePeriod: Period | null; branch: string | null; currency: string; ontologyVersion: number; dictionaryHash: string; definitionHash: string; definitions: Definition[]; compiledCalculation?: CompiledCalculationBinding; figures: Figure[]; valueMinor: string; totalMinor: string; rowIds: string[]; rows: ReceiptRow[]; exclusions: { rowId: string; reason: string }[]; coverage: { selectedRows: number; countedRows: number; excludedRows: number; unresolvedConflicts: number; importIds: string[]; completeness: 'reconciled-imports' | 'unreconciled-facts' | 'empty' | 'partial'; gaps: string[] }; assumptions: Record<string, unknown>; explanation: string; stale: boolean; staleReason?: string; allowedNumbers: string[]; databaseProof?: unknown; restatement?: ReceiptRestatement };

export type ReceiptRestatement = { version: 1; interpretation: 'restated-private-diagnostic'; trialId: string; forkDigest: string;
  candidateStateDigest: string; publicationId: string; originalAnswerId: string; originalReceiptId: string };

export type Definition = { name: string; label: string; meaning: string; kind: string; field: string; currency: string; nulls: 'exclude' | 'reject'; sign?: 1 | -1 };

export type Operation = { id: string; label: string; type: 'sum' | 'margin' | 'aging' | 'change' | 'scenario'; definitions: string[]; parameters: string[] };

export type CompiledSingleSum = {
  contractVersion: 1; compilerVersion: 'chausar-single-sum/1'; type: 'single-definition-sum';
  operationId: string; definitionName: string; recordKind: string; moneyField: string;
  currency: string; sign: 1 | -1; nullPolicy: 'reject' | 'exclude';
  dictionaryVersion: number; definitionHash: string; digest: string;
};

export type CompiledCalculationBinding = { dictionaryHash: string; sum: CompiledSingleSum };

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

export type JobAcceptanceReference = { kind: 'job-acceptance'; id: string; revision: number; digest: string; deliverableDigest: string };

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

export type ImportFormat = 'csv' | 'tally-xml' | 'zoho-json' | 'gst-json' | 'bank-csv' | 'shopify-json' | 'xlsx';

export const REASON_CODES = ['manual_confirmation', 'ambiguous_field', 'type_match', 'date_format', 'currency_mismatch', 'duplicate_record', 'exact_reference', 'reconciliation', 'unsupported_shape', 'verified_readback'] as const;

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

export type Role = 'owner' | 'cofounder' | 'accountant' | 'viewer';

export type Context = { memberId: string; role: Role; epoch: number; channel?: 'desktop' | 'phone' | 'mcp'; sourceTainted?: boolean };
