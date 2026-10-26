// Test helper, not a test file (Ink v2 wave 4, 4F2): the real model port on a fake transport, for spend limits, write
// caps and who pays, tested through the port's own preview, approve (runPreview, which claims the call) and generate.
// The transport answers like Anthropic or OpenAI and never reaches the network; nothing is paid. Keys are built at
// run time, so no fixture holds a string shaped like a real key.
import type { Context } from '../runtime/contracts.ts';
import { TrustService } from '../runtime/trust.ts';
import type { ModelHttpRequest, ModelHttpResponse, ModelPurpose, ModelTask, ModelTransport, SecretName, SecretShelf, VentureDeps } from '../runtime/venture/contracts.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { PRESETS, createModelPort, handlers as modelHandlers } from '../runtime/venture/models/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { VentureTestStore } from './venture-test-store.ts';

export const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
export const anthropicKey = () => ['sk', 'ant', 'test', 'not', 'a', 'real', 'key', '0000'].join('-');
export const openaiKey = () => ['sk', 'test', 'not', 'a', 'real', 'key', '0000'].join('-');

class MemoryShelf implements SecretShelf {
  #values = new Map<string, string>();
  get(name: SecretName) { return this.#values.get(name) ?? null; }
  set(name: SecretName, value: string) { this.#values.set(name, value); }
  delete(name: SecretName) { this.#values.delete(name); }
  has(name: SecretName) { return this.#values.has(name); }
  clear() { this.#values.clear(); }
}

/** A task of any purpose that asks for one line of words. */
export function wordsTask(purpose: ModelPurpose = 'interview', over: Partial<ModelTask<{ words: string }>> = {}): ModelTask<{ words: string }> {
  return {
    purpose, instructions: 'Write one short line in plain words.', input: { idea: 'Monthly bookkeeping for cafes' },
    schemaName: 'test-words', schema: { type: 'object', additionalProperties: false, required: ['words'], properties: { words: { type: 'string' } } },
    validate: raw => raw as { words: string }, containsClientData: false, maxOutputTokens: 512, ...over,
  };
}

/** An Anthropic answer of this value, with a small usage. */
export function anthropicAnswer(value: unknown): ModelHttpResponse {
  return {
    status: 200,
    body: JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: JSON.stringify(value) }], stop_reason: 'end_turn', usage: { input_tokens: 812, output_tokens: 164 } }),
  };
}

export type PortEnv = Awaited<ReturnType<typeof realPortEnv>>;

/**
 * A bookkeeping business in India on the real port. answer: what the fake provider says to each request (by default
 * one line of words). now: the clock, which the test may move.
 */
export async function realPortEnv(options: { answer?: (request: ModelHttpRequest) => ModelHttpResponse; at?: string } = {}) {
  const store = new VentureTestStore();
  let now = Date.parse(options.at ?? '2026-10-15T09:00:00.000Z');
  const clock = () => new Date(now);
  const secrets = new MemoryShelf();
  const sent: ModelHttpRequest[] = [];
  const env = { answer: options.answer ?? (() => anthropicAnswer({ words: 'Model words' })) };
  const transport: ModelTransport = { replay: false, async http(request) { sent.push(request); return env.answer(request); }, async process() { return { exitCode: 1, stdout: '' }; } };
  const port = createModelPort({ store, clock, transport, secrets, host: 'test', demo: false, claudeCodeTerms: 'accepted' });
  const deps = { store, clock, models: port, services: { trust: new TrustService(store) }, secrets, host: 'test', demo: false, storage: 'experimental-file', claudeCodeTerms: 'accepted' } as unknown as VentureDeps;
  const venture = await ventureAction(deps, owner, 'admin', 'create', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books',
    country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, dateOrder: 'day-month-year' } as never, serviceType: 'bookkeeping', status: 'live',
    launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  } as never), { create: true });
  const connect = (presetId: string, tiers?: string[]) => {
    const spec = PRESETS.find(item => item.id === presetId)!;
    const key = spec.kind === 'openai-responses' ? openaiKey() : anthropicKey();
    return (modelHandlers as Record<string, (d: VentureDeps, c: Context, p: unknown) => Promise<any>>)['venture.models.connect'](deps, owner, {
      presetId, consentDigest: spec.consentDigest, ...(spec.needsKey ? { apiKey: key } : {}), ...(tiers ? { tiers } : {}),
    });
  };
  const money = <T = any>(method: string, payload: unknown = {}, ctx: Context = owner) =>
    (moneyHandlers as Record<string, (d: VentureDeps, c: Context, p: unknown) => Promise<T>>)[method](deps, ctx, payload);
  /** Preview a task, then approve the exact text: the port claims the call in one write before it is sent. */
  const approveTask = async <T>(task: ModelTask<T>) => {
    const preview = (await port.preview(owner, task))!;
    return { preview, outcome: port.runPreview(owner, preview.callId, preview.digest, task.validate) };
  };
  return {
    store, deps, port, sent, venture, connect, money, approveTask, env,
    advance(ms: number) { now += ms; },
  };
}
