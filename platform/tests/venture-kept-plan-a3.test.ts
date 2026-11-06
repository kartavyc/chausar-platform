// One-shot A3 (S1 in the W6 hands-on report): the AI-written plan is the plan that is kept. Through the real engine and
// the owner's connected AI: About you reads the owner's words, the card shows its offers and the name the owner kept,
// and "Keep this plan" makes the business and its first plan from exactly that card. The plan page (venture.blueprint.get),
// the business (venture.get) and Today (venture.queue.list) then show that name and those offers, labelled as the AI's
// words, and none of the field template's offers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES } from '../runtime/venture/core/families.ts';
import { engineFor, connectPair, PASSPHRASE } from './fixtures/venture/compose-unit/harness.ts';
import { anthropicEntry } from './fixtures/venture/compose-unit/plans.ts';

const WORDS = 'I run a small weekend photography studio in Pune. Birthday parties, product photos for shops, and a monthly plan for shops.';
const AI = {
  familyId: 'creative',
  offers: [
    { name: 'Birthday party photography', line: 'Candid photos of the party, edited and shared.' },
    { name: 'Shop product photos', line: 'Clean photos of what a shop sells.' },
    { name: 'Monthly photo support', line: 'Fresh photos for a shop every month.' },
  ],
  countryCode: 'IN', evidence: 'studio in Pune',
};
const NAME = 'Pune Frames Studio';

/** The template interview answered as the first run answers it (places/onboarding/flow.ts answerFor). */
async function interview(engine: { request(method: string, payload?: unknown): Promise<any> }) {
  let view = await engine.request('venture.interview.next', { useTemplate: true });
  const asked = new Set<string>();
  for (let guard = 0; guard < 12; guard++) {
    const question = view.interview.questions.find((q: any) => q.answer === null && !asked.has(q.id));
    if (!question) break;
    asked.add(question.id);
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id }
      : question.id === 'q_tax' ? { yes: false, assumed: true }
        : question.id === 'q_tax_rate' ? { rate: question.prefill }
          : { skipped: true };
    view = await engine.request('venture.interview.answer', { questionId: question.id, answer });
  }
}

test('A3 S1: Keep this plan keeps the AI card: its name and offers reach the plan page, the business and Today', async t => {
  const { engine } = await engineFor(t, { responses: [anthropicEntry('decide', AI, [WORDS, 'familyId', 'untrusted'])] });
  await connectPair(engine);
  const read = await engine.request('venture.about.read', { text: WORDS }) as any;
  assert.equal(read.source, 'ai');
  assert.deepEqual(read.offers, AI.offers);
  // The card the owner saw: the AI's offers, and the name they kept.
  const card = { name: NAME, by: 'model', callId: read.callId, offers: read.offers.map((offer: any) => ({ name: offer.name, line: offer.line })) };

  await engine.request('workspace.create', { name: NAME, passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: read.idea, countryCode: 'IN', workingName: NAME });
  await interview(engine);
  await engine.request('venture.blueprint.draft', { useTemplate: true, shown: card });

  // The plan page.
  const plan = (await engine.request('venture.blueprint.get', {}) as any).blueprint;
  assert.equal(plan.name.value, NAME);
  assert.deepEqual(plan.offers.map((offer: any) => offer.name.value), AI.offers.map(offer => offer.name), 'exactly the card offers, in order');
  assert.equal(plan.source, 'model', 'labelled as the AI\'s words, not "Written from built-in templates"');
  const template = FAMILIES.find(family => family.id === 'creative')!.offers.map(offer => offer.name);
  for (const offer of plan.offers) assert.ok(!template.includes(offer.name.value), `${offer.name.value} is not a template offer`);
  assert.ok(!JSON.stringify(plan).includes('Creative studio'), 'the field name is not the plan\'s name');

  // The business.
  const business = await engine.request('venture.get', {}) as any;
  assert.equal(business.venture.workingName, NAME);

  // Today: the plan waits for the owner under that name.
  const today = await engine.request('venture.queue.list', {}) as any;
  const row = today.rows.find((item: any) => item.kind === 'plan');
  assert.ok(row, 'the kept plan waits on Today');
  assert.equal(row.title, 'Your plan is ready. Read it.');
  assert.equal(row.businessName, NAME);
});
