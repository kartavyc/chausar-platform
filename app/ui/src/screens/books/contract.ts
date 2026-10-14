/**
 * Reply checks for the Books place, mirroring the `books.*`, `accounts.*`, `records.*` and
 * `history.*` engine contract in docs/lanes/work-books.md field by field. Every reply is
 * untrusted data; nothing is drawn until it has passed its check here.
 */
import { amount, bool, count, either, id, instant, InvalidReply, isoDate, list, literal, month, nullable, object, oneOf, record, text, type Check } from '../work/kit/validate.ts';

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
});
export type SourceRow = ReturnType<typeof sourceRow>;

export const sourcesReply = object({ rows: list(sourceRow), unmappedFields: count, freshness: object({ available: bool }) });
export const sourceReply = object({
  row: sourceRow,
  reads: list(object({ id, at: when, rows: count, totals: amount, reconciled: bool, format: name })),
  refusals: list(object({ at: when, codes: list(code, 50) })),
  kinds: list(object({ kind: name, rows: count })),
  unmappedFields: list(name),
});
export const unmappedReply = object({
  fields: list(object({
    field: name, sourceIds: list(id, 200), type: oneOf(['text', 'number', 'date', 'empty', 'unknown']),
    filled: nullable(object({ rows: count, of: count })),
  })),
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
});
export type MemoryLine = ReturnType<typeof memoryLine>;
export const memoryReply = object({ lines: list(memoryLine) });
export const forgetReply = object({ id, deleted: literal(true) });

export const ACCOUNT_CLASSES = ['asset', 'liability', 'equity', 'income', 'expense', 'receivable', 'payable', 'bank', 'cash', 'tax'] as const;
export type AccountClass = typeof ACCOUNT_CLASSES[number];
const accountClass = oneOf(ACCOUNT_CLASSES);
export const accountRow = object({
  name, group: nullable(name), side: nullable(oneOf(['debit', 'credit'])), proposed: nullable(accountClass), reason: list(line, 50),
  decided: nullable(object({ class: accountClass, by: name, role: name, at: when })), state: oneOf(['proposed', 'unsure', 'decided']),
});
export type AccountRow = ReturnType<typeof accountRow>;
export const accountsReply = object({ accounts: list(accountRow, 5000), proposals: object({ available: bool }) });
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
