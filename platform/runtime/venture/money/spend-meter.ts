// W6 6G5 (D44): the owner's cap on each routine, the refusal of a paid call past it, and the sums behind the spend
// meter per agent and per routine. The meters themselves and the refusal before a routine starts are in
// agent-meters.ts, which reads names from the team; money/spend.ts loads this file at start, so it must not. Every
// figure is worked out in BigInt micro-dollars from the charge records (money/spend.ts) and the call records the model
// port keeps; nothing is a guessed price. Runs on the owner's own Codex or Claude plan are counted, never priced, and
// never shown in rupees. Sunra generations (6F9) show beside an agent's AI spend at the quote code worked out for each,
// and are not held against its cap: each already waits for its own approval card.
import { ChausarError, check, type State } from '../../contracts.ts';
import { exactPayload, formatMicros, listRecords } from '../records.ts';
import { usdToMicros } from '../models/cost.ts';
import { presetSpec } from '../models/presets.ts';
import { AGENT_ID, AGENT_PURPOSES, agentName } from '../views/shared.ts';
import { nativeJobSpends } from '../agent-runtime/job-spend.ts';
import { spendAgentOf, spendOfMonth } from './spend.ts';
import type { Addend, SumPlan } from './sums.ts';
import type {
  DeliveryRunRecord, Display, MicroString, ModelCallRecord, RoutineRecord, SpendPolicyRecord, SpendRecord, SumReceiptSubject, VentureRecord,
} from '../contracts.ts';

export const MICROS = /^(0|[1-9][0-9]{0,14})$/;
const ROUTINE = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,120}$/;
const MAX_ROUTINE_CAPS = 50;
const monthOf = (iso: string) => iso.slice(0, 7);

export const METER_WORDS = Object.freeze({
  thisMonth: ' this month',
  perMonth: ' a month',
  noLimit: 'No limit of its own',
  paused: 'Paused: it reached its limit. Other work goes on.',
  used: (percent: string) => `${percent} of its limit used`,
  plan: (count: number) => `${count} ${count === 1 ? 'job' : 'jobs'} on your plan`,
  media: (upTo: boolean, figure: string) => `Images and video: ${upTo ? 'up to ' : ''}${figure}, quoted by Sunra`,
  retired: (name: string) => `${name} (retired)`,
  removed: (name: string) => `${name} (removed)`,
  /** The refusal when one agent's or one routine's own monthly limit is used. */
  ownLimit: (name: string, cap: string) => `${name} reached its own monthly limit of ${cap}, so it is paused until you raise it or the month ends. Other work goes on.`,
  monthUsed: "This month's AI limit is used up. Nothing more is spent until you raise it or the month ends.",
  routineCapUnknown: 'A routine limit names one of your routines.',
  oneEach: 'Each routine has one limit.',
});

/** What a charge counts toward its month: settled at its figure, held at its estimate, nothing when refused or not sent. */
export function counted(record: SpendRecord): bigint {
  if (record.phase === 'settled' && record.settledMicros !== null) return BigInt(record.settledMicros);
  if (record.phase === 'reserved' || record.phase === 'unknown') return BigInt(record.reservedMicros);
  return 0n;
}

/** A plan run: a call that went to the owner's own Codex or Claude command-line tool. */
export function planCall(call: Pick<ModelCallRecord, 'presetId'>): boolean {
  try { return presetSpec(call.presetId).kind === 'claude-cli' || presetSpec(call.presetId).kind === 'codex-cli'; } catch { return false; }
}

/** Whether a native job ran on the owner's plan: its route said a command-line preset, or no key ever charged it. */
export function planJob(state: State, run: DeliveryRunRecord): boolean {
  const job = run.agentJob;
  if (!job) return false;
  const presetId = job.route?.presetId;
  if (presetId) { try { return !presetSpec(presetId).needsKey; } catch { return false; } }
  return !job.cost && nativeJobSpends(state, run).length === 0;
}

