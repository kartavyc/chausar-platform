// Flagship playbooks feed the plan (playbook wiring, plan side). An idea that picks a flagship playbook (YouTube
// channel, AI-native CA firm, social media agency) plans with that playbook's own offers, summary, approvals and
// connectors, on the base service type that keeps money, invoices and books working. The instant plan, the template
// plan, the plan the AI rewrites and the plan the AI composes all keep the playbook's offer set and approvals; the AI
// only words the name, the summary, the customer line and the steps. A workspace named after the plan's own label is
// an assumption on the plan, never "told by you".
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import type { BlueprintView, ModelOutcome, ModelTask, SecretShelf, VentureDeps, VentureMethod } from '../runtime/venture/contracts.ts';
import { OFFER_REFS, type ComposedPlan } from '../runtime/venture/onboarding-contracts.ts';
import { handlers, previewPlan } from '../runtime/venture/core/index.ts';
import { OFFER_BLOCKS } from '../runtime/venture/core/blocks.ts';
import { structureFromBlueprint, structureOf } from '../runtime/venture/core/blueprint.ts';
import { CONNECTOR_CATALOGUE } from '../runtime/venture/build/catalogue.ts';
import { briefTask } from '../runtime/venture/build/brief.ts';
import { doneClaimFindings, houseStyleFindings } from '../runtime/venture/records.ts';
import { FLAGSHIP_PLANS, flagshipPlan } from '../runtime/venture/playbooks/plan.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { YOUTUBE_APPROVALS, YOUTUBE_OFFERS } from '../runtime/venture/playbooks/youtube/playbook.ts';
import { YOUTUBE_REGISTRATION } from '../runtime/venture/playbooks/youtube/registration.ts';
import { CA_APPROVALS, CA_OFFERS } from '../runtime/venture/playbooks/ca-firm/playbook.ts';
import { CA_FIRM_REGISTRATION } from '../runtime/venture/playbooks/ca-firm/registration.ts';
import { SOCIAL_APPROVALS, SOCIAL_OFFERS } from '../runtime/venture/playbooks/social/playbook.ts';
import { SOCIAL_AGENCY_REGISTRATION } from '../runtime/venture/playbooks/social/registration.ts';
import { EXCEL_COMPOSE, EXCEL_DECIDE, planEntries } from './fixtures/venture/compose-unit/plans.ts';
import { PASSPHRASE, compose, connectPair, engineFor } from './fixtures/venture/compose-unit/harness.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const YOUTUBE_IDEA = 'Run a YouTube channel that explains personal finance in plain words';
const CA_IDEA = 'An AI-native CA firm for GST filing and income tax returns in Pune';
const SOCIAL_IDEA = 'A content calendar service for yoga studios in Goa';

const youtubeOffers = ['episode-package', 'shorts-from-own-video', 'licensed-clips'].map(id => YOUTUBE_OFFERS.find(offer => offer.id === id)!);
const caOffers = ['monthly-books', 'gst-working', 'itr-salaried'].map(id => CA_OFFERS.find(offer => offer.id === id)!);
// The social agency's plan also sells the monthly report (Ink v2 wave 2), so an order for it can run the report steps.
const socialOffers = ['content-calendar', 'community-replies', 'ugc-ads', 'monthly-report'].map(id => SOCIAL_OFFERS.find(offer => offer.id === id)!);
const caApprovals = ['owner-approves-draft', 'ca-signs-regulated', 'ca-confirms-rates', 'human-files'].map(id => CA_APPROVALS.find(item => item.id === id)!.words);
const socialApprovals = ['every-draft', 'spend-before-generation', 'every-post', 'report-and-invoice'].map(id => SOCIAL_APPROVALS.find(item => item.id === id)!.when);

