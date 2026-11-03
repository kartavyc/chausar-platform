import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDriverEvent, AgentDriverInput } from '../runtime/venture/agent-runtime/driver-types.ts';
import { createClaudeDriver, type ClaudeQueryFactory } from '../runtime/venture/agent-runtime/claude-driver.ts';

class Mailbox<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiter: ((result: IteratorResult<T>) => void) | undefined;
  private ended = false;
  push(value: T) { if (this.waiter) { const done = this.waiter; this.waiter = undefined; done({ value, done: false }); } else this.values.push(value); }
  end() { this.ended = true; this.waiter?.({ value: undefined, done: true }); this.waiter = undefined; }
  [Symbol.asyncIterator]() { return { next: (): Promise<IteratorResult<T>> => this.values.length ? Promise.resolve({ value: this.values.shift()!, done: false }) : this.ended ? Promise.resolve({ value: undefined, done: true }) : new Promise(resolve => { this.waiter = resolve; }) }; }
}
const frame = (value: unknown) => value as SDKMessage;
async function fixture(teardown?: Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-claude-driver-'));
  const output = new Mailbox<SDKMessage>(), prompts = new Mailbox<SDKUserMessage>(), events: AgentDriverEvent[] = [];
  let options: Options | undefined, opens = 0, interrupts = 0, closed = 0;
  const factory: ClaudeQueryFactory = input => {
    options = input.options; opens++;
    void (async () => { for await (const prompt of input.prompt) prompts.push(prompt); })();
    return { [Symbol.asyncIterator]: async function* () { try { for await (const value of output) yield value; } finally { await teardown; } }, interrupt: async () => { interrupts++; output.push(frame({ type: 'result', subtype: 'error_during_execution', is_error: true })); }, close: () => { closed++; output.end(); } };
  };
  const input: AgentDriverInput = { jobId: 'sample-job', jobRoot: root, settings: { model: 'claude-sonnet-5-5', effort: 'high', autoReview: true, webSearch: false, network: false, shell: false, fallbackModel: 'claude-haiku-5-5' }, mcp: { name: 'chausar', command: process.execPath, args: ['sample-mcp.ts'], env: {} }, guard: () => {}, onEvent: event => events.push(event) };
  const driver = createClaudeDriver({ executable: resolve(root, 'claude.exe'), queryFactory: factory });
  return { root, output, prompts: prompts[Symbol.asyncIterator](), events, driver, input, get options() { return options!; }, counts: () => ({ opens, interrupts, closed }), cleanup: () => rm(root, { recursive: true, force: true }) };
}
const finish = (out: Mailbox<SDKMessage>, result = 'Done.') => out.push(frame({ type: 'result', subtype: 'success', is_error: false, result, usage: { input_tokens: 12, output_tokens: 4, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } }));

test('Claude emits authoritative cumulative usage before terminal, deduplicating split assistant messages', async () => {
  const f = await fixture(), session = await f.driver.open(f.input);
  try {
    const pending = session.run('Count sample usage'); await f.prompts.next();
    const message = (id: string, input: number, output: number, model = 'claude-sonnet-5-5') => frame({ type: 'assistant', message: { id, model, content: [], usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } } });
    f.output.push(message('a', 10, 2)); f.output.push(message('a', 10, 4)); f.output.push(message('b', 20, 5));
    await new Promise(resolve => setTimeout(resolve, 10));
    const progress = f.events.filter(event => event.type === 'usage');
    assert.ok(progress.length > 0); assert.equal(progress.at(-1)!.usage.inputTokens, 30); assert.equal(progress.at(-1)!.usage.outputTokens, 9);
    assert.equal(progress.at(-1)!.usage.cachedInputTokens, 6);
    finish(f.output); const done = await pending;
    assert.equal(done.usage!.inputTokens, 30); assert.equal(done.usage!.outputTokens, 9);
  } finally { await session.close(); await f.cleanup(); }
});

