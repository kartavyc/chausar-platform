/**
 * Jobs run by jobs-ext, seen from Work (WK-07..WK-10): its proposed cards in the one approvals
 * queue, its questions answered from the job sheet, and its results accepted or sent back with
 * its own methods. Everything is read in jobs-ext's real shapes (`platform/runtime/jobs-ext/`
 * on `claude/lane-jobs-ext`: `methods.ts`, `proposals.ts`, `state.ts`) and copied field by field;
 * a row that does not fit is left out, never guessed.
 *
 *  - A proposal (`Proposal = { id, createdAt, createdBy, origin, fromJobId?, replacesJobId?,
 *    sentence?, card: JobCard, digest, status: 'proposed', evidence }`) waits in the queue as
 *    `proposal:<id>`, listed from `jobsx.proposals`. Approve calls `jobsx.approveProposal { id,
 *    digest }` (only the card's owner may), Drop calls `jobsx.dismissProposal { id }`.
 *  - A question (`LaneQuestion = { id, jobId, prompt, options, suggested?: { option, confidence },
 *    status: 'open' }`) is answered with `jobsx.answer { questionId, option }`, one of its options.
 *  - A lane job's result is accepted with `jobsx.accept { id, reference }` (the exact reviewed
 *    reference, as core checks it) and sent back with `jobsx.reject { id, reason }`; pause and
 *    resume go to `jobsx.pause` / `jobsx.resume`. A core job keeps the core `jobs.*` methods.
 *
 * A jobs-ext method is used only for a lane job and only when the method registry lists it.
 */
import { check, ChausarError } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import type { Job } from '../jobs.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { env, finish, steps, visibleJobs, acceptanceReference, parseId, isReadOnly } from './work-queue.ts';
import type { ApprovalDetail, ApprovalRow, Env, JobCard } from './work-queue.ts';
import { installed, isLaneJob, jobsxView, laneMethod } from './work-jobs-sheet.ts';

const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown, max = 400): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const UNSIGNED = /^(0|[1-9]\d{0,29})$/;
const instant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const day = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const strings = (value: unknown, max = 200): string[] => Array.isArray(value) ? value.filter((s): s is string => str(s, max)) : [];
const MISSED: Readonly<Record<string, 'skip' | 'once' | 'all'>> = Object.freeze({ skip: 'skip', once: 'once', all: 'all' });
/** Sent back from the queue without a sentence of the person's own. */
export const SENT_BACK = 'Sent back from the approvals queue.';

/** jobs-ext's job card (`JobCard` in its state.ts), the fields Work shows. */
export type LaneCard = {
  title: string; goal: string; finishedWhen: string; ownerId: string; budgetMinor: string; reserveMinor: string;
  stopRule: { maxRuns: number; deadline: string }; nextRunAt: string; missedRule: 'skip' | 'once' | 'all';
  allowedActions: string[]; testedRoutes: string[]; reviewDate: string | null; untrustedInstructions: boolean;
  steps: { title: string; needsModel: boolean }[];
};
export type LaneProposal = {
  id: string; createdAt: string; createdBy: string; origin: string; fromJobId: string | null; replacesJobId: string | null;
  card: LaneCard; digest: string; evidence: string[];
};

