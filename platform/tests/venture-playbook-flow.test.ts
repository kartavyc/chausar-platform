// Ink v2 wave 4 (4J12, H23): step edges, loop caps, timeouts with fail-over, gates with a default and a timeout, and a
// run deadline. validatePlaybook refuses a loop with no cap or gate and an edge to a step that is not there; the flow
// walks a fixture playbook whose check step sends the draft back at most twice, then ends blocked. No shipped playbook
// has an edge in W4, so nothing that runs today changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { HarnessLimits, PlaybookStep } from '../runtime/venture/contracts.ts';
import { playbookHash, playbookSteps, validatePlaybook } from '../runtime/venture/delivery/playbook.ts';
import { DEFAULT_LIMITS } from '../runtime/venture/delivery/harness/loop.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { CA_FIRM_ID } from '../runtime/venture/playbooks/ca-firm/registration.ts';
import { YOUTUBE_ID } from '../runtime/venture/playbooks/youtube/registration.ts';
import { SOCIAL_AGENCY_ID } from '../runtime/venture/playbooks/social/registration.ts';
import { business, code, PLAIN_IDEA } from './venture-judge-helpers.ts';
import { listRecords } from '../runtime/venture/records.ts';

const step = (id: string, kind: PlaybookStep['kind'], extra: Partial<PlaybookStep> = {}): PlaybookStep => ({
  id, kind, title: `The ${id} step`, tier: kind === 'gather' || kind === 'write' || kind === 'work' || kind === 'question' ? (kind === 'work' ? 'wasm-lite' : 'actor') : 'code',
  model: kind === 'gather' || kind === 'question' || kind === 'work' ? 'fast' : kind === 'write' ? 'main' : null,
  doneBy: kind === 'approve' || kind === 'operator' ? 'you' : 'agent',
  requiredSections: kind === 'write' ? ['Summary'] : [], checks: kind === 'write' ? ['no-done-claims'] : kind === 'operator' ? ['no-outside-writes'] : [],
  tools: kind === 'gather' ? ['files.read'] : [], guidance: [], ...extra,
});

/** Read, draft, check, you approve, you send: the straight list every shipped playbook still is. */
const straight = (): PlaybookStep[] => [step('gather', 'gather'), step('draft', 'write'), step('verify', 'verify'), step('approve', 'approve'), step('send', 'operator')];
const edit = (steps: PlaybookStep[], id: string, extra: Partial<PlaybookStep>): PlaybookStep[] => steps.map(item => (item.id === id ? { ...item, ...extra } : item));
/** The fixture: a failed check goes back to the draft, which may come back twice, then the run ends blocked. */
const looping = (): PlaybookStep[] => edit(edit(straight(), 'verify', { next: [{ on: 'failed', to: 'draft' }] }), 'draft', { maxLoops: 2, onExceeded: 'blocked' });
const T0 = Date.parse('2026-10-26T09:00:00.000Z');

test('flow: validatePlaybook takes edges, loop caps, timeouts, fail-over and a gate, and the hash covers them', () => {
  const steps = edit(edit(looping(), 'gather', { timeoutMs: 60_000, failover: ['draft'] }), 'approve', { gate: { timeoutMs: 3_600_000, default: 'blocked' } });
  assert.equal(validatePlaybook(steps).validated, true);
  assert.notEqual(validatePlaybook(steps).hash, validatePlaybook(straight()).hash);
  // A run deadline sits with the limits; the limits are in the hash.
  const limits: HarnessLimits = { ...DEFAULT_LIMITS, deadlineMs: 2 * 3_600_000 };
  assert.equal(validatePlaybook(steps, { limits, aliases: {} }).validated, true);
  assert.notEqual(playbookHash(steps, { limits, aliases: {} }), playbookHash(steps, { limits: { ...DEFAULT_LIMITS }, aliases: {} }));
});

test('flow: a loop with no cap or gate is refused PLAYBOOK_CYCLE_UNCAPPED; a loop through an approval step is fine', () => {
  const uncapped = edit(straight(), 'verify', { next: [{ on: 'failed', to: 'draft' }] });
  assert.throws(() => validatePlaybook(uncapped), (error: any) => {
    assert.equal(error.code, 'PLAYBOOK_CYCLE_UNCAPPED');
    assert.match(error.message, /draft/);
    assert.match(error.message, /verify/);
    return true;
  });
  // A step that sends the run back to itself.
  assert.throws(() => validatePlaybook(edit(straight(), 'verify', { next: [{ on: 'failed', to: 'verify' }] })), code('PLAYBOOK_CYCLE_UNCAPPED'));
  // A fail-over that goes back round is a loop too.
  assert.throws(() => validatePlaybook(edit(straight(), 'verify', { timeoutMs: 60_000, failover: ['draft'] })), code('PLAYBOOK_CYCLE_UNCAPPED'));
  // The owner decides each time round: the approval step is the loop's gate.
  assert.equal(validatePlaybook(edit(straight(), 'approve', { next: [{ on: 'failed', to: 'draft' }] })).validated, true);
  // The cap may sit on any step of the loop.
  assert.equal(validatePlaybook(edit(edit(straight(), 'verify', { next: [{ on: 'failed', to: 'draft' }] }), 'verify', { next: [{ on: 'failed', to: 'draft' }], maxLoops: 1 })).validated, true);
});

