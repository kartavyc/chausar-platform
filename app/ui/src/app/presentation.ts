/**
 * Presentation DTOs: what the screen is given to show.
 *
 * The screen only shows. Everything here is already decided, computed and formatted
 * elsewhere: the engine decides values, scope and permitted actions; the checked
 * projection (bridge/project-ui.ts, owned by another lane) validates a reply and turns
 * paise, counts and dates into display strings. Components never calculate a business
 * number, never format one, never read the bridge, and never cast unknown engine data
 * into these shapes.
 *
 * These types are kept structurally aligned with that projection's output, so its
 * arrays and objects assign here without a cast. Lists are readonly for that reason.
 * An optional field is absent when the engine did not supply it; it is never present
 * and undefined.
 *
 * `display` is the string shown. `exact` is the exact engine value (whole paise, a whole
 * count, hundredths of a percent) kept beside it so a receipt and a title can carry it.
 * `spoken` is the amount in words for screen readers.
 */

import type {
  ActionState,
  ApprovalAction,
  ApprovalKind,
  Capability as CanonicalCapability,
  FigureLabel as CanonicalFigureLabel,
  MissingState,
  ViewState,
} from '../bridge/presentation.ts';

export type { ActionState, ApprovalAction, ApprovalKind, MissingState, ViewState };

export type Mark = 'cha' | 'you' | 'wait' | 'busy' | 'unsure' | 'guess' | 'off';

export type StepState =
  | 'done'
  | 'waiting-for-you'
  | 'waiting-for-network'
  | 'unsure'
  | 'stopped-by-rule'
  | 'stopped-by-budget'
  | 'not-reached';

/** The seven canonical qualifications a figure can carry: seed, what-if, projection,
 *  from-outside, approximate, demo-clock, stale. A figure carries all of its labels. */
export type FigureLabel = CanonicalFigureLabel;

/** The broader fixed labels on a statement (main design, part 7). A statement label is
 *  set by the screen that makes the statement; it is never a figure's own qualification. */
export type StatementLabel =
  | FigureLabel
  | 'guess'
  | 'measured'
  | 'told-by-owner'
  | 'assumption'
  | 'from-data'
  | 'recorded-later'
  | 'late'
  | 'practice'
  | 'experimental'
  | 'file';

/** A missing value is one of these words. It is never 0 and never blank. The first seven
 *  are the canonical states; the last three are words a screen uses for its own gaps. */
export type Missing = MissingState | 'cash-not-captured' | 'not-agreed' | 'none';

/** A known figure. It always has a receipt and its labels, even when there are none. */
export interface Figure {
  readonly kind: 'money' | 'count' | 'percent' | 'points';
  /** Exact engine value as a string: whole paise, a whole count, hundredths of a percent. */
  readonly exact: string;
  /** The formatted string to show, from the format module. Never built in a component. */
  readonly display: string;
  /** The amount in words for a screen reader. */
  readonly spoken?: string;
  /** Every figure a person can see opens its receipt. Never empty. */
  readonly receiptId: string;
  /** Every qualification the engine put on this figure. All of them are shown. */
  readonly labels: ReadonlyArray<FigureLabel>;
  /** Another currency as written in the source; shown beside the rupee value. */
  readonly asWritten?: string;
}

export interface MissingFigure {
  readonly kind: 'missing';
  readonly missing: Missing;
}

export type FigureOrMissing = Figure | MissingFigure;

/** A figure that may be shown as known: it has a value and a receipt to open. A known
 *  value without a receipt id is not shown as an amount anywhere. */
export function isFigure(f: FigureOrMissing | undefined): f is Figure {
  return f !== undefined && f.kind !== 'missing' && f.receiptId.length > 0;
}

/** The missing word a value shows when it is not a figure with a receipt. */
export function missingOf(f: FigureOrMissing): Missing {
  return f.kind === 'missing' ? f.missing : 'unknown';
}

/** A count in a header or a rail: metadata, never a business figure. `exact` is the whole
 *  count as digits, or null when it is not known; `display` is what a person reads, which
 *  for an unknown count is the missing word. It is never turned into a number. */
export interface Count {
  readonly exact: string | null;
  readonly display: string;
}

/** Whether a part is live, as the checked boundary states it. */
export type Capability = CanonicalCapability;

