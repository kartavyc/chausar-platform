import { check, hash } from './contracts.ts';
import { validDate } from './memory.ts';
import type { CalculationReceipt, Figure } from './calculator.ts';

export type EvidenceRef = { receiptId: string; figureKey?: string };
export type JournalOption = { id: string; label: string; reason: string; evidence: EvidenceRef[] };
export type JournalAssumption = { id: string; text: string; status: 'human-declared' | 'unverified'; evidence: EvidenceRef[] };
export type ExpectedOutcome = { description: string; measure: string; population: string; baseline?: EvidenceRef; window: { from: string; to: string }; maturityDate: string; lagRule: string; uncertainty: string[] };
/** `decidedOn` (optional): the day the decision was taken, on or before the day it is recorded; earlier marks it "recorded later" (AS-15). */
export type JournalContent = { text: string; options: JournalOption[]; assumptions: JournalAssumption[]; selectedOptionId: string; ownerId: string; expectedOutcome: ExpectedOutcome; reviewDate: string; hypotheses: string[]; branch?: string; decidedOn?: string };
export type JournalDraft = { kind: 'journal-draft'; content: JournalContent; receipts: CalculationReceipt[]; digest: string };
export type ObservationState = 'pending' | 'observable' | 'inconclusive' | 'achieved' | 'not-achieved' | 'amended';
export type MeasurementRef = EvidenceRef & { figureKey: string };
export type JournalObservation = { state: ObservationState; measurements: MeasurementRef[]; notes: string; uncertainty: string[]; concurrentInterventions: string[]; executionReceiptIds: string[] };
export type JournalExecutionReceipt = { id: string; sourceIds: string[]; rowIds: string[]; snapshot: Record<string, unknown> };
export type JournalReview = { outcome: 'accepted' | 'rejected' | 'continue' | 'completed'; notes?: string; at: string; by: string; assessment: 'human-declared'; atRevision: number; content: JournalContent; observation: JournalObservation; measuredFigures: { receiptId: string; figure: Figure }[]; priorReviewDate: string; nextReviewDate?: string; executionReceipts?: JournalExecutionReceipt[] };
export type JournalRevision = { fromRevision: number; at: string; by: string; reason: string; before: JournalContent };
/** Present only when the decision was cancelled (AS-15): why, by whom and when. */
export type JournalCancellation = { reason: string; by: string; at: string };
/** `recordedOn` and `recordedLater` are present only on a decision with a decided-on date; `cancellation` only on a cancelled one. */
export type JournalDecision = JournalContent & { id: string; createdAt: string; by: string; status: 'open' | 'closed' | 'cancelled'; revision: number; receiptIds: string[]; rowIds: string[]; sourceIds: string[]; receipts: CalculationReceipt[]; revisions: JournalRevision[]; reviews: JournalReview[]; recordedOn?: string; recordedLater?: boolean; cancellation?: JournalCancellation };

type Data = Record<string, unknown>;

const isRecord = (value: unknown): value is Data => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function detach<T>(value: T, code: string, message: string): T {
  try { return structuredClone(value); } catch { check(false, code, message); }
}

function closed(value: unknown, keys: string[], code: string, what: string): Data {
  check(isRecord(value) && Object.keys(value).every(key => keys.includes(key)), code, `${what} must be an object without unknown properties.`);
  return value;
}

function list<T>(value: unknown, code: string, message: string, item: (entry: unknown) => T): T[] {
  check(Array.isArray(value), code, message);
  return Array.from(value, entry => item(entry));
}

const strings = (value: unknown, message: string, max = Infinity) => list(value, 'INVALID_DECISION', message, entry => {
  check(typeof entry === 'string' && entry.length <= max, 'INVALID_DECISION', message);
  return entry;
});

function evidenceRef(value: unknown): EvidenceRef {
  const { receiptId, figureKey } = closed(value, ['receiptId', 'figureKey'], 'INVALID_REFERENCE', 'Each evidence reference');
  check(nonblank(receiptId) && (figureKey === undefined || nonblank(figureKey)), 'INVALID_REFERENCE', 'Evidence references need a receipt ID and, optionally, a nonblank figure key.');
  return figureKey === undefined ? { receiptId } : { receiptId, figureKey };
}

