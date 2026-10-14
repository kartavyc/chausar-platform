/**
 * Jobs Chausar proposes, and jobs you start from a ready-made card or one sentence.
 * A proposal is a card (WK-09) with an exact digest. Approving that exact card creates the
 * JobService mandate. A job cannot create another job: its request becomes a proposal that
 * waits for the owner's yes, like every other. Edits are new proposals that replace the job.
 */
import { audit, check, newId } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { digest } from '../actions.ts';
import type { Job, JobService } from '../jobs.ts';
import type { ModuleHost } from '../modules/types.ts';
import { moduleMethods } from '../modules/registry.ts';
import { visibleFacts } from '../trust.ts';
import { lane, peekLane, pushTimeline, inApp, paise, dayOf, isLaneJob, ownsJob, LANE_JOB_PREFIX } from './state.ts';
import type { JobCard, LaneJob, MissedRule, Proposal } from './state.ts';
import { template, matchSentence, DAY_MS, type JobTemplate } from './templates.ts';
import { coreCatchup, validRule } from './catch-up.ts';
import { agentOf } from './run.ts';

const TERMINAL = ['accepted', 'cancelled', 'revoked', 'stopped'];
const jobsOf = (host: ModuleHost) => host.services.jobs as JobService;
const nowIso = (host: ModuleHost) => new Date(jobsOf(host).clock()).toISOString();

export type CardOverrides = { budgetMinor?: string; reserveMinor?: string; nextRunAt?: string; missedRule?: MissedRule; testedRoutes?: string[]; background?: boolean; sourceIds?: string[] };

/** Whether this workspace can run the template now, and why not. */
export function availability(host: ModuleHost, ctx: Context, tpl: JobTemplate): { available: boolean; code?: string; reason?: string } {
  if (tpl.requires.operations.length) {
    const dictionary = host.services.ontology.current(ctx);
    if (!dictionary) return { available: false, code: 'DICTIONARY_REQUIRED', reason: 'Publish your business meanings first.' };
    const missing = tpl.requires.operations.filter(op => !dictionary.operations.some((item: any) => item.id === op));
    if (missing.length) return { available: false, code: 'TEMPLATE_CALCULATION_MISSING', reason: 'Your published meanings have no calculation this job needs.' };
  }
  if (tpl.requires.method && !moduleMethods.has(tpl.requires.method)) return { available: false, code: 'TEMPLATE_NOT_BUILT', reason: 'This job needs a part of Chausar that is not built yet.' };
  if (tpl.caseSource === 'goal' && !agentOf(host)) return { available: false, code: 'AGENT_ROUTE_REQUIRED', reason: 'A job in your own words needs an installed agent route. None is installed.' };
  return { available: true };
}

function overrides(value: unknown): CardOverrides {
  if (value === undefined) return {};
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => ['budgetMinor', 'reserveMinor', 'nextRunAt', 'missedRule', 'testedRoutes', 'background', 'sourceIds'].includes(k)), 'INVALID_JOB_CARD', 'Only the card’s budget, start, missed-run rule, routes, background mode and sources can be set.');
  const o = value as CardOverrides;
  if (o.budgetMinor !== undefined) paise(o.budgetMinor); if (o.reserveMinor !== undefined) paise(o.reserveMinor);
  if (o.nextRunAt !== undefined) check(typeof o.nextRunAt === 'string' && Number.isFinite(Date.parse(o.nextRunAt)), 'INVALID_SCHEDULE', 'Give a valid start time.');
  if (o.missedRule !== undefined) validRule(o.missedRule);
  for (const key of ['testedRoutes', 'sourceIds'] as const) if (o[key] !== undefined) check(Array.isArray(o[key]) && o[key]!.length <= 50 && o[key]!.every(v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(v)), 'INVALID_JOB_CARD', 'Name routes and sources by their identifiers.');
  if (o.background !== undefined) check(typeof o.background === 'boolean', 'INVALID_JOB_CARD', 'Background mode is on or off.');
  return o;
}

