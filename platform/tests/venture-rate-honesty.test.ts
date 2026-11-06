// Rate honesty and which wallet pays (Ink v2 wave 4, 4F2; catalogue M6, M7, and M2's part that survives: no credits,
// the owner pays the AI company directly). Each price on the rate card is the owner's checked rate (confirmed, with its
// source and date) or Chausar's list price (with the day it was checked); prompt-cache reads and writes are lines of
// their own; each spend row says how its cost is known, the price it was worked at and who pays; with two keys that
// could do the same work, nothing is sent until the owner picks one; a refused paid call is never sent anywhere else.
// The real model port runs on a fake transport that answers like Anthropic or OpenAI: no network, nothing paid.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import { TrustService } from '../runtime/trust.ts';
import type { ModelHttpRequest, ModelHttpResponse, ModelTask, ModelTransport, SecretName, SecretShelf, SpendPolicyView, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { PRESETS, createModelPort, handlers as modelHandlers } from '../runtime/venture/models/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { listSpend, payerWords } from '../runtime/venture/money/spend.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const anthropicKey = () => ['sk', 'ant', 'test', 'not', 'a', 'real', 'key', '0000'].join('-');
const openaiKey = () => ['sk', 'test', 'not', 'a', 'real', 'key', '0000'].join('-');

class MemoryShelf implements SecretShelf {
  #values = new Map<string, string>();
  get(name: SecretName) { return this.#values.get(name) ?? null; }
  set(name: SecretName, value: string) { this.#values.set(name, value); }
  delete(name: SecretName) { this.#values.delete(name); }
  has(name: SecretName) { return this.#values.has(name); }
  clear() { this.#values.clear(); }
}

const words = (task: Partial<ModelTask<{ words: string }>> = {}): ModelTask<{ words: string }> => ({
  purpose: 'interview', instructions: 'Write one short question in plain words.', input: { idea: 'Monthly bookkeeping for cafes' },
  schemaName: 'test-words', schema: { type: 'object', additionalProperties: false, required: ['words'], properties: { words: { type: 'string' } } },
  validate: raw => raw as { words: string }, containsClientData: false, maxOutputTokens: 512, ...task,
});
function anthropicReply(): ModelHttpResponse {
  return { status: 200, body: JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: JSON.stringify({ words: 'Model words' }) }], stop_reason: 'end_turn', usage: { input_tokens: 812, output_tokens: 164 } }) };
}

async function setup() {
  const store = new VentureTestStore();
  const clock = () => new Date('2026-10-15T09:00:00.000Z');
  const secrets = new MemoryShelf();
  const sent: ModelHttpRequest[] = [];
  const transport: ModelTransport = { replay: false, async http(request) { sent.push(request); return anthropicReply(); }, async process() { return { exitCode: 1, stdout: '' }; } };
  const port = createModelPort({ store, clock, transport, secrets, host: 'test', demo: false, claudeCodeTerms: 'accepted' });
  const deps = { store, clock, models: port, services: { trust: new TrustService(store) }, secrets, host: 'test', demo: false, storage: 'experimental-file', claudeCodeTerms: 'accepted' } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'create', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books',
    country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, dateOrder: 'day-month-year' } as never, serviceType: 'bookkeeping', status: 'interview',
    launchStage: 'rehearsal', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  } as never), { create: true });
  const connect = (presetId: string, key: string, tiers?: string[]) => {
    const spec = PRESETS.find(item => item.id === presetId)!;
    return (modelHandlers as Record<string, (d: VentureDeps, c: Context, p: unknown) => Promise<unknown>>)['venture.models.connect'](deps, owner, { presetId, consentDigest: spec.consentDigest, apiKey: key, ...(tiers ? { tiers } : {}) });
  };
  const money = (method: string, payload: unknown = {}) => (moneyHandlers as Record<string, (d: VentureDeps, c: Context, p: unknown) => Promise<unknown>>)[method](deps, owner, payload);
  return { store, deps, port, sent, connect, money };
}

