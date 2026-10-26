// Chausar venture launcher, money (Ink v2 wave 4, package 4A1; spec 5.1): AI and tool spend by department, what calls
// still running hold, and the jobs each department did, as sum receipt plans (money/sums.ts serves their receipts).
// Spend is counted exactly as Money's figure and the monthly limit count it (sums.ts spentPlan, spend.ts spendOfMonth):
// by the UTC day of the call, settled calls at what they settled at, calls running or whose answer never came at their
// estimate. Every paid call of the month lands in exactly one part, so the five departments and "Shared by the team"
// always add up to Money's figure, in BigInt, while a call runs and in the first hours of a month alike. Code decides
// the part from the records, never by guess:
// - a call that made a harness turn is that turn's role's (playbooks/departments.ts roleOfTurn);
// - a call a run is on now is the drafting role's when the run is writing its reply, else the team's;
// - on the eight fixed steps, every call of the one agent is its department's (the plan's service type);
// - everything else (a turn no single role can claim, plan writing, judges, practice clients) is shared.
// Jobs: delivery runs that reached review or later (on the owner's day of the verdict, else of their last event), and
// finished rehearsals, each counted once, in the department of the role that drafts the reply. Keeper's job runs are
// not department work; they show on Keeper's own card. A TeamLedger works each run's steps, drafting step and each
// call's part out once per request, so a read of the team stays linear in the size of the business.
import type { State } from '../../contracts.ts';
import type {
  DeliveryRunRecord, DepartmentId, IsoDate, PlaybookStep, SpendRecord, SumReceiptSubject, VentureRecord,
} from '../contracts.ts';
import { formatMicros, formatVentureDate, listRecords } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { acceptedBlueprintOrNull, serviceTypeOf } from '../delivery/shared.ts';
import type { FlagshipDelivery } from '../playbooks/steps.ts';
import { departmentName, departmentOfRole, departmentOfService, roleOfTurn, SHARED_NAME } from '../playbooks/departments.ts';
import { countedMicros, dollarsLead, rupeeFigure, rupeeRateWords, spendRow, type Rupees } from './spend.ts';
import type { Addend, SumPlan } from './sums.ts';
import { playbookInUse, teamFlagship } from '../views/team-shape.ts';
import { AGENT_ID, AGENT_PURPOSES } from '../views/shared.ts';

/** Delivery run statuses that reached ready-for-review or later: a job done. */
const DONE_STATUSES: readonly DeliveryRunRecord['status'][] = ['ready-for-review', 'accepted', 'edited', 'rejected'];

export type SpendWhere = DepartmentId | 'shared';
type Job = { recordId: string; at: string; label: string; department: DepartmentId };
type Turn = NonNullable<DeliveryRunRecord['harness']>['turns'][number];

/** What one request works out once: the team's flagship, each run's steps and drafting step, each call's part, the jobs. */
export type TeamLedger = {
  state: State;
  venture: VentureRecord;
  flagship: FlagshipDelivery | null;
  /** The playbooks by id, each order's flagship offer, and the playbook in use's steps, read once. */
  playbooks: Map<string, PlaybookStep[]>;
  offerKeys: Map<string, string | null>;
  inUse: PlaybookStep[] | null;
  steps: Map<string, PlaybookStep[]>;
  drafts: Map<string, string | null>;
  where: Map<string, SpendWhere> | null;
  counted: SpendRecord[] | null;
  jobs: Job[] | null;
};

/** A fresh ledger for one request over one state. Plans called on their own (a receipt read later) make their own. */
export function teamLedger(state: State, venture: VentureRecord): TeamLedger {
  const plan = acceptedBlueprintOrNull(state, venture);
  const offers = new Map((plan?.offers ?? []).map(offer => [offer.id, offer.playbookOffer ?? null]));
  return {
    state, venture, flagship: teamFlagship(state, venture),
    playbooks: new Map(listRecords(state, 'venture-playbook', venture.id).map(record => [record.id, record.steps])),
    offerKeys: new Map(listRecords(state, 'venture-order', venture.id).map(order => [order.id, offers.get(order.offerId) ?? null])),
    inUse: playbookInUse(state, venture)?.steps ?? null,
    steps: new Map(), drafts: new Map(), where: null, counted: null, jobs: null,
  };
}

/** The steps a run followed: its own playbook's, else the playbook in use's, else the flagship's own. */
export function runStepsIn(ledger: TeamLedger, run: Pick<DeliveryRunRecord, 'id' | 'playbookId'>): PlaybookStep[] {
  const known = ledger.steps.get(run.id);
  if (known) return known;
  const steps = ledger.playbooks.get(run.playbookId) ?? ledger.inUse ?? (ledger.flagship ? [...ledger.flagship.steps] : []);
  ledger.steps.set(run.id, steps);
  return steps;
}