type Generate = (task: ModelTask<any>) => unknown;
function harness(generate: Generate | null = null, host: VentureDeps['host'] = 'test') {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store);
  const trust = new TrustService(store);
  const calculator = new CalculatorService(store);
  const secrets: SecretShelf = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false } as unknown as SecretShelf;
  const tasks: ModelTask<any>[] = [];
  const deps: VentureDeps = {
    store,
    clock: () => new Date('2026-10-21T10:00:00.000Z'),
    models: {
      generate: async (_ctx: Context, task: ModelTask<any>): Promise<ModelOutcome<any>> => {
        tasks.push(task);
        if (!generate) throw new ChausarError('NO_MODEL_CONNECTED', 'No AI in this test.');
        return { value: task.validate(generate(task)), by: 'model', callId: `call_${tasks.length}`, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '0', priceConfirmed: true };
      },
    } as unknown as VentureDeps['models'],
    services: {
      calculator: { calculate: (ctx, request) => calculator.calculate(ctx, request as any), receipt: (ctx, id) => calculator.receipt(ctx, id) },
      ontology,
      trust,
    },
    github: { kind: 'fixture', async read() { throw new ChausarError('GITHUB_READ_FAILED', 'No GitHub here.'); } },
    secrets,
    host,
    demo: true,
    storage: 'experimental-file',
  };
  const call = (method: VentureMethod, payload: unknown = {}): Promise<any> => (handlers[method] as any)(deps, owner, payload);
  return { call, tasks, store };
}

/** venture.create, the template interview answered with the pricing choice shown first, then the template plan. */
async function templatePlan(call: ReturnType<typeof harness>['call'], idea: string, workingName?: string): Promise<BlueprintView> {
  await call('venture.create', { idea, countryCode: 'IN', ...(workingName ? { workingName } : {}) });
  let view = await call('venture.interview.next', { useTemplate: true });
  for (const question of view.interview.questions) {
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id } : question.id === 'q_tax' ? { yes: false } : { skipped: true };
    view = await call('venture.interview.answer', { questionId: question.id, answer });
  }
  return call('venture.blueprint.draft', { useTemplate: true });
}

test('the instant plan for a YouTube idea is the YouTube channel playbook: its label, summary, offers, approvals and pricing', () => {
  const plan = previewPlan({ idea: YOUTUBE_IDEA, countryCode: 'IN' });
  assert.equal(plan.serviceLabel, 'YouTube channel');
  assert.deepEqual(plan.playbook, { id: 'youtube', label: 'YouTube channel' });
  assert.equal(plan.serviceType.value, 'studio', 'the studio base keeps money, invoices and books working');
  assert.equal(plan.oneLiner.value, YOUTUBE_REGISTRATION.summary);
  assert.deepEqual(plan.offers.map(offer => offer.id), ['offer_1', 'offer_2', 'offer_3']);
  assert.deepEqual(plan.offers.map(offer => offer.name.value), youtubeOffers.map(offer => offer.name));
  assert.deepEqual(plan.offers.map(offer => offer.description.value), youtubeOffers.map(offer => offer.description));
  assert.deepEqual(plan.offers.map(offer => offer.pricing.model), ['project', 'project', 'monthly']);
  assert.ok(plan.offers.every(offer => offer.pricing.unitPriceMinor === null && offer.pricing.unitPriceLabel === 'not-set'), 'no price until the owner sets one');
  assert.ok(plan.offers.every(offer => offer.name.by === 'engine' && offer.name.label === 'assumption'), 'the playbook words are fixed engine words');
  assert.deepEqual(plan.approvals.map(line => line.value), YOUTUBE_APPROVALS.map(item => item.words));
  const words = JSON.stringify(plan);
  for (const studio of ['Monthly studio plan', 'Studio hours', 'A creative studio where an agent drafts briefs and notes']) assert.ok(!words.includes(studio), studio);
  // The pricing question offers the first offer's own pricing first, so a screen that takes the first choice keeps it.
  assert.equal(plan.questions.find(q => q.id === 'q_pricing_model')!.choices[0].id, 'project');

  const hourly = previewPlan({ idea: YOUTUBE_IDEA, countryCode: 'IN', pricingModel: 'hourly' });
  assert.equal(hourly.offers[0].pricing.model, 'hourly');
  assert.equal(hourly.offers[0].name.value, 'Episode package', 'the playbook name fits any pricing');
});

