/**
 * Reply checks for the learning place (Books, Learning). Every reply from the `learningx.*`
 * methods and the two `models.*` methods this place calls is untrusted data: it is checked
 * here before anything is drawn, and a reply of any other shape becomes the error state.
 * The shapes follow docs/lanes/learning-ext.md and platform/runtime/learning-ext/*.
 */
import {
  InvalidReply, bool, count, either, instant, integerString, isoDate, list, literal, nullable, object, oneOf, record, text, type Check,
} from '../work/kit/validate.ts';

export const EDIT_KINDS = ['add-field', 'add-definition', 'remove-definition', 'change-meaning', 'change-nulls', 'change-label', 'change-sign', 'change-kind'] as const;
export const EDIT_STATUSES = ['awaiting-review', 'failed-answer-key', 'accepted', 'rejected'] as const;
export const FIELD_TYPES = ['string', 'money', 'date', 'integer', 'boolean'] as const;
export const CONFIDENCE = ['high', 'medium', 'low'] as const;
export const PROPOSAL_STATUSES = ['proposed', 'adopted', 'failed-answer-key'] as const;
export const SEND_LEVELS = ['nothing', 'shape', 'samples'] as const;
export const EVIDENCE_ORIGINS = ['unmapped-field', 'fact-kind', 'correction', 'model'] as const;
export const ACCOUNT_CLASSES = [
  'sales', 'purchases', 'direct-expenses', 'indirect-expenses', 'indirect-income', 'bank', 'cash', 'duties-taxes', 'loans', 'capital',
  'fixed-assets', 'current-assets', 'current-liabilities', 'sundry-debtors', 'sundry-creditors', 'stock', 'suspense',
] as const;
export type AccountClass = typeof ACCOUNT_CLASSES[number];
export type FieldType = typeof FIELD_TYPES[number];

const short = text(64), name = text(200), long = text(4000);
/** A short upper-case code, as the engine and the bridge send them. */
const code: Check<string> = (value, path) => {
  if (typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value)) return value;
  throw new InvalidReply(path);
};

export const caseResult = object({ id: short, passed: bool, expectedMinor: integerString }, { actualMinor: integerString, code: short });
export type CaseResult = ReturnType<typeof caseResult>;

const definition = object(
  { name: short, label: name, meaning: long, kind: short, field: short, currency: short, nulls: oneOf(['reject', 'exclude'] as const) },
  { sign: either(literal(1), literal(-1)) },
);
/** One typed dictionary edit: the kind decides exactly which arguments it carries. */
export type TypedEdit =
  | { readonly edit: 'add-field'; readonly name: string; readonly type: FieldType }
  | { readonly edit: 'add-definition'; readonly definition: ReturnType<typeof definition> }
  | { readonly edit: 'remove-definition'; readonly name: string }
  | { readonly edit: 'change-meaning'; readonly name: string; readonly meaning: string }
  | { readonly edit: 'change-nulls'; readonly name: string; readonly nulls: 'reject' | 'exclude' }
  | { readonly edit: 'change-label'; readonly name: string; readonly label: string }
  | { readonly edit: 'change-sign'; readonly name: string; readonly sign: 1 | -1 }
  | { readonly edit: 'change-kind'; readonly name: string; readonly kind: string };
export const typedEdit: Check<TypedEdit> = (value, path) => {
  const kind = oneOf(EDIT_KINDS)(record(value, path).edit, `${path}.edit`);
  switch (kind) {
    case 'add-field': return object({ edit: literal('add-field'), name: short, type: oneOf(FIELD_TYPES) })(value, path);
    case 'add-definition': return object({ edit: literal('add-definition'), definition })(value, path);
    case 'remove-definition': return object({ edit: literal('remove-definition'), name: short })(value, path);
    case 'change-meaning': return object({ edit: literal('change-meaning'), name: short, meaning: long })(value, path);
    case 'change-nulls': return object({ edit: literal('change-nulls'), name: short, nulls: oneOf(['reject', 'exclude'] as const) })(value, path);
    case 'change-label': return object({ edit: literal('change-label'), name: short, label: name })(value, path);
    case 'change-sign': return object({ edit: literal('change-sign'), name: short, sign: either(literal(1), literal(-1)) })(value, path);
    case 'change-kind': return object({ edit: literal('change-kind'), name: short, kind: short })(value, path);
  }
};

const evidence = object({ origin: oneOf(EVIDENCE_ORIGINS), count }, { modelReceiptId: name });
export const editView = object({
  id: name, at: instant, edit: typedEdit, evidence, baseVersion: count, status: oneOf(EDIT_STATUSES),
  before: list(caseResult, 50), after: list(caseResult, 50), failing: list(short, 50), regressions: list(short, 50), digest: name, stale: bool,
}, { decidedAt: nullable(instant), decidedBy: nullable(name), publishedHash: nullable(name) });
export type EditView = ReturnType<typeof editView>;

