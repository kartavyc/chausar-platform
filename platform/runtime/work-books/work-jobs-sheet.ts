/**
 * What the job sheet adds beyond the core job: steps only a person can do (WK-16), the
 * measure against its goal (WK-08), the budget meters, the schedule with its missed-run rule
 * (WK-11) and which way Edit, Delete and the missed-run rule go (jobsx, the core, or not built).
 *
 * Nothing here is invented. A lane job (core type `jobsx-<template>`, jobs-ext `isLaneJob`) is
 * read through `jobsx.get`, shaped by `platform/runtime/jobs-ext/methods.ts` on the jobs-ext
 * lane: `{ ...view, facts: { goal, progress, budget, stops }, steps, waitingForYou, timeline,
 * next, missedRule, leftUndone, ... }`. Its person steps are the `waitingForYou` rows of kind
 * `person-step` (`{ id, jobId, title, assignee, status: 'waiting', createdAt }`); its budget is
 * jobs-ext's measured `budgetView`; its result is `jobsx.result`. A core job keeps the core-only
 * paths: a person step from a core plan step of kind `person`, meters derived from the job.
 * A measure point is a calculation receipt the job names that the caller can read; one it names
 * but cannot read is a gap in words. With no receipt named, there is no measure.
 */
import type { CalculationReceipt } from '../calculator.ts';
import type { Job } from '../jobs.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { Amount, Env } from './work-queue.ts';

const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown, max = 400): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const PAISE = /^-?(0|[1-9]\d{0,29})$/;
const UNSIGNED = /^(0|[1-9]\d{0,29})$/;
const INSTANT = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value);
const strings = (value: unknown, max = 200): string[] => Array.isArray(value) ? value.filter((s): s is string => str(s, max)) : [];

/**
 * Whether another lane's method is installed, read from the method registry without calling
 * it: a probe could start a real change. A trusted host (a test) may supply `hasMethod`.
 */
export async function installed(host: ModuleHost, method: string): Promise<boolean> {
  const hasMethod = host.options.hasMethod;
  if (typeof hasMethod === 'function') return hasMethod(method) === true;
  const { moduleMethods } = await import('../modules/registry.ts');
  return moduleMethods.has(method);
}

/** A job run by jobs-ext: its core type is `jobsx-<template>`. Every `jobsx.*` job method refuses any other job. */
export const isLaneJob = (job: { type?: string } | undefined): boolean => !!job?.type && job.type.startsWith('jobsx-');
/** A jobs-ext method applies to a job only when the job is a lane job and the method is installed. */
export async function laneMethod(host: ModuleHost, job: { type?: string }, method: string): Promise<boolean> {
  return isLaneJob(job) && await installed(host, method);
}

/** The missed-run rule in this lane's words, and jobs-ext's (`validRule`: skip, once, all). */
export type MissedRun = 'skip' | 'run-once-on-wake' | 'run-all';
export const TO_JOBSX: Readonly<Record<MissedRun, 'skip' | 'once' | 'all'>> = Object.freeze({ skip: 'skip', 'run-once-on-wake': 'once', 'run-all': 'all' });
const FROM_JOBSX: Readonly<Record<string, MissedRun>> = Object.freeze({ skip: 'skip', once: 'run-once-on-wake', all: 'run-all' });

/** WK-16. The additive fields a person step carries on the job time line. */
export type PersonWho = { kind: 'you' | 'person'; name: string; memberId: string | null };
export type PersonStep = {
  at: string; event: 'person-step'; amount: null; needsModel: false; reason: null;
  kind: 'person'; stepId: string; what: string; who: PersonWho; done: boolean; doneAt: string | null; doneBy: string | null; canDone: boolean;
};
export type Measure = { name: string; goal: Amount; goalReceiptId: string | null; points: { at: string; value: Amount; receiptId: string }[] };
export type Schedule =
  | { kind: 'interval'; everyDays: number | null; everyMs: number }
  | { kind: 'calendar'; rule: 'month-end' | 'calendar'; at: string | null; timeZone: string; paused: boolean };
