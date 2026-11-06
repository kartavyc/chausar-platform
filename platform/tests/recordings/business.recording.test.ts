import test from 'node:test';
import assert from 'node:assert/strict';
import { recordScenario } from '../helpers/recording-scenario.ts';

// Each approval carries the exact disclosure digest. A size-only save preserves that choice.
test('Business records profession approval and owner size settings', async t => {
  await recordScenario(t, 'business', async ({ rpc }) => {
    const view = await rpc.request('venture.compliance.get', { profession: 'home-chef-tiffin' });
    await assert.rejects(rpc.request('venture.compliance.set', { profession: 'home-chef-tiffin', sideWork: 'allowed', digest: '0'.repeat(64) }), { code: 'APPROVAL_STALE' });
    const saved = await rpc.request('venture.compliance.set', { profession: 'home-chef-tiffin', sideWork: 'allowed', digest: view.digest, size: { turnover: 'up-to-1500000000' } });
    assert.equal(saved.recorded.professionId, 'home-chef-tiffin');
    assert.equal(saved.size.questions[0].answer, 'up-to-1500000000');
    const changed = await rpc.request('venture.compliance.set', { size: { turnover: 'not-say' } });
    assert.equal(changed.size.questions[0].answer, 'not-say');
    assert.deepEqual(changed.recorded, saved.recorded);
    await rpc.request('venture.compliance.get', {});
    await rpc.request('venture.rules.locks', {});
  });
});
