import { audit, check, newId } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { digest, sourceAccess } from '../actions.ts';
import type { Job, JobService } from '../jobs.ts';
import type { MethodSpec, ModuleHost, SchedulerHost } from '../modules/types.ts';
import { lane, peekLane, pushTimeline, bound, inApp, isLaneJob, ownsJob, rupees, paise } from './state.ts';
import type { JobsExtState, LaneJob, TimelineEntry } from './state.ts';
import { TEMPLATES, template, skillFile } from './templates.ts';
import { validRule, coreCatchup, upcoming, ledgerMissed } from './catch-up.ts';
import { optionalCall, routePrice } from './adapters.ts';
import { availability, approveProposal, dismissProposal, proposeCard, proposeEdit, detect, visibleProposal, activeJobs, jobCap } from './proposals.ts';
import { runLaneJob, logResultDecision } from './run.ts';
import { purgeProcedures } from '../procedures/service.ts';

const jobsOf = (host: ModuleHost) => host.services.jobs as JobService;
const nowIso = (host: ModuleHost) => new Date(jobsOf(host).clock()).toISOString();
const id = (value: unknown, what = 'job') => { check(typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value), 'INVALID_REQUEST', `Name one ${what}.`); return value; };

function readable(host: ModuleHost, ctx: Context, job: Job): boolean { try { sourceAccess(host.store.read(), ctx, job.sourceIds); return true; } catch { return false; } }

/** A lane job the caller owns, with its lane record. */
function owned(host: ModuleHost, ctx: Context, jobId: unknown): { job: Job; meta: LaneJob } {
  const state = host.store.read(); const job = jobsOf(host).find(state, id(jobId));
  // The same release rule as JobService.list: the pinned owner, who can still read every source.
  check(ownsJob(ctx, job) && readable(host, ctx, job), 'NOT_FOUND', 'Job not found.');
  const meta = peekLane(state).jobs[job.id]; check(isLaneJob(job) && meta, 'NOT_LANE_JOB', 'This job is not run by the jobs lane.');
  return { job, meta };
}

/** release's wake status, reduced to what a screen draws. An unknown shape is not drawn as a time. */
function wakeView(value: any) {
  const next = typeof value?.nextWakeAt === 'string' && Number.isFinite(Date.parse(value.nextWakeAt)) ? value.nextWakeAt : null;
  return { available: value?.available === true, mechanism: typeof value?.mechanism === 'string' ? value.mechanism.slice(0, 60) : null, nextWakeAt: next,
    ...(typeof value?.reason === 'string' ? { reason: value.reason.slice(0, 300) } : {}), experimental: true };
}
/** The planned wake from `native.wake.status`; a missing method, an absent app service or a seat that may not read it says so by code. */
async function wakeStatus(host: ModuleHost) {
  try {
    const reply = await optionalCall<any>(host, 'native.wake.status', {});
    return reply.available ? wakeView(reply.value) : { available: false, code: 'WAKE_TIMER_UNAVAILABLE', nextWakeAt: null, experimental: true };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'SERVICE_UNAVAILABLE' || code === 'FORBIDDEN') return { available: false, code, nextWakeAt: null, experimental: true };
    throw error;
  }
}

/** One plain state per job for the Jobs list (WK-07). */
export function label(job: Job, meta: LaneJob | undefined, ns: JobsExtState): { state: string; reason?: string; resumesAt?: string } {
  if (meta?.setAside) return { state: 'set-aside', reason: meta.setAside.reason };
  if (meta?.waitingFor || ns.questions.some(q => q.jobId === job.id && q.status === 'open')) return { state: 'waiting-for-you' };
  if (job.status === 'awaiting-acceptance') return { state: 'result-waiting' };
  if (meta?.stoppedBy && job.status === 'paused') return { state: 'stopped-by-rule', reason: meta.stoppedBy.rule };
  const last = [...ns.timeline].reverse().find(t => t.jobId === job.id);
  if (job.status === 'scheduled' && last?.kind === 'waiting-network') return { state: 'waiting-network', resumesAt: job.nextRunAt };
  if (job.status === 'approval-blocked') return { state: 'waiting', reason: 'autonomy-off', resumesAt: job.nextRunAt };
  if (job.status === 'budget-blocked') return { state: 'stopped-by-rule', reason: 'budget' };
  return { state: job.status };
}