test('the CA firm and social agency ideas plan with their own offers and approvals, on their base service types', () => {
  const ca = previewPlan({ idea: CA_IDEA, countryCode: 'IN' });
  assert.equal(ca.serviceLabel, 'AI-native CA firm');
  assert.equal(ca.serviceType.value, 'bookkeeping');
  assert.equal(ca.oneLiner.value, CA_FIRM_REGISTRATION.summary);
  assert.deepEqual(ca.offers.map(offer => offer.name.value), caOffers.map(offer => offer.name));
  assert.deepEqual(ca.offers.map(offer => offer.pricing.model), caOffers.map(offer => offer.pricing));
  assert.deepEqual(ca.approvals.map(line => line.value), caApprovals);

  // "content calendar" picks the social agency, so the plan is an agency even though "content" is a content keyword.
  const social = previewPlan({ idea: SOCIAL_IDEA, countryCode: 'IN' });
  assert.equal(social.serviceLabel, 'Social media agency');
  assert.equal(social.serviceType.value, 'agency');
  assert.equal(social.oneLiner.value, SOCIAL_AGENCY_REGISTRATION.summary);
  assert.deepEqual(social.offers.map(offer => offer.name.value), socialOffers.map(offer => offer.name));
  assert.deepEqual(social.offers.map(offer => offer.pricing.model), socialOffers.map(offer => offer.charge));
  assert.deepEqual(social.approvals.map(line => line.value), socialApprovals);

  const plain = previewPlan({ idea: 'Dog walking in Bandra for busy owners', countryCode: 'IN' });
  assert.equal(plain.serviceLabel, 'Service business');
  assert.equal(plain.offers.length, 2, 'a plan no playbook fits keeps the two template offers');
  assert.equal('playbook' in plain, false);
});

test('flagship plan data: three offers (four for the social agency) whose block allows their pricing, one to four approvals with a draft approval, catalogue connectors, house words', () => {
  assert.deepEqual(FLAGSHIP_PLANS.map(plan => plan.id), ['ca-firm', 'youtube', 'social-agency']);
  const catalogue = new Set(CONNECTOR_CATALOGUE.map(entry => entry.id));
  for (const plan of FLAGSHIP_PLANS) {
    assert.equal(plan.offers.length, plan.id === 'social-agency' ? 4 : 3, plan.id);
    assert.ok(plan.offers.length <= OFFER_REFS.length, `${plan.id}: every offer has an offer ref`);
    for (const offer of plan.offers) assert.ok(OFFER_BLOCKS[offer.block].allowed.includes(offer.model), `${plan.id} ${offer.key}`);
    assert.ok(plan.approvals.length >= 1 && plan.approvals.length <= 4, plan.id);
    assert.ok(plan.approvals.some(item => item.block === 'each-draft'), `${plan.id} keeps a draft approval`);
    for (const id of plan.connectors) assert.ok(catalogue.has(id), `${plan.id} ${id}`);
    for (const line of [plan.label, plan.oneLiner, ...plan.offers.flatMap(offer => [offer.name, offer.description])]) {
      assert.deepEqual(houseStyleFindings(line), [], line);
      assert.deepEqual(doneClaimFindings(line), [], line);
    }
    // Approvals say what the owner does and what Chausar never says ("never says a video was posted"), so only house style.
    for (const item of plan.approvals) assert.deepEqual(houseStyleFindings(item.words), [], item.words);
  }
  assert.equal(flagshipPlan(YOUTUBE_IDEA)?.id, 'youtube');
  assert.equal(flagshipPlan('Dog walking in Bandra'), null);
  assert.deepEqual(flagshipPlan(YOUTUBE_IDEA)!.offers.map(offer => offer.rights.length > 0), [true, true, true], 'every YouTube offer cuts footage, so each needs rights at intake');
});

