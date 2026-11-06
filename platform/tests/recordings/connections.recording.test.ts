import test from 'node:test';
import assert from 'node:assert/strict';
import { secretFindings } from '../../runtime/venture/core/secrets.ts';
import { recordScenario } from '../helpers/recording-scenario.ts';

// Only saved owner settings change. This scenario does not connect or check a live service.
test('Connections records its catalogue and an owner-approved AI settings change', async t => {
  await recordScenario(t, 'connections', async ({ engine, rpc }) => {
    for (const method of ['venture.connectors.list', 'venture.agentSettings.get']) {
      const raw = await engine.request(method, {});
      const inspect = (value: unknown, path: string): void => {
        if (typeof value === 'string') {
          const kinds = secretFindings(value);
          if (kinds.length) console.log(JSON.stringify({ method, path, kinds, length: value.length }));
        } else if (value && typeof value === 'object') {
          for (const [key, item] of Object.entries(value)) inspect(item, path + '.' + key);
        }
      };
      console.log(JSON.stringify({ method, wholeKinds: secretFindings(JSON.stringify(raw)) }));
      inspect(raw, 'answer');
    }
    const cards = await rpc.request('venture.connectors.list', {});
    assert.ok(cards.length > 0);
    const before = await rpc.request('venture.agentSettings.get', {});
    const settings = structuredClone(before.settings);
    settings.codex.network = 'off';
    settings.codex.webSearch = 'off';
    const saved = await rpc.request('venture.agentSettings.set', { settings });
    assert.equal(saved.settings.codex.network, 'off');
    assert.equal(saved.settings.codex.webSearch, 'off');
    assert.equal(saved.settings.codex.shell, false);
    const readBack = await rpc.request('venture.agentSettings.get', {});
    assert.deepEqual(readBack.settings, saved.settings);
    await rpc.request('venture.connectors.list', {});
  });
});

