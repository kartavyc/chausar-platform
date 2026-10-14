/**
 * Proposing a job (WK-09) and the job budget meters (WK-08). A proposal is made from a fixed,
 * ready-made template over the core read-only `owner-brief` job type: it reads the owner's
 * books and writes a brief, it prepares no action and needs no AI model. The job is created
 * through core `jobs.create` with `requiresApproval: true`, so it starts only after an
 * approval of its exact card in the approvals queue. A proposal from one sentence passes
 * through to `jobsx.propose` when that lane is installed. Money stays integer paise as text.
 */
import { check, ChausarError } from '../contracts.ts';
import type { PreparedAction } from '../actions.ts';
import type { Job } from '../jobs.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { nowMs, isoAt, parseId, visibleActions } from './work-queue.ts';
import type { Amount, Env } from './work-queue.ts';

const DAY = 86_400_000;
const INTERVAL = { day: DAY, week: 7 * DAY, month: 30 * DAY } as const;
type Every = keyof typeof INTERVAL;
type MissedRun = 'skip' | 'run-once-on-wake';
export type JobTemplate = {
  id: string; title: string; goal: string; doneWhen: string; type: 'owner-brief'; every: Every;
  budget: { minor: string }; maxRuns: number; days: number; missedRun: MissedRun; actions: string[]; needsModel: false;
};

/** The ready-made jobs. Each only reads the owner's books and writes a brief: no effects outside. */
export const JOB_TEMPLATES: readonly JobTemplate[] = Object.freeze([
  {
    id: 'daily-brief', title: 'Daily brief', type: 'owner-brief', every: 'day',
    goal: 'Write a short brief of the business every day from the books loaded in Chausar.',
    doneWhen: 'A brief is ready each day, and you accept it.',
    budget: { minor: '5000' }, maxRuns: 30, days: 30, missedRun: 'run-once-on-wake', actions: [], needsModel: false,
  },
  {
    id: 'weekly-brief', title: 'Weekly brief', type: 'owner-brief', every: 'week',
    goal: 'Write a brief of the week for the business from the books loaded in Chausar.',
    doneWhen: 'A brief is ready each week, and you accept it.',
    budget: { minor: '10000' }, maxRuns: 13, days: 91, missedRun: 'run-once-on-wake', actions: [], needsModel: false,
  },
  {
    id: 'month-end-brief', title: 'Month-end brief', type: 'owner-brief', every: 'month',
    goal: 'Write a month-end brief for the business from the books loaded in Chausar.',
    doneWhen: 'A brief is ready each month, and you accept it.',
    budget: { minor: '20000' }, maxRuns: 12, days: 366, missedRun: 'skip', actions: [], needsModel: false,
  },
] satisfies JobTemplate[]);

const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const PAISE = /^[1-9]\d{0,17}$/;
const ABSENT = new Set(['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE']);

/** Whether `jobsx.propose` is installed. Probed with an empty request; any answer other than "absent" means it is there. */
async function sentenceAvailable(host: ModuleHost): Promise<boolean> {
  try { await host.call('jobsx.propose', {}); return true; }
  catch (error) { return !ABSENT.has((error as { code?: unknown })?.code as string); }
}

function templatePayload(payload: Record<string, any>) {
  const allowed = ['templateId', 'budgetMinor', 'maxRuns', 'missedRun'];
  check(Object.keys(payload).every(k => allowed.includes(k)), 'INVALID_JOB_PROPOSAL', 'Use only the declared request fields.');
  const template = JOB_TEMPLATES.find(t => t.id === payload.templateId);
  check(template, 'TEMPLATE_NOT_FOUND', 'Choose one of the ready-made jobs.');
  const budgetMinor = payload.budgetMinor ?? template.budget.minor;
  check(typeof budgetMinor === 'string' && PAISE.test(budgetMinor) && BigInt(budgetMinor) <= BigInt(template.budget.minor) * 10n,
    'INVALID_BUDGET', 'The budget is whole paise, more than zero and at most ten times the ready-made budget.');
  const maxRuns = payload.maxRuns ?? template.maxRuns;
  check(Number.isSafeInteger(maxRuns) && maxRuns >= 1 && maxRuns <= 366, 'STOP_RULE_REQUIRED', 'Allow 1 to 366 runs.');
  const missedRun: MissedRun = payload.missedRun ?? template.missedRun;
  check(missedRun === 'skip' || missedRun === 'run-once-on-wake', 'INVALID_SCHEDULE', 'A missed run is skipped or run once on wake.');
  return { template, budgetMinor: budgetMinor as string, maxRuns: maxRuns as number, missedRun };
}

