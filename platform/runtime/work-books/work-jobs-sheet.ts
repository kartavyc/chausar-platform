/**
 * What the job sheet adds beyond the core job: steps only a person can do (WK-16), the
 * measure against its goal (WK-08), the schedule with its missed-run rule (WK-11) and which
 * way Edit, Delete and the missed-run rule go (jobsx, the core, or not built yet).
 *
 * Nothing here is invented. A person step comes from the jobs-ext job view (`jobsx.get`) when
 * that lane is installed, or from a core plan step of kind `person`. A measure point is a
 * calculation receipt the job names that the caller can read; one it names but cannot read is
 * a gap in words. With no receipt named, there is no measure.
 */
import type { CalculationReceipt } from '../calculator.ts';
import type { Job } from '../jobs.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { Amount, Env } from './work-queue.ts';

const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown, max = 400): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const PAISE = /^-?(0|[1-9]\d{0,29})$/;
const INSTANT = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value);

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

/** The jobs-ext job view, when installed and readable. Any refusal leaves the sheet as the core sees it. */
export async function jobsxView(host: ModuleHost, raw: string): Promise<Record<string, any> | null> {
  if (!(await installed(host, 'jobsx.get'))) return null;
  try { const view = await host.call('jobsx.get', { id: raw }); return record(view) ? view : null; } catch { return null; }
}

