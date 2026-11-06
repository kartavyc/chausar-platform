// Shared by the wave 2 judge tests (package 2C1): a business made through the engine's own methods, and a scripted
// model port. The port answers from the task it is given, keeps each call's status in the vault the way the real port
// does (preview, dispatching, completed, failed), and opens an empty store update before each call, so a call made
// inside a transaction fails. Nothing here touches the network.
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { JUDGE_QUESTIONS, PURPOSE_TIER } from '../runtime/venture/contracts.ts';
import type {
  ModelOutcome, ModelPort, ModelPreview, ModelPurpose, ModelStatusView, ModelTask, SecretShelf, VentureDeps, VentureMethod,
} from '../runtime/venture/contracts.ts';
import { digest, ventureAction } from '../runtime/venture/records.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { VentureTestStore } from './venture-test-store.ts';

export const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
export const phone: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' };
export const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
export const CA_IDEA = 'An AI-native CA firm for GST filing and income tax returns in Pune';
export const PLAIN_IDEA = 'Pricing strategy advice for small online shops, done by AI helpers with me checking every reply.';
export const NOW = '2026-10-21T10:00:00.000Z';
const EXPIRES = '2026-10-21T10:30:00.000Z';

/** Which queue answers a task: the rules judge shares the judge's purpose, so it has its own. */
export type Answering = ModelPurpose | 'judge-rules';
export type Responder = (task: ModelTask<any>) => unknown;
const keyOf = (task: ModelTask<unknown>): Answering => (task.schemaName === 'venture-judge-rules' ? 'judge-rules' : task.purpose);

const text = (line: string) => ({ kind: 'text' as const, text: line, ref: '' as const });
/** A draft with one plain line under every heading the task asks for, describing work ahead and asking one question. */
export function plainDraft(task: ModelTask<unknown>): unknown {
  const input = task.input as { requiredSections: string[] };
  return {
    title: 'Your plan for the work',
    sections: input.requiredSections.map(heading => ({ heading, parts: [text('We will read what you send and list anything that needs your answer before the work starts.')] })),
    questionsForClient: ['Which months should we cover first?'],
  };
}
/** A yes on every rule the task asks, each citing the draft from the trace. */
export function yesVotes(task: ModelTask<unknown>): unknown {
  const rules = (task.input as { rules: { id: string }[] }).rules;
  return { votes: rules.map(rule => ({ rule: rule.id, answer: 'yes', cites: ['draft'], quote: '', reason: 'The draft does what the rule asks.' })) };
}
/** A checked no on one rule, quoting it; yes on the rest. */
export function noOn(ruleId: string, reason = 'The draft breaks this rule.'): Responder {
  return task => {
    const rules = (task.input as { rules: { id: string; rule: string }[] }).rules;
    return { votes: rules.map(rule => rule.id === ruleId
      ? { rule: rule.id, answer: 'no', cites: ['draft'], quote: rule.rule, reason }
      : { rule: rule.id, answer: 'yes', cites: ['draft'], quote: '', reason: 'Fine.' }) };
  };
}

