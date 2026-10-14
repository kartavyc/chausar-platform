/**
 * Reply checks for the Work screens, mirroring the engine contract in
 * docs/lanes/work-books.md ("Work: approvals.*"). Every reply is checked here before a
 * screen draws it; a reply that does not match throws InvalidReply.
 */
import { InvalidReply, amount, bool, count, either, id, instant, integerString, isoDate, list, literal, nullable, object, oneOf, record, text, type Check } from './kit/validate.ts';

const short = text(400);
const long = text(4000);
/** An instant or a date: some times may arrive as a calendar day. */
const when = either(instant, isoDate);

export const TIERS = ['tier-2', 'tier-1', 'prepare-only'] as const;
export const ROW_STATES = ['prepared', 'approved', 'executing', 'verified', 'unknown', 'rejected', 'blocked', 'cancelled'] as const;
export const STEP_NAMES = ['prepared', 'approved', 'done', 'read-back', 'recorded'] as const;
export const STEP_STATES = ['done', 'waiting-for-you', 'waiting-for-network', 'unsure', 'stopped-by-rule', 'not-reached'] as const;
export const BLOCKED = ['expired', 'owner-approves', 'unsure', 'changed', 'prepare-blocked'] as const;
export const CAN = ['approve', 'notNow', 'change', 'drop', 'reconcile'] as const;
export const ACTION_CAN = ['execute', 'reconcile', 'resolve', 'reverse'] as const;
export const CATALOGUE_KINDS = ['inside-undoable', 'seen-outside', 'money', 'cannot-undo'] as const;
export const CATALOGUE_STATUS = ['live', 'experimental', 'prepare-only', 'not-yet'] as const;
export const JOB_STATES = ['proposed', 'scheduled', 'running', 'paused', 'waiting', 'set-aside', 'missed', 'stopped-by-rule', 'stopped', 'awaiting-acceptance', 'accepted', 'cancelled'] as const;
export const JOB_CAN = ['pause', 'resume', 'cancel', 'accept', 'reject', 'approve'] as const;

const rowShape = {
  id,
  source: oneOf(['action', 'job', 'release', 'lesson', 'acceptance'] as const),
  kind: oneOf(['message', 'record-change', 'money', 'prepare-only', 'job', 'group'] as const),
  tier: oneOf(TIERS),
  title: short,
  touches: nullable(short),
  amount: nullable(amount),
  preparedBy: nullable(object({ kind: oneOf(['person', 'job', 'chausar'] as const), name: short })),
  createdAt: instant,
  expiresAt: nullable(instant),
  state: oneOf(ROW_STATES),
  practice: bool,
};
export const approvalRow = object(rowShape);
export type ApprovalRow = ReturnType<typeof approvalRow>;

export const step = object({ name: oneOf(STEP_NAMES), state: oneOf(STEP_STATES), at: nullable(instant) });
export type Step = ReturnType<typeof step>;
/** Always five steps, in order. */
const fiveSteps: Check<readonly Step[]> = (value, path) => {
  const steps = list(step, 5)(value, path);
  if (steps.length !== 5 || steps.some((s, i) => s.name !== STEP_NAMES[i])) throw new InvalidReply(path);
  return steps;
};

export const jobCard = object({
  id, goal: short, doneWhen: long, owner: short, budget: amount, reserve: amount, spent: amount,
  stopRule: object({ maxRuns: count, deadline: when }),
  actions: list(short, 200), testedRoutes: list(short, 200), reviewOn: nullable(when),
  missedRun: oneOf(['skip', 'run-once-on-wake'] as const), runsOn: literal('this-computer'),
  runs: count, lastRunAt: nullable(instant), nextRunAt: nullable(instant),
  untrustedInstructions: bool, digest: id, revision: count,
});
export type JobCard = ReturnType<typeof jobCard>;

export const approvalDetail = object({
  ...rowShape,
  digest: id, revision: count, reason: short,
  change: object({}, { asWritten: long, fields: list(object({ name: short, before: long, after: long }), 200) }),
  steps: fiveSteps,
  can: list(oneOf(CAN), 5),
  readOnly: bool, prepareOnly: bool, needsSecondAsk: bool,
}, {
  voucher: object({
    type: short, number: nullable(short), date: isoDate,
    lines: list(object({ ledger: short, debit: nullable(amount), credit: nullable(amount) }), 200),
    note: literal('prepare-only'),
  }),
  job: jobCard,
  blocked: object({ kind: oneOf(BLOCKED), code: short }),
  snoozedUntil: instant,
});
export type ApprovalDetail = ReturnType<typeof approvalDetail>;

export const approvalList = object({
  items: list(approvalRow), expired: list(approvalRow), snoozed: count,
  counts: object({ tier2: count, tier1: count, prepareOnly: count }),
});
export type ApprovalList = ReturnType<typeof approvalList>;

export const snoozed = object({ id, snoozedUntil: instant });
export const dropped = object({ id, state: oneOf(['cancelled', 'rejected']) });
export const group = object({ title: short, undoable: literal(true), items: list(approvalDetail, 10) });
export type Group = ReturnType<typeof group>;
export const groupResults = object({ results: list(object({ id, ok: bool }, { code: short, state: short }), 10) });
export type GroupResults = ReturnType<typeof groupResults>;
export const pace = object({ fastStreak: count, warn: bool });
export const practice = object({ practice: literal(true), available: bool, steps: list(step, 5), wouldSend: nullable(long) }, { code: short });
export type Practice = ReturnType<typeof practice>;

