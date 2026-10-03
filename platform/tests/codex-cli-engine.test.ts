import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { hash } from '../runtime/contracts.ts';
import type { GatewayOptions, ProcessRequest, ProcessResult } from '../runtime/gateway.ts';
import { CODEX_CLI_CONFIG, CODEX_CLI_FLAGS } from '../runtime/providers/codex-cli.ts';
import type { CodexCliCapabilityProfile } from '../runtime/providers/codex-cli.ts';

// All CLI interfaces, models, events, transports and business data here are synthetic.
// Only the public application HTTP endpoint binds localhost; no CLI or provider is contacted.
const routeId = 'synthetic-codex-rpc';
const question = 'What was earned?';
const period = { from: '2026-09-01', to: '2026-09-30' };
const plan = { operation: 'earned', period, branch: null, customerId: null, clarification: null };
const capabilities: CodexCliCapabilityProfile = {
  evidence: { kind: 'synthetic-fixture', label: 'synthetic public HTTP Codex interface fixture' },
  flags: [...CODEX_CLI_FLAGS], configKeys: CODEX_CLI_CONFIG.map(value => value.split('=')[0]),
  stdinPrompt: true, sandboxModes: ['read-only'],
};
const routeConfig = {
  id: routeId, kind: 'codex-cli', model: 'synthetic-model',
  label: 'synthetic Codex process fixture', maxCostMinor: '50', budgetMinor: '200',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}
function records(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map(record);
}
function string(value: unknown): string {
  assert.equal(typeof value, 'string');
  assert.ok(typeof value === 'string');
  return value;
}
function events(...values: Record<string, unknown>[]): string {
  return values.map(value => JSON.stringify(value)).join('\n');
}
const finalMessage = { type: 'item.completed', item: { id: 'synthetic-final-message', type: 'agent_message', text: JSON.stringify(plan) } };
const completed: ProcessResult = {
  exitCode: 0, stdout: events(
    { type: 'thread.started', thread_id: 'synthetic-thread' }, { type: 'turn.started' }, finalMessage,
    { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20 } },
  ),
};

type RpcReply = { status: number; body: Record<string, unknown> };
function success(reply: RpcReply): Record<string, unknown> {
  assert.equal(reply.status, 200, JSON.stringify(reply.body.error));
  assert.equal(reply.body.error, undefined);
  return record(reply.body.result);
}
function refused(reply: RpcReply, code: string): void {
  assert.equal(reply.status, 400);
  assert.equal(record(reply.body.error).code, code);
  assert.equal(reply.body.result, undefined);
}
function assertCliEvidence(route: Record<string, unknown>, evidence: 'synthetic-fixture' | 'unverified'): void {
  assert.equal(route.credentialConfigured, false);
  assert.equal(route.authenticationStatus, 'cli-managed-unverified');
  assert.equal(route.interfaceEvidenceKind, evidence);
  assert.equal(route.accountAccess, 'unverified');
  assert.equal(route.modelAccess, 'unverified');
  assert.equal(route.verification, 'not-live-verified');
}