const evidenceRefs = (value: unknown) => list(value, 'INVALID_REFERENCE', 'Evidence must be a list of receipt references.', evidenceRef);

function normalizeContent(value: unknown): JournalContent {
  const content = closed(value, ['text', 'options', 'assumptions', 'selectedOptionId', 'ownerId', 'expectedOutcome', 'reviewDate', 'hypotheses', 'branch', 'decidedOn'], 'INVALID_DECISION', 'Decision content');
  const { text, selectedOptionId, ownerId, reviewDate, branch, decidedOn } = content;
  check(decidedOn === undefined || validDate(decidedOn), 'INVALID_DECISION', 'A decided-on date must be a valid calendar date when given.');
  check(typeof text === 'string' && text.trim().length > 0 && text.length <= 5000 && validDate(reviewDate), 'INVALID_DECISION', 'A decision needs a sentence and a valid review date.');
  check(nonblank(ownerId), 'INVALID_DECISION', 'A decision needs an explicit owner.');
  check(branch === undefined || nonblank(branch), 'INVALID_DECISION', 'A decision branch must be nonblank when given.');
  const options = list(content.options, 'INVALID_DECISION', 'Decision options must be a list.', (entry): JournalOption => {
    const option = closed(entry, ['id', 'label', 'reason', 'evidence'], 'INVALID_DECISION', 'Each option');
    const { id, label, reason } = option;
    check(nonblank(id) && nonblank(label) && nonblank(reason), 'INVALID_DECISION', 'Each option needs an ID, label and reason.');
    return { id, label, reason, evidence: evidenceRefs(option.evidence) };
  });
  check(new Set(options.map(option => option.id)).size === options.length, 'INVALID_DECISION', 'Option IDs must be unique.');
  check(typeof selectedOptionId === 'string' && options.some(option => option.id === selectedOptionId), 'INVALID_DECISION', 'Select one of the listed options.');
  const assumptions = list(content.assumptions, 'INVALID_DECISION', 'Decision assumptions must be a list.', (entry): JournalAssumption => {
    const assumption = closed(entry, ['id', 'text', 'status', 'evidence'], 'INVALID_DECISION', 'Each assumption');
    const { id, text: statement, status } = assumption;
    check(nonblank(id) && nonblank(statement) && (status === 'human-declared' || status === 'unverified'), 'INVALID_DECISION', 'Each assumption needs an ID, text and a human-declared or unverified status.');
    return { id, text: statement, status, evidence: evidenceRefs(assumption.evidence) };
  });
  check(new Set(assumptions.map(assumption => assumption.id)).size === assumptions.length, 'INVALID_DECISION', 'Assumption IDs must be unique.');
  const expected = closed(content.expectedOutcome, ['description', 'measure', 'population', 'baseline', 'window', 'maturityDate', 'lagRule', 'uncertainty'], 'INVALID_DECISION', 'The expected outcome');
  const { description, measure, population, baseline, maturityDate, lagRule } = expected;
  check(nonblank(description) && nonblank(measure) && nonblank(population) && nonblank(lagRule), 'INVALID_DECISION', 'The expected outcome needs a description, measure, population and lag rule.');
  const { from, to } = closed(expected.window, ['from', 'to'], 'INVALID_DECISION', 'The outcome window');
  check(validDate(from) && validDate(to) && from <= to && validDate(maturityDate), 'INVALID_DECISION', 'The expected outcome needs an ordered valid window and a valid maturity date.');
  const expectedOutcome: ExpectedOutcome = {
    description, measure, population,
    ...(baseline === undefined ? {} : { baseline: evidenceRef(baseline) }),
    window: { from, to }, maturityDate, lagRule,
    uncertainty: strings(expected.uncertainty, 'Outcome uncertainty must be a list of statements.'),
  };
  const hypotheses = strings(content.hypotheses, 'Hypotheses must be a list of statements up to 5000 characters.', 5000);
  return { text: text.trim(), options, assumptions, selectedOptionId, ownerId, expectedOutcome, reviewDate, hypotheses, ...(branch === undefined ? {} : { branch }), ...(decidedOn === undefined ? {} : { decidedOn }) };
}

const DAY = 86400000;
/**
 * The recording day of a decision with a decided-on date: the workspace's own calendar day when the caller
 * supplies it (it may differ from the UTC day by at most one), else the UTC day of `at`. The decided-on date
 * is never after it, so it is never in the future.
 */
