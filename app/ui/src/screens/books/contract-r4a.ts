/**
 * Reply checks for the round-4 Books methods (BK-02, BK-03, BK-05), mirroring
 * docs/lanes/work-books.md "Round 4 contracts". Every reply is untrusted data and is drawn
 * only after it has passed its check here.
 */
import { bool, count, either, id, instant, isoDate, list, literal, nullable, object, oneOf, text, type Check } from '../work/kit/validate.ts';
import { envelopeView } from './contract-r2.ts';

const name = text(400);
const line = text(4000);
const code = text(64);
const digits = text(40);
const when: Check<string> = either(instant, isoDate);

export const tallyCompaniesReply = object({
  available: bool, reason: nullable(oneOf(['connectors-not-installed', 'not-built', 'no-connection'])), sourceId: nullable(id), current: nullable(name),
  currentOpen: nullable(bool), companies: list(object({ name, booksFrom: nullable(text(40)) }), 200),
});
export type TallyCompanies = ReturnType<typeof tallyCompaniesReply>;

export const sourceMoreReply = object({
  sourceId: id,
  refused: list(object({ at: when, origin: oneOf(['file', 'connector']), what: nullable(name), code: nullable(code), envelopeId: nullable(id) }), 50),
  kept: object({ file: literal('not-kept'), where: nullable(name) }),
  signIn: nullable(object({ method: oneOf(['browser', 'key', 'none']), note: nullable(line), endpoint: nullable(name) })),
  age: object({ lastRead: nullable(when), stale: bool, schedule: nullable(object({ everyHours: nullable(count), freshnessTargetHours: nullable(count) })) }),
  connectors: object({ available: bool }),
});
export type SourceMore = ReturnType<typeof sourceMoreReply>;

export const QUESTION_KINDS = ['ambiguous_field', 'unknown_value', 'date_format', 'currency', 'sign_convention'] as const;
const question = object({ envelopeId: id, sourceId: id, at: when, reason: oneOf(QUESTION_KINDS), field: name, sample: nullable(name), choices: list(name, 40) });
export type Question = ReturnType<typeof question>;
export const answerView = object({ id, sourceId: id, recipeId: name, recipeVersion: name, reason: code, field: name, sample: nullable(name), choice: name,
  answeredBy: object({ name, role: name, at: when }), envelopeId: nullable(id) });
export type AnswerView = ReturnType<typeof answerView>;
export const RECONCILE_STATES = ['matches', 'differs', 'rows-changed', 'not-imported', 'no-source-total'] as const;
export const reconcileView = object({
  envelopeId: id, importId: nullable(id), at: when, by: object({ name, role: name }), status: oneOf(RECONCILE_STATES),
  theirs: nullable(object({ total: nullable(digits), rowCount: nullable(count), reference: nullable(name), provenance: nullable(name) })),
  // A count or text the reader did not give is null and drawn as a missing word, never as 0 or blank.
  ours: object({ total: nullable(digits), rowCount: nullable(count), live: nullable(count), changed: nullable(count) }), measure: oneOf(['money', 'count']), unit: nullable(name),
});
export type ReconcileView = ReturnType<typeof reconcileView>;

export const recipeMoreReply = object({
  recipeId: name, questions: list(question, 20), answers: list(answerView, 500), reconciliations: list(reconcileView, 20),
  reconciled: nullable(object({ by: name, role: name, at: when, envelopeId: id })), gstin: nullable(text(15)),
  can: object({ answer: bool, answers: bool, remove: bool, diff: bool, reconcile: bool }),
}, { answersRead: object({ available: bool }, { code }) });
export type RecipeMore = ReturnType<typeof recipeMoreReply>;

export const answerReply = object({ answer: answerView, read: nullable(envelopeView), next: nullable(question), readAgain: oneOf(['not-needed', 'bring-the-file-again', 'read-again']) });
export const answerRemoveReply = object({ removed: literal(true), answerId: id });

export const EFFECTS = ['columns', 'meaning', 'dates', 'amount', 'check', 'identity', 'other'] as const;
export const diffReply = object({
  available: bool,
  diff: nullable(object({
    recipeId: name, available: bool, reason: nullable(literal('OLD_VERSION_NOT_KEPT')),
    from: object({ version: text(40), digest: text(200), label: oneOf(['read-with', 'seed']) }), to: object({ version: text(40), digest: text(200), label: oneOf(['current', 'with-answers']) }),
    same: bool, changes: list(object({ path: name, change: oneOf(['added', 'removed', 'changed']), before: nullable(line), after: nullable(line), effect: oneOf(EFFECTS) }), 500),
  })),
});
export type DiffReply = ReturnType<typeof diffReply>;