const refusedEdit = object({ index: count, code });
export const editsReply = object({ items: list(editView, 500), total: count }, { dictionaryHash: nullable(name) });
export const editsProposeReply = object({ items: list(editView, 40), refused: list(refusedEdit, 40) }, { dictionaryHash: nullable(name) });
export const editApproveReply = object({ published: bool, status: oneOf(EDIT_STATUSES), failing: list(short, 50) }, { dictionaryHash: nullable(name) });
export type EditApproveReply = ReturnType<typeof editApproveReply>;
export const editRejectReply = object({ status: oneOf(EDIT_STATUSES) });

// ---------- first dictionary ----------
const fieldEvidence = object({
  name: short, type: oneOf(FIELD_TYPES), header: name, filled: count, rows: count, confidence: oneOf(CONFIDENCE), reasons: list(short, 20), existing: bool,
});
export const proposal = object({
  id: name, at: instant, origin: oneOf(['profile', 'model'] as const),
  pack: object({ pack: short, confidence: oneOf(CONFIDENCE) }, { matched: list(short, 100) }),
  draft: object({ label: name }), evidence: list(fieldEvidence, 500), skipped: list(object({ header: name, reason: short }), 500),
  status: oneOf(PROPOSAL_STATUSES), cases: list(caseResult, 50), failing: list(short, 50), digest: name,
}, { publishedHash: nullable(name) });
export type Proposal = ReturnType<typeof proposal>;
export const proposalsReply = object({ items: list(proposal, 50), total: count });
export const adoptReply = object(
  { published: bool, status: oneOf(PROPOSAL_STATUSES), cases: list(caseResult, 50), failing: list(short, 50) },
  { dictionary: nullable(object({ version: count, hash: name, pack: short })) },
);
export type AdoptReply = ReturnType<typeof adoptReply>;

// ---------- answer key ----------
const answerCase = object({ id: short, operation: short, period: object({ from: isoDate, to: isoDate }), expectedMinor: integerString }, { onDate: isoDate });
export type AnswerCase = ReturnType<typeof answerCase>;
const withheld = object({ state: literal('withheld') });
const key = object(
  { id: short, label: name, rows: either(text(1_000_000), withheld), cases: list(answerCase, 50) },
  { expectedTotals: object({ rowCount: count, amountMinor: integerString }) },
);
export const keyRun = object({ passed: bool, cases: list(caseResult, 50), failing: list(short, 50) });
export const absentRun = object({ state: literal('absent') });
export type KeyRun = ReturnType<typeof keyRun> | ReturnType<typeof absentRun>;
export const answerKeyReply = object({ key, default: bool, keyDigest: name }, { run: either(keyRun, absentRun), dictionaryHash: nullable(name) });
export type AnswerKeyReply = ReturnType<typeof answerKeyReply>;

// ---------- model asks ----------
export const notYet = object({ state: literal('not-yet'), code }, { cause: code, receiptId: name });
export type NotYet = ReturnType<typeof notYet>;
const routeChoice = object({ routeId: name, kind: short, model: name, endpoint: text(2000) });
export const modelRouteReply = object({ route: nullable(routeChoice), ready: bool, send: oneOf(SEND_LEVELS) }, { notYet });
export type ModelRouteReply = ReturnType<typeof modelRouteReply>;
const routeRow = object({ id: name, kind: short, model: name, enabled: bool }, { endpoint: text(2000) });
/** `models.list` gives the configured routes as a list (or, through some hosts, under `routes`). */
export const routesReply: Check<readonly ReturnType<typeof routeRow>[]> = (value, path) =>
  Array.isArray(value) ? list(routeRow, 100)(value, path) : object({ routes: list(routeRow, 100) })(value, path).routes;

export const preview = object({
  state: literal('preview'), previewId: name, payload: text(300_000), digest: name, send: oneOf(SEND_LEVELS), endpoint: text(2000),
}, { routeId: name, approvalRequired: bool });
export type Preview = ReturnType<typeof preview>;
export const askReply = either(preview, notYet);
export const approvalReply = object({ id: name }, { previewId: name, expiresAt: instant });

const accountEvidence = object({ kind: short, detail: text(400) }, { accountClass: oneOf(ACCOUNT_CLASSES) });
const accountProposal = object(
  { accountId: name, name: text(400), accountClass: nullable(oneOf(ACCOUNT_CLASSES)), confidence: oneOf(CONFIDENCE), needsQuestion: bool },
  { evidence: list(accountEvidence, 50), decision: nullable(object({ choice: short }, { accountClass: nullable(oneOf(ACCOUNT_CLASSES)) })) },
);
export const accountSet = object(
  { id: name, at: instant, proposals: list(accountProposal, 5000), counts: object({ total: count, decided: count, needsQuestion: count }) },
  { basedOn: name, modelReceiptId: name },
);
export type AccountSet = ReturnType<typeof accountSet>;
export const accountsListReply = object({ sets: list(accountSet, 200) });
export const accountsRunReply = either(object({ state: literal('done'), receiptId: name, set: accountSet, modelProposals: count }), notYet);
export const editsRunReply = either(object({ state: literal('done'), receiptId: name, items: list(editView, 40), refused: list(refusedEdit, 40) }), notYet);