function recordingDay(content: JournalContent, at: string, recordedOn: unknown): { recordedOn: string; recordedLater: boolean } | {} {
  if (content.decidedOn === undefined) return {};
  const day = recordedOn === undefined ? at.slice(0, 10) : recordedOn;
  check(typeof day === 'string' && validDate(day) && Math.abs(Date.parse(`${day}T00:00:00Z`) - Date.parse(`${at.slice(0, 10)}T00:00:00Z`)) <= DAY, 'INVALID_TIMESTAMP', 'The recording day must be the calendar day of the recording time.');
  check(content.decidedOn <= day, 'DECIDED_ON_LATER', 'A decision cannot be dated after the day it is recorded.');
  return { recordedOn: day, recordedLater: content.decidedOn < day };
}

const contentRefs = (content: JournalContent): EvidenceRef[] => [
  ...content.options.flatMap(option => option.evidence),
  ...content.assumptions.flatMap(assumption => assumption.evidence),
  ...(content.expectedOutcome.baseline ? [content.expectedOutcome.baseline] : []),
];

/** Resolve IDs only after the same content validation used by the pure lifecycle. */
export function journalContentReceiptIds(content: JournalContent): string[] {
  const normalized = normalizeContent(detach(content, 'INVALID_DECISION', 'Decision content must be plain data.'));
  return [...new Set(contentRefs(normalized).map(ref => ref.receiptId))];
}

function referencedSnapshots(content: JournalContent, receipts: CalculationReceipt[]): CalculationReceipt[] {
  return freshSnapshots(contentRefs(content), receipts);
}

// One fresh detached snapshot per referenced receipt ID, in first-reference order; unreferenced receipts are ignored.
function freshSnapshots(refs: EvidenceRef[], receipts: CalculationReceipt[]): CalculationReceipt[] {
  check(Array.isArray(receipts) && receipts.every(isRecord), 'INVALID_EVIDENCE', 'Receipts must be a list of calculation receipts.');
  const snapshots = [...new Set(refs.map(ref => ref.receiptId))].map(id => {
    const matches = receipts.filter(receipt => receipt.id === id);
    check(matches.length > 0, 'RECEIPT_NOT_FOUND', 'A referenced receipt was not supplied.');
    check(matches.length === 1, 'AMBIGUOUS_EVIDENCE', 'A referenced receipt was supplied more than once.');
    const snapshot = detach(matches[0]!, 'INVALID_EVIDENCE', 'Referenced receipts must be plain data.');
    check(snapshot.stale === false, 'STALE_EVIDENCE', 'Recalculate stale evidence before attaching it to a decision.');
    return snapshot;
  });
  refs.forEach(ref => requireFigure(snapshots.find(snapshot => snapshot.id === ref.receiptId)!, ref.figureKey));
  return snapshots;
}

function requireFigure(receipt: CalculationReceipt, figureKey: string | undefined) {
  if (figureKey === undefined) return;
  check(Array.isArray(receipt.figures), 'INVALID_EVIDENCE', 'A referenced receipt has no figure list.');
  const count = receipt.figures.filter(figure => isRecord(figure) && figure.key === figureKey).length;
  check(count > 0, 'FIGURE_NOT_FOUND', 'A referenced figure is not on its receipt.');
  check(count === 1, 'AMBIGUOUS_EVIDENCE', 'A referenced figure key appears more than once on its receipt.');
}

