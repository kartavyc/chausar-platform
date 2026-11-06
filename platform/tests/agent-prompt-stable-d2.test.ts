// D2 task 17: a native agent job's fixed prefix (the tool's system prompt, the first-turn text before any resume data,
// and the Chausar tool list) is byte-identical for two jobs on different clients and orders, so the AI tool's prompt
// cache can reuse it. Written first as a lock; it was green at once.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';
import { ChausarError } from '../runtime/contracts.ts';
import type { AgentDriverInput } from '../runtime/venture/agent-runtime/driver-types.ts';
import { createClaudeDriver, type ClaudeQueryFactory } from '../runtime/venture/agent-runtime/claude-driver.ts';
import { jobPrompt } from '../runtime/venture/agent-runtime/runner.ts';
import { JobCapability } from '../runtime/venture/agent-runtime/scope.ts';
import { createJobMCP, type JobToolPorts } from '../runtime/venture/agent-runtime/job-tools.ts';
import { kitBusiness, installKitFixture, owner } from './fixtures/venture/kit-business.ts';
import { shape } from './prompt-weight/static.ts';
import { WRAPPERS } from './prompt-weight/tasks.ts';

const JOBS = [
  { jobId: 'job_7f3a9c21', runId: 'run_7f3a9c21', orderId: 'order_7f3a9c21', clientId: 'client_ravi' },
  { jobId: 'job_c41b8e09', runId: 'run_c41b8e09', orderId: 'order_c41b8e09', clientId: 'client_meera' },
];
const settings = { model: 'claude-sonnet-5-5', effort: 'high', autoReview: true, webSearch: false, network: false, shell: false, fallbackModel: 'claude-haiku-5-5' } as AgentDriverInput['settings'];

async function claudeOptions(t: TestContext, job: typeof JOBS[number]): Promise<Options> {
  const root = await mkdtemp(join(tmpdir(), 'chausar-agent-prefix-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let options: Options | undefined;
  const factory: ClaudeQueryFactory = input => {
    options = input.options;
    return { [Symbol.asyncIterator]: async function* () { /* no answer: only the options are read */ }, interrupt: async () => {}, close: () => {} } as never;
  };
  const driver = createClaudeDriver({ executable: resolve(root, 'claude.exe'), queryFactory: factory });
  const session = await driver.open({ jobId: job.jobId, jobRoot: root, settings, mcp: { name: 'chausar', command: process.execPath, args: ['sample-mcp.ts'], env: {} },
    guard: () => {}, onEvent: () => {} } as AgentDriverInput);
  // The driver starts the tool on the first turn; the answer is never awaited, only the options it was given.
  const running = session.run(`Work on ${job.orderId}`).catch(() => undefined);
  for (let wait = 0; !options && wait < 50; wait++) await new Promise(done => setTimeout(done, 10));
  await session.close();
  await running;
  return options!;
}

test('the Claude driver gives two jobs the same system prompt and the same tools, in the same order', async t => {
  const [first, second] = [await claudeOptions(t, JOBS[0]), await claudeOptions(t, JOBS[1])];
  assert.equal(typeof first.systemPrompt, 'string');
  assert.equal(first.systemPrompt, second.systemPrompt);
  assert.deepEqual(first.tools, second.tools);
  assert.deepEqual(first.disallowedTools, second.disallowedTools);
  assert.deepEqual(Object.keys(first.mcpServers ?? {}), Object.keys(second.mcpServers ?? {}));
  for (const job of JOBS) assert.doesNotMatch(String(first.systemPrompt), new RegExp(job.jobId));
});

test('the Claude system prompt and the Codex developer instructions are fixed text in the source (a connectors line is a flag)', async () => {
  for (const [file, property] of [['claude-driver.ts', 'systemPrompt'], ['codex-driver.ts', 'developerInstructions']] as const) {
    const path = new URL(`../runtime/venture/agent-runtime/${file}`, import.meta.url);
    const source = ts.createSourceFile(file, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const found: ts.Expression[] = [];
    const visit = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getText() === property) found.push(node.initializer); ts.forEachChild(node, visit); };
    visit(source);
    assert.equal(found.length, 1, file);
    assert.equal(shape(source, found[0], WRAPPERS).fixed, true, `${file} ${property}: ${found[0].getText().slice(0, 120)}`);
  }
});

test('the first turn is the fixed job prompt, and resume data only ever comes after it', async () => {
  assert.equal(jobPrompt(settings), jobPrompt({ ...settings }));
  const runner = await readFile(new URL('../runtime/venture/agent-runtime/runner.ts', import.meta.url), 'utf8');
  assert.match(runner, /let prompt = jobPrompt\(route\.settings, route\.credentials\);/);
  const assignments = [...runner.matchAll(/\bprompt\s*(\+?=)\s*(.{0,40})/g)].map(match => `${match[1]} ${match[2]}`);
  assert.ok(assignments.every(text => !/^= /.test(text) || /^= jobPrompt\(/.test(text)), `the prompt is only appended to: ${assignments.join(' | ')}`);
  assert.match(runner, /prompt \+= '\\nContinue from this saved work/);
});

test('two jobs on different clients and orders see the same Chausar tool list, in the same order', async t => {
  const undo = installKitFixture(); t.after(undo);
  const env = await kitBusiness();
  const lists: unknown[] = [];
  for (const job of JOBS) {
    const scope = { ...job, ventureId: 'venture_sample', agentId: 'agent_sample', memberId: 'owner', epoch: 1, consentId: 'consent_sample', consentRevision: 1, generation: 1 };
    const capability = new JobCapability(scope as never, owner, () => { if (!scope) throw new ChausarError('CLIENT_AI_CONSENT_REQUIRED', 'Consent is required.'); });
    const ports = { calculations: [{ name: 'order_price', description: 'The stored order price.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } }] } as unknown as JobToolPorts;
    const mcp = createJobMCP(env.store, capability, ports);
    await mcp.handle(owner, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'prefix-check', version: '1' } } });
    await mcp.handle(owner, { jsonrpc: '2.0', method: 'notifications/initialized' });
    const listed = await mcp.handle(owner, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) as { result: { tools: { name: string }[] } };
    lists.push(listed.result.tools);
  }
  assert.ok((lists[0] as unknown[]).length > 5);
  assert.equal(JSON.stringify(lists[0]), JSON.stringify(lists[1]));
});
