import { describe, expect, it } from 'vitest';
import { CATALOGUES, format } from '../../src/text';
import { STATE_TONES, STATE_WORDS, stateWord, type StateKind } from '../../src/parts/states';
import type { DeliveryStatus, InvoiceLite, LeadStage, Posture, QueueKind, QueueKindW4, RoutineRunState, RunState, RunStep } from '../../src/engine/types';

/**
 * Every literal value of each engine union, written out here. The maps in states.ts are typed Record<Union, ...>,
 * so a new engine value fails the typecheck; this list makes a renamed one fail at run time too.
 */
const VALUES = {
  run: ['active', 'waiting', 'done', 'failed'] satisfies RunState[],
  step: ['done', 'current', 'pending', 'waiting', 'failed'] satisfies RunStep['state'][],
  posture: ['rehearsal', 'shadow', 'approve-each', 'auto-spot-check'] satisfies Posture[],
  invoice: ['draft', 'issued', 'part-paid', 'paid', 'void'] satisfies InvoiceLite['status'][],
  lead: ['new', 'drafted', 'contacted', 'replied', 'won', 'lost', 'blocked'] satisfies LeadStage[],
  delivery: ['waiting-for-you', 'needs-answer', 'brief-waiting', 'ready-for-review', 'accepted', 'edited', 'rejected', 'failed', 'stopped'] satisfies DeliveryStatus[],
  queue: ['draft', 'price', 'quote', 'plan', 'invoice', 'signoff', 'question', 'setup', 'locked', 'connector', 'bank', 'proposal', 'followup', 'reply', 'notice'] satisfies (QueueKind | QueueKindW4)[],
  // W4 4J22a: the engine's one vocabulary and the other wave 4 states (states-w4.test.ts reads the engine's own lists).
  check: ['pass', 'fail', 'not-run', 'not-checked'],
  judgment: ['strong', 'fair', 'weak', 'no'],
  verdict: ['pass', 'rewrite', 'do-not-send'],
  fix: ['fixed', 'partially-fixed', 'not-fixed', 'unverified'],
  outcome: ['success', 'not-checked', 'failed'],
  finding: ['hard-error', 'content', 'creative'],
  routine: ['queued', 'running', 'needs-input', 'completed', 'failed', 'missed', 'skipped', 'interrupted'] satisfies RoutineRunState[],
  guidance: ['measured', 'dark', 'unmeasured'],
  contractItem: ['open', 'done', 'skipped'],
} as const satisfies Record<StateKind, readonly string[]>;

const en = (key: string) => format(CATALOGUES.en, 'en', key);

describe('state words: one module for every state the engine sends', () => {
  it('covers exactly the engine values of each union, no more and no fewer', () => {
    expect(Object.keys(STATE_WORDS).sort()).toEqual(Object.keys(VALUES).sort());
    for (const [kind, values] of Object.entries(VALUES)) {
      expect(Object.keys(STATE_WORDS[kind as StateKind]).sort(), kind).toEqual([...values].sort());
    }
  });

  it('gives every value a text key that both languages hold, and one of the six tones', () => {
    for (const [kind, values] of Object.entries(VALUES)) {
      for (const value of values) {
        const word = stateWord(kind as StateKind, value);
        expect(word.key.startsWith('state.'), `${kind}.${value}`).toBe(true);
        expect(CATALOGUES.en[word.key], word.key).toBeDefined();
        expect(CATALOGUES.hi[word.key], word.key).toBeDefined();
        expect(STATE_TONES).toContain(word.tone);
      }
    }
    expect([...STATE_TONES]).toEqual(['working', 'wait', 'fail', 'idle', 'done', 'neutral']);
  });

  it('says runs and steps in plain words, amber only for waiting on you and red only for failed', () => {
    expect(en(stateWord('run', 'active').key)).toBe('Working');
    expect(stateWord('run', 'active').tone).toBe('working');
    expect(en(stateWord('run', 'waiting').key)).toBe('Waiting on you');
    expect(stateWord('run', 'waiting').tone).toBe('wait');
    // An engine-failed run is "Failed"; "Stopped" is kept for the owner's own Stop (W4 4F).
    expect(en(stateWord('run', 'failed').key)).toBe('Failed');
    expect(stateWord('run', 'failed').tone).toBe('fail');
    expect(stateWord('run', 'done').tone).toBe('done');
    expect(stateWord('step', 'current').tone).toBe('working');
    expect(stateWord('step', 'pending').tone).toBe('idle');
    // Amber means the owner is the one being waited on, so every amber word says "you".
    for (const kind of Object.keys(VALUES) as StateKind[]) {
      for (const value of VALUES[kind]) {
        const { key, tone } = stateWord(kind, value);
        if (tone === 'wait') expect(en(key), key).toMatch(/\byour?\b/i);
      }
    }
  });

  it('uses the posture, invoice, lead and card-kind words the places show', () => {
    expect(VALUES.posture.map((p) => en(stateWord('posture', p).key))).toEqual(['Rehearsing', 'Shadowing', 'Asks each time', 'Auto with spot checks']);
    expect(VALUES.invoice.map((v) => en(stateWord('invoice', v).key))).toEqual(['Draft', 'Sent', 'Part paid', 'Paid', 'Void']);
    expect(stateWord('invoice', 'paid').tone).toBe('done');
    expect(VALUES.lead.map((v) => en(stateWord('lead', v).key))).toEqual(['New', 'Drafted', 'Contacted', 'Replied', 'Won', 'Lost', 'Blocked']);
    expect(VALUES.queue.map((v) => en(stateWord('queue', v).key))).toEqual([
      'Draft', 'Price change', 'Quote', 'Plan', 'Invoice', 'CA sign-off', 'Question', 'Setup', 'Locked', 'Post', 'Bank', 'Proposal',
      'Follow-up', 'Reply', 'Notice',
    ]);
    expect(stateWord('delivery', 'failed').tone).toBe('fail');
    expect(stateWord('delivery', 'ready-for-review').tone).toBe('wait');
    // W4 4F3: a delivery run the owner (or Chausar) stopped waits for Resume; an engine failure stays Failed.
    expect(stateWord('delivery', 'stopped').tone).toBe('wait');
    expect(en(stateWord('delivery', 'stopped').key)).toBe('Stopped, waits for you');
  });

  it('a value the engine sends that this build does not know reads "Unknown", in the neutral tone', () => {
    expect(stateWord('run', 'exploded')).toEqual({ key: 'state.unknown', tone: 'neutral' });
    expect(stateWord('queue', 'toString')).toEqual({ key: 'state.unknown', tone: 'neutral' });
    expect(en('state.unknown')).toBe('Unknown');
  });
});