test('rate card: the owner\'s checked rate is confirmed with its source and date; otherwise the list price with its checked date; cache prices are lines of their own', async () => {
  const env = await setup();
  await env.connect('anthropic-haiku-5-5', anthropicKey());
  let view = await env.money('venture.spend.policy.get') as SpendPolicyView;
  const list = view.card!.find(line => line.item === 'model:anthropic-haiku-5-5')!;
  assert.equal(list.state, 'list');
  assert.match(list.checked, /^List price, checked \d{1,2} [A-Z][a-z]{2} 20\d\d$/);
  assert.equal(list.label, 'Claude Haiku 5.5');
  await env.money('venture.spend.policy.set', { rates: [{
    item: 'model:anthropic-haiku-5-5', unit: 'per-million-tokens', inputUsdPerMillion: '1.00', outputUsdPerMillion: '5.00',
    cacheReadUsdPerMillion: '0.10', cacheWriteUsdPerMillion: '1.25', source: 'https://www.anthropic.com/pricing', checkedOn: '2026-10-14',
  }] });
  view = await env.money('venture.spend.policy.get') as SpendPolicyView;
  const mine = view.card!.filter(line => line.item === 'model:anthropic-haiku-5-5');
  assert.deepEqual(mine.map(line => [line.label, line.state, line.price, line.checked, line.source]), [
    ['Claude Haiku 5.5', 'confirmed', 'USD 1.0000 in and USD 5.0000 out, per million tokens', 'Your rate, checked 14 Oct 2026', 'https://www.anthropic.com/pricing'],
    ['Claude Haiku 5.5, prompt-cache reads', 'confirmed', 'USD 0.1000 per million tokens', 'Your rate, checked 14 Oct 2026', 'https://www.anthropic.com/pricing'],
    ['Claude Haiku 5.5, prompt-cache writes', 'confirmed', 'USD 1.2500 per million tokens', 'Your rate, checked 14 Oct 2026', 'https://www.anthropic.com/pricing'],
  ]);
  const rate = view.rates.find(line => line.item === 'model:anthropic-haiku-5-5')!;
  assert.deepEqual([rate.cacheReadMicrosPerMillion, rate.cacheWriteMicrosPerMillion], ['100000', '1250000']);
});

test('spend rows: how the cost is known, the price it was worked at and its date, and who pays; Chausar charges nothing', async () => {
  const env = await setup();
  await env.connect('anthropic-haiku-5-5', anthropicKey());
  await env.port.generate(owner, words());
  const [row] = (await listSpend(env.deps, owner, {})).rows;
  assert.equal(row.payer, 'Paid by your Anthropic key');
  assert.equal(row.basis, 'Worked out from the use the provider reported');
  assert.match(row.priced!, /^At the list price, checked \d{1,2} [A-Z][a-z]{2} 20\d\d$/);
  assert.equal(listRecords(env.store.read(), 'venture-spend').length, 1, 'an own-key call writes its usage row');
  const preview = (await env.port.preview(owner, words({ containsClientData: true })))!;
  assert.equal(preview.payer, 'Paid by your Anthropic key', 'the preview names who pays before the owner approves');
  assert.deepEqual([payerWords('anthropic-sonnet-5-5'), payerWords('openai-gpt-6-luna'), payerWords('claude-code-cli'), payerWords('codex-cli'), payerWords('built-in-templates')],
    ['Paid by your Anthropic key', 'Paid by your OpenAI key', 'Paid by your Claude Code plan', 'Paid by your Codex plan', 'Free on this computer']);
});

test('which wallet pays: connecting a key that takes over work says so; the preview names who pays; a payer that changed after the preview makes the approval stale', async () => {
  const env = await setup();
  const first = await env.connect('anthropic-haiku-5-5', anthropicKey()) as { payerLine?: string };
  assert.equal(first.payerLine, undefined, 'nothing overlaps: nothing to say');
  const preview = (await env.port.preview(owner, words({ containsClientData: true })))!;
  assert.equal(preview.payer, 'Paid by your Anthropic key');
  const second = await env.connect('openai-gpt-6-luna', openaiKey()) as { payerLine?: string };
  assert.equal(second.payerLine, 'This key now pays for quick work; the earlier key (Claude Haiku 5.5) stays connected and pays for nothing now.');
  // The preview named Anthropic, but OpenAI now does this work: the approval is stale, and nothing is sent.
  await assert.rejects(env.port.runPreview(owner, preview.callId, preview.digest, raw => raw), code('APPROVAL_STALE'));
  assert.equal(env.sent.length, 0);
  const fresh = (await env.port.preview(owner, words({ containsClientData: true })))!;
  assert.equal(fresh.payer, 'Paid by your OpenAI key', 'the new preview names the new payer');
  // Giving the new key only the writing hands quick work back to the earlier key, and says so.
  const third = await env.connect('openai-gpt-6-luna', openaiKey(), ['main']) as { payerLine?: string };
  assert.equal(third.payerLine, undefined, 'writing was nobody else\'s');
  assert.equal(listRecords(env.store.read(), 'venture-spend').filter(record => record.phase === 'refused').length, 0, 'nothing refused: one key always pays');
  assert.equal(listRecords(env.store.read(), 'venture-spend').some(record => record.refusal?.code === 'PAYER_AMBIGUOUS'), false);
});

test('a refused paid call is never sent to another paid service instead', async () => {
  const env = await setup();
  await env.connect('anthropic-haiku-5-5', anthropicKey());
  await env.connect('openai-gpt-6-luna', openaiKey(), ['main']);
  await env.money('venture.spend.policy.set', { capUsd: '0.00' });
  await assert.rejects(env.port.generate(owner, words()), code('SPEND_CAP'));
  assert.equal(env.sent.length, 0, 'not sent to Anthropic, and not sent to OpenAI in its place');
});