const OPEN_ROLES = ['owner', 'cofounder'];
/** The person steps of a job, open ones first. Done is only what the owning lane or the ledger records. */
export function personSteps(e: Env, job: Job, view: Record<string, any> | null, canMark: boolean): PersonStep[] {
  const name = (id: string | null | undefined) => (id ? e.state.members.find(m => m.id === id)?.name : undefined);
  const whoOf = (memberId: unknown, label: unknown): PersonWho => {
    const id = str(memberId, 200) ? memberId : null;
    if (id === e.ctx.memberId) return { kind: 'you', name: name(id) ?? id, memberId: id };
    return { kind: 'person', name: str(label) ? label : name(id) ?? 'unknown', memberId: id };
  };
  const mine = (who: PersonWho) => canMark && (who.memberId === null ? OPEN_ROLES.includes(e.ctx.role) : who.memberId === e.ctx.memberId || OPEN_ROLES.includes(e.ctx.role));
  const out: PersonStep[] = [];
  const add = (stepId: string, what: string, who: PersonWho, at: string, done: boolean, doneAt: string | null, doneBy: string | null) => {
    if (out.some(s => s.stepId === stepId)) return;
    out.push({ at, event: 'person-step', amount: null, needsModel: false, reason: null, kind: 'person', stepId, what, who, done, doneAt, doneBy, canDone: !done && mine(who) });
  };
  if (view && Array.isArray(view.steps)) {
    for (const s of view.steps) {
      if (!record(s) || s.kind !== 'person' || !str(s.id, 200) || !str(s.what, 2000)) continue;
      const who = record(s.who) ? whoOf(s.who.memberId, s.who.name) : whoOf(null, null);
      add(s.id, s.what, who, INSTANT(s.at) ? s.at : job.createdAt, s.done === true, INSTANT(s.doneAt) ? s.doneAt : null, str(s.doneBy) ? s.doneBy : null);
    }
  }
  const doneIn = (stepId: string) => job.ledger.find(l => l.event === 'person-step-done' && (l as { stepId?: unknown }).stepId === stepId) as (Job['ledger'][number] & { by?: unknown }) | undefined;
  for (const step of job.plan?.steps ?? []) {
    const s = step as unknown as Record<string, any>;
    if (s.kind !== 'person' && s.provider !== 'person') continue;
    const input = record(s.input) ? s.input : {};
    if (!str(input.what, 2000)) continue;
    const done = doneIn(s.id);
    add(s.id, input.what, whoOf(input.memberId, input.who), job.createdAt, done !== undefined, done?.at ?? null, done && str(done.by) ? done.by : null);
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
 * runs and its ledger), read through the calculator as the caller. A receipt that exists but the
 * caller cannot read is a gap (`withheld`), never a value. The goal is what the job declares
 * (jobs-ext, or the plan input's `measure.goalMinor`), else `absent`. Null when no receipt is named.
 */
export function jobMeasure(e: Env, job: Job, view: Record<string, any> | null): Measure | null {
  const stored = (e.state.jobs as Job[]).find(j => j.id === job.id) ?? job;
  const named = new Map<string, string>();
  const delivered = [...stored.ledger].reverse().find(l => l.event === 'delivered')?.at ?? stored.createdAt;
  for (const execution of [...(stored.archivedExecutions ?? []), ...(stored.execution ? [stored.execution] : [])]) collect(execution, execution.scheduledFor, named);
  collect(stored.deliverable, delivered, named);
  for (const l of stored.ledger) { const id = (l as { receiptId?: unknown }).receiptId; if (str(id, 200) && !named.has(id)) named.set(id, l.at); }
  const declared = view && record(view.measure) ? view.measure : null;
  if (declared && Array.isArray(declared.receiptIds)) for (const id of declared.receiptIds) if (str(id, 200) && !named.has(id)) named.set(id, delivered);
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
  const operation = declared && str(declared.operation) && counts.has(declared.operation) ? declared.operation
    : [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const first = known.find(r => r.receipt!.operation === operation)!.receipt!;
  const label = first.figures.find(f => f.key === 'total')?.label ?? first.figures[0]?.label ?? operation;
  const goalMinor = declared && record(declared.goal) && typeof declared.goal.minor === 'string' ? declared.goal.minor
    : record(stored.input) && record((stored.input as any).measure) ? (stored.input as any).measure.goalMinor : undefined;
  const points = read.filter(r => r.receipt === null || r.receipt.operation === operation)
    .map(r => ({ at: r.at, value: r.receipt ? { minor: r.receipt.valueMinor } as Amount : { missing: 'withheld' } as Amount, receiptId: r.id }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.receiptId < b.receiptId ? -1 : 1));
  return {
    name: declared && str(declared.name) ? declared.name : label,
    goal: typeof goalMinor === 'string' && PAISE.test(goalMinor) ? { minor: goalMinor } : { missing: 'absent' },
    goalReceiptId: declared && str(declared.goalReceiptId, 200) ? declared.goalReceiptId : null,
    points,
  };
}

/** WK-11: how the job repeats. A calendar of the last day of each month reads as month-end. */
export function jobSchedule(job: Job): Schedule {
  const c = job.calendar;
  if (!c) return { kind: 'interval', everyDays: job.intervalMs % 86_400_000 === 0 ? job.intervalMs / 86_400_000 : null, everyMs: job.intervalMs };
  const r = c.definition.recurrence;
  const monthEnd = r.kind === 'monthly' && r.dayOfMonth === 31 && r.everyMonths === 1 && r.missingDate === 'last-day';
  return { kind: 'calendar', rule: monthEnd ? 'month-end' : 'calendar', at: r.kind === 'once' ? r.atLocal : r.at, timeZone: c.definition.timeZone, paused: c.paused };
}

/** The missed-run rule as the card shows it. A calendar keeps its own rule. */
export function missedRunOf(job: Job): 'skip' | 'run-once-on-wake' {
  if (job.calendar) return job.calendar.definition.missed.kind === 'skip' ? 'skip' : 'run-once-on-wake';
  return job.catchup === 'skip' ? 'skip' : 'run-once-on-wake';
}

/** Which way each change goes. Only a typed job (with a core plan) can be amended by the core. */
export async function jobManage(host: ModuleHost, job: Job): Promise<Manage> {
  const [edit, remove, done] = await Promise.all([installed(host, 'jobsx.edit'), installed(host, 'jobsx.delete'), installed(host, 'jobsx.personStep.done')]);
  const core: Way = job.plan ? 'core' : 'not-built';
  return { edit: edit ? 'jobsx' : core, delete: remove ? 'jobsx' : 'cancel', missedRule: edit ? 'jobsx' : core, personStep: done ? 'jobsx' : 'not-built' };
}

/** The extra fields `approvals.job` returns. The person steps lead the time line while they wait. */
export async function jobSheetExtras(e: Env, job: Job, timeline: unknown[], canMark: boolean) {
  const view = await jobsxView(e.host, job.id);
  const steps = personSteps(e, job, view, canMark);
  const open = steps.filter(s => !s.done), done = steps.filter(s => s.done);
  return {
    timeline: [...open, ...timeline, ...done],
    measure: jobMeasure(e, job, view),
    schedule: jobSchedule(job),
    missedRun: missedRunOf(job),
    manage: await jobManage(e.host, job),
  };
}
