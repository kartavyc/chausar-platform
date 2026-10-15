/**
 * Reply checks for the Books place, mirroring the `books.*`, `accounts.*`, `records.*` and
 * `history.*` engine contract in docs/lanes/work-books.md field by field. Every reply is
 * untrusted data; nothing is drawn until it has passed its check here.
 */
import { amount, bool, count, either, id, instant, integerString, InvalidReply, isoDate, list, literal, month, nullable, object, oneOf, record, text, type Check } from '../work/kit/validate.ts';

import { connectionWithOperations, envelopeView } from './contract-r2.ts';
export * from './contract-r2.ts';

const name = text(400);
const line = text(4000);
const code = text(64);
/** An instant or a calendar day: the engine may stamp either. */
const when: Check<string> = either(instant, isoDate);

export const MONTH_STATES = ['loaded', 'loading', 'not-loaded-yet', 'refused', 'failed'] as const;
export type MonthState = typeof MONTH_STATES[number];

const monthCell = object({ month, state: oneOf(MONTH_STATES) });
const twelve: Check<readonly { readonly month: string; readonly state: MonthState }[]> = (value, path) => {
  const months = list(monthCell, 12)(value, path);
  if (months.length !== 12) throw new InvalidReply(path);
  return months;
};

export const sourceRow = object({
  sourceId: id, system: name, way: oneOf(['files', 'signed-in', 'this-computer']), scope: nullable(name),
  lastReadAt: nullable(when), months: twelve, rows: count, refused: count, unmapped: count, experimental: bool, connected: bool,
}, {
  // Round 2, additive: the connection behind the source, its last failed read and whether it is past its freshness target.
  connection: nullable(object({ connectionId: id, group: name, road: oneOf(['interface', 'file', 'database']), status: oneOf(['active', 'paused']) })),
  lastFailure: nullable(object({ at: when, code: nullable(code) })), stale: bool,
});
export type SourceRow = ReturnType<typeof sourceRow>;

export const sourcesReply = object({ rows: list(sourceRow), unmappedFields: count, freshness: object({ available: bool }) });
export const sourceReply = object({
  row: sourceRow,
  reads: list(object({ id, at: when, rows: count, totals: amount, reconciled: bool, format: name })),
  refusals: list(object({ at: when, codes: list(code, 50) })),
  kinds: list(object({ kind: name, rows: count })),
  unmappedFields: list(name),
}, {
  // Round 2, additive: see contract-r2.ts.
  connectors: object({ available: bool }), connection: nullable(connectionWithOperations), envelopes: list(envelopeView, 50),
});
export const unmappedReply = object({
  fields: list(object({
    field: name, sourceIds: list(id, 200), type: oneOf(['text', 'number', 'date', 'empty', 'unknown']),
    filled: nullable(object({ rows: count, of: count })),
  }, { origin: oneOf(['file', 'connector']), recipeId: nullable(name), mappable: bool })),
});

export const definition = object(
  { label: name, meaning: line, kind: name, field: name, nulls: oneOf(['exclude', 'reject']) },
  { name, currency: name, sign: either(literal(1), literal(-1)) },
);
export type Definition = ReturnType<typeof definition>;

export const draft = object({
  id, name, author: name, createdAt: when, state: oneOf(['draft', 'cosigned', 'published', 'discarded']),
  before: nullable(definition), after: nullable(definition), change: line,
  affects: object({ calculations: list(name), savedAnswers: count }),
  reviews: list(object({ kind: oneOf(['cosign', 'ai-opinion']), by: name, role: name, at: when })),
  checks: object({ ok: bool, code: nullable(code) }), digest: text(200),
});
export type Draft = ReturnType<typeof draft>;

const origin = oneOf(['core', 'pack', 'you']);
export const meaningsReply = object({
  dictionary: nullable(object({ version: either(count, name), hash: text(200), pack: name, publishedAt: when, publishedBy: name, gstMode: nullable(name) })),
  words: list(object({ name, label: name, meaning: line, origin, state: oneOf(['published', 'draft', 'clash']) })),
  drafts: list(draft),
});
export const meaningReply = object({
  word: nullable(definition), origin: nullable(origin), draft: nullable(draft),
  history: list(object({ version: either(count, name), publishedAt: when, publishedBy: name, meaning: line })),
});
export const discardReply = object({ draftId: id, state: oneOf(['discarded']) });
export const publishReply = object({ version: either(count, name), hash: text(200), staleAnswers: count });
export const packsReply = object({ packs: list(object({ pack: name, label: name, state: oneOf(['in-use', 'available']), meanings: count })) });
export const gstReply = object({ gstMode: nullable(name), rates: object({ available: bool }) });

