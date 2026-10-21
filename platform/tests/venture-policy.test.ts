// P2-posture: the posture ladder, the always-ask floor, and allow / deny / ask verdicts that fail closed.
// Pure functions only; venture-policy-harness.test.ts covers the wiring into the agent loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCH_STAGES } from '../runtime/venture/contracts.ts';
import type { Posture } from '../runtime/venture/contracts.ts';
import { POSTURES, postureOfStage, postureRank, runPosture, stepGate, tighten } from '../runtime/venture/policy/posture.ts';
import { FLOOR_KINDS, FLOOR_WORDS, floorOf, type PolicyAction } from '../runtime/venture/policy/floor.ts';
import { evaluate, evaluateSync, type Policy, type Verdict } from '../runtime/venture/policy/verdict.ts';
import { ladderPolicy, type PolicyContext } from '../runtime/venture/policy/ladder.ts';

const pick = (verdict: Verdict) => ({ verdict: verdict.verdict, code: verdict.code });

// ---------------------------------------------------------------------------
// 1. The ladder
// ---------------------------------------------------------------------------

test('posture: four rungs, strictest first, mapped onto the launch ladder rather than a second ladder', () => {
  assert.deepEqual([...POSTURES], ['rehearsal', 'shadow', 'approve-each', 'auto-spot-check']);
  // Approving a sample is planned on the launch ladder; until it exists the honest posture is approving each one.
  assert.deepEqual(LAUNCH_STAGES.map(postureOfStage), ['rehearsal', 'shadow', 'approve-each', 'approve-each', 'auto-spot-check']);
  assert.deepEqual(POSTURES.map(postureRank), [0, 1, 2, 3]);
  // A run's own scope: made-up clients are always a rehearsal, whatever the business stage; a real order adds nothing.
  assert.equal(runPosture({ kind: 'rehearsal', scenarioId: 'bookkeeping-clean', episode: 0 }), 'rehearsal');
  assert.equal(runPosture({ kind: 'improvement', runId: 'improve_1', scenarioId: 'bookkeeping-clean' }), 'rehearsal');
  assert.equal(runPosture({ kind: 'delivery', runId: 'delivery_1' }), null);
});

test('posture: a narrower scope (agent, run, step) can only tighten the wider one, never loosen it', () => {
  assert.equal(tighten('auto-spot-check', 'shadow'), 'shadow');
  assert.equal(tighten('shadow', 'auto-spot-check'), 'shadow', 'an agent set looser than its business stays at the business posture');
  assert.equal(tighten('approve-each', null, undefined), 'approve-each');
  assert.equal(tighten('auto-spot-check', 'approve-each', 'rehearsal'), 'rehearsal');
  for (const wider of POSTURES) {
    for (const narrower of POSTURES) {
      const result = tighten(wider, narrower);
      assert.ok(postureRank(result) <= postureRank(wider), `${narrower} never loosens ${wider}`);
      assert.ok(postureRank(result) <= postureRank(narrower), `${wider} never loosens ${narrower}`);
    }
  }
  assert.throws(() => tighten('approve-each', 'everything' as Posture), /posture/i);
});

test('gates: start on hold; a floor step stays on hold whatever was stored', () => {
  assert.equal(stepGate(undefined, false), 'hold');
  assert.equal(stepGate('auto', false), 'auto');
  assert.equal(stepGate('hold', false), 'hold');
  assert.equal(stepGate('auto', true), 'hold');
  assert.equal(stepGate(undefined, true), 'hold');
});

// ---------------------------------------------------------------------------
// 2. The always-ask floor
// ---------------------------------------------------------------------------

const effect = (name: string, touches?: PolicyAction['touches']) => floorOf({ phase: 'outside-effect', name, ...(touches ? { touches } : {}) });

test('floor: money out, sending, deleting, changing prices, government portals and credentials; code decides', () => {
  assert.deepEqual([...FLOOR_KINDS], ['money-out', 'send', 'delete', 'price-change', 'government-portal', 'credential']);
  for (const kind of FLOOR_KINDS) assert.match(FLOOR_WORDS[kind], /always asks you first\.$/);
  assert.deepEqual(effect('payment.send'), ['money-out']);
  assert.deepEqual(effect('payment.refund'), ['money-out']);
  assert.deepEqual(effect('connector.post'), ['send']);
  assert.deepEqual(effect('invoice.issue'), ['send']);
  assert.deepEqual(effect('site.edit.apply'), ['send']);
  assert.deepEqual(effect('record.delete'), ['delete']);
  assert.deepEqual(effect('price.change'), ['price-change']);
  assert.deepEqual(effect('portal.gst.file'), ['government-portal']);
  assert.deepEqual(effect('delegate.start'), ['credential']);
  assert.deepEqual(effect('credential.use'), ['credential']);
  // Names with no row of their own are read word by word, so a new effect is never quietly off the floor.
  assert.deepEqual(effect('crm.contact.remove'), ['delete']);
  assert.deepEqual(effect('itr.portal.login'), ['government-portal', 'credential']);
  assert.deepEqual(effect('report.save'), []);
});

