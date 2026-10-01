import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { ChausarError, hash } from '../runtime/contracts.ts';
import { planSchema, validatePlan } from '../runtime/gateway.ts';
import type { ProcessRequest } from '../runtime/gateway.ts';
import { buildCodexCliArguments, CODEX_CLI_CONFIG, CODEX_CLI_FLAGS, CODEX_CLI_LIMITS,
  codexCliBoundary, createCodexCliProcessAdapter, parseCodexCliOutput } from '../runtime/providers/codex-cli.ts';
import type { CodexCliCapabilityProfile } from '../runtime/providers/codex-cli.ts';

// Every capability, model, event and process in this suite is a synthetic fixture.
const syntheticProfile: CodexCliCapabilityProfile = {
  evidence: { kind: 'synthetic-fixture', label: 'synthetic Codex protocol fixture' },
  flags: [...CODEX_CLI_FLAGS], configKeys: CODEX_CLI_CONFIG.map(value => value.split('=')[0]),
  stdinPrompt: true, sandboxModes: ['read-only'],
};
const syntheticPlan = { operation: 'earned', period: null, branch: null, customerId: null, clarification: null };
function syntheticEvents(...events: unknown[]): string { return events.map(event => JSON.stringify(event)).join('\n') + '\n'; }
function final(text = JSON.stringify(syntheticPlan)) { return { type: 'item.completed', item: { id: 'synthetic-final', type: 'agent_message', text } }; }
const completed = { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5, reasoning_output_tokens: 1 } };
function successful() { return syntheticEvents({ type: 'thread.started', thread_id: 'synthetic-thread' }, { type: 'turn.started' }, final(), completed); }
function refuses(code: string) { return (error: unknown) => error instanceof ChausarError && error.code === code; }
function syntheticRequest(): ProcessRequest {
  const cwd = resolve('synthetic-codex-isolated');
  return { command: 'codex', args: buildCodexCliArguments('synthetic-model', join(cwd, 'plan-schema.json'), syntheticProfile),
    cwd, env: { PATH: 'synthetic-native-path', CODEX_HOME: resolve('synthetic-cli-managed-home') },
    stdin: 'Return one synthetic analytical plan.\n{"question":"revenue"}', timeoutMs: 120000, schema: planSchema(['earned']) };
}

