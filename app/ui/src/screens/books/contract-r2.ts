/**
 * Reply checks for the round-2 Books methods (connections, systems, recipes, "Map this field",
 * a change tried on a copy), mirroring docs/lanes/work-books.md. Every reply is untrusted data
 * and is drawn only after it has passed its check here.
 */
import { amount, bool, count, either, id, instant, isoDate, list, literal, nullable, object, oneOf, text, type Check } from '../work/kit/validate.ts';

const name = text(400);
const line = text(4000);
const code = text(64);
const digits = text(40);
const when: Check<string> = either(instant, isoDate);
const period = nullable(object({ from: isoDate, to: isoDate }));
const ROADS = ['interface', 'file', 'database'] as const;

export const connectionView = object({
  connectionId: id, sourceId: id, group: name, road: oneOf(ROADS), label: name, company: text(400), branch: name, status: oneOf(['active', 'paused']),
});
export type ConnectionView = ReturnType<typeof connectionView>;
export const operationView = object({ id: name, label: line, limitation: line, live: bool });

export const envelopeView = object({
  id, sourceId: id, at: when, operation: name, recipeId: name, recipeVersion: name,
  status: oneOf(['accepted', 'refused', 'abstained', 'failed']),
  refusal: nullable(object({ code, reason: line })),
  abstention: nullable(object({ reason: code, field: name, question: line, options: list(name, 20) })),
  period, rows: count, excludedRows: count,
  total: object({ measure: oneOf(['money', 'count']), unit: name, ours: nullable(digits), theirs: nullable(digits), match: oneOf(['yes', 'no', 'unavailable']) }),
  checks: list(object({ id: name, status: oneOf(['passed', 'failed', 'unavailable']) }), 50),
  unmappedFields: list(name), notices: list(line, 20), waiting: bool,
  committed: nullable(object({ at: when, rows: count, duplicate: bool })),
});
export type EnvelopeView = ReturnType<typeof envelopeView>;

/** The connection on `books.source` (round 2), with the reads it offers. */
export const connectionWithOperations = object({
  connectionId: id, sourceId: id, group: name, road: oneOf(ROADS), label: name, company: text(400), branch: name, status: oneOf(['active', 'paused']),
  operations: list(operationView, 100),
});
export type ConnectionWithOperations = ReturnType<typeof connectionWithOperations>;

const STATUS = ['tested', 'experimental', 'planned', 'not-possible'] as const;
const evidence = object({ synthetic: count, madeToOrder: count, realWithConsent: count });
export const systemRow = object({
  id: name, name, family: name, depth: nullable(oneOf(['full', 'read', 'import'])), available: bool,
  status: oneOf(STATUS), tier: oneOf(['supported', 'experimental', 'planned']), liveVerified: bool, evidence,
  ways: list(oneOf(ROADS), 3), signIn: object({ method: oneOf(['browser', 'key', 'none']), note: nullable(line) }), settings: list(name, 20),
  operations: list(object({ id: name, label: line, depth: oneOf(['full', 'read', 'import']), road: name, status: oneOf(STATUS), tier: oneOf(['supported', 'experimental', 'planned']), limitation: line, evidence }), 200),
});
export type SystemRow = ReturnType<typeof systemRow>;
export const systemsReply = object({ available: bool, systems: list(systemRow, 200) });

export const signInReply = either(
  object({ sourceId: id, method: literal('browser'), url: text(4000), expiresInSeconds: count, note: nullable(line) }),
  object({ sourceId: id, method: oneOf(['key', 'none']), instruction: line }),
);
export const disconnectReply = object({ sourceId: id, removed: bool, factsKept: bool });