test('floor: a caller may add to what code found, never take it away', () => {
  assert.deepEqual(effect('report.save', ['send']), ['send']);
  assert.deepEqual(effect('connector.post', []), ['send']);
  assert.deepEqual(effect('payment.send', ['delete']), ['money-out', 'delete']);
  assert.throws(() => effect('report.save', ['shrug' as never]), /floor/i);
});

test('floor: tool calls carry the floor of what they would do; internal tools carry none', () => {
  const call = (name: string, effectName: PolicyAction['effect']) => floorOf({ phase: 'tool-call', name, effect: effectName });
  assert.deepEqual(call('outbox.propose', 'outside-write'), ['send']);
  assert.deepEqual(call('agent.delegate', 'delegate'), ['credential']);
  assert.deepEqual(call('mystery.tool', 'outside-write'), ['send'], 'an unknown outside write sends');
  assert.deepEqual(call('files.read', 'read'), []);
  assert.deepEqual(call('calc.sum', 'compute'), []);
  assert.deepEqual(call('sandbox.transform', 'sandbox'), []);
  assert.deepEqual(call('handoff.client', 'handoff'), [], 'the owner relays the question; the tool sends nothing');
});

// ---------------------------------------------------------------------------
// 3. Verdicts: start denied, deny stops the rest, fail closed
// ---------------------------------------------------------------------------

const action: PolicyAction = { phase: 'tool-call', name: 'files.read', effect: 'read' };
const said = (verdict: 'allow' | 'deny' | 'ask', code: string = verdict): Policy =>({ id: code, decide: () => ({ verdict, code, reason: `Said ${verdict}.` }) });
const abstain: Policy = { id: 'quiet', decide: () => null };

test('verdicts: the gate starts denied and only an explicit allow opens it', async () => {
  const empty = await evaluate([], action);
  assert.deepEqual(pick(empty), { verdict: 'deny', code: 'not_approved' });
  assert.equal(empty.reason, 'Nothing approved this.');
  assert.deepEqual(pick(await evaluate([abstain], action)), { verdict: 'deny', code: 'not_approved' });
  assert.deepEqual(pick(await evaluate([abstain, said('allow')], action)), { verdict: 'allow', code: 'allow' });
  assert.deepEqual(pick(evaluateSync([], action)), { verdict: 'deny', code: 'not_approved' });
});

test('verdicts: any deny stops the rest; any ask beats an allow', async () => {
  let ran = false;
  const after: Policy = { id: 'after', decide: () => { ran = true; return { verdict: 'allow', code: 'after', reason: 'Fine.' }; } };
  const denied = await evaluate([said('allow'), said('deny'), after], action);
  assert.deepEqual(pick(denied), { verdict: 'deny', code: 'deny' });
  assert.equal(denied.policy, 'deny');
  assert.equal(ran, false, 'nothing runs after a deny');
  assert.deepEqual(pick(await evaluate([said('allow'), said('ask'), said('allow', 'again')], action)), { verdict: 'ask', code: 'ask' });
  const asks = await evaluate([said('ask', 'first'), said('ask', 'second')], action);
  assert.deepEqual([asks.code, asks.reason], ['first', 'Said ask.; Said ask.']);
});