async function fixture(t: TestContext, output: ProcessResult = completed, hostCapabilities = true) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-synthetic-codex-http-'));
  const invocations: ProcessRequest[] = [];
  let fallbackCalls = 0;
  const gateway: GatewayOptions = {
    process: async request => {
      invocations.push(structuredClone(request));
      assert.equal(request.command, 'codex');
      assert.equal(request.args[request.args.indexOf('--model') + 1], 'synthetic-model');
      assert.equal(request.args[request.args.indexOf('--sandbox') + 1], 'read-only');
      return structuredClone(output);
    },
    http: async request => {
      fallbackCalls++;
      return { status: 200, endpoint: request.endpoint, body: JSON.stringify({
        message: { content: JSON.stringify(plan) }, prompt_eval_count: 1, eval_count: 1,
      }) };
    },
    ...(hostCapabilities ? { codexCli: { capabilities, mode: 'synthetic-fixture' as const } } : {}),
  };
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock), gateway });
  const app = createLocalServer(engine);
  t.after(async () => {
    try { await app.close(); } finally { await rm(directory, { recursive: true, force: true }); }
  });
  const { origin, token } = await app.listen();
  const session = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(session.status, 200);
  assert.equal(record(await session.json()).token, token);
  async function rpc(method: string, payload: Record<string, unknown> = {}): Promise<RpcReply> {
    const response = await fetch(`${origin}/api/rpc`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ method, payload }),
    });
    return { status: response.status, body: record(await response.json()) };
  }
  const created = success(await rpc('workspace.create', {
    name: 'Synthetic Codex RPC business', passphrase: 'synthetic-local-fixture-passphrase', demo: true,
  }));
  // Host mode is production admission; the authored snapshot port below does
  // not establish native PostgreSQL qualification. Workspace data stays demo.
  assert.equal(created.experimental, false);
  assert.equal(record(created.workspace).demo, true);
  success(await rpc('trust.update', { send: 'shape' }));
  const configured = success(await rpc('models.configure', { config: routeConfig }));
  assertCliEvidence(configured, hostCapabilities ? 'synthetic-fixture' : 'unverified');
  success(await rpc('models.configure', { config: {
    id: 'synthetic-fallback', kind: 'ollama', model: 'synthetic-fallback-model', label: 'synthetic injected HTTP fallback fixture',
  } }));
  async function routes(): Promise<Record<string, unknown>[]> {
    const reply = await rpc('models.list'); assert.equal(reply.status, 200);
    return records(reply.body.result);
  }
  async function receipt(id: string): Promise<Record<string, unknown>> {
    const activity = success(await rpc('activity.list'));
    const found = records(activity.modelReceipts).find(value => value.id === id);
    assert.ok(found);
    return found;
  }
  async function preview() {
    const value = success(await rpc('models.preview', { question, routeId }));
    assert.equal(value.approvalRequired, true);
    assert.equal(value.receiptBoundary, 'application-to-official-cli');
    assert.equal(value.providerPayloadObserved, false);
    assert.equal(value.costReservedMinor, '0');
    return value;
  }
  async function approve(value: Record<string, unknown>) {
    return success(await rpc('models.approve', { id: string(value.id) }));
  }
  function assertNoAnswer(): void {
    assert.ok(engine.vault);
    const state = engine.vault.read();
    assert.equal(state.receipts.length, 0);
    assert.equal(state.answers.length, 0);
    assert.equal(state.conversations.length, 0);
  }
  return { rpc, routes, receipt, preview, approve, invocations, assertNoAnswer, get fallbackCalls() { return fallbackCalls; } };
}

test('synthetic Codex completed turn produces a calculated receipt through paired public HTTP RPC', async t => {
  const f = await fixture(t);
  const listed = (await f.routes()).find(value => value.id === routeId);
  assert.ok(listed); assertCliEvidence(listed, 'synthetic-fixture');
  assert.equal(listed.installationVerified, false);
  const preview = await f.preview();
  refused(await f.rpc('conversation.ask', { question, routeId, previewId: preview.id }), 'OUTBOUND_APPROVAL_REQUIRED');
  assert.equal(f.invocations.length, 0); assert.equal(f.fallbackCalls, 0); f.assertNoAnswer();
  const approval = await f.approve(preview);
  const calculation = success(await f.rpc('conversation.ask', {
    question, routeId, previewId: preview.id, approvalId: approval.id,
  }));
  assert.equal(calculation.operation, 'earned');
  assert.equal(calculation.totalMinor, '250000'); // Independent fixture: delivered sales 1000 + 1500 INR.
  assert.equal(calculation.currency, 'INR'); assert.deepEqual(calculation.period, period);
  assert.deepEqual(calculation.sourceIds, ['demo-export']);
  assert.equal(record(calculation.coverage).completeness, 'reconciled-imports');
  assert.match(string(calculation.dictionaryHash), /^[a-f0-9]{64}$/);
  assert.deepEqual(success(await f.rpc('receipts.get', { id: string(calculation.id) })), calculation);
  assert.equal(f.invocations.length, 1); assert.equal(f.fallbackCalls, 0);
  assert.equal(f.invocations[0].stdin, preview.payload);
  assert.equal(hash(f.invocations[0].stdin), preview.digest);
  const modelReceipt = await f.receipt(string(preview.id));
  assert.equal(modelReceipt.status, 'completed'); assert.equal(modelReceipt.attempts, 1);
  assert.equal(record(modelReceipt.plan).operation, 'earned');
  assert.equal(modelReceipt.receiptBoundary, 'application-to-official-cli');
  assert.equal(modelReceipt.providerPayloadObserved, false);
  assert.equal(modelReceipt.responseHash, hash(completed.stdout));
  refused(await f.rpc('conversation.ask', {
    question, routeId, previewId: preview.id, approvalId: approval.id,
  }), 'PREVIEW_NOT_FOUND');
  assert.equal(f.invocations.length, 1); assert.equal(f.fallbackCalls, 0);
});

