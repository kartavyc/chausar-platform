// YouTube channel playbook: the plan picks it and the screens can show its label. An idea such as "YouTube channel",
// "faceless channel" or "podcast clips" picks the playbook from the registry; the instant plan, the venture view and
// the blueprint view carry { id, label } so the UI can show "YouTube channel". A plain idea carries no playbook field,
// so nothing changes for businesses the flagship playbooks do not cover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import type { SecretShelf, VentureDeps, VentureMethod } from '../runtime/venture/contracts.ts';
import { handlers, previewPlan } from '../runtime/venture/core/index.ts';
import { classifyIdea } from '../runtime/venture/core/service-types.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const YOUTUBE = { id: 'youtube', label: 'YouTube channel' };

function harness() {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store);
  const trust = new TrustService(store);
  const calculator = new CalculatorService(store);
  const secrets: SecretShelf = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false } as unknown as SecretShelf;
  const deps: VentureDeps = {
    store,
    clock: () => new Date('2026-10-15T10:00:00.000Z'),
    models: { generate: async () => { throw new ChausarError('NO_MODEL_CONNECTED', 'No AI in this test.'); } } as unknown as VentureDeps['models'],
    services: {
      calculator: { calculate: (ctx, request) => calculator.calculate(ctx, request as any), receipt: (ctx, id) => calculator.receipt(ctx, id) },
      ontology,
      trust,
    },
    github: { kind: 'fixture', async read() { throw new ChausarError('GITHUB_READ_FAILED', 'No GitHub here.'); } },
    secrets,
    host: 'test',
    demo: true,
    storage: 'experimental-file',
  };
  return (method: VentureMethod, payload: unknown = {}): Promise<any> => (handlers[method] as any)(deps, owner, payload);
}

test('the instant plan names the YouTube channel playbook and plans it as a studio', () => {
  for (const idea of ['A faceless YouTube channel explaining cricket rules', 'A faceless channel about chess openings', 'Podcast clips for Indian business shows']) {
    const plan = previewPlan({ idea, countryCode: 'IN' });
    assert.deepEqual(plan.playbook, YOUTUBE, idea);
    assert.equal(plan.serviceType.value, 'studio', idea);
  }
  const plain = previewPlan({ idea: 'Dog walking in Bandra for busy owners', countryCode: 'IN' });
  assert.equal('playbook' in plain, false, 'no playbook field when no flagship playbook fits');
});

test('the classifier takes the picked playbook\'s base type first, then keeps its keyword counts', () => {
  assert.equal(classifyIdea('A faceless channel about chess openings'), 'studio');
  assert.equal(classifyIdea('YouTube channel reviewing phones'), 'studio');
  // "content" is a content keyword, but "content calendar" picks the social media agency, which plans as an agency.
  assert.equal(classifyIdea('A content calendar service for yoga studios'), 'agency');
  assert.equal(classifyIdea('podcast editing studio'), 'studio');
  assert.equal(classifyIdea('marketing agency for gyms'), 'agency');
  assert.equal(classifyIdea('dog walking'), 'other');
});

test('the venture view and the blueprint view carry the playbook label for the screens', async () => {
  const call = harness();
  const created = await call('venture.create', { idea: 'A faceless YouTube channel explaining cricket rules', countryCode: 'IN', workingName: 'Cricket Explained' });
  assert.deepEqual(created.playbook, YOUTUBE);
  assert.deepEqual((await call('venture.get')).playbook, YOUTUBE);
  await call('venture.interview.next', { useTemplate: true });
  for (const [questionId, answer] of [['q_1', { skipped: true }], ['q_2', { skipped: true }], ['q_pricing_model', { choiceId: 'project' }], ['q_price', { skipped: true }], ['q_tax', { yes: false }]] as const) {
    await call('venture.interview.answer', { questionId, answer });
  }
  const view = await call('venture.blueprint.draft', { useTemplate: true });
  assert.deepEqual(view.playbook, YOUTUBE);
  assert.equal(view.blueprint.serviceType, 'studio');
  assert.equal('playbook' in view.blueprint, false, 'the stored plan and its digest do not change');
  assert.deepEqual((await call('venture.blueprint.get')).playbook, YOUTUBE);
});