export const memoryLine = object({
  id, text: line, kind: oneOf(['preference', 'claim', 'conversation', 'working-context']),
  status: oneOf(['told-by-owner', 'assumed', 'corrected', 'proposed']),
  source: oneOf(['told-by-owner', 'computed', 'outside-content']), receiptId: nullable(id),
  learnedAt: when, confirmedAt: nullable(when), earlier: list(object({ text: line, at: when })),
}, { origin: oneOf(['business-profile']), field: name, readOnly: bool });
export type MemoryLine = ReturnType<typeof memoryLine>;
export const memoryReply = object({ lines: list(memoryLine) });
export const forgetReply = object({ id, deleted: literal(true) });

export const ACCOUNT_CLASSES = ['asset', 'liability', 'equity', 'income', 'expense', 'receivable', 'payable', 'bank', 'cash', 'tax'] as const;
export type AccountClass = typeof ACCOUNT_CLASSES[number];
const accountClass = oneOf(ACCOUNT_CLASSES);
export const accountRow = object({
  name, group: nullable(name), side: nullable(oneOf(['debit', 'credit'])), proposed: nullable(accountClass), reason: list(line, 50),
  decided: nullable(object({ class: accountClass, by: name, role: name, at: when })), state: oneOf(['proposed', 'unsure', 'decided']),
}, {
  // Audit, additive: the reason as codes, said in the person's language.
  because: list(object({ code: oneOf(['group', 'group-unsortable', 'no-group', 'side', 'recipe', 'learned', 'said-no', 'accountant']) },
    { group: name, under: name, side: oneOf(['debit', 'credit']), cls: name }), 20),
});
export type AccountRow = ReturnType<typeof accountRow>;
export const accountsReply = object({ accounts: list(accountRow, 5000), proposals: object({ available: bool }, { sortedAt: instant }) });
export const accountsProposed = object({ setId: id, accounts: count });
export const classesReply = object({ classes: list(accountClass, 20) });

const recordKind = oneOf(['customer', 'supplier', 'item']);
export const searchReply = object({ records: list(object({ id, kind: recordKind, name: nullable(name), sources: list(name, 50), facts: count })) });
export const recordView = object({
  id, kind: recordKind, name: nullable(name),
  details: list(object({ field: name, value: line, sourceId: name })),
  owes: object({ value: amount, receiptId: nullable(id) }),
  timeline: list(object({ at: when, kind: name, amount, sourceId: name, ref: nullable(name) })),
  optIn: list(object({ channel: oneOf(['mail', 'whatsapp']), answer: oneOf(['yes', 'no', 'not-asked']), source: nullable(name), on: nullable(isoDate) }), 10),
  stoppedOn: nullable(isoDate),
});
export type RecordView = ReturnType<typeof recordView>;
export const holdingsReply = object({ stores: list(object({ store: name, count })) });

export const matchPair = object({
  left: id, right: id, relation: name, evidence: list(line, 50), reason: line,
  state: oneOf(['open', 'joined', 'not-same']), mergeId: nullable(id),
}, {
  // Audit, additive: malformed tax ids (not used as evidence), and after an undo the approvals that depended on the join.
  badIds: list(object({ kind: oneOf(['GSTIN', 'PAN']), length: count, expected: count }), 20),
  cancelled: list(id, 500), notCancelled: list(object({ id, code }), 500),
});
export type MatchPair = ReturnType<typeof matchPair>;
export const matchesReply = object({ pairs: list(matchPair) });
export const precedence = object({ kind: name, sourceIds: list(name, 50) });
export const conflictsReply = object({
  conflicts: list(object({
    entityId: id, kind: name, rule: nullable(line), picked: nullable(name),
    claims: list(object({ sourceId: name, fields: (value: unknown, path: string) => {
      const source = record(value, path);
      const out: Record<string, string> = {};
      for (const [key, entry] of Object.entries(source)) { name(key, `${path}.key`); out[key] = line(entry, `${path}.${key}`); }
      return Object.freeze(out) as Readonly<Record<string, string>>;
    } }), 20),
  })),
  rules: list(precedence),
});

const figureAt = object({ value: amount, receiptId: id, asOf: when });
export const asKnownReply = object({ then: figureAt, now: figureAt });
export const versionsReply = object({
  versions: list(object({
    factId: id, learnedAt: when, supersededAt: nullable(when), kind: name, validFrom: when, amount, sourceId: name,
    change: oneOf(['first', 'correction', 'new-event']),
  })),
});
export const staleAnswer = object({
  id, question: nullable(line), workedOutOn: when, reason: nullable(line),
  rebuilt: nullable(object({ at: when, matches: bool, quick: amount, full: amount })),
});
export const staleReply = object({ answers: list(staleAnswer) });

