/**
 * Runs one step of a lane job under JobService's lease and rupee reservation.
 *
 * acquire (catch-up rule, stop rule, budget reservation, autonomy master) → the template's work
 * → charge each model step against the reservation → either an intermediate step (the lease is
 * released and the next slot set) or a delivery that waits for the owner's acceptance.
 * A failure releases the lease; after `failureLimit` failures in a row the job is set aside.
 */
import { audit, check, ChausarError, newId } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { digest } from '../actions.ts';
import type { Job, JobService } from '../jobs.ts';
import type { ModuleHost } from '../modules/types.ts';
import { appendLearningDecision } from '../learning.ts';
import { lane, peekLane, pushTimeline, bound, dayOf, isLaneJob, ownsJob, rupees } from './state.ts';
import type { CaseOutcome, JobsExtState, LaneJob, LaneResult, TimelineEntry } from './state.ts';
import { template, type JobTemplate } from './templates.ts';
import { decide, nextSlot } from './catch-up.ts';
import { consentFor, costOf, optionalCall, prepareReminder, routePrice } from './adapters.ts';
import { caseFields, invoiceCases, readyMadeDecision, reminderText, RECEIVABLE_OPTIONS, type InvoiceCase, type ReceiptLike } from './receivables.ts';
import type { AgentPort, CaseFields, TraceStep, WorkCase } from '../procedures/types.ts';
import { approvedProcedure, recordRun } from '../procedures/service.ts';
import { routeCase } from '../procedures/derive.ts';
import { GatewayAgent, chooseRoute, AGENT_UNAVAILABLE } from './gateway-agent.ts';

export const WORKER = 'jobsx-worker';
export const LEASE_MS = 300_000;
export const CONFIDENT = 0.8;
const AGENT_MAX_UNITS = 2_000;
/** The most model units one agent call may use; its cost is reserved before the call. */
const maxUnits = (host: ModuleHost) => Number.isSafeInteger(host.options.agentMaxUnits) && (host.options.agentMaxUnits as number) > 0 && (host.options.agentMaxUnits as number) <= 1_000_000 ? host.options.agentMaxUnits as number : AGENT_MAX_UNITS;
const NETWORK_RETRY_MS = 300_000;
const agentTimeoutMs = (host: ModuleHost) => Number.isSafeInteger(host.options.agentTimeoutMs) && (host.options.agentTimeoutMs as number) > 0 && (host.options.agentTimeoutMs as number) <= 240_000 ? host.options.agentTimeoutMs as number : 240_000;

type LeaseRef = { token: string; workerId: string; fence: number };
export type RunReport = { jobId: string; status: string; code?: string; delivered?: boolean; step?: number };

const jobsOf = (host: ModuleHost) => host.services.jobs as JobService;
const nowIso = (host: ModuleHost) => new Date(jobsOf(host).clock()).toISOString();

function entry(jobId: string, run: number, at: string, partial: Omit<TimelineEntry, 'id' | 'jobId' | 'run' | 'at'>): TimelineEntry {
  return { id: newId('jobsx_line'), jobId, run, at, ...partial };
}

/**
 * The installed full agent, when one exists and may be used now. Demo mode accepts only a synthetic (fake)
 * agent. Without one, the installed app uses the live model-gateway agent over the owner's enabled route.
 */
export function agentOf(host: ModuleHost, ctx?: Context): AgentPort | undefined {
  if (host.options.agent === undefined && host.options.liveAgent === 'model-gateway' && !host.demo && ctx && host.services.gateway) {
    const route = chooseRoute(host.services.gateway, ctx);
    return route ? new GatewayAgent({ gateway: host.services.gateway, routeId: route.id, calculate: (c, request) => host.services.calculator.calculate(c, request), clock: () => (host.services.jobs as JobService).clock() }) : undefined;
  }
  const agent = host.options.agent as AgentPort | undefined;
  if ((host.demo && agent?.synthetic !== true) || !agent || typeof agent.decide !== 'function' || typeof agent.routeId !== 'string') return undefined;
  return agent;
}
const networkUp = (host: ModuleHost) => typeof host.options.networkAvailable === 'function' ? (host.options.networkAvailable as () => boolean)() === true : true;

/** Model text is quoted, never obeyed, and a figure without a receipt is withheld (the number guard). */
export function guardNote(note: unknown): string {
  if (typeof note !== 'string' || !note.trim()) return '';
  const sentences = note.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]?/g)?.slice(0, 3).map(part => part.trim()).join(' ').trim().slice(0, 600) ?? '';
  return /\d/.test(sentences) ? 'The agent’s note held figures without a receipt, so it was withheld.' : sentences;
}

type StepWork = {
  figures: LaneResult['figures']; receiptIds: string[]; done: string[]; open: string[]; recommendations: string[];
  cases: CaseOutcome[]; personStep?: string;
  stop?: { rule: 'budget' | 'untested-route' | 'needs-another-part'; reason: string; leftUndone: string[] };
  waitingNetwork?: boolean; goalMet?: boolean;
};

/** A case's identifier: the invoice and customer references, or their digest when that would be too long. */
export const caseIdOf = (invoiceId: string, customerId: string) => { const id = `${invoiceId}:${customerId}`; return id.length <= 120 ? id : `case-${digest([invoiceId, customerId]).slice(0, 32)}`; };

/** A job's reminder key carries a private per-job nonce, so no other preparation can claim a job's action by guessing it. */
export const reminderKey = (meta: LaneJob, jobId: string, invoiceId: string, day: string) => `jobsx-${jobId}-${meta.keyNonce ?? 'legacy'}-${invoiceId}-${day}`.slice(0, 200);

/** Each calculation and decision appears once in a trace, whoever reported it. */
function addStep(trace: TraceStep[], step: TraceStep) { if (step.kind === 'action' || !trace.some(t => t.tool === step.tool)) trace.push(step); }

class Meter {
  readonly host: ModuleHost; readonly ctx: Context; readonly job: Job; readonly lease: LeaseRef;
  constructor(host: ModuleHost, ctx: Context, job: Job, lease: LeaseRef) { this.host = host; this.ctx = ctx; this.job = job; this.lease = lease; }
  /** What is left of this step's reservation, read from the live lease. */
  remaining(): bigint { const raw = jobsOf(this.host).find(this.host.store.read(), this.job.id); return raw.lease ? BigInt(raw.lease.reservedMinor) - BigInt(raw.lease.chargedMinor) : 0n; }
  async charge(minor: bigint) { if (minor > 0n) await jobsOf(this.host).charge(this.ctx, this.job.id, this.lease, String(minor)); }
}

