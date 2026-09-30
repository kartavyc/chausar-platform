import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine } from '../runtime/engine.ts';

test('desktop running package version is explicit and invalid versions are refused', async () => {
  const engine = new Engine({ directory: '.', demo: true, storage: 'experimental-file', version: '2.3.4-preview.2' });
  assert.equal((await engine.request('workspace.status')).version, '2.3.4-preview.2'); await engine.shutdown();
  assert.throws(() => new Engine({ directory: '.', version: '2.03.4' }), (error: any) => error.code === 'INVALID_VERSION');
});

test('isolated analytics and plugin processes preserve Electron Node mode without widening their environment', async () => {
  const analytics = await readFile(new URL('../runtime/analytics.ts', import.meta.url), 'utf8');
  const plugins = await readFile(new URL('../runtime/plugins.ts', import.meta.url), 'utf8');
  const analyticsEnv = analytics.match(/env: process\.platform === 'win32' \? (\{[^}]+\}) : (\{[^}]+\})/)!, pluginEnv = plugins.match(/env: (\{[^}]+\})/)![1];
  for (const [source, keys] of [[analyticsEnv[1], ['ELECTRON_RUN_AS_NODE', 'SystemRoot', 'TEMP', 'TMP']], [analyticsEnv[2], ['ELECTRON_RUN_AS_NODE', 'TMPDIR']], [pluginEnv, ['ELECTRON_RUN_AS_NODE', 'SystemRoot']]] as Array<[string, string[]]>) {
    const environment = Function('process', 'directory', `return (${source})`)({ env: { SystemRoot: 'C:/Windows', SECRET_FIXTURE: 'must not pass' } }, '/owned/temporary');
    assert.equal(environment.ELECTRON_RUN_AS_NODE, '1'); assert.deepEqual(Object.keys(environment).sort(), keys.sort());
  }
});