export function buildCard(host: ModuleHost, ctx: Context, tpl: JobTemplate, goal: string, o: CardOverrides, flags: { untrusted?: boolean } = {}): JobCard {
  const at = jobsOf(host).clock(); const ns = peekLane(host.store.read());
  const budget = o.budgetMinor ?? tpl.budgetMinor; const reserve = o.reserveMinor ?? tpl.reserveMinor;
  check(BigInt(budget) > 0n && BigInt(reserve) > 0n && BigInt(reserve) <= BigInt(budget), 'INVALID_BUDGET', 'A positive reservation must fit within the budget.');
  const sourceIds = [...new Set(o.sourceIds ?? visibleFacts(host.store, ctx).map(f => f.sourceId))].sort();
  const agent = agentOf(host);
  const needsModel = tpl.steps.some(s => s.needsModel);
  const card: JobCard = {
    template: tpl.id, title: tpl.title, goal, finishedWhen: tpl.finishedWhen, ownerId: ctx.memberId,
    budgetMinor: budget, reserveMinor: reserve, stopRule: { maxRuns: tpl.maxRuns, deadline: new Date(at + tpl.durationDays * DAY_MS).toISOString() },
    extraStopRules: { failures: ns.settings.failureLimit },
    intervalMs: tpl.intervalMs, nextRunAt: o.nextRunAt ?? new Date(at).toISOString(), missedRule: o.missedRule ?? tpl.missedRule, stepsPerDelivery: tpl.stepsPerDelivery,
    allowedActions: [...tpl.allowedActions], testedRoutes: [...new Set(o.testedRoutes ?? (needsModel && agent ? [agent.routeId] : []))].sort(),
    reviewDate: dayOf(new Date(at + tpl.durationDays * DAY_MS).toISOString()), computer: 'this-computer',
    background: (o.background ?? false) === true, steps: tpl.steps.map(s => ({ ...s })), sourceIds,
  };
  if (flags.untrusted) card.untrustedInstructions = true;
  return card;
}

/** Creates a proposal. Nothing runs until the owner approves this exact card. */
export async function proposeCard(host: ModuleHost, ctx: Context, input: { template?: unknown; sentence?: unknown; overrides?: unknown; origin?: Proposal['origin']; fromJobId?: string; replacesJobId?: string; evidence?: string[]; skill?: unknown }): Promise<Proposal> {
  const origin = input.origin ?? 'person';
  let tpl: JobTemplate; let goal: string; let untrusted = false;
  if (input.skill !== undefined) {
    // An imported skill is outside text: instructions only, no tools, untrusted.
    check(typeof input.skill === 'string' && input.skill.length > 0 && input.skill.length <= 20000, 'INVALID_SKILL', 'Give the skill file’s text.');
    tpl = template('agent-task'); untrusted = true;
    const name = /^name:\s*([A-Za-z0-9 _-]{1,80})$/m.exec(input.skill)?.[1]?.trim();
    goal = `Follow the imported skill${name ? ` “${name}”` : ''} as instructions only, with no tools.`;
  } else if (input.template !== undefined) { tpl = template(input.template); goal = tpl.goal || String(input.sentence ?? '').trim(); }
  else { check(typeof input.sentence === 'string', 'INVALID_GOAL', 'Choose a ready-made job or describe one in a sentence.'); const match = matchSentence(input.sentence); tpl = match.template; goal = tpl.goal || input.sentence.trim(); }
  check(goal.length >= 5 && goal.length <= 2000, 'INVALID_GOAL', 'A job needs a concrete goal.');
  const card = buildCard(host, ctx, tpl, goal, overrides(input.overrides), { untrusted });
  const evidence = (input.evidence ?? []).slice(0, 10);
  return host.store.update(state => {
    const ns = lane(state);
    if (input.fromJobId) {
      const parent = state.jobs.find((j: any) => j.id === input.fromJobId);
      check(parent && isLaneJob(parent), 'NOT_FOUND', 'Job not found.');
      check(ns.proposals.filter(p => p.fromJobId === input.fromJobId && p.status === 'proposed').length < 3, 'JOB_PROPOSAL_LIMIT', 'This job already asked for other jobs. They wait for your answer.');
    }
    const proposal: Proposal = { id: newId('jobsx_proposal'), createdAt: new Date(jobsOf(host).clock()).toISOString(), createdBy: ctx.memberId, origin,
      ...(input.fromJobId ? { fromJobId: input.fromJobId } : {}), ...(input.replacesJobId ? { replacesJobId: input.replacesJobId } : {}),
      template: tpl.id, ...(typeof input.sentence === 'string' ? { sentence: input.sentence.trim().slice(0, 500) } : {}), card, digest: digest(card), status: 'proposed', evidence, sourceIds: card.sourceIds };
    ns.proposals.push(proposal); if (ns.proposals.length > 500) ns.proposals.splice(0, ns.proposals.length - 500);
    if (input.fromJobId) pushTimeline(ns, { id: newId('jobsx_line'), at: proposal.createdAt, jobId: input.fromJobId, run: 0, kind: 'note', text: 'This job asked to create another job. It waits for your yes.', code: 'JOB_CREATES_JOB' });
    audit(state, 'jobsx.proposed', { proposalId: proposal.id, template: tpl.id, origin });
    return structuredClone(proposal);
  });
}