export type Way = 'jobsx' | 'core' | 'not-built';
export type Manage = { edit: Way; delete: 'jobsx' | 'cancel'; missedRule: Way; personStep: 'jobsx' | 'not-built' };
/** WK-11: the rule and the choices offered. jobs-ext offers "run every missed one" only for a job that delivers every run. */
export type MissedRule = { rule: MissedRun; choices: MissedRun[]; runAll: 'offered' | 'unsuitable' | 'not-built' };
export type JobStepRow = { at: string; event: string; amount: Amount | null; needsModel: boolean | null; reason: string | null };
type Meters = {
  model: { spent: Amount; budget: Amount; route: string | null; estimate: boolean };
  clock: { minutes: number } | { missing: 'not-counted' };
  exposure: Amount;
};

/** `jobsx.get`, normalised. Each field is read defensively; a missing one is null or empty, never made up. */
export type LaneView = {
  title: string | null; state: string | null; reason: string | null;
  missedRule: MissedRun | null; stepsPerDelivery: number | null;
  budget: { spentMinor: string; budgetMinor: string; routes: { routeId: string; basis: string }[]; clockMs: number | null; exposureMinor: string | null } | null;
  personSteps: { id: string; title: string; assignee: string | null; createdAt: string | null }[];
  questions: { id: string; prompt: string; options: string[]; askedAt: string | null }[];
  steps: { kind: string; title: string; needsModel: boolean }[];
  /** Oldest first (jobs-ext sends newest first). */
  timeline: { at: string; text: string; code: string | null; costMinor: string | null; needsModel: boolean | null; receiptIds: string[] }[];
  missed: { text: string; at: string } | null;
  leftUndone: string[];
};

export function laneView(raw: unknown): LaneView | null {
  if (!record(raw)) return null;
  const facts = record(raw.facts) ? raw.facts : {};
  const progress = record(facts.progress) ? facts.progress : {};
  const b = record(facts.budget) ? facts.budget : null;
  const meters = b && record(b.meters) ? b.meters : {};
  const budget = b && typeof b.spentMinor === 'string' && UNSIGNED.test(b.spentMinor) && typeof b.budgetMinor === 'string' && UNSIGNED.test(b.budgetMinor) ? {
    spentMinor: b.spentMinor, budgetMinor: b.budgetMinor,
    routes: (Array.isArray(meters.model) ? meters.model : []).filter((m: unknown) => record(m) && str(m.routeId, 200)).map((m: any) => ({ routeId: m.routeId as string, basis: str(m.basis, 40) ? m.basis as string : 'measured' })),
    clockMs: Number.isSafeInteger(meters.clockMs) && meters.clockMs >= 0 ? meters.clockMs as number : null,
    exposureMinor: typeof meters.exposureMinor === 'string' && UNSIGNED.test(meters.exposureMinor) ? meters.exposureMinor : null,
  } : null;
  const waiting = Array.isArray(raw.waitingForYou) ? raw.waitingForYou.filter(record) : [];
  return {
    title: str(raw.title) ? raw.title : null, state: str(raw.state, 80) ? raw.state : null, reason: str(raw.reason) ? raw.reason : null,
    missedRule: typeof raw.missedRule === 'string' && Object.hasOwn(FROM_JOBSX, raw.missedRule) ? FROM_JOBSX[raw.missedRule] : null,
    stepsPerDelivery: Number.isSafeInteger(progress.stepsPerDelivery) && progress.stepsPerDelivery >= 1 ? progress.stepsPerDelivery : null,
    budget,
    personSteps: waiting.filter(w => w.kind === 'person-step' && str(w.id, 200) && str(w.title, 2000) && (w.status === undefined || w.status === 'waiting'))
      .map(w => ({ id: w.id, title: w.title, assignee: str(w.assignee, 200) ? w.assignee : null, createdAt: INSTANT(w.createdAt) ? w.createdAt : null })),
    questions: waiting.filter(w => w.kind === 'question' && str(w.id, 200) && str(w.prompt, 2000) && (w.status === undefined || w.status === 'open'))
      .map(w => ({ id: w.id, prompt: w.prompt, options: strings(w.options, 200), askedAt: INSTANT(w.askedAt) ? w.askedAt : null })),
    steps: (Array.isArray(raw.steps) ? raw.steps : []).filter((s: unknown) => record(s) && str(s.kind, 40) && str(s.title, 2000) && typeof s.needsModel === 'boolean')
      .map((s: any) => ({ kind: s.kind, title: s.title, needsModel: s.needsModel })),
    timeline: (Array.isArray(raw.timeline) ? raw.timeline : []).filter((t: unknown) => record(t) && INSTANT(t.at) && str(t.text, 2000))
      .map((t: any) => ({ at: t.at, text: t.text, code: str(t.code, 200) ? t.code : null, costMinor: typeof t.costMinor === 'string' && UNSIGNED.test(t.costMinor) ? t.costMinor : null,
        needsModel: typeof t.needsModel === 'boolean' ? t.needsModel : null, receiptIds: strings(t.receiptIds) }))
      .reverse(),
    missed: record(raw.missed) && str(raw.missed.text, 2000) && INSTANT(raw.missed.at) ? { text: raw.missed.text, at: raw.missed.at } : null,
    leftUndone: strings(raw.leftUndone, 2000),
  };
}