test('Claude usage spanning fallback models cannot be priced as only the final model', async () => {
  const f = await fixture(), session = await f.driver.open(f.input);
  try {
    const pending = session.run('Synthetic fallback usage'); await f.prompts.next();
    for (const [id, model] of [['a', 'claude-sonnet-5-5'], ['b', 'claude-haiku-5-5']]) f.output.push(frame({ type: 'assistant', message: { id, model, content: [], usage: { input_tokens: 10, output_tokens: 2 } } }));
    finish(f.output); const done = await pending;
    assert.equal(done.usage!.model, 'mixed-provider-models');
    assert.equal(done.usage!.inputTokens, 20);
  } finally { await session.close(); await f.cleanup(); }
});

test('Claude driver keeps explicit project/file policy, reported usage and a single live serial session', async () => {
  const f = await fixture(); const session = await f.driver.open(f.input);
  try {
    const first = session.run('Read the sample.'); await f.prompts.next();
    assert.equal(f.options.permissionMode, 'auto'); assert.deepEqual(f.options.settingSources, ['project']);
    assert.equal(f.options.persistSession, false); assert.equal(f.options.strictMcpConfig, true);
    assert.deepEqual(f.options.tools, ['Read', 'Write', 'Edit', 'Glob', 'Grep']);
    assert.equal(f.options.maxTurns, undefined); assert.equal(f.options.maxBudgetUsd, undefined);
    assert.equal(f.options.model, 'claude-sonnet-5-5'); assert.equal(f.options.fallbackModel, 'claude-haiku-5-5');
    assert.equal(f.options.effort, 'high'); assert.equal(f.options.env?.ANTHROPIC_API_KEY, undefined);
    assert.equal(f.options.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
    await assert.rejects(session.run('Overlapping turn.'), /already running/i);
    finish(f.output); const result = await first;
    assert.equal(result.status, 'completed'); assert.equal(result.text, 'Done.');
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4, cachedInputTokens: 3, cacheWriteTokens: 2, model: 'claude-sonnet-5-5', source: 'provider-reported' });
    const second = session.run('Continue.'); await f.prompts.next(); finish(f.output, 'Continued.');
    assert.equal((await second).text, 'Continued.'); assert.equal(f.counts().opens, 1);
  } finally { await session.close(); await f.cleanup(); }
});