function cardOf(c: unknown): LaneCard | null {
  if (!record(c) || !str(c.title) || !str(c.goal, 2000) || !str(c.finishedWhen, 2000) || !str(c.ownerId, 200)) return null;
  if (typeof c.budgetMinor !== 'string' || !UNSIGNED.test(c.budgetMinor) || typeof c.reserveMinor !== 'string' || !UNSIGNED.test(c.reserveMinor)) return null;
  if (!record(c.stopRule) || !Number.isSafeInteger(c.stopRule.maxRuns) || c.stopRule.maxRuns < 0 || !instant(c.stopRule.deadline)) return null;
  if (!instant(c.nextRunAt) || typeof c.missedRule !== 'string' || !Object.hasOwn(MISSED, c.missedRule)) return null;
  return {
    title: c.title, goal: c.goal, finishedWhen: c.finishedWhen, ownerId: c.ownerId, budgetMinor: c.budgetMinor, reserveMinor: c.reserveMinor,
    stopRule: { maxRuns: c.stopRule.maxRuns, deadline: c.stopRule.deadline }, nextRunAt: c.nextRunAt, missedRule: MISSED[c.missedRule],
    allowedActions: strings(c.allowedActions), testedRoutes: strings(c.testedRoutes), reviewDate: day(c.reviewDate) || instant(c.reviewDate) ? c.reviewDate : null,
    untrustedInstructions: c.untrustedInstructions === true,
    steps: (Array.isArray(c.steps) ? c.steps : []).filter((s: unknown) => record(s) && str(s.title, 2000) && typeof s.needsModel === 'boolean').map((s: any) => ({ title: s.title, needsModel: s.needsModel })),
  };
}
/** One `Proposal` from `jobsx.proposals`, or null when it does not fit or is no longer waiting. */
export function proposalFrom(p: unknown): LaneProposal | null {
  if (!record(p) || p.status !== 'proposed' || !str(p.id, 200) || !ID.test(p.id) || !str(p.digest, 200) || p.digest.length < 8 || !instant(p.createdAt) || !str(p.createdBy, 200)) return null;
  const card = cardOf(p.card); if (!card) return null;
  return {
    id: p.id, createdAt: p.createdAt, createdBy: p.createdBy, origin: str(p.origin, 40) ? p.origin : 'person',
    fromJobId: str(p.fromJobId, 200) ? p.fromJobId : null, replacesJobId: str(p.replacesJobId, 200) ? p.replacesJobId : null,
    card, digest: p.digest, evidence: strings(p.evidence, 2000).slice(0, 10),
  };
}

/** The proposals waiting for the caller (`jobsx.proposals`, read only when installed). A refusal reads as none. */
export async function loadLaneProposals(host: ModuleHost): Promise<LaneProposal[]> {
  if (!(await installed(host, 'jobsx.proposals'))) return [];
  let reply: unknown;
  try { reply = await host.call('jobsx.proposals', {}); } catch { return []; }
  return (Array.isArray(reply) ? reply : []).map(proposalFrom).filter((p): p is LaneProposal => p !== null);
}

const nameOf = (e: Env, id: string) => e.state.members.find(m => m.id === id)?.name ?? null;
/** The jobs-ext card as Work's job card (WK-09). "Run every missed one" is named in the change, since the card has two values. */
function laneJobCard(e: Env, p: LaneProposal): JobCard {
  const c = p.card;
  return {
    id: p.id, goal: c.goal, doneWhen: c.finishedWhen, owner: nameOf(e, c.ownerId) ?? c.ownerId,
    budget: { minor: c.budgetMinor }, reserve: { minor: c.reserveMinor }, spent: { minor: '0' },
    stopRule: { maxRuns: c.stopRule.maxRuns, deadline: c.stopRule.deadline }, actions: [...c.allowedActions], testedRoutes: [...c.testedRoutes],
    reviewOn: c.reviewDate, missedRun: c.missedRule === 'skip' ? 'skip' : 'run-once-on-wake', runsOn: 'this-computer',
    runs: 0, lastRunAt: null, nextRunAt: c.nextRunAt, untrustedInstructions: c.untrustedInstructions, digest: p.digest, revision: 1,
  };
}