/** The jobs-ext job view, for a lane job when `jobsx.get` is installed. A refusal leaves the sheet as the core sees it. */
export async function jobsxView(host: ModuleHost, job: Job): Promise<LaneView | null> {
  if (!(await laneMethod(host, job, 'jobsx.get'))) return null;
  try { return laneView(await host.call('jobsx.get', { id: job.id })); } catch { return null; }
}

/** `jobsx.result`: the delivered result (`LaneResult`), when there is one. `NO_RESULT` and other refusals read as none. */
export type LaneResult = { done: string[]; open: string[]; receiptIds: string[]; deliveredAt: string | null };
export async function jobsxResult(host: ModuleHost, job: Job): Promise<LaneResult | null> {
  if (!(await laneMethod(host, job, 'jobsx.result'))) return null;
  let raw: unknown;
  try { raw = await host.call('jobsx.result', { id: job.id }); } catch { return null; }
  if (!record(raw)) return null;
  const figures = Array.isArray(raw.figures) ? raw.figures.filter(record).map(f => f.receiptId).filter((id): id is string => str(id, 200)) : [];
  return { done: strings(raw.done, 2000), open: strings(raw.open, 2000), receiptIds: [...new Set([...strings(raw.receiptIds), ...figures])], deliveredAt: INSTANT(raw.deliveredAt) ? raw.deliveredAt : null };
}

/** WK-08 meters from jobs-ext's measured `budgetView` (model use per route, clock time, money exposure). */
export function laneMeters(view: LaneView): Meters | null {
  const b = view.budget; if (!b) return null;
  return {
    model: { spent: { minor: b.spentMinor }, budget: { minor: b.budgetMinor }, route: b.routes.length ? b.routes.map(r => r.routeId).join(', ') : null, estimate: b.routes.some(r => r.basis === 'estimate') },
    clock: b.clockMs === null ? { missing: 'not-counted' } : { minutes: Math.round(b.clockMs / 60_000) },
    exposure: b.exposureMinor === null ? { missing: 'not-counted' } : { minor: b.exposureMinor },
  };
}

const OPEN_ROLES = ['owner', 'cofounder'];
/** The person steps of a job, open ones first. Done is only what the owning lane or the ledger records. */
export function personSteps(e: Env, job: Job, view: LaneView | null, canMark: boolean): PersonStep[] {
  const name = (id: string | null | undefined) => (id ? e.state.members.find(m => m.id === id)?.name : undefined);
  const whoOf = (memberId: unknown, label: unknown): PersonWho => {
    const id = str(memberId, 200) ? memberId : null;
    if (id === e.ctx.memberId) return { kind: 'you', name: name(id) ?? id, memberId: id };
    return { kind: 'person', name: str(label) ? label : name(id) ?? 'unknown', memberId: id };
  };
  const mine = (who: PersonWho) => canMark && (who.memberId === null ? OPEN_ROLES.includes(e.ctx.role) : who.memberId === e.ctx.memberId || OPEN_ROLES.includes(e.ctx.role));
  const out: PersonStep[] = [];
  const add = (stepId: string, what: string, who: PersonWho, at: string, done: boolean, doneAt: string | null, doneBy: string | null, may: boolean) => {
    if (out.some(s => s.stepId === stepId)) return;
    out.push({ at, event: 'person-step', amount: null, needsModel: false, reason: null, kind: 'person', stepId, what, who, done, doneAt, doneBy, canDone: !done && may });
  };
  // jobs-ext lists only waiting steps; it lets only the job's pinned owner mark one done.
  for (const s of view?.personSteps ?? []) add(s.id, s.title, whoOf(s.assignee, null), s.createdAt ?? job.createdAt, false, null, null, canMark && job.ownerId === e.ctx.memberId);
  const doneIn = (stepId: string) => job.ledger.find(l => l.event === 'person-step-done' && (l as { stepId?: unknown }).stepId === stepId) as (Job['ledger'][number] & { by?: unknown }) | undefined;
  for (const step of job.plan?.steps ?? []) {
    const s = step as unknown as Record<string, any>;
    if (s.kind !== 'person' && s.provider !== 'person') continue;
    const input = record(s.input) ? s.input : {};
    if (!str(input.what, 2000)) continue;
    const done = doneIn(s.id); const who = whoOf(input.memberId, input.who);
    add(s.id, input.what, who, job.createdAt, done !== undefined, done?.at ?? null, done && str(done.by) ? done.by : null, mine(who));
  }
  return [...out.filter(s => !s.done), ...out.filter(s => s.done)];
}