async function calculate(host: ModuleHost, ctx: Context, request: Record<string, unknown>) {
  return host.services.calculator.calculate(ctx, request) as Promise<any>;
}
function figure(receipt: any, key: string): LaneResult['figures'][number] | undefined {
  const item = (receipt.figures as any[]).find(f => f.key === key);
  return item ? { key: `${receipt.operation}.${key}`, label: item.label, minor: item.minor, display: item.display, receiptId: receipt.id } : undefined;
}

/** Hands a case the ready-made rule was not sure of to the full agent, within the step's reservation. */
async function askAgent(host: ModuleHost, meter: Meter, job: Job, item: WorkCase, options: readonly string[]) {
  const agent = agentOf(host, meter.ctx);
  if (!agent) return { kind: 'none' as const };
  if (!networkUp(host)) return { kind: 'network' as const };
  if (!job.testedRoutes?.includes(agent.routeId)) return { kind: 'untested' as const, routeId: agent.routeId };
  // A route that prices its own calls (the model gateway) reserves its per-call maximum; others price model units.
  const selfPriced = typeof agent.maxCallCostMinor === 'function';
  const price = selfPriced ? { routeId: agent.routeId, unitMinor: '0', basis: 'measured' as const, pricedAt: '', source: 'host' as const } : await routePrice(host, agent.routeId);
  const limit = maxUnits(host);
  const ceiling = selfPriced ? BigInt(agent.maxCallCostMinor!(meter.ctx)) : costOf(price, limit);
  if (ceiling > meter.remaining()) return { kind: 'budget' as const };
  const started = Date.now(); const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  // The call must end well inside the lease. A call that runs out is charged its full reservation: its use is unknown.
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ChausarError('AGENT_TIMEOUT', 'The agent did not answer in time.')); }, agentTimeoutMs(host)); });
  let answer: Awaited<ReturnType<AgentPort['decide']>>;
  try { answer = await Promise.race([agent.decide(structuredClone(item), options, controller.signal, meter.ctx), timeout]); }
  catch (error) {
    const code = (error as { code?: string }).code ?? '';
    // A request that left the machine is charged its reservation, whatever the error; one that did not is not.
    // An agent that cannot say (a synthetic one) is charged, since its use is unknown.
    const dispatched = (error as { dispatched?: unknown }).dispatched;
    if (dispatched === true || (dispatched === undefined && code !== 'AGENT_APPROVAL_REQUIRED' && !AGENT_UNAVAILABLE.has(code))) await meter.charge(ceiling > meter.remaining() ? meter.remaining() : ceiling);
    if (code === 'AGENT_APPROVAL_REQUIRED') return { kind: 'approval' as const, previewId: String((error as { previewId?: unknown }).previewId ?? ''), routeId: agent.routeId };
    if (AGENT_UNAVAILABLE.has(code)) return { kind: 'none' as const };
    throw error;
  }
  finally { clearTimeout(timer); }
  const units = Number.isSafeInteger(answer?.units) && answer.units >= 0 && answer.units <= limit ? answer.units : limit;
  const reported = typeof answer?.costMinor === 'string' && /^(0|[1-9]\d{0,17})$/.test(answer.costMinor) ? BigInt(answer.costMinor) : undefined;
  const cost = selfPriced ? (reported ?? ceiling) : costOf(price, units); const left = meter.remaining();
  // A measured cost above the reservation is charged up to what is left and the rest is said, never dropped silently.
  await meter.charge(cost > left ? left : cost);
  if (cost > left) await host.store.update(state => pushTimeline(lane(state), entry(job.id, 0, nowIso(host), { kind: 'budget', routeId: agent.routeId, costMinor: String(cost - left), text: `The model call cost ${rupees(cost - left)} more than this step had reserved. The route’s own budget counted it in full.`, code: 'COST_ABOVE_RESERVATION' })));
  const decision = options.includes(answer?.decision) ? answer.decision : undefined;
  const confidence = typeof answer?.confidence === 'number' && answer.confidence >= 0 && answer.confidence <= 1 ? answer.confidence : 0;
  const steps: TraceStep[] = (Array.isArray(answer?.steps) ? answer.steps : []).slice(0, 50).filter((step: any) => step && ['calculate', 'question', 'action', 'lookup', 'person'].includes(step.kind) && typeof step.tool === 'string' && /^[a-z][a-z0-9_.-]{0,80}$/.test(step.tool))
    .map((step: any) => ({ kind: step.kind, tool: step.tool, outcome: ['ok', 'refused', 'unknown'].includes(step.outcome) ? step.outcome : 'unknown', durationMs: Number.isSafeInteger(step.durationMs) && step.durationMs >= 0 ? step.durationMs : 0, units: Number.isSafeInteger(step.units) && step.units >= 0 ? step.units : 0 }));
  return { kind: 'answered' as const, decision, confidence, steps, cost, estimate: price.basis === 'estimate', routeId: agent.routeId, latencyMs: Math.max(0, Date.now() - started), note: guardNote(answer?.note), receiptIds: Array.isArray(answer?.receiptIds) ? answer.receiptIds.filter((id: unknown) => typeof id === 'string').slice(0, 20) : [], proposeJob: typeof answer?.proposeJob === 'string' ? answer.proposeJob : undefined };
}