test('verdicts: a policy that throws, answers nonsense or runs out of time blocks the action', async () => {
  const boom: Policy = { id: 'boom', decide: () => { throw new Error('the rule file is broken'); } };
  const thrown = await evaluate([said('allow'), boom, said('allow', 'later')], action);
  assert.deepEqual(pick(thrown), { verdict: 'deny', code: 'policy_error' });
  assert.equal(thrown.reason, 'A check failed, so this was blocked.');
  assert.equal(thrown.policy, 'boom');
  const rejecting: Policy = { id: 'rejects', decide: async () => { throw new Error('later'); } };
  assert.deepEqual(pick(await evaluate([rejecting], action)), { verdict: 'deny', code: 'policy_error' });
  const nonsense: Policy = { id: 'maybe', decide: () => ({ verdict: 'maybe', code: 'x', reason: 'x' }) as unknown as Verdict };
  assert.deepEqual(pick(await evaluate([said('allow'), nonsense], action)), { verdict: 'deny', code: 'unknown_verdict' });
  const shapeless: Policy = { id: 'shapeless', decide: () => 'allow' as unknown as Verdict };
  assert.deepEqual(pick(await evaluate([shapeless], action)), { verdict: 'deny', code: 'unknown_verdict' });
  const slow: Policy = { id: 'slow', decide: () => new Promise(resolve => setTimeout(() => resolve({ verdict: 'allow', code: 'late', reason: 'Late.' }), 200)) };
  const late = await evaluate([said('allow'), slow], action, undefined, { timeoutMs: 20 });
  assert.deepEqual(pick(late), { verdict: 'deny', code: 'policy_timeout' });
  assert.equal(late.reason, 'A check did not answer in time. A timeout is not an approval.');
  // The synchronous form never waits: a policy that answers later is refused, not trusted.
  const promised: Policy = { id: 'promised', decide: async () => ({ verdict: 'allow', code: 'p', reason: 'P.' }) };
  assert.deepEqual(pick(evaluateSync([promised], action)), { verdict: 'deny', code: 'policy_async' });
  assert.deepEqual(pick(evaluateSync([said('allow'), boom], action)), { verdict: 'deny', code: 'policy_error' });
});

// ---------------------------------------------------------------------------
// 4. Chausar's own policy: the ladder, the gates and the floor
// ---------------------------------------------------------------------------

function ctx(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    posture: 'approve-each', approval: { kind: 'none' },
    gates: { gather: 'hold', work: 'auto' },
    stepsByTool: { 'files.read': ['gather', 'work'], 'files.list': ['gather'], 'calc.sum': ['work'], 'agent.delegate': ['work'] },
    stepTitles: { gather: 'Read the files', work: 'Do the hands-on work' },
    ...over,
  };
}
const tool = (name: string, toolEffect: PolicyAction['effect'] = 'read', inputDigest = 'd1'): PolicyAction => ({ phase: 'tool-call', name, effect: toolEffect, inputDigest });
const ladder = (act: PolicyAction, context: PolicyContext) => evaluateSync([ladderPolicy], act, context);
const FLOOR_EFFECTS = ['payment.send', 'connector.post', 'record.delete', 'price.change', 'portal.gst.file', 'delegate.start'];

test('ladder: the always-ask floor needs the owner at every posture; a turn approval or practice consent never covers it', () => {
  for (const posture of POSTURES) {
    for (const approval of [{ kind: 'none' }, { kind: 'practice' }, { kind: 'owner-turn' }] as const) {
      for (const name of FLOOR_EFFECTS) {
        const verdict = ladder({ phase: 'outside-effect', name, digest: 'a'.repeat(64) }, ctx({ posture, approval }));
        assert.deepEqual(pick(verdict), { verdict: 'ask', code: 'floor' }, `${name} at ${posture} with ${approval.kind}`);
        assert.equal(verdict.reason, FLOOR_WORDS[floorOf({ phase: 'outside-effect', name })[0]]);
      }
    }
    const owner = { kind: 'owner-action' as const, digest: 'a'.repeat(64), memberId: 'owner' };
    assert.deepEqual(pick(ladder({ phase: 'outside-effect', name: 'connector.post', digest: 'a'.repeat(64) }, ctx({ posture, approval: owner }))), { verdict: 'allow', code: 'owner_approved' });
    assert.deepEqual(pick(ladder({ phase: 'outside-effect', name: 'connector.post', digest: 'b'.repeat(64) }, ctx({ posture, approval: owner }))), { verdict: 'ask', code: 'floor' }, 'an approval binds one exact action');
    assert.deepEqual(pick(ladder({ phase: 'outside-effect', name: 'connector.post' }, ctx({ posture, approval: owner }))), { verdict: 'ask', code: 'floor' }, 'an action without a digest can not be matched');
  }
  // An outside effect off the floor still asks; only the owner's approval of that action lets it through.
  assert.deepEqual(pick(ladder({ phase: 'outside-effect', name: 'report.save', digest: 'c'.repeat(64) }, ctx({ posture: 'auto-spot-check' }))), { verdict: 'ask', code: 'outside' });
});