/** The team agent a call worked for, as the spend ledger counts it (money/spend.ts spendAgentOf). */
export function callAgent(call: ModelCallRecord): string | null {
  if (call.agentId) return call.agentId;
  return AGENT_PURPOSES.includes(call.purpose) ? AGENT_ID : null;
}

/** An id in words, for an agent no longer on the team: 'old-helper' is 'Old helper'. */
export function pretty(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : id;
}

/** An agent's name for a receipt label: the delivery agent's name, else its id in words (meters add '(retired)'). */
function labelAgentName(state: State, venture: VentureRecord, agent: string): Display {
  return agent === AGENT_ID ? agentName(state, venture) : pretty(agent);
}

export function routineName(routine: RoutineRecord | undefined, id: string): Display {
  if (!routine) return METER_WORDS.removed(pretty(id));
  return routine.removedAt === null ? routine.name : METER_WORDS.removed(routine.name);
}

/** What one routine spent or holds in a UTC month. */
export function routineMonthTotal(records: readonly SpendRecord[], routine: string, month: string): bigint {
  return records.reduce((total, record) => (record.routine === routine && monthOf(record.at) === month ? total + counted(record) : total), 0n);
}

export function agentMonthTotal(state: State, records: readonly SpendRecord[], agent: string, month: string): bigint {
  return records.reduce((total, record) => (monthOf(record.at) === month && spendAgentOf(state, record) === agent ? total + counted(record) : total), 0n);
}

export function latestPolicy(state: State, ventureId: string): SpendPolicyRecord | null {
  return listRecords(state, 'venture-spend-policy', ventureId).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))[0] ?? null;
}

// ---------------------------------------------------------------------------
// The owner's routine caps
// ---------------------------------------------------------------------------

/** Routine limits in micro units, as setSpendPolicy keeps them: one per routine, up to 50. */
export function routineCapsChecked(value: unknown): { routine: string; capMicros: MicroString }[] {
  check(Array.isArray(value) && value.length <= MAX_ROUTINE_CAPS, 'INVALID_VENTURE_REQUEST', `Up to ${MAX_ROUTINE_CAPS} routines can have their own limit.`);
  const caps = value.map(item => {
    const line = exactPayload(item, ['routine', 'capMicros'], ['routine', 'capMicros']);
    check(typeof line.routine === 'string' && ROUTINE.test(line.routine), 'INVALID_VENTURE_REQUEST', METER_WORDS.routineCapUnknown);
    check(typeof line.capMicros === 'string' && MICROS.test(line.capMicros), 'INVALID_AMOUNT', "A routine's limit must be whole micro units.");
    return { routine: line.routine, capMicros: line.capMicros };
  });
  check(new Set(caps.map(item => item.routine)).size === caps.length, 'INVALID_VENTURE_REQUEST', METER_WORDS.oneEach);
  return caps;
}

/** Routine limits as the owner types them, in US dollars (two decimals), turned into micro units. */
export function routineCapsTyped(value: unknown): { routine: string; capMicros: MicroString }[] {
  check(Array.isArray(value), 'INVALID_VENTURE_REQUEST', 'routineCaps is a list of one limit per routine.');
  return value.map(item => {
    const line = exactPayload(item, ['routine', 'capUsd'], ['routine', 'capUsd']);
    return { routine: line.routine as string, capMicros: usdToMicros(line.capUsd, { field: "A routine's limit", decimals: 2 }) };
  });
}

/** Each routine a limit names must be one of the business's routines, not removed. */
export function requireRoutinesExist(state: State, ventureId: string, caps: readonly { routine: string }[]): void {
  const live = new Set(listRecords(state, 'venture-routine', ventureId).filter(routine => routine.removedAt === null).map(routine => routine.id));
  for (const cap of caps) check(live.has(cap.routine), 'INVALID_VENTURE_REQUEST', METER_WORDS.routineCapUnknown);
}

