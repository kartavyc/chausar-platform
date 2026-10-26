/**
 * Every state word Ink shows, in one module (catalogue U13). Each engine state maps to a text key under `state.`
 * and a tone; parts colour by the tone and always print the words, so colour never carries a state alone.
 *
 * Tones: `working` (the accent: something is running), `wait` (amber: it waits on the owner, and only that),
 * `fail` (red: it stopped), `done` (the soft green tick), `idle` (grey: nothing happening), `neutral` (a plain
 * label, no state colour).
 *
 * The maps are typed `Record<Union, StateEntry>`, so a value the engine adds fails the typecheck until it has words
 * here; tests/parts/states.test.ts lists every literal value, so a renamed one fails at run time too. A value this
 * build does not know (an engine newer than the UI) reads "Unknown" in the neutral tone instead of breaking.
 */

import type { T } from '../text';
import type {
  DeliverableReport, DeliveryStatus, GuidanceLineView, InvoiceLite, LeadStage, OrderContractView, Posture, QueueKind, QueueKindW4, ReportItem,
  RoutineRunState, RunDetail, RunState, RunStep,
} from '../engine/types';

export const STATE_TONES = ['working', 'wait', 'fail', 'idle', 'done', 'neutral'] as const;
export type StateTone = (typeof STATE_TONES)[number];

export interface StateEntry {
  /** The text key, in src/text/<lang>/common.json. */
  key: string;
  tone: StateTone;
}

const RUN: Record<RunState, StateEntry> = {
  active: { key: 'state.run.active', tone: 'working' },
  waiting: { key: 'state.run.waiting', tone: 'wait' },
  done: { key: 'state.run.done', tone: 'done' },
  failed: { key: 'state.run.failed', tone: 'fail' },
};

const STEP: Record<RunStep['state'], StateEntry> = {
  done: { key: 'state.step.done', tone: 'done' },
  current: { key: 'state.step.current', tone: 'working' },
  pending: { key: 'state.step.pending', tone: 'idle' },
  waiting: { key: 'state.step.waiting', tone: 'wait' },
  failed: { key: 'state.step.failed', tone: 'fail' },
};

const POSTURE: Record<Posture, StateEntry> = {
  rehearsal: { key: 'state.posture.rehearsal', tone: 'neutral' },
  shadow: { key: 'state.posture.shadow', tone: 'neutral' },
  'approve-each': { key: 'state.posture.approve-each', tone: 'neutral' },
  'auto-spot-check': { key: 'state.posture.auto-spot-check', tone: 'neutral' },
};

/** Lateness is not a status the engine sends yet (W4 4J), so no invoice status is amber or red here. */
const INVOICE: Record<InvoiceLite['status'], StateEntry> = {
  draft: { key: 'state.invoice.draft', tone: 'neutral' },
  issued: { key: 'state.invoice.issued', tone: 'idle' },
  'part-paid': { key: 'state.invoice.part-paid', tone: 'neutral' },
  paid: { key: 'state.invoice.paid', tone: 'done' },
  void: { key: 'state.invoice.void', tone: 'idle' },
};

const LEAD: Record<LeadStage, StateEntry> = {
  new: { key: 'state.lead.new', tone: 'neutral' },
  drafted: { key: 'state.lead.drafted', tone: 'neutral' },
  contacted: { key: 'state.lead.contacted', tone: 'neutral' },
  replied: { key: 'state.lead.replied', tone: 'neutral' },
  won: { key: 'state.lead.won', tone: 'done' },
  lost: { key: 'state.lead.lost', tone: 'idle' },
  blocked: { key: 'state.lead.blocked', tone: 'idle' },
};