async function receivablesStep(host: ModuleHost, ctx: Context, job: Job, meta: LaneJob, meter: Meter, run: number): Promise<StepWork> {
  const at = nowIso(host); const today = dayOf(at);
  const receipt = await calculate(host, ctx, { operation: 'aging', onDate: today, ...(job.sourceIds.length ? { sourceIds: [...job.sourceIds] } : {}) }) as ReceiptLike & { figures: any[]; operation: string };
  const work: StepWork = { figures: [figure(receipt, 'outstanding')!].filter(Boolean), receiptIds: [receipt.id], done: [], open: [], recommendations: [], cases: [] };
  const { cases, unusable } = invoiceCases(receipt, today);
  if (unusable) work.open.push(`${unusable} invoice rows have no usable invoice, customer or due-date reference and were left out.`);
  const proc = approvedProcedure(host.store.read(), meta.template, job.ownerId);
  for (let index = 0; index < cases.length; index++) {
    const item: InvoiceCase = cases[index]; const caseId = caseIdOf(item.invoiceId, item.customerId);
    const ns = peekLane(host.store.read()); const prior = meta.cases[caseId];
    const base: CaseOutcome = { caseId, recordIds: [item.factId], handledBy: 'ready-made', status: 'done', actionIds: prior?.actionIds ?? [], receiptIds: [receipt.id], costMinor: '0', durationMs: 0 };
    if (BigInt(item.outstandingMinor) === 0n) {
      if (prior && prior.status !== 'paid') {
        work.cases.push({ ...base, status: 'paid', decision: 'paid', reason: 'paid' });
        // Sent is not paid: the payment is its own entry, read from the books on its own date.
        await host.store.update(state => pushTimeline(lane(state), entry(job.id, run, at, { kind: 'paid', text: `Invoice ${item.invoiceId} is paid in your books. The reminder and the payment are two separate entries.`, recordIds: [item.factId], receiptIds: [receipt.id], caseId })));
      }
      continue;
    }
    const consent = await consentFor(host, ns.consent, item.customerId, 'mail');
    const consentCode = consent.stoppedAt ? 'stopped' : consent.agreed;
    const remindedToday = ns.reminders.some(r => r.customerId === item.customerId && r.day === today);
    const remindersSoFar = ns.reminders.filter(r => r.invoiceId === item.invoiceId && r.customerId === item.customerId).length;
    const fields: CaseFields = caseFields(item, consentCode, remindedToday, remindersSoFar);
    const work_case: WorkCase = { id: caseId, jobId: job.id, template: meta.template, fields, recordIds: [item.factId], sourceIds: [item.sourceId], tainted: false };
    const answered = ns.questions.find(q => q.jobId === job.id && q.caseId === caseId && q.status === 'answered' && !(q as any).applied);
    let decision: string | undefined; let confidence = 0; let handledBy: CaseOutcome['handledBy'] = 'ready-made'; let reason = '';
    let traceRoute: 'procedure' | 'ready-made' | 'agent' | 'person' | 'agent-unavailable' = 'ready-made'; let trace: TraceStep[] = [{ kind: 'calculate', tool: 'calculator.aging', outcome: 'ok', durationMs: 0, units: 0 }];
    let agentCost = 0n; let latencyMs = 0; let note: string | undefined; let routeId: string | undefined; let tainted = false; let estimate = false;
    // A case already waiting for your answer waits: it is not decided, or sent to a model, again.
    if (!answered && ns.questions.some(q => q.jobId === job.id && q.caseId === caseId && q.status === 'open')) { work.cases.push({ ...base, status: 'waiting-for-you', reason: 'question-open' }); continue; }
    if (answered) { decision = answered.answer; confidence = 1; handledBy = 'person'; traceRoute = 'person'; reason = 'your-answer'; }
    else {
      // The ready-made rule's hard guards (not due, no agreement, stopped, reminded today, reminded often) come first;
      // only the cases it would remind or is unsure about may be routed through a learned procedure.
      const ready = readyMadeDecision(fields); reason = ready.reason;
      const guarded = !['overdue', 'long-overdue'].includes(ready.reason);
      const routed = proc && !guarded ? routeCase(proc, work_case) : undefined;
      if (guarded) { decision = ready.decision; confidence = ready.confidence; }
      else if (routed?.matched) { decision = routed.decision; confidence = routed.confidence; handledBy = 'procedure'; traceRoute = 'procedure'; reason = 'procedure'; }
      else {
        if (ready.confidence >= CONFIDENT) { decision = ready.decision; confidence = ready.confidence; }
        else {
          const agent = await askAgent(host, meter, job, work_case, RECEIVABLE_OPTIONS);
          if (agent.kind === 'budget') { work.stop = { rule: 'budget', reason: 'The step’s rupee reservation cannot cover another agent call.', leftUndone: cases.slice(index).map(c => `Invoice ${c.invoiceId}`) }; break; }
          if (agent.kind === 'untested') { work.stop = { rule: 'untested-route', reason: `This job was not tested on the route ${agent.routeId}. It needs ${job.testedRoutes?.[0] ?? 'a tested route'}.`, leftUndone: cases.slice(index).map(c => `Invoice ${c.invoiceId}`) }; break; }
          if (agent.kind === 'network') { work.waitingNetwork = true; work.cases.push({ ...base, status: 'waiting-network', reason: 'needs-model', handledBy: 'agent' }); continue; }
          if (agent.kind === 'approval') {
            // An outside send waits for the owner to approve its exact payload; this case waits with it.
            work.cases.push({ ...base, status: 'waiting-for-you', reason: 'model-request-approval', handledBy: 'agent' });
            await host.store.update(state => { const ns = lane(state); if (!ns.timeline.some(l => l.modelPreviewId === agent.previewId))
              pushTimeline(ns, entry(job.id, run, at, { kind: 'question', stepKind: 'lookup', needsModel: true, routeId: agent.routeId, text: 'A model request waits for your approval of its exact payload. Nothing was sent.', code: 'AGENT_APPROVAL_REQUIRED', modelPreviewId: agent.previewId, recordIds: [item.factId], caseId })); });
            continue;
          }
          if (agent.kind === 'answered') {
            handledBy = 'agent'; traceRoute = 'agent'; tainted = true; agentCost = agent.cost; latencyMs = agent.latencyMs; note = agent.note; routeId = agent.routeId; estimate = agent.estimate;
            for (const step of agent.steps) addStep(trace, step); confidence = agent.confidence; base.receiptIds = [...base.receiptIds, ...agent.receiptIds];
            decision = agent.decision && agent.confidence >= CONFIDENT ? agent.decision : 'ask-owner';
            if (agent.proposeJob) await proposeFromJob(host, ctx, job, agent.proposeJob);
          } else { decision = 'ask-owner'; traceRoute = 'agent-unavailable'; }
        }
      }
    }
    const outcome: CaseOutcome = { ...base, handledBy, decision, confidence, costMinor: String(agentCost), durationMs: latencyMs, reason };
    const lines: TimelineEntry[] = [];
    if (decision === 'remind') {
      const sent = peekLane(host.store.read()).reminders; const settings = peekLane(host.store.read()).settings;
      // A procedure, an agent or an answer never overrides the customer's agreement or the caps.
      if (consentCode !== 'yes') { outcome.status = 'blocked'; outcome.reason = consentCode === 'stopped' ? 'stopped-by-customer' : 'no-agreement'; }
      else if (sent.filter(r => r.day === today).length >= settings.reminderPerDay) { outcome.status = 'blocked'; outcome.reason = 'daily-cap'; }
      else if (sent.filter(r => r.day === today && r.customerId === item.customerId).length >= settings.reminderPerCustomerPerDay) { outcome.status = 'blocked'; outcome.reason = 'customer-cap'; }
      else {
        // Anything an agent touched is marked as read from outside: its send always waits for a person.
        const prepared = await prepareReminder(host, tainted ? { ...ctx, sourceTainted: true } : ctx, { invoiceId: item.invoiceId, customerId: item.customerId, text: reminderText(item.invoiceId), channel: 'mail', idempotencyKey: reminderKey(meta, job.id, item.invoiceId, today), sourceIds: [item.sourceId] });
        addStep(trace, { kind: 'question', tool: 'question.decision', outcome: 'ok', durationMs: 0, units: 0 });
        if (!prepared.prepared) { outcome.status = 'blocked'; outcome.reason = prepared.reason; }
        else {
          outcome.actionIds = [...new Set([...outcome.actionIds, prepared.actionId])]; outcome.reason = prepared.via;
          trace.push({ kind: 'action', tool: prepared.via === 'writeback' ? 'action.writeback.payment-reminder' : 'action.local.reminder-draft', outcome: 'ok', durationMs: 0, units: 0 });
          lines.push(entry(job.id, run, at, { kind: 'step', stepKind: 'action', needsModel: false, text: prepared.via === 'writeback' ? 'Prepared a reminder. It waits for your yes before it is sent.' : 'Prepared a reminder draft. Nothing is sent from a draft.', recordIds: [item.factId], actionIds: [prepared.actionId], receiptIds: [receipt.id], caseId }));
        }
      }
    } else if (decision === 'ask-owner') { outcome.status = 'waiting-for-you'; addStep(trace, { kind: 'question', tool: 'question.decision', outcome: 'ok', durationMs: 0, units: 0 }); }
    else if (decision === 'stop') { outcome.status = 'done'; outcome.reason = 'stopped-by-you'; }
    else if (decision === 'call') { outcome.status = 'waiting-for-you'; outcome.reason = 'call-the-customer'; }
    else if (['no-agreement', 'stopped-by-customer'].includes(reason) && handledBy === 'ready-made') { outcome.status = 'blocked'; outcome.reason = reason; addStep(trace, { kind: 'question', tool: 'question.decision', outcome: 'ok', durationMs: 0, units: 0 }); }
    else { outcome.status = fields.daysOverdue as number <= 0 ? 'not-due' : 'done'; addStep(trace, { kind: 'question', tool: 'question.decision', outcome: 'ok', durationMs: 0, units: 0 }); }
    if (routeId) lines.unshift(entry(job.id, run, at, { kind: 'step', stepKind: 'lookup', needsModel: true, routeId, costMinor: String(agentCost), costEstimate: estimate, durationMs: latencyMs, text: 'The agent looked at a case the rule was not sure of.', recordIds: [item.factId], caseId }));
    await host.store.update(state => {
      const ns = lane(state);
      if (answered) { const q = ns.questions.find(x => x.id === answered.id); if (q) (q as any).applied = true; }
      if (outcome.status === 'waiting-for-you' && outcome.reason !== 'call-the-customer' && !ns.questions.some(q => q.jobId === job.id && q.caseId === caseId && q.status === 'open')) {
        const question = { id: newId('jobsx_question'), jobId: job.id, caseId, askedAt: at, prompt: `Invoice ${item.invoiceId} is long overdue or was reminded several times. What should the job do?`, options: ['remind', 'stop', 'call'],
          ...(decision === 'ask-owner' && confidence > 0 ? {} : {}), status: 'open' as const, sourceIds: [item.sourceId] };
        ns.questions.push(question); bound(ns.questions, 2000, q => q.status !== 'open'); lines.push(entry(job.id, run, at, { kind: 'question', stepKind: 'question', needsModel: false, text: 'A question waits for you.', recordIds: [item.factId], caseId }));
      }
      if (outcome.reason === 'call-the-customer' && !ns.personSteps.some(p => p.jobId === job.id && p.title.endsWith(item.invoiceId) && p.status === 'waiting')) {
        ns.personSteps.push({ id: newId('jobsx_person'), jobId: job.id, recordIds: [item.factId], title: `Call the customer about invoice ${item.invoiceId}`, assignee: job.ownerId, status: 'waiting', createdAt: at }); bound(ns.personSteps, 2000, p => p.status === 'done');
        lines.push(entry(job.id, run, at, { kind: 'person-step', text: 'A step for a person: call the customer. The job does not mark it done by itself.', recordIds: [item.factId], caseId }));
      }
      if (outcome.status === 'blocked') lines.push(entry(job.id, run, at, { kind: 'stopped-by-rule', text: { 'no-agreement': 'No reminder: this customer has not agreed to reminders by mail.', 'stopped-by-customer': 'No reminder: the customer replied with the stop word.', 'daily-cap': 'The daily cap for reminders is reached. The rest wait until tomorrow.', 'customer-cap': 'This customer already has a reminder today.', 'needs-review': 'No reminder: the invoice is disputed or its records are incomplete. Look at it first.', 'nothing-due': 'No reminder: nothing is due on this invoice in the books.', 'already-done': 'This reminder is already in the system. Nothing more was prepared.' }[outcome.reason as string] ?? 'Stopped by a rule.', code: (outcome.reason ?? 'rule').toUpperCase().replace(/-/g, '_'), recordIds: [item.factId], caseId }));
      for (const line of lines) pushTimeline(ns, line);
      for (const id of outcome.actionIds.filter(a => !(prior?.actionIds ?? []).includes(a))) { ns.reminders.push({ customerId: item.customerId, invoiceId: item.invoiceId, day: today, actionId: id, jobId: job.id, key: reminderKey(meta, job.id, item.invoiceId, today), ownerId: job.ownerId }); bound(ns.reminders, 5000); }
      recordRun(state, ctx, { at, jobId: job.id, template: meta.template, caseId, route: traceRoute, ...(proc && traceRoute === 'procedure' ? { procedureId: proc.id } : {}), ...(routeId ? { routeId } : {}),
        ...(decision ? { decision } : {}), confidence, features: fields, steps: trace, costMinor: String(agentCost), latencyMs, outcome: outcome.status === 'waiting-for-you' ? 'waiting' : outcome.status === 'blocked' ? 'refused' : 'ok', ...(note ? { note } : {}), sourceIds: [item.sourceId] } as any);
    });
    work.cases.push(outcome);
  }
  const all = { ...meta.cases }; for (const item of work.cases) all[item.caseId] = item;
  const values = Object.values(all);
  work.done.push(`${values.filter(c => c.actionIds.length).length} invoices have a prepared reminder; ${values.filter(c => c.status === 'paid').length} were paid since the job began.`);
  const waiting = values.filter(c => c.status === 'waiting-for-you').length; if (waiting) work.open.push(`${waiting} invoices wait for your answer.`);
  const blocked = values.filter(c => c.status === 'blocked').length; if (blocked) work.open.push(`${blocked} invoices could not be reminded because of a rule (agreement or cap).`);
  if (values.some(c => c.status === 'blocked' && c.reason === 'no-agreement')) work.recommendations.push('Record each customer’s agreement to reminders when they give it.');
  work.goalMet = values.length > 0 && cases.every(c => BigInt(c.outstandingMinor) === 0n);
  return work;
}

