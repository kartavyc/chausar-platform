// A2: "Signed in" is earned by one tiny test call. It sends only a fixed sample sentence, runs Codex only through its
// reviewed arguments and trusted program, and says a failure in owner words; what the tool printed is kept screened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import { readFileSync } from 'node:fs';
import { tinyTestCall, TEST_PROMPT, TEST_WORDS } from '../runtime/venture/models/cli-test.ts';
import { buildCodexCliArguments, CODEX_CLI_CONFIG, CODEX_CLI_FLAGS, type CodexCliCapabilityProfile } from '../runtime/providers/codex-cli.ts';

const PROGRAM = process.platform === 'win32' ? win32.join('C:/', 'Tools', 'codex', 'codex.exe') : '/opt/codex/bin/codex';
const profile: CodexCliCapabilityProfile = {
  evidence: { kind: 'installed-help', executable: PROGRAM, version: '0.166.0', helpDigest: 'a'.repeat(64) },
  flags: [...CODEX_CLI_FLAGS], configKeys: CODEX_CLI_CONFIG.map(value => value.split('=')[0]!), stdinPrompt: true, sandboxModes: ['read-only'],
};
const codex = { capabilities: profile, mode: 'local-cli' };
const jsonl = (...events: unknown[]) => events.map(event => JSON.stringify(event)).join('\n');
const answered = (value: unknown) => jsonl({ type: 'thread.started', thread_id: 't' }, { type: 'turn.started' }, { type: 'item.completed', item: { id: 'i', type: 'agent_message', text: JSON.stringify(value) } }, { type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 2 } });

test('a Codex test call sends only the fixed sample through the reviewed arguments, and passes on ok true', async () => {
  const seen: any[] = [];
  const result = await tinyTestCall({ cli: 'codex', codex, model: 'gpt-6-luna', process: async request => { seen.push(structuredClone(request)); return { exitCode: 0, stdout: answered({ ok: true }) } as never; } });
  assert.deepEqual(result, { ok: true });
  assert.equal(seen.length, 1, 'one call, never retried');
  const [request] = seen;
  assert.equal(request.command, PROGRAM);
  const schemaPath = request.args[request.args.indexOf('--output-schema') + 1];
  assert.deepEqual(request.args, buildCodexCliArguments('gpt-6-luna', schemaPath, profile));
  assert.equal(request.stdin, `${TEST_PROMPT}\n{}`);
  assert.ok(Object.keys(request.env).every(name => /^(PATH|Path|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|CODEX_HOME|[A-Z_]*TELEMETRY[A-Z_]*|[A-Z_]+)$/.test(name)));
  assert.equal('OPENAI_API_KEY' in request.env, false);
});

test('a failed test call says why in owner words and keeps what Codex said, screened', async () => {
  const usage = await tinyTestCall({ cli: 'codex', codex, model: 'gpt-6-luna', process: async () => ({ exitCode: 1, stdout: jsonl({ type: 'turn.failed', error: { message: "You've hit your usage limit." } }), stderr: 'ERROR: usage limit' }) as never });
  assert.deepEqual(usage, { ok: false, code: 'AI_USAGE_LIMIT', line: 'Codex has used up your plan for now. Wait for it to reset, or choose another AI under Connections, Your AI.', said: 'ERROR: usage limit' });
  const wrong = await tinyTestCall({ cli: 'codex', codex, model: 'gpt-6-luna', process: async () => ({ exitCode: 0, stdout: answered({ ok: false }) }) as never });
  assert.deepEqual(wrong, { ok: false, code: 'MODEL_OUTPUT_REJECTED', line: TEST_WORDS.wrong('Codex') });
  assert.deepEqual(await tinyTestCall({ cli: 'codex', codex: null, model: 'gpt-6-luna', process: async () => { throw new Error('never runs'); } }), { ok: false, code: 'PRESET_UNAVAILABLE', line: TEST_WORDS.noSetup });
});

test('a Claude Code test call uses its text-only arguments and the small model', async () => {
  const seen: any[] = [];
  const result = await tinyTestCall({ cli: 'claude-code', claudeProgram: '/usr/local/bin/claude', model: 'claude-haiku-5-5', process: async request => { seen.push(request); return { exitCode: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { ok: true } }) } as never; } });
  assert.deepEqual(result, { ok: true });
  assert.equal(seen[0].command, '/usr/local/bin/claude');
  assert.equal(seen[0].args[seen[0].args.indexOf('--model') + 1], 'claude-haiku-5-5');
  assert.equal(seen[0].stdin, '{}');
  void readFileSync;
});
