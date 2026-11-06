import test from 'node:test';
import assert from 'node:assert/strict';
import { recordScenario } from '../helpers/recording-scenario.ts';

test('first-run and About you answers match the real engine recording', async t => {
  await recordScenario(t, 'first-run', async ({ rpc }) => {
    const status = await rpc.request('workspace.status', {});
    assert.equal(status.open, false);
    const countries = await rpc.request('venture.countries', {});
    assert.ok(countries.some((row: { code: string }) => row.code === 'IN'));
    const about = await rpc.request('venture.about.read', { text: 'I keep books for small shops in India.' });
    assert.equal(about.country?.code, 'IN');
  }, { initial: 'empty' });
});