test('Claude stream reconciles complete blocks without duplicated text and interrupts without closing continuation', async () => {
  const f = await fixture(); const session = await f.driver.open(f.input);
  try {
    const first = session.run('Write a sentence.'); await f.prompts.next();
    f.output.push(frame({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg-1' } } }));
    f.output.push(frame({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } } }));
    f.output.push(frame({ type: 'assistant', message: { id: 'msg-1', content: [{ type: 'text', text: 'Hello' }] } }));
    finish(f.output, 'Hello'); assert.equal((await first).text, 'Hello');
    assert.equal(f.events.filter(e => e.type === 'text-delta').map(e => e.text).join(''), 'Hello');
    const second = session.run('Keep working.'); await f.prompts.next(); await session.interrupt();
    assert.equal((await second).status, 'interrupted'); assert.equal(f.counts().closed, 0);
    const third = session.run('Continue after interrupt.'); await f.prompts.next(); finish(f.output);
    assert.equal((await third).status, 'completed');
  } finally { await session.close(); await f.cleanup(); }
});

test('Claude pretool guard denies escape paths, control files, shell and unrecognised MCP without calling owner approval', async () => {
  const f = await fixture(); let approvals = 0;
  f.input.requestApproval = async () => { approvals++; return true; };
  const session = await f.driver.open(f.input);
  try {
    const run = session.run('Test boundaries.'); await f.prompts.next();
    const hook = f.options.hooks!.PreToolUse![0]!.hooks[0]!;
    const check = async (tool_name: string, tool_input: Record<string, unknown>) => hook({ hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 'tool-1', session_id: 'session', transcript_path: '', cwd: f.root }, 'tool-1', { signal: new AbortController().signal });
    for (const [tool, args] of [ ['Read', { file_path: '../private.txt' }], ['Write', { file_path: '.claude/settings.json', content: '{}' }], ['Read', { file_path: '\\\\server\\share\\private.txt' }], ['Bash', { command: 'echo denied' }], ['mcp__chausar__send_email', { to: 'sample@example.invalid' }], ['mcp__other__read_order', {}] ] as const) {
      const decision = await check(tool, args);
      assert.equal((decision as any).hookSpecificOutput?.permissionDecision, 'deny', tool);
    }
    await mkdir(join(f.root, 'safe')); await writeFile(join(f.root, 'safe', 'sample.txt'), 'Sample');
    assert.deepEqual(await check('Read', { file_path: 'safe/sample.txt' }), {});
    assert.equal(approvals, 0); finish(f.output); await run;
  } finally { await session.close(); await f.cleanup(); }
});

test('Claude guard rejects junction escapes and rechecks withdrawn consent before tool use', async () => {
  const f = await fixture(), outside = await mkdtemp(join(tmpdir(), 'chausar-claude-outside-'));
  let allowed = true; f.input.guard = () => { if (!allowed) throw new Error('Consent withdrawn'); };
  const session = await f.driver.open(f.input);
  try {
    await symlink(outside, join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const run = session.run('Read sample.'); await f.prompts.next();
    const hook = f.options.hooks!.PreToolUse![0]!.hooks[0]!;
    const check = () => hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'linked/sample.txt' }, tool_use_id: 'tool-2', session_id: 'session', transcript_path: '', cwd: f.root }, 'tool-2', { signal: new AbortController().signal });
    assert.equal((await check() as any).hookSpecificOutput?.permissionDecision, 'deny');
    allowed = false;
    assert.equal((await check() as any).hookSpecificOutput?.permissionDecision, 'deny');
    await session.close(); assert.equal((await run).status, 'interrupted');
  } finally { await session.close(); await f.cleanup(); await rm(outside, { recursive: true, force: true }); }
});

test('Claude key credentials stay in child environment and malformed transport errors cannot expose them', async () => {
  const f = await fixture(); const apiKey = ['test', '-secret-for-driver'].join('');
  f.input.credentials = { apiKey }; const session = await f.driver.open(f.input);
  try {
    const run = session.run('Sample.'); await f.prompts.next();
    assert.equal(f.options.env?.ANTHROPIC_API_KEY, apiKey);
    f.output.push(frame({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: [apiKey] }));
    const result = await run; assert.equal(result.status, 'failed');
    assert.equal(JSON.stringify({ result, events: f.events }).includes(apiKey), false);
  } finally { await session.close(); await f.cleanup(); }
});

