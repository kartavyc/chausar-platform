// A2: why an AI turn failed, in owner words with the fix to offer: a used-up plan, a job too long to read, the step limit,
// a dropped connection, a refused sign-in (and a model the account does not offer). The codes reach the owner because
// they are in VENTURE_ERRORS; the words never quote the tool's own text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_FAILURE_CODES, aiFailureWords, classifyAiText, classifyClaudeResult, classifyCodexInfo, classifyCodexExec } from '../runtime/venture/models/ai-failure.ts';
import { VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import { parseClaudeCli, parseCodexCli } from '../runtime/venture/models/cli.ts';
import { ownerError } from '../runtime/owner-error.ts';
import { ChausarError } from '../runtime/contracts.ts';

const jsonl = (...events: unknown[]) => events.map(event => JSON.stringify(event)).join('\n');

test('every failure code is one of Chausar\'s own, so its words reach the owner', () => {
  for (const code of Object.values(AI_FAILURE_CODES)) {
    assert.ok((VENTURE_ERRORS as readonly string[]).includes(code), code);
    assert.equal(ownerError(new ChausarError(code, 'x')).code, code);
  }
  for (const kind of Object.keys(AI_FAILURE_CODES) as (keyof typeof AI_FAILURE_CODES)[]) {
    const words = aiFailureWords(kind, 'Codex');
    assert.doesNotMatch(words, /—/);
    assert.ok(words.split(/\s+/).length <= 30, `${kind} is short: ${words}`);
  }
});

test('Codex app-server error info names the kind', () => {
  assert.equal(classifyCodexInfo('usageLimitExceeded'), 'usage-limit');
  assert.equal(classifyCodexInfo('rateLimitExceeded'), 'usage-limit');
  assert.equal(classifyCodexInfo('contextWindowExceeded'), 'context-full');
  assert.equal(classifyCodexInfo('sessionBudgetExceeded'), 'max-turns');
  assert.equal(classifyCodexInfo('unauthorized'), 'sign-in-refused');
  assert.equal(classifyCodexInfo('modelNotFound'), 'model-missing');
  assert.equal(classifyCodexInfo({ responseStreamDisconnected: { httpStatusCode: null } }), 'stream-cut');
  assert.equal(classifyCodexInfo({ responseStreamConnectionFailed: { httpStatusCode: 502 } }), 'stream-cut');
  assert.equal(classifyCodexInfo('internalServerError'), null);
  assert.equal(classifyCodexInfo(null), null);
});

test('text from a tool names the kind; ordinary failures name none', () => {
  assert.equal(classifyAiText("You've hit your usage limit. Upgrade to Pro or try again at 4:05 PM."), 'usage-limit');
  assert.equal(classifyAiText('Claude AI usage limit reached|1793400000'), 'usage-limit');
  assert.equal(classifyAiText('Prompt is too long'), 'context-full');
  assert.equal(classifyAiText('Your input exceeds the context window of this model.'), 'context-full');
  assert.equal(classifyAiText('stream disconnected before completion: error sending request'), 'stream-cut');
  assert.equal(classifyAiText('Invalid API key · Please run /login'), 'sign-in-refused');
  assert.equal(classifyAiText('unexpected status 401 Unauthorized: token expired'), 'sign-in-refused');
  assert.equal(classifyAiText("The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account."), 'model-missing');
  assert.equal(classifyAiText('Reached max turns (30)'), 'max-turns');
  assert.equal(classifyAiText('Something odd happened.'), null);
  assert.equal(classifyAiText(''), null);
});

test('a Codex exec answer and its stderr name the kind', () => {
  assert.equal(classifyCodexExec(jsonl({ type: 'thread.started', thread_id: 't' }, { type: 'turn.started' }, { type: 'turn.failed', error: { message: "You've hit your usage limit." } }), ''), 'usage-limit');
  assert.equal(classifyCodexExec(jsonl({ type: 'error', message: 'stream disconnected before completion' }), ''), 'stream-cut');
  assert.equal(classifyCodexExec('', 'Error: unexpected status 401 Unauthorized'), 'sign-in-refused');
  assert.equal(classifyCodexExec('not json', 'odd'), null);
});

test('a Claude Code result names the kind', () => {
  assert.equal(classifyClaudeResult({ type: 'result', subtype: 'error_max_turns', is_error: true }), 'max-turns');
  assert.equal(classifyClaudeResult({ type: 'result', subtype: 'success', is_error: true, result: 'Prompt is too long' }), 'context-full');
  assert.equal(classifyClaudeResult({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1793400000' }), 'usage-limit');
  assert.equal(classifyClaudeResult({ type: 'result', subtype: 'error_during_execution', is_error: true }), null);
});

test('a failed command-line call says why in owner words, not "stopped with an error"', () => {
  const codex = parseCodexCli({ exitCode: 1, stdout: jsonl({ type: 'turn.failed', error: { message: "You've hit your usage limit." } }), stderr: '' });
  assert.equal(codex.ok, false);
  assert.equal((codex as { code: string }).code, 'AI_USAGE_LIMIT');
  assert.equal((codex as { message: string }).message, aiFailureWords('usage-limit', 'Codex'));
  const signedOut = parseCodexCli({ exitCode: 1, stdout: '', stderr: 'Error: unexpected status 401 Unauthorized' });
  assert.equal((signedOut as { code: string }).code, 'AI_SIGN_IN_REFUSED');
  const claude = parseClaudeCli({ exitCode: 1, stdout: JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }) });
  assert.equal((claude as { code: string }).code, 'AI_MAX_TURNS');
  assert.equal((claude as { message: string }).message, aiFailureWords('max-turns', 'Claude Code'));
  // A plain failure keeps the plain words.
  assert.equal((parseCodexCli({ exitCode: 1, stdout: '', stderr: 'odd' }) as { code: string }).code, 'MODEL_FAILED');
});
