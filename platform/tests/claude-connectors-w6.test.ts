// W6 6F5 (D34): email through the AI tool's own Gmail connection, Claude side. claude.ai connectors load only for a
// Claude-plan login and only when the owner turns the connection on. Gmail's writes are pinned to per-action prompts on
// their server (so the auto-mode classifier never decides one), and each prompt becomes Chausar's exact approval card,
// whatever the routine-review setting. A scripted query stands in for Claude Code; nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentApprovalRequest, AgentDriverInput } from '../runtime/venture/agent-runtime/driver-types.ts';
import { createClaudeDriver, type ClaudeQueryFactory } from '../runtime/venture/agent-runtime/claude-driver.ts';
import { claudeGmailServer, claudeGmailTool } from '../runtime/venture/agent-runtime/connector-policy.ts';

class Mailbox<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiter: ((result: IteratorResult<T>) => void) | undefined;
  private ended = false;
  push(value: T) { if (this.waiter) { const done = this.waiter; this.waiter = undefined; done({ value, done: false }); } else this.values.push(value); }
  end() { this.ended = true; this.waiter?.({ value: undefined, done: true }); this.waiter = undefined; }
  [Symbol.asyncIterator]() { return { next: (): Promise<IteratorResult<T>> => this.values.length ? Promise.resolve({ value: this.values.shift()!, done: false }) : this.ended ? Promise.resolve({ value: undefined, done: true }) : new Promise(resolve => { this.waiter = resolve; }) }; }
}
const frame = (value: unknown) => value as SDKMessage;
const SERVER = 'claude.ai Gmail';
const SEND = 'mcp__claude_ai_Gmail__send_message', READ = 'mcp__claude_ai_Gmail__search_threads', TRASH = 'mcp__claude_ai_Gmail__trash_message';
const GMAIL = { name: SERVER, source: 'claudeai' };
const MAIL = { to: 'client@example.org', subject: 'Your September books', body: 'Hello, the books are attached.' };

async function fixture(connectors = true) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-claude-connectors-'));
  const output = new Mailbox<SDKMessage>(), prompts = new Mailbox<SDKUserMessage>();
  const overrides: [string, string | null][] = [];
  let options: Options | undefined;
  const factory: ClaudeQueryFactory = input => {
    options = input.options;
    void (async () => { for await (const prompt of input.prompt) prompts.push(prompt); })();
    return Object.assign({ [Symbol.asyncIterator]: async function* () { for await (const value of output) yield value; }, interrupt: async () => {}, close: () => { output.end(); } },
      { setMcpPermissionModeOverride: async (name: string, mode: string | null) => { overrides.push([name, mode]); return {}; } });
  };
  const input: AgentDriverInput = { jobId: 'sample-job', jobRoot: root, settings: { model: 'claude-sonnet-5-5', effort: 'high', autoReview: true, webSearch: false, network: false, shell: false, ...(connectors ? { connectors: true } : {}) }, mcp: { name: 'chausar', command: process.execPath, args: ['sample-mcp.ts'], env: {} }, guard: () => {}, onEvent: () => {} };
  const driver = createClaudeDriver({ executable: resolve(root, 'claude.exe'), queryFactory: factory });
  return { root, output, prompts: prompts[Symbol.asyncIterator](), driver, input, overrides, get options() { return options!; }, cleanup: () => rm(root, { recursive: true, force: true }) };
}
const settle = () => new Promise(done => setTimeout(done, 10));
const init = (out: Mailbox<SDKMessage>) => out.push(frame({ type: 'system', subtype: 'init', session_id: 'session-1', model: 'claude-sonnet-5-5', permissionMode: 'auto', mcp_servers: [{ name: 'chausar', status: 'connected' }, { name: SERVER, status: 'connected' }, { name: 'claude.ai Linear', status: 'connected' }] }));
type Hook = (input: unknown, id: string, options: { signal: AbortSignal }) => Promise<unknown>;
const decide = (hook: Hook, tool_name: string, mcp_server?: { name: string; source: string }) => hook({ hook_event_name: 'PreToolUse', tool_name, tool_input: { ...MAIL }, tool_use_id: 'tool-1', session_id: 'session-1', transcript_path: '', cwd: '', ...(mcp_server ? { mcp_server } : {}) }, 'tool-1', { signal: new AbortController().signal }) as Promise<any>;
const ask = (options: Options, name: string, args: Record<string, unknown>, mcpServer?: { name: string; source: string }) =>
  options.canUseTool!(name, args, { signal: new AbortController().signal, toolUseID: 'tool-send', requestId: 'request-send', ...(mcpServer ? { mcpServer } : {}) } as never);

test('6F5: on Claude only the Gmail draft and send tools are on, and only a claude.ai Gmail server counts', () => {
  assert.equal(claudeGmailTool(READ), null, 'reading the mailbox stays off'); assert.equal(claudeGmailTool(SEND), 'ask'); assert.equal(claudeGmailTool('mcp__claude_ai_Gmail__reply'), 'ask');
  assert.equal(claudeGmailTool(TRASH), null); assert.equal(claudeGmailTool('send_message'), null);
  assert.equal(claudeGmailServer(GMAIL), true); assert.equal(claudeGmailServer({ name: SERVER, source: 'user' }), false); assert.equal(claudeGmailServer({ name: 'claude.ai Linear', source: 'claudeai' }), false);
});