const flatRequest: Check<Readonly<Record<string, string>>> = (value, path) => {
  const source = record(value, path);
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(source)) out[short(key, `${path}.key`)] = long(entry, `${path}.${key}`);
  return Object.freeze(out);
};

export const actionView = object({
  id, system: short, action: short, title: short, touches: nullable(short), amount: nullable(amount),
  state: oneOf(ROW_STATES), steps: fiveSteps, approvedBy: nullable(short),
  channel: nullable(oneOf(['desktop', 'phone', 'mcp'] as const)),
  request: flatRequest,
  readBack: nullable(list(object({ field: short, asked: long, found: nullable(long), same: bool }), 200)),
  rule: short,
  attestation: nullable(object({ by: short, said: oneOf(['was-sent', 'was-not-sent'] as const), at: instant })),
  wouldHaveDone: nullable(oneOf(['waited', 'done'] as const)),
  createdAt: instant, settledAt: nullable(instant), can: list(oneOf(ACTION_CAN), 4),
});
export type ActionView = ReturnType<typeof actionView>;
export const ledger = object({ items: list(actionView) });

const catalogueShape = {
  system: id, systemTitle: short, action: id, title: short,
  kind: oneOf(CATALOGUE_KINDS), waits: bool, status: oneOf(CATALOGUE_STATUS),
  source: oneOf(['core', 'writeback'] as const),
};
export const catalogueRow = object(catalogueShape);
export type CatalogueRow = ReturnType<typeof catalogueRow>;
export const catalogue = object({ rows: list(catalogueRow), writeback: object({ available: bool }) });
export const catalogueEntry = object({
  ...catalogueShape, description: long, idempotency: long, readBack: long,
  retryWindow: nullable(short), tier: oneOf(['tier-1', 'tier-2'] as const), expires: nullable(when), readStatus: nullable(short),
});
export type CatalogueEntry = ReturnType<typeof catalogueEntry>;
export const wanted = object({ id, at: instant });

export const afterRestore = object({ sendingClosed: bool, items: list(actionView), notes: list(long, 200) });

export const jobRow = object({
  id, goal: short, state: oneOf(JOB_STATES), reason: nullable(short),
  nextRunAt: nullable(instant), resumesAt: nullable(instant), spent: amount, budget: amount, can: list(oneOf(JOB_CAN), 6),
});
export type JobRow = ReturnType<typeof jobRow>;
export const jobs = object({ items: list(jobRow), active: count, limit: literal(10), proposals: object({ available: bool }) });
export type Jobs = ReturnType<typeof jobs>;
export const jobStep = object({ at: instant, event: long, amount: nullable(amount), needsModel: nullable(bool), reason: nullable(short) });
export type JobStep = ReturnType<typeof jobStep>;
const jobResult = object({ done: list(long, 200), open: list(long, 200), receiptIds: list(id, 200) });
/** WK-08: the budget as three meters. Clock time and exposure may be missing, in words. */
export const jobMeters = object({
  model: object({ spent: amount, budget: amount, route: nullable(short), estimate: bool }),
  clock: either(object({ minutes: count }), object({ missing: literal('not-counted') })),
  exposure: amount,
});
export type JobMeters = ReturnType<typeof jobMeters>;
const jobExtra = object({ timeline: list(jobStep), result: nullable(jobResult) }, { meters: jobMeters });
export const job: Check<JobCard & ReturnType<typeof jobExtra>> = (value, path) => Object.freeze({ ...jobCard(value, path), ...jobExtra(value, path) });
export type Job = ReturnType<typeof job>;

/** WK-09: the ready-made jobs a person can propose, and whether one sentence is available. */
export const jobTemplate = object({
  id, title: short, goal: long, doneWhen: long, type: literal('owner-brief'), every: oneOf(['day', 'week', 'month'] as const),
  budget: object({ minor: integerString }), maxRuns: count, days: count, missedRun: oneOf(['skip', 'run-once-on-wake'] as const),
  actions: list(short, 200), needsModel: literal(false),
});
export type JobTemplate = ReturnType<typeof jobTemplate>;
export const jobTemplates = object({ templates: list(jobTemplate, 50), fromSentence: object({ available: bool }) });
export type JobTemplates = ReturnType<typeof jobTemplates>;
/** A proposed job: its queue id, opened in the approval sheet. */
export const proposed: Check<{ readonly id: string }> = (value, path) => {
  const out = object({ id })(value, path);
  if (!out.id.startsWith('job:')) throw new InvalidReply(`${path}.id`);
  return out;
};

/** A core jobs.* mutation: its reply is not drawn, only checked to be an object. */
export const accepted: Check<Readonly<Record<string, unknown>>> = record;

/**
 * Queue ids carry ':' (`action:<id>`), which a sheet address may not. The encoding is
 * reversible: '_' doubles, ':' becomes '_c', '@' becomes '_a', and '_s' separates the
 * parts of a sheet that names two things (a catalogue system and action).
 */
export function sheetOf(...parts: readonly string[]): string {
  return parts.map(part => part.replace(/_/g, '__').replace(/:/g, '_c').replace(/@/g, '_a')).join('_s');
}
export function partsOf(sheet: string): string[] {
  const parts = [''];
  for (const [, escaped, plain] of sheet.matchAll(/_(.)|([^_])/g)) {
    if (plain !== undefined) parts[parts.length - 1] += plain;
    else if (escaped === 's') parts.push('');
    else parts[parts.length - 1] += escaped === '_' ? '_' : escaped === 'c' ? ':' : escaped === 'a' ? '@' : '';
  }
  return parts;
}
export function idOf(sheet: string): string { return partsOf(sheet)[0] ?? ''; }