test('the template plan for a YouTube idea keeps the playbook offers, approvals, summary and connectors on the studio base', async () => {
  const { call } = harness();
  const view = await templatePlan(call, YOUTUBE_IDEA);
  const plan = view.blueprint;
  assert.deepEqual(view.playbook, { id: 'youtube', label: 'YouTube channel' });
  assert.equal(plan.serviceType, 'studio');
  assert.equal(plan.oneLiner.value, YOUTUBE_REGISTRATION.summary);
  assert.deepEqual(plan.offers.map(offer => offer.name.value), youtubeOffers.map(offer => offer.name));
  assert.deepEqual(plan.offers.map(offer => offer.playbookOffer), ['episode-package', 'shorts-from-own-video', 'licensed-clips']);
  assert.deepEqual(plan.offers.map(offer => offer.pricing.model), ['project', 'project', 'monthly'], 'the first choice shown was the first offer\'s own pricing');
  assert.ok(plan.offers.every(offer => offer.pricing.unitPriceMinor === null));
  assert.deepEqual(plan.approvals.map(line => line.value), YOUTUBE_APPROVALS.map(item => item.words));
  assert.ok(plan.starterConnectorIds.includes('youtube'), 'the playbook\'s upload connector is a starter');
  assert.ok(plan.starterConnectorIds.includes('razorpay') && plan.starterConnectorIds.includes('chausar-books'), 'the payment rail and the books stay');
  assert.equal('playbook' in plan, false, 'the record carries no playbook pick of its own');
  assert.equal(plan.digest.length, 64);

  // The plan is priced and accepted like any other: the base type keeps prices and receipts working.
  const priced = await call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', unitPrice: '15000' }, { id: 'offer_3', unitPrice: '25000' }] } });
  assert.equal(priced.blueprint.offers[0].pricing.unitPriceMinor, '1500000');
  assert.equal(priced.blueprint.offers[0].name.value, 'Episode package');
  const hourly = await call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_2', pricingModel: 'hourly' }] } });
  assert.equal(hourly.blueprint.offers[1].name.value, 'Shorts from your own video', 'a new pricing model keeps the playbook name');
  assert.equal(hourly.blueprint.offers[1].playbookOffer, 'shorts-from-own-video');
  const accepted = await call('venture.blueprint.accept', { digest: hourly.blueprint.digest });
  assert.equal(accepted.blueprint.status, 'accepted');
});

test('Rewrite with AI on a flagship plan: the AI writes the name, summary, customer and steps; the offers and approvals stay the playbook\'s', async () => {
  const words = {
    name: 'Plain Money Talks', oneLiner: 'Videos that explain money in plain words, cut from footage the client owns.', customer: 'Finance creators who want a steady channel.',
    steps: [{ id: 'step_1', title: 'Read the brief and the rights' }, { id: 'step_2', title: 'Cut the footage' }, { id: 'step_3', title: 'Draft the package' }, { id: 'step_4', title: 'Send it for publishing' }],
  };
  let answer: unknown = words;
  const { call, tasks } = harness(() => answer);
  await templatePlan(call, YOUTUBE_IDEA);
  const view = await call('venture.blueprint.draft', {});
  const task = tasks.at(-1)!;
  const schema = task.schema as any;
  assert.deepEqual(Object.keys(schema.properties).sort(), ['customer', 'name', 'oneLiner', 'steps'], 'the AI is asked for no offers and no approvals');
  assert.equal((task.input as any).playbook, 'YouTube channel');
  assert.equal(view.blueprint.name.value, 'Plain Money Talks');
  assert.equal(view.blueprint.oneLiner.by, 'model');
  assert.deepEqual(view.blueprint.offers.map((offer: any) => offer.name.value), youtubeOffers.map(offer => offer.name));
  assert.deepEqual(view.blueprint.approvals.map((line: any) => line.value), YOUTUBE_APPROVALS.map(item => item.words));
  assert.ok(view.blueprint.approvals.every((line: any) => line.by === 'engine'));

  answer = { ...words, offers: [{ id: 'offer_1', name: 'Viral clips', description: 'Clips of anything.' }] };
  await assert.rejects(call('venture.blueprint.draft', {}), code('MODEL_OUTPUT_REJECTED'), 'an answer that rewrites the offers is refused');
});

