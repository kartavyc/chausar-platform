/** Presentation data only. Components neither call transports nor calculate business values. */
export type Language = 'en' | 'hi';
export type Mark = 'cha' | 'you' | 'wait' | 'busy' | 'unsure' | 'guess' | 'off';
export type FigureLabel = 'seed' | 'what-if' | 'projection' | 'from-outside' | 'approximate' | 'demo-clock' | 'stale';
export type MissingState = 'absent' | 'null' | 'unknown' | 'withheld' | 'not-applicable' | 'not-loaded-yet' | 'not-counted';

interface EvidenceReference { readonly receiptId: string; readonly labels: readonly FigureLabel[] }
export interface MoneyFigure extends EvidenceReference { readonly kind: 'money'; readonly currency: 'INR'; readonly paise: string }
export interface CountFigure extends EvidenceReference { readonly kind: 'count'; readonly count: string }
export interface PercentFigure extends EvidenceReference { readonly kind: 'percent'; readonly basisPoints: string }
export interface MissingFigure { readonly kind: 'missing'; readonly state: MissingState }
export type KnownFigure = MoneyFigure | CountFigure | PercentFigure;
export type Figure = KnownFigure | MissingFigure;

/** Header/navigation metadata is deliberately distinct from a calculated business figure. */
export interface MetadataCount { readonly kind: 'metadata-count'; readonly count: string | null }
export interface OpenSheetIntent { readonly type: 'open-sheet'; readonly address: string }
interface RowContent {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly action?: OpenSheetIntent;
}
/** A possible cause cannot carry a measured business value, even at compile time. */
export type RowView = RowContent & (
  | { readonly mark: Exclude<Mark, 'guess'>; readonly figure?: Figure }
  | { readonly mark: 'guess'; readonly figure?: MissingFigure }
);
export type ViewState =
  | { readonly kind: 'ready' | 'empty' | 'no-change' }
  | { readonly kind: 'loading' | 'partial' | 'stale'; readonly asOf: string | null; readonly reasonCode: string }
  | { readonly kind: 'insufficient' | 'not-yet' | 'rule-stopped' | 'failed' | 'network-waiting' | 'read-only' | 'hidden' | 'locked' | 'not-built'; readonly reasonCode: string };
export type Capability =
  | { readonly state: 'live' }
  | { readonly state: 'partial' | 'missing'; readonly reasonCode: string; readonly expectedDay?: number };
export type ChartKind = 'columns' | 'line' | 'ordered-bar' | 'ranked-bars' | 'bridge' | 'goal-line' | 'step-line' | 'pair-bars' | 'strip' | 'spark' | 'rule-bar';
export interface ChartPoint { readonly id: string; readonly label: string; readonly value: Figure }
export interface ChartView { readonly kind: ChartKind; readonly description: string; readonly points: readonly ChartPoint[] }
export interface StatView { readonly id: string; readonly label: string; readonly figure: Figure; readonly change?: Figure; readonly changeLabel?: string; readonly chart: ChartView | null }
export interface DayEventView { readonly id: string; readonly at: string; readonly mark: Mark; readonly label: string; readonly action?: OpenSheetIntent }
export interface TodayView {
  readonly title: string;
  readonly date: string;
  readonly pendingCount: string | null;
  readonly attention: readonly RowView[];
  readonly worthLook: readonly RowView[];
  readonly stats: readonly StatView[];
  readonly dayEvents: readonly DayEventView[];
  readonly state: ViewState;
}

/** These fields are an exact subset of platform/runtime/calculator.ts CalculationReceipt.
 * The proposed design Receipt shape is not claimed to exist in the engine. */