function view(host: ModuleHost, ctx: Context, job: Job, ns: JobsExtState) {
  const meta = ns.jobs[job.id]; const missed = [...ns.missed].reverse().find(m => m.jobId === job.id && !m.seen);
  return { id: job.id, title: meta ? template(meta.template).title : job.type === 'owner-brief' ? 'Owner brief' : job.goal.slice(0, 80), template: meta?.template ?? null, type: job.type ?? null,
    goal: job.goal, status: job.status, ...label(job, meta, ns), nextRunAt: job.nextRunAt, spentMinor: job.spentMinor, spent: rupees(job.spentMinor), budgetMinor: job.budgetMinor, budget: rupees(job.budgetMinor),
    missed: missed ? { text: missed.text, at: missed.at } : null, laneRun: !!meta, deleted: !!meta?.deletedAt };
}

async function ownedRun(host: ModuleHost, ctx: Context, payload: any) {
  const { job } = owned(host, ctx, payload.id); inApp(ctx); return runLaneJob(ctx, host, job.id);
}

function budgetView(host: ModuleHost, job: Job, ns: JobsExtState) {
  const lines = ns.timeline.filter(t => t.jobId === job.id && t.costMinor !== undefined);
  const routes = new Map<string, { costMinor: bigint; durationMs: number; estimate: boolean; steps: number }>();
  for (const line of lines.filter(l => l.routeId)) {
    const r = routes.get(line.routeId!) ?? { costMinor: 0n, durationMs: 0, estimate: false, steps: 0 };
    r.costMinor += BigInt(line.costMinor!); r.durationMs += line.durationMs ?? 0; r.estimate ||= line.costEstimate === true; r.steps++; routes.set(line.routeId!, r);
  }
  const spent = BigInt(job.spentMinor); const reserved = BigInt(job.reservedMinor); const budget = BigInt(job.budgetMinor);
  const remaining = budget - spent - reserved;
  const route = host.store.read().routes;
  return { jobId: job.id, budgetMinor: job.budgetMinor, budget: rupees(budget), spentMinor: job.spentMinor, spent: rupees(spent), reservedMinor: job.reservedMinor, remainingMinor: String(remaining), remaining: rupees(remaining),
    meters: {
      model: [...routes.entries()].map(([routeId, r]) => ({ routeId, costMinor: String(r.costMinor), cost: rupees(r.costMinor), steps: r.steps, minutes: Math.round(r.durationMs / 60000),
        basis: route.find((x: any) => x.id === routeId)?.kind === 'ollama' ? 'zero' : r.estimate ? 'estimate' : 'measured' })),
      clockMs: ns.timeline.filter(t => t.jobId === job.id).reduce((sum, t) => sum + (t.durationMs ?? 0), 0),
      exposureMinor: '0', exposure: 'No money exposure: this job’s actions touch no money.',
    } };
}

function stopRules(job: Job, meta: LaneJob, ns: JobsExtState, now: number) {
  const remaining = BigInt(job.budgetMinor) - BigInt(job.spentMinor) - BigInt(job.reservedMinor);
  return { jobId: job.id, rules: [
    { rule: 'runs', limit: job.stopRule.maxRuns, used: job.runs, met: job.runs >= job.stopRule.maxRuns },
    { rule: 'deadline', at: job.stopRule.deadline, met: now >= Date.parse(job.stopRule.deadline) },
    { rule: 'budget', budgetMinor: job.budgetMinor, spentMinor: job.spentMinor, met: remaining < BigInt(job.reserveMinor) },
    { rule: 'failures', limit: meta.failureLimit, count: meta.consecutiveFailures, met: !!meta.setAside },
    { rule: 'goal', text: template(meta.template).finishedWhen, met: job.status === 'accepted' },
  ], stoppedBy: meta.stoppedBy ?? null, setAside: meta.setAside ?? null };
}

function resultFor(host: ModuleHost, job: Job, ns: JobsExtState) {
  const result = [...ns.results].reverse().find(r => r.jobId === job.id);
  check(result, 'NO_RESULT', 'This job has not delivered a result yet.');
  const deliverable = job.deliverable as any;
  const current = job.status === 'awaiting-acceptance' && deliverable?.digest === result.digest;
  return { ...structuredClone(result), status: job.status, finishedOnlyWhenAccepted: true,
    reference: current ? { kind: 'job-acceptance', id: job.id, revision: job.revision, digest: job.digest, deliverableDigest: digest(job.deliverable) } : null };
}

