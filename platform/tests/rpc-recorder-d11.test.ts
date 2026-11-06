import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Engine } from '../runtime/engine.ts';
import { createRpcRecorder } from './helpers/rpc-recorder.ts';
import { createRecordingCodec, hydrateRecordingValue, normaliseReplayValue } from '../shared/rpc-recording.ts';

const EPOCH = '2026-11-06T12:00:00.000Z';

test('a real engine scenario records byte-equal answers and event order twice with a fixed clock', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-rpc-recording-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function once(name: string) {
    const engine = new Engine({ directory: join(root, name), demo: true, storage: 'experimental-file', venture: {
      host: 'test', clock: () => new Date(EPOCH),
      modelTransport: { replay: true, http: async () => { throw new Error('No model answer in this scenario.'); }, process: async () => { throw new Error('No native tool in this scenario.'); } },
    } });
    const recorder = createRpcRecorder(engine, { epoch: EPOCH, scenario: 'about-you-keywords' });
    try {
      await recorder.request('venture.countries', {});
      await recorder.request('venture.about.read', { text: 'I keep books for small shops in India.' });
      const file = join(root, `${name}.json`);
      await recorder.write(file);
      return await readFile(file, 'utf8');
    } finally { recorder.close(); await engine.close(); }
  }
  const first = await once('first');
  assert.equal(await once('second'), first);
  const recording = JSON.parse(first);
  const kinds = recording.frames.map((frame: { kind: string }) => frame.kind);
  assert.equal(kinds[0], 'request');
  assert.equal(kinds.at(-1), 'answer');
  assert.ok(kinds.includes('event'), 'The actual engine emitted work-step events between request and answer.');
  for (const entry of Object.values(recording.placeholders) as { kind: string; offsetMs?: number }[]) {
    if (entry.kind === 'time') assert.equal(entry.offsetMs, 0, 'Recorded work uses the injected engine clock.');
  }
});

test('normalization preserves identity relationships, valid UI dates and substantive words', () => {
  function sample() {
    const id = `client_${randomUUID()}`;
    const digest = randomUUID().replaceAll('-', '').repeat(2);
    const codec = createRecordingCodec(EPOCH);
    const value = codec.encode({ id, link: `#/clients?sheet=client:${id}`, at: EPOCH, later: '2026-11-07T12:00:00.000Z', digest, state: 'plan_approved', display: 'INR 500.00' });
    return { value, placeholders: codec.placeholders };
  }
  const first = sample();
  assert.deepEqual(sample(), first);
  const hydrated = hydrateRecordingValue(first.value, first.placeholders, EPOCH) as Record<string, string>;
  assert.match(hydrated.id!, /^client_[a-f0-9-]{36}$/);
  assert.equal(hydrated.link, `#/clients?sheet=client:${hydrated.id}`);
  assert.equal(hydrated.at, EPOCH);
  assert.equal(hydrated.later, '2026-11-07T12:00:00.000Z');
  assert.match(hydrated.digest!, /^[a-f0-9]{64}$/);
  assert.equal(hydrated.state, 'plan_approved');
  assert.equal(hydrated.display, 'INR 500.00');
  assert.deepEqual(normaliseReplayValue(hydrated, first.placeholders, EPOCH), first.value);
  assert.notDeepEqual(normaliseReplayValue({ ...hydrated, id: `client_${randomUUID()}` }, first.placeholders, EPOCH), first.value, 'An unknown ID is not silently accepted as the expected one.');
});

test('a raw key-shaped payload or answer poisons the recording and cannot be written', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-rpc-secret-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const secret = ['sk', 'ant', 'api03', 'A7b9C2d4E6f8G1h3J5k7L9m2N4p6Q8r0'].join('-');
  let calls = 0;
  const target = { request: async (_method: string, _payload: unknown) => { calls++; return { text: secret }; }, onVentureEvent: (_listener: (event: unknown) => void) => () => {} };
  const input = createRpcRecorder(target, { epoch: EPOCH, scenario: 'secret-input' });
  await assert.rejects(input.request('sample.read', { text: secret }), /secret/i);
  assert.equal(calls, 0);
  await assert.rejects(input.write(join(root, 'input.json')), /secret/i);
  const output = createRpcRecorder(target, { epoch: EPOCH, scenario: 'secret-output' });
  await assert.rejects(output.request('sample.read', {}), /secret/i);
  await assert.rejects(output.write(join(root, 'output.json')), /secret/i);
  await assert.rejects(readFile(join(root, 'input.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(root, 'output.json')), { code: 'ENOENT' });
  input.close(); output.close();
});

test('an event secret is refused even when the engine swallows listener errors', async () => {
  let listener: (event: unknown) => void = () => {};
  const target = {
    onVentureEvent: (next: (event: unknown) => void) => { listener = next; return () => {}; },
    request: async () => { try { listener({ text: ['ghp', 'A7b9C2d4E6f8G1h3J5k7L9m2N4p6Q8r0Z1x3'].join('_') }); } catch {} return { ok: true }; },
  };
  const recorder = createRpcRecorder(target, { epoch: EPOCH, scenario: 'secret-event' });
  await assert.rejects(recorder.request('sample.read', {}), /secret/i);
  assert.throws(() => recorder.finish(), /secret/i);
  recorder.close();
});

test('a coded refusal retains its owner flag and reason and normalizes generated identities in its words', async () => {
  const id = `client_${randomUUID()}`;
  const target = { request: async () => { throw Object.assign(new Error(`Client ${id} needs consent.`), { code: 'CONSENT_REQUIRED', reason: id, owner: true }); }, onVentureEvent: (_listener: (event: unknown) => void) => () => {} };
  const recorder = createRpcRecorder(target, { epoch: EPOCH, scenario: 'owner-refusal' });
  await assert.rejects(recorder.request('sample.read', {}), { code: 'CONSENT_REQUIRED' });
  assert.deepEqual(recorder.finish().frames.at(-1), { kind: 'error', id: 1, error: { code: 'CONSENT_REQUIRED', message: 'Client <id-1> needs consent.', reason: '<id-1>', owner: true } });
  recorder.close();
});
