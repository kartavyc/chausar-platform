// C7 task 3: venture.models.plan, the plan meter for Connections, Your AI. Only what the tools reported, with its source
// and time; fresh asks Codex once (a stand-in here, nothing is started); a failed fresh read is unknown, never an error.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { VentureDeps } from '../runtime/venture/contracts.ts';
import { handlers } from '../runtime/venture/models/index.ts';
import { planBookOf } from '../runtime/venture/models/plan-book.ts';
import { fromCodexLimits } from '../runtime/venture/models/plan-meter.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const NOW = '2026-11-06T10:00:00.000Z';
const reset = (iso: string) => Math.floor(Date.parse(iso) / 1000);
function deps(options: { host?: string; codexPlan?: () => Promise<unknown> } = {}) {
  const store = new VentureTestStore();
  return { store, clock: () => new Date(NOW), host: options.host ?? 'desktop', models: { codexPlan: options.codexPlan } } as unknown as VentureDeps;
}
const plan = (d: VentureDeps, payload: unknown = {}) => (handlers as any)['venture.models.plan'](d, owner, payload);

test('with nothing noted both tools read unknown with the plain line; Check now is Codex only', async () => {
  const view = await plan(deps());
  assert.deepEqual(view.tools.map((t: any) => [t.cli, t.state, t.source, t.canCheck]), [
    ['claude-code', 'unknown', "Claude Code hasn't reported its plan use yet.", false],
    ['codex', 'unknown', "Codex hasn't reported its plan use yet.", true],
  ]);
  assert.deepEqual(view.tools[1].windows, []);
});

test('after a note the view has the windows, their lines and the source with its time', async () => {
  const d = deps();
  planBookOf(d.store).note(fromCodexLimits({ rateLimits: { primary: { usedPercent: 62, windowDurationMins: 300, resetsAt: reset('2026-11-06T16:30:00Z') }, secondary: { usedPercent: 18, windowDurationMins: 10080, resetsAt: reset('2026-11-09T05:00:00Z') } } }, '2026-11-06T09:55:00.000Z'));
  const codex = (await plan(d)).tools[1];
  assert.equal(codex.state, 'ok');
  assert.deepEqual(codex.windows.map((w: any) => w.line), ['5-hour window: 62% used, resets 4:30 pm', 'This week: 18% used, resets Mon']);
  assert.equal(codex.source, 'As Codex reported at 9:55 am.');
});

test('fresh asks Codex once; a failed fresh read is unknown, never an error; hosted answers TIER_UNAVAILABLE', async () => {
  let asked = 0;
  const d = deps({ codexPlan: async () => { asked++; return { rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: reset('2026-11-06T11:00:00Z') } } }; } });
  assert.equal((await plan(d)).tools[1].state, 'unknown'); assert.equal(asked, 0);
  const fresh = await plan(d, { fresh: true });
  assert.equal(asked, 1); assert.equal(fresh.tools[1].state, 'used-up'); assert.equal(fresh.tools[0].state, 'unknown');
  const failing = deps({ codexPlan: async () => { throw new Error('no codex'); } });
  assert.equal((await plan(failing, { fresh: true })).tools[1].state, 'unknown');
  await assert.rejects(plan(deps({ host: 'hosted-web' })), { code: 'TIER_UNAVAILABLE' });
  await assert.rejects(plan(deps(), { fresh: 'yes' }), { code: 'INVALID_VENTURE_REQUEST' });
});