// Sorted-key JSON so digests do not depend on property order; arrays keep their order and undefined properties are omitted as in JSON storage.
function canonical(value: unknown, ancestors: object[] = []): string {
  if (typeof value !== 'object' || value === null) {
    check(value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)), 'INVALID_EVIDENCE', 'Journal evidence must be plain JSON data.');
    return JSON.stringify(value);
  }
  const prototype = Object.getPrototypeOf(value);
  check(!ancestors.includes(value) && (Array.isArray(value) || prototype === Object.prototype || prototype === null), 'INVALID_EVIDENCE', 'Journal evidence must be acyclic plain JSON data.');
  const path = [...ancestors, value];
  if (Array.isArray(value)) return `[${Array.from(value, item => canonical(item, path)).join(',')}]`;
  const record = value as Data;
  return `{${Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(record[key], path)}`).join(',')}}`;
}

const journalDigest = (content: JournalContent, receipts: CalculationReceipt[]) => hash(canonical({ content, receipts }));

// Transient preview only: nothing is persisted, and the caller authorizes the supplied receipts.
export function draftDecision(content: JournalContent, receipts: CalculationReceipt[]): JournalDraft {
  const normalized = normalizeContent(detach(content, 'INVALID_DECISION', 'Decision content must be plain data.'));
  const snapshots = referencedSnapshots(normalized, receipts);
  return { kind: 'journal-draft', content: normalized, receipts: snapshots, digest: journalDigest(normalized, snapshots) };
}

// Explicit attribution for lifecycle writes: the caller supplies both values and no clock is read.
function attribution(actorId: unknown, at: unknown): { by: string; at: string } {
  check(nonblank(actorId), 'INVALID_ACTOR', 'An explicit actor is required.');
  check(typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{3})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(at) && validDate(at.slice(0, 10)) && Number.isFinite(Date.parse(at)), 'INVALID_TIMESTAMP', 'An explicit ISO timestamp is required.');
  return { by: actorId, at };
}

const lineageIds = (value: unknown) => list(value, 'INVALID_EVIDENCE', 'Receipt lineage must list nonblank IDs.', entry => {
  check(nonblank(entry), 'INVALID_EVIDENCE', 'Receipt lineage must list nonblank IDs.');
  return entry;
});

/** Detach trusted execution evidence without assigning an effect-state policy. */
export function journalExecutionSnapshot(value: JournalExecutionReceipt): JournalExecutionReceipt {
  const copy = closed(detach(value, 'INVALID_EXECUTION_RECEIPT', 'Execution evidence must be plain data.'), ['id', 'sourceIds', 'rowIds', 'snapshot'], 'INVALID_EXECUTION_RECEIPT', 'Execution evidence');
  check(nonblank(copy.id) && isRecord(copy.snapshot), 'INVALID_EXECUTION_RECEIPT', 'Execution evidence needs an ID and an authoritative record.');
  const serialized = canonical(copy.snapshot);
  check(Buffer.byteLength(serialized) <= 2 * 1024 * 1024, 'INVALID_EXECUTION_RECEIPT', 'Execution evidence exceeds the saved provider-record limit.');
  const snapshot: unknown = JSON.parse(serialized);
  check(isRecord(snapshot), 'INVALID_EXECUTION_RECEIPT', 'Execution evidence must be a record.');
  return { id: copy.id, sourceIds: lineageIds(copy.sourceIds), rowIds: lineageIds(copy.rowIds), snapshot };
}

// Counted and excluded rows both stay traceable; source IDs come only from the receipts themselves.
function lineage(receipts: CalculationReceipt[]) {
  const unique = (values: string[]) => [...new Set(values)];
  return {
    receiptIds: unique(receipts.map(receipt => receipt.id)),
    sourceIds: unique(receipts.flatMap(receipt => lineageIds(receipt.sourceIds))),
    rowIds: unique(receipts.flatMap(receipt => [
      ...lineageIds(receipt.rowIds),
      ...lineageIds(list(receipt.exclusions, 'INVALID_EVIDENCE', 'Receipt exclusions must be a list.', exclusion => isRecord(exclusion) ? exclusion.rowId : undefined)),
    ])),
  };
}

export function confirmDecision(draft: JournalDraft, input: { reviewedDigest: string; id: string; actorId: string; at: string; receipts: CalculationReceipt[]; recordedOn?: string }): JournalDecision {
  const { reviewedDigest, id, actorId, at, receipts, recordedOn } = closed(input, ['reviewedDigest', 'id', 'actorId', 'at', 'receipts', 'recordedOn'], 'INVALID_CONFIRMATION', 'A confirmation');
  const copy = closed(detach(draft, 'INVALID_DRAFT', 'A journal draft must be plain data.'), ['kind', 'content', 'receipts', 'digest'], 'INVALID_DRAFT', 'A journal draft');
  check(copy.kind === 'journal-draft' && isRecord(copy.content) && Array.isArray(copy.receipts) && typeof copy.digest === 'string', 'INVALID_DRAFT', 'Confirm a prepared journal draft.');
  const digest = journalDigest(copy.content as JournalContent, copy.receipts as CalculationReceipt[]);
  check(digest === copy.digest, 'DRAFT_CHANGED', 'The draft changed after it was prepared.');
  check(digest === reviewedDigest, 'REVIEW_DIGEST_MISMATCH', 'Confirm exactly the draft that was reviewed.');
  const reviewed = draftDecision(copy.content as JournalContent, copy.receipts as CalculationReceipt[]);
  check(reviewed.digest === reviewedDigest, 'DRAFT_CHANGED', 'The draft does not match its prepared form.');
  check(nonblank(id), 'INVALID_CONFIRMATION', 'A decision needs an explicit ID.');
  const stamp = attribution(actorId, at);
  const current = referencedSnapshots(reviewed.content, receipts as CalculationReceipt[]);
  check(canonical(current) === canonical(reviewed.receipts), 'EVIDENCE_CHANGED', 'Referenced evidence changed after the draft was reviewed; prepare a new draft.');
  const dated = recordingDay(reviewed.content, stamp.at, recordedOn);
  return { id, ...reviewed.content, ...lineage(reviewed.receipts), createdAt: stamp.at, by: stamp.by, status: 'open', revision: 1, receipts: reviewed.receipts, revisions: [], reviews: [], ...dated };
}

type ScopedRef = { key: string; ref: EvidenceRef };

// A reference keeps its identity only within the option, assumption or baseline that cites it.
const scoped = (scope: string, id: string) => (ref: EvidenceRef): ScopedRef => ({ key: JSON.stringify([scope, id, ref.receiptId, ref.figureKey ?? null]), ref });
const scopedRefs = (content: JournalContent): ScopedRef[] => [
  ...content.options.flatMap(option => option.evidence.map(scoped('option', option.id))),
  ...content.assumptions.flatMap(assumption => assumption.evidence.map(scoped('assumption', assumption.id))),
  ...(content.expectedOutcome.baseline ? [scoped('baseline', '')(content.expectedOutcome.baseline)] : []),
];

// Staleness is current status rather than part of a retained receipt's identity.
const authoritative = (receipt: CalculationReceipt) => canonical({ ...receipt, stale: undefined, staleReason: undefined });

// Optimistic concurrency for rich journal writes: a detached copy at exactly the expected revision, with room for one more.
function writable(record: JournalDecision, expectedRevision: unknown): JournalDecision {
  const current = detach(record, 'INVALID_DECISION', 'A journal decision must be plain data.');
  check(isRecord(current) && Array.isArray(current.receipts) && Array.isArray(current.revisions) && Array.isArray(current.reviews), 'INVALID_DECISION', 'Only journal decisions can be changed here.');
  check(typeof expectedRevision === 'number' && Number.isSafeInteger(expectedRevision) && expectedRevision >= 1 && expectedRevision === current.revision, 'REVISION_CONFLICT', 'The decision changed since it was loaded; reload it before changing it.');
  check(Number.isSafeInteger(current.revision + 1), 'REVISION_OVERFLOW', 'The decision revision counter is exhausted.');
  check(current.status !== 'cancelled', 'DECISION_CANCELLED', 'A cancelled decision is kept as it was and cannot be changed.');
  return current;
}

const contentOf = ({ text, options, assumptions, selectedOptionId, ownerId, expectedOutcome, reviewDate, hypotheses, branch, decidedOn }: JournalDecision) => normalizeContent({ text, options, assumptions, selectedOptionId, ownerId, expectedOutcome, reviewDate, hypotheses, branch, decidedOn });
/** A kept decision's recording day: stored with its decided-on date, else the UTC day it was created. */
const keptDay = (record: JournalDecision, content: JournalContent) => content.decidedOn === undefined ? {} : recordingDay(content, record.createdAt, record.recordedOn ?? record.createdAt.slice(0, 10));

// Fresh evidence for new references. A receipt ID already retained must match its historic snapshot, which is kept unchanged; new receipts are appended.
function attachEvidence(retained: CalculationReceipt[], refs: EvidenceRef[], receipts: CalculationReceipt[]) {
  const fresh = freshSnapshots(refs, receipts);
  fresh.forEach(snapshot => {
    const original = retained.find(kept => kept.id === snapshot.id);
    check(!original || authoritative(original) === authoritative(snapshot), 'EVIDENCE_CHANGED', 'Retained evidence changed since it was attached and cannot be replaced.');
  });
  return { fresh, snapshots: [...retained, ...fresh.filter(snapshot => !retained.some(kept => kept.id === snapshot.id))] };
}

export function reviseDecision(record: JournalDecision, nextContent: JournalContent, input: { expectedRevision: number; actorId: string; at: string; reason: string; receipts: CalculationReceipt[] }): JournalDecision {
  const { expectedRevision, actorId, at, reason, receipts } = closed(input, ['expectedRevision', 'actorId', 'at', 'reason', 'receipts'], 'INVALID_REVISION', 'A revision');
  const current = writable(record, expectedRevision);
  const stamp = attribution(actorId, at);
  check(nonblank(reason), 'INVALID_REVISION', 'A revision needs a reason.');
  const next = normalizeContent(detach(nextContent, 'INVALID_DECISION', 'Decision content must be plain data.'));
  const before = contentOf(current);
  const kept = (id: string) => current.receipts.find(snapshot => snapshot.id === id);
  const unchanged = new Set(scopedRefs(before).map(({ key }) => key));
  const refs = scopedRefs(next);
  refs.filter(({ key }) => unchanged.has(key)).forEach(({ ref }) => {
    const snapshot = kept(ref.receiptId);
    check(snapshot, 'RECEIPT_NOT_FOUND', 'A carried-forward reference has no retained receipt.');
    requireFigure(snapshot, ref.figureKey);
  });
  const { snapshots } = attachEvidence(current.receipts, refs.filter(({ key }) => !unchanged.has(key)).map(({ ref }) => ref), receipts as CalculationReceipt[]);
  return {
    id: current.id, ...next, ...lineage(snapshots), createdAt: current.createdAt, by: current.by, status: current.status, revision: current.revision + 1, receipts: snapshots,
    revisions: [...current.revisions, { fromRevision: current.revision, at: stamp.at, by: stamp.by, reason, before }], reviews: current.reviews, ...keptDay(current, next),
  };
}

export function reviewDecision(record: JournalDecision, review: { outcome: JournalReview['outcome']; notes?: string; observation: JournalObservation; nextReviewDate?: string }, input: { expectedRevision: number; actorId: string; at: string; receipts: CalculationReceipt[] }): JournalDecision {
  const { expectedRevision, actorId, at, receipts } = closed(input, ['expectedRevision', 'actorId', 'at', 'receipts'], 'INVALID_REVIEW', 'Review input');
  const current = writable(record, expectedRevision);
  const stamp = attribution(actorId, at);
  const { outcome, notes, observation, nextReviewDate } = closed(review, ['outcome', 'notes', 'observation', 'nextReviewDate'], 'INVALID_REVIEW', 'A review');
  check(outcome === 'accepted' || outcome === 'rejected' || outcome === 'continue' || outcome === 'completed', 'INVALID_REVIEW', 'Choose a declared decision outcome.');
  check(notes === undefined || typeof notes === 'string', 'INVALID_REVIEW', 'Review notes must be text.');
  check(nextReviewDate === undefined || (outcome === 'continue' && validDate(nextReviewDate)), 'INVALID_REVIEW', 'Only a continued decision takes a next review date, and it must be a valid date.');
  const observed = closed(observation, ['state', 'measurements', 'notes', 'uncertainty', 'concurrentInterventions', 'executionReceiptIds'], 'INVALID_REVIEW', 'An observation');
  const { state, notes: remarks } = observed;
  check(state === 'pending' || state === 'observable' || state === 'inconclusive' || state === 'achieved' || state === 'not-achieved' || state === 'amended', 'INVALID_REVIEW', 'Choose a declared observation state.');
  check(typeof remarks === 'string', 'INVALID_REVIEW', 'Observation notes must be text.');
  const statements = (value: unknown, message: string, valid: (text: string) => boolean = () => true) => list(value, 'INVALID_REVIEW', message, item => {
    check(typeof item === 'string' && valid(item), 'INVALID_REVIEW', message);
    return item;
  });
  const uncertainty = statements(observed.uncertainty, 'Observation uncertainty must be a list of statements.');
  const concurrentInterventions = statements(observed.concurrentInterventions, 'Concurrent interventions must be a list of statements.');
  const executionReceiptIds = statements(observed.executionReceiptIds, 'Execution receipt IDs must be nonblank declared references.', nonblank);
  const measurements = list(observed.measurements, 'INVALID_REVIEW', 'Measurements must be a list of receipt figures.', (item): MeasurementRef => {
    const { receiptId, figureKey } = evidenceRef(item);
    check(figureKey !== undefined, 'INVALID_REFERENCE', 'Each measurement needs a receipt ID and a figure key.');
    return { receiptId, figureKey };
  });
  // Measured figures are exact copies from fresh receipts; nothing is computed or judged from them.
  const { fresh, snapshots } = attachEvidence(current.receipts, measurements, receipts as CalculationReceipt[]);
  // Scenario receipts project what-if amounts over unchanged source facts: evidence for options, never an observation.
  fresh.forEach(({ assumptions }) => {
    check(isRecord(assumptions), 'INVALID_EVIDENCE', 'Measurement receipts must carry their calculation assumptions.');
    check(!Object.hasOwn(assumptions, 'priceChangeBps'), 'INVALID_MEASUREMENT', 'A scenario projection cannot be recorded as a measured outcome.');
  });
  const measuredFigures = measurements.map(({ receiptId, figureKey }) => ({ receiptId, figure: structuredClone(fresh.find(snapshot => snapshot.id === receiptId)!.figures.find(figure => isRecord(figure) && figure.key === figureKey)!) }));
  const content = contentOf(current);
  const assessed: JournalReview = {
    outcome, ...(notes === undefined ? {} : { notes }), at: stamp.at, by: stamp.by, assessment: 'human-declared', atRevision: current.revision, content: structuredClone(content),
    observation: { state, measurements, notes: remarks, uncertainty, concurrentInterventions, executionReceiptIds }, measuredFigures,
    priorReviewDate: content.reviewDate, ...(nextReviewDate === undefined ? {} : { nextReviewDate }),
  };
  return {
    id: current.id, ...content, reviewDate: nextReviewDate ?? content.reviewDate, ...lineage(snapshots), createdAt: current.createdAt, by: current.by,
    status: outcome === 'continue' ? 'open' : 'closed', revision: current.revision + 1, receipts: snapshots, revisions: current.revisions, reviews: [...current.reviews, assessed], ...keptDay(current, content),
  };
}

/** Cancels an open decision (AS-15): kept with its reason, who and when; a cancelled decision is never due for review. */
export function cancelDecision(record: JournalDecision, input: { expectedRevision: number; actorId: string; at: string; reason: string }): JournalDecision {
  const { expectedRevision, actorId, at, reason } = closed(input, ['expectedRevision', 'actorId', 'at', 'reason'], 'INVALID_CANCELLATION', 'A cancellation');
  const current = writable(record, expectedRevision);
  const stamp = attribution(actorId, at);
  check(current.status === 'open', 'DECISION_NOT_OPEN', 'Only an open decision can be cancelled.');
  check(typeof reason === 'string' && reason.trim().length > 0 && reason.length <= 2000, 'INVALID_CANCELLATION', 'A cancellation needs a reason.');
  return { ...current, status: 'cancelled', revision: current.revision + 1, cancellation: { reason: reason.trim(), by: stamp.by, at: stamp.at } };
}

export function dueDecisions<T extends { reviewDate: string; status: string; branch?: string }>(records: T[], filter: { dueOn?: string; branch?: string } = {}): T[] {
  const { dueOn, branch } = closed(filter, ['dueOn', 'branch'], 'INVALID_FILTER', 'A due filter');
  check(dueOn === undefined || validDate(dueOn), 'INVALID_FILTER', 'A due date must be a valid calendar date.');
  check(branch === undefined || nonblank(branch), 'INVALID_FILTER', 'A branch filter must be nonblank.');
  check(Array.isArray(records), 'INVALID_FILTER', 'Decisions must be a list.');
  return detach(records.filter(record => (!record.branch || !branch || record.branch === branch) && (dueOn === undefined || (record.status === 'open' && record.reviewDate <= dueOn))), 'INVALID_DECISION', 'Decisions must be plain data.');
}
