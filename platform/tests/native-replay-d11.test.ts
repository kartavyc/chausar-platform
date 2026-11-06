import { retainReplaySample } from './fixtures/replay-samples.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import { Engine } from '../runtime/engine.ts';
import { createClaudeDriver } from '../runtime/venture/agent-runtime/claude-driver.ts';
import { setup, seedBlueprint, seedOrder, owner } from './venture-views-env.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { agreeClientAiConsent, getClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { presetSpec } from '../runtime/venture/models/presets.ts';
import { MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';
import { runRoot } from '../runtime/run-root.mjs';
import { replayEngineRun } from '../runtime/venture/replay/engine-run.ts';

test('a full native sample job replays real Chausar MCP calls and retains exact consent gates', { timeout: 60_000 }, async t => {
  const env = await setup();
  const { client, order } = await seedOrder(env, await seedBlueprint(env));
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  await ventureAction(env.deps, owner, 'admin', 'sample.prepare', tx => {
    tx.touch({ launchStage: 'approve-each' });
    tx.replace({ ...client, email: null });
    tx.put({ ...tx.base('venture-model-connection'), presetId: 'claude-code-cli', routeKind: 'claude-code-cli', model: 'claude-sonnet-5-5', endpoint: null, tiers: ['fast', 'main'], consentDigest: presetSpec('claude-code-cli').consentDigest, consentedAt: env.now(), monthlyCapMicros: '5000000', status: 'connected' } as never);
  });
  const consent = await getClientAiConsent(env.deps, owner, { clientId: client.id });
  await agreeClientAiConsent(env.deps, owner, { clientId: client.id, disclosureDigest: consent.disclosureDigest });
  const root = await mkdtemp(join(tmpdir(), 'chausar-native-capture-'));
  let prompts = 0;
  const driver = createClaudeDriver({ executable: process.execPath, queryFactory: input => {
    let closed = false;
    return { interrupt: async () => {}, close: () => { closed = true; }, async *[Symbol.asyncIterator]() {
      const config = input.options.mcpServers!.chausar as { env: Record<string, string> };
      const socket = connect(config.env.CHAUSAR_AGENT_MCP_SOCKET);
      const lines = createInterface({ input: socket }), replies = lines[Symbol.asyncIterator](); let id = 0;
      const send = async (body: unknown) => { socket.write(JSON.stringify(body) + '\n'); return JSON.parse((await replies.next()).value!); };
      try {
        await send({ token: config.env.CHAUSAR_AGENT_MCP_TOKEN });
        await send({ jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'sample', version: '1' } } });
        socket.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        const call = async (name: string, args = {}) => { const reply = await send({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }); assert.equal(reply.error, undefined); return reply.result.structuredContent.data; };
        for await (const prompt of input.prompt) {
          if (closed) break; prompts++;
          yield { type: 'system', subtype: 'init', session_id: 'sample-session', model: 'claude-sonnet-5-5' } as any;
          const business = await call('read_business'); await call('read_client'); await call('read_order');
          const price = await call('calculate', { operation: 'order_price', arguments: {} });
          const ref = price.refs.figures.find((entry: any) => entry.figureKey === 'total').ref;
          await call('draft_document', { draft: { title: 'Sample draft', sections: business.sections.map((heading: string, index: number) => ({ heading, parts: [{ kind: 'text', text: 'Please review this draft before sharing it.', ref: '' }, ...(index ? [] : [{ kind: 'figure', text: '', ref }])] })), questionsForClient: [] } });
          yield { type: 'result', subtype: 'success', is_error: false, result: 'Sample draft saved for review.', user_message_uuid: prompt.uuid, usage: { input_tokens: 12, output_tokens: 4 } } as any;
        }
      } finally { lines.close(); socket.destroy(); }
    } };
  } });
  const offline = async () => { throw new Error('No external model calls in this sample.'); };
  const engine = new Engine({ directory: join(root, 'data'), demo: true, storage: 'experimental-file', capture: { dir: join(root, 'captures') }, venture: {
    host: 'test', modelTransport: { replay: true, http: offline, process: offline },
    agentRoute: async () => ({ driver, presetId: 'claude-code-cli', settings: { model: 'claude-sonnet-5-5', effort: 'high', autoReview: true, network: false, shell: false, webSearch: false } }),
  } });
  t.after(async () => { await engine.close(); await rm(root, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Native sample', passphrase: 'sample-native-passphrase', demo: true });
  const workspace = engine.vault!.read().workspace;
  const sampleState = env.store.read(); sampleState.workspace = workspace;
  await engine.vault!.restoreCaptureState(sampleState);
  const captured = await engine.captureRequest('venture.delivery.run', { orderId: order.id }, 'sample business');
  const capture = JSON.parse(await readFile(captured.path, 'utf8'));
  await retainReplaySample('native-draft', capture);
  assert.equal(prompts, 1);
  assert.ok(capture.events.some((event: any) => event.kind === 'driver' && event.line.includes('"direction":"tool"')));
  assert.ok(!JSON.stringify(capture).includes('CHAUSAR_AGENT_MCP_TOKEN'));
  assert.equal(engine.vault!.read().actions.length, 0);
  assert.deepEqual((await replayEngineRun(capture)).differences, []);
  assert.equal(prompts, 1, 'replay never invokes the live SDK factory');
  if (process.env.CI) { const out = runRoot('native-replay'); await mkdir(out, { recursive: true }); await writeFile(join(out, 'native-sample.capture.json'), JSON.stringify(capture, null, 2)); }
});
