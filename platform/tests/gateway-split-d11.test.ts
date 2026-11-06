// D11a task 6: gateway.ts is split by provider route and concern. Rule: no gateway file over 400 lines, and gateway.ts
// still exports every name it exported before, so no importer changes. Every gateway* test is the behaviour proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOllamaOutput } from '../runtime/gateway/providers/ollama.ts';

const runtime = fileURLToPath(new URL('../runtime/', import.meta.url));
const lines = (file: string) => readFileSync(file, 'utf8').split('\n').length - (readFileSync(file, 'utf8').endsWith('\n') ? 1 : 0);

function gatewayFiles(): string[] {
  const files = [join(runtime, 'gateway.ts')];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.ts')) files.push(path);
    }
  };
  try { walk(join(runtime, 'gateway')); } catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; }
  return files;
}

test('no gateway file is over 400 lines', () => {
  const over = gatewayFiles().map(file => [file.slice(runtime.length).replace(/\\/g, '/'), lines(file)] as const).filter(([, count]) => count > 400);
  assert.deepEqual(over, []);
});

test('the gateway is split: gateway.ts routes, and each provider route has its own module', () => {
  const names = gatewayFiles().map(file => file.slice(runtime.length).replace(/\\/g, '/')).sort();
  for (const wanted of ['gateway/providers/cli.ts', 'gateway/providers/http.ts', 'gateway/providers/ollama.ts', 'gateway/providers/openai.ts']) assert.ok(names.includes(wanted), wanted);
});

test('gateway.ts still exports every value it exported before the split', async () => {
  const gateway = await import('../runtime/gateway.ts');
  assert.deepEqual(Object.keys(gateway).sort(), ['DEFAULT_OPERATIONS', 'ModelGateway', 'businessSelectionSchema', 'cliArguments', 'defaultProcess', 'operationCatalog', 'planSchema', 'validateEndpoint', 'validatePlan']);
});

// D11 fix (review LOW-7): the Ollama route's reader, pinned directly. Removing any one of its checks fails this table.
test('the Ollama reader refuses a refusal, a tool call and an unfinished answer, and reads a clean one', () => {
  const answer = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ message: { content: '{"ok":true}', ...message }, done: true, done_reason: 'stop', prompt_eval_count: 3, eval_count: 5, ...extra });
  const refusedWith = (code: string) => (error: any) => error.code === code;
  assert.throws(() => parseOllamaOutput(answer({ refusal: 'I will not help with that.' })), refusedWith('MODEL_REFUSAL'));
  assert.throws(() => parseOllamaOutput(answer({ tool_calls: [{ function: { name: 'send', arguments: {} } }] })), refusedWith('MODEL_TOOL_ATTEMPT'));
  assert.throws(() => parseOllamaOutput(answer({}, { done: false })), refusedWith('MODEL_INCOMPLETE'));
  assert.throws(() => parseOllamaOutput(answer({}, { done_reason: 'length' })), refusedWith('MODEL_INCOMPLETE'));
  assert.throws(() => parseOllamaOutput({ error: 'model not found' }), refusedWith('MODEL_FAILED'));
  assert.deepEqual(parseOllamaOutput(answer({})), { value: { ok: true }, usage: { input_tokens: 3, output_tokens: 5 } });
});
