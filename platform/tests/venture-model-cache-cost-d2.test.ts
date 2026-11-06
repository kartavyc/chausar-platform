// D2 task 18: cache reads and writes on key and command-line calls are kept and priced honestly. Each reported token
// kind is priced at its own saved rate and rounded up once; a reported cache kind with no saved rate leaves the cost
// held (SPEND_UNPRICED), never priced as plain input. The owner's own plan (command-line routes) costs nothing. A cache
// count appears on the usage only when it is above zero, so a call without caching keeps exactly its old shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { callCostMicros, estimateMaxCostMicros } from '../runtime/venture/models/cost.ts';
import { parseAnthropic } from '../runtime/venture/models/anthropic.ts';
import { parseOpenAI } from '../runtime/venture/models/openai.ts';
import { parseClaudeCli, parseCodexCli } from '../runtime/venture/models/cli.ts';
import { readUsage } from '../runtime/venture/models/types.ts';
import type { ModelPriceTable, SpendRate } from '../runtime/venture/contracts.ts';
import { listRateOfTable, modelTableOf } from '../runtime/venture/money/spend.ts';

const table = (rates: Partial<ModelPriceTable>): ModelPriceTable => ({ currency: 'USD', inputMicrosPerMillion: '3000000', outputMicrosPerMillion: '15000000',
  source: 'synthetic test table', checkedOn: '2026-11-05', confirmed: true, ...rates });
const held = (run: () => unknown) => assert.throws(run, (error: { code?: string; message?: string }) => error.code === 'SPEND_UNPRICED' && /cost stays held/.test(error.message ?? ''));

test('Anthropic: 1,000 input, 4,000 cache read and no write, at a table with cache rates, is the exact micro figure', () => {
  const parsed = parseAnthropic({ status: 200, body: JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }],
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 } }) });
  assert.deepEqual(parsed.usage, { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 4000 });
  // (1000 x 3000000 + 200 x 15000000 + 4000 x 300000) / 1000000 = 7200, rounded up once.
  assert.equal(callCostMicros(parsed.usage!, table({ cacheReadMicrosPerMillion: '300000', cacheWriteMicrosPerMillion: '3750000' })), '7200');
});

test('the same answer at a table without a cache read rate is held, never priced as plain input', () => {
  const usage = readUsage({ input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 }, 'anthropic')!;
  held(() => callCostMicros(usage, table({})));
  held(() => callCostMicros(usage, table({ cacheWriteMicrosPerMillion: '3750000' })));
  const writes = readUsage({ input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 }, 'anthropic')!;
  held(() => callCostMicros(writes, table({ cacheReadMicrosPerMillion: '300000' })));
  // (10 x 3000000 + 1 x 15000000 + 2000 x 3750000) / 1000000 = 7545.
  assert.equal(callCostMicros(writes, table({ cacheReadMicrosPerMillion: '300000', cacheWriteMicrosPerMillion: '3750000' })), '7545');
});

test('OpenAI: 5,000 input of which 4,000 cached is 1,000 uncached at the input rate plus 4,000 at the read rate', () => {
  const parsed = parseOpenAI({ status: 200, body: JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }],
    usage: { input_tokens: 5000, input_tokens_details: { cached_tokens: 4000 }, output_tokens: 100 } }) });
  assert.deepEqual(parsed.usage, { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 4000 });
  // (1000 x 2000000 + 100 x 8000000 + 4000 x 500000) / 1000000 = 4800.
  assert.equal(callCostMicros(parsed.usage!, table({ inputMicrosPerMillion: '2000000', outputMicrosPerMillion: '8000000', cacheReadMicrosPerMillion: '500000' })), '4800');
  held(() => callCostMicros(parsed.usage!, table({ inputMicrosPerMillion: '2000000', outputMicrosPerMillion: '8000000' })));
});

test('command-line answers keep the cache counts and, on the owner\'s own plan, cost nothing', () => {
  const claude = parseClaudeCli({ exitCode: 0, stdout: JSON.stringify({ type: 'result', is_error: false, structured_output: {},
    usage: { input_tokens: 30, output_tokens: 9, cache_read_input_tokens: 6000, cache_creation_input_tokens: 1200 } }), stderr: '' } as never);
  assert.deepEqual(claude.usage, { inputTokens: 30, outputTokens: 9, cachedInputTokens: 6000, cacheWriteTokens: 1200 });
  assert.equal(callCostMicros(claude.usage!, null), '0');
  assert.deepEqual(readUsage({ input_tokens: 5000, cached_input_tokens: 4500, output_tokens: 80 }, 'codex-cli'),
    { inputTokens: 500, outputTokens: 80, cachedInputTokens: 4500 });
  assert.equal(typeof parseCodexCli, 'function');
});

test('no cache reported: priced exactly as before, with or without cache rates; unreadable counts are refused', () => {
  const plain = readUsage({ input_tokens: 1000, output_tokens: 200 }, 'anthropic')!;
  assert.deepEqual(plain, { inputTokens: 1000, outputTokens: 200 });
  assert.equal(callCostMicros(plain, table({})), '6000');
  assert.equal(callCostMicros(plain, table({ cacheReadMicrosPerMillion: '300000' })), '6000');
  assert.equal(readUsage({ input_tokens: 10, output_tokens: 1, cache_read_input_tokens: -1 }, 'anthropic'), null);
  assert.equal(readUsage({ input_tokens: 100, input_tokens_details: { cached_tokens: 101 }, output_tokens: 1 }, 'openai'), null, 'more cached than input is not readable');
});

test('a spend cap still reserves every input token at the full input price, so caching can never pass a cap', () => {
  assert.equal(estimateMaxCostMicros(2000, 100, table({ cacheReadMicrosPerMillion: '1' })), estimateMaxCostMicros(2000, 100, table({})));
});

test('the rate card carries the cache prices both ways: a table to its card line, and the owner\'s card line to the table the call is priced with', () => {
  const card = listRateOfTable('model:anthropic-sonnet', table({ cacheReadMicrosPerMillion: '300000', cacheWriteMicrosPerMillion: '3750000' }))!;
  assert.equal(card.cacheReadMicrosPerMillion, '300000');
  assert.equal(card.cacheWriteMicrosPerMillion, '3750000');
  const back = modelTableOf(card as SpendRate);
  assert.equal(back.cacheReadMicrosPerMillion, '300000');
  assert.equal(back.cacheWriteMicrosPerMillion, '3750000');
  const plain = modelTableOf(listRateOfTable('model:anthropic-sonnet', table({}))! as SpendRate);
  assert.equal('cacheReadMicrosPerMillion' in plain, false);
  assert.equal('cacheWriteMicrosPerMillion' in listRateOfTable('model:x', table({}))!, false);
});