test('6F5: connectors load only when the owner turned them on with a Claude plan login', async () => {
  for (const [connectors, key, loaded] of [[false, false, false], [true, true, false], [true, false, true]] as const) {
    const f = await fixture(connectors);
    if (key) f.input.credentials = { apiKey: ['synthetic', 'credential'].join('-') };
    const session = await f.driver.open(f.input);
    try {
      void session.run('Sample.'); await f.prompts.next();
      assert.equal(f.options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, loaded ? 'true' : 'false', `${connectors} ${key}`);
      assert.equal((f.options.settings as any).disableClaudeAiConnectors, !loaded);
      assert.equal(String(f.options.systemPrompt).includes('Gmail'), loaded);
      // Claude Code's strict MCP mode also drops claude.ai connectors (checked live on 1 November), so it is relaxed only
      // when they load; project settings alone, no plugins and the empty job folder keep any other server out.
      assert.equal(f.options.strictMcpConfig, !loaded);
      assert.deepEqual(f.options.settingSources, ['project']); assert.deepEqual(f.options.plugins, []);
    } finally { await session.close(); await f.cleanup(); }
  }
});

test('6F5: Gmail writes are pinned to per-action prompts on their server; until then a write is refused outright', async () => {
  const f = await fixture(), session = await f.driver.open(f.input);
  try {
    void session.run('Send the handoff.'); await f.prompts.next();
    const hook = f.options.hooks!.PreToolUse![0]!.hooks[0]! as Hook;
    assert.equal((await decide(hook, SEND, GMAIL)).hookSpecificOutput?.permissionDecision, 'deny', 'not pinned yet');
    init(f.output); await settle();
    assert.deepEqual(f.overrides, [[SERVER, 'default']], 'only the Gmail server is pinned');
    assert.equal((await decide(hook, SEND, GMAIL)).hookSpecificOutput?.permissionDecision, 'ask');
    for (const [tool, server] of [[READ, GMAIL], [TRASH, GMAIL], [SEND, { name: SERVER, source: 'user' }], [SEND, undefined], ['mcp__claude_ai_Linear__create_issue', { name: 'claude.ai Linear', source: 'claudeai' }]] as const) {
      assert.equal((await decide(hook, tool, server)).hookSpecificOutput?.permissionDecision, 'deny', `${tool} ${server?.source}`);
    }
  } finally { await session.close(); await f.cleanup(); }
});

test('6F5: a Gmail send becomes the exact approval card even with routine review on; a read is refused', async () => {
  const f = await fixture(), asked: AgentApprovalRequest[] = []; let answer = true;
  f.input.requestApproval = async request => { asked.push(request); return answer; };
  const session = await f.driver.open(f.input);
  try {
    void session.run('Send the handoff.'); await f.prompts.next(); init(f.output); await settle();
    const allowed = await ask(f.options, SEND, { ...MAIL }, GMAIL);
    assert.deepEqual(allowed, { behavior: 'allow', updatedInput: MAIL });
    assert.equal(asked.length, 1);
    assert.equal(asked[0]!.kind, 'connector-send'); assert.equal(asked[0]!.itemId, 'tool-send'); assert.equal(asked[0]!.requestId, 'request-send');
    assert.equal(asked[0]!.name, 'Gmail: send_message'); assert.deepEqual(asked[0]!.arguments, MAIL);
    assert.match(asked[0]!.description!, /Approving sends exactly this, once/);
    answer = false;
    assert.equal((await ask(f.options, SEND, { ...MAIL }, GMAIL))?.behavior, 'deny');
    assert.equal((await ask(f.options, READ, { query: 'synthetic' }, GMAIL))?.behavior, 'deny');
    assert.equal(asked.length, 2, 'a read never asks: it is refused');
    assert.equal((await ask(f.options, TRASH, { id: '1' }, GMAIL))?.behavior, 'deny');
    assert.equal((await ask(f.options, SEND, { ...MAIL }, { name: SERVER, source: 'user' }))?.behavior, 'deny');
    assert.equal(asked.length, 2);
  } finally { await session.close(); await f.cleanup(); }
});

test('6F5: with connectors off, claude.ai tools are refused and nothing asks the owner', async () => {
  const f = await fixture(false), asked: AgentApprovalRequest[] = [];
  f.input.requestApproval = async request => { asked.push(request); return true; };
  const session = await f.driver.open(f.input);
  try {
    void session.run('Sample.'); await f.prompts.next(); init(f.output); await settle();
    assert.deepEqual(f.overrides, []);
    const hook = f.options.hooks!.PreToolUse![0]!.hooks[0]! as Hook;
    assert.equal((await decide(hook, SEND, GMAIL)).hookSpecificOutput?.permissionDecision, 'deny');
    assert.equal((await decide(hook, READ, GMAIL)).hookSpecificOutput?.permissionDecision, 'deny');
    assert.equal((await ask(f.options, SEND, { ...MAIL }, GMAIL))?.behavior, 'deny');
    assert.equal(asked.length, 0);
  } finally { await session.close(); await f.cleanup(); }
});
