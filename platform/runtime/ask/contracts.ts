/**
 * The askx.* reply contracts (cross-lane family `askx.*`, owner: ask lane).
 *
 * Money is whole paise as a digit string, never a JavaScript number. A value that is not known
 * is a missing word, never zero. Every known figure names the calculator receipt it came from.
 * Words a person reads are chosen by the screen from codes; the engine sends codes and data.
 */
import type { Period } from '../memory.ts';

export type Topic = 'sales' | 'collections' | 'cash' | 'stock' | 'tax' | 'other';
export type PeriodId = 'this-month' | 'last-month' | 'this-quarter' | 'last-quarter' | 'this-year' | 'last-year';
export type PeriodChoice = { id: PeriodId; period: Period };
export type Missing = 'absent' | 'null' | 'unknown' | 'withheld' | 'not-applicable' | 'not-loaded-yet' | 'not-counted';
export type Need = 'period' | 'comparePeriod' | 'onDate' | 'priceChange';

/** A known amount with its receipt, or a missing word. */
export type Amount = { kind: 'money' | 'basis-points'; minor: string; receiptId: string } | { kind: 'missing'; missing: Missing };

export type MenuItem = { operationId: string; label: string; type: string; topic: Topic; needs: Need[]; meaning: string | null };
export type MenuReply = {
  state: 'ready' | 'no-dictionary';
  seed: boolean;
  dictionary: { version: number; pack: string; label: string; gstMode: 'regular' | 'composition' | 'unregistered' } | null;
  topics: { topic: Topic; items: MenuItem[] }[];
  /** The tax topic also offers the purchases-against-GSTR-2B page. */
  gst2b: 'offered' | 'not-applicable';
  today: string;
  periods: PeriodChoice[];
};
export type SuggestReply = { suggestions: { operationId: string; label: string; periodId: PeriodId; asked: number; why: 'asked-before' | 'starter' }[] };

export type Proposal = { operationId: string; label: string; period: Period; periodId: PeriodId | null; branch: string | null; needs: Need[] };
export type UnderstandReply =
  | { kind: 'proposal'; proposal: Proposal; options: { operations: { operationId: string; label: string }[]; periods: PeriodChoice[]; branches: string[] } }
  | { kind: 'choose'; choices: { operationId: string; label: string; meaning: string | null }[]; periodId: PeriodId | null }
  | { kind: 'no-match'; reason: 'no-calculation' | 'unknown-word' | 'action'; word: string | null; nearby: { operationId: string; label: string }[] }
  | { kind: 'refused'; code: string };

/** `date` covers dates, months with years, financial years and introduced years; `ordinal` is 1st, 2nd… */
export type GuardLine = { number: string; matched: { figureKey: string } | { field: 'rows' | 'excluded' | 'date' | 'ordinal' } | null };
export type Gap = 'unreconciled' | 'conflicts' | 'missing-amounts' | 'empty' | 'costs-only';
export type AnswerReply = {
  kind: 'answer';
  answerId: string | null;
  receiptId: string;
  operationId: string;
  label: string;
  period: Period | null;
  comparePeriod: Period | null;
  branch: string | null;
  asOf: string;
  headline: string;
  figures: { key: string; label: string; minor: string; unit: 'money' | 'basis-points' }[];
  /** Counted, left out and read, from the receipt's coverage. */
  rows: { read: number; counted: number; excluded: number };
  completeness: 'reconciled-imports' | 'unreconciled-facts' | 'empty' | 'partial';
  gaps: Gap[];
  /** Months of the period with no rows loaded at all. Words on screen, never a zero. */
  monthsNotLoaded: string[];
  labels: ('seed' | 'what-if' | 'stale')[];
  /** Why a template was used: no model was asked (the menu), or the guard replaced a model's text. */
  explanation: { source: 'template' | 'model'; text: string; replaced: boolean; reason: 'no-model' | 'guard-replaced' | null };
  guard: { status: 'passed' | 'replaced'; lines: GuardLine[] };
  sent: 'nothing';
};
/** Which kind of rule stopped an answer (AS-09). A fixed word, never the rule's own text. */
export type RuleKind = 'branch' | 'source' | 'seat' | 'access' | 'marking';
export type RunReply = AnswerReply | { kind: 'refused'; code: string; rule?: RuleKind } | { kind: 'not-applicable'; reason: 'composition' | 'unregistered' };

