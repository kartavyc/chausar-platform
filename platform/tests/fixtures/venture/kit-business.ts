// A whole business running on the test-only kit-fixture playbook (Ink v2 wave 5, package 5A1): the fixture installed
// beside the landed kit definitions, a plan from its words, priced and accepted at approve each, one client, and a
// model port whose drafts the test queues (both tiers an AI; previews wait for approval). As
// venture-playbook-wiring-delivery.test.ts sets a flagship business up.
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../../../runtime/contracts.ts';
import { CalculatorService } from '../../../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../../../runtime/ontology.ts';
import { TrustService } from '../../../runtime/trust.ts';
import { PURPOSE_TIER } from '../../../runtime/venture/contracts.ts';
import type { DeliveryRunView, ModelOutcome, ModelPort, ModelPreview, ModelStatusView, ModelTask, SecretShelf, VentureDeps, VentureMethod } from '../../../runtime/venture/contracts.ts';
import { digest, ventureAction } from '../../../runtime/venture/records.ts';
import { handlers as coreHandlers } from '../../../runtime/venture/core/index.ts';
import { handlers as moneyHandlers } from '../../../runtime/venture/money/index.ts';
import { handlers as deliveryHandlers } from '../../../runtime/venture/delivery/index.ts';
import { handlers as viewHandlers } from '../../../runtime/venture/views/index.ts';
import { handlers as playbookHandlers } from '../../../runtime/venture/playbooks/index.ts';
import { definePlaybook } from '../../../runtime/venture/playbooks/kit/define.ts';
import { installTestPlaybooks } from '../../../runtime/venture/playbooks/kit/installed.ts';
import { VentureTestStore } from '../../venture-test-store.ts';
import { fixtureHi, kitFixture } from './kit-fixture.ts';

export const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
export const KIT_IDEA = 'A kit fixture studio for bakeries and gyms in Pune';
const EXPIRES = '2099-10-21T10:30:00.000Z';

export type Draft = { title: string; sections: { heading: string; parts: { kind: 'text'; text: string; ref: '' }[] }[]; questionsForClient: string[] };
export const draft = (title: string, sections: Record<string, string[]>): Draft => ({
  title, questionsForClient: [], sections: Object.entries(sections).map(([heading, lines]) => ({ heading, parts: lines.map(text => ({ kind: 'text' as const, text, ref: '' as const })) })),
});

