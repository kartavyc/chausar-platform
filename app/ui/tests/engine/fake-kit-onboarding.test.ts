// Chausar fake kit onboarding, 5M integration. Original behavior test at the fake engine API.
import { expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import { fakeKitForIdea } from '../../src/engine/fake-kit-plans';
import type { BlueprintViewLite, OrderLite, ResultOf } from '../../src/engine/types';
async function start(idea: string) {
 const engine = new FakeEngine({ fresh: true });
 await engine.request('workspace.create', { name: 'New shop', pack: 'services' });
 await engine.request('venture.create', { idea, countryCode: 'IN' });
 await engine.request('venture.interview.answer', { questionId: 'q_1', answer: { skipped: true } });
 await engine.request('venture.interview.answer', { questionId: 'q_pricing_model', answer: { choiceId: 'monthly' } });
 await engine.request('venture.interview.answer', { questionId: 'q_price', answer: { skipped: true } });
 await engine.request('venture.interview.answer', { questionId: 'q_tax', answer: { yes: false } });
 return {engine, view: await engine.request('venture.blueprint.draft', { useTemplate: true }) as BlueprintViewLite};
}
it('does not replace a more specific flagship selection with a kit', () => {
 expect(fakeKitForIdea('long video into shorts and lead generation')).toBeNull();
 expect(fakeKitForIdea('youtube editing lead generation')?.registration.id).toBe('lead-generation');
});
