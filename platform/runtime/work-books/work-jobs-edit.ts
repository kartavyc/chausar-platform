/**
 * Changing a job (WK-07, WK-08, WK-11, WK-16): Edit, Delete, the missed-run rule and marking a
 * person's step done. A lane job (core type `jobsx-<template>`) goes to jobs-ext when the method
 * is installed, in jobs-ext's own request shapes (`platform/runtime/jobs-ext/methods.ts`):
 *
 *  - `jobsx.edit { id, changes }` proposes an edit: a new card that waits for approval in the
 *    proposals list; approving it replaces the job. Its `changes` are card overrides
 *    (`budgetMinor`, `reserveMinor`, `missedRule`, ...); the most runs is not one of them.
 *  - `jobsx.setMissedRule { id, rule }` with `rule` `skip | once | all`, applied at once. "all"
 *    is refused `MISSED_RULE_UNSUITABLE` for a job of daily rounds.
 *  - `jobsx.delete { id }` removes the job (`jobs.remove`).
 *  - `jobsx.personStep.done { id }` with the step's id.
 *
 * A core job keeps the core paths: a typed job (one with a core plan) is amended with
 * `jobs.amend`, its calendar revised with `jobs.calendar.configure`; Delete falls back to
 * `jobs.cancel`, which stops the job and keeps its record. Anything else refuses with a typed
 * "not built" code. Every core change makes a new revision that waits for a new approval.
 */
import { check, ChausarError } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import type { Job } from '../jobs.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { env, nowMs, isoAt, parseId, visibleJobs } from './work-queue.ts';
import type { Env } from './work-queue.ts';
import { installed, isLaneJob, jobsxView, laneMethod, personSteps, TO_JOBSX } from './work-jobs-sheet.ts';
import type { MissedRun } from './work-jobs-sheet.ts';

type Edit = { budgetMinor?: string; maxRuns?: number; missedRun?: MissedRun };
const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const PAISE = /^[1-9]\d{0,17}$/;
const TERMINAL = ['cancelled', 'stopped', 'accepted', 'revoked'];
const RULES: readonly MissedRun[] = ['skip', 'run-once-on-wake', 'run-all'];
/** A missed calendar run is skipped after six hours; run-once-on-wake coalesces missed runs into one. */
export const SKIP_GRACE_MS = 6 * 3_600_000;

function exact(payload: unknown, required: string[], optional: string[] = []): asserts payload is Record<string, any> {
  check(record(payload) && required.every(k => Object.hasOwn(payload, k)) && Object.keys(payload).every(k => required.includes(k) || optional.includes(k)), 'INVALID_JOB_CHANGE', 'Use only the declared request fields.');
}
const rawId = (value: unknown) => {
  check(typeof value === 'string' && value.length > 0 && value.length <= 200, 'INVALID_JOB_CHANGE', 'Use a job id.');
  return /^(job|acceptance):/.test(value) ? parseId(value).raw : value;
};
function missedRule(value: unknown): MissedRun {
  check(typeof value === 'string' && (RULES as readonly string[]).includes(value), 'INVALID_SCHEDULE', 'A missed run is skipped, run once on wake, or every missed one is run.');
  return value as MissedRun;
}
/** "Run every missed one" exists only in jobs-ext; the core coalesces or skips. */
const coreRule = (rule: MissedRun): 'skip' | 'run-once-on-wake' => {
  check(rule !== 'run-all', 'MISSED_RULE_NOT_BUILT', 'Running every missed one is offered only for jobs run by job extensions.');
  return rule as 'skip' | 'run-once-on-wake';
};
function editOf(config: unknown): Edit {
  exact(config, [], ['budgetMinor', 'maxRuns', 'missedRun']);
  check(Object.keys(config).length > 0, 'INVALID_JOB_CHANGE', 'Change the budget, the most runs or the missed-run rule.');
  const out: Edit = {};
  if (Object.hasOwn(config, 'budgetMinor')) { check(typeof config.budgetMinor === 'string' && PAISE.test(config.budgetMinor), 'INVALID_BUDGET', 'The budget is whole paise, more than zero.'); out.budgetMinor = config.budgetMinor; }
  if (Object.hasOwn(config, 'maxRuns')) { check(Number.isSafeInteger(config.maxRuns) && config.maxRuns >= 1 && config.maxRuns <= 366, 'STOP_RULE_REQUIRED', 'Allow 1 to 366 runs.'); out.maxRuns = config.maxRuns; }
  if (Object.hasOwn(config, 'missedRun')) out.missedRun = missedRule(config.missedRun);
  return out;
}