/** The states every screen must handle (main design, part 10). The rich variants carry
 *  metadata an adapter actually has. `boundary-state` carries the checked view state
 *  as it came, for when there is no more than that: it shows the fixed words for the
 *  state with the supplied reason code and time, and invents nothing beside them. */
export type ScreenState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'loading'; readonly lastKnownAt?: string; readonly reading?: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'partial'; readonly missing: Missing; readonly detail?: string }
  | { readonly kind: 'no-change'; readonly since?: string }
  | { readonly kind: 'not-enough'; readonly monthsNotLoaded?: Count }
  | { readonly kind: 'stale'; readonly workedOutOn: string }
  | { readonly kind: 'not-yet' }
  | { readonly kind: 'stopped-by-rule'; readonly rule: string; readonly who?: string }
  /** A failed call carries a short code; the fixed sentences for it come from the text file. */
  | { readonly kind: 'failed'; readonly code: string; readonly what?: string; readonly means?: string; readonly action?: string }
  | { readonly kind: 'waiting-for-network' }
  | { readonly kind: 'read-only'; readonly holder?: string }
  | { readonly kind: 'hidden'; readonly rows?: Count }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'locked' }
  /** SH-13. `part` names the missing part (a capability group, shown as written). */
  | { readonly kind: 'not-built'; readonly capability?: Capability; readonly part?: string }
  | { readonly kind: 'boundary-state'; readonly source: ViewState };

/** A chart value: exact and display, with its receipt. Missing stays a gap with words. */
export interface ChartValue {
  /** The canonical id of the point. It keeps a mark's identity and focus across updates. */
  readonly id: string;
  readonly label: string;
  readonly value: FigureOrMissing;
  /** The thing the chart is about is ink; the rest is grey. */
  readonly emphasis?: boolean;
  /** An open bar: drawn as an outline, for a value not yet entered (Simple, today's cash). */
  readonly outline?: boolean;
}

export interface ColumnsChart {
  readonly form: 'columns';
  /** One sentence for screen readers that states what the chart shows. */
  readonly sentence: string;
  readonly values: ReadonlyArray<ChartValue>;
}

export interface LineChart {
  readonly form: 'line';
  readonly sentence: string;
  readonly values: ReadonlyArray<ChartValue>;
  /** Written labels at the two ends of the baseline. */
  readonly from: string;
  readonly to: string;
}

export interface OrderedBarChart {
  readonly form: 'ordered-bar';
  readonly sentence: string;
  /** Ages or stages of one whole, least severe first. The last takes ink. */
  readonly values: ReadonlyArray<ChartValue>;
}

export type Chart = ColumnsChart | LineChart | OrderedBarChart;

/** Why a stat has no chart. A stat always says so; an absent chart is never a blank. */
export type ChartMissingReason =
  | 'CHART_NOT_PROVIDED'
  | 'CHART_FORM_NOT_IMPLEMENTED'
  | 'CHART_HAS_NO_POINTS'
  | 'CHART_HAS_NO_KNOWN_POINTS';

export type ChartAvailability =
  | { readonly state: 'available' }
  | { readonly state: 'missing'; readonly reasonCode: ChartMissingReason };

export interface StatTile {
  readonly id: string;
  readonly label: string;
  readonly figure: FigureOrMissing;
  /** What changed, as a figure with its own receipt. */
  readonly change?: FigureOrMissing;
  /** Words beside the change, as supplied: "down", "as of 28 Sep". */
  readonly changeLabel?: string;
  readonly chart?: Chart;
  readonly chartState: ChartAvailability;
}

/** A row of the ledger. Four slots: square, what with a note, figure, arrow. */
export interface RowItem {
  readonly id: string;
  readonly mark: Mark;
  /** The state in words, read beside the hidden square. A text key. */
  readonly markWordsKey?: string;
  readonly what: string;
  readonly note?: string;
  readonly figure?: FigureOrMissing;
  /** Narration or a name as written in the source. Shown unchanged. */
  readonly asWritten?: string;
  /** A statement label for the row, beside the figure's own labels. */
  readonly statement?: StatementLabel;
  /** One more line of detail for a row that opens in place. */
  readonly detail?: string;
  /** Actions the engine offered on this row. Hidden when absent. */
  readonly can?: ReadonlyArray<'review' | 'prepare' | 'open'>;
  /** Who prepared or owns the thing, in the enterprise version. */
  readonly owner?: string;
}