export const jobsMethods: Record<string, MethodSpec> = {
  'jobsx.types': { permission: 'read', handler: async (ctx, _p, host) => ({ templates: await Promise.all(TEMPLATES.map(async t => ({ id: t.id, title: t.title, goal: t.goal, finishedWhen: t.finishedWhen, steps: t.steps, intervalMs: t.intervalMs, stepsPerDelivery: t.stepsPerDelivery,
    missedRule: t.missedRule, budgetMinor: t.budgetMinor, allowedActions: t.allowedActions, experimental: t.experimental === true, skillPath: skillFile(t).path, ...await availability(host, ctx, t) }))), activeJobs: activeJobs(host.store.read()), activeJobCap: jobCap(host, host.store.read()) }) },
  'jobsx.templateSkill': { permission: 'read', handler: (_ctx, p) => skillFile(template(p.id)) },
  'jobsx.propose': { permission: 'prepare', handler: (ctx, p, host) => { inApp(ctx, 'TAINTED_JOB'); return proposeCard(host, ctx, { template: p.template, sentence: p.sentence, overrides: p.overrides, skill: p.skill }); } },
  'jobsx.detect': { permission: 'prepare', handler: (ctx, _p, host) => { inApp(ctx, 'TAINTED_JOB'); return detect(host, ctx); } },
  'jobsx.proposals': { permission: 'read', handler: (ctx, _p, host) => peekLane(host.store.read()).proposals.filter(p => p.status === 'proposed' && (p.createdBy === ctx.memberId || p.card.ownerId === ctx.memberId)).reverse() },
  'jobsx.card': { permission: 'read', handler: (ctx, p, host) => {
    if (p.proposalId !== undefined) { const proposal = visibleProposal(host.store.read(), ctx, p.proposalId); return { card: proposal.card, digest: proposal.digest, proposal }; }
    const { meta } = owned(host, ctx, p.id); const proposal = peekLane(host.store.read()).proposals.find(x => x.id === meta.proposalId);
    check(proposal, 'NOT_FOUND', 'The card for this job was removed.'); return { card: proposal.card, digest: proposal.digest, missedRule: meta.missedRule, background: meta.background };
  } },
  'jobsx.approveProposal': { permission: 'approve', handler: (ctx, p, host) => approveProposal(host, ctx, p.id, p.digest) },
  'jobsx.dismissProposal': { permission: 'prepare', handler: (ctx, p, host) => { inApp(ctx); return dismissProposal(host, ctx, p.id); } },
  'jobsx.edit': { permission: 'approve', handler: (ctx, p, host) => { inApp(ctx); return proposeEdit(host, ctx, p.id, p.changes); } },
  'jobsx.list': { permission: 'read', handler: (ctx, _p, host) => {
    const state = host.store.read(); const ns = peekLane(state); const settings = ns.settings;
    const proposals = ns.proposals.filter(p => p.status === 'proposed' && p.card.ownerId === ctx.memberId).reverse().map(p => ({ proposalId: p.id, title: p.card.title, origin: p.origin, fromJobId: p.fromJobId ?? null, replacesJobId: p.replacesJobId ?? null, state: 'proposed', evidence: p.evidence, digest: p.digest }));
    const jobs = jobsOf(host).list(ctx).filter(job => !ns.jobs[job.id]?.deletedAt && (job.status !== 'stopped' || !!ns.jobs[job.id]?.stoppedBy)).map(job => view(host, ctx, job, ns));
    const active = activeJobs(state); const cap = jobCap(host, state);
    return { proposals, jobs, activeJobs: active, activeJobCap: cap, atLimit: active >= cap };
  } },
  'jobsx.get': { permission: 'read', handler: (ctx, p, host) => {
    const { job, meta } = owned(host, ctx, p.id); const ns = peekLane(host.store.read()); const tpl = template(meta.template);
    const questions = ns.questions.filter(q => q.jobId === job.id && q.status === 'open');
    const people = ns.personSteps.filter(s => s.jobId === job.id && s.status === 'waiting');
    const cases = Object.values(meta.cases);
    return { ...view(host, ctx, job, ns), facts: { goal: job.goal, progress: { stepsDone: meta.stepsDone, stepsPerDelivery: meta.stepsPerDelivery, casesOpen: cases.filter(c => !['done', 'paid', 'not-due'].includes(c.status)).length, casesClosed: cases.filter(c => ['done', 'paid', 'not-due'].includes(c.status)).length },
      budget: budgetView(host, job, ns), stops: job.stopRule.deadline }, steps: tpl.steps.map(s => ({ ...s, label: s.needsModel ? 'needs an AI model' : 'runs without one' })),
      waitingForYou: [...questions.map(q => ({ kind: 'question', ...q })), ...people.map(s => ({ kind: 'person-step', ...s }))],
      timeline: ns.timeline.filter(t => t.jobId === job.id).slice(-200).reverse(), next: { nextRunAt: job.nextRunAt, upcoming: upcoming(job.nextRunAt, job.intervalMs, job.stopRule.deadline, job.stopRule.maxRuns - job.runs) },
      tainted: cases.some(c => c.handledBy === 'agent') || meta.template === 'agent-task', stoppedBy: meta.stoppedBy ?? null, leftUndone: meta.stoppedBy?.leftUndone ?? [], testedRoutes: meta.testedRoutes, missedRule: meta.missedRule, background: meta.background };
  } },
  'jobsx.timeline': { permission: 'read', handler: (ctx, p, host) => {
    const state = host.store.read(); const ns = peekLane(state);
    const mine = new Set(jobsOf(host).list(ctx).map(job => job.id));
    if (p.id !== undefined) { const { job } = owned(host, ctx, p.id); return ns.timeline.filter(t => t.jobId === job.id).slice(-500).reverse(); }
    check(typeof p.recordId === 'string' && p.recordId.length > 0 && p.recordId.length <= 200, 'INVALID_REQUEST', 'Name a job or a business record.');
    return ns.timeline.filter(t => mine.has(t.jobId) && (t.recordIds?.includes(p.recordId) || t.caseId?.split(':')[0] === p.recordId)).slice(-500).reverse();
  } },
  'jobsx.result': { permission: 'read', handler: (ctx, p, host) => { const { job } = owned(host, ctx, p.id); return resultFor(host, job, peekLane(host.store.read())); } },
  'jobsx.accept': { permission: 'approve', handler: async (ctx, p, host) => {
    const { job } = owned(host, ctx, p.id); inApp(ctx, 'APP_ACCEPTANCE_REQUIRED');
    check(p.reference && typeof p.reference === 'object', 'INVALID_JOB_ACCEPTANCE_REFERENCE', 'Accept the exact result you reviewed: send its reference.');
    const accepted = await jobsOf(host).accept(ctx, job.id, p.repeat === true, p.reference);
    await host.store.update(state => {
      const ns = lane(state); const meta = ns.jobs[job.id];
      pushTimeline(ns, { id: newId('jobsx_line'), at: nowIso(host), jobId: job.id, run: 0, kind: 'accepted', text: 'You accepted the result. The job is finished for this round.' }); logResultDecision(state, ctx, job, 'accepted');
      // "Run every missed one": the next caught-up run follows straight after acceptance.
      const raw = jobsOf(host).find(state, job.id);
      if (meta && meta.backlog > 0 && raw.status === 'scheduled') { meta.backlog -= 1; raw.nextRunAt = nowIso(host); }
    });
    return accepted;
  } },
  'jobsx.reject': { permission: 'approve', handler: async (ctx, p, host) => {
    const { job } = owned(host, ctx, p.id); inApp(ctx, 'APP_ACCEPTANCE_REQUIRED');
    check(typeof p.reason === 'string' && p.reason.trim().length > 0 && p.reason.length <= 500, 'INVALID_REQUEST', 'Say in a sentence why you send it back.');
    const rejected = await jobsOf(host).reject(ctx, job.id, p.reason.trim());
    await host.store.update(state => { pushTimeline(lane(state), { id: newId('jobsx_line'), at: nowIso(host), jobId: job.id, run: 0, kind: 'rejected', text: 'You sent the result back. The job is paused until you resume it.' }); logResultDecision(state, ctx, job, 'rejected'); });
    return rejected;
  } },
  'jobsx.run': { permission: 'prepare', handler: (ctx, p, host) => ownedRun(host, ctx, p) },
  'jobsx.pause': { permission: 'approve', handler: (ctx, p, host) => { const { job } = owned(host, ctx, p.id); inApp(ctx); return jobsOf(host).pause(ctx, job.id); } },
  'jobsx.resume': { permission: 'approve', handler: async (ctx, p, host) => {
    const { job, meta } = owned(host, ctx, p.id); inApp(ctx);
    check(!meta.waitingFor, 'PERSON_STEP_WAITING', 'A step for a person is still waiting. Mark it done first.');
    await host.store.update(state => { const m = lane(state).jobs[job.id]; delete m.setAside; delete m.stoppedBy; m.consecutiveFailures = 0; });
    return jobsOf(host).resume(ctx, job.id);
  } },
  'jobsx.delete': { permission: 'approve', handler: async (ctx, p, host) => {
    const { job } = owned(host, ctx, p.id); inApp(ctx);
    const removed = await jobsOf(host).remove(ctx, job.id);
    await host.store.update(state => { const ns = lane(state); ns.jobs[job.id].deletedAt = nowIso(host); for (const q of ns.questions) if (q.jobId === job.id && q.status === 'open') q.status = 'withdrawn'; audit(state, 'jobsx.deleted', { jobId: job.id }); });
    return removed;
  } },
  'jobsx.answer': { permission: 'approve', handler: (ctx, p, host) => { inApp(ctx); return host.store.update(state => {
    const ns = lane(state); const q = ns.questions.find(x => x.id === id(p.questionId, 'question'));
    check(q, 'NOT_FOUND', 'Question not found.'); const job = jobsOf(host).find(state, q.jobId); check(ownsJob(ctx, job) && readable(host, ctx, job), 'NOT_FOUND', 'Question not found.');
    check(q.status === 'open', 'INVALID_QUESTION_STATE', 'This question was already answered.'); check(q.options.includes(p.option), 'INVALID_ANSWER', 'Choose one of the offered answers.');
    q.status = 'answered'; q.answer = p.option; q.answeredBy = ctx.memberId; q.answeredAt = nowIso(host);
    pushTimeline(ns, { id: newId('jobsx_line'), at: q.answeredAt, jobId: q.jobId, run: 0, kind: 'answer', text: 'You answered the job’s question. It uses your answer on its next step.', caseId: q.caseId });
    return structuredClone(q);
  }); } },
  'jobsx.personStep.done': { permission: 'approve', handler: async (ctx, p, host) => {
    inApp(ctx); let resume: string | undefined;
    const step = await host.store.update(state => {
      const ns = lane(state); const s = ns.personSteps.find(x => x.id === id(p.id, 'step'));
      check(s, 'NOT_FOUND', 'Step not found.'); const job = jobsOf(host).find(state, s.jobId); check(ownsJob(ctx, job) && readable(host, ctx, job), 'NOT_FOUND', 'Step not found.');
      check(s.status === 'waiting', 'INVALID_STEP_STATE', 'This step is already done.');
      s.status = 'done'; s.doneAt = nowIso(host); s.doneBy = ctx.memberId;
      const meta = ns.jobs[s.jobId]; if (meta?.waitingFor === s.id) { delete meta.waitingFor; resume = s.jobId; }
      pushTimeline(ns, { id: newId('jobsx_line'), at: s.doneAt, jobId: s.jobId, run: 0, kind: 'person-done', text: 'A person marked the step done.' });
      return structuredClone(s);
    });
    if (resume) await jobsOf(host).resume(ctx, resume);
    return step;
  } },
  'jobsx.consent.record': { permission: 'approve', handler: async (ctx, p, host) => { inApp(ctx);
    check(typeof p.customerId === 'string' && /^[A-Za-z0-9._\/-]{1,64}$/.test(p.customerId), 'INVALID_REQUEST', 'Name the customer by its reference.');
    check(p.channel === 'mail' || p.channel === 'whatsapp', 'INVALID_REQUEST', 'Choose mail or WhatsApp.');
    check(typeof p.agreed === 'boolean' && typeof p.source === 'string' && p.source.trim().length > 0 && p.source.length <= 200, 'INVALID_REQUEST', 'Say whether the customer agreed, and where that came from.');
    // One register: with work-books installed its customer record holds the agreement and the stop word, and
    // consentFor reads it first. The lane's own row below stays as history and as the register without work-books.
    const on = nowIso(host).slice(0, 10);
    const written = await optionalCall(host, 'records.setOptIn', { id: p.customerId, channel: p.channel, answer: p.agreed ? 'yes' : 'no', source: p.source.trim(), on });
    if (written.available && p.stopped === true) await host.call('records.stop', { id: p.customerId, on });
    return host.store.update(state => {
    const at = nowIso(host); const row = { customerId: p.customerId, channel: p.channel, agreed: p.agreed, source: p.source.trim(), at, ...(p.stopped === true ? { stoppedAt: at } : {}), sourceIds: [] as string[] };
    const ns = lane(state); ns.consent.push(row); bound(ns.consent, 5000); audit(state, 'jobsx.consent.recorded', { channel: p.channel, agreed: p.agreed, stopped: p.stopped === true });
    return row;
  }); } },
  'jobsx.missed': { permission: 'read', handler: (ctx, _p, host) => {
    const state = host.store.read(); const ns = peekLane(state); const mine = jobsOf(host).list(ctx);
    const lanes = ns.missed.filter(m => mine.some(j => j.id === m.jobId)).reverse();
    const core = mine.filter(j => !isLaneJob(j)).flatMap(j => ledgerMissed(j.ledger).map(item => ({ id: `${j.id}:${item.at}`, jobId: j.id, at: item.at, missed: item.missed, ran: 0, rule: 'skip', text: `${item.missed === 1 ? '1 run was' : `${item.missed} runs were`} missed while this computer slept. Skipped by the job’s rule.`, seen: (ns.seenCoreMissed ?? []).includes(`${j.id}:${item.at}`) })));
    return [...lanes, ...core].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
  } },
  'jobsx.missed.seen': { permission: 'prepare', handler: (ctx, p, host) => host.store.update(state => {
    check(Array.isArray(p.ids) && p.ids.length <= 200, 'INVALID_REQUEST', 'Name the notes you read.');
    const mine = new Set(jobsOf(host).list(ctx).map(j => j.id)); let count = 0;
    const ns = lane(state);
    for (const note of ns.missed) if (p.ids.includes(note.id) && mine.has(note.jobId) && !note.seen) { note.seen = true; count++; }
    // Core-run jobs' notes live in their ledgers; their read marks are kept here.
    for (const id of p.ids) if (typeof id === 'string' && id.length <= 300 && id.indexOf(':') > 0 && mine.has(id.slice(0, id.indexOf(':'))) && !(ns.seenCoreMissed ??= []).includes(id)) { ns.seenCoreMissed.push(id); count++; }
    if (ns.seenCoreMissed && ns.seenCoreMissed.length > 2000) ns.seenCoreMissed.splice(0, ns.seenCoreMissed.length - 2000);
    return { seen: count };
  }) },
  'jobsx.schedules': { permission: 'read', handler: (ctx, _p, host) => { const ns = peekLane(host.store.read());
    return jobsOf(host).list(ctx).filter(j => !ns.jobs[j.id]?.deletedAt).map(job => { const meta = ns.jobs[job.id]; const last = [...job.ledger].reverse().find(l => l.event === 'reserved');
      return { id: job.id, title: meta ? template(meta.template).title : job.goal.slice(0, 80), missedRule: meta?.missedRule ?? (job.catchup === 'skip' ? 'skip' : 'once'), ruleEditable: !!meta, lastRunAt: last?.at ?? null, nextRunAt: job.nextRunAt,
        upcoming: upcoming(job.nextRunAt, job.intervalMs, job.stopRule.deadline, job.stopRule.maxRuns - job.runs), background: meta?.background ?? job.background === true }; }); } },
  'jobsx.setMissedRule': { permission: 'approve', handler: (ctx, p, host) => { inApp(ctx); const rule = validRule(p.rule); return host.store.update(state => {
    const jobs = jobsOf(host); const job = jobs.find(state, id(p.id)); check(ownsJob(ctx, job) && isLaneJob(job), 'NOT_FOUND', 'Job not found.'); jobs.owner(state, ctx, job);
    check(!job.lease, 'JOB_BUSY', 'Wait for the running step to finish.');
    const meta = lane(state).jobs[job.id]; check(meta && !meta.deletedAt, 'NOT_FOUND', 'Job not found.');
    check(rule !== 'all' || meta.stepsPerDelivery === 1, 'MISSED_RULE_UNSUITABLE', 'Daily rounds cannot all be caught up on one day. Choose skip or run once.');
    meta.missedRule = rule; meta.backlog = 0; job.catchup = coreCatchup(rule); job.digest = jobs.identity(job);
    job.ledger.push({ at: nowIso(host), event: 'jobsx-missed-rule', reason: rule }); audit(state, 'jobsx.missed-rule.changed', { jobId: job.id, rule });
    return { id: job.id, missedRule: rule };
  }); } },
  'jobsx.background': { permission: 'read', handler: async (ctx, _p, host) => {
    const ns = peekLane(host.store.read()); const types = await host.call('jobs.types', {}).catch(() => null) as any;
    return { backgroundMode: ns.settings.backgroundMode, asked: ns.settings.backgroundAsked, lifecycle: types?.lifecycle ?? null,
      jobs: jobsOf(host).list(ctx).filter(j => ns.jobs[j.id] && !ns.jobs[j.id].deletedAt).map(j => ({ id: j.id, background: ns.jobs[j.id].background, runsWhileClosed: ns.settings.backgroundMode && ns.jobs[j.id].background })),
      rules: ['Scheduled jobs on the free app run only while this computer is awake.', 'With background mode off, closing the window pauses jobs; the next start lists what was missed.', 'Background mode is off until you turn it on.'],
      wake: await wakeStatus(host),
      alwaysOn: { available: false, note: 'Jobs that run while every laptop is closed need a server. A server cannot use your own command-line sign-in, so it needs an API key or the Chausar allowance, and it must read the data it works on, so that part is not end-to-end encrypted. A home box (a spare computer of yours running the same app) is the other way; it is experimental.' } };
  } },
  'jobsx.setBackground': { permission: 'admin', handler: (ctx, p, host) => { inApp(ctx); return host.store.update(state => {
    const ns = lane(state);
    if (p.enabled !== undefined) { check(typeof p.enabled === 'boolean', 'INVALID_REQUEST', 'Background mode is on or off.'); ns.settings.backgroundMode = p.enabled; ns.settings.backgroundAsked = true; }
    if (p.jobId !== undefined) { check(typeof p.job === 'boolean', 'INVALID_REQUEST', 'Say whether this job runs in background.'); const job = jobsOf(host).find(state, id(p.jobId)); check(ownsJob(ctx, job) && ns.jobs[job.id], 'NOT_FOUND', 'Job not found.'); ns.jobs[job.id].background = p.job; }
    audit(state, 'jobsx.background.changed', { enabled: ns.settings.backgroundMode }); return { backgroundMode: ns.settings.backgroundMode, asked: ns.settings.backgroundAsked };
  }); } },
  'jobsx.setWake': { permission: 'admin', handler: async (ctx, p, host) => {
    // The OS wake timer belongs to the release lane (native.wake.*). Its refusals pass through unchanged.
    inApp(ctx);
    check(Object.keys(p).every(k => ['at', 'clear', 'confirmed'].includes(k)) && (p.clear === undefined || p.clear === true) && (p.clear === true || typeof p.at === 'string' && p.at.length <= 40),
      'INVALID_REQUEST', 'Give the wake time, or ask to clear it.');
    const reply = p.clear === true ? await optionalCall<any>(host, 'native.wake.clear', { confirmed: p.confirmed })
      : await optionalCall<any>(host, 'native.wake.set', { at: p.at, confirmed: p.confirmed });
    check(reply.available, 'WAKE_TIMER_UNAVAILABLE', 'Waking this computer for jobs needs the operating-system timer, which is not installed yet.');
    return wakeView(reply.value);
  } },
  'jobsx.budget': { permission: 'read', handler: async (ctx, p, host) => {
    const ns = peekLane(host.store.read());
    if (p.id !== undefined) { const { job } = owned(host, ctx, p.id); return budgetView(host, job, ns); }
    const views = jobsOf(host).list(ctx).filter(j => ns.jobs[j.id]).map(job => budgetView(host, job, ns));
    const total = views.reduce((sum, v) => sum + BigInt(v.spentMinor), 0n);
    const prices = [];
    for (const routeId of [...new Set(views.flatMap(v => v.meters.model.map(m => m.routeId)))]) { try { prices.push(await routePrice(host, routeId)); } catch (error) { prices.push({ routeId, code: (error as any).code }); } }
    return { jobs: views, spentMinor: String(total), spent: rupees(total), prices };
  } },
  'jobsx.stopRules': { permission: 'read', handler: (ctx, p, host) => { const { job, meta } = owned(host, ctx, p.id); return stopRules(job, meta, peekLane(host.store.read()), jobsOf(host).clock()); } },
  'jobsx.setStopRules': { permission: 'approve', handler: (ctx, p, host) => { inApp(ctx); return host.store.update(state => {
    const job = jobsOf(host).find(state, id(p.id)); check(ownsJob(ctx, job), 'NOT_FOUND', 'Job not found.'); const meta = lane(state).jobs[job.id]; check(meta, 'NOT_LANE_JOB', 'This job is not run by the jobs lane.');
    check(Number.isSafeInteger(p.failures) && p.failures >= 1 && p.failures <= 10, 'INVALID_STOP_RULE', 'Set aside after one to ten failed runs in a row.');
    meta.failureLimit = p.failures; audit(state, 'jobsx.stop-rules.changed', { jobId: job.id }); return stopRules(job, meta, lane(state), jobsOf(host).clock());
  }); } },
};