const DELIVERY: Record<DeliveryStatus, StateEntry> = {
  'waiting-for-you': { key: 'state.delivery.waiting-for-you', tone: 'wait' },
  'needs-answer': { key: 'state.delivery.needs-answer', tone: 'wait' },
  'brief-waiting': { key: 'state.delivery.brief-waiting', tone: 'wait' },
  'ready-for-review': { key: 'state.delivery.ready-for-review', tone: 'wait' },
  accepted: { key: 'state.delivery.accepted', tone: 'done' },
  edited: { key: 'state.delivery.edited', tone: 'done' },
  rejected: { key: 'state.delivery.rejected', tone: 'idle' },
  failed: { key: 'state.delivery.failed', tone: 'fail' },
  // W4 4F3: stopped by the owner or by Chausar; it waits for Resume. An engine failure stays 'failed'.
  stopped: { key: 'state.delivery.stopped', tone: 'wait' },
};

/** A Today card's kind (the kind chip). Kinds are labels, not states, so all are neutral. */
const QUEUE: Record<QueueKind | QueueKindW4, StateEntry> = {
  draft: { key: 'state.queue.draft', tone: 'neutral' },
  price: { key: 'state.queue.price', tone: 'neutral' },
  quote: { key: 'state.queue.quote', tone: 'neutral' },
  plan: { key: 'state.queue.plan', tone: 'neutral' },
  invoice: { key: 'state.queue.invoice', tone: 'neutral' },
  signoff: { key: 'state.queue.signoff', tone: 'neutral' },
  question: { key: 'state.queue.question', tone: 'neutral' },
  setup: { key: 'state.queue.setup', tone: 'neutral' },
  locked: { key: 'state.queue.locked', tone: 'neutral' },
  connector: { key: 'state.queue.connector', tone: 'neutral' },
  bank: { key: 'state.queue.bank', tone: 'neutral' },
  proposal: { key: 'state.queue.proposal', tone: 'neutral' },
  // W4 4G4: the other wave 4 kinds, so the notification centre never reads "Unknown".
  followup: { key: 'state.queue.followup', tone: 'neutral' },
  reply: { key: 'state.queue.reply', tone: 'neutral' },
  notice: { key: 'state.queue.notice', tone: 'neutral' },
};

// W4 4J22a: the engine's one vocabulary (4J14, delivery/verdicts.ts) and the other wave 4 states, each worded here.
// tests/parts/states-w4.test.ts reads the engine's lists, so a value it adds fails until it has words.

/** A check's outcome (Q7): only a pass is green; one that could not run or settled nothing is not a pass. */
const CHECK: Record<ReportItem['outcome'] & ('pass' | 'fail' | 'not-run' | 'not-checked'), StateEntry> = {
  pass: { key: 'state.check.pass', tone: 'done' },
  fail: { key: 'state.check.fail', tone: 'fail' },
  'not-run': { key: 'state.check.not-run', tone: 'idle' },
  'not-checked': { key: 'state.check.not-checked', tone: 'neutral' },
};

/** A model's judgment of a rule, as a word. */
const JUDGMENT: Record<NonNullable<ReportItem['judgment']>, StateEntry> = {
  strong: { key: 'state.judgment.strong', tone: 'neutral' },
  fair: { key: 'state.judgment.fair', tone: 'neutral' },
  weak: { key: 'state.judgment.weak', tone: 'neutral' },
  no: { key: 'state.judgment.no', tone: 'neutral' },
};

/** A draft's verdict from its checks. */
const VERDICT: Record<NonNullable<DeliverableReport['verdict']>, StateEntry> = {
  pass: { key: 'state.verdict.pass', tone: 'done' },
  rewrite: { key: 'state.verdict.rewrite', tone: 'fail' },
  'do-not-send': { key: 'state.verdict.do-not-send', tone: 'fail' },
};

/** A fix, from the checks it targeted run again. */
const FIX: Record<'fixed' | 'partially-fixed' | 'not-fixed' | 'unverified', StateEntry> = {
  fixed: { key: 'state.fix.fixed', tone: 'done' },
  'partially-fixed': { key: 'state.fix.partially-fixed', tone: 'neutral' },
  'not-fixed': { key: 'state.fix.not-fixed', tone: 'fail' },
  unverified: { key: 'state.fix.unverified', tone: 'neutral' },
};