async function figuresStep(host: ModuleHost, ctx: Context, job: Job, tpl: JobTemplate, run: number, gst?: LaneJob['gstSources']): Promise<StepWork> {
  const at = nowIso(host); const today = dayOf(at); const sources = job.sourceIds.length ? { sourceIds: [...job.sourceIds] } : {};
  const work: StepWork = { figures: [], receiptIds: [], done: [], open: [], recommendations: [], cases: [] };
  const weekAgo = dayOf(new Date(Date.parse(at) - 6 * 86_400_000).toISOString());
  const requests: Record<string, Record<string, unknown>> = {
    received: { operation: 'received', period: { from: `${today.slice(0, 8)}01`, to: today }, ...sources },
    aging: { operation: 'aging', onDate: today, ...sources },
    net_sales: { operation: 'net_sales', period: { from: weekAgo, to: today }, ...sources },
    margin: { operation: 'margin', period: { from: weekAgo, to: today }, ...sources },
    stock_on_hand: { operation: 'stock_on_hand', ...sources },
  };
  for (const operation of tpl.requires.operations) {
    const receipt = await calculate(host, ctx, requests[operation] ?? { operation, ...sources });
    work.receiptIds.push(receipt.id);
    for (const item of receipt.figures as any[]) if (operation !== 'aging' || ['outstanding', 'unallocated'].includes(item.key)) work.figures.push(figure(receipt, item.key)!);
    for (const gap of (receipt.coverage?.gaps ?? []) as string[]) if (!work.open.includes(gap)) work.open.push(gap);
    await host.store.update(state => pushTimeline(lane(state), entry(job.id, run, at, { kind: 'step', stepKind: 'calculate', needsModel: false, text: `Calculated ${operation.replace(/_/g, ' ')} with a receipt.`, receiptIds: [receipt.id], costMinor: '0' })));
  }
  if (tpl.requires.method) {
    // GST matching: last month's purchase register against GSTR-2B, through the connectors lane.
    const first = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)); const last = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0));
    const payload = gst ? { registerSourceId: gst.registerSourceId, gstr2bSourceId: gst.gstr2bSourceId, period: { from: dayOf(first.toISOString()), to: dayOf(last.toISOString()) } } : sources;
    let reply;
    try { reply = await optionalCall<any>(host, tpl.requires.method, payload); }
    catch (error) {
      if ((error as { code?: string }).code !== 'GST_MATCH_SOURCES_EMPTY') throw error;
      reply = { available: true as const, value: { mode: 'empty' } };
    }
    if (!reply.available) { work.stop = { rule: 'needs-another-part', reason: 'This job needs a part of Chausar that is not built yet.', leftUndone: tpl.steps.map(s => s.title) }; return work; }
    const counts = reply.value?.counts; const count = (key: string) => Number.isSafeInteger(counts?.[key]) && counts[key] >= 0 ? counts[key] as number : null;
    if (reply.value?.mode === 'not-applicable') work.done.push('GST matching does not apply to this business’s registration.');
    else if (reply.value?.mode === 'empty') work.open.push('Last month’s purchase register or GSTR-2B has no imported purchases yet. A source not loaded is not matched as empty.');
    else if (['matched', 'amountMismatch', 'inBooksOnly', 'in2bOnly', 'probable', 'invalid'].every(key => count(key) !== null)) {
      work.done.push(`${count('matched')} purchase lines match GSTR-2B. ${count('amountMismatch')} differ in amount, ${count('inBooksOnly')} are in your books only, ${count('in2bOnly')} are in GSTR-2B only, ${count('probable')} are probable matches for you to confirm and ${count('invalid')} were set aside.`);
      if (count('inBooksOnly')! > 0) work.recommendations.push('Ask the suppliers of the lines in your books only to report them: their input tax credit is at risk until they do.');
    } else work.open.push('The match ran; its counts were not readable.');
  }
  if (tpl.steps.some(s => s.kind === 'person')) work.personStep = tpl.steps.find(s => s.kind === 'person')!.title;
  work.done.push(`${work.figures.length} figures were calculated, each with its receipt.`);
  return work;
}