/** Inside reserveSpend: a paid call made for a routine that would pass that routine's own monthly limit. Null when it fits. */
export function routineCapRefusal(state: State, venture: VentureRecord, policy: SpendPolicyRecord, records: readonly SpendRecord[], routine: string | null | undefined, estimate: bigint, nowIso: string): string | null {
  if (!routine) return null;
  const cap = (policy.routineCaps ?? []).find(item => item.routine === routine);
  if (!cap) return null;
  if (routineMonthTotal(records, routine, monthOf(nowIso)) + estimate <= BigInt(cap.capMicros)) return null;
  const record = listRecords(state, 'venture-routine', venture.id).find(item => item.id === routine);
  return METER_WORDS.ownLimit(routineName(record, routine), formatMicros(cap.capMicros));
}

/** Whether a routine's runs go to a key (counted and capped) or to the owner's plan (neither). */
export function keyedPreset(presetId: string | null | undefined): boolean {
  if (!presetId) return false;
  try { return presetSpec(presetId as never).needsKey; } catch { return false; }
}

/** The error a routine refused before it starts is thrown as: nothing was sent, so its card keeps waiting. */
export function routineCapError(reason: string): ChausarError {
  return new ChausarError('SPEND_CAP', reason);
}

// ---------------------------------------------------------------------------
// The sum receipt behind each meter row and each run's cost
// ---------------------------------------------------------------------------

/** The charges of one routine run: those of the calls the port made inside it. */
function routineRunSpends(state: State, ventureId: string, runId: string): SpendRecord[] {
  const calls = new Set(listRecords(state, 'venture-model-call', ventureId).filter(call => call.routineRunId === runId).map(call => call.id));
  return listRecords(state, 'venture-spend', ventureId).filter(record => record.ref !== null && calls.has(record.ref));
}

/** The charges of one delivery run: its native job's, or its calls' (the run's own call and each harness turn's). */
export function deliveryRunSpends(state: State, run: DeliveryRunRecord): SpendRecord[] {
  if (run.agentJob) return nativeJobSpends(state, run);
  const calls = new Set([run.callId, ...(run.harness?.turns ?? []).map(turn => turn.callId)].filter((id): id is string => typeof id === 'string'));
  return listRecords(state, 'venture-spend', run.ventureId).filter(record => record.ref !== null && calls.has(record.ref));
}

/** A set of charges as sum addends, each at what it counts toward its month, estimates marked. */
function addendsOf(records: readonly SpendRecord[]): Addend[] {
  const months = [...new Set(records.map(record => monthOf(record.at)))].sort();
  return months.flatMap(month => spendOfMonth(records, month)).map(item => ({
    recordId: item.record.id, label: item.record.label, amount: String(item.micros),
    display: `${formatMicros(String(item.micros))}${item.estimate ? ' (estimate)' : ''}`, estimate: item.estimate,
  }));
}

/** The plan for a 'spent-by' sum receipt: one agent's or one routine's month, one routine run, or one delivery run. */
export function spentByPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'spent-by' }>): SumPlan {
  const records = listRecords(state, 'venture-spend', venture.id);
  let chosen: SpendRecord[];
  let label: string;
  if (subject.scope === 'agent') {
    chosen = records.filter(record => monthOf(record.at) === subject.month && spendAgentOf(state, record) === subject.id);
    label = `AI spend of ${labelAgentName(state, venture, subject.id)} this month`;
  } else if (subject.scope === 'routine') {
    chosen = records.filter(record => monthOf(record.at) === subject.month && record.routine === subject.id);
    const routine = listRecords(state, 'venture-routine', venture.id).find(item => item.id === subject.id);
    label = `AI spend of ${routineName(routine, subject.id)} this month`;
  } else if (subject.scope === 'routine-run') {
    chosen = routineRunSpends(state, venture.id, subject.id);
    label = 'AI spend of this routine run';
  } else {
    const run = listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === subject.id);
    chosen = run ? deliveryRunSpends(state, run) : [];
    label = 'AI spend of this run';
  }
  return { subject, currency: 'USD', unit: 'micros', addends: addendsOf(chosen), words: { label, one: 'paid call', many: 'paid calls', none: 'No paid calls.' } };
}
