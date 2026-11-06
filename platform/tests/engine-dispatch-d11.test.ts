import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALL_METHODS } from '../runtime/method-registry.ts';
import { Engine } from '../runtime/engine.ts';

const areas = ['workspace-methods', 'custody-methods', 'draft-desk-methods', 'updates-methods', 'app-methods', 'venture-methods', 'legacy-methods'];
test('every registered request has exactly one area handler and the combined table contains no invented method', async () => {
  const entries: string[] = [];
  for (const area of areas) {
    const table = (await import('../runtime/engine/' + area + '.ts')).METHODS;
    assert.ok(table && typeof table === 'object', area);
    for (const [method, handler] of Object.entries(table)) { assert.equal(typeof handler, 'function', method); entries.push(method); }
  }
  const counts = new Map<string, number>(); for (const name of entries) counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const method of ALL_METHODS) assert.equal(counts.get(method), 1, method);
  assert.deepEqual([...counts.keys()].sort(), [...ALL_METHODS].sort());
  const legacySource = await readFile(new URL('../runtime/legacy/dispatch.ts', import.meta.url), 'utf8');
  const legacyCases = [...legacySource.matchAll(/case '([^']+)':/g)].map(match => match[1]);
  const legacy = await import('../runtime/engine/legacy-methods.ts');
  assert.equal(new Set(legacyCases).size, legacyCases.length, 'Every legacy arm must be unique.');
  assert.deepEqual(legacyCases.sort(), Object.keys(legacy.METHODS).sort(), 'Legacy registration must match actual implemented switch arms.');
  const combined = (await import('../runtime/engine/' + 'dispatch.ts')).ENGINE_HANDLERS;
  assert.deepEqual(Object.keys(combined).sort(), [...ALL_METHODS].sort());
});

test('engine owns lifecycle and a bounded dispatcher rather than method switches', async () => {
  const source = await readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /switch\s*\(method\)/);
  assert.ok(source.split(/\r?\n/).length < 1200, 'engine.ts must stay under 1,200 lines after its area helpers move.');
});

test('dispatch preserves pre-vault reads, unknown-request admission and prototype-name refusal', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-dispatch-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  assert.equal((await engine.request('workspace.status')).open, false);
  assert.ok(await engine.request('venture.countries'));
  await assert.rejects(engine.request('unknown.d11'), { code: 'VAULT_LOCKED' });
  await engine.request('workspace.create', { name: 'Synthetic dispatch', passphrase: 'synthetic dispatch passphrase' });
  for (const method of ['unknown.d11', 'constructor', 'toString', '__proto__']) await assert.rejects(engine.request(method), { name: 'Error', message: 'Unknown request: ' + method });
  assert.equal((await engine.request('workspace.status')).open, true);
  await engine.request('workspace.lock');
  assert.equal((await engine.request('workspace.status')).open, false);
});