async function agentStep(host: ModuleHost, ctx: Context, job: Job, meta: LaneJob, meter: Meter, run: number): Promise<StepWork> {
  const at = nowIso(host); const work: StepWork = { figures: [], receiptIds: [], done: [], open: [], recommendations: [], cases: [] };
  const item: WorkCase = { id: `run-${run}`, jobId: job.id, template: meta.template, fields: { run }, recordIds: [], sourceIds: [...job.sourceIds], tainted: true };
  const answer = await askAgent(host, meter, job, item, ['done', 'needs-you']);
  if (answer.kind === 'none') { work.stop = { rule: 'needs-another-part', reason: 'No agent route is installed for jobs in your own words.', leftUndone: [job.goal] }; return work; }
  if (answer.kind === 'approval') {
    work.open.push('A model request waits for your approval of its exact payload. Nothing was sent.');
    work.cases.push({ caseId: item.id, recordIds: [], handledBy: 'agent', status: 'waiting-for-you', reason: 'model-request-approval', actionIds: [], receiptIds: [], costMinor: '0', durationMs: 0 });
    await host.store.update(state => pushTimeline(lane(state), entry(job.id, run, at, { kind: 'question', stepKind: 'lookup', needsModel: true, routeId: answer.routeId, text: 'A model request waits for your approval of its exact payload. Nothing was sent.', code: 'AGENT_APPROVAL_REQUIRED', modelPreviewId: answer.previewId, caseId: item.id })));
    return work;
  }
  if (answer.kind === 'network') { work.waitingNetwork = true; return work; }
  if (answer.kind === 'untested') { work.stop = { rule: 'untested-route', reason: `This job was not tested on the route ${answer.routeId}. It needs ${job.testedRoutes?.[0] ?? 'a tested route'}.`, leftUndone: [job.goal] }; return work; }
  if (answer.kind === 'budget') { work.stop = { rule: 'budget', reason: 'The step’s rupee reservation cannot cover the agent call.', leftUndone: [job.goal] }; return work; }
  if (answer.proposeJob) await proposeFromJob(host, ctx, job, answer.proposeJob);
  const outcome: CaseOutcome = { caseId: item.id, recordIds: [], handledBy: 'agent', decision: answer.decision, confidence: answer.confidence, status: answer.decision === 'done' && answer.confidence >= CONFIDENT ? 'done' : 'waiting-for-you', actionIds: [], receiptIds: [], costMinor: String(answer.cost), durationMs: answer.latencyMs };
  work.cases.push(outcome);
  if (answer.note) work.done.push(`The agent’s note (quoted, not checked): “${answer.note}”`);
  if (outcome.status !== 'done') work.open.push('The agent was not sure the goal is met. Read its note before you accept.');
  await host.store.update(state => {
    pushTimeline(lane(state), entry(job.id, run, at, { kind: 'step', stepKind: 'lookup', needsModel: true, routeId: answer.routeId, costMinor: String(answer.cost), costEstimate: answer.estimate, durationMs: answer.latencyMs, text: 'The agent worked on the goal. It read text, so any send it suggests waits for you.', caseId: item.id }));
    recordRun(state, ctx, { at, jobId: job.id, template: meta.template, caseId: item.id, route: 'agent', routeId: answer.routeId, ...(answer.decision ? { decision: answer.decision } : {}), confidence: answer.confidence, features: item.fields, steps: answer.steps, costMinor: String(answer.cost), latencyMs: answer.latencyMs, outcome: 'ok', ...(answer.note ? { note: answer.note } : {}), sourceIds: [...job.sourceIds] } as any);
  });
  return work;
}