/** The step that drafts a run's reply, as delivery/playbook.ts flagshipDraft picks it; null on the eight fixed steps. */
export function draftStepIn(ledger: TeamLedger, run: Pick<DeliveryRunRecord, 'id' | 'playbookId' | 'orderId'>): string | null {
  if (!ledger.flagship) return null;
  if (ledger.drafts.has(run.id)) return ledger.drafts.get(run.id)!;
  const steps = runStepsIn(ledger, run);
  const offerKey = ledger.offerKeys.get(run.orderId) ?? null;
  const id = ledger.flagship.draftStep(offerKey);
  const step = steps.some(item => item.id === id && item.kind === 'write') ? id : steps.find(item => item.kind === 'write')?.id ?? null;
  ledger.drafts.set(run.id, step);
  return step;
}

/** A team member's department: a flagship role's from the map, the one agent's from the service type. */
export function departmentOfMember(ledger: TeamLedger, memberId: string): DepartmentId {
  return ledger.flagship ? departmentOfRole(ledger.flagship, memberId) : departmentOfService(serviceTypeOf(ledger.state, ledger.venture));
}

/** The department of the role that drafts a run's reply (a rehearsal: the playbook's usual drafting step). */
function draftingDepartment(ledger: TeamLedger, run: DeliveryRunRecord | null): DepartmentId {
  const flagship = ledger.flagship;
  if (!flagship) return departmentOfService(serviceTypeOf(ledger.state, ledger.venture));
  const step = run ? draftStepIn(ledger, run) : flagship.draftStep(null);
  const role = step ? flagship.roleOf[step] : undefined;
  return role ? departmentOfRole(flagship, role) : 'operations';
}

// ---------------------------------------------------------------------------
// Which part a paid call belongs to
// ---------------------------------------------------------------------------

/** Each spend record's part, worked out once per ledger. */
function wheres(ledger: TeamLedger): Map<string, SpendWhere> {
  if (ledger.where) return ledger.where;
  const { state, venture, flagship } = ledger;
  const turns = new Map<string, { run: DeliveryRunRecord; turn: Turn }>();
  const runs = new Map<string, DeliveryRunRecord>();
  for (const run of listRecords(state, 'venture-delivery-run', venture.id)) {
    if (run.callId) runs.set(run.callId, run);
    for (const turn of run.harness?.turns ?? []) if (turn.callId) turns.set(turn.callId, { run, turn });
  }
  const service = departmentOfService(serviceTypeOf(state, venture));
  // Model calls by id, read once, so whose call it was (spend.ts spendAgentOf's rule) needs no search per record.
  const purposes = new Map<string, unknown>();
  for (const record of state.conversations as { kind?: unknown; id?: unknown; purpose?: unknown }[]) {
    if (record?.kind === 'venture-model-call' && typeof record.id === 'string') purposes.set(record.id, record.purpose);
  }
  const agentsCall = (spend: SpendRecord): boolean => {
    if (spend.agent) return spend.agent === AGENT_ID;
    if (spend.item.startsWith('delegate:')) return true;
    if (!spend.item.startsWith('model:') || !spend.key.startsWith('model:')) return false;
    const purpose = purposes.get(spend.key.slice('model:'.length));
    return typeof purpose === 'string' && AGENT_PURPOSES.includes(purpose);
  };
  const whereOf = (spend: SpendRecord): SpendWhere => {
    if (!flagship) return agentsCall(spend) ? service : 'shared';
    const callId = spend.ref ?? (spend.key.startsWith('model:') ? spend.key.slice('model:'.length) : null);
    if (!callId) return 'shared';
    const made = turns.get(callId);
    if (made) {
      const role = roleOfTurn(flagship, runStepsIn(ledger, made.run), made.turn, draftStepIn(ledger, made.run));
      return role ? departmentOfRole(flagship, role) : 'shared';
    }
    const run = runs.get(callId);
    // The call a run is on now: the drafting role's while the run writes its reply (or drafts it in one go), else the team's.
    return run && (!run.harness || run.harness.phase === 'write') ? draftingDepartment(ledger, run) : 'shared';
  };
  ledger.where = new Map(listRecords(state, 'venture-spend', venture.id).map(record => [record.id, whereOf(record)]));
  return ledger.where;
}

/** The UTC day of a call: the spend limit's and Money's calendar. */
const utcDay = (at: string): IsoDate => at.slice(0, 10);
const inDays = (day: IsoDate, from: IsoDate, to: IsoDate) => day >= from && day <= to;
const partName = (where: SpendWhere | 'all') => (where === 'all' ? 'the whole team' : where === 'shared' ? SHARED_NAME : departmentName(where));