/** Both tiers are an AI. Previews wait for approval; an approved preview answers with the next queued draft. */
export class Port implements ModelPort {
  drafts: unknown[] = [];
  generated: ModelTask<any>[] = [];
  previewed: ModelTask<any>[] = [];
  #calls = 0;
  #previews = new Map<string, string>();
  status(): ModelStatusView {
    const tier = (presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5') => ({ presetId, model: presetId, usable: true, reason: 'Uses your Anthropic key.' });
    return {
      connections: [], tiers: { fast: tier('anthropic-haiku-5-5'), main: tier('anthropic-sonnet-5-5') },
      spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' },
    } as ModelStatusView;
  }
  presets(): never { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async generate<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
    this.generated.push(task);
    if (task.purpose !== 'delivery' || PURPOSE_TIER[task.purpose] === 'fast') {
      if (!task.template) throw new ChausarError('NO_MODEL_CONNECTED', 'No template.');
      return { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
    }
    this.#calls += 1;
    return { value: task.validate(this.drafts.shift()), by: 'model', callId: `call_${this.#calls}`, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '10', priceConfirmed: true };
  }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    this.previewed.push(task);
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    this.#previews.set(callId, digest(payloadText));
    return {
      callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages',
      estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: EXPIRES,
    };
  }
  async runPreview<T>(_ctx: Context, callId: string, approved: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
    if (this.#previews.get(callId) !== approved) throw new ChausarError('APPROVAL_STALE', 'Run it again.');
    this.#previews.delete(callId);
    return { value: validate(this.drafts.shift()), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '10', priceConfirmed: true };
  }
}

const HANDLERS = { ...coreHandlers, ...moneyHandlers, ...deliveryHandlers, ...viewHandlers, ...playbookHandlers } as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<any>>;

/** Installs kit-fixture (defined and with its Hindi) for the test; returns the undo. */
export function installKitFixture(definition = kitFixture()): () => void {
  return installTestPlaybooks([{ definition: definePlaybook(definition, fixtureHi(definition)), hi: fixtureHi(definition) }]);
}

/**
 * A kit-fixture business on the template route: plan priced on every offer, accepted, at approve each, with one client.
 * clock: the business's clock, which a test may move on. options.seedStage false keeps the first launch stage.
 */
export async function kitBusiness(clock = { now: new Date('2026-10-21T10:00:00.000Z') }, options: { seedStage?: boolean; idea?: string } = {}) {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store), calculator = new CalculatorService(store), trust = new TrustService(store);
  const pack = structuredClone(starterPacks.find(item => item.pack === 'services')!);
  pack.currency = 'INR';
  pack.gstMode = 'unregistered';
  for (const definition of pack.definitions) definition.currency = 'INR';
  await ontology.publish(owner, pack);
  const models = new Port();
  const secrets: SecretShelf = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false, clear: () => undefined } as unknown as SecretShelf;
  const deps: VentureDeps = {
    store, clock: () => clock.now, models, services: { calculator, ontology, trust },
    github: { kind: 'fixture', async read() { throw new ChausarError('GITHUB_READ_FAILED', 'No GitHub here.'); } },
    secrets, host: 'test', demo: true, storage: 'experimental-file',
  };
  const call = (method: VentureMethod | string, payload: unknown = {}): Promise<any> => {
    const handler = HANDLERS[method];
    assert.ok(handler, `no handler for ${method}`);
    return handler(deps, owner, payload);
  };
  await call('venture.create', { idea: options.idea ?? KIT_IDEA, countryCode: 'IN', workingName: 'Test Studio' });
  let interview = await call('venture.interview.next', { useTemplate: true });
  for (const question of interview.interview.questions) {
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id } : question.id === 'q_tax' ? { yes: false } : { skipped: true };
    interview = await call('venture.interview.answer', { questionId: question.id, answer });
  }
  const drafted = await call('venture.blueprint.draft', { useTemplate: true });
  const priced = await call('venture.blueprint.update', { patch: { offers: drafted.blueprint.offers.map((offer: any) => ({ id: offer.id, unitPrice: '1000' })) } });
  await call('venture.blueprint.accept', { digest: priced.blueprint.digest });
  // seedStage false: the business stays at its first launch stage, as a new owner's does.
  if (options.seedStage !== false) await ventureAction(deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'approve-each' }); });
  const client = await call('venture.client.add', { name: 'Asha Rao', email: 'asha@example.com', countryCode: 'IN' });
  return { deps, call, models, store, client, clock, offers: priced.blueprint.offers as { id: string; playbookOffer?: string }[] };
}

/** delivery.run previews; delivery.approve answers with the queued draft. Returns the ready run. */
export async function deliver(env: Awaited<ReturnType<typeof kitBusiness>>, orderId: string, answer: Draft): Promise<DeliveryRunView> {
  const waiting = await env.call('venture.delivery.run', { orderId });
  assert.equal(waiting.status, 'waiting-for-you');
  return approveWaiting(env, waiting, answer);
}

/** Approves a run already waiting for the owner, answering with the queued draft. */
export async function approveWaiting(env: Awaited<ReturnType<typeof kitBusiness>>, waiting: DeliveryRunView, answer: Draft): Promise<DeliveryRunView> {
  env.models.drafts.push(answer);
  return env.call('venture.delivery.approve', { runId: waiting.id, digest: waiting.preview!.digest });
}