/** A run that acted outside (Q8): Success only when a code check of the real result passed. */
const OUTCOME: Record<NonNullable<RunDetail['outcome']>['outcome'], StateEntry> = {
  success: { key: 'state.outcome.success', tone: 'done' },
  'not-checked': { key: 'state.outcome.not-checked', tone: 'neutral' },
  failed: { key: 'state.outcome.failed', tone: 'fail' },
};

/** A finding's class: a hard error, a content issue, or creative judgement left to the owner. */
const FINDING: Record<DeliverableReport['findings'][number]['class'], StateEntry> = {
  'hard-error': { key: 'state.finding.hard-error', tone: 'fail' },
  content: { key: 'state.finding.content', tone: 'neutral' },
  creative: { key: 'state.finding.creative', tone: 'neutral' },
};

/** One run of a routine (4J13). A finished one says Delivered, never Done. */
const ROUTINE: Record<RoutineRunState, StateEntry> = {
  queued: { key: 'state.routine.queued', tone: 'idle' },
  running: { key: 'state.routine.running', tone: 'working' },
  'needs-input': { key: 'state.routine.needs-input', tone: 'wait' },
  completed: { key: 'state.routine.completed', tone: 'done' },
  failed: { key: 'state.routine.failed', tone: 'fail' },
  missed: { key: 'state.routine.missed', tone: 'idle' },
  skipped: { key: 'state.routine.skipped', tone: 'idle' },
  interrupted: { key: 'state.routine.interrupted', tone: 'idle' },
};

/** A guidance line and the check that can see it (Q18). */
const GUIDANCE: Record<GuidanceLineView['state'], StateEntry> = {
  measured: { key: 'state.guidance.measured', tone: 'done' },
  dark: { key: 'state.guidance.dark', tone: 'neutral' },
  unmeasured: { key: 'state.guidance.unmeasured', tone: 'idle' },
};

/** A deliverable or check of an order's contract (4J12). */
const CONTRACT_ITEM: Record<NonNullable<OrderContractView['items']>[number]['state'], StateEntry> = {
  open: { key: 'state.contractItem.open', tone: 'idle' },
  done: { key: 'state.contractItem.done', tone: 'done' },
  skipped: { key: 'state.contractItem.skipped', tone: 'neutral' },
};

export const STATE_WORDS = {
  run: RUN,
  step: STEP,
  posture: POSTURE,
  invoice: INVOICE,
  lead: LEAD,
  delivery: DELIVERY,
  queue: QUEUE,
  check: CHECK,
  judgment: JUDGMENT,
  verdict: VERDICT,
  fix: FIX,
  outcome: OUTCOME,
  finding: FINDING,
  routine: ROUTINE,
  guidance: GUIDANCE,
  contractItem: CONTRACT_ITEM,
} as const;

export type StateKind = keyof typeof STATE_WORDS;
/** The engine values a kind takes (`stateWord('run', 'active')`). */
export type StateValue<K extends StateKind> = keyof (typeof STATE_WORDS)[K] & string;

const UNKNOWN: StateEntry = Object.freeze({ key: 'state.unknown', tone: 'neutral' });

/**
 * The words and tone for an engine state. It takes any string too, because the engine can be newer than the UI:
 * an unknown value gives "Unknown" in the neutral tone.
 */
export function stateWord<K extends StateKind>(kind: K, value: StateValue<K> | (string & {})): StateEntry {
  const map: Readonly<Record<string, StateEntry>> = STATE_WORDS[kind];
  return Object.hasOwn(map, value) ? map[value]! : UNKNOWN;
}

/** The state's words in the current language: `stateText(t, 'run', run.state)`. */
export function stateText<K extends StateKind>(t: T, kind: K, value: StateValue<K> | (string & {})): string {
  return t(stateWord(kind, value).key);
}