/** Every receipt id a value names (`receiptId`, `receiptIds`, `evidenceIds`), with the time it was named at. */
function collect(value: unknown, at: string, into: Map<string, string>, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const v of value) collect(v, at, into, depth + 1); return; }
  const v = value as Record<string, unknown>;
  const when = INSTANT(v.scheduledFor) ? v.scheduledFor : at;
  if (str(v.receiptId, 200) && !into.has(v.receiptId)) into.set(v.receiptId, when);
  for (const key of ['receiptIds', 'evidenceIds']) if (Array.isArray(v[key])) for (const id of v[key] as unknown[]) if (str(id, 200) && !into.has(id)) into.set(id, when);
  for (const [key, inner] of Object.entries(v)) if (key !== 'receiptIds' && key !== 'evidenceIds') collect(inner, when, into, depth + 1);
}

/**
 * WK-08: the measure. Points are the calculation receipts the job names (its deliverable, its
 * runs and its ledger; for a lane job also its jobs-ext time line and delivered result), read
 * through the calculator as the caller. A receipt that exists but the caller cannot read is a
 * gap (`withheld`), never a value. jobs-ext declares no measure goal, so the goal is the plan
 * input's `measure.goalMinor`, else `absent`. Null when no readable receipt is named.
 */
export function jobMeasure(e: Env, job: Job, view: LaneView | null, result: LaneResult | null = null): Measure | null {
  const stored = (e.state.jobs as Job[]).find(j => j.id === job.id) ?? job;
  const named = new Map<string, string>();
  const delivered = [...stored.ledger].reverse().find(l => l.event === 'delivered')?.at ?? stored.createdAt;
  for (const execution of [...(stored.archivedExecutions ?? []), ...(stored.execution ? [stored.execution] : [])]) collect(execution, execution.scheduledFor, named);
  collect(stored.deliverable, delivered, named);
  for (const l of stored.ledger) { const id = (l as { receiptId?: unknown }).receiptId; if (str(id, 200) && !named.has(id)) named.set(id, l.at); }
  for (const line of view?.timeline ?? []) for (const id of line.receiptIds) if (!named.has(id)) named.set(id, line.at);
  for (const id of result?.receiptIds ?? []) if (!named.has(id)) named.set(id, result!.deliveredAt ?? delivered);
  const calculator = e.host.services.calculator;
  const read: { id: string; at: string; receipt: CalculationReceipt | null }[] = [];
  for (const [id, at] of named) {
    if (!(e.state.receipts as CalculationReceipt[]).some(r => r.id === id)) continue;    // not a calculation receipt
    let receipt: CalculationReceipt | null = null;
    try { receipt = calculator ? calculator.receipt(e.ctx, id) as CalculationReceipt : null; } catch { receipt = null; }
    read.push({ id, at: receipt ? receipt.asOf : at, receipt });
  }
  const known = read.filter(r => r.receipt !== null);
  if (known.length === 0) return null;
  const counts = new Map<string, number>();
  for (const r of known) counts.set(r.receipt!.operation, (counts.get(r.receipt!.operation) ?? 0) + 1);
  const operation = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const first = known.find(r => r.receipt!.operation === operation)!.receipt!;
  const label = first.figures.find(f => f.key === 'total')?.label ?? first.figures[0]?.label ?? operation;
  const goalMinor = record(stored.input) && record((stored.input as any).measure) ? (stored.input as any).measure.goalMinor : undefined;
  const points = read.filter(r => r.receipt === null || r.receipt.operation === operation)
    .map(r => ({ at: r.at, value: r.receipt ? { minor: r.receipt.valueMinor } as Amount : { missing: 'withheld' } as Amount, receiptId: r.id }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.receiptId < b.receiptId ? -1 : 1));
  return { name: label, goal: typeof goalMinor === 'string' && PAISE.test(goalMinor) ? { minor: goalMinor } : { missing: 'absent' }, goalReceiptId: null, points };
}