/** Scheduled work for one owner: detection once a day, then each due lane job's next step. */
export async function jobsTick(ctx: Context, host: ModuleHost, scheduler: SchedulerHost): Promise<unknown[]> {
  const results: unknown[] = []; const jobs = jobsOf(host); const now = jobs.clock(); const today = new Date(now).toISOString().slice(0, 10);
  const ns = peekLane(host.store.read());
  // Proposals appear in jobsx.list as approvals; tick results report only job runs.
  if (ns.lastDetection?.[ctx.memberId] !== today) { try { await detect(host, ctx); } catch { /* a failed detection is tried again on the next tick */ } }
  for (const job of jobs.list(ctx)) {
    const meta = ns.jobs[job.id];
    if (!isLaneJob(job) || !meta || meta.deletedAt || meta.setAside) continue;
    if (!scheduler.windowOpen && !(ns.settings.backgroundMode && meta.background)) continue;
    const due = (['scheduled', 'approval-blocked'].includes(job.status) && Date.parse(job.nextRunAt) <= now) || (job.status === 'running' && job.lease && Date.parse(job.lease.expiresAt) <= now);
    if (!due) continue;
    try { results.push(await runLaneJob(ctx, host, job.id)); } catch (error) { results.push({ id: job.id, error: { code: (error as any).code ?? 'JOB_STEP_FAILED' } }); }
  }
  return results;
}