test('Claude file guard denies Windows control aliases, resolved control paths and recursive junction searches', async () => {
  const f = await fixture(), outside = await mkdtemp(join(tmpdir(), 'chausar-claude-search-outside-'));
  const session = await f.driver.open(f.input);
  try {
    const run = session.run('Inspect sample files.'); await f.prompts.next();
    const hook = f.options.hooks!.PreToolUse![0]!.hooks[0]!;
    const check = (tool_name: string, tool_input: Record<string, unknown>) => hook({ hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 'guard-search', session_id: 'session', transcript_path: '', cwd: f.root }, 'guard-search', { signal: new AbortController().signal });
    for (const file_path of ['CLAUDE.md.', '.claude./settings.json', 'nested/CLAUDE.local.md ']) {
      assert.equal((await check('Write', { file_path, content: '{}' }) as any).hookSpecificOutput?.permissionDecision, 'deny', file_path);
    }
    await mkdir(join(f.root, 'nested', '.claude'), { recursive: true });
    await symlink(join(f.root, 'nested', '.claude'), join(f.root, 'innocent'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await check('Read', { file_path: 'innocent/settings.json' }) as any).hookSpecificOutput?.permissionDecision, 'deny');
    await mkdir(join(f.root, 'search')); await writeFile(join(f.root, 'search', 'sample.txt'), 'Sample');
    assert.deepEqual(await check('Grep', { path: 'search', pattern: 'Sample' }), {});
    await symlink(outside, join(f.root, 'search', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const tool of ['Glob', 'Grep']) assert.equal((await check(tool, { path: 'search', pattern: '**/*' }) as any).hookSpecificOutput?.permissionDecision, 'deny', tool);
    finish(f.output); await run;
  } finally { await session.close(); await f.cleanup(); await rm(outside, { recursive: true, force: true }); }
});

test('Claude complete assistant blocks without partial events are all delivered once', async () => {
  const f = await fixture(); const session = await f.driver.open(f.input);
  try {
    const run = session.run('Two paragraphs.'); await f.prompts.next();
    for (const text of ['First paragraph.', 'Second paragraph.']) f.output.push(frame({ type: 'assistant', message: { id: 'msg-complete', content: [{ type: 'text', text }] } }));
    finish(f.output, 'First paragraph.Second paragraph.'); await run;
    assert.equal(f.events.filter(e => e.type === 'text-delta').map(e => e.text).join(''), 'First paragraph.Second paragraph.');
  } finally { await session.close(); await f.cleanup(); }
});

test('Claude manual file approval binds full arguments and refuses a revoked scope after approval', async () => {
  const f = await fixture(); f.input.settings.autoReview = false;
  let consent = true; f.input.guard = () => { if (!consent) throw new Error('Revoked'); };
  const requests: unknown[] = []; f.input.requestApproval = async request => { requests.push(request); consent = false; return true; };
  const session = await f.driver.open(f.input);
  try {
    const run = session.run('Make one file.'); await f.prompts.next();
    const result = await f.options.canUseTool!('Write', { file_path: 'draft.txt', content: 'Exact draft' }, { signal: new AbortController().signal, toolUseID: 'tool-write', requestId: 'request-write' });
    assert.equal(result?.behavior, 'deny');
    assert.equal(requests.length, 1);
    assert.deepEqual((requests[0] as any).arguments, { file_path: 'draft.txt', content: 'Exact draft' });
    assert.equal((requests[0] as any).itemId, 'tool-write');
    assert.equal((requests[0] as any).requestId, 'request-write');
    await session.close(); assert.equal((await run).status, 'interrupted');
  } finally { await session.close(); await f.cleanup(); }
});

test('Claude rejects stale result identity and an unsupported auto-mode downgrade', async () => {
  const f = await fixture(); const session = await f.driver.open(f.input);
  try {
    const run = session.run('Current turn.'); const sent = (await f.prompts.next()).value!;
    f.output.push(frame({ type: 'result', subtype: 'success', is_error: false, user_message_uuid: 'older-turn', result: 'Stale result' }));
    f.output.push(frame({ type: 'system', subtype: 'status', permissionMode: 'default' }));
    const result = await run;
    assert.equal(result.status, 'failed'); assert.notEqual(result.text, 'Stale result');
    assert.equal(result.turnId, sent.uuid);
  } finally { await session.close(); await f.cleanup(); }
});

test('Claude manual approval cannot apply to mutated arguments or an interrupted turn', async () => {
  const f = await fixture(); f.input.settings.autoReview = false;
  let approve: ((value: boolean) => void) | undefined;
  f.input.requestApproval = () => new Promise(resolve => { approve = resolve; });
  const session = await f.driver.open(f.input);
  try {
    const run = session.run('Create approved draft.'); await f.prompts.next();
    const args = { file_path: 'draft.txt', content: 'Approved words' };
    const decision = f.options.canUseTool!('Write', args, { signal: new AbortController().signal, toolUseID: 'tool-mutate', requestId: 'request-mutate' });
    while (!approve) await new Promise(resolve => setImmediate(resolve));
    args.content = 'Changed after approval request'; approve(true);
    const approved = await decision;
    assert.equal(approved?.behavior, 'allow');
    if (approved?.behavior === 'allow') assert.equal(approved.updatedInput?.content, 'Approved words');
    await session.interrupt(); await run;
  } finally { await session.close(); await f.cleanup(); }
});

test('Claude multiple streamed text blocks reconcile against the complete message by block index', async () => {
  const f = await fixture(); const session = await f.driver.open(f.input);
  try {
    const run = session.run('Two blocks.'); await f.prompts.next();
    f.output.push(frame({ type: 'stream_event', event: { type: 'message_start', message: { id: 'multi' } } }));
    for (const [index, text] of ['First', 'Second'].entries()) f.output.push(frame({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } } }));
    f.output.push(frame({ type: 'assistant', message: { id: 'multi', content: [{ type: 'text', text: 'First' }, { type: 'text', text: 'Second' }] } }));
    finish(f.output, 'FirstSecond'); await run;
    assert.equal(f.events.filter(e => e.type === 'text-delta').map(e => e.text).join(''), 'FirstSecond');
  } finally { await session.close(); await f.cleanup(); }
});

