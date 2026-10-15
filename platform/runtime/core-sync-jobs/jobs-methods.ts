/**
 * Core job methods of the core-sync-jobs lane (WK-08, WK-09, WK-16): the review date on a job's card,
 * marking a step for a person done, child-task results and the clock and exposure meters. Each handler is
 * thin: the store change and its checks live in JobService (jobs.ts) and DurableJobRunner (job-runner.ts).
 */
import { check } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import type { Job, JobService } from '../jobs.ts';
import type { DurableJobRunner } from '../job-runner.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';

const jobsOf = (host: ModuleHost) => { const jobs = host.services.jobs as JobService | undefined; check(jobs, 'JOBS_UNAVAILABLE', 'Open a workspace first.'); return jobs; };
const name = (value: unknown, code = 'INVALID_REQUEST', what = 'Name one job.') => { check(typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value), code, what); return value; };
const exact = (payload: Record<string, unknown>, keys: string[]) => check(payload !== null && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).every(key => keys.includes(key)), 'INVALID_REQUEST', 'Use only the declared request fields.');

export const jobMethods: Record<string, MethodSpec> = {
  /** { id, reviewOn: 'YYYY-MM-DD' | null } → the job. The date is shown on the card and is not authority. */
  'jobs.review.set': { permission: 'approve', handler(ctx: Context, payload, host): Promise<Job> {
    exact(payload, ['id', 'reviewOn']); check(Object.hasOwn(payload, 'reviewOn'), 'INVALID_REVIEW_DATE', 'Set the review date as a real date, YYYY-MM-DD, or null to clear it.');
    return jobsOf(host).setReviewDate(ctx, name(payload.id), payload.reviewOn);
  } },
  /** { id, stepId } → the job. Only the job's pinned owner marks a step for a person done; a job waiting on it resumes. */
  'jobs.personStep.done': { permission: 'approve', handler(ctx: Context, payload, host): Promise<Job> {
    exact(payload, ['id', 'stepId']);
    return jobsOf(host).personStepDone(ctx, name(payload.id), name(payload.stepId, 'PERSON_STEP_NOT_FOUND', 'Name a step for a person in this job.'));
  } },
  /** { id } → { jobId, objectiveRevision, open, children: [{ id, goal, state, missingStepIds, results }] }. Same release as jobs.progress. */
  'jobs.childResults': { permission: 'read', handler(ctx: Context, payload, host) {
    exact(payload, ['id']); const id = name(payload.id); const runner = host.services.jobRunner as DurableJobRunner | undefined;
    if (runner) return runner.childResults(ctx, id);
    // Without a typed runner no plan runs here; a job without a plan has no child tasks.
    const job = jobsOf(host).list(ctx).find(item => item.id === id); check(job, 'NOT_FOUND', 'Job not found.');
    check(!job.plan, 'JOB_POLICY_REQUIRED', 'Configure explicit worker, active-job and lease policy before reading typed goals.');
    return { jobId: job.id, objectiveRevision: job.revision, open: false, children: [] };
  } },
  /** { id } → { jobId, clockMs, exposureMinor, actions, reviewOn }. Owner only. */
  'jobs.meters': { permission: 'read', handler(ctx: Context, payload, host) {
    exact(payload, ['id']); return jobsOf(host).meters(ctx, name(payload.id));
  } },
};