/**
 * Retention: records older than the workspace retention period go, except what a live job still needs
 * (open questions, waiting steps, undecided proposals and the cases of a delivery in progress).
 */
function retention(state: State, cutoff: number | undefined): number {
  if (cutoff === undefined) return 0;
  const ns = lane(state); const old = (at: string | undefined) => !at || !Number.isFinite(Date.parse(at)) || Date.parse(at) < cutoff; let removed = 0;
  const keep = <T>(list: T[], drop: (item: T) => boolean): T[] => list.filter(item => { const d = drop(item); if (d) removed++; return !d; });
  ns.timeline = keep(ns.timeline, t => old(t.at));
  ns.results = keep(ns.results, r => old(r.deliveredAt));
  ns.questions = keep(ns.questions, q => q.status !== 'open' && old(q.answeredAt ?? q.askedAt));
  ns.personSteps = keep(ns.personSteps, p => p.status === 'done' && old(p.doneAt ?? p.createdAt));
  ns.missed = keep(ns.missed, m => old(m.at));
  ns.proposals = keep(ns.proposals, p => p.status !== 'proposed' && old(p.decidedAt ?? p.createdAt));
  ns.reminders = keep(ns.reminders, r => old(`${r.day}T23:59:59.999Z`));
  ns.autonomy.runs = keep(ns.autonomy.runs, r => old(r.at));
  ns.consent = keep(ns.consent, c => old(c.at));
  return removed;
}