export interface EngineFigureEvidence {
  readonly key: string;
  readonly label: string;
  readonly minor: string;
  readonly display: string;
  readonly unit: 'money' | 'basis-points';
  readonly currency?: string;
}
export interface ReceiptRowEvidence {
  readonly factId: string;
  readonly entityId: string;
  readonly sourceId: string;
  readonly sourceRow: number;
  readonly kind: string;
  readonly amountMinor: string;
  readonly measureField?: string;
  readonly validFrom: string;
  readonly dueDate?: string;
  readonly invoiceId?: string;
  readonly customerId?: string;
  readonly orderId?: string;
  readonly status?: string;
  readonly branch?: string;
  readonly normalization?: { readonly sourceCurrency: string; readonly targetCurrency: string; readonly rate: unknown };
}
export interface ReceiptPeriod { readonly from: string; readonly to: string }
export interface CalculationReceiptEvidence {
  readonly id: string;
  readonly memberId: string;
  readonly epoch: number;
  readonly sourceIds: readonly string[];
  /** Explicit reviewed selection, distinct from sources of the retained counted rows. */
  readonly requestedSourceIds?: readonly string[];
  readonly operation: string;
  readonly createdAt: string;
  readonly asOf: string;
  readonly period: ReceiptPeriod | null;
  readonly comparePeriod: ReceiptPeriod | null;
  readonly branch: string | null;
  readonly currency: string;
  readonly ontologyVersion: number;
  readonly dictionaryHash: string;
  readonly definitionHash: string;
  readonly figures: readonly EngineFigureEvidence[];
  readonly valueMinor: string;
  readonly totalMinor: string;
  readonly rowIds: readonly string[];
  readonly rows: readonly ReceiptRowEvidence[];
  readonly exclusions: readonly { readonly rowId: string; readonly reason: string }[];
  readonly coverage: {
    readonly selectedRows: number;
    readonly countedRows: number;
    readonly excludedRows: number;
    readonly unresolvedConflicts: number;
    readonly importIds: readonly string[];
    readonly completeness: 'reconciled-imports' | 'unreconciled-facts' | 'empty' | 'partial';
    readonly gaps: readonly string[];
  };
  readonly assumptions: Readonly<Record<string, unknown>>;
  readonly explanation: string;
  readonly stale: boolean;
  readonly staleReason?: string;
  readonly allowedNumbers: readonly string[];
}

export type ApprovalKind = 'message' | 'record-change' | 'money' | 'prepare-only' | 'job' | 'group';
export type ActionState = 'prepared' | 'approved' | 'executing' | 'verified' | 'unknown' | 'rejected' | 'blocked' | 'cancelled';
export type ApprovalAction = 'approve' | 'notNow' | 'change' | 'drop' | 'reconcile' | 'open-app';
export interface ApprovalView {
  readonly id: string;
  readonly kind: ApprovalKind;
  readonly state: ActionState;
  readonly title: string;
  readonly note: string;
  readonly can: readonly ApprovalAction[];
  readonly readOnly: boolean;
  readonly prepareOnly: boolean;
  readonly needsSecondAsk: boolean;
  readonly digest: string;
  readonly revision: number;
}
export interface ApprovalControl { readonly action: ApprovalAction; readonly keyboardPrimary: boolean; readonly requiresSecondAsk: boolean }

/** A phone payload contains fixed template keys and opaque intents, never book text. */
export type PhoneHeadlineKey = 'week-ready' | 'review-waiting' | 'document-received' | 'due-soon';
export interface PhoneHeadlineView {
  readonly id: string;
  readonly template: PhoneHeadlineKey;
  readonly linkId: string;
  readonly approval: null | {
    readonly policy: 'simple-reversible' | 'open-app-only';
    readonly expiresAt: string;
    readonly actions: readonly ('approve' | 'notNow' | 'open-app')[];
  };
}
/** CA cross-client status metadata has no figures, receipts or joined business data. */
export interface CAClientStatusView {
  readonly clientId: string;
  readonly clientLabel: string;
  readonly booksReadAt: string | null;
  readonly closeState: 'not-started' | 'in-progress' | 'ready' | 'blocked' | 'unknown';
  readonly awaitingFirm: string | null;
  readonly nextDueDate: string | null;
}
export interface CAConsoleView { readonly title: string; readonly clients: readonly CAClientStatusView[]; readonly capability: Capability }

/** Existing /v1/investigations/:id response. Enterprise results are not desktop receipts. */
export interface EnterpriseInvestigationStatus {
  readonly investigationId: string;
  readonly status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly reason?: string;
  readonly resultId?: string;
}