const recipeRow = object({ id: name, version: name, system: name, operation: name, title: line, state: oneOf(['seed', 'tested', 'not-yet-tested', 'failed']), totals: name, measure: oneOf(['money', 'count']), lastReadAt: nullable(when) });
export type RecipeRow = ReturnType<typeof recipeRow>;
const PROPOSAL_STATES = ['proposed', 'accepted', 'declined', 'published'] as const;
export const recipesReply = object({
  available: bool, recipes: list(recipeRow),
  proposals: list(object({ id, sourceId: id, field: name, state: oneOf(PROPOSAL_STATES), proposedBy: name, at: when, valid: bool })),
});
const GRADES = ['model', 'owner', 'accountant', 'ca', 'reconciled'] as const;
export const QUESTION_REASONS = ['value-not-in-list', 'binding-not-settled', 'not-known-whether-applies', 'check-failed', 'too-little-evidence'] as const;
export const recipeReply = object({
  recipe: recipeRow,
  scope: object({ system: name, company: nullable(text(400)), branch: nullable(name), gstin: nullable(name), period }),
  bindings: list(object({ meaning: name, headings: list(name, 20), type: name, required: bool, state: oneOf(['seed', 'proposed', 'accepted']), acceptedBy: nullable(object({ by: name, role: name, at: when })), grade: nullable(oneOf(GRADES)) }), 200),
  check: nullable(object({ envelopeId: id, at: when, measure: oneOf(['money', 'count']), unit: name, ours: nullable(digits), theirs: nullable(digits), match: oneOf(['yes', 'no', 'unavailable']) })),
  questions: list(object({ envelopeId: id, sourceId: id, at: when, reason: oneOf(QUESTION_REASONS), detail: nullable(code), field: nullable(name), question: nullable(line), choices: list(name, 20),
    ours: nullable(digits), theirs: nullable(digits), measure: oneOf(['money', 'count']), unit: name }), 20),
  newer: nullable(object({ readWith: name, current: name })),
  notices: list(line, 10), sourceIds: list(id, 200),
});
export type RecipeView = ReturnType<typeof recipeReply>;

const issue = object({ path: name, code });
export const proposalView = object({
  id, sourceId: id, field: name, target: nullable(name), origin: oneOf(['library', 'person']), state: oneOf(PROPOSAL_STATES), proposedBy: name, at: when,
  valid: bool, fieldBound: bool, digest: nullable(text(200)),
  scope: nullable(object({ system: name, company: nullable(text(400)), branches: list(name, 50) })),
  bindings: list(object({ target: name, source: nullable(name), type: name, state: oneOf(['accepted', 'proposed']), acceptedBy: nullable(object({ by: name, role: name, at: when })),
    grade: nullable(oneOf(GRADES)), change: oneOf(['same', 'new', 'changed']) }), 1000),
  dropped: list(name, 1000), issues: list(issue, 200), removed: list(issue, 200), missingTargets: list(name, 20),
  decided: nullable(object({ by: name, role: name, at: when })), libraryId: nullable(id), baseChanged: bool,
});
export type ProposalView = ReturnType<typeof proposalView>;

const receiptSummary = nullable(object({ operation: name, period, counted: count, excluded: count, definitions: list(name, 20), completeness: name }));
const trialCell = object({ value: amount, refused: nullable(code), receipt: receiptSummary, receiptId: nullable(id) });
export type TrialCell = ReturnType<typeof trialCell>;
export const trialView = object({
  trialId: id, draftId: nullable(id), proposalId: nullable(id), experimental: literal(true), status: oneOf(['created', 'evaluated']),
  change: object({ type: name, target: name }), cost: object({ preparationMs: count, diskBytes: count }), evaluationDigest: nullable(text(200)),
  rows: list(object({ answerId: id, operation: name, period, now: trialCell, withChange: trialCell, differs: bool }), 200),
  impact: nullable(object({ digest: text(200), strategy: literal('prospective'), affectedAnswers: count, rebuild: count, activeWork: count })), impactCode: nullable(code),
  limitations: list(line, 10),
}, {
  // Audit, additive: a source order tried on a copy (BK-14 to BK-09).
  precedence: nullable(object({ kind: name, sourceIds: list(name, 64) })),
});
export type TrialView = ReturnType<typeof trialView>;
export const trialReadReply = object({ trial: nullable(trialView) });
export const trialQuestionsReply = object({ available: bool, questions: list(object({ id, receiptId: id, operation: name, period, stale: bool }), 500) });
export const trialPublishReply = object({ trialId: id, status: literal('promoted'), publicationId: id, draftId: nullable(id), proposalId: nullable(id) },
  { precedence: nullable(object({ kind: name, sourceIds: list(name, 64) })) });
export const trialDiscardReply = object({ trialId: id, status: literal('discarded'), cleanupComplete: bool });