test('flow: an edge or a fail-over to a step that is not there is refused STEP_NOT_FOUND', () => {
  assert.throws(() => validatePlaybook(edit(straight(), 'verify', { next: [{ on: 'failed', to: 'redraft' }] })), (error: any) => {
    assert.equal(error.code, 'STEP_NOT_FOUND');
    assert.match(error.message, /redraft/);
    return true;
  });
  assert.throws(() => validatePlaybook(edit(straight(), 'gather', { timeoutMs: 60_000, failover: ['backup'] })), code('STEP_NOT_FOUND'));
});

test('flow: validatePlaybook refuses each broken edge, cap, timeout, gate and deadline', () => {
  const broken: [string, PlaybookStep[], HarnessLimits?][] = [
    ['no loops', edit(looping(), 'draft', { maxLoops: 0 })],
    ['too many loops', edit(looping(), 'draft', { maxLoops: 6 })],
    ['half a loop', edit(looping(), 'draft', { maxLoops: 1.5 })],
    ['onExceeded with no cap', edit(straight(), 'draft', { onExceeded: 'failed' })],
    ['onExceeded done', edit(looping(), 'draft', { onExceeded: 'done' as any })],
    ['unknown outcome', edit(straight(), 'verify', { next: [{ on: 'maybe' as any, to: 'draft' }], maxLoops: 1 })],
    ['two edges for one outcome', edit(straight(), 'verify', { next: [{ on: 'done', to: 'approve' }, { on: 'done', to: 'send' }] })],
    ['edges not a list', edit(straight(), 'verify', { next: 'draft' as any })],
    ['timeout too short', edit(straight(), 'gather', { timeoutMs: 10 })],
    ['timeout too long', edit(straight(), 'gather', { timeoutMs: 8 * 24 * 3_600_000 })],
    ['fail-over with no timeout', edit(straight(), 'gather', { failover: ['draft'] })],
    ['fail-over to itself', edit(straight(), 'gather', { timeoutMs: 60_000, failover: ['gather'] })],
    ['fail-over twice to one step', edit(straight(), 'gather', { timeoutMs: 60_000, failover: ['draft', 'draft'] })],
    ['a gate on a step the owner does not decide', edit(straight(), 'verify', { gate: { timeoutMs: 3_600_000, default: 'blocked' } })],
    ['a gate that approves on its own', edit(straight(), 'approve', { gate: { timeoutMs: 3_600_000, default: 'done' as any } })],
    ['a gate with no time', edit(straight(), 'approve', { gate: { timeoutMs: 0, default: 'failed' } })],
    ['a deadline too short', straight(), { ...DEFAULT_LIMITS, deadlineMs: 1000 }],
    ['a deadline that is not a number', straight(), { ...DEFAULT_LIMITS, deadlineMs: '2h' as any }],
  ];
  for (const [name, steps, limits] of broken) {
    assert.throws(() => validatePlaybook(steps, limits ? { limits, aliases: {} } : undefined), code('INVALID_VENTURE_REQUEST'), name);
  }
});

test('flow: no edge or fail-over reaches an outside step before the owner approves', () => {
  for (const steps of [
    edit(straight(), 'verify', { next: [{ on: 'done', to: 'send' }] }),
    edit(straight(), 'verify', { next: [{ on: 'failed', to: 'send' }] }),
    edit(straight(), 'gather', { timeoutMs: 60_000, failover: ['send'] }),
  ]) {
    assert.throws(() => validatePlaybook(steps), (error: any) => {
      assert.equal(error.code, 'INVALID_VENTURE_REQUEST');
      assert.match(error.message, /send acts outside Chausar/);
      return true;
    });
  }
  // After the approval, an edge to the outside step is fine.
  assert.equal(validatePlaybook(edit(straight(), 'approve', { next: [{ on: 'done', to: 'send' }] })).validated, true);
});

test('flow: only an approval step\'s done counts as approved; an approval step times out only through its gate', () => {
  // The three probes: an approval step that fails, times out or fails over straight into the outside step.
  const probes: [string, PlaybookStep[]][] = [
    ['failed edge to send', edit(straight(), 'approve', { next: [{ on: 'failed', to: 'send' }] })],
    ['timeout edge to send', edit(straight(), 'approve', { next: [{ on: 'timeout', to: 'send' }] })],
    ['fail-over to send', edit(straight(), 'approve', { timeoutMs: 60_000, failover: ['send'] })],
  ];
  for (const [name, steps] of probes) assert.throws(() => validatePlaybook(steps), code('INVALID_VENTURE_REQUEST'), name);
  // No timeout path on an approval step but its gate, whatever the target.
  assert.throws(() => validatePlaybook(edit(straight(), 'approve', { timeoutMs: 60_000 })), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => validatePlaybook(edit(straight(), 'approve', { next: [{ on: 'timeout', to: 'draft' }] })), code('INVALID_VENTURE_REQUEST'));
  // A failed approval going back to the draft must pass the approval again before it reaches the outside step.
  assert.equal(validatePlaybook(edit(straight(), 'approve', { next: [{ on: 'failed', to: 'draft' }] })).validated, true);
  // An outside step after the approval in the list, reached from a check that failed before it, is not approved.
  const late = [...straight().slice(0, 4), step('polish', 'work'), step('send', 'operator')];
  validatePlaybook(late);
  assert.throws(() => validatePlaybook(edit(late, 'verify', { next: [{ on: 'failed', to: 'polish' }], maxLoops: 1 })), code('INVALID_VENTURE_REQUEST'));
});