test('a workspace named after the plan\'s own label is an assumption on the plan; a name the owner typed is told by you', async () => {
  const named = harness();
  const youtube = await templatePlan(named.call, YOUTUBE_IDEA, 'YouTube channel');
  assert.deepEqual([youtube.blueprint.name.value, youtube.blueprint.name.label, youtube.blueprint.name.by], ['YouTube channel', 'assumption', 'template']);

  const studio = harness();
  const plain = await templatePlan(studio.call, 'A podcast editing studio for Indian creators', 'Creative studio');
  assert.deepEqual([plain.blueprint.name.value, plain.blueprint.name.label], ['Creative studio', 'assumption'], 'the service type label is an assumption too');

  const typed = harness();
  const own = await templatePlan(typed.call, YOUTUBE_IDEA, 'Plain Money Talks');
  assert.deepEqual([own.blueprint.name.value, own.blueprint.name.label, own.blueprint.name.by], ['Plain Money Talks', 'told-by-you', 'owner']);
});

test('a composed plan for a flagship idea takes its offers and approvals from the playbook; the AI words the rest', async t => {
  const { engine } = await engineFor(t, { responses: planEntries(YOUTUBE_IDEA, EXCEL_DECIDE, EXCEL_COMPOSE) });
  await connectPair(engine);
  const { plan } = await compose(engine, YOUTUBE_IDEA, 'IN');
  assert.equal(plan.familyLabel, 'YouTube channel');
  assert.equal(plan.family.value, 'studio');
  assert.equal(plan.name.value, EXCEL_COMPOSE.name, 'the AI still names the business');
  assert.deepEqual(plan.offers.map(offer => offer.name.value), youtubeOffers.map(offer => offer.name));
  assert.deepEqual(plan.offers.map(offer => offer.block), ['package', 'package', 'retainer']);
  assert.deepEqual(plan.offers.map(offer => offer.pricing.model), ['project', 'project', 'monthly']);
  assert.deepEqual(plan.approvals.map(line => line.value), YOUTUBE_APPROVALS.map(item => item.words));

  const priced = await engine.request('venture.compose.update', { composeId: plan.composeId, patch: { offers: [{ id: 'offer_3', unitPrice: '20000' }] } }) as ComposedPlan;
  await engine.request('workspace.create', { name: 'Plain Money', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: YOUTUBE_IDEA, countryCode: 'IN', workingName: 'Plain Money', composeId: priced.composeId, composedDigest: priced.digest });
  const first = (await engine.request('venture.blueprint.get', {}) as BlueprintView).blueprint;
  assert.equal(first.serviceType, 'studio');
  assert.deepEqual(first.offers.map(offer => offer.name.value), youtubeOffers.map(offer => offer.name));
  assert.deepEqual(first.offers.map(offer => offer.playbookOffer), ['episode-package', 'shorts-from-own-video', 'licensed-clips']);
  assert.deepEqual(first.offers.map(offer => offer.pricing.unitPriceMinor), [null, null, '2000000']);
  assert.deepEqual(first.approvals.map(line => line.value), YOUTUBE_APPROVALS.map(item => item.words));
  assert.ok(first.starterConnectorIds.includes('youtube'));
  const state = engine.vault!.read();
  const record = (kind: string) => state.conversations.find((item: any) => item.kind === kind);
  assert.deepEqual(structureOf(record('venture-record'), record('venture-interview'), record('venture-composition')), structureFromBlueprint(first));
  // The composed plan and the plan it becomes list the playbook's own delivery steps, the ones that run.
  assert.deepEqual(titles(plan.flagshipSteps), stepsOf('youtube'));
  assert.deepEqual(first.flagshipSteps, plan.flagshipSteps);
  // The builder brief describes the same steps the owner accepted.
  const brief = briefTask(record('venture-record') as any, first as any, () => ({}) as any);
  assert.deepEqual((brief.input as { steps: string[] }).steps, first.flagshipSteps!.map(step => step.title.value));
});