/** One mark on the day line. */
export interface DayEvent {
  readonly id: string;
  readonly mark: Mark;
  readonly time: string;
  readonly words: string;
  /** A short state in words, as supplied: "read", "refused". Not a figure. */
  readonly note?: string;
  /** A small figure with its receipt. */
  readonly figure?: FigureOrMissing;
  /** How many older marks folded into this one. Only on the first mark. */
  readonly folded?: Count;
}

/** One step down the page. The sentence comes from the sentences module. */
export interface TimeEvent {
  readonly id: string;
  readonly mark: Mark;
  readonly state?: StepState;
  readonly date: string;
  readonly sentence: string;
  readonly cost?: FigureOrMissing;
  readonly who?: string;
}

export interface StepItem {
  readonly nameKey: string;
  readonly state: StepState;
  readonly at?: string;
}

export type BannerKind =
  | 'driving'
  | 'demo-clock'
  | 'read-only'
  | 'sending-closed'
  | 'jobs-paused'
  | 'update-needed'
  | 'no-connection';

export interface BannerItem {
  readonly kind: BannerKind;
  /** Values for the banner's sentence: program, date, holder, count. */
  readonly values?: Readonly<Record<string, string | number>>;
  /** A variant of the kind's sentence (`SH-03.<kind>` otherwise), for example a withdrawn release. */
  readonly textKey?: string;
  /** At most one action. */
  readonly action?: { readonly onPress: () => void };
}

export interface StatusFact {
  readonly text: string;
  /** Where the fact goes when pressed. */
  readonly address?: Address;
}

export interface StatusLineData {
  readonly sources: StatusFact;
  readonly model: StatusFact;
  /** The third fact gives way to anything unusual. */
  readonly third: StatusFact;
}

export interface WorkspaceIdentity {
  readonly name: string;
  readonly demo: boolean;
  /** "You, the owner". Already localised by the adapter. */
  readonly who: string;
}

export type View = 'simple' | 'guided' | 'books';
export type Language = 'en' | 'hi';

/** Approval, built from the prepared request itself (build.md part 9). */
export interface ApprovalChange {
  readonly asWritten?: string;
  readonly fields?: ReadonlyArray<{ readonly name: string; readonly before: string; readonly after: string }>;
}

/** The identity, state and offers are the checked approval view's own. What the sheet may
 *  offer is decided from `state`, `can`, `readOnly` and `prepareOnly`, never from which
 *  callbacks happen to be supplied. */
export interface Approval {
  readonly approvalId: string;
  readonly kind: ApprovalKind;
  /** Where the action is. Only a prepared action can be approved, changed or dropped. */
  readonly state: ActionState;
  /** The title, already localised from its text key. */
  readonly what: string;
  readonly target: ReadonlyArray<{ readonly name: string; readonly value: string; readonly figure?: Figure }>;
  readonly change: ApprovalChange;
  readonly steps: ReadonlyArray<StepItem>;
  /** One note: what it changes and what it does not, and when it expires. */
  readonly note: string;
  readonly preparedBy?: string;
  /** This seat cannot change anything. No mutation control is shown. */
  readonly readOnly: boolean;
  /** A filing the person files: it is prepared, never approved from here. */
  readonly prepareOnly: boolean;
  readonly needsSecondAsk: boolean;
  /** What the engine offered. `reconcile` is the only offer for an unknown result. */
  readonly can: ReadonlyArray<ApprovalAction>;
  /** Shown instead of the buttons when set. */
  readonly blocked?: { readonly kind: 'expired' | 'owner-approves' | 'unsure' | 'changed' | 'prepare-blocked'; readonly text: string };
}

/** Enterprise additions, from props only. */
export type Lens = 'whole-group' | 'finance' | 'sales' | 'operations';
export type Whose = 'mine' | 'team' | 'everyone';

export interface Address {
  place: PlaceId;
  sub?: string;
  sheet?: string;
}

export type PlaceId =
  | 'first-run'
  | 'today'
  | 'ask'
  | 'work'
  | 'books'
  | 'reports'
  | 'tools'
  | 'trust'
  | 'company'
  | 'clients'
  | 'more';