test('flow: an edge or fail-over into an outside step comes only from an approval step on done', () => {
  const late = [...straight().slice(0, 4), step('polish', 'work'), step('send', 'operator')];
  // Even after the approval in the walk: only the approval step's own done may name the outside step.
  assert.throws(() => validatePlaybook(edit(late, 'polish', { next: [{ on: 'done', to: 'send' }] })), (error: any) => {
    assert.equal(error.code, 'INVALID_VENTURE_REQUEST');
    assert.match(error.message, /send acts outside Chausar/);
    return true;
  });
  assert.throws(() => validatePlaybook(edit(late, 'polish', { timeoutMs: 60_000, failover: ['send'] })), code('INVALID_VENTURE_REQUEST'));
  assert.equal(validatePlaybook(edit(late, 'approve', { next: [{ on: 'done', to: 'send' }] })).validated, true);
});

test('flow: optional steps are never approvals, checks or outside steps, never break a loop, and may be skipped', () => {
  for (const id of ['approve', 'verify', 'send']) assert.throws(() => validatePlaybook(edit(straight(), id, { optional: true })), code('INVALID_VENTURE_REQUEST'), id);
  assert.throws(() => validatePlaybook(edit(straight(), 'gather', { optional: 'yes' as any })), code('INVALID_VENTURE_REQUEST'));
  assert.equal(validatePlaybook(edit(straight(), 'gather', { optional: true })).validated, true);
  // A loop whose only cap sits on a step that may be skipped is a loop with no cap.
  const polished = [step('gather', 'gather'), step('draft', 'write'), step('polish', 'work', { maxLoops: 2 }), { ...step('verify', 'verify'), next: [{ on: 'failed' as const, to: 'polish' }] }, step('approve', 'approve'), step('send', 'operator')];
  assert.equal(validatePlaybook(polished).validated, true);
  assert.throws(() => validatePlaybook(edit(polished, 'polish', { optional: true })), code('PLAYBOOK_CYCLE_UNCAPPED'));
  // Skipping an optional step before the outside step still needs the approval: the skip edge is walked too.
  const skipped = [...straight().slice(0, 4), step('polish', 'work', { optional: true }), step('send', 'operator')];
  validatePlaybook(skipped);
  assert.throws(() => validatePlaybook(edit(skipped, 'verify', { next: [{ on: 'failed', to: 'polish' }], maxLoops: 1 })), code('INVALID_VENTURE_REQUEST'));
});







test('flow: an approval covers one pass of the outside step; a loop back through it needs the approval again', () => {
  // The two probes: the outside step fails or is done, goes back to the draft, and the draft leads on to it again.
  const looped = (on: 'failed' | 'done'): PlaybookStep[] => [step('gather', 'gather'), step('approve', 'approve'), step('draft', 'write', { maxLoops: 5 }), step('send', 'operator', { next: [{ on, to: 'draft' }] })];
  for (const on of ['failed', 'done'] as const) {
    assert.throws(() => validatePlaybook(looped(on)), (error: any) => {
      assert.equal(error.code, 'INVALID_VENTURE_REQUEST');
      assert.match(error.message, /send acts outside Chausar/);
      return true;
    }, on);
  }
  // Going back through the approval is fine: each pass is approved again.
  const again = [step('gather', 'gather'), step('draft', 'write', { maxLoops: 5 }), step('approve', 'approve'), step('send', 'operator', { next: [{ on: 'failed', to: 'draft' }] })];
  assert.equal(validatePlaybook(again).validated, true);
});

test('flow: no shipped playbook has an edge, a cap, a timeout, a gate or a deadline in W4', async () => {
  const env = await business(PLAIN_IDEA);
  const blueprint = listRecords(env.store.read(), 'venture-blueprint').at(-1)!;
  const shipped: [string, readonly PlaybookStep[]][] = [
    ['eight fixed steps', playbookSteps(blueprint)],
    ...[YOUTUBE_ID, CA_FIRM_ID, SOCIAL_AGENCY_ID].map(id => [id, flagshipDelivery(id)!.steps] as [string, readonly PlaybookStep[]]),
  ];
  for (const [name, steps] of shipped) {
    for (const item of steps) {
      for (const field of ['next', 'maxLoops', 'onExceeded', 'timeoutMs', 'failover', 'gate'] as const) assert.equal(item[field], undefined, `${name} ${item.id} ${field}`);
    }
  }
  assert.equal((DEFAULT_LIMITS as HarnessLimits).deadlineMs, undefined);
});