test('a composed social agency plan keeps all four playbook offers, the monthly report fourth, each priced by the owner', async t => {
  const { engine } = await engineFor(t, { responses: planEntries(SOCIAL_IDEA, EXCEL_DECIDE, EXCEL_COMPOSE) });
  await connectPair(engine);
  const { plan } = await compose(engine, SOCIAL_IDEA, 'IN');
  assert.deepEqual(plan.offers.map(offer => offer.id), ['offer_1', 'offer_2', 'offer_3', 'offer_4']);
  assert.deepEqual(plan.offers.map(offer => offer.playbookOffer), ['content-calendar', 'community-replies', 'ugc-ads', 'monthly-report']);
  assert.deepEqual(plan.offers.map(offer => offer.name.value), socialOffers.map(offer => offer.name));
  assert.ok(plan.offers.every(offer => OFFER_BLOCKS[offer.block].allowed.includes(offer.pricing.model)));
  const priced = await engine.request('venture.compose.update', { composeId: plan.composeId, patch: { offers: [{ id: 'offer_4', unitPrice: '5000' }] } }) as ComposedPlan;
  await engine.request('workspace.create', { name: 'Goa Yoga', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: SOCIAL_IDEA, countryCode: 'IN', workingName: 'Goa Yoga', composeId: priced.composeId, composedDigest: priced.digest });
  const first = (await engine.request('venture.blueprint.get', {}) as BlueprintView).blueprint;
  assert.deepEqual(first.offers.map(offer => offer.playbookOffer), ['content-calendar', 'community-replies', 'ugc-ads', 'monthly-report']);
  assert.deepEqual(first.offers.map(offer => offer.pricing.unitPriceMinor), [null, null, null, '500000']);
});

/** The steps a flagship playbook delivers with, as the plan lists them: its own titles and who does each. */
function stepsOf(id: string) {
  return flagshipDelivery(id)!.steps.map(step => ({ id: step.id, title: { value: step.title, label: 'assumption', by: 'engine' } }));
}
const who = (steps: { id: string; doneBy: string; who: string }[] | undefined, id: string) => {
  const step = steps?.find(item => item.id === id);
  return step ? `${step.doneBy}: ${step.who}` : 'missing';
};
const titles = (steps: { id: string; title: unknown }[] | undefined) => steps?.map(step => ({ id: step.id, title: step.title }));

test('the plan lists the flagship playbook\'s own delivery steps with who does each, so what the owner accepts is what runs', async () => {
  const preview = previewPlan({ idea: YOUTUBE_IDEA, countryCode: 'IN' });
  assert.deepEqual(titles(preview.flagshipSteps), stepsOf('youtube'));
  assert.equal(who(preview.flagshipSteps, 'intake'), 'agent: Intake clerk');
  assert.equal(who(preview.flagshipSteps, 'package'), 'agent: Packager');
  assert.equal(who(preview.flagshipSteps, 'probe'), 'code: Chausar');
  assert.equal(who(preview.flagshipSteps, 'review'), 'you: You');
  assert.equal(who(preview.flagshipSteps, 'publish'), 'you: You');

  const ca = previewPlan({ idea: CA_IDEA, countryCode: 'IN' });
  assert.deepEqual(titles(ca.flagshipSteps), stepsOf('ca-firm'));
  // The agent picks the rule and the inputs; the calculator's tools work the figures (W2 2A1).
  assert.equal(who(ca.flagshipSteps, 'compute'), 'agent: Tax preparer');
  assert.equal(who(ca.flagshipSteps, 'approve'), 'you: You');
  assert.equal(who(ca.flagshipSteps, 'ca-signoff'), 'person: CA of record');
  assert.equal(who(ca.flagshipSteps, 'file'), 'person: The CA or the client');
  const social = previewPlan({ idea: SOCIAL_IDEA, countryCode: 'IN' });
  assert.deepEqual(titles(social.flagshipSteps), stepsOf('social-agency'));
  assert.equal(who(social.flagshipSteps, 'drafts'), 'agent: Writer');
  assert.equal(who(social.flagshipSteps, 'collect-exports'), 'person: Your client');
  assert.equal(who(social.flagshipSteps, 'figures'), 'code: Chausar');
  for (const plan of [preview, ca, social]) for (const step of plan.flagshipSteps!) assert.deepEqual(houseStyleFindings(step.title.value), [], step.title.value);
  assert.equal('flagshipSteps' in previewPlan({ idea: 'Dog walking in Bandra for busy owners', countryCode: 'IN' }), false, 'a plain plan keeps its four steps only');

  // The template plan keeps them through a price change and acceptance; the delivery runs exactly these steps.
  const { call } = harness();
  const view = await templatePlan(call, YOUTUBE_IDEA);
  assert.deepEqual(view.blueprint.flagshipSteps, preview.flagshipSteps);
  const priced = await call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', unitPrice: '15000' }] } });
  assert.deepEqual(priced.blueprint.flagshipSteps, preview.flagshipSteps);
  const accepted = await call('venture.blueprint.accept', { digest: priced.blueprint.digest });
  assert.deepEqual(accepted.blueprint.flagshipSteps!.map((step: any) => step.id), flagshipDelivery('youtube')!.steps.map(step => step.id));

  // Rewrite with AI never touches them.
  const words = {
    name: 'Plain Money Talks', oneLiner: 'Videos that explain money in plain words.', customer: 'Finance creators.',
    steps: [{ id: 'step_1', title: 'Read the brief' }, { id: 'step_2', title: 'Cut the footage' }, { id: 'step_3', title: 'Draft the package' }, { id: 'step_4', title: 'Send it' }],
  };
  const ai = harness(() => words);
  await templatePlan(ai.call, YOUTUBE_IDEA);
  const rewritten = await ai.call('venture.blueprint.draft', {});
  assert.deepEqual(rewritten.blueprint.flagshipSteps, preview.flagshipSteps);

  const plain = harness();
  const plainView = await templatePlan(plain.call, 'Dog walking in Bandra for busy owners');
  assert.equal('flagshipSteps' in plainView.blueprint, false);
});