/** Source deletion removes everything this lane derived from that source. */
export function jobsPurge(state: State, reason: { sourceIds: readonly string[]; removedIds: ReadonlySet<string>; cutoff?: number }): number {
  if (!state.extensions?.['jobs-ext']) return 0;
  const retained = retention(state, reason.cutoff);
  const ns = lane(state); const sources = new Set(reason.sourceIds); let removed = 0;
  const hit = (ids: readonly string[] | undefined) => (ids ?? []).some(x => sources.has(x) || reason.removedIds.has(x));
  const liveJobs = new Set(state.jobs.map((j: any) => j.id));
  const goneJobs = new Set(Object.values(ns.jobs).filter(m => !liveJobs.has(m.jobId) || hit(m.sourceIds)).map(m => m.jobId));
  for (const jobId of goneJobs) { delete ns.jobs[jobId]; removed++; }
  const goneCases = new Set<string>();
  for (const meta of Object.values(ns.jobs)) for (const [key, item] of Object.entries(meta.cases)) if (hit(item.recordIds) || hit(item.receiptIds)) { delete meta.cases[key]; goneCases.add(`${meta.jobId}/${key}`); removed++; }
  // Lines that name a removed case go too, and the left-undone list is rebuilt from what remains.
  for (const meta of Object.values(ns.jobs)) if (meta.stoppedBy && [...goneCases].some(c => c.startsWith(`${meta.jobId}/`))) meta.stoppedBy.leftUndone = [];
  const caseHit = (jobId: string, caseId?: string) => !!caseId && goneCases.has(`${jobId}/${caseId}`);
  const keep = <T>(list: T[], drop: (item: T) => boolean): T[] => list.filter(item => { const d = drop(item); if (d) removed++; return !d; });
  ns.proposals = keep(ns.proposals, p => hit(p.sourceIds) || (!!p.jobId && goneJobs.has(p.jobId)));
  ns.timeline = keep(ns.timeline, (t: TimelineEntry) => goneJobs.has(t.jobId) || hit(t.recordIds) || hit(t.receiptIds) || caseHit(t.jobId, t.caseId));
  ns.results = keep(ns.results, r => goneJobs.has(r.jobId) || hit(r.sourceIds) || hit(r.receiptIds));
  ns.questions = keep(ns.questions, q => goneJobs.has(q.jobId) || hit(q.sourceIds) || caseHit(q.jobId, q.caseId));
  ns.personSteps = keep(ns.personSteps, s => goneJobs.has(s.jobId) || hit(s.recordIds));
  ns.missed = keep(ns.missed, m => goneJobs.has(m.jobId));
  // A customer's agreement is kept only while a live record still names that customer.
  const customers = new Set(state.facts.filter((f: any) => !f.deletedAt && !sources.has(f.sourceId) && !reason.removedIds.has(f.id)).map((f: any) => f.fields?.customerId).filter(Boolean));
  const scoped = sources.size > 0 || reason.removedIds.size > 0;
  ns.consent = keep(ns.consent, c => hit(c.sourceIds) || (scoped && !customers.has(c.customerId)));
  const liveActions = new Set(state.actions.map((a: any) => a.id));
  ns.reminders = keep(ns.reminders, r => goneJobs.has(r.jobId) || !liveActions.has(r.actionId));
  return retained + removed + purgeProcedures(state, reason.sourceIds, { jobIds: goneJobs, caseIds: goneCases, ...(reason.cutoff === undefined ? {} : { before: reason.cutoff }) });
}

export { paise };
