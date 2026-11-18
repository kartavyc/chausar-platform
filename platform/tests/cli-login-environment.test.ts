// Found live on 11 Nov 2026 with Claude Code 2.1.321 on macOS: started with only the names Chausar passed on, it
// answered "Not logged in" although the owner was signed in, because it finds its sign-in in the keychain by the
// account name in USER (and LOGNAME). With those two names passed on, the same command answered. Every place that
// builds a tool's environment passes them, and the Codex process gate accepts them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { cliEnv } from '../runtime/venture/models/cli.ts';
import { delegateEnv } from '../runtime/venture/delivery/harness/delegate.ts';
import { CLI_BASE_ENV_NAMES, CODEX_CLI_CONFIG, CODEX_CLI_FLAGS, buildCodexCliArguments, createCodexCliProcessAdapter, type CodexCliCapabilityProfile } from '../runtime/providers/codex-cli.ts';
import { createClaudeDriver, type ClaudeQueryFactory } from '../runtime/venture/agent-runtime/claude-driver.ts';
import type { AgentDriverInput } from '../runtime/venture/agent-runtime/driver-types.ts';

const ACCOUNT = { USER: 'synthetic-owner', LOGNAME: 'synthetic-owner' };
/** Names that must never be passed on, set beside the account names to show the list did not simply open up. */
const NEVER = { ANTHROPIC_API_KEY: ['synthetic', 'value'].join('-'), OPENAI_API_KEY: ['synthetic', 'value'].join('-'), CHAUSAR_VAULT: '/synthetic/vault', SSH_AUTH_SOCK: '/synthetic/agent.sock' };

async function withProcessEnv<T>(values: Record<string, string>, run: () => T | Promise<T>): Promise<T> {
  const saved = new Map(Object.keys(values).map(name => [name, process.env[name]] as const));
  Object.assign(process.env, values);
  try { return await run(); } finally {
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}

test('the shared list names the account, and nothing that carries a credential', () => {
  for (const name of ['USER', 'LOGNAME', 'HOME', 'PATH']) assert.ok(CLI_BASE_ENV_NAMES.includes(name), name);
  for (const name of CLI_BASE_ENV_NAMES) assert.doesNotMatch(name, /KEY|TOKEN|SECRET|PASSWORD|AUTH|CHAUSAR/i, name);
});

test('text-only calls to Claude Code and Codex are started with the account name', async () => {
  await withProcessEnv({ ...ACCOUNT, ...NEVER }, () => {
    for (const kind of ['claude-cli', 'codex-cli'] as const) {
      const env = cliEnv(kind, 1024);
      assert.deepEqual([env.USER, env.LOGNAME], ['synthetic-owner', 'synthetic-owner'], kind);
      for (const name of Object.keys(NEVER)) assert.equal(name in env, false, `${kind} ${name}`);
    }
  });
});

test('a delegated coding run is started with the account name', () => {
  for (const cli of ['claude-code', 'codex'] as const) {
    const env = delegateEnv(cli, '/work/tmp', { PATH: '/bin', HOME: '/home/o', ...ACCOUNT, ...NEVER });
    assert.deepEqual([env.USER, env.LOGNAME], ['synthetic-owner', 'synthetic-owner'], cli);
    for (const name of Object.keys(NEVER)) assert.equal(name in env, false, `${cli} ${name}`);
  }
});

test('the Codex process gate accepts the account names and still refuses any other name', async () => {
  const profile: CodexCliCapabilityProfile = {
    evidence: { kind: 'synthetic-fixture', label: 'synthetic environment check' },
    flags: [...CODEX_CLI_FLAGS], configKeys: CODEX_CLI_CONFIG.map(value => value.split('=')[0]!), stdinPrompt: true, sandboxModes: ['read-only'],
  };
  const stdout = [{ type: 'thread.started', thread_id: 't' }, { type: 'turn.started' }, { type: 'item.completed', item: { id: 'i', type: 'agent_message', text: '{"answer":"ok"}' } }, { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }].map(row => JSON.stringify(row)).join('\n');
  let calls = 0;
  const adapter = createCodexCliProcessAdapter({ capabilities: profile, mode: 'synthetic-fixture', process: async () => { calls += 1; return { exitCode: 0, stdout, stderr: '' }; } });
  const args = buildCodexCliArguments('explicit-model', join(tmpdir(), `chausar-synthetic-schema-${process.pid}`, 'schema.json'), profile);
  const request = { command: 'codex', args, cwd: tmpdir(), stdin: 'Synthetic.', timeoutMs: 1000, schema: { type: 'object' } };
  await adapter({ ...request, env: { PATH: '/bin', HOME: '/home/o', ...ACCOUNT } });
  assert.equal(calls, 1);
  await assert.rejects(adapter({ ...request, env: { PATH: '/bin', ...ACCOUNT, OPENAI_API_KEY: NEVER.OPENAI_API_KEY } }), { code: 'INVALID_CREDENTIAL' });
  assert.equal(calls, 1, 'the refused call never started');
});

test('a Claude Code job is started with the account name', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-claude-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let options: Options | undefined;
  const factory: ClaudeQueryFactory = input => {
    options = input.options;
    // One finished turn: the driver asks for the tool only when a turn starts, with the environment it built at open.
    return { [Symbol.asyncIterator]: async function* (): AsyncGenerator<SDKMessage> { yield { type: 'result', subtype: 'success', is_error: false, result: 'Done.', usage: { input_tokens: 1, output_tokens: 1 } } as unknown as SDKMessage; }, interrupt: async () => {}, close: () => {} };
  };
  const input: AgentDriverInput = { jobId: 'sample-job', jobRoot: root, settings: { model: 'claude-sonnet-5-5', effort: 'high', autoReview: true, webSearch: false, network: false, shell: false }, mcp: { name: 'chausar', command: process.execPath, args: ['sample-mcp.ts'], env: {} }, guard: () => {}, onEvent: () => {} };
  await withProcessEnv({ ...ACCOUNT, ...NEVER }, async () => {
    const session = await createClaudeDriver({ executable: resolve(root, 'claude.exe'), queryFactory: factory }).open(input);
    try { await session.run('Synthetic turn.'); } finally { await session.close(); }
  });
  assert.deepEqual([options?.env?.USER, options?.env?.LOGNAME], ['synthetic-owner', 'synthetic-owner']);
  for (const name of Object.keys(NEVER)) assert.equal(name in (options?.env ?? {}), false, name);
});
