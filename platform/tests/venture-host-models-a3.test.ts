// One-shot A3, found by the live check on Codex: the venture host hands every package a frozen models port that forwards
// to the real one (host.ts), and it forwarded only the first seven methods. The Codex setup, its digest-checked program,
// what a tool printed and the models Codex offers never reached the packages, so on the desktop every Codex agent job was
// refused ("Choose the Codex Chausar found under Connect your AI first.") and the model list was never read. The host
// now forwards every method of the port, and a port that lacks an optional one answers as its contract says.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelPort } from '../runtime/venture/contracts.ts';
import { forwardModels, MODEL_PORT_METHODS } from '../runtime/venture/host.ts';
import { CODEX_MODEL_DEFAULTS } from '../runtime/venture/models/codex-models.ts';

test('A3: the host forwards every models port method to the real port, with its arguments and its answer', async () => {
  const seen: string[] = [];
  const port = Object.fromEntries(MODEL_PORT_METHODS.map(name => [name, (...args: unknown[]) => { seen.push(`${name}(${args.join(',')})`); return `${name} answered`; }])) as unknown as ModelPort;
  const forwarded = forwardModels(() => port);
  assert.ok(Object.isFrozen(forwarded));
  for (const name of MODEL_PORT_METHODS) {
    const method = (forwarded as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
    assert.equal(typeof method, 'function', `${name} is forwarded`);
    assert.equal(await method('a', 'b', 'c', 'd', 'e'), `${name} answered`, name);
  }
  assert.deepEqual(seen.map(line => line.slice(0, line.indexOf('('))), [...MODEL_PORT_METHODS], 'each reached the real port once, in order');
  assert.ok(seen.includes('runPreview(a,b,c,d,e)') && seen.includes('generate(a,b)') && seen.includes('toolSaid(a)'), 'with its arguments');
  for (const name of ['codexSetup', 'codexProgram', 'codexVerifiedProgram', 'toolSaid', 'codexModels', 'inspectCli']) assert.ok((MODEL_PORT_METHODS as readonly string[]).includes(name), name);
});

test('A3: a port without an optional method answers as the contract says: none, the fixed models, or no setup in use', async () => {
  const bare = { status: () => null, presets: () => [], checkCli: async () => undefined, generate: async () => null, preview: async () => null, runPreview: async () => null } as unknown as ModelPort;
  const forwarded = forwardModels(() => bare);
  assert.equal(await forwarded.codexSetup!(), null);
  assert.equal(forwarded.codexProgram!(), null);
  assert.equal(forwarded.toolSaid!('call_1'), null);
  assert.deepEqual(await forwarded.codexModels!(), { ...CODEX_MODEL_DEFAULTS, listed: null, source: 'fallback' });
  await assert.rejects(forwarded.codexVerifiedProgram!(), { code: 'CODEX_SETUP_UNAVAILABLE' });
  await assert.rejects(forwarded.inspectCli!('codex'), { code: 'NOT_BUILT_YET' });
});

test('A3: before the models package loads, every method says so', async () => {
  const forwarded = forwardModels(() => { throw Object.assign(new Error('This part of Chausar is not built yet.'), { code: 'NOT_BUILT_YET' }); });
  assert.throws(() => forwarded.status({} as never), { code: 'NOT_BUILT_YET' });
  await assert.rejects(forwarded.codexVerifiedProgram!(), { code: 'NOT_BUILT_YET' });
});