export function visibleProposal(state: State, ctx: Context, id: unknown): Proposal {
  const proposal = peekLane(state).proposals.find(p => p.id === id);
  check(proposal && (proposal.createdBy === ctx.memberId || proposal.card.ownerId === ctx.memberId), 'NOT_FOUND', 'Proposal not found.');
  return proposal;
}

export function activeJobs(state: State): number {
  return state.jobs.filter((job: Job) => !TERMINAL.includes(job.status) || job.execution?.attempts.some(a => ['dispatched', 'unknown'].includes(a.status))).length;
}

/** Approve this exact card: creates the mandate, and replaces the job it edits. */
export async function approveProposal(host: ModuleHost, ctx: Context, id: unknown, expectedDigest: unknown): Promise<{ proposal: Proposal; job: Job }> {
  inApp(ctx); const jobs = jobsOf(host);
  const proposal = visibleProposal(host.store.read(), ctx, id);
  check(proposal.status === 'proposed', 'INVALID_PROPOSAL_STATE', 'This proposal was already decided.');
  check(proposal.card.ownerId === ctx.memberId, 'JOB_OWNER_REQUIRED', 'Only the job’s owner approves its card.');
  check(expectedDigest === proposal.digest && digest(proposal.card) === proposal.digest, 'PREVIEW_CHANGED', 'The card changed. Review it again.');
  const tpl = template(proposal.template); const ready = availability(host, ctx, tpl);
  check(ready.available, ready.code ?? 'TEMPLATE_NOT_BUILT', ready.reason ?? 'This job cannot run here yet.');
  const state = host.store.read(); const settings = peekLane(state).settings;
  if (proposal.replacesJobId) {
    const old = jobs.find(state, proposal.replacesJobId); check(ownsJob(ctx, old), 'JOB_OWNER_REQUIRED', 'Only the job’s owner edits it.');
    check(!old.lease && old.status !== 'awaiting-acceptance', 'JOB_RESULT_WAITING', 'Accept or send back the job’s result, and let a running step finish, before you change it.');
  }
  check(activeJobs(state) - (proposal.replacesJobId ? 1 : 0) < settings.activeJobCap, 'ACTIVE_JOB_LIMIT', 'The limit of active jobs is reached. Pause or delete one first.');
  const card = proposal.card;
  const created = await jobs.create(ctx, { type: `${LANE_JOB_PREFIX}${card.template}`, goal: card.goal, budgetMinor: card.budgetMinor, reserveMinor: card.reserveMinor,
    stopRule: card.stopRule, nextRunAt: card.nextRunAt, intervalMs: card.intervalMs, catchup: coreCatchup(card.missedRule), graceMs: Math.min(card.intervalMs, 600_000),
    requiresApproval: false, sourceIds: card.sourceIds });
  if (proposal.replacesJobId) await jobs.remove(ctx, proposal.replacesJobId);
  return host.store.update(state => {
    const ns = lane(state); const p = ns.proposals.find(item => item.id === proposal.id)!;
    check(p.status === 'proposed' && p.digest === proposal.digest, 'PREVIEW_CHANGED', 'The card changed. Review it again.');
    p.status = 'approved'; p.decidedAt = new Date(jobs.clock()).toISOString(); p.jobId = created.id;
    const meta: LaneJob = { jobId: created.id, template: card.template, createdAt: p.decidedAt, proposalId: p.id, missedRule: card.missedRule, stepsPerDelivery: card.stepsPerDelivery, stepsDone: 0, backlog: 0,
      failureLimit: card.extraStopRules.failures, consecutiveFailures: 0, testedRoutes: card.testedRoutes, sourceIds: card.sourceIds, cases: {}, background: card.background, approvedDigest: p.digest,
      ...(p.replacesJobId ? { replaces: p.replacesJobId } : {}) };
    ns.jobs[created.id] = meta;
    const raw = jobsOf(host).find(state, created.id); raw.testedRoutes = [...card.testedRoutes]; raw.allowedActions = [...card.allowedActions]; raw.digest = jobsOf(host).identity(raw);
    if (p.replacesJobId && ns.jobs[p.replacesJobId]) { ns.jobs[p.replacesJobId].replacedBy = created.id; ns.jobs[p.replacesJobId].deletedAt = p.decidedAt; }
    pushTimeline(ns, { id: newId('jobsx_line'), at: p.decidedAt, jobId: created.id, run: 0, kind: 'note', text: p.replacesJobId ? 'You approved the changed card. It replaces the earlier job.' : 'You approved this job’s card. It runs within its budget and stop rule.' });
    audit(state, 'jobsx.approved', { proposalId: p.id, jobId: created.id });
    return { proposal: structuredClone(p), job: jobsOf(host).view(ctx, raw, state) };
  });
}