export type ReceiptReply = {
  receiptId: string;
  operationId: string;
  label: string;
  chain: { question: string | null; calculation: string; rowsRead: number; totalChecked: boolean };
  figures: AnswerReply['figures'];
  period: Period | null;
  comparePeriod: Period | null;
  asOf: string;
  createdAt: string;
  branch: string | null;
  definitions: { name: string; label: string; meaning: string; kind: string; field: string }[];
  exclusions: { reason: string; rows: number }[];
  completeness: AnswerReply['completeness'];
  gaps: Gap[];
  sources: { sourceId: string; wayIn: 'file' | 'interface' | 'entered'; format: string | null; recipe: { id: string; state: 'tested' | 'not-yet-tested'; hash: string } | null; rows: number }[];
  /** Five version numbers for the small print. */
  versions: { app: string | null; dictionary: number; dictionaryHash: string; definitionHash: string; recipes: string[]; calculator: string };
  allowedBy: { memberId: string; role: string; device: 'desktop' | 'phone' | 'mcp'; at: string };
  labels: ('seed' | 'what-if' | 'stale')[];
  notCounted: number;
  fx: { from: string; to: string; rate: string; on: string | null }[];
  sent: { kind: 'nothing' } | { kind: 'model'; available: boolean };
  /** The published meaning this receipt used. */
  meaning: { version: number; publishedBy: string; publishedAt: string } | null;
  /** True in a demo workspace: every date and figure is synthetic. */
  demo: boolean;
};
export type SourceRowsReply = {
  tab: 'counted' | 'left-out';
  total: number;
  offset: number;
  rows: { rowId: string; sourceId: string; sourceRow: number | null; cells: { name: string; value: string }[]; amountMinor: string | null; reason: string | null }[];
  /** True when this seat may not see some rows of the receipt. */
  hidden: boolean;
  /** How many rows are hidden, given only when three or more (part 10), never which. */
  hiddenCount: number | null;
  /** The kind of rule that hides them, when known. */
  rule: RuleKind | null;
};
export type SentReply =
  | { kind: 'nothing'; why: 'menu' | 'no-model-record' }
  | { kind: 'sent'; routeId: string; sendLevel: string; bytes: number; costMinor: string | null; text: string | null; digest: string; removed: boolean; at: string; boundary: string; retentionDays: number };

export type SavedKind = 'answer' | 'why' | 'what-if' | 'forecast';
export type SavedItem = {
  id: string; memberId: string; kind: SavedKind; question: string | null; operationId: string | null; savedAt: string;
  /** Present while the derived values are kept. Removed when a source it used is deleted. */
  receiptId: string | null; request: Record<string, unknown> | null; refId: string | null;
  headline: { kind: 'money' | 'basis-points'; minor: string } | null; workedOutAt: string | null;
  sourceIds: string[]; deletedOn: string | null;
};
export type SavedReply = { items: (Omit<SavedItem, 'memberId' | 'request' | 'sourceIds'> & { stale: null | { reason: 'meaning-changed' | 'books-changed' | 'access-changed' | 'new-rows'; since: string | null }; rebuildable: boolean })[] };

export type CheckItem = {
  id: string; memberId: string; question: string; operationId: string; request: Record<string, unknown>;
  figureKey: string; expectedMinor: string; expectedReceiptId: string; createdAt: string;
  results: { at: string; result: 'same' | 'moved' | 'cannot-run'; minor: string | null; receiptId: string | null; code: string | null; because: string[] }[];
  sourceIds: string[];
  /** What the check depended on when it last ran (or was saved), to know when it is due. */
  fingerprint: Fingerprint | null;
};
export type ChecksReply = {
  /** `expected` is withheld (null) when its receipt no longer opens for this seat; so is each result's value. */
  items: { id: string; question: string; operationId: string; figureKey: string; expected: { minor: string | null; receiptId: string | null }; last: CheckItem['results'][number] | null }[];
  due: boolean; changed: string[]; lastRunAt: string | null;
};
export type Fingerprint = { dictionaryHash: string | null; recipes: string; route: string | null; app: string | null };

export type WhyRecord = {
  id: string; memberId: string; createdAt: string; operationId: string; label: string; by: 'customer' | 'branch' | 'source' | 'kind';
  earlier: { period: Period; minor: string; receiptId: string }; later: { period: Period; minor: string; receiptId: string };
  bars: { key: string; changeMinor: string }[]; otherMinor: string;
  guesses: { id: string; text: string; forReceiptIds: string[]; againstReceiptIds: string[]; source: { name: string; fetchedAt: string } | null; at: string }[];
  sourceIds: string[];
};
export type WhyReply = Omit<WhyRecord, 'memberId' | 'sourceIds'> & {
  direction: 'up' | 'down' | 'same'; changeMinor: string; changeBps: string | null;
  steps: { id: 'earlier' | 'later' | 'split'; state: 'done' }[];
};

export type WhatIfReply = {
  label: 'what-if'; assumption: { name: 'price'; beforeBps: '0'; afterBps: string };
  books: { minor: string; receiptId: string }; withChange: { minor: string; receiptId: string }; change: { minor: string; receiptId: string };
  period: Period; branch: string | null;
};
export type PlanReply = {
  label: 'experimental';
  feasible: boolean;
  limits: { index: number; figure: 'scenario' | 'change'; op: 'atLeast' | 'atMost'; minor: string; tight: boolean; alone: boolean }[];
  recommended: { bps: string; scenarioMinor: string; changeMinor: string; receiptId: string } | null;
  clash: number[];
  tried: number;
};