/** A job may ask for another job; that proposal always waits for the owner's yes. */
export async function proposeFromJob(host: ModuleHost, ctx: Context, job: Job, sentence: string) {
  const { proposeCard } = await import('./proposals.ts');
  // Model text is quoted on an untrusted card and number-guarded; it never becomes an instruction.
  const quoted = guardNote(sentence);
  try { await proposeCard(host, ctx, { sentence: quoted.slice(0, 500), origin: 'job', fromJobId: job.id }); }
  catch (error) { await host.store.update(state => pushTimeline(lane(state), entry(job.id, 0, nowIso(host), { kind: 'note', text: 'The job asked for another job; the request was refused.', code: (error as any).code ?? 'REFUSED' }))); }
}

function settleState(job: Job, meta: LaneJob, code: string): { kind: TimelineEntry['kind']; text: string } | undefined {
  const last = [...job.ledger].reverse().find(item => ['catchup-skipped', 'budget-exhausted', 'stop-rule', 'calendar-expired', 'autonomy-disabled', 'approval-required', 'revoked'].includes(item.event));
  switch (last?.event ?? code) {
    case 'budget-exhausted': return { kind: 'budget', text: 'Stopped by a rule: the budget. Another step would not fit what is left.' };
    case 'stop-rule': return { kind: 'stopped-by-rule', text: 'Stopped by a rule: its last date or its number of runs was reached.' };
    case 'autonomy-disabled': return { kind: 'note', text: 'Waiting: jobs run on their own only when “run on its own” is on in Trust.' };
    case 'approval-required': return { kind: 'note', text: 'Waiting for your approval of this job.' };
    case 'revoked': return { kind: 'note', text: 'Paused: the job’s owner changed. It needs a new owner.' };
    default: return undefined;
  }
}