export class JudgePort implements ModelPort {
  store: VentureTestStore;
  fast: 'model' | 'template' = 'model';
  main: 'model' | 'template' = 'model';
  sendPolicy: ModelStatusView['sendPolicy'] = 'shape';
  respond: Partial<Record<Answering, Responder>> = {
    'client-sim': () => ({ message: 'Hello, I would like your help with this, please.', asksForPerson: false }),
    'agent-turn': () => ({ note: 'Ready to write the reply', calls: [], finished: true }),
    delivery: plainDraft,
    judge: () => ({ answers: JUDGE_QUESTIONS.map(question => ({ question, answer: 'yes', reason: 'Fine.' })) }),
    'judge-rules': yesVotes,
  };
  generated: ModelTask<any>[] = [];
  previewed: ModelTask<any>[] = [];
  /** Every task the port answered with a model, through generate or an approved preview, in order. */
  answered: ModelTask<any>[] = [];
  sent = 0;
  /** Thrown by runPreview after the call is claimed, once, when set. */
  failNextSend: ChausarError | null = null;
  /** A refusal for a task's preview, or before its send is claimed (the call stays a preview); null lets it go. */
  refusePreview: ((task: ModelTask<any>) => ChausarError | null) | null = null;
  refuseSend: ((task: ModelTask<any>) => ChausarError | null) | null = null;
  /** The most a task's call can cost, in micros; '1000' unless set. */
  estimateFor: ((task: ModelTask<any>) => string) | null = null;
  /** Runs inside preview, after the call is recorded and before it returns: lets a test act meanwhile. */
  onPreview: ((task: ModelTask<any>) => Promise<void>) | null = null;
  /** The consent each sent call went under, in order: 'approved-preview', or 'standing-judge' for the judge on its own. */
  consents: string[] = [];
  /** Whether the port answers from a recording; a live port prices calls with the owner's rate card. */
  replay = true;
  /** Runs inside a sent call, before the model answers: lets a test act while the call is out. */
  onSend: ((task: ModelTask<any>) => Promise<void>) | null = null;
  #previews = new Map<string, { digest: string; task: ModelTask<any>; used: boolean }>();
  #calls = 0;
  constructor(store: VentureTestStore) { this.store = store; }
  status(): ModelStatusView {
    const tier = (mode: 'model' | 'template', presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5') => mode === 'model'
      ? { presetId, model: presetId, usable: true, reason: 'Uses your Anthropic key.' }
      : { presetId: 'built-in-templates' as const, model: null, usable: true, reason: 'No AI connected; using built-in templates' };
    return {
      connections: [], tiers: { fast: tier(this.fast, 'anthropic-haiku-5-5'), main: tier(this.main, 'anthropic-sonnet-5-5') },
      spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: this.sendPolicy, replay: { active: this.replay, label: 'synthetic recording' },
    };
  }
  presets(): never { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  #answer(task: ModelTask<any>): unknown {
    const responder = this.respond[keyOf(task)];
    assert.ok(responder, `no responder for ${keyOf(task)}`);
    return structuredClone(responder(task));
  }
  #tier(task: ModelTask<unknown>) { return this[PURPOSE_TIER[task.purpose]]; }
  async generate<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
    await this.store.update(() => undefined);
    if (task.containsClientData) throw new ChausarError('CLIENT_DATA_NEEDS_APPROVAL', 'Client data needs your approval.');
    this.generated.push(task);
    if (this.#tier(task) === 'template') {
      if (!task.template) throw new ChausarError('NO_MODEL_CONNECTED', 'No AI connected.');
      return { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
    }
    this.#calls += 1;
    this.answered.push(task);
    return { value: task.validate(this.#answer(task)), by: 'model', callId: `call_${this.#calls}`, presetId: 'anthropic-haiku-5-5', model: 'stub', costMicros: '100', priceConfirmed: true };
  }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    await this.store.update(() => undefined);
    if (this.sendPolicy === 'nothing') throw new ChausarError('SEND_DISABLED', 'Sending is off for this workspace.');
    const refused = this.refusePreview?.(task) ?? null;
    if (refused) throw refused;
    this.previewed.push(task);
    if (this.#tier(task) === 'template') return null;
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    this.#previews.set(callId, { digest: digest(payloadText), task, used: false });
    await this.store.update(state => { state.conversations.push({ id: callId, kind: 'venture-model-call', status: 'preview', purpose: task.purpose }); });
    if (this.onPreview) await this.onPreview(task);
    const estimate = this.estimateFor?.(task) ?? '1000';
    return {
      callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-haiku-5-5', model: 'stub', endpoint: 'https://api.anthropic.com/v1/messages',
      estimatedMaxCostMicros: estimate, estimatedMaxCostDisplay: estimate === '1000' ? 'USD 0.0010' : `estimate ${estimate}`, expiresAt: EXPIRES,
    };
  }
  async runPreview<T>(ctx: Context, callId: string, approved: string, validate: (raw: unknown) => T, options?: { consent?: 'standing-judge' }): Promise<ModelOutcome<T>> {
    await this.store.update(() => undefined);
    if (ctx.channel !== 'desktop') throw new ChausarError('APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
    const held = this.#previews.get(callId);
    if (!held || held.used || held.digest !== approved) throw new ChausarError('APPROVAL_STALE', 'Run it again; the approved text is no longer available.');
    const refused = this.refuseSend?.(held.task) ?? null;
    if (refused) throw refused;
    assert.ok(options?.consent !== 'standing-judge' || held.task.purpose === 'judge', 'only the judge goes on standing consent');
    this.consents.push(options?.consent ?? 'approved-preview');
    held.used = true;
    // Like the real port, a sent call keeps what it cost, an answer refused for its shape included.
    const setCall = (status: string) => this.store.update(state => {
      const call = state.conversations.find(record => record?.id === callId);
      if (call) { call.status = status; if (status !== 'dispatching') call.costMicros = '200'; }
    });
    await setCall('dispatching');
    this.sent += 1;
    if (this.onSend) await this.onSend(held.task);
    if (this.failNextSend) {
      const error = this.failNextSend;
      this.failNextSend = null;
      await setCall('failed');
      throw error;
    }
    this.answered.push(held.task);
    try {
      const value = validate(this.#answer(held.task));
      await setCall('completed');
      return { value, by: 'model', callId, presetId: 'anthropic-haiku-5-5', model: 'stub', costMicros: '200', priceConfirmed: true };
    } catch (error) {
      await setCall('failed');
      throw error;
    }
  }
  /** The rules judge tasks the port answered, in order. */
  rulesTasks(): ModelTask<any>[] { return this.answered.filter(task => task.schemaName === 'venture-judge-rules'); }
}

const HANDLERS = { ...coreHandlers, ...moneyHandlers, ...deliveryHandlers, ...viewHandlers } as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<any>>;

export type Business = Awaited<ReturnType<typeof business>>;

/**
 * A business from an idea on the template route: plan priced on every offer, accepted, at approve each (or the stage
 * given), with one client. Both model tiers are an AI unless a test says otherwise.
 */
export async function business(idea: string, stage: 'rehearsal' | 'shadow' | 'approve-each' = 'approve-each') {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store), calculator = new CalculatorService(store), trust = new TrustService(store);
  const pack = structuredClone(starterPacks.find(item => item.pack === 'services')!);
  pack.currency = 'INR';
  pack.gstMode = 'unregistered';
  for (const definition of pack.definitions) definition.currency = 'INR';
  await ontology.publish(owner, pack);
  const models = new JudgePort(store);
  const secrets: SecretShelf = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false, clear: () => undefined } as unknown as SecretShelf;
  let now = new Date(NOW);
  const deps: VentureDeps = {
    store, clock: () => now, models, services: { calculator, ontology, trust },
    github: { kind: 'fixture', async read() { throw new ChausarError('GITHUB_READ_FAILED', 'No GitHub here.'); } },
    secrets, host: 'test', demo: true, storage: 'experimental-file',
  };
  const call = (method: VentureMethod | string, payload: unknown = {}, ctx: Context = owner): Promise<any> => {
    const handler = HANDLERS[method];
    assert.ok(handler, `no handler for ${method}`);
    return handler(deps, ctx, payload);
  };
  await call('venture.create', { idea, countryCode: 'IN', workingName: 'Test Business' });
  let interview = await call('venture.interview.next', { useTemplate: true });
  for (const question of interview.interview.questions) {
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id } : question.id === 'q_tax' ? { yes: false } : { skipped: true };
    interview = await call('venture.interview.answer', { questionId: question.id, answer });
  }
  const drafted = await call('venture.blueprint.draft', { useTemplate: true });
  const priced = await call('venture.blueprint.update', { patch: { offers: drafted.blueprint.offers.map((offer: any) => ({ id: offer.id, unitPrice: '1000' })) } });
  await call('venture.blueprint.accept', { digest: priced.blueprint.digest });
  await ventureAction(deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: stage }); });
  const client = await call('venture.client.add', { name: 'Asha Rao', email: 'asha@example.com', countryCode: 'IN' });
  return {
    deps, call, models, store, client, offers: priced.blueprint.offers as { id: string; playbookOffer?: string }[],
    setNow(iso: string) { now = new Date(iso); },
  };
}

/**
 * Approves a run's waiting turn the way the owner does on Today: the row's own digest binds what the row showed, the
 * judge's notice included, so that is where the judge's standing consent is given (judge-run.ts). Returns the run.
 */
export async function approveFromToday(env: Business, runId: string): Promise<any> {
  const row = (await env.call('venture.queue.list')).rows.find((item: any) => item.kind === 'quote' && item.viewRef?.id === runId);
  assert.ok(row, `no approval row for ${runId}`);
  const decided = await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true });
  assert.equal(decided.outcome, 'done', JSON.stringify(decided));
  return (await env.call('venture.delivery.list')).find((item: any) => item.id === runId);
}

/** One agent draft for one order, ready for review: delivery.run previews, the owner approves it on Today. */
export async function readyDraft(env: Business, request = 'Please look at my pricing for the new product line and advise.', offerId = 'offer_1'): Promise<any> {
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId, request });
  const waiting = await env.call('venture.delivery.run', { orderId: order.id });
  assert.equal(waiting.status, 'waiting-for-you');
  return approveFromToday(env, waiting.id);
}