/** The job as the caller may see it, and as stored (the owner's full objective is needed to amend it). */
function findJob(e: Env, raw: string): { view: Job; stored: Job } {
  const view = visibleJobs(e).find(j => j.id === raw); check(view, 'NOT_FOUND', 'Job not found.');
  return { view, stored: (e.state.jobs as Job[]).find(j => j.id === raw)! };
}

/**
 * jobs-ext card overrides for an edit. The reservation is kept unless the new budget is below
 * it (jobs-ext refuses a reservation above the budget). The most runs is fixed by the ready-made card.
 */
function laneChanges(stored: Job, edit: Edit): Record<string, unknown> {
  check(edit.maxRuns === undefined, 'JOB_EDIT_FIELD_NOT_BUILT', 'This job takes its most runs from its ready-made card. Change the budget or the missed-run rule.');
  const changes: Record<string, unknown> = {};
  if (edit.budgetMinor !== undefined) {
    changes.budgetMinor = edit.budgetMinor;
    if (BigInt(stored.reserveMinor) > BigInt(edit.budgetMinor)) changes.reserveMinor = edit.budgetMinor;
  }
  if (edit.missedRun !== undefined) changes.missedRule = TO_JOBSX[edit.missedRun];
  return changes;
}

/** Core amendment of a typed job: the whole objective again, with only the edited fields changed. */
async function coreAmend(host: ModuleHost, stored: Job, edit: Edit) {
  const budgetMinor = edit.budgetMinor ?? stored.budgetMinor;
  const reserveMinor = BigInt(stored.reserveMinor) <= BigInt(budgetMinor) ? stored.reserveMinor : budgetMinor;
  await host.call('jobs.amend', { id: stored.id, config: {
    type: stored.type, goal: stored.goal, input: stored.input, limits: stored.limits, budgetMinor, reserveMinor,
    stopRule: { maxRuns: edit.maxRuns ?? stored.stopRule.maxRuns, deadline: stored.stopRule.deadline },
    sourceIds: stored.sourceIds, allowedActions: stored.allowedActions ?? [], testedRoutes: stored.testedRoutes ?? [], background: stored.background ?? false,
    ...(!stored.calendar && edit.missedRun ? { catchup: coreRule(edit.missedRun) === 'skip' ? 'skip' : 'latest' } : {}),
  } });
}
/** A calendar's missed-run rule is part of its definition: revised from a minute ahead, as core requires. */
async function coreCalendarMissed(host: ModuleHost, raw: string, rule: 'skip' | 'run-once-on-wake') {
  const job = (host.store.read().jobs as Job[]).find(j => j.id === raw)!;
  const c = job.calendar!;
  const definition = { ...structuredClone(c.definition), effectiveFrom: isoAt(nowMs(host) + 60_000), missed: rule === 'skip' ? { kind: 'skip', graceMs: SKIP_GRACE_MS } : { kind: 'coalesce' } };
  await host.call('jobs.calendar.configure', { id: raw, definition, expectedScheduleRevision: c.revision, expectedObjectiveRevision: job.revision, replacement: 'replace-immediately' });
}
async function applyCore(host: ModuleHost, stored: Job, edit: Edit) {
  if (edit.missedRun !== undefined) coreRule(edit.missedRun);
  if (edit.budgetMinor !== undefined || edit.maxRuns !== undefined || (edit.missedRun !== undefined && !stored.calendar)) await coreAmend(host, stored, edit);
  if (edit.missedRun !== undefined && stored.calendar) await coreCalendarMissed(host, stored.id, coreRule(edit.missedRun));
}

/** The proposal `jobsx.edit` returns (`Proposal`: `{ id, digest, status: 'proposed', origin: 'edit', replacesJobId, ... }`). */
function proposalOf(value: unknown, raw: string): { id: string; digest: string } {
  check(record(value) && typeof value.id === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value.id) && typeof value.digest === 'string' && value.digest.length >= 8 && value.digest.length <= 200
    && value.status === 'proposed' && (value.replacesJobId === undefined || value.replacesJobId === raw), 'INVALID_JOB_REPLY', 'The proposed edit could not be read back.');
  return { id: value.id, digest: value.digest };
}

