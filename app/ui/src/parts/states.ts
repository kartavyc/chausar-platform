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
import type { DeliveryStatus, InvoiceLite, LeadStage, Posture, QueueKind, RunState, RunStep } from '../engine/types';

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
};

/** A Today card's kind (the kind chip). Kinds are labels, not states, so all are neutral. */
const QUEUE: Record<QueueKind, StateEntry> = {
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
};

export const STATE_WORDS = {
  run: RUN,
  step: STEP,
  posture: POSTURE,
  invoice: INVOICE,
  lead: LEAD,
  delivery: DELIVERY,
  queue: QUEUE,
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