export type ForecastReply =
  | { state: 'not-enough-history'; months: number; needed: number }
  /** History exists but has a month with no reconciled rows, so the test cannot run. */
  | { state: 'cannot-test'; code: 'ASK_FORECAST_GAPS' }
  | {
    state: 'ready';
    answer: 'forecast' | 'baseline';
    operationId: string; label: string;
    history: { month: string; minor: string; receiptId: string }[];
    heldBack: { month: string; actualMinor: string; forecastMinor: string; baselineMinor: string }[];
    error: { forecastMinor: string | null; baselineMinor: string | null };
    next: { month: string; forecastMinor: string | null; baselineMinor: string; rangeMinor: string | null };
    method: { forecast: string; baseline: string; learnedFrom: { from: string; to: string }; testedOn: { from: string; to: string } };
    evaluationId: string; label2: 'projection';
    /** True when the monthly receipts (and evaluation) of an earlier run with identical inputs were reused. */
    reused: boolean;
  };

export type DecisionDraft = { id: string; memberId: string; sentence: string; reviewDate: string; receiptIds: string[]; createdAt: string; origin: 'typed' | 'forwarded'; decidedOn?: string };
export type InboxReply = {
  drafts: { id: string; sentence: string; reviewDate: string; origin: 'typed' | 'forwarded'; createdAt: string; receiptIds: string[] }[];
  due: { id: string; text: string; reviewDate: string }[];
  waiting: { id: string; text: string; at: string }[];
};
export type DecisionsReply = { items: { id: string; text: string; createdAt: string; reviewDate: string; status: 'open' | 'closed'; recordedLater: boolean; replaced: boolean; cancelled: boolean; reviews: number; receiptIds: string[] }[] };

export type SearchReply = { query: string; groups: { kind: 'saved' | 'decision' | 'investigation' | 'check' | 'why'; hits: {
  id: string; text: string; marks: [number, number][];
  /** For a saved hit: what it opens. */
  ref?: { savedKind: SavedKind; receiptId: string | null; refId: string | null };
}[] }[] };
export type WantedReply = {
  calculations: { text: string; count: number; lastAt: string }[];
  actions: { text: string; count: number; lastAt: string }[];
  words: { word: string; count: number; lastAt: string }[];
};

export type Gst2bGroup = 'matched' | 'differs-inside' | 'differs-outside' | 'in-2b-only' | 'books-only';
export type Gst2bReply =
  | { state: 'not-applicable'; reason: 'composition' | 'unregistered' }
  | { state: 'not-loaded'; period: Period }
  | {
    state: 'ready'; period: Period; toleranceMinor: string; via: 'connectors' | 'facts';
    /** Rows left out of the match: no supplier GSTIN and invoice, no amount, or another currency. Never counted as zero. */
    leftOut: number;
    groups: { group: Gst2bGroup; count: number; taxableMinor: string; taxMinor: string }[];
    lines: { id: string; group: Gst2bGroup; supplier: string; invoice: string; booksMinor: string | null; twoBMinor: string | null; differenceMinor: string | null; bookRowId: string | null; twoBRowId: string | null }[];
    ims: { lineId: string; action: 'accept' | 'reject' | 'pending'; reason: 'matched' | 'amount-differs' | 'not-in-books' }[];
  };

/** The lane's private state, kept in the vault under `extensions.ask`. */
export type AskState = {
  version: 1;
  saved: SavedItem[];
  checks: CheckItem[];
  why: WhyRecord[];
  /** Structure only: which calculation was swapped for which, never the question text. */
  corrections: { memberId: string; at: string; from: string; to: string; periodChanged: boolean; groupChanged: boolean }[];
  /** Each member's own lists: one member's typed words are never shown to another. */
  wantedWords: { memberId: string; word: string; count: number; lastAt: string }[];
  wantedActions: { memberId: string; text: string; count: number; lastAt: string }[];
  /** Structure only: how often each calculation was asked, for suggestions. */
  asked: { memberId: string; operationId: string; periodId: PeriodId | null; count: number; lastAt: string }[];
  drafts: DecisionDraft[];
  /** The day a decision was actually made, when it was recorded later. */
  decided?: { decisionId: string; decidedOn: string }[];
  /** Monthly receipts of earlier forecast runs, keyed by every input they depend on. */
  forecastRuns?: { key: string; memberId: string; asOf: string; receipts: { month: string; receiptId: string }[]; evaluationId: string; at: string }[];
  gst: { toleranceMinor: string };
};

