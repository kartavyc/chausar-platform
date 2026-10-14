import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelsExtHostOptions, pluginCredentialBroker } from '../runtime/models-ext/host-options.ts';
import { Engine } from '../runtime/engine.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

const publicKey = () => generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');

test('installed-app options come only from CHAUSAR_* settings and never carry a secret', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-mx-hostopts-'));
  try {
    const clips = join(directory, 'clips.json'); await writeFile(clips, JSON.stringify({ schema: 'synthetic' }));
    const key = publicKey();
    const options = modelsExtHostOptions({ directory, demo: false, env: { CHAUSAR_BENCH_TRANSCRIPTS: '/srv/transcripts', CHAUSAR_SPEECH_BENCH_FIXTURES: clips,
      CHAUSAR_PLUGIN_PUBLISHER_KEYS: JSON.stringify([{ publisherId: 'acme', publicKey: key }]),
      CHAUSAR_PLUGIN_CREDENTIALS: JSON.stringify([{ plugin: 'acme/rates', site: 'api.example.com', header: 'Authorization', env: 'CHAUSAR_ACME_KEY' }]),
      CHAUSAR_ACME_KEY: 'Bearer secret-value' } });
    assert.equal(options.benchTranscripts, '/srv/transcripts'); assert.deepEqual(options.speechBench, { schema: 'synthetic' });
    assert.deepEqual(options.publisherKeys, [{ publisherId: 'acme', publicKey: key }]);
    assert.equal(typeof options.pluginCredentials, 'function'); assert.equal(JSON.stringify(options).includes('secret-value'), false);
    assert.equal(options.pluginSigningKey, undefined); assert.equal(options.clock, undefined); assert.equal(options.pluginTransport, undefined);
    assert.deepEqual(modelsExtHostOptions({ directory, demo: true, env: { CHAUSAR_BENCH_TRANSCRIPTS: '/srv/transcripts' } }), {});
    const bad = modelsExtHostOptions({ directory, demo: false, env: { CHAUSAR_BENCH_TRANSCRIPTS: 'relative/path', CHAUSAR_SPEECH_BENCH_FIXTURES: join(directory, 'missing.json'),
      CHAUSAR_PLUGIN_PUBLISHER_KEYS: '{not json', CHAUSAR_PLUGIN_CREDENTIALS: JSON.stringify([{ plugin: 'acme/rates', site: 'api.example.com', header: 'Authorization', env: 'HOME' }]) } });
    assert.deepEqual(bad, {});
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('plugin credentials are read from the named variable at request time, only for the exact plugin and site', () => {
  let env: Record<string, string | undefined> = {};
  const broker = pluginCredentialBroker([{ plugin: 'acme/rates', site: 'api.example.com', header: 'X-Api-Key', env: 'CHAUSAR_ACME_KEY' }], () => env)!;
  assert.equal(broker({ plugin: 'acme/rates', site: 'api.example.com' }), null);
  env = { CHAUSAR_ACME_KEY: 'k1' };
  assert.deepEqual(broker({ plugin: 'acme/rates', site: 'api.example.com' }), { 'X-Api-Key': 'k1' });
  assert.equal(broker({ plugin: 'acme/rates', site: 'evil.example.com' }), null);
  assert.equal(broker({ plugin: 'other/rates', site: 'api.example.com' }), null);
  env = { CHAUSAR_ACME_KEY: 'k1\r\nX-Injected: 1' };
  assert.equal(broker({ plugin: 'acme/rates', site: 'api.example.com' }), null);
  assert.equal(pluginCredentialBroker([{ plugin: 'acme/rates', site: 'http://api.example.com', header: 'X', env: 'CHAUSAR_A' }], () => env), undefined);
});

test('the engine builds the options itself when the host passes none', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-mx-hostopts-engine-'));
  const key = publicKey(); const previous = process.env.CHAUSAR_PLUGIN_PUBLISHER_KEYS;
  process.env.CHAUSAR_PLUGIN_PUBLISHER_KEYS = JSON.stringify([{ publisherId: 'acme', publicKey: key }]);
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock) });
  try {
    await engine.request('workspace.create', { name: 'Options Shop', passphrase: 'correct horse battery staple 42', demo: false, pack: 'ecommerce' });
    const list = await engine.request('smallapps.pluginList', {});
    assert.deepEqual(list.trustedKeys.map((k: any) => ({ publisherId: k.publisherId, origin: k.origin })), [{ publisherId: 'acme', origin: 'host' }]);
  } finally {
    if (previous === undefined) delete process.env.CHAUSAR_PLUGIN_PUBLISHER_KEYS; else process.env.CHAUSAR_PLUGIN_PUBLISHER_KEYS = previous;
    await engine.request('workspace.lock', {}).catch(() => {}); await rm(directory, { recursive: true, force: true });
  }
});