test('synthetic completed turn preserves one plan and measured usage', () => {
  const output = parseCodexCliOutput(successful());
  assert.deepEqual(output.value, syntheticPlan); assert.deepEqual(output.usage, completed.usage);
  assert.equal(output.completed, true); assert.deepEqual(validatePlan(output.value, ['earned']), { operation: 'earned' });
});
test('synthetic completion without usage does not fabricate measurements', () => {
  const output = parseCodexCliOutput(syntheticEvents(final(), { type: 'turn.completed' }));
  assert.equal(output.usage, undefined);
});
test('synthetic CRLF reasoning events preserve the final JSON contract', () => {
  const output = parseCodexCliOutput(syntheticEvents({ type: 'item.updated', item: { id: 'synthetic-reasoning', type: 'reasoning', text: 'Choose an operation' } }, final(), completed).replaceAll('\n', '\r\n'));
  assert.deepEqual(output.value, syntheticPlan);
});
for (const [name, events] of [
  ['missing completion', [final()]], ['missing final message', [completed]],
  ['duplicate final message', [final(), final(), completed]], ['duplicate completion', [final(), completed, completed]],
  ['duplicate turn', [{ type: 'turn.started' }, { type: 'turn.started' }, final(), completed]],
  ['late output', [final(), completed, { type: 'turn.started' }]],
  ['unknown event', [{ type: 'synthetic.unknown' }, final(), completed]],
  ['unknown item', [{ type: 'item.completed', item: { type: 'synthetic_unknown' } }, final(), completed]],
  ['invalid event shape', [null]], ['invalid item shape', [{ type: 'item.completed', item: null }]],
  ['invalid item text', [{ type: 'item.updated', item: { type: 'reasoning', text: {} } }]],
] as const) test(`synthetic ${name} is refused`, () => assert.throws(() => parseCodexCliOutput(syntheticEvents(...events)), refuses('INVALID_PLAN')));
for (const type of ['turn.failed', 'error']) test(`synthetic ${type} after a final message is refused`, () => {
  assert.throws(() => parseCodexCliOutput(syntheticEvents(final(), completed, { type, error: { message: 'synthetic failure' } })), refuses('MODEL_FAILED'));
});
for (const itemType of ['command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'tool_call']) test(`synthetic ${itemType} attempt is refused before plan release`, () => {
  assert.throws(() => parseCodexCliOutput(syntheticEvents({ type: 'item.started', item: { type: itemType } }, final(), completed)), refuses('MODEL_TOOL_ATTEMPT'));
});
test('synthetic malformed JSON and scalar final values are refused', () => {
  for (const body of ['{broken\n', syntheticEvents(final('{broken'), completed), syntheticEvents(final('[]'), completed), syntheticEvents(final('null'), completed)]) assert.throws(() => parseCodexCliOutput(body), refuses('INVALID_PLAN'));
});
test('synthetic output bounds count UTF-8 bytes, events and plan size', () => {
  for (const body of ['é'.repeat(CODEX_CLI_LIMITS.stdoutBytes / 2 + 1), syntheticEvents(...Array.from({ length: CODEX_CLI_LIMITS.events + 1 }, () => ({ type: 'turn.started' }))), syntheticEvents({ type: 'item.updated', item: { type: 'reasoning', text: 'x'.repeat(CODEX_CLI_LIMITS.eventBytes) } }), syntheticEvents(final('x'.repeat(CODEX_CLI_LIMITS.planBytes + 1)), completed)]) assert.throws(() => parseCodexCliOutput(body), refuses('RESPONSE_TOO_LARGE'));
});
test('synthetic unsafe usage never becomes a billing measurement', () => {
  for (const usage of [null, { input_tokens: '10', output_tokens: 5 }, { input_tokens: -1, output_tokens: 5 }, { input_tokens: 10, output_tokens: Number.MAX_SAFE_INTEGER + 1 }, { input_tokens: 10, output_tokens: 5, cached_input_tokens: -1 }]) assert.throws(() => parseCodexCliOutput(syntheticEvents(final(), { type: 'turn.completed', usage })), refuses('INVALID_PLAN'));
});
test('synthetic model output still goes through the existing analytical validator', () => {
  for (const plan of [{ operation: 'earned', amountMinor: '100' }, { operation: 'DROP TABLE facts' }, { operation: 'earned', sql: 'select 1' }]) {
    const output = parseCodexCliOutput(syntheticEvents(final(JSON.stringify(plan)), completed));
    assert.throws(() => validatePlan(output.value, ['earned']), refuses('INVALID_PLAN'));
  }
});
test('synthetic arguments retain exact schema path, explicit model and CLI-owned ChatGPT auth', () => {
  const schemaPath = join(resolve('synthetic directory with spaces'), 'schema.json');
  const args = buildCodexCliArguments('synthetic-model', schemaPath, syntheticProfile);
  assert.equal(args[args.indexOf('--output-schema') + 1], schemaPath); assert.equal(args[args.indexOf('--model') + 1], 'synthetic-model');
  assert.equal(args.at(-1), '-'); assert.ok(args.includes('forced_login_method="chatgpt"')); assert.ok(args.includes('model_provider="openai"'));
  assert.ok(args.includes('features.shell_tool=false'));
  for (const name of ['view_image', 'image_generation', 'sleep_tool', 'tool_suggest', 'request_permissions_tool']) assert.ok(args.includes(`features.${name}=false`));
  assert.ok(args.includes('project_doc_max_bytes=0')); assert.ok(args.includes('history.persistence="none"'));
  assert.equal(args.includes('tools.view_image=false'), false, 'The native0.159.2 receipt proves the legacy key is ignored.');
  assert.equal(args.includes('features.unified_exec=false'), false, 'A forced shell implementation is not the shell admission switch.');
  assert.equal(args.includes('--ignore-rules'), false, 'Preserve the installed CLI execution rules.');
  assert.equal(args.some(value => value.includes('model_providers.openai') || value === '--oss' || value === '--yolo'), false);
});
test('synthetic missing flags, configuration keys, stdin or read-only support refuse argument construction', () => {
  for (const profile of [{ ...syntheticProfile, flags: CODEX_CLI_FLAGS.filter(flag => flag !== '--output-schema') }, { ...syntheticProfile, configKeys: [] }, { ...syntheticProfile, stdinPrompt: false }, { ...syntheticProfile, sandboxModes: ['workspace-write'] }]) assert.throws(() => buildCodexCliArguments('synthetic-model', resolve('schema.json'), profile), refuses('CLI_CAPABILITY_UNSUPPORTED'));
  assert.throws(() => buildCodexCliArguments('synthetic-model', resolve('schema.json'), { ...syntheticProfile, evidence: { kind: 'synthetic-fixture', label: '' } }), refuses('CLI_CAPABILITY_REQUIRED'));
});
test('synthetic fixtures and official documentation cannot qualify a live native process', () => {
  const process = async () => ({ exitCode: 0, stdout: successful() });
  for (const profile of [syntheticProfile, { ...syntheticProfile, evidence: { kind: 'official-docs' as const, checkedAt: '2026-10-01' } }]) assert.throws(() => createCodexCliProcessAdapter({ capabilities: profile, process, mode: 'local-cli' }), refuses('CLI_CAPABILITY_REQUIRED'));
});
test('synthetic single dispatch preserves exact stdin/schema and application receipt boundary', async () => {
  const request = syntheticRequest(); let calls = 0; let observed: ProcessRequest | undefined;
  const process = createCodexCliProcessAdapter({ capabilities: syntheticProfile, mode: 'synthetic-fixture', process: async sent => { calls++; observed = sent; return { exitCode: 0, stdout: successful() }; } });
  await process(request); assert.equal(calls, 1); assert.deepEqual(observed, request); assert.notEqual(observed, request);
  assert.equal(observed?.env.OPENAI_API_KEY, undefined);
  assert.deepEqual(codexCliBoundary(request), { receiptBoundary: 'application-to-official-cli', providerPayloadObserved: false, stdinDigest: hash(request.stdin), declaredSchemaDigest: hash(JSON.stringify(request.schema)) });
});
test('synthetic failed process makes one attempt with no alternate route or paid fallback', async () => {
  let calls = 0;
  const process = createCodexCliProcessAdapter({ capabilities: syntheticProfile, mode: 'synthetic-fixture', process: async () => { calls++; return { exitCode: 1, stdout: successful() }; } });
  await assert.rejects(process(syntheticRequest()), refuses('MODEL_FAILED')); assert.equal(calls, 1);
});
test('synthetic transport rejection and incomplete success each make one process attempt', async () => {
  for (const behavior of ['reject', 'incomplete']) {
    let calls = 0; const unavailable = new ChausarError('CLI_UNAVAILABLE', 'synthetic unavailable');
    const process = createCodexCliProcessAdapter({ capabilities: syntheticProfile, mode: 'synthetic-fixture', process: async () => { calls++; if (behavior === 'reject') throw unavailable; return { exitCode: 0, stdout: syntheticEvents(final()) }; } });
    await assert.rejects(process(syntheticRequest()), refuses(behavior === 'reject' ? 'CLI_UNAVAILABLE' : 'INVALID_PLAN')); assert.equal(calls, 1);
  }
});
test('synthetic extra flags, shell wrappers and API-key environment fail before invocation', async () => {
  const mutations: ((request: ProcessRequest) => void)[] = [
    request => request.args.push('--yolo'), request => { request.command = 'codex.cmd'; },
    request => { request.env.OPENAI_API_KEY = 'synthetic-api-key'; },
    request => { request.stdin = 'é'.repeat(CODEX_CLI_LIMITS.stdinBytes / 2 + 1); },
    request => { request.timeoutMs = CODEX_CLI_LIMITS.timeoutMs + 1; },
  ];
  for (const mutate of mutations) {
    let calls = 0; const request = syntheticRequest(); mutate(request);
    const process = createCodexCliProcessAdapter({ capabilities: syntheticProfile, mode: 'synthetic-fixture', process: async () => { calls++; return { exitCode: 0, stdout: successful() }; } });
    await assert.rejects(process(request)); assert.equal(calls, 0);
  }
});
test('synthetic unserializable and oversized declared schemas refuse dispatch', async () => {
  const circular: Record<string, unknown> = {}; circular.self = circular;
  for (const schema of [null, circular, { description: 'x'.repeat(CODEX_CLI_LIMITS.schemaBytes) }]) {
    let calls = 0; const request = syntheticRequest(); request.schema = schema;
    const process = createCodexCliProcessAdapter({ capabilities: syntheticProfile, mode: 'synthetic-fixture', process: async () => { calls++; return { exitCode: 0, stdout: successful() }; } });
    await assert.rejects(process(request), refuses('INVALID_SCHEMA')); assert.equal(calls, 0);
  }
});