/** Any object reply, for a core method whose reply the screen only needs to have arrived. */
export const anyObject: Check<Readonly<Record<string, unknown>>> = (value, path) => record(value, path);

// ---------- Round 2: bill photo (WK-13/BK-18), belief line (BK-15), rates (BK-19), delete (BK-20) ----------

export const CERTAINTY = ['sure', 'check-this', 'could-not-read'] as const;
export type Certainty = typeof CERTAINTY[number];
const region = object({ page: count, line: count, of: count });
export const billField = object({ value: nullable(text(200)), certainty: oneOf(CERTAINTY), region: nullable(region) });
export type BillField = ReturnType<typeof billField>;
export const billReadReply = object({
  readId: id, digest: text(200), mime: oneOf(['application/pdf', 'image/png', 'image/jpeg']), stored: literal(false), expiresAt: instant, untrusted: literal(true),
  reader: object({ engine: literal('tesseract'), version: name, pages: count, confidence: count }),
  supplier: billField, billNumber: billField, date: billField, total: billField,
  lines: list(object({ description: billField, quantity: billField, amount: billField }), 50),
  tax: list(object({ name: billField, amount: billField }), 50),
  sums: object({ linesPlusTax: amount, total: amount, equal: nullable(bool) }),
  routes: object({ zohoBooks: object({ available: bool, connections: list(object({ id, label: name }), 50) }), tallyPreview: object({ available: literal(true) }) }),
});
export type BillRead = ReturnType<typeof billReadReply>;
const voucher = object({ type: name, number: nullable(name), date: isoDate, lines: list(object({ ledger: name, debit: nullable(amount), credit: nullable(amount) }), 200), note: literal('prepare-only') });
export const billView = object({
  id, approvalId: id, route: oneOf(['tally-preview', 'zoho-books']),
  state: oneOf(['prepared', 'approved', 'executing', 'verified', 'unknown', 'rejected', 'blocked', 'cancelled']),
  supplier: name, billNumber: name, date: isoDate, lines: list(object({ description: name, quantity: integerString, amount }), 50),
  tax: list(object({ name, amount }), 50), total: amount, voucher: nullable(voucher), writeback: nullable(object({ id })), createdAt: when, by: name,
});
export type BillView = ReturnType<typeof billView>;
export const billsReply = object({ bills: list(billView) });

export const CHANGES = ['start', 'correction', 'new-event', 'join', 'undo'] as const;
export const beliefLineReply = object({
  operation: name, period: object({ from: isoDate, to: isoDate }), from: instant, to: instant,
  points: list(object({ at: when, value: amount, receiptId: id, changes: list(oneOf(CHANGES), 5) }), 24), omitted: count,
});
export type BeliefLine = ReturnType<typeof beliefLineReply>;

const positive: Check<string> = (value, path) => { const v = integerString(value, path); if (!/^[1-9]\d*$/.test(v)) throw new InvalidReply(path); return v; };
export const rateRow = object({ currency: text(3), on: isoDate, rate: object({ units: positive, per: positive }), source: line, enteredBy: name, at: when });
export type RateRow = ReturnType<typeof rateRow>;
export const ratesReply = object({ rates: list(rateRow, 5000), notCounted: list(object({ currency: text(3), rows: count }), 200) });
export const removeRateReply = object({ currency: text(3), on: isoDate, removed: literal(true) });

export const deletionPlanReply = object({
  recordId: id, canDelete: bool, sourceDeletion: object({ available: bool }),
  stores: list(object({ store: name, count, state: oneOf(['can-delete', 'needs-owner', 'nothing-held']), reason: nullable(line) }), 50),
});
export type DeletionPlan = ReturnType<typeof deletionPlanReply>;
export const deletionReport = object({
  id, recordId: id, at: when, by: name, complete: bool,
  rows: list(object({ store: name, count, state: oneOf(['deleted', 'pending', 'not-possible', 'nothing-held']), reason: nullable(line) }), 50),
});
export type DeletionReport = ReturnType<typeof deletionReport>;
export const deletionsReply = object({ reports: list(deletionReport, 500) });
export const optInReply = object({ channels: list(object({ channel: oneOf(['mail', 'whatsapp']), agreed: oneOf(['yes', 'no', 'not-asked']), source: nullable(name), at: nullable(isoDate), stoppedAt: nullable(isoDate) }), 10) });