/** WK-11: how the job repeats. A calendar of the last day of each month reads as month-end. */
export function jobSchedule(job: Job): Schedule {
  const c = job.calendar;
  if (!c) return { kind: 'interval', everyDays: job.intervalMs % 86_400_000 === 0 ? job.intervalMs / 86_400_000 : null, everyMs: job.intervalMs };
  const r = c.definition.recurrence;
  const monthEnd = r.kind === 'monthly' && r.dayOfMonth === 31 && r.everyMonths === 1 && r.missingDate === 'last-day';
  return { kind: 'calendar', rule: monthEnd ? 'month-end' : 'calendar', at: r.kind === 'once' ? r.atLocal : r.at, timeZone: c.definition.timeZone, paused: c.paused };
}

/** The missed-run rule as the core card shows it (two values). A calendar keeps its own rule. */
export function missedRunOf(job: Job): 'skip' | 'run-once-on-wake' {
  if (job.calendar) return job.calendar.definition.missed.kind === 'skip' ? 'skip' : 'run-once-on-wake';
  return job.catchup === 'skip' ? 'skip' : 'run-once-on-wake';
}

/** WK-11: the full rule with its choices. jobs-ext refuses "all" (`MISSED_RULE_UNSUITABLE`) unless the job delivers every run. */
export function missedRuleOf(job: Job, view: LaneView | null, way: Way): MissedRule {
  const base: MissedRun[] = ['run-once-on-wake', 'skip'];
  if (!view || way !== 'jobsx') return { rule: view?.missedRule ?? missedRunOf(job), choices: base, runAll: 'not-built' };
  const suits = view.stepsPerDelivery === 1;
  return { rule: view.missedRule ?? missedRunOf(job), choices: suits ? [...base, 'run-all'] : base, runAll: suits ? 'offered' : 'unsuitable' };
}

/** Which way each change goes. A jobs-ext method only for a lane job; only a typed job (with a core plan) can be amended by the core. */
export async function jobManage(host: ModuleHost, job: Job): Promise<Manage> {
  const [edit, rule, remove, done] = await Promise.all(['jobsx.edit', 'jobsx.setMissedRule', 'jobsx.delete', 'jobsx.personStep.done'].map(m => laneMethod(host, job, m)));
  const core: Way = job.plan ? 'core' : 'not-built';
  return { edit: edit ? 'jobsx' : core, delete: remove ? 'jobsx' : 'cancel', missedRule: rule ? 'jobsx' : core, personStep: done ? 'jobsx' : 'not-built' };
}

/**
 * The extra fields `approvals.job` returns. The person steps lead the time line while they wait.
 * For a lane job read through jobs-ext, its own time line, measured meters and delivered result
 * replace the core-derived ones, and `jobsx` carries its title, state, ready-made steps (each
 * marked whether it needs an AI model), open questions, missed-run note and what was left undone.
 */
export async function jobSheetExtras(e: Env, job: Job, timeline: JobStepRow[], canMark: boolean) {
  const view = await jobsxView(e.host, job);
  const result = view ? await jobsxResult(e.host, job) : null;
  const steps = personSteps(e, job, view, canMark);
  const open = steps.filter(s => !s.done), done = steps.filter(s => s.done);
  const lines: JobStepRow[] = view && view.timeline.length
    ? view.timeline.map(t => ({ at: t.at, event: t.text, amount: t.costMinor === null ? null : { minor: t.costMinor }, needsModel: t.needsModel, reason: t.code }))
    : timeline;
  const manage = await jobManage(e.host, job);
  const meters = view ? laneMeters(view) : null;
  return {
    timeline: [...open, ...lines, ...done],
    measure: jobMeasure(e, job, view, result),
    schedule: jobSchedule(job),
    missedRun: view?.missedRule === 'skip' ? 'skip' as const : view?.missedRule ? 'run-once-on-wake' as const : missedRunOf(job),
    missedRule: missedRuleOf(job, view, manage.missedRule),
    manage,
    ...(meters ? { meters } : {}),
    ...(result ? { result: { done: result.done, open: result.open, receiptIds: result.receiptIds } } : {}),
    jobsx: view ? {
      title: view.title, state: view.state, reason: view.reason,
      steps: view.steps.map(s => ({ kind: s.kind, title: s.title, needsModel: s.needsModel })),
      questions: view.questions, missed: view.missed, leftUndone: view.leftUndone,
    } : null,
  };
}