/** Runs one due step of a lane job as its pinned owner. */
export async function runLaneJob(ctx: Context, host: ModuleHost, jobId: string): Promise<RunReport> {
  const jobs = jobsOf(host); const before = jobs.find(host.store.read(), jobId);
  check(isLaneJob(before), 'NOT_LANE_JOB', 'This job is not run by the jobs lane.');
  check(ownsJob(ctx, before), 'JOB_OWNER_REQUIRED', 'Only the job’s owner runs it.');
  const meta0 = peekLane(host.store.read()).jobs[jobId]; check(meta0 && !meta0.deletedAt, 'NOT_FOUND', 'Job not found.');
  if (meta0.setAside) return { jobId, status: 'set-aside' };
  if (meta0.waitingFor && peekLane(host.store.read()).personSteps.some(s => s.id === meta0.waitingFor && s.status === 'waiting')) {
    // Resumed elsewhere while a person's step still waits: it goes back to waiting; the job never skips the step.
    if (!['paused', 'awaiting-acceptance', 'accepted', 'stopped', 'cancelled', 'revoked'].includes(before.status) && !before.lease) await jobs.pause(ctx, jobId);
    return { jobId, status: 'waiting-for-person' };
  }
  const at = nowIso(host);
  const catchUp = decide(meta0.missedRule, before.nextRunAt, before.intervalMs, before.graceMs, jobs.clock());
  const acquired = await jobs.acquire(ctx, jobId, WORKER, LEASE_MS);
  if (acquired.status !== 'running' || !acquired.lease) {
    const raw = jobs.find(host.store.read(), jobId);
    await host.store.update(state => {
      const ns = lane(state); const meta = ns.jobs[jobId]; if (!meta) return;
      const lastSkip = [...raw.ledger].reverse().find(item => item.event === 'catchup-skipped');
      if (catchUp.missed > 0 && lastSkip && lastSkip.at >= at) recordMissed(ns, jobId, at, catchUp.missed, 0, meta.missedRule, catchUp.text);
      const settled = settleState(raw, meta, raw.status);
      if (settled) {
        const previous = [...ns.timeline].reverse().find(item => item.jobId === jobId);
        if (previous?.text !== settled.text) pushTimeline(ns, entry(jobId, meta.stepsDone, at, { kind: settled.kind, text: settled.text, code: raw.status.toUpperCase().replace(/-/g, '_') }));
        if (settled.kind === 'budget' || settled.kind === 'stopped-by-rule') meta.stoppedBy = { at, rule: settled.kind === 'budget' ? 'budget' : 'stop-rule', reason: settled.text, leftUndone: leftUndone(meta) };
      }
    });
    return { jobId, status: raw.status };
  }
  const lease: LeaseRef = { token: acquired.lease.token, workerId: acquired.lease.workerId, fence: acquired.lease.fence };
  const run = (meta0.runCounter ?? 0) + 1;
  try {
    const job = jobs.find(host.store.read(), jobId); const tpl = template(meta0.template);
    await host.store.update(state => {
      const ns = lane(state); const meta = ns.jobs[jobId]; meta.runCounter = run;
      // The backlog of "run every missed one" is spent only when a caught-up run is accepted.
      if (catchUp.missed > 0) { recordMissed(ns, jobId, at, catchUp.missed, catchUp.ran, meta.missedRule, catchUp.text); if (meta.backlog === 0) meta.backlog = catchUp.backlog; }
      pushTimeline(ns, entry(jobId, run, at, { kind: 'run-started', text: `Step ${meta.stepsDone + 1} of ${tpl.stepsPerDelivery} started.` }));
    });
    const meter = new Meter(host, ctx, job, lease);
    const meta = peekLane(host.store.read()).jobs[jobId];
    const work = meta.pending ? await resumePending(meta) : tpl.caseSource === 'unpaid-invoices' ? await receivablesStep(host, ctx, job, meta, meter, run)
      : tpl.caseSource === 'goal' ? await agentStep(host, ctx, job, meta, meter, run) : await figuresStep(host, ctx, job, tpl, run, meta.gstSources);
    return await finishStep(ctx, host, job, tpl, lease, run, work);
  } catch (error) {
    return failStep(host, jobId, lease, run, error);
  }
}

async function resumePending(meta: LaneJob): Promise<StepWork> {
  const pending = structuredClone(meta.pending!) as StepWork; delete pending.personStep; return pending;
}

function recordMissed(ns: JobsExtState, jobId: string, at: string, missed: number, ran: number, rule: LaneJob['missedRule'], text: string) {
  ns.missed.push({ id: newId('jobsx_missed'), jobId, at, missed, ran, rule, text, seen: false });
  if (ns.missed.length > 1000) ns.missed.splice(0, ns.missed.length - 1000);
  pushTimeline(ns, entry(jobId, 0, at, { kind: 'missed', text }));
}

function leftUndone(meta: LaneJob): string[] {
  return Object.values(meta.cases).filter(c => !['done', 'paid', 'not-due'].includes(c.status)).map(c => `Case ${c.caseId.split(':')[0]}`);
}

async function finishStep(ctx: Context, host: ModuleHost, job: Job, tpl: JobTemplate, lease: LeaseRef, run: number, work: StepWork): Promise<RunReport> {
  const jobs = jobsOf(host); const at = nowIso(host);
  if (work.stop || work.waitingNetwork) {
    await host.store.update(state => {
      const raw = jobs.find(state, job.id); jobs.validateLease(raw, lease); const ns = lane(state); const meta = ns.jobs[job.id];
      for (const item of work.cases) meta.cases[item.caseId] = item;
      if (work.waitingNetwork) {
        jobs.interrupt(raw, 'scheduled', 'jobsx-waiting-network'); raw.nextRunAt = new Date(jobs.clock() + NETWORK_RETRY_MS).toISOString();
        pushTimeline(ns, entry(job.id, run, at, { kind: 'waiting-network', needsModel: true, text: `Waiting for the network. The steps that need no model finished. Resumes at ${raw.nextRunAt}.`, code: 'NETWORK_WAIT' }));
      } else {
        jobs.interrupt(raw, 'paused', `jobsx-stopped-${work.stop!.rule}`);
        meta.stoppedBy = { at, rule: work.stop!.rule, reason: work.stop!.reason, leftUndone: work.stop!.leftUndone };
        pushTimeline(ns, entry(job.id, run, at, { kind: work.stop!.rule === 'budget' ? 'budget' : work.stop!.rule === 'untested-route' ? 'route-untested' : 'stopped-by-rule', text: `Stopped by a rule: ${work.stop!.reason}`, code: work.stop!.rule.toUpperCase().replace(/-/g, '_') }));
        audit(state, 'jobsx.stopped', { jobId: job.id, rule: work.stop!.rule });
      }
      meta.consecutiveFailures = 0;
    });
    return { jobId: job.id, status: work.waitingNetwork ? 'network-wait' : 'paused', code: work.stop?.rule };
  }
  if (work.personStep) {
    await host.store.update(state => {
      const raw = jobs.find(state, job.id); jobs.validateLease(raw, lease); const ns = lane(state); const meta = ns.jobs[job.id];
      const step = { id: newId('jobsx_person'), jobId: job.id, title: work.personStep!, assignee: job.ownerId, status: 'waiting' as const, createdAt: at };
      ns.personSteps.push(step); bound(ns.personSteps, 2000, p => p.status === 'done'); meta.pending = { ...structuredClone(work), personStep: undefined } as any; delete (meta.pending as any).personStep; meta.waitingFor = step.id;
      jobs.interrupt(raw, 'paused', 'jobsx-person-step'); meta.consecutiveFailures = 0;
      pushTimeline(ns, entry(job.id, run, at, { kind: 'person-step', text: `A step for a person: ${work.personStep}. The job waits and does not mark it done by itself.` }));
    });
    return { jobId: job.id, status: 'waiting-for-person' };
  }
  const meta = peekLane(host.store.read()).jobs[job.id];
  const stepsDone = meta.stepsDone + 1; const anchor = job.scheduleAnchor ?? job.createdAt;
  const following = nextSlot(anchor, job.intervalMs, jobs.clock());
  const lastPossible = Date.parse(following) >= Date.parse(job.stopRule.deadline) - job.graceMs;
  const deliver = stepsDone >= tpl.stepsPerDelivery || work.goalMet === true || lastPossible;
  if (!deliver) {
    await host.store.update(state => {
      const raw = jobs.find(state, job.id); jobs.validateLease(raw, lease); const ns = lane(state); const m = ns.jobs[job.id];
      for (const item of work.cases) m.cases[item.caseId] = item; m.stepsDone = stepsDone; m.consecutiveFailures = 0;
      m.stepFigures = [...(m.stepFigures ?? []), ...work.figures].slice(-200); m.stepReceipts = [...new Set([...(m.stepReceipts ?? []), ...work.receiptIds])].slice(-200);
      jobs.interrupt(raw, 'scheduled', 'jobsx-step-done'); raw.nextRunAt = following;
      pushTimeline(ns, entry(job.id, run, at, { kind: 'note', text: `Step ${stepsDone} of ${tpl.stepsPerDelivery} is done. Next step at ${following}.`, receiptIds: work.receiptIds }));
    });
    return { jobId: job.id, status: 'scheduled', step: stepsDone };
  }
  return deliverResult(ctx, host, job, lease, run, work, stepsDone);
}