/** A queue id from a created or proposed job, checked through the queue's own parser. */
function queueIdOf(value: unknown): string {
  check(record(value) && typeof value.id === 'string', 'INVALID_JOB_REPLY', 'The proposed job could not be read back.');
  const id = /^(job|acceptance):/.test(value.id) ? value.id : `job:${value.id}`;
  check(parseId(id).source === 'job', 'INVALID_JOB_REPLY', 'The proposed job could not be read back.');
  return id;
}

/**
 * WK-08 meters, from the job alone. Model use is the job's own spent and budget. Clock time is
 * counted only when the ledger records durations. Effect exposure sums the amounts of the
 * prepared or approved actions the job names (its ledger or its deliverable); when it names
 * none with an amount, it is "not counted", never zero.
 */
export type JobMeters = {
  model: { spent: Amount; budget: Amount; route: string | null; estimate: boolean };
  clock: { minutes: number } | { missing: 'not-counted' };
  exposure: Amount;
};
export function jobMeters(e: Env, job: Job): JobMeters {
  const routes = [...(job.testedRoutes ?? [])];
  const durations = job.ledger.map(l => (l as { durationMs?: unknown }).durationMs).filter((d): d is number => Number.isSafeInteger(d) && (d as number) >= 0);
  const totalMs = durations.reduce((sum, d) => sum + BigInt(d), 0n);
  const strings = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  const d = job.deliverable as Record<string, unknown> | undefined;
  const named = new Set<string>([
    ...job.ledger.map(l => (l as { actionId?: unknown }).actionId).filter((s): s is string => typeof s === 'string'),
    ...(record(d) ? strings(d.actionIds) : []),
  ]);
  const open = named.size === 0 ? [] : visibleActions(e).filter((a: PreparedAction) => named.has(a.id) && ['prepared', 'approved'].includes(a.status));
  const amounts = open.map(a => a.payload?.amountMinor).filter((m): m is string => typeof m === 'string' && /^(0|[1-9]\d*)$/.test(m));
  return {
    model: { spent: { minor: job.spentMinor }, budget: { minor: job.budgetMinor }, route: routes.length ? routes.join(', ') : null, estimate: routes.some(r => /(^|[-_.])cli([-_.]|$)/i.test(r)) },
    clock: durations.length ? { minutes: Number((totalMs + 30_000n) / 60_000n) } : { missing: 'not-counted' },
    exposure: amounts.length ? { minor: String(amounts.reduce((sum, m) => sum + BigInt(m), 0n)) } : { missing: 'not-counted' },
  };
}

export const workJobMethods: Readonly<Record<string, MethodSpec>> = {
  'approvals.jobTemplates': { permission: 'read', async handler(_ctx, payload, host) {
    check(record(payload) && Object.keys(payload).length === 0, 'INVALID_JOB_PROPOSAL', 'Send an empty request.');
    return { templates: JOB_TEMPLATES.map(t => ({ ...t, budget: { ...t.budget }, actions: [...t.actions] })), fromSentence: { available: await sentenceAvailable(host) } };
  } },
  /**
   * Creating a job is an approve-level change in core (an accountant or viewer is refused).
   * The created job waits in the approvals queue as `job:<id>` until its card is approved.
   */
  'approvals.proposeJob': { permission: 'approve', async handler(ctx, payload, host) {
    check(record(payload), 'INVALID_JOB_PROPOSAL', 'Send a template or a sentence.');
    if (Object.hasOwn(payload, 'sentence')) {
      check(Object.keys(payload).length === 1 && typeof payload.sentence === 'string' && payload.sentence.trim().length >= 5 && payload.sentence.length <= 500,
        'INVALID_JOB_PROPOSAL', 'Say the job in one sentence of up to 500 characters.');
      const result = await optionalCall(host, 'jobsx.propose', { sentence: payload.sentence.trim() });
      if (!result.available) throw new ChausarError('PROPOSAL_FROM_SENTENCE_NOT_BUILT', 'Proposing a job from one sentence is not built yet.');
      return { id: queueIdOf(result.value) };
    }
    const { template, budgetMinor, maxRuns, missedRun } = templatePayload(payload);
    const at = nowMs(host);
    const created = await host.call('jobs.create', {
      type: 'owner-brief', goal: template.goal, budgetMinor, reserveMinor: budgetMinor,
      stopRule: { maxRuns, deadline: isoAt(at + template.days * DAY) }, intervalMs: INTERVAL[template.every],
      catchup: missedRun === 'skip' ? 'skip' : 'latest', requiresApproval: true,
    });
    const id = queueIdOf(created);
    // The proposal must be in the caller's queue, waiting for its yes; anything else is a broken contract.
    check(host.services.jobs && (host.services.jobs.list(ctx) as Job[]).some(j => `job:${j.id}` === id && j.requiresApproval && !j.approval), 'INVALID_JOB_REPLY', 'The proposed job is not waiting for approval.');
    return { id };
  } },
};