for (const scenario of [
  { label: 'reported failed turn', code: 'MODEL_FAILED', output: { exitCode: 0, stdout: events(finalMessage, { type: 'turn.failed', error: { message: 'synthetic failure' } }) } },
  { label: 'missing turn.completed', code: 'INVALID_PLAN', output: { exitCode: 0, stdout: events(finalMessage) } },
  { label: 'unsuccessful process exit', code: 'MODEL_FAILED', output: { exitCode: 7, stdout: completed.stdout } },
]) {
  test(`synthetic Codex ${scenario.label} withholds the HTTP result without fallback or resend`, async t => {
    const f = await fixture(t, scenario.output);
    const preview = await f.preview(), approval = await f.approve(preview);
    refused(await f.rpc('conversation.ask', {
      question, routeId, previewId: preview.id, approvalId: approval.id,
    }), scenario.code);
    assert.equal(f.invocations.length, 1); assert.equal(f.fallbackCalls, 0); f.assertNoAnswer();
    const modelReceipt = await f.receipt(string(preview.id));
    assert.equal(modelReceipt.status, 'failed'); assert.equal(modelReceipt.errorCode, scenario.code);
    assert.equal(modelReceipt.attempts, 1); assert.equal(modelReceipt.costReservedMinor, '50');
    assert.equal(modelReceipt.plan, undefined);
    refused(await f.rpc('conversation.ask', {
      question, routeId, previewId: preview.id, approvalId: approval.id,
    }), 'PREVIEW_NOT_FOUND');
    assert.equal(f.invocations.length, 1); assert.equal(f.fallbackCalls, 0); f.assertNoAnswer();
    const route = (await f.routes()).find(value => value.id === routeId);
    assert.equal(route?.costConsumedMinor, '50');
  });
}

test('public route configuration cannot supply trusted Codex capability or process authority', async t => {
  const f = await fixture(t);
  for (const field of ['codexCli', 'capabilities', 'process']) {
    const extra = field === 'codexCli' ? { capabilities, mode: 'synthetic-fixture' }
      : field === 'capabilities' ? capabilities : 'synthetic-process-reference';
    refused(await f.rpc('models.configure', { config: {
      ...routeConfig, id: `synthetic-untrusted-${field}`, [field]: extra,
    } }), 'INVALID_ROUTE');
  }
  const routes = await f.routes();
  assert.equal(routes.length, 2);
  assert.ok(routes.every(value => !string(value.id).startsWith('synthetic-untrusted-')));
  assert.equal(f.invocations.length, 0); assert.equal(f.fallbackCalls, 0); f.assertNoAnswer();
});

test('a standalone HTTP Engine without host Codex capabilities refuses before approval use or budget reservation', async t => {
  const f = await fixture(t, completed, false);
  const preview = await f.preview(), approval = await f.approve(preview);
  refused(await f.rpc('conversation.ask', {
    question, routeId, previewId: preview.id, approvalId: approval.id,
  }), 'CLI_CAPABILITY_REQUIRED');
  assert.equal(f.invocations.length, 0); assert.equal(f.fallbackCalls, 0); f.assertNoAnswer();
  const modelReceipt = await f.receipt(string(preview.id));
  assert.equal(modelReceipt.status, 'preview'); assert.equal(modelReceipt.costReservedMinor, '0');
  assert.equal(modelReceipt.attempts, undefined);
  assert.equal((await f.receipt(string(approval.id))).used, false);
  const route = (await f.routes()).find(value => value.id === routeId);
  assert.ok(route); assertCliEvidence(route, 'unverified'); assert.equal(route.costConsumedMinor, '0');
});