export async function dismissProposal(host: ModuleHost, ctx: Context, id: unknown) {
  return host.store.update(state => {
    const p = visibleProposal(state, ctx, id); const ns = lane(state); const live = ns.proposals.find(item => item.id === p.id)!;
    check(live.status === 'proposed', 'INVALID_PROPOSAL_STATE', 'This proposal was already decided.');
    live.status = 'dismissed'; live.decidedAt = new Date(jobsOf(host).clock()).toISOString(); audit(state, 'jobsx.dismissed', { proposalId: live.id });
    return structuredClone(live);
  });
}

/** An edit is a new card for the same job; approving it replaces the job. */
export async function proposeEdit(host: ModuleHost, ctx: Context, jobId: unknown, changes: unknown): Promise<Proposal> {
  const state = host.store.read(); const job = jobsOf(host).find(state, String(jobId));
  check(isLaneJob(job) && ownsJob(ctx, job), 'NOT_FOUND', 'Job not found.');
  const meta = peekLane(state).jobs[job.id]; check(meta && !meta.deletedAt, 'NOT_FOUND', 'Job not found.');
  const base: CardOverrides = { budgetMinor: job.budgetMinor, reserveMinor: job.reserveMinor, missedRule: meta.missedRule, testedRoutes: meta.testedRoutes, background: meta.background, sourceIds: job.sourceIds, nextRunAt: job.nextRunAt };
  return proposeCard(host, ctx, { template: meta.template, sentence: job.goal, overrides: { ...base, ...overrides(changes) }, origin: 'edit', replacesJobId: job.id });
}

/** Finds repeating work and proposes a job for it. Deterministic; no model reads anything. */
export async function detect(host: ModuleHost, ctx: Context): Promise<Proposal[]> {
  const state = host.store.read(); const ns = peekLane(state); const at = jobsOf(host).clock(); const today = dayOf(new Date(at).toISOString());
  const taken = (tpl: string) => state.jobs.some((j: Job) => j.type === `${LANE_JOB_PREFIX}${tpl}` && ownsJob(ctx, j) && !TERMINAL.includes(j.status))
    || ns.proposals.some(p => p.template === tpl && p.card.ownerId === ctx.memberId && (p.status === 'proposed' || (p.status === 'dismissed' && at - Date.parse(p.decidedAt ?? p.createdAt) < 30 * DAY_MS)));
  const found: { template: string; evidence: string[] }[] = [];
  let facts: ReturnType<typeof visibleFacts> = [];
  try { facts = visibleFacts(host.store, ctx); } catch { facts = []; }
  const overdue = facts.filter(f => f.kind === 'invoice' && typeof f.fields.dueDate === 'string' && f.fields.dueDate < today && f.fields.status !== 'paid');
  if (overdue.length) found.push({ template: 'receivables-week', evidence: [`${overdue.length} invoices are past their due date in your books.`] });
  const weeks = (operations: string[]) => new Set(state.answers.filter((a: any) => operations.includes(a.request?.operation) && at - Date.parse(a.at) <= 60 * DAY_MS
    && state.receipts.some((r: any) => r.id === a.receiptId && r.memberId === ctx.memberId)).map((a: any) => isoWeek(a.at))).size;
  if (weeks(['received', 'aging']) >= 3) found.push({ template: 'cash-position', evidence: ['You asked about money received or owed in three different weeks.'] });
  if (weeks(['net_sales', 'margin']) >= 3) found.push({ template: 'weekly-close', evidence: ['You asked about net sales or margin in three different weeks.'] });
  const draftDays = new Set(state.actions.filter((a: any) => a.connector === 'local' && a.operation === 'reminder-draft' && a.createdBy === ctx.memberId && !String(a.idempotencyKey).startsWith('jobsx-')).map((a: any) => dayOf(a.createdAt))).size;
  if (draftDays >= 3 && !found.some(f => f.template === 'receivables-week')) found.push({ template: 'receivables-week', evidence: ['You prepared payment reminders by hand on three different days.'] });
  const proposals: Proposal[] = [];
  for (const item of found) {
    if (taken(item.template) || !availability(host, ctx, template(item.template)).available) continue;
    proposals.push(await proposeCard(host, ctx, { template: item.template, origin: 'detector', evidence: item.evidence }));
  }
  await host.store.update(state => { const n = lane(state); n.lastDetection = { ...(n.lastDetection ?? {}), [ctx.memberId]: today }; });
  return proposals;
}

function isoWeek(at: string): string {
  const date = new Date(Date.parse(at)); const day = (date.getUTCDay() + 6) % 7; date.setUTCDate(date.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 4)); return `${date.getUTCFullYear()}-${Math.round(((date.getTime() - first.getTime()) / DAY_MS - 3 + ((first.getUTCDay() + 6) % 7)) / 7) + 1}`;
}