test('ladder: a step on hold asks; the owner approving the turn, or practice consent on made-up clients, is that approval', () => {
  const held = ladder(tool('files.list'), ctx());
  assert.deepEqual(pick(held), { verdict: 'ask', code: 'step_on_hold' });
  assert.equal(held.reason, 'Read the files is on hold, so it waits for you.');
  assert.equal(held.step, 'gather');
  assert.deepEqual(pick(ladder(tool('files.list'), ctx({ approval: { kind: 'owner-turn' } }))), { verdict: 'allow', code: 'owner_turn' });
  assert.deepEqual(pick(ladder(tool('files.list'), ctx({ approval: { kind: 'practice' } }))), { verdict: 'allow', code: 'practice' });
  // A step with no gate set starts on hold.
  assert.deepEqual(pick(ladder(tool('calc.sum', 'compute'), ctx({ gates: {}, posture: 'auto-spot-check' }))), { verdict: 'ask', code: 'step_on_hold' });
  // A granted tool no step names is on hold too.
  assert.deepEqual(pick(ladder(tool('dictionary.browse'), ctx({ posture: 'auto-spot-check' }))), { verdict: 'ask', code: 'step_on_hold' });
});

test('ladder: an auto step runs alone only at auto with spot checks; below that the posture asks', () => {
  for (const posture of ['rehearsal', 'shadow', 'approve-each'] as const) {
    const asked = ladder(tool('calc.sum', 'compute'), ctx({ posture }));
    assert.deepEqual(pick(asked), { verdict: 'ask', code: 'posture' }, posture);
    assert.equal(asked.step, 'work');
  }
  assert.equal(ladder(tool('calc.sum', 'compute'), ctx({ posture: 'shadow' })).reason, 'In shadow, each step waits for you.');
  assert.deepEqual(pick(ladder(tool('calc.sum', 'compute'), ctx({ posture: 'auto-spot-check' }))), { verdict: 'allow', code: 'auto' });
  // The strictest of the steps that grant a tool wins: files.read is in gather (hold) and work (auto).
  assert.deepEqual(pick(ladder(tool('files.read'), ctx({ posture: 'auto-spot-check' }))), { verdict: 'ask', code: 'step_on_hold' });
});

test('ladder: tools that only record a request run, since nothing leaves until the owner approves what they recorded', () => {
  for (const posture of POSTURES) {
    const proposed = ladder(tool('outbox.propose', 'outside-write'), ctx({ posture }));
    assert.deepEqual(pick(proposed), { verdict: 'allow', code: 'records_only' });
    assert.deepEqual(proposed.floor, ['send']);
    assert.deepEqual(ladder(tool('agent.delegate', 'delegate'), ctx({ posture })).floor, ['credential']);
  }
  // A floor tool whose call would itself be the effect (none ships today) is asked, and only the owner opens it.
  const direct = { phase: 'tool-call' as const, name: 'payment.send', effect: 'outside-write' as const, inputDigest: 'd9', digest: 'e'.repeat(64) };
  assert.deepEqual(pick(ladder(direct, ctx({ approval: { kind: 'owner-turn' } }))), { verdict: 'ask', code: 'floor' });
  assert.deepEqual(pick(ladder(direct, ctx({ approval: { kind: 'owner-action', digest: 'e'.repeat(64), memberId: 'owner' } }))), { verdict: 'allow', code: 'owner_approved' });
});

test('ladder: a tool outside the run grant is denied; an approved hold lets exactly that call run once, in the next turn', () => {
  assert.deepEqual(pick(ladder(tool('sandbox.python', 'sandbox'), ctx({ grant: ['files.read'] }))), { verdict: 'deny', code: 'not_granted' });
  const hold = { id: 'h1.1', toolCallId: 't1.1', tool: 'files.list', stepId: 'gather', inputDigest: 'd1', code: 'step_on_hold', reason: 'x', turn: 1, handoff: 0, status: 'approved' as const, validTurn: 2 };
  const approved = ladder(tool('files.list'), ctx({ holds: [hold], turn: 2 }));
  assert.deepEqual(pick(approved), { verdict: 'allow', code: 'hold_approved' });
  assert.equal(approved.holdId, 'h1.1');
  assert.deepEqual(pick(ladder(tool('files.list', 'read', 'd2'), ctx({ holds: [hold], turn: 2 }))), { verdict: 'ask', code: 'step_on_hold' }, 'other input');
  assert.deepEqual(pick(ladder(tool('files.list'), ctx({ holds: [hold], turn: 3 }))), { verdict: 'ask', code: 'step_on_hold' }, 'expired after its turn');
  assert.deepEqual(pick(ladder(tool('files.list'), ctx({ holds: [{ ...hold, status: 'used' }], turn: 2 }))), { verdict: 'ask', code: 'step_on_hold' }, 'single use');
  assert.deepEqual(pick(ladder(tool('files.list'), ctx({ holds: [{ ...hold, status: 'declined' }], turn: 2 }))), { verdict: 'ask', code: 'step_on_hold' });
});