/** The first and last day of a 'YYYY-MM' month. */
export function monthDays(month: string): { from: IsoDate; to: IsoDate } {
  const [year, number] = month.split('-').map(part => parseInt(part, 10));
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** The paid calls of a part between two UTC days, both included, oldest first, that count toward the month (spendOfMonth's rule). */
function countedIn(ledger: TeamLedger, where: SpendWhere | 'all', from: IsoDate, to: IsoDate): SpendRecord[] {
  const parts = wheres(ledger);
  ledger.counted ??= listRecords(ledger.state, 'venture-spend', ledger.venture.id).filter(record => BigInt(countedMicros(record)) > 0n)
    .sort((a, b) => a.at.localeCompare(b.at));
  return ledger.counted.filter(record => inDays(utcDay(record.at), from, to) && (where === 'all' || parts.get(record.id) === where));
}

/** The `spent-department` receipt's addends as of now: each paid call of that department (or 'shared') between the UTC days. */
export function departmentSpendPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'spent-department' }>, ledger: TeamLedger = teamLedger(state, venture)): SumPlan {
  const addends: Addend[] = countedIn(ledger, subject.department, subject.from, subject.to).map(record => {
    const amount = countedMicros(record);
    const estimate = spendRow(record).kind === 'estimate';
    return { recordId: record.id, label: record.label, amount, display: `${formatMicros(amount)}${estimate ? ' (estimate)' : ''}`, estimate };
  });
  const name = partName(subject.department);
  return {
    subject, currency: 'USD', unit: 'micros', addends,
    words: { label: `AI and tools: ${name}`, one: 'paid call', many: 'paid calls', none: `No paid calls for ${name} in these days.` },
  };
}

/** The `held` receipt's addends: the calls still running this UTC month, of one part or the whole team, at their estimate. */
export function heldPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'held' }>, ledger: TeamLedger = teamLedger(state, venture)): SumPlan {
  const { from, to } = monthDays(subject.month);
  const addends: Addend[] = countedIn(ledger, subject.scope, from, to).filter(record => record.phase === 'reserved')
    .map(record => ({ recordId: record.id, label: record.label, amount: record.reservedMicros, display: `${formatMicros(record.reservedMicros)} (held)`, estimate: true }));
  const name = partName(subject.scope);
  return {
    subject, currency: 'USD', unit: 'micros', addends,
    words: { label: `Held for running work: ${name}`, one: 'running call', many: 'running calls', none: `Nothing is held for running work by ${name}.` },
  };
}

/**
 * 'including USD 0.22 held for running work'; with the owner's rate, the other currency after it at that rate. 4Z3: the
 * currency the owner's choice leads with comes first, and dollars never show more than two decimals (the held
 * receipt keeps the exact figure).
 */
export function heldWords(micros: bigint, rupees: Rupees | null): string {
  const dollars = dollarsLead(String(micros));
  if (!rupees) return `including ${dollars} held for running work`;
  const inr = rupeeFigure(String(micros), rupees);
  const rate = rupeeRateWords(rupees);
  return rupees.leads ? `including ${inr} held for running work: ${dollars} at ${rate}` : `including ${dollars} held for running work: ${inr} at ${rate}`;
}

// ---------------------------------------------------------------------------
// Jobs done
// ---------------------------------------------------------------------------

/** Every job of the business, once per ledger: runs that reached review or later and finished rehearsals, oldest first. */
function jobsOf(ledger: TeamLedger): Job[] {
  if (ledger.jobs) return ledger.jobs;
  const { state, venture } = ledger;
  const order = venture.country.dateOrder;
  const day = (at: string) => formatVentureDate(localDayAt(at, venture.country), order);
  const events = new Map<string, string>();
  for (const event of listRecords(state, 'venture-event', venture.id)) {
    const runId = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data.runId : undefined;
    if (typeof runId === 'string' && (!events.has(runId) || event.at > events.get(runId)!)) events.set(runId, event.at);
  }
  const clients = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
  const clientOf = new Map(listRecords(state, 'venture-order', venture.id).map(order => [order.id, clients.get(order.clientId) ?? 'a client']));
  const jobs: Job[] = [];
  for (const run of listRecords(state, 'venture-delivery-run', venture.id)) {
    if (!DONE_STATUSES.includes(run.status)) continue;
    const at = run.verdict?.at ?? events.get(run.id) ?? run.at;
    jobs.push({ recordId: run.id, at, label: `Draft for ${clientOf.get(run.orderId) ?? 'a client'}, ${day(at)}`, department: draftingDepartment(ledger, run) });
  }
  for (const rehearsal of listRecords(state, 'venture-simulation-run', venture.id)) {
    jobs.push({ recordId: rehearsal.id, at: rehearsal.finishedAt, label: `Rehearsal with practice clients, ${day(rehearsal.finishedAt)}`, department: draftingDepartment(ledger, null) });
  }
  ledger.jobs = jobs.sort((a, b) => a.at.localeCompare(b.at));
  return ledger.jobs;
}

/** The `count` receipt with what 'jobs': the jobs one department (or 'all') did between the owner's days (runs and rehearsals). */
export function jobsCountPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'count' }>, ledger: TeamLedger = teamLedger(state, venture)): SumPlan {
  const addends: Addend[] = jobsOf(ledger)
    .filter(job => (subject.scope === 'all' || job.department === subject.scope) && inDays(localDayAt(job.at, venture.country), subject.from, subject.to))
    .map(job => ({ recordId: job.recordId, label: job.label, amount: '1', display: '1', estimate: false }));
  const name = subject.scope === 'all' ? 'the team' : departmentName(subject.scope as DepartmentId);
  return {
    subject, currency: 'count', unit: 'count', addends,
    words: { label: `Jobs done: ${name}`, one: 'job', many: 'jobs', none: `No jobs done by ${name} in these days.` },
  };
}