export const workJobEditMethods: Readonly<Record<string, MethodSpec>> = {
  /**
   * Edit a job. A lane job's edit is proposed through `jobsx.edit` as a new card that waits for
   * approval in the proposals list (`approvals.jobs` `proposals.items`); the job keeps its current
   * card until then. A core change makes a new revision that waits for approval in the queue.
   */
  'approvals.editJob': { permission: 'approve', async handler(ctx, payload, host) {
    exact(payload, ['id', 'config']); const raw = rawId(payload.id); const edit = editOf(payload.config);
    const e = await env(ctx, host); const { view, stored } = findJob(e, raw);
    check(!TERMINAL.includes(view.status), 'INVALID_JOB_STATE', 'A finished job cannot be changed.');
    if (await laneMethod(host, view, 'jobsx.edit')) {
      const proposal = proposalOf(await host.call('jobsx.edit', { id: raw, changes: laneChanges(stored, edit) }), raw);
      return { id: `job:${raw}`, via: 'jobsx' as const, waitsFor: 'proposal' as const, proposal };
    }
    if (!stored.plan) throw new ChausarError('JOB_EDIT_NOT_BUILT', 'Editing this job is not built yet.');
    await applyCore(host, stored, edit);
    return { id: `job:${raw}`, via: 'core' as const, waitsFor: 'approval' as const, proposal: null };
  } },
  /** Delete a job. A lane job is removed by jobs-ext; otherwise this cancels it: it stops, and its record is kept. */
  'approvals.deleteJob': { permission: 'approve', async handler(ctx, payload, host) {
    exact(payload, ['id']); const raw = rawId(payload.id);
    const e = await env(ctx, host); const { view } = findJob(e, raw);
    if (await laneMethod(host, view, 'jobsx.delete')) { await host.call('jobsx.delete', { id: raw }); return { id: raw, state: 'deleted' as const, note: null }; }
    check(!TERMINAL.includes(view.status), 'INVALID_JOB_STATE', 'This job has already stopped.');
    await host.call('jobs.cancel', { id: raw });
    return { id: raw, state: 'cancelled' as const, note: 'cancel-keeps-record' as const };
  } },
  /**
   * WK-11: the rule for a run missed while this computer slept. A lane job's rule is set by
   * `jobsx.setMissedRule` and applies at once; a core change waits for a new approval.
   */
  'approvals.setMissedRule': { permission: 'approve', async handler(ctx, payload, host) {
    exact(payload, ['id', 'rule']); const raw = rawId(payload.id); const rule = missedRule(payload.rule);
    const e = await env(ctx, host); const { view, stored } = findJob(e, raw);
    check(!TERMINAL.includes(view.status), 'INVALID_JOB_STATE', 'A finished job cannot be changed.');
    if (await laneMethod(host, view, 'jobsx.setMissedRule')) {
      const reply = await host.call('jobsx.setMissedRule', { id: raw, rule: TO_JOBSX[rule] });
      check(record(reply) && reply.missedRule === TO_JOBSX[rule], 'INVALID_JOB_REPLY', 'The missed-run rule could not be read back.');
      return { id: `job:${raw}`, missedRun: rule, via: 'jobsx' as const, waitsForApproval: false };
    }
    if (!stored.plan) throw new ChausarError('MISSED_RULE_NOT_BUILT', 'Changing the missed-run rule of this job is not built yet.');
    await applyCore(host, stored, { missedRun: rule });
    return { id: `job:${raw}`, missedRun: rule, via: 'core' as const, waitsForApproval: true };
  } },
  /**
   * WK-16: a person says their step is done. Only jobs-ext records it (`jobsx.personStep.done
   * { id: <step id> }`), and only for the job's pinned owner; the job waits until then and never
   * marks the step done by itself. The reply is jobs-ext's step record read back.
   */
  'approvals.personStepDone': { permission: 'approve', async handler(ctx: Context, payload, host) {
    exact(payload, ['jobId', 'stepId']); const raw = rawId(payload.jobId);
    check(typeof payload.stepId === 'string' && payload.stepId.length > 0 && payload.stepId.length <= 200, 'INVALID_JOB_CHANGE', 'Name the step.');
    const e = await env(ctx, host); const { view } = findJob(e, raw);
    const step = personSteps(e, view, await jobsxView(host, view), true).find(s => s.stepId === payload.stepId);
    check(step, 'NOT_FOUND', 'Step not found.');
    check(!step.done, 'PERSON_STEP_ALREADY_DONE', 'This step is already done.');
    check(step.canDone, 'PERSON_STEP_NOT_YOURS', 'This step belongs to someone else.');
    if (!isLaneJob(view) || !(await installed(host, 'jobsx.personStep.done'))) throw new ChausarError('PERSON_STEP_NOT_BUILT', 'Marking a step done is not built yet.');
    const back = await host.call('jobsx.personStep.done', { id: step.stepId });
    check(record(back) && back.id === step.stepId && back.jobId === raw, 'INVALID_JOB_REPLY', 'The step could not be read back.');
    const iso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
    // jobs-ext records the member id; the reply names the member.
    const by = typeof back.doneBy === 'string' ? e.state.members.find(m => m.id === back.doneBy)?.name ?? back.doneBy : null;
    return { jobId: raw, stepId: step.stepId, done: back.status === 'done', doneAt: iso(back.doneAt), doneBy: by };
  } },
};
