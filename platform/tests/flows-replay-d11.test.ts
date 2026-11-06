import { retainReplaySample } from './fixtures/replay-samples.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { presetSpec } from '../runtime/venture/models/presets.ts';
import { replayEngineRun } from '../runtime/venture/replay/engine-run.ts';
import { setup, seedBlueprint } from './venture-views-env.ts';
for (const chat of [true, false]) test(chat ? 'Chats sample captures its real approved model answer and replays offline' : 'rehearsal sample executes and replays the actual practice engine flow', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-flows-capture-')); let calls = 0;
  const answer = { tools: [], parts: [{ kind: 'text', text: 'The draft stays here for your review.', receiptId: '', key: '' }], proposals: [] };
  const engine = new Engine({ directory: join(root, 'data'), demo: true, storage: 'experimental-file', capture: { dir: join(root, 'captures') }, venture: { host: 'test', credentials: { get: async () => 'sample-only-provider-credential', set: async () => {}, delete: async () => {} }, modelTransport: { replay: false, process: async () => { throw new Error('No process'); }, http: async () => { calls++; return { status: 200, body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', usage: { input_tokens: 150, output_tokens: 50 } }) }; } } } });
  t.after(async () => { await engine.close(); await rm(root, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Flow sample', passphrase: 'sample-flow-passphrase', demo: true });
  const env = await setup(); await seedBlueprint(env); const state = env.store.read(); state.workspace = engine.vault!.read().workspace; await engine.vault!.restoreCaptureState(state);
  let method: string, payload: Record<string, unknown>;
  if (chat) {
    await engine.request('venture.models.connect', { presetId: 'anthropic-sonnet-5-5', consentDigest: presetSpec('anthropic-sonnet-5-5').consentDigest, apiKey: 'sample-only-provider-credential' });
    const view = await engine.request('venture.chief.threads', {});
    await engine.request('venture.chats.consent', { digest: view.consent.digest });
    method = 'venture.chief.thread.send'; payload = { text: 'What should I review before sharing work?' };
  } else {
    const scenarios = await engine.request('venture.simulation.scenarios', {});
    method = 'venture.simulation.run'; payload = { scenarioIds: [scenarios[0].id], episodes: 1, useTemplate: true };
  }
  const saved = await engine.captureRequest(method, payload, 'sample business');
  const capture = JSON.parse(await readFile(saved.path, 'utf8'));
  await retainReplaySample(chat ? 'chats' : 'rehearsal', capture);
  assert.ok(capture.records.some((row: any) => row.kind === (chat ? 'venture-chief-message' : 'venture-simulation-run')));
  assert.equal(calls, chat ? 1 : 0); assert.deepEqual((await replayEngineRun(capture)).differences, []); assert.equal(calls, chat ? 1 : 0);
});