test('the plan says what an order for each flagship offer asks at intake: the rights it accepts and the other fields its checks read', async () => {
  const youtube = harness();
  const view = await templatePlan(youtube.call, YOUTUBE_IDEA);
  const fields = ['format', 'aiVoice', 'aiPresenter', 'paidPromotion', 'cutFile'];
  assert.deepEqual(view.intake, {
    offer_1: { rights: ['own-footage', 'licence'], fields },
    offer_2: { rights: ['own-footage'], fields },
    offer_3: { rights: ['licence', 'creator-clip-programme'], fields },
  });
  assert.deepEqual((await youtube.call('venture.blueprint.get', {})).intake, view.intake);

  // The hosted server reads no cut from the owner's computer, so it never asks for one.
  const hosted = harness(null, 'hosted-web');
  const hostedView = await templatePlan(hosted.call, YOUTUBE_IDEA);
  assert.deepEqual(hostedView.intake!.offer_1, { rights: ['own-footage', 'licence'], fields: ['format', 'aiVoice', 'aiPresenter', 'paidPromotion'] });

  const social = harness();
  const socialView = await templatePlan(social.call, SOCIAL_IDEA);
  // Every social offer reads the client's word lists (Ink v2 wave 2); only the content calendar asks for its calendar.
  assert.deepEqual(socialView.intake!.offer_1, { rights: [], fields: ['aiVoice', 'aiPresenter', 'paidPromotion', 'calendar', 'clientRules'] });
  for (const id of ['offer_2', 'offer_3']) assert.deepEqual(socialView.intake![id], { rights: [], fields: ['aiVoice', 'aiPresenter', 'paidPromotion', 'clientRules'] }, id);
  // The monthly report has no posts, so it asks no post disclosures; its words are still checked against the client's lists.
  assert.deepEqual(socialView.intake!.offer_4, { rights: [], fields: ['clientRules'] });
  assert.deepEqual(socialView.blueprint.offers.map(offer => offer.playbookOffer), ['content-calendar', 'community-replies', 'ugc-ads', 'monthly-report']);
  assert.equal(socialView.blueprint.offers[3].pricing.unitPriceMinor, null, 'the owner sets its price, like every other offer');

  const ca = harness();
  assert.equal('intake' in await templatePlan(ca.call, CA_IDEA), false, 'a CA firm order asks nothing at intake');
  const plain = harness();
  assert.equal('intake' in await templatePlan(plain.call, 'Dog walking in Bandra for busy owners'), false);
});
