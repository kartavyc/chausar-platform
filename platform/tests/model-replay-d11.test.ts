import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { presetSpec } from '../runtime/venture/models/presets.ts';
import { templateInterview } from '../runtime/venture/core/interview.ts';
import { classifyIdea, serviceTemplate } from '../runtime/venture/core/service-types.ts';
import { replayEngineRun } from '../runtime/venture/replay/engine-run.ts';
const idea = 'A weekend photography studio in Pune for birthday parties and shop product photos.';
test('a paid-mode model capture replays the same spend records without provider credentials or IO', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-model-capture-')); let calls = 0;
  const engine = new Engine({ directory: join(root, 'data'), demo: true, storage: 'experimental-file', capture: { dir: join(root, 'captures') }, venture: {
    host: 'test', credentials: { get: async () => 'sample-only-provider-credential', set: async () => {}, delete: async () => {} },
    modelTransport: { replay: false, process: async () => { throw new Error('No process expected'); }, http: async () => {
      calls++; return { status: 200, body: JSON.stringify({ id: 'sample-answer', model: 'claude-haiku-5-5', content: [{ type: 'text', text: JSON.stringify(templateInterview(serviceTemplate(classifyIdea(idea)))) }], stop_reason: 'end_turn', usage: { input_tokens: 812, output_tokens: 164 } }) };
    } },
  } });
  t.after(async () => { await engine.close(); await rm(root, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Model sample', passphrase: 'sample-model-passphrase', demo: true });
  await engine.request('venture.create', { idea, countryCode: 'IN', workingName: 'Model sample' });
  const ventureId = (await engine.request('venture.get', {})).venture.id;
  await engine.vault!.update(state => {
    state.policy.send = 'shape';
    state.conversations.push({ id: 'connection_sample123', kind: 'venture-model-connection', ventureId, memberId: 'owner', epoch: 1, at: '2026-11-06T10:00:00.000Z', presetId: 'anthropic-haiku-5-5', routeKind: 'anthropic-messages', model: 'claude-haiku-5-5', endpoint: null, tiers: ['fast', 'main'], consentDigest: presetSpec('anthropic-haiku-5-5').consentDigest, consentedAt: '2026-11-06T10:00:00.000Z', monthlyCapMicros: '5000000', status: 'connected' });
  });
  const saved = await engine.captureRequest('venture.interview.next', {}, 'sample business');
  const capture = JSON.parse(await readFile(saved.path, 'utf8'));
  const call = capture.records.find((row: any) => row.kind === 'venture-model-call');
  assert.equal(calls, 1); assert.equal(call.replay, false); assert.ok(Number(call.costMicros) > 0);
  assert.ok(!JSON.stringify(capture).includes('sample-only-provider-credential'));
  assert.deepEqual((await replayEngineRun(capture)).differences, []);
  assert.equal(calls, 1);
});