test('Claude close waits for SDK stream teardown before releasing the job folder', async () => {
  let release!: () => void; const teardown = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(teardown); const session = await f.driver.open(f.input);
  try {
    const run = session.run('Sample.'); await f.prompts.next(); finish(f.output); await run;
    let finished = false; const closing = session.close().then(() => { finished = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false);
    release(); await closing; assert.equal(finished, true);
  } finally { release(); await session.close(); await f.cleanup(); }
});

test('6F3: research WebFetch follows the fetch policy: no terms-barred or LinkedIn site, no address inside the network', async () => {
  const f = await fixture();
  f.input.settings = { ...f.input.settings, webSearch: true, network: true };
  const session = await f.driver.open(f.input);
  try {
    const run = session.run('Research.'); await f.prompts.next();
    const hook = f.options.hooks!.PreToolUse![0]!.hooks[0]!;
    const check = async (tool_input: Record<string, unknown>) => (await hook({ hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input, tool_use_id: 'tool-1', session_id: 'session', transcript_path: '', cwd: f.root }, 'tool-1', { signal: new AbortController().signal }) as any).hookSpecificOutput?.permissionDecision ?? 'allow';
    assert.equal(await check({ url: 'https://leaf.example/tea', prompt: 'Read' }), 'allow');
    for (const url of ['https://www.linkedin.com/in/someone', 'https://www.naukri.com/x', 'https://127.0.0.1/admin', 'https://192.168.1.1/', 'https://localhost/', 'https://[::1]/'])
      assert.equal(await check({ url, prompt: 'Read' }), 'deny', url);
    assert.equal((await hook({ hook_event_name: 'PreToolUse', tool_name: 'WebSearch', tool_input: { query: 'tea' }, tool_use_id: 'tool-2', session_id: 'session', transcript_path: '', cwd: f.root }, 'tool-2', { signal: new AbortController().signal }) as any).hookSpecificOutput, undefined);
    finish(f.output); await run;
  } finally { await session.close(); await f.cleanup(); }
});

test('A2: a failed Claude turn says why in owner words with the fix, never in its own text', async () => {
  const { aiFailureWords } = await import('../runtime/venture/models/ai-failure.ts');
  const f = await fixture(), session = await f.driver.open(f.input);
  try {
    const pending = session.run('Sample order'); await f.prompts.next();
    f.output.push(frame({ type: 'result', subtype: 'error_max_turns', is_error: true }));
    const result = await pending;
    assert.equal(result.status, 'failed'); assert.equal(result.failure, 'max-turns'); assert.equal(result.error, aiFailureWords('max-turns', 'Claude Code'));
    const next = session.run('Sample order again'); await f.prompts.next();
    f.output.push(frame({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1793400000' }));
    assert.equal((await next).failure, 'usage-limit');
  } finally { await session.close(); await f.cleanup(); }
});