/** A proposed card from jobs-ext as a queue item: tier 2 (a new job starts only with a yes), approved only by the card's owner. */
export function proposalDetail(e: Env, p: LaneProposal): ApprovalDetail {
  const by = p.origin === 'detector' ? { kind: 'chausar' as const, name: 'Chausar' }
    : p.origin === 'job' ? { kind: 'job' as const, name: p.card.title }
      : { kind: 'person' as const, name: nameOf(e, p.createdBy) ?? p.createdBy };
  const row: ApprovalRow = {
    id: `proposal:${p.id}`, source: 'proposal', kind: 'job', tier: 'tier-2',
    title: `${p.replacesJobId ? 'Change job' : 'Start job'}: ${p.card.title}`, what: { kind: p.replacesJobId ? 'change-job' : 'start-job', name: p.card.title }, touches: p.card.allowedActions.length ? p.card.allowedActions.join(', ') : null,
    amount: { minor: p.card.budgetMinor }, preparedBy: by, createdAt: p.createdAt, expiresAt: null, state: 'prepared', practice: false,
  };
  const fields = [
    { name: 'goal', before: '', after: p.card.goal },
    ...(p.replacesJobId ? [{ name: 'replaces job', before: '', after: p.replacesJobId }] : []),
    ...(p.card.missedRule === 'all' ? [{ name: 'missed run', before: '', after: 'run every missed one' }] : []),
    ...p.card.steps.map((s, i) => ({ name: `step ${i + 1}`, before: '', after: s.title })),
  ];
  const mine = p.card.ownerId === e.ctx.memberId;
  return finish(e, row, {
    digest: p.digest, revision: 1, reason: 'job-approval', change: { fields }, job: laneJobCard(e, p),
    steps: steps(['done', p.createdAt], ['waiting-for-you', null]), prepareOnly: false, needsSecondAsk: false,
    ...(!mine && !isReadOnly(e) ? { blocked: { kind: 'owner-approves' as const, code: 'JOB_OWNER_REQUIRED' } } : {}),
  }, { change: false, approve: mine });
}

/** `jobsx.approveProposal`: the exact card, by its digest. Its reply names the job it made. */
export async function approveProposal(host: ModuleHost, raw: string, digest: string): Promise<string | null> {
  if (!(await installed(host, 'jobsx.approveProposal'))) throw new ChausarError('PROPOSAL_APPROVAL_NOT_BUILT', 'Approving a proposed job is not built yet.');
  const reply = await host.call('jobsx.approveProposal', { id: raw, digest });
  check(record(reply) && record(reply.proposal) && reply.proposal.id === raw, 'INVALID_JOB_REPLY', 'The approved job could not be read back.');
  return record(reply.job) && str(reply.job.id, 200) ? reply.job.id : null;
}
export async function dismissProposal(host: ModuleHost, raw: string): Promise<void> {
  if (!(await installed(host, 'jobsx.dismissProposal'))) throw new ChausarError('PROPOSAL_APPROVAL_NOT_BUILT', 'Dropping a proposed job is not built yet.');
  const reply = await host.call('jobsx.dismissProposal', { id: raw });
  check(record(reply) && reply.id === raw && reply.status === 'dismissed', 'INVALID_JOB_REPLY', 'The dropped proposal could not be read back.');
}

/** Accept a delivered result with its exact reference: jobs-ext for a lane job, else the core. */
export async function acceptResult(e: Env, job: Job): Promise<void> {
  const reference = acceptanceReference(e, job);
  if (await laneMethod(e.host, job, 'jobsx.accept')) await e.host.call('jobsx.accept', { id: job.id, reference });
  else await e.host.call('jobs.accept', { id: job.id, reference });
}
/** Send a result back with a sentence: jobs-ext for a lane job (it writes its own time line), else the core. */
export async function sendBack(host: ModuleHost, job: Job, reason: string): Promise<void> {
  if (await laneMethod(host, job, 'jobsx.reject')) await host.call('jobsx.reject', { id: job.id, reason });
  else await host.call('jobs.reject', { id: job.id, reason });
}