export type CheckReply = {
  id: string; question: string; operationId: string; figureKey: string; createdAt: string;
  expected: { minor: string | null; receiptId: string | null };
  results: CheckItem['results'];
};
export type DecisionReply = {
  id: string; text: string; createdAt: string; reviewDate: string; status: 'open' | 'closed'; recordedLater: boolean; replaced: boolean; cancelled: boolean; revision: number | null;
  /** What was known then: each receipt as it stood on the day the decision was made. */
  known: { receiptId: string; label: string; minor: string | null; asOf: string }[];
  /** What happened after, in order. */
  reviews: { at: string; outcome: 'accepted' | 'rejected' | 'continue' | 'completed'; notes: string | null; nextReviewDate: string | null }[];
  journal: boolean;
};
export type Gst2bLineReply = {
  id: string; group: Gst2bGroup;
  books: { rowId: string; sourceId: string; sourceRow: number | null; cells: { name: string; value: string }[] } | null;
  twoB: { rowId: string; sourceId: string; sourceRow: number | null; cells: { name: string; value: string }[] } | null;
  rule: { toleranceMinor: string; key: 'supplier-gstin-and-invoice' };
};

/**
 * The askx.* methods and their payloads (all fields optional unless marked !).
 *   askx.menu            { today }                                         → MenuReply
 *   askx.suggest         {}                                                → SuggestReply
 *   askx.understand      { question!, today }                              → UnderstandReply
 *   askx.run             { operationId!, period | periodId, comparePeriod, onDate, priceChangeBps, branch, today,
 *                          correctedFrom: { operationId, periodChanged, groupChanged } }   → RunReply
 *   askx.answer          { receiptId! }                                    → AnswerReply
 *   askx.guard           { receiptId!, text! }                             → { status, lines: GuardLine[], explanation }
 *   askx.receipt         { receiptId! }                                    → ReceiptReply
 *   askx.sourceRows      { receiptId!, tab: 'counted'|'left-out', offset, limit }   → SourceRowsReply
 *   askx.sent            { receiptId! }                                    → SentReply
 *   askx.save            { receiptId!, question }                          → { id }
 *   askx.saveRef         { kind!: 'why'|'what-if'|'forecast', refId!, question } → { id }
 *   askx.saved           {}                                                → SavedReply
 *   askx.rebuild         { savedId! }                                      → { id, receiptId }
 *   askx.unsave          { savedId! }                                      → { removed: true }
 *   askx.wanted          {}                                                → WantedReply
 *   askx.checks.save     { receiptId!, question, figureKey }               → { id }
 *   askx.checks.list     {}                                                → ChecksReply
 *   askx.checks.run      {}                                                → ChecksReply
 *   askx.checks.get      { checkId! }                                      → CheckReply
 *   askx.checks.remove   { checkId! }                                      → { removed: true }
 *   askx.why.start       { operationId!, period!, comparePeriod, by: 'customer'|'branch'|'source'|'kind' } → WhyReply
 *   askx.why.get         { whyId! }                                        → WhyReply
 *   askx.why.guess       { whyId!, text!, forReceiptIds, againstReceiptIds } → WhyReply
 *   askx.whatIf          { period | periodId, priceChangeBps!, branch, today } → WhatIfReply
 *   askx.whatIf.get      { receiptId! }  (a saved what-if read back)          → WhatIfReply
 *   askx.receipt.export  { receiptId! }  (rows counted and left out as CSV)   → { fileName, csv }
 *   askx.plan            { period | periodId, limits!: [{ figure, op, minor }], fromBps!, toBps!, stepBps!, today } → PlanReply
 *   askx.forecast        { operationId!, today }                           → ForecastReply
 *   askx.decisions.inbox {}                                                → InboxReply
 *   askx.decisions.draft { sentence!, reviewDate!, receiptIds, decidedOn }            → { id }
 *   askx.decisions.confirm { draftId! }                                    → { decisionId }
 *   askx.decisions.discard { draftId! }                                    → { removed: true }
 *   askx.decisions.forward { text!, reviewDate } (phone allowed; becomes a draft only) → { id }
 *   askx.decisions.list  {}                                                → DecisionsReply
 *   askx.decisions.get   { decisionId! }                                   → DecisionReply
 *   askx.decisions.review { decisionId!, outcome!: 'accepted'|'rejected'|'continue'|'completed', notes, nextReviewDate } → DecisionReply
 *   askx.search          { query! }                                        → SearchReply
 *   askx.gst2b           { period | periodId, today }                      → Gst2bReply
 *   askx.gst2b.tolerance { toleranceMinor! }                               → { toleranceMinor }
 *   askx.gst2b.line      { period | periodId, lineId!, today }             → Gst2bLineReply
 *   askx.gst2b.exportIms { period | periodId, today }                      → { fileName, csv }
 */