/**
 * `jobsx.list` (jobs-ext, `platform/runtime/jobs-ext/methods.ts`): `{ proposals: { proposalId, title, origin,
 * fromJobId, replacesJobId, state: 'proposed', evidence, digest }[], jobs: view[] }`, or `jobsx.proposals`
 * (`Proposal[]`) when only that is installed. Read only when installed; never probed.
 */
export type LaneLabel = { state: string; reason: string | null; resumesAt: string | null };
export type LaneProposal = { id: string; title: string; origin: string; replacesJobId: string | null; evidence: string[]; digest: string };
export async function jobsxList(host: ModuleHost): Promise<{ available: boolean; labels: Map<string, LaneLabel>; proposals: LaneProposal[] }> {
  const labels = new Map<string, LaneLabel>(); const proposals: LaneProposal[] = [];
  const str = (v: unknown, max = 400): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
  const add = (p: Record<string, any>, id: unknown, title: unknown) => {
    if (!str(id, 200) || !/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/.test(id) || !str(p.digest, 200) || !str(title)) return;
    proposals.push({ id, title, origin: str(p.origin, 40) ? p.origin : 'person', replacesJobId: str(p.replacesJobId, 200) ? p.replacesJobId : null,
      evidence: Array.isArray(p.evidence) ? p.evidence.filter((x: unknown): x is string => str(x, 2000)).slice(0, 10) : [], digest: p.digest });
  };
  const [list, only] = await Promise.all([installed(host, 'jobsx.list'), installed(host, 'jobsx.proposals')]);
  try {
    if (list) {
      const reply = await host.call('jobsx.list', {}) as Record<string, any>;
      for (const p of Array.isArray(reply?.proposals) ? reply.proposals : []) if (record(p) && p.state === 'proposed') add(p, p.proposalId, p.title);
      for (const j of Array.isArray(reply?.jobs) ? reply.jobs : []) if (record(j) && str(j.id, 200) && str(j.state, 80))
        labels.set(j.id, { state: j.state, reason: str(j.reason) ? j.reason : null, resumesAt: typeof j.resumesAt === 'string' && Number.isFinite(Date.parse(j.resumesAt)) ? j.resumesAt : null });
    } else if (only) {
      const reply = await host.call('jobsx.proposals', {});
      for (const p of Array.isArray(reply) ? reply : []) if (record(p) && p.status === 'proposed') add(p, p.id, record(p.card) ? p.card.title : undefined);
    }
  } catch { /* a refused read leaves the list as the core sees it */ }
  return { available: list || only, labels, proposals };
}
/** A lane job's row with jobs-ext's own label (`label()` in jobs-ext) in this list's states. */
export function laneRow<R extends { state: string; reason: string | null; resumesAt: string | null }>(row: R, label: LaneLabel | undefined): R {
  if (!label || row.state === 'proposed') return row;
  switch (label.state) {
    case 'set-aside': return { ...row, state: 'set-aside', reason: label.reason ?? row.reason };
    case 'stopped-by-rule': return { ...row, state: 'stopped-by-rule', reason: label.reason ?? row.reason };
    case 'result-waiting': return { ...row, state: 'awaiting-acceptance' };
    case 'waiting-for-you': return { ...row, state: 'waiting', reason: 'waiting-for-you' };
    case 'waiting-network': return { ...row, state: 'waiting', reason: 'waiting-network', resumesAt: label.resumesAt ?? row.resumesAt };
    case 'waiting': return { ...row, state: 'waiting', reason: label.reason ?? row.reason, resumesAt: label.resumesAt ?? row.resumesAt };
    default: return row;
  }
}