function exact(payload: unknown, required: string[]): asserts payload is Record<string, any> {
  check(record(payload) && required.every(k => Object.hasOwn(payload, k)) && Object.keys(payload).every(k => required.includes(k)), 'INVALID_JOB_CHANGE', 'Use only the declared request fields.');
}
function findJob(e: Env, value: unknown): Job {
  check(typeof value === 'string' && value.length > 0 && value.length <= 240, 'INVALID_JOB_CHANGE', 'Use a job id.');
  const raw = /^(job|acceptance):/.test(value) ? parseId(value).raw : value;
  const job = visibleJobs(e).find(j => j.id === raw); check(job, 'NOT_FOUND', 'Job not found.');
  return job;
}

export const workJobLaneMethods: Readonly<Record<string, MethodSpec>> = {
  /**
   * WK-08 "waiting for you": answer a lane job's question with one of its options
   * (`jobsx.answer { questionId, option }`). The question must be open on this job.
   */
  'approvals.answerQuestion': { permission: 'approve', async handler(ctx: Context, payload, host) {
    exact(payload, ['jobId', 'questionId', 'option']);
    check(str(payload.questionId, 200) && str(payload.option, 200), 'INVALID_JOB_CHANGE', 'Name the question and one of its answers.');
    const e = await env(ctx, host); const job = findJob(e, payload.jobId);
    if (!isLaneJob(job) || !(await installed(host, 'jobsx.answer'))) throw new ChausarError('QUESTION_ANSWER_NOT_BUILT', 'Answering a job’s question is not built yet.');
    const view = await jobsxView(host, job);
    const question = view?.questions.find(q => q.id === payload.questionId); check(question, 'NOT_FOUND', 'Question not found.');
    check(question.options.includes(payload.option), 'INVALID_ANSWER', 'Choose one of the offered answers.');
    const back = await host.call('jobsx.answer', { questionId: question.id, option: payload.option });
    check(record(back) && back.id === question.id && back.status === 'answered' && back.answer === payload.option, 'INVALID_JOB_REPLY', 'The answer could not be read back.');
    return { jobId: job.id, questionId: question.id, answer: payload.option as string, answeredAt: instant(back.answeredAt) ? back.answeredAt : null };
  } },
  /** WK-10: send a delivered result back with a sentence. The job pauses until it is resumed. */
  'approvals.sendBack': { permission: 'approve', async handler(ctx, payload, host) {
    exact(payload, ['id', 'reason']);
    check(typeof payload.reason === 'string' && payload.reason.trim().length > 0 && payload.reason.length <= 500, 'INVALID_JOB_CHANGE', 'Say in a sentence why you send it back.');
    const e = await env(ctx, host); const job = findJob(e, payload.id);
    check(job.status === 'awaiting-acceptance', 'INVALID_JOB_STATE', 'No delivered result to send back.');
    await sendBack(host, job, payload.reason.trim());
    return { id: job.id, state: 'rejected' as const, via: isLaneJob(job) && await installed(host, 'jobsx.reject') ? 'jobsx' as const : 'core' as const };
  } },
  /** WK-07/WK-08: pause or resume. A lane job goes to jobs-ext (resume also clears its set-aside), a core job to the core. */
  'approvals.pauseJob': { permission: 'approve', async handler(ctx, payload, host) {
    exact(payload, ['id']); const e = await env(ctx, host); const job = findJob(e, payload.id);
    const lane = await laneMethod(host, job, 'jobsx.pause');
    await host.call(lane ? 'jobsx.pause' : 'jobs.pause', { id: job.id });
    return { id: job.id, via: lane ? 'jobsx' as const : 'core' as const };
  } },
  'approvals.resumeJob': { permission: 'approve', async handler(ctx, payload, host) {
    exact(payload, ['id']); const e = await env(ctx, host); const job = findJob(e, payload.id);
    const lane = await laneMethod(host, job, 'jobsx.resume');
    await host.call(lane ? 'jobsx.resume' : 'jobs.resume', { id: job.id });
    return { id: job.id, via: lane ? 'jobsx' as const : 'core' as const };
  } },
};