/** The child-result rule: a job cannot deliver while any case it took on has no result. */
export function missingChildren(expected: readonly string[], cases: Record<string, CaseOutcome>): string[] {
  return expected.filter(id => !cases[id]);
}

async function deliverResult(ctx: Context, host: ModuleHost, job: Job, lease: LeaseRef, run: number, work: StepWork, stepsDone: number): Promise<RunReport> {
  const jobs = jobsOf(host); const at = nowIso(host);
  const meta = peekLane(host.store.read()).jobs[job.id];
  const cases = { ...meta.cases }; for (const item of work.cases) cases[item.caseId] = item;
  const missing = missingChildren(work.cases.map(c => c.caseId), cases);
  check(missing.length === 0, 'JOB_INCOMPLETE', 'A child result is missing, so the job stays open.');
  const figures = [...(meta.stepFigures ?? []).filter(f => !work.figures.some(w => w.key === f.key)), ...work.figures];
  const receiptIds = [...new Set([...(meta.stepReceipts ?? []), ...work.receiptIds])];
  const body = { jobId: job.id, run, deliveredAt: at, done: work.done, open: work.open, recommendations: work.recommendations, figures, cases: Object.values(cases), receiptIds, sourceIds: [...job.sourceIds] };
  const result: LaneResult = { ...body, digest: digest(body) };
  const raw = jobs.find(host.store.read(), job.id); const charged = raw.lease?.chargedMinor ?? '0';
  await jobs.complete(ctx, job.id, lease, { kind: 'jobsx-result', digest: result.digest, run }, charged);
  await host.store.update(state => {
    const ns = lane(state); const m = ns.jobs[job.id];
    ns.results.push(result); if (ns.results.length > 500) ns.results.splice(0, ns.results.length - 500);
    m.stepsDone = 0; m.cases = {}; m.consecutiveFailures = 0; delete m.pending; delete m.waitingFor; m.stepFigures = []; m.stepReceipts = []; m.deliveries = (m.deliveries ?? 0) + 1;
    pushTimeline(ns, entry(job.id, run, at, { kind: 'delivered', text: `The result is ready after ${stepsDone} ${stepsDone === 1 ? 'step' : 'steps'}. The job is finished only when you accept it. Cost so far: ${rupees(jobs.find(state, job.id).spentMinor)}.`, receiptIds }));
    audit(state, 'jobsx.delivered', { jobId: job.id, run });
  });
  return { jobId: job.id, status: 'awaiting-acceptance', delivered: true };
}

async function failStep(host: ModuleHost, jobId: string, lease: LeaseRef, run: number, error: unknown): Promise<RunReport> {
  const jobs = jobsOf(host); const at = nowIso(host); const code = error instanceof ChausarError ? error.code : 'JOB_STEP_FAILED';
  let setAside = false;
  await host.store.update(state => {
    const raw = jobs.find(state, jobId); const ns = lane(state); const meta = ns.jobs[jobId];
    meta.consecutiveFailures += 1; setAside = meta.consecutiveFailures >= meta.failureLimit;
    if (raw.lease?.token === lease.token) jobs.interrupt(raw, setAside ? 'paused' : 'scheduled', setAside ? 'jobsx-set-aside' : 'jobsx-failed');
    if (!setAside && raw.status === 'scheduled') raw.nextRunAt = new Date(jobs.clock() + Math.min(raw.intervalMs, 15 * 60_000) * meta.consecutiveFailures).toISOString();
    pushTimeline(ns, entry(jobId, run, at, { kind: 'note', text: 'The step failed. Nothing was sent.', code }));
    if (setAside) {
      meta.setAside = { at, reason: code };
      pushTimeline(ns, entry(jobId, run, at, { kind: 'set-aside', text: `Set aside after ${meta.consecutiveFailures} failed runs in a row. It waits until you look at it.`, code }));
      audit(state, 'jobsx.set-aside', { jobId, code });
    }
  });
  return { jobId, status: setAside ? 'set-aside' : 'scheduled', code };
}

/** Logs an owner's decision about a delivered result, structure only. */
export function logResultDecision(state: State, ctx: Context, job: Job, choice: 'accepted' | 'rejected') {
  appendLearningDecision(state, ctx, { kind: 'action', choice, reasonCode: 'manual_confirmation', sourceIds: [...job.sourceIds] });
}
