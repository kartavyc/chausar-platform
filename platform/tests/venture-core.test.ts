// P1 core tests: countries, the classifier, the instant plan, the venture record, interview, blueprint, terms,
// the checklist and events. Harness: VentureTestStore (refuses nested writes like the vault), the real ontology,
// trust and calculator services, and a stub model port fed by hand-written fixtures (synthetic recordings).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { gstinValid } from '../runtime/memory.ts';
import {
  OFFER_IDS, SECOND_OFFER_MODEL, SERVICE_TYPES, STEP_IDS, STEP_PLAN, VENTURE_ERRORS,
  type AnyVentureRecord, type ModelOutcome, type ModelPort, type ModelPurpose, type ModelTask, type SecretShelf,
  type VentureDeps, type VentureMethod, type VentureRecordKind,
} from '../runtime/venture/contracts.ts';
import { assertNoNumbers, digest, doneClaimFindings, houseStyleFindings, ventureAction } from '../runtime/venture/records.ts';
import { handlers, listCountries, previewPlan } from '../runtime/venture/core/index.ts';
import { classifyIdea, offerWords, serviceTemplate, templateStrings } from '../runtime/venture/core/service-types.ts';
import { BLUEPRINT_INSTRUCTIONS, blueprintDigest, structureFromBlueprint } from '../runtime/venture/core/blueprint.ts';
import { validateInterviewOutput } from '../runtime/venture/core/interview.ts';
import { VentureTestStore } from './venture-test-store.ts';

const FIXED_NOW = '2026-10-15T10:00:00.000Z'; // at or before real time (rule 23)
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const CAFE_IDEA = 'Monthly bookkeeping for cafes and small shops in Pune, done by AI helpers with me checking every report.';

function fixture(name: string): unknown {
  const text = readFileSync(new URL(`./fixtures/venture/core/${name}.json`, import.meta.url), 'utf8');
  const parsed = JSON.parse(text);
  assert.equal(parsed.label, 'synthetic recording');
  return parsed.output;
}

type StubPort = ModelPort & {
  asked: ModelTask<unknown>[];
  fixtures: Partial<Record<ModelPurpose, unknown>>;
  before: ((task: ModelTask<unknown>) => Promise<void>) | null;
};

/** generate returns the fixture for the task's purpose (validated by the task), or the task's template. */
function stubPort(): StubPort {
  const notHere = () => { throw new ChausarError('NOT_BUILT_YET', 'The stub port only generates.'); };
  const port: StubPort = {
    asked: [],
    fixtures: {},
    before: null,
    status: notHere,
    presets: notHere,
    async checkCli() { notHere(); },
    async generate<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
      port.asked.push(task as ModelTask<unknown>);
      if (port.before) await port.before(task as ModelTask<unknown>);
      const raw = port.fixtures[task.purpose];
      if (raw === undefined) {
        assert.ok(task.template, 'a task without a fixture needs a template');
        return { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
      }
      const value = task.validate(structuredClone(raw));
      return { value, by: 'model', callId: `modelcall_stub_${port.asked.length}`, presetId: 'anthropic-haiku-5-5', model: 'claude-haiku-5-5', costMicros: '164', priceConfirmed: true };
    },
    async preview() { return notHere(); },
    async runPreview() { return notHere(); },
  };
  return port;
}

function shelf(): SecretShelf {
  const map = new Map<string, string>();
  return { get: name => map.get(name) ?? null, set: (name, value) => { map.set(name, value); }, delete: name => { map.delete(name); }, has: name => map.has(name), clear: () => map.clear() };
}

function setup() {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store);
  const trust = new TrustService(store);
  const calculator = new CalculatorService(store);
  const models = stubPort();
  const deps: VentureDeps = {
    store,
    clock: () => new Date(FIXED_NOW),
    models,
    services: {
      calculator: { calculate: (ctx, request) => calculator.calculate(ctx, request as any), receipt: (ctx, id) => calculator.receipt(ctx, id) },
      ontology,
      trust,
    },
    github: { kind: 'fixture', async read() { throw new ChausarError('GITHUB_READ_FAILED', 'No GitHub in the core tests.'); } },
    secrets: shelf(),
    host: 'test',
    demo: true,
    storage: 'experimental-file',
  };
  const call = (method: VentureMethod, payload: unknown = {}, ctx: Context = owner): Promise<any> => {
    const handler = handlers[method] as ((d: VentureDeps, c: Context, p: unknown) => Promise<any>) | undefined;
    assert.ok(handler, `core handles ${method}`);
    return handler(deps, ctx, payload);
  };
  const seed = (kind: VentureRecordKind, fields: Record<string, unknown>): Promise<any> =>
    ventureAction(deps, owner, 'admin', 'test.seed', tx => tx.put({ ...tx.base(kind), ...fields } as unknown as AnyVentureRecord));
  return { store, deps, models, ontology, trust, call, seed };
}

type Harness = ReturnType<typeof setup>;

const codeOf = (code: string) => (error: unknown) => { assert.equal((error as ChausarError).code, code); return true; };

async function answer(h: Harness, questionId: string, given: Record<string, unknown>) {
  return h.call('venture.interview.answer', { questionId, answer: given });
}

/** Creates a venture, runs the template interview and answers it in screen order. */
async function interviewed(h: Harness, options: { country?: string; idea?: string; price?: string | null; tax?: boolean; rate?: string; model?: string; workingName?: string } = {}) {
  await h.call('venture.create', { idea: options.idea ?? CAFE_IDEA, countryCode: options.country ?? 'IN', workingName: options.workingName ?? 'Ledger Cafe Books' });
  await h.call('venture.interview.next', { useTemplate: true });
  await answer(h, 'q_1', { skipped: true });
  await answer(h, 'q_2', { skipped: true });
  await answer(h, 'q_pricing_model', { choiceId: options.model ?? 'monthly' });
  await answer(h, 'q_price', options.price === null ? { skipped: true } : { amount: options.price ?? '2,499' });
  let view = await answer(h, 'q_tax', { yes: options.tax ?? true });
  if (options.tax ?? true) view = await answer(h, 'q_tax_rate', { rate: options.rate ?? '18' });
  return view;
}

// ---------------------------------------------------------------------------

test('1. listCountries: fifteen rows with the pinned tax and currency facts', () => {
  const rows = listCountries();
  assert.equal(rows.length, 15);
  assert.equal(new Set(rows.map(r => r.code)).size, 15);
  assert.deepEqual(rows.map(r => r.code), ['IN', 'US', 'GB', 'CA', 'AU', 'NZ', 'SG', 'AE', 'DE', 'FR', 'NL', 'IE', 'ZA', 'JP', 'XX']);
  const india = rows.find(r => r.code === 'IN')!;
  assert.equal(india.currency, 'INR');
  assert.equal(india.tax.mode, 'gst');
  assert.equal(india.tax.standardRateBps, '1800');
  assert.equal(india.minorDigits, 2);
  assert.equal(india.tax.idLabel, 'GSTIN');
  assert.equal(india.tax.idPattern, null);
  assert.equal(india.tax.invoiceKind, 'tax-invoice');
  assert.equal(india.region, 'india');
  assert.equal(india.complianceNotes.length, 3);
  const japan = rows.find(r => r.code === 'JP')!;
  assert.equal(japan.minorDigits, 0);
  assert.equal(japan.tax.idPattern, '^T\\d{13}$');
  assert.ok(new RegExp(japan.tax.idPattern!).test('T1234567890123'));
  for (const code of ['US', 'XX']) assert.equal(rows.find(r => r.code === code)!.tax.invoiceKind, 'invoice');
  assert.equal(rows.find(r => r.code === 'XX')!.tax.mode, 'none');
  for (const row of rows) {
    assert.equal(row.tax.checkedOn, '2026-10-15');
    assert.equal(row.region, row.code === 'IN' ? 'india' : 'global');
    assert.ok(row.paymentRails.length === 3);
    assert.deepEqual(houseStyleFindings(row.tax.registrationNote), []);
  }
  // A deep copy every time: changing one result never changes the next.
  rows[0].tax.label = 'changed';
  assert.equal(listCountries()[0].tax.label, 'GST');
});

test('2. classifyIdea picks the type with the most keyword hits, ties to the earlier type', () => {
  const cases: [string, string][] = [
    ['Monthly bookkeeping for cafes', 'bookkeeping'],
    ['podcast editing studio', 'studio'],
    ['lead lists for SaaS founders', 'research'],
    ['blog posts for dentists', 'content'],
    ['inbox support for online shops', 'support'],
    ['marketing agency for gyms', 'agency'],
    ['career coaching', 'consulting'],
    ['dog walking', 'other'],
    // bookkeeping (bookkeep) and research (report) tie at one hit each; bookkeeping is listed first.
    [CAFE_IDEA, 'bookkeeping'],
  ];
  for (const [idea, type] of cases) assert.equal(classifyIdea(idea), type, idea);
});

test('3. previewPlan: an instant template plan with nothing saved and no store', () => {
  const plan = previewPlan({ idea: 'Monthly bookkeeping for cafes in Pune', countryCode: 'IN' });
  assert.equal(plan.serviceType.value, 'bookkeeping');
  assert.deepEqual({ label: plan.serviceType.label, by: plan.serviceType.by }, { label: 'assumption', by: 'template' });
  assert.equal(plan.serviceLabel, 'Bookkeeping studio');
  assert.equal(plan.saved, false);
  assert.equal(plan.by, 'template');
  assert.deepEqual(plan.deliverySteps.map(s => ({ id: s.id, doneBy: s.doneBy, capability: s.capability, note: s.note })), STEP_PLAN.map(s => ({ ...s })));
  assert.deepEqual(plan.offers.map(o => o.id), [...OFFER_IDS]);
  assert.equal(plan.offers[0].pricing.model, 'monthly');
  assert.equal(plan.offers[1].pricing.model, SECOND_OFFER_MODEL.bookkeeping);
  assert.ok(plan.offers.every(o => o.pricing.unitPriceMinor === null && o.pricing.unitPriceLabel === 'not-set'));
  assert.deepEqual(plan.backOffice.taxRegistered, { value: false, label: 'assumption', by: 'engine' });
  assert.equal(plan.backOffice.taxRateBps, '0');
  assert.equal(plan.backOffice.taxRateBy, 'not-registered');
  assert.equal(plan.backOffice.invoiceKind, 'tax-invoice');
  assert.equal(plan.backOffice.taxInvoiceReady, false);
  assert.deepEqual(plan.backOffice.taxInvoiceMissing, []);
  assert.deepEqual(plan.questions.map(q => q.id), ['q_1', 'q_2', 'q_pricing_model', 'q_price', 'q_tax', 'q_tax_rate']);
  assert.equal(plan.questions.find(q => q.id === 'q_tax_rate')!.prefill, '18');
  assert.equal(plan.approvals.length, 2);

  const us = previewPlan({ idea: 'Inbox support for small online shops', countryCode: 'US' });
  assert.equal(us.questions.find(q => q.id === 'q_tax_rate')!.prefill, null);
  assert.equal(us.questions.find(q => q.id === 'q_tax')!.text, 'Do you charge sales tax on your invoices?');
  assert.equal(us.backOffice.invoiceKind, 'invoice');

  assert.throws(() => previewPlan({ idea: 'Monthly bookkeeping for cafes', countryCode: 'ZZ' }), codeOf('UNKNOWN_COUNTRY'));
  assert.throws(() => previewPlan({ idea: 'Monthly bookkeeping for cafes', countryCode: 'IN', extra: true }), codeOf('INVALID_VENTURE_REQUEST'));
  assert.throws(() => previewPlan({ idea: 'too short', countryCode: 'IN' }), codeOf('INVALID_VENTURE_REQUEST'));
  assert.throws(() => previewPlan({ idea: 'Monthly bookkeeping for cafes' }), codeOf('INVALID_VENTURE_REQUEST'));
});

test('4. venture.create sets retention and the dictionary currency, once per workspace', async () => {
  // A fresh IN workspace with an INR dictionary already published: no republish.
  const india = setup();
  await india.ontology.publish(owner, 'services');
  assert.equal(india.ontology.current(owner)!.version, 1);
  const view = await india.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  assert.equal(view.venture.country.code, 'IN');
  assert.equal(view.venture.status, 'interview');
  assert.equal(view.venture.launchStage, 'rehearsal');
  assert.equal(view.venture.ideaDigest, digest(CAFE_IDEA));
  assert.equal(view.venture.serviceType, null);
  assert.equal(view.venture.invoiceSequence, 0);
  assert.equal(view.done, 1);
  assert.equal(view.total, 12);
  assert.equal(view.next.item, 'ai', 'onboarding connects an AI first, so the AI item leads the checklist');
  assert.equal(india.trust.get(owner).retentionDays, 3650);
  assert.equal(india.ontology.current(owner)!.version, 1);
  assert.equal(india.ontology.current(owner)!.currency, 'INR');
  const events = (await india.call('venture.events', {})).events;
  assert.deepEqual(events.map((e: any) => e.name), ['venture-created', 'retention-changed']);
  assert.deepEqual(events[0].data, { countryCode: 'IN', currency: 'INR' });
  assert.deepEqual(events[1].data, { from: 90, to: 3650 });
  const interview = india.store.read().conversations.find((r: any) => r.kind === 'venture-interview');
  assert.deepEqual(interview.serviceType, { value: 'bookkeeping', label: 'assumption', by: 'template' });
  assert.deepEqual(interview.questions, []);
  // One business per workspace.
  await assert.rejects(india.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN' }), codeOf('VENTURE_EXISTS'));

  // US over an INR dictionary with no facts: republished in USD, unregistered GST mode as a label only.
  const us = setup();
  await us.ontology.publish(owner, 'services');
  const usView = await us.call('venture.create', { idea: 'Inbox support for small online shops', countryCode: 'US' });
  assert.equal(usView.venture.workingName, 'My service business');
  const dictionary = us.ontology.current(owner)!;
  assert.equal(dictionary.version, 2);
  assert.equal(dictionary.currency, 'USD');
  assert.equal(dictionary.gstMode, 'unregistered');
  assert.ok(dictionary.definitions.every((d: any) => d.currency === 'USD'));

  // A fresh vault with no dictionary gets one in the country's currency.
  const fresh = setup();
  await fresh.call('venture.create', { idea: 'Podcast editing studio for creators', countryCode: 'GB' });
  assert.equal(fresh.ontology.current(owner)!.currency, 'GBP');

  const bad = setup();
  await assert.rejects(bad.call('venture.create', { idea: CAFE_IDEA, countryCode: 'ZZ' }), codeOf('UNKNOWN_COUNTRY'));
  await assert.rejects(bad.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN', workingName: 'Ledger\nCafe' }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(bad.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN', extra: 1 }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(bad.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN' }, { ...owner, channel: 'phone' }), codeOf('APP_APPROVAL_REQUIRED'));
  assert.equal(bad.store.read().conversations.length, 0);
  assert.equal(bad.trust.get(owner).retentionDays, 90);

  // Books already kept in INR cannot switch to USD.
  const conflict = setup();
  await conflict.ontology.publish(owner, 'services');
  await conflict.store.update(state => {
    state.facts.push({ id: 'fact_seed', entityId: 'inv_seed', sourceId: 'seed', sourceRow: 1, kind: 'invoice', validFrom: '2026-09-01', validTo: null, learnedAt: '2026-09-01T00:00:00.000Z', supersededAt: null, fields: { amountMinor: '100', currency: 'INR' } });
  });
  await assert.rejects(conflict.call('venture.create', { idea: 'Inbox support for small online shops', countryCode: 'US' }), (error: any) => {
    assert.equal(error.code, 'CURRENCY_CONFLICT');
    assert.equal(error.message, 'This workspace already keeps books in INR.');
    return true;
  });
  assert.equal(conflict.trust.get(owner).retentionDays, 90, 'refused before any write');
  assert.equal(conflict.ontology.current(owner)!.version, 1);
});

test('5. template interview: every country asks about tax; prices and rates are parsed by code', async () => {
  const h = setup();
  await h.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN' });
  let view = await h.call('venture.interview.next', { useTemplate: true });
  assert.equal(h.models.asked.length, 0);
  assert.deepEqual(view.interview.questions.map((q: any) => q.id), ['q_1', 'q_2', 'q_pricing_model', 'q_price', 'q_tax']);
  assert.equal(view.interview.source, 'template');
  assert.ok(view.interview.questions.every((q: any) => q.answer === null));
  assert.equal(view.next.id, 'q_1');
  assert.equal(view.done, false);
  assert.equal(view.limit, 6);
  // Asking again returns the same questions.
  const again = await h.call('venture.interview.next', {});
  assert.deepEqual(again.interview.questions.map((q: any) => q.id), view.interview.questions.map((q: any) => q.id));
  assert.equal(h.models.asked.length, 0);

  await answer(h, 'q_1', { skipped: true });
  view = await answer(h, 'q_2', { skipped: true });
  assert.equal(view.asked, 2);
  await assert.rejects(answer(h, 'q_pricing_model', { skipped: true }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(answer(h, 'q_tax', { skipped: true }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(answer(h, 'q_pricing_model', { choiceId: 'weekly' }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(answer(h, 'q_pricing_model', { text: 'monthly' }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(answer(h, 'q_pricing_model', { choiceId: 'monthly', text: 'x' }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(answer(h, 'q_nope', { skipped: true }), codeOf('QUESTION_NOT_FOUND'));

  view = await answer(h, 'q_pricing_model', { choiceId: 'hourly' });
  assert.equal(view.interview.questions.find((q: any) => q.id === 'q_price').text, 'What will you charge for one hour, in INR? You can change it later.');
  view = await answer(h, 'q_pricing_model', { choiceId: 'monthly' });
  assert.equal(view.interview.questions.find((q: any) => q.id === 'q_price').text, 'What will you charge for one month, in INR? You can change it later.');

  // INR has two minor digits: 2,499 rupees is 2499 x 100 = 249900 paise.
  view = await answer(h, 'q_price', { amount: '2,499' });
  const price = view.interview.questions.find((q: any) => q.id === 'q_price');
  assert.equal(price.answerMinor, '249900');
  assert.deepEqual(price.answer, { amount: '2499' });
  // Three decimals is a fraction of a paisa.
  await assert.rejects(answer(h, 'q_price', { amount: '2499.505' }), codeOf('INVALID_AMOUNT'));
  await assert.rejects(answer(h, 'q_price', { amount: '0' }), codeOf('INVALID_AMOUNT'));
  await assert.rejects(answer(h, 'q_price', { amount: '-5' }), codeOf('INVALID_AMOUNT'));

  view = await answer(h, 'q_tax', { yes: true });
  const rate = view.interview.questions.find((q: any) => q.id === 'q_tax_rate');
  assert.ok(rate);
  assert.equal(rate.prefill, '18');
  assert.equal(rate.required, true);
  assert.equal(view.done, false);
  assert.equal(view.next.id, 'q_tax_rate');
  await assert.rejects(answer(h, 'q_tax_rate', { rate: '101' }), codeOf('INVALID_TAX_RATE'));
  await assert.rejects(answer(h, 'q_tax_rate', { skipped: true }), codeOf('INVALID_VENTURE_REQUEST'));
  view = await answer(h, 'q_tax_rate', { rate: '18' });
  assert.equal(view.interview.questions.find((q: any) => q.id === 'q_tax_rate').answerBps, '1800');
  assert.equal(view.done, true);
  assert.equal(view.next, null);
  assert.equal(view.asked, 6);

  // A no removes the rate question; a yes brings it back unanswered.
  view = await answer(h, 'q_tax', { yes: false });
  assert.equal(view.interview.questions.some((q: any) => q.id === 'q_tax_rate'), false);
  assert.equal(view.done, true);
  view = await answer(h, 'q_tax', { yes: true });
  assert.equal(view.interview.questions.find((q: any) => q.id === 'q_tax_rate').answer, null);
  assert.equal(view.done, false);
  view = await answer(h, 'q_tax_rate', { rate: ' 8.25 %' });
  assert.equal(view.interview.questions.find((q: any) => q.id === 'q_tax_rate').answerBps, '825');
  assert.equal(view.done, true);

  // Every country asks about tax; the US has no rate to prefill.
  const us = setup();
  await us.call('venture.create', { idea: 'Inbox support for small online shops', countryCode: 'US' });
  const usView = await us.call('venture.interview.next', { useTemplate: true });
  assert.deepEqual(usView.interview.questions.map((q: any) => q.id), ['q_1', 'q_2', 'q_pricing_model', 'q_price', 'q_tax']);
  assert.equal(usView.interview.questions.find((q: any) => q.id === 'q_tax').text, 'Do you charge sales tax on your invoices?');
  const usTax = await answer(us, 'q_tax', { yes: true });
  assert.equal(usTax.interview.questions.find((q: any) => q.id === 'q_tax_rate').prefill, null);

  // JPY has no minor unit: 5000 yen is 5000.
  const jp = setup();
  await jp.call('venture.create', { idea: 'Video editing studio for small brands', countryCode: 'JP' });
  await jp.call('venture.interview.next', { useTemplate: true });
  const yen = await answer(jp, 'q_price', { amount: '5000' });
  assert.equal(yen.interview.questions.find((q: any) => q.id === 'q_price').answerMinor, '5000');
  await assert.rejects(answer(jp, 'q_price', { amount: '5000.5' }), codeOf('INVALID_AMOUNT'));
  assert.equal(jp.store.read().conversations.find((r: any) => r.kind === 'venture-interview').questions.find((q: any) => q.id === 'q_tax').text,
    'Are you registered for consumption tax, so you charge it on your invoices?');
});

test('6. model interview: model questions are checked words; an amount of money is refused and nothing is stored', async () => {
  // A number the model wrote is allowed since 21 October (a model estimate, never a receipt).
  const digits = setup();
  await digits.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN' });
  digits.models.fixtures.interview = fixture('interview-digit');
  const counted = await digits.call('venture.interview.next', {});
  assert.equal(counted.interview.questions[0].text, 'Will you start with 5 cafes or more?');

  const h = setup();
  await h.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN' });
  const digit = fixture('interview-digit') as { questions: { text: string }[] };
  h.models.fixtures.interview = { ...digit, questions: [{ ...digit.questions[0], text: 'Will you charge INR 500 a month or more?' }] };
  await assert.rejects(h.call('venture.interview.next', {}), codeOf('MODEL_OUTPUT_REJECTED'));
  const stored = () => h.store.read().conversations.find((r: any) => r.kind === 'venture-interview');
  assert.deepEqual(stored().questions, []);

  h.models.fixtures.interview = fixture('interview-model');
  const view = await h.call('venture.interview.next', {});
  const task = h.models.asked[h.models.asked.length - 1];
  assert.equal(task.purpose, 'interview');
  assert.equal(task.containsClientData, false);
  assert.equal(task.schemaName, 'venture-interview');
  assert.equal(task.maxOutputTokens, 2048);
  assert.equal((task.input as any).idea, CAFE_IDEA);
  assert.equal((task.input as any).country, 'India');
  assert.equal((task.input as any).currency, 'INR');
  assert.deepEqual((task.input as any).serviceTypes, [...SERVICE_TYPES]);
  assert.ok(!JSON.stringify(task.schema).includes('"number"') && !JSON.stringify(task.schema).includes('"integer"'));
  const [first, second] = view.interview.questions;
  assert.equal(first.id, 'q_1');
  assert.equal(first.by, 'model');
  assert.equal(first.required, false);
  assert.deepEqual(first.choices, [{ id: 'c_1', label: 'Cafes and small restaurants' }, { id: 'c_2', label: 'Small shops' }, { id: 'c_3', label: 'Freelancers' }]);
  assert.equal(second.id, 'q_2');
  assert.equal(second.by, 'model');
  assert.equal(second.kind, 'text');
  assert.deepEqual(second.choices, []);
  assert.deepEqual(view.interview.questions.slice(2).map((q: any) => [q.id, q.by]), [['q_pricing_model', 'engine'], ['q_price', 'engine'], ['q_tax', 'engine']]);
  assert.equal(view.interview.source, 'model');
  assert.deepEqual(view.interview.serviceType, { value: 'bookkeeping', label: 'assumption', by: 'model' });
  assert.equal(view.interview.modelCallIds.length, 1);
  assert.equal((await h.call('venture.get')).venture.serviceType, 'bookkeeping');

  // "B2B" is a name with a digit, not a number: it passes whether or not the owner wrote it.
  const b2b = setup();
  await b2b.call('venture.create', { idea: 'Lead lists for B2B SaaS founders in Berlin', countryCode: 'DE' });
  b2b.models.fixtures.interview = fixture('interview-b2b');
  const b2bView = await b2b.call('venture.interview.next', {});
  assert.equal(b2bView.interview.questions[0].text, 'Which B2B teams will you serve first?');
  const b2c = setup();
  await b2c.call('venture.create', { idea: 'Lead lists for SaaS founders in Berlin', countryCode: 'DE' });
  b2c.models.fixtures.interview = fixture('interview-b2b');
  assert.equal((await b2c.call('venture.interview.next', {})).interview.questions[0].text, 'Which B2B teams will you serve first?');

  // useTemplate never calls the port.
  const templ = setup();
  await templ.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN' });
  templ.models.fixtures.interview = fixture('interview-model');
  const templView = await templ.call('venture.interview.next', { useTemplate: true });
  assert.equal(templ.models.asked.length, 0);
  assert.equal(templView.interview.questions[0].by, 'template');
});

test('7. template blueprint: code-made structure with template words that pass every word check', async () => {
  const h = setup();
  await interviewed(h);
  const view = await h.call('venture.blueprint.draft', { useTemplate: true });
  assert.equal(h.models.asked.length, 0);
  const bp = view.blueprint;
  assert.equal(bp.version, 1);
  assert.equal(bp.status, 'draft');
  assert.equal(bp.source, 'template');
  assert.equal(bp.serviceType, 'bookkeeping');
  assert.deepEqual(bp.name, { value: 'Ledger Cafe Books', label: 'told-by-you', by: 'owner' });
  assert.equal(bp.oneLiner.label, 'assumption');
  assert.equal(bp.oneLiner.by, 'template');
  assert.deepEqual(bp.offers.map((o: any) => o.id), [...OFFER_IDS]);
  assert.deepEqual(bp.deliverySteps.map((s: any) => s.id), [...STEP_IDS]);
  assert.deepEqual(bp.deliverySteps.map((s: any) => ({ id: s.id, doneBy: s.doneBy, capability: s.capability, note: s.note })), STEP_PLAN.map(s => ({ ...s })));
  assert.equal(bp.approvals.length, 2);
  assert.deepEqual(bp.offers[0].pricing, { model: 'monthly', quantityUnit: 'month', unitPriceMinor: '249900', unitPriceLabel: 'told-by-you', defaultQuantity: '1' });
  assert.deepEqual(bp.offers[1].pricing, { model: 'project', quantityUnit: 'project', unitPriceMinor: null, unitPriceLabel: 'not-set', defaultQuantity: '1' });
  const office = bp.backOffice;
  assert.deepEqual(office.taxRegistered, { value: true, label: 'told-by-you', by: 'owner' });
  assert.equal(office.taxRateBps, '1800');
  assert.equal(office.taxRateBy, 'country-table');
  assert.equal(office.currency, 'INR');
  assert.equal(office.paymentRail, 'razorpay');
  assert.equal(office.invoicePrefix, 'INV');
  assert.equal(office.taxInvoiceReady, false);
  assert.deepEqual(office.taxInvoiceMissing, ['Your GSTIN', 'Your state', 'Your SAC code']);
  assert.deepEqual(bp.starterConnectorIds, ['lovable', 'github', 'razorpay', 'mail-app', 'cal-com', 'chausar-books']);
  assert.equal(bp.structureHash, digest(structureFromBlueprint(bp)));
  assert.equal(bp.digest, blueprintDigest(bp));
  assert.deepEqual(view.offerReceipts, { offer_1: null, offer_2: null });
  const venture = (await h.call('venture.get')).venture;
  assert.equal(venture.blueprintId, bp.id);
  assert.equal(venture.status, 'blueprint');

  // Every template word, for all eight service types, is free of numbers, banned words, em dashes and done claims.
  for (const type of SERVICE_TYPES) {
    const template = serviceTemplate(type);
    assert.equal(template.questions.length, 2);
    assert.equal(template.questions[0].choices.length, 3);
    assert.equal(template.offers.length, 2);
    assert.equal(template.steps.length, 4);
    assert.equal(template.approvals.length, 2);
    assert.match(template.steps[2], /^Draft /, `${type} step three is the drafting step`);
    for (const words of templateStrings(template)) {
      assert.doesNotThrow(() => assertNoNumbers(words, 'template'), `${type}: ${words}`);
      assert.deepEqual(houseStyleFindings(words), [], `${type}: ${words}`);
      assert.deepEqual(doneClaimFindings(words), [], `${type}: ${words}`);
    }
  }

  // Not registered: a plain invoice, nothing missing. A US plan is never a tax invoice.
  const plain = setup();
  await interviewed(plain, { tax: false, price: null });
  const plainView = await plain.call('venture.blueprint.draft', { useTemplate: true });
  assert.equal(plainView.blueprint.backOffice.taxRateBps, '0');
  assert.equal(plainView.blueprint.backOffice.taxRateBy, 'not-registered');
  assert.deepEqual(plainView.blueprint.backOffice.taxInvoiceMissing, []);
  assert.equal(plainView.blueprint.offers[0].pricing.unitPriceLabel, 'not-set');
  const us = setup();
  await interviewed(us, { country: 'US', idea: 'Inbox support for small online shops', model: 'hourly', price: '150', tax: true, rate: '8.25' });
  const usView = await us.call('venture.blueprint.draft', { useTemplate: true });
  assert.equal(usView.blueprint.offers[0].pricing.unitPriceMinor, '15000'); // 150 dollars x 100 cents
  assert.equal(usView.blueprint.offers[0].pricing.quantityUnit, 'hour');
  assert.equal(usView.blueprint.backOffice.taxRateBps, '825');
  assert.equal(usView.blueprint.backOffice.taxRateBy, 'told-by-you');
  assert.equal(usView.blueprint.backOffice.taxInvoiceReady, false);
  assert.deepEqual(usView.blueprint.backOffice.taxInvoiceMissing, []);
  assert.equal(usView.blueprint.starterConnectorIds[2], 'stripe');

  // The interview must be finished first.
  const early = setup();
  await early.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN' });
  await assert.rejects(early.call('venture.blueprint.draft', { useTemplate: true }), codeOf('INTERVIEW_INCOMPLETE'));
  await early.call('venture.interview.next', { useTemplate: true });
  await assert.rejects(early.call('venture.blueprint.draft', { useTemplate: true }), codeOf('INTERVIEW_INCOMPLETE'));
});

test('8. model blueprint: words only, ids fixed, the structure guard, and no client data in any task', async () => {
  const h = setup();
  await h.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN', workingName: 'My cafe books' });
  // A client and an order exist before the model is asked anything.
  const client = await h.seed('venture-client', { name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null });
  const request = 'Please close my September books. The bank statement and bills are in the shared folder.';
  await h.seed('venture-order', { clientId: client.id, offerId: 'offer_1', quantity: '1', request, status: 'open', priceReceiptId: 'price_seed', deliveredOn: null, saleFactId: null });
  h.models.fixtures.interview = fixture('interview-model');
  await h.call('venture.interview.next', {});
  await answer(h, 'q_1', { choiceId: 'c_1' });
  await answer(h, 'q_2', { text: 'WhatsApp photos and a shared folder' });
  await answer(h, 'q_pricing_model', { choiceId: 'monthly' });
  await answer(h, 'q_price', { amount: '2,499' });
  await answer(h, 'q_tax', { yes: true });
  await answer(h, 'q_tax_rate', { rate: '18' });

  h.models.fixtures.blueprint = fixture('blueprint-wrong-ids');
  await assert.rejects(h.call('venture.blueprint.draft', {}), codeOf('MODEL_OUTPUT_REJECTED'));
  assert.equal(h.store.read().conversations.filter((r: any) => r.kind === 'venture-blueprint').length, 0);

  // Model words that claim finished work are refused, as the template words are checked for it in test 7.
  h.models.fixtures.blueprint = fixture('blueprint-done-claim');
  await assert.rejects(h.call('venture.blueprint.draft', {}), codeOf('MODEL_OUTPUT_REJECTED'));
  assert.equal(h.store.read().conversations.filter((r: any) => r.kind === 'venture-blueprint').length, 0);
  const claimed = { serviceType: 'bookkeeping', questions: [{ field: 'customer', kind: 'text', text: 'We have checked every entry, who is next?', choices: [] }] };
  assert.throws(() => validateInterviewOutput(claimed, []), codeOf('MODEL_OUTPUT_REJECTED'));
  const plain = { serviceType: 'bookkeeping', questions: [{ field: 'customer', kind: 'text', text: 'Who will your first clients be?', choices: [] }] };
  assert.equal(validateInterviewOutput(plain, []).questions[0].text, 'Who will your first clients be?');
  for (const fixed of ['blueprint-model', 'blueprint-newline-name']) {
    const words = fixture(fixed) as any;
    const strings = [words.name, words.oneLiner, words.customer, ...words.offers.flatMap((o: any) => [o.name, o.description]), ...words.steps.map((s: any) => s.title), ...words.approvals];
    assert.deepEqual(strings.flatMap((s: string) => doneClaimFindings(s)), [], `${fixed} claims no finished work`);
  }

  h.models.fixtures.blueprint = fixture('blueprint-model');
  const view = await h.call('venture.blueprint.draft', {});
  const bp = view.blueprint;
  assert.equal(bp.source, 'model');
  assert.deepEqual(bp.name, { value: 'Ledger Cafe Books', label: 'assumption', by: 'model' });
  assert.deepEqual(bp.offers[0].name, { value: 'Monthly books', label: 'assumption', by: 'model' });
  assert.equal(bp.offers[0].pricing.unitPriceMinor, '249900');
  assert.equal(bp.offers[0].pricing.unitPriceLabel, 'told-by-you');
  assert.equal(bp.offers[1].pricing.unitPriceLabel, 'not-set');
  assert.equal(bp.deliverySteps[2].doneBy, 'agent-then-you');
  assert.equal(bp.deliverySteps[2].capability, 'drafts-now');
  assert.ok([0, 1, 3].every(i => bp.deliverySteps[i].doneBy === 'you' && bp.deliverySteps[i].capability === 'planned'));
  assert.equal(bp.modelCallIds.length, 1);
  const blueprintTask = h.models.asked.filter(t => t.purpose === 'blueprint').pop()!;
  const input = blueprintTask.input as any;
  assert.deepEqual(input.answers, [
    { question: 'Who will your first clients be?', answer: 'Cafes and small restaurants' },
    { question: 'How will clients send you their bills and statements?', answer: 'WhatsApp photos and a shared folder' },
  ]);
  assert.deepEqual(input.structure, {
    offers: [{ id: 'offer_1', pricingModel: 'monthly' }, { id: 'offer_2', pricingModel: 'project' }],
    steps: STEP_PLAN.map(s => ({ id: s.id, doneBy: s.doneBy })),
    approvals: 2,
  });
  assert.equal(blueprintTask.maxOutputTokens, 4096);
  assert.equal(blueprintTask.schemaName, 'venture-blueprint');
  assert.ok(!JSON.stringify(input).includes('249900') && !JSON.stringify(input).includes('2,499') && !JSON.stringify(input).includes('1800'), 'no amounts in the blueprint task');

  // A name over two lines is folded to one.
  h.models.fixtures.blueprint = fixture('blueprint-newline-name');
  const folded = await h.call('venture.blueprint.draft', {});
  assert.equal(folded.blueprint.name.value, 'Ledger Cafe Books');
  assert.equal(folded.blueprint.version, 2);

  // The structure moves while the model writes: refused, nothing stored.
  h.models.fixtures.blueprint = fixture('blueprint-model');
  h.models.before = async task => {
    if (task.purpose === 'blueprint') await answer(h, 'q_price', { amount: '3,000' });
  };
  await assert.rejects(h.call('venture.blueprint.draft', {}), codeOf('APPROVAL_STALE'));
  h.models.before = null;
  assert.equal(h.store.read().conversations.filter((r: any) => r.kind === 'venture-blueprint').length, 2);

  // No task ever carried client data.
  assert.ok(h.models.asked.length >= 4);
  for (const task of h.models.asked) {
    assert.equal(task.containsClientData, false);
    const text = JSON.stringify(task.input);
    assert.ok(!text.includes('Cafe Aroma Demo') && !text.includes('owner@aroma.example') && !text.includes('September books'), `${task.purpose} task holds no client data`);
  }
});

test('9. update makes new draft versions with checked tax fields; accept takes the exact digest once', async () => {
  const h = setup();
  await interviewed(h);
  const v1 = (await h.call('venture.blueprint.draft', { useTemplate: true })).blueprint;

  // 8.25 percent is 8 x 100 + 25 = 825 basis points.
  const v2 = (await h.call('venture.blueprint.update', { patch: { taxRate: '8.25' } })).blueprint;
  assert.equal(v2.version, 2);
  assert.notEqual(v2.digest, v1.digest);
  assert.notEqual(v2.id, v1.id);
  assert.equal(v2.status, 'draft');
  assert.equal(v2.backOffice.taxRateBps, '825');
  assert.equal(v2.backOffice.taxRateBy, 'told-by-you');
  assert.equal(v2.digest, blueprintDigest(v2));

  const gstin = '27ZZZZZ9999Z1Z8'; // synthetic, with a valid checksum
  assert.ok(gstinValid(gstin));
  const v3 = (await h.call('venture.blueprint.update', { patch: { taxId: '27zzzzz 9999z1z8' } })).blueprint;
  assert.equal(v3.backOffice.taxId, gstin);
  assert.equal(v3.backOffice.taxState, '27');
  assert.deepEqual(v3.backOffice.taxInvoiceMissing, ['Your SAC code']);
  const v4 = (await h.call('venture.blueprint.update', { patch: { sacCode: '998222' } })).blueprint;
  assert.equal(v4.backOffice.taxInvoiceReady, true);
  assert.deepEqual(v4.backOffice.taxInvoiceMissing, []);

  const badChecksum = '27ZZZZZ9999Z1Z9';
  assert.equal(gstinValid(badChecksum), false);
  await assert.rejects(h.call('venture.blueprint.update', { patch: { taxId: badChecksum } }), codeOf('INVALID_TAX_ID'));
  await assert.rejects(h.call('venture.blueprint.update', { patch: { taxState: '29' } }), codeOf('INVALID_TAX_ID'));
  await assert.rejects(h.call('venture.blueprint.update', { patch: { taxState: '99' } }), codeOf('INVALID_TAX_ID'));
  await assert.rejects(h.call('venture.blueprint.update', { patch: { sacCode: '123456' } }), codeOf('INVALID_TAX_ID'));
  await assert.rejects(h.call('venture.blueprint.update', { patch: {} }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(h.call('venture.blueprint.update', { patch: { name: 'Two\nlines' } }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(h.call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_3', name: 'New offer' }] } }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(h.call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', unitPrice: '2499.999' }] } }), codeOf('INVALID_AMOUNT'));
  await assert.rejects(h.call('venture.blueprint.update', { patch: { taxRate: '101' } }), codeOf('INVALID_TAX_RATE'));
  assert.equal((await h.call('venture.blueprint.get')).blueprint.version, 4, 'refused edits wrote nothing');

  // Owner words and prices are labelled told by you; the open interview keeps the same price.
  const v5 = (await h.call('venture.blueprint.update', { patch: { name: 'Ledger Books', offers: [{ id: 'offer_1', unitPrice: '3,000' }, { id: 'offer_2', unitPrice: '9999.50', pricingModel: 'hourly' }] } })).blueprint;
  assert.deepEqual(v5.name, { value: 'Ledger Books', label: 'told-by-you', by: 'owner' });
  assert.equal(v5.offers[0].pricing.unitPriceMinor, '300000'); // 3000 x 100
  assert.equal(v5.offers[1].pricing.unitPriceMinor, '999950'); // 9999.50 x 100
  assert.equal(v5.offers[1].pricing.quantityUnit, 'hour');
  const interview = h.store.read().conversations.find((r: any) => r.kind === 'venture-interview');
  assert.equal(interview.questions.find((q: any) => q.id === 'q_price').answerMinor, '300000');
  assert.equal(interview.questions.find((q: any) => q.id === 'q_tax_rate').answerBps, '825');
  // A rewrite keeps the owner's price, tax rate, second offer and registration fields; it replaces the words.
  const v6 = (await h.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
  assert.equal(v6.version, 6);
  assert.equal(v6.offers[0].pricing.unitPriceMinor, '300000');
  assert.deepEqual(v6.offers[1].pricing, v5.offers[1].pricing);
  assert.equal(v6.backOffice.taxRateBps, '825');
  assert.equal(v6.backOffice.taxId, gstin);
  assert.equal(v6.backOffice.sacCode, '998222');
  assert.equal(v6.backOffice.taxInvoiceReady, true);
  assert.equal(v6.name.value, 'Ledger Cafe Books');

  await assert.rejects(h.call('venture.blueprint.accept', { digest: v5.digest }), codeOf('APPROVAL_STALE'));
  await assert.rejects(h.call('venture.blueprint.accept', { digest: v6.digest }, { ...owner, channel: 'mcp' }), codeOf('APP_APPROVAL_REQUIRED'));
  const accepted = await h.call('venture.blueprint.accept', { digest: v6.digest });
  assert.equal(accepted.blueprint.id, v6.id);
  assert.equal(accepted.blueprint.status, 'accepted');
  assert.equal(accepted.blueprint.digest, v6.digest);
  await assert.rejects(h.call('venture.blueprint.accept', { digest: v6.digest }), codeOf('APPROVAL_STALE'));
  const ventureView = await h.call('venture.get');
  assert.equal(ventureView.venture.acceptedBlueprintId, v6.id);
  assert.equal(ventureView.venture.status, 'build');
  const terms = ventureView.terms;
  assert.deepEqual(terms.map((t: any) => t.key), ['client', 'offer', 'order', 'deliverable', 'invoice', 'payment', 'retainer-period']);
  for (const term of terms) {
    assert.equal(term.lifecycle, term.key === 'offer' ? 'active' : 'proposed');
    assert.doesNotThrow(() => assertNoNumbers(term.meaning, 'term'));
    assert.deepEqual(houseStyleFindings(term.meaning), []);
  }
  assert.deepEqual(terms.find((t: any) => t.key === 'offer').evidence.map((e: any) => [e.recordId, e.kind]), [[v6.id, 'venture-blueprint']]);

  await assert.rejects(answer(h, 'q_price', { amount: '4,000' }), codeOf('INTERVIEW_DONE'));

  // After acceptance an edit makes a new draft; the accepted version stays, and a rewrite keeps the edit.
  const v7 = (await h.call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', unitPrice: '3,500' }] } })).blueprint;
  assert.equal(v7.status, 'draft');
  assert.equal((await h.call('venture.get')).venture.acceptedBlueprintId, v6.id);
  const v8 = (await h.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
  assert.equal(v8.offers[0].pricing.unitPriceMinor, '350000');
  const again = await h.call('venture.blueprint.accept', { digest: v8.digest });
  assert.equal(again.blueprint.version, 8);
  assert.equal((await h.call('venture.get')).terms.length, 7, 'terms are made once');

  // India-only fields refuse elsewhere.
  const us = setup();
  await interviewed(us, { country: 'US', idea: 'Inbox support for small online shops', price: '150', tax: false });
  await us.call('venture.blueprint.draft', { useTemplate: true });
  await assert.rejects(us.call('venture.blueprint.update', { patch: { lutConfirmed: true } }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(us.call('venture.blueprint.update', { patch: { sacCode: '998222' } }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(us.call('venture.blueprint.update', { patch: { taxRate: '8' } }), codeOf('INVALID_TAX_RATE'));
  // A UK VAT number is checked against the country's pattern.
  const gb = setup();
  await interviewed(gb, { country: 'GB', idea: 'Podcast editing studio for creators', tax: true, rate: '20' });
  const gbDraft = (await gb.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
  assert.deepEqual(gbDraft.backOffice.taxInvoiceMissing, ['Your VAT number']);
  const gbReady = (await gb.call('venture.blueprint.update', { patch: { taxId: 'gb 123456789' } })).blueprint;
  assert.equal(gbReady.backOffice.taxId, 'GB123456789');
  assert.equal(gbReady.backOffice.taxInvoiceReady, true);
  await assert.rejects(gb.call('venture.blueprint.update', { patch: { taxId: 'GB!' } }), codeOf('INVALID_TAX_ID'));
  const studioTerms = setup();
  await interviewed(studioTerms, { country: 'GB', idea: 'Podcast editing studio for creators', model: 'project', tax: false });
  const studioDraft = (await studioTerms.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
  await studioTerms.call('venture.blueprint.accept', { digest: studioDraft.digest });
  assert.deepEqual((await studioTerms.call('venture.get')).terms.map((t: any) => t.key), ['client', 'offer', 'order', 'deliverable', 'invoice', 'payment', 'revision-round']);
});

test('turning tax on from the plan uses the country rate only where the country table has one', async () => {
  const interviewOf = (h: Harness) => h.store.read().conversations.find((r: any) => r.kind === 'venture-interview');
  const rateQuestion = (h: Harness) => interviewOf(h).questions.find((q: any) => q.id === 'q_tax_rate');

  // The United States and "another country" have no rate in the table, so the owner must give one.
  for (const country of ['US', 'XX']) {
    const h = setup();
    await interviewed(h, { country, idea: 'Inbox support for small online shops', price: '150', tax: false });
    const draft = (await h.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
    const before = interviewOf(h);
    await assert.rejects(h.call('venture.blueprint.update', { patch: { taxRegistered: true } }), codeOf('INVALID_TAX_RATE'), `${country}: no rate, refused`);
    assert.equal((await h.call('venture.blueprint.get')).blueprint.version, draft.version, `${country}: no new version`);
    assert.deepEqual(interviewOf(h), before, `${country}: the interview is untouched`);

    // 8.25 percent is 8 x 100 + 25 = 825 basis points.
    const on = (await h.call('venture.blueprint.update', { patch: { taxRegistered: true, taxRate: '8.25' } })).blueprint;
    assert.deepEqual(on.backOffice.taxRegistered, { value: true, label: 'told-by-you', by: 'owner' });
    assert.equal(on.backOffice.taxRateBps, '825');
    assert.equal(on.backOffice.taxRateBy, 'told-by-you');
    assert.equal(rateQuestion(h).prefill, null);
    assert.equal(rateQuestion(h).answerBps, '825');
    assert.deepEqual(rateQuestion(h).answer, { rate: '8.25' });
    // A rewrite rebuilds the structure from the interview and keeps the owner's rate and label.
    const rewritten = (await h.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
    assert.equal(rewritten.backOffice.taxRateBps, '825');
    assert.equal(rewritten.backOffice.taxRateBy, 'told-by-you');
    // Turning tax off sets the rate to zero and drops the rate question.
    const off = (await h.call('venture.blueprint.update', { patch: { taxRegistered: false } })).blueprint;
    assert.equal(off.backOffice.taxRateBps, '0');
    assert.equal(off.backOffice.taxRateBy, 'not-registered');
    assert.equal(rateQuestion(h), undefined);
  }

  // India has a rate in the table: turning tax on without a rate uses it, labelled as the country's.
  const india = setup();
  await interviewed(india, { tax: false });
  await india.call('venture.blueprint.draft', { useTemplate: true });
  const on = (await india.call('venture.blueprint.update', { patch: { taxRegistered: true } })).blueprint;
  assert.equal(on.backOffice.taxRateBps, '1800');
  assert.equal(on.backOffice.taxRateBy, 'country-table');
  assert.equal(rateQuestion(india).answerBps, '1800');
  const rewritten = (await india.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
  assert.equal(rewritten.backOffice.taxRateBps, '1800');
  assert.equal(rewritten.backOffice.taxRateBy, 'country-table');
});

function priceReceipt(offerId: string, blueprintDigestValue: string) {
  // Hand-written receipt shape for INR 2,499.00 plus GST at 18 percent: (249900 x 1800 + 5000) / 10000 = 44982; total 294882.
  return {
    subject: { type: 'offer', offerId },
    operation: 'venture.price',
    currency: 'INR',
    minorDigits: 2,
    inputs: { unitPriceMinor: '249900', quantity: '1', discountBps: '0', taxMode: 'gst', taxRateBps: '1800', taxTreatment: 'single', unitPriceBy: 'told-by-you', taxRateBy: 'country-table', blueprintDigest: blueprintDigestValue },
    steps: [],
    figures: [{ key: 'total', label: 'Total', minor: '294882', display: 'INR 2,948.82', currency: 'INR' }],
    totalMinor: '294882',
    allowedNumbers: ['294882', '2948.82'],
    explanation: '1 x month at INR 2,499.00, plus GST at 18% (INR 449.82) = INR 2,948.82.',
    digest: 'seeded',
    stale: false,
  };
}

test('10. offerReceipts shows the receipt made for this exact version, before and after acceptance', async () => {
  const h = setup();
  await interviewed(h);
  const v1 = (await h.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
  const old = await h.seed('venture-price-receipt', priceReceipt('offer_2', v1.digest));
  const v2 = (await h.call('venture.blueprint.update', { patch: { oneLiner: 'Tidy monthly books for cafes.' } })).blueprint;
  const current = await h.seed('venture-price-receipt', priceReceipt('offer_1', v2.digest));
  let view = await h.call('venture.blueprint.get');
  assert.equal(view.blueprint.id, v2.id);
  assert.equal(view.offerReceipts.offer_1.id, current.id);
  assert.equal(view.offerReceipts.offer_2, null, `the receipt ${old.id} priced an older version`);
  await h.call('venture.blueprint.accept', { digest: v2.digest });
  view = await h.call('venture.blueprint.get');
  assert.equal(view.blueprint.status, 'accepted');
  assert.equal(view.offerReceipts.offer_1.id, current.id);
  // A newer receipt for the same offer and version wins.
  const newer = await h.seed('venture-price-receipt', priceReceipt('offer_1', v2.digest));
  assert.equal((await h.call('venture.blueprint.get')).offerReceipts.offer_1.id, newer.id);
});

test('11. the checklist climbs to twelve in table order as each kind of record appears, the AI first', async () => {
  const h = setup();
  const progress = async () => { const view = await h.call('venture.get'); return [view.done, view.next?.item ?? null]; };
  assert.equal(await h.call('venture.get'), null);
  await h.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN' });
  assert.deepEqual(await progress(), [1, 'ai']);
  // No route `kind` here: ModelConnectionRecord's route kind shares its name with the record kind (see docs/venture/core.md).
  await h.seed('venture-model-connection', { presetId: 'built-in-templates', model: null, endpoint: 'chausar://templates', tiers: ['fast', 'main'], consentDigest: 'c', consentedAt: FIXED_NOW, monthlyCapMicros: '0', status: 'connected' });
  assert.deepEqual(await progress(), [2, 'questions']);
  await h.call('venture.interview.next', { useTemplate: true });
  await answer(h, 'q_1', { skipped: true });
  await answer(h, 'q_2', { skipped: true });
  await answer(h, 'q_pricing_model', { choiceId: 'monthly' });
  await answer(h, 'q_price', { amount: '2,499' });
  assert.deepEqual(await progress(), [2, 'questions']);
  await answer(h, 'q_tax', { yes: false });
  assert.deepEqual(await progress(), [3, 'plan']);
  const draft = (await h.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
  assert.deepEqual(await progress(), [3, 'plan']);
  await h.call('venture.blueprint.accept', { digest: draft.digest });
  assert.deepEqual(await progress(), [4, 'prices']);
  await h.seed('venture-price-receipt', priceReceipt('offer_1', 'f'.repeat(64)));
  assert.deepEqual(await progress(), [4, 'prices'], 'a receipt for another version does not count');
  await h.seed('venture-price-receipt', priceReceipt('offer_1', draft.digest));
  assert.deepEqual(await progress(), [5, 'brief']);
  await h.seed('venture-brief', { briefId: 'chb_abcd1234', version: 1, markdown: '# Brief', chars: 7, digest: 'd', blueprintDigest: draft.digest, priceReceiptIds: [], wordsBy: 'template', modelCallId: null, lint: { ok: false, findings: [] } });
  assert.deepEqual(await progress(), [5, 'brief']);
  await h.seed('venture-brief', { briefId: 'chb_abcd1234', version: 2, markdown: '# Brief', chars: 7, digest: 'd', blueprintDigest: draft.digest, priceReceiptIds: [], wordsBy: 'template', modelCallId: null, lint: { ok: true, findings: [] } });
  assert.deepEqual(await progress(), [6, 'builder']);
  await h.seed('venture-handoff', { builder: 'lovable', mode: 'link', briefId: 'chb_abcd1234', briefDigest: 'd', urlChars: 10, urlDigest: 'u', openedAt: null });
  assert.deepEqual(await progress(), [6, 'builder'], 'a prepared handoff that never opened does not count');
  await h.seed('venture-handoff', { builder: 'lovable', mode: 'link', briefId: 'chb_abcd1234', briefDigest: 'd', urlChars: 10, urlDigest: 'u', openedAt: FIXED_NOW });
  assert.deepEqual(await progress(), [7, 'repo']);
  await h.seed('venture-build-follow', { repo: { owner: 'demo-owner', name: 'ledger' }, tokenState: 'none', linkedAt: FIXED_NOW, lastStatus: null });
  assert.deepEqual(await progress(), [7, 'repo']);
  await h.seed('venture-build-follow', { repo: { owner: 'demo-owner', name: 'ledger' }, tokenState: 'in-memory', linkedAt: FIXED_NOW, lastStatus: { word: 'quiet', asOf: FIXED_NOW } });
  assert.deepEqual(await progress(), [8, 'rehearsal']);
  await h.seed('venture-simulation-run', { playbookId: 'p', playbookHash: 'h', scenarioIds: [], episodes: [], passed: false, summary: { scenarios: 1, passed: 0, failed: 1 }, costMicros: '0', costDisplay: 'USD 0.0000', startedAt: FIXED_NOW, finishedAt: FIXED_NOW, modelMode: 'template' });
  assert.deepEqual(await progress(), [8, 'rehearsal']);
  await h.seed('venture-simulation-run', { playbookId: 'p', playbookHash: 'h', scenarioIds: [], episodes: [], passed: true, summary: { scenarios: 1, passed: 1, failed: 0 }, costMicros: '0', costDisplay: 'USD 0.0000', startedAt: FIXED_NOW, finishedAt: FIXED_NOW, modelMode: 'template' });
  assert.deepEqual(await progress(), [9, 'first-client']);
  const client = await h.seed('venture-client', { name: 'Cafe Aroma Demo', email: null, countryCode: 'IN', taxId: null, stateCode: '27', note: null });
  assert.deepEqual(await progress(), [10, 'first-invoice']);
  await h.seed('venture-invoice', { number: null, status: 'draft', clientId: client.id });
  assert.deepEqual(await progress(), [10, 'first-invoice'], 'a draft invoice was not sent');
  const invoice = await h.seed('venture-invoice', { number: 'INV-0001', status: 'issued', clientId: client.id });
  assert.deepEqual(await progress(), [11, 'first-payment']);
  await h.seed('venture-payment', { invoiceId: invoice.id, amountMinor: '249900', currency: 'INR', receivedOn: '2026-10-05', method: 'upi', factId: 'fact_seed', booksReceiptId: null, booksNote: null });
  const view = await h.call('venture.get');
  assert.equal(view.done, 12);
  assert.equal(view.next, null);
  assert.deepEqual(view.checklist.map((item: any) => item.id), ['ai', 'idea', 'questions', 'plan', 'prices', 'brief', 'builder', 'repo', 'rehearsal', 'first-client', 'first-invoice', 'first-payment']);
  assert.ok(view.checklist.every((item: any) => item.done));
  assert.equal(view.checklist.find((item: any) => item.id === 'ai').label, 'Connect your AI');
  assert.equal(view.checklist.find((item: any) => item.id === 'idea').label, 'Say what you want to do');
});

test('12. venture.events pages by sequence number', async () => {
  const h = setup();
  await assert.rejects(h.call('venture.events', {}), codeOf('VENTURE_NOT_FOUND'));
  await h.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN' }); // 1 venture-created, 2 retention-changed
  await h.call('venture.interview.next', { useTemplate: true }); // 3
  await answer(h, 'q_1', { skipped: true }); // 4
  await answer(h, 'q_2', { skipped: true }); // 5
  const all = await h.call('venture.events', {});
  assert.deepEqual(all.events.map((e: any) => e.seq), [1, 2, 3, 4, 5]);
  assert.equal(all.lastSeq, 5);
  assert.deepEqual(all.events.map((e: any) => e.name), ['venture-created', 'retention-changed', 'interview-updated', 'interview-updated', 'interview-updated']);
  const page = await h.call('venture.events', { afterSeq: 1, limit: 2 });
  assert.deepEqual(page.events.map((e: any) => e.seq), [2, 3]);
  assert.equal(page.lastSeq, 5);
  assert.deepEqual((await h.call('venture.events', { afterSeq: 3 })).events.map((e: any) => e.seq), [4, 5]);
  assert.deepEqual((await h.call('venture.events', { afterSeq: 5 })).events, []);
  await assert.rejects(h.call('venture.events', { limit: 0 }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(h.call('venture.events', { limit: 101 }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(h.call('venture.events', { afterSeq: -1 }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(h.call('venture.events', { page: 2 }), codeOf('INVALID_VENTURE_REQUEST'));
});

test('13. the handler table holds exactly the seventeen core methods; the pre-vault answers are functions', () => {
  // Twelve, and the five Ink v2 wave 4 added (the owner profile, 4J9; settings drafts, 4J2; the plan suggestion, 4J8).
  assert.deepEqual(Object.keys(handlers).sort(), [
    'venture.blueprint.accept', 'venture.blueprint.draft', 'venture.blueprint.get', 'venture.blueprint.suggest', 'venture.blueprint.update',
    'venture.create', 'venture.events', 'venture.evidence.apply', 'venture.evidence.dismiss', 'venture.evidence.list', 'venture.get', 'venture.interview.answer', 'venture.interview.next',
    'venture.owner.get', 'venture.owner.set', 'venture.settings.draft', 'venture.settings.drafts',
  ]);
  assert.equal(typeof listCountries, 'function');
  assert.equal(typeof previewPlan, 'function');
});

test('every error code the core package throws is a declared venture code or an engine code it reuses', () => {
  const folder = new URL('../runtime/venture/core/', import.meta.url);
  const reused = new Set(['UNKNOWN_PACK']); // the ontology's own code for a missing starter pack
  const found = new Set<string>();
  for (const name of readdirSync(folder)) {
    if (!name.endsWith('.ts')) continue;
    const source = readFileSync(new URL(name, folder), 'utf8');
    for (const match of source.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) found.add(match[1]);
  }
  assert.ok(found.size >= 15);
  for (const code of found) assert.ok((VENTURE_ERRORS as readonly string[]).includes(code) || reused.has(code), `${code} is declared`);
});

test('reads and writes need the right role, and a refused write changes nothing', async () => {
  const h = setup();
  await interviewed(h);
  await h.store.update(state => { state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
  assert.equal((await h.call('venture.get', {}, viewer)).done, 2);
  await assert.rejects(h.call('venture.blueprint.draft', { useTemplate: true }, viewer), codeOf('FORBIDDEN'));
  await assert.rejects(answer({ ...h, call: (m, p) => h.call(m, p, viewer) } as Harness, 'q_1', { skipped: true }), codeOf('FORBIDDEN'));
  const before = h.store.read().conversations.length;
  await assert.rejects(h.call('venture.blueprint.draft', { useTemplate: 'yes' }), codeOf('INVALID_VENTURE_REQUEST'));
  assert.equal(h.store.read().conversations.length, before);
});

test('template offer words follow how the owner charges, and stay an assumption', async () => {
  const assumption = (value: string) => ({ value, label: 'assumption', by: 'template' });
  const offerLine = (offer: any) => ({ name: offer.name, description: offer.description, model: offer.pricing.model, unit: offer.pricing.quantityUnit });

  // Per hour: the bookkeeping plan's first offer is 'Bookkeeping hours', never 'Monthly books'. offer_2 keeps its project words.
  const hourly = setup();
  await interviewed(hourly, { model: 'hourly' });
  const hourlyPlan = (await hourly.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
  assert.deepEqual(offerLine(hourlyPlan.offers[0]), {
    name: assumption('Bookkeeping hours'), description: assumption('Bank matching, bill sorting and short reports, booked by the hour.'), model: 'hourly', unit: 'hour',
  });
  assert.deepEqual(offerLine(hourlyPlan.offers[1]), {
    name: assumption('Catch up'), description: assumption('Past months put in order before the regular service starts.'), model: 'project', unit: 'project',
  });

  // Per project and per month.
  const project = setup();
  await interviewed(project, { model: 'project' });
  const projectPlan = (await project.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
  assert.deepEqual(projectPlan.offers[0].name, assumption('Bookkeeping project'));
  const monthly = setup();
  await interviewed(monthly, { model: 'monthly' });
  const monthlyPlan = (await monthly.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
  assert.deepEqual(monthlyPlan.offers[0].name, assumption('Monthly books'));

  // Changing the pricing on the plan rewords template words; the owner's own words stay.
  let view = await monthly.call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', pricingModel: 'hourly' }] } });
  assert.deepEqual(view.blueprint.offers[0].name, assumption('Bookkeeping hours'));
  assert.deepEqual(view.blueprint.offers[0].description, assumption('Bank matching, bill sorting and short reports, booked by the hour.'));
  view = await monthly.call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_2', pricingModel: 'monthly' }] } });
  assert.deepEqual(view.blueprint.offers[1].name, assumption('Monthly catch up'));
  view = await monthly.call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', name: 'Cafe books' }] } });
  view = await monthly.call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', pricingModel: 'project' }] } });
  assert.deepEqual(view.blueprint.offers[0].name, { value: 'Cafe books', label: 'told-by-you', by: 'owner' });
  assert.deepEqual(view.blueprint.offers[0].description, assumption('Bank matching, bill sorting and a short report for one stretch of time you choose.'));
  // A name and a new pricing in one change: the owner's name wins.
  view = await monthly.call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_2', name: 'Old months', pricingModel: 'hourly' }] } });
  assert.deepEqual(view.blueprint.offers[1].name, { value: 'Old months', label: 'told-by-you', by: 'owner' });
  assert.deepEqual(view.blueprint.offers[1].description, assumption('Past months put in order, booked by the hour.'));

  // The AI is told the pricing of each offer and asked to word the offers to fit it.
  const ai = setup();
  await interviewed(ai, { model: 'hourly' });
  await ai.call('venture.blueprint.draft', {});
  const task = ai.models.asked.find(t => t.purpose === 'blueprint')!;
  assert.match(BLUEPRINT_INSTRUCTIONS, /fit how it is charged/);
  assert.deepEqual((task.input as any).structure.offers, [{ id: 'offer_1', pricingModel: 'hourly' }, { id: 'offer_2', pricingModel: 'project' }]);

  // The instant plan takes the choice too, so it can be asked again when the owner picks how to charge.
  const preview = previewPlan({ idea: 'Monthly bookkeeping for cafes in Pune', countryCode: 'IN', pricingModel: 'hourly' });
  assert.deepEqual(offerLine(preview.offers[0]), {
    name: assumption('Bookkeeping hours'), description: assumption('Bank matching, bill sorting and short reports, booked by the hour.'), model: 'hourly', unit: 'hour',
  });
  assert.deepEqual(previewPlan({ idea: 'Monthly bookkeeping for cafes in Pune', countryCode: 'IN' }).offers[0].name, assumption('Monthly books'));
  assert.throws(() => previewPlan({ idea: 'Monthly bookkeeping for cafes in Pune', countryCode: 'IN', pricingModel: 'weekly' }), codeOf('INVALID_VENTURE_REQUEST'));

  // Every type and slot: monthly words name the month, hourly words the hour, and nothing else says monthly.
  for (const type of SERVICE_TYPES) {
    for (const index of [0, 1]) {
      const month = offerWords(type, index, 'monthly');
      assert.match(month.name, /^Monthly /, `${type} ${index}`);
      for (const model of ['project', 'hourly'] as const) {
        const words = offerWords(type, index, model);
        assert.doesNotMatch(`${words.name} ${words.description}`, /\bmonthly\b|each month|per month/i, `${type} ${index} ${model}`);
        if (model === 'hourly') assert.match(`${words.name} ${words.description}`, /hour/i, `${type} ${index}`);
      }
      const names = (['monthly', 'project', 'hourly'] as const).map(model => offerWords(type, index, model).name);
      assert.equal(new Set(names).size, 3, `${type} ${index} has three different names`);
    }
    // The starting words are the monthly first offer and the second offer at its own pricing.
    const template = serviceTemplate(type);
    assert.deepEqual(template.offers, [offerWords(type, 0, 'monthly'), offerWords(type, 1, SECOND_OFFER_MODEL[type])]);
  }
});

test('a tax answer the owner did not give is kept as an assumption until the owner confirms it on the plan', async () => {
  const h = setup();
  await h.call('venture.create', { idea: CAFE_IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  await h.call('venture.interview.next', { useTemplate: true });
  await answer(h, 'q_1', { skipped: true });
  await answer(h, 'q_2', { skipped: true });
  await answer(h, 'q_pricing_model', { choiceId: 'monthly' });
  await answer(h, 'q_price', { skipped: true });
  // Only "not registered" can be assumed, and only on the tax question.
  await assert.rejects(answer(h, 'q_tax', { yes: true, assumed: true }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(answer(h, 'q_price', { skipped: true, assumed: true }), codeOf('INVALID_VENTURE_REQUEST'));
  await assert.rejects(answer(h, 'q_tax', { assumed: true }), codeOf('INVALID_VENTURE_REQUEST'));
  const view = await answer(h, 'q_tax', { yes: false, assumed: true });
  assert.deepEqual(view.interview.questions.find((q: any) => q.id === 'q_tax').answer, { yes: false, assumed: true });
  assert.equal(view.done, true);
  const draft = (await h.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
  assert.deepEqual(draft.backOffice.taxRegistered, { value: false, label: 'assumption', by: 'template' });
  assert.equal(structureFromBlueprint(draft).backOffice.taxRegistered.label, 'assumption');
  // A price edit on the plan keeps the assumption; saying no to tax on the plan makes it the owner's answer.
  const priced = (await h.call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', unitPrice: '2,499' }] } })).blueprint;
  assert.deepEqual(priced.backOffice.taxRegistered, { value: false, label: 'assumption', by: 'template' });
  const confirmed = (await h.call('venture.blueprint.update', { patch: { taxRegistered: false } })).blueprint;
  assert.deepEqual(confirmed.backOffice.taxRegistered, { value: false, label: 'told-by-you', by: 'owner' });

  // The owner's own no stays the owner's.
  const told = setup();
  await interviewed(told, { tax: false });
  const plan = (await told.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
  assert.deepEqual(plan.backOffice.taxRegistered, { value: false, label: 'told-by-you', by: 'owner' });
});

test('5A2: a share on the first offer clears the interview\'s price, and a rewrite keeps every share, not the old fixed price', async () => {
  const h = setup();
  await interviewed(h);
  await h.call('venture.blueprint.draft', { useTemplate: true });
  const shared = (await h.call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', share: { percent: '8.33' } }, { id: 'offer_2', share: { percent: '12' } }] } })).blueprint;
  assert.equal(shared.offers[0].pricing.share.bps, '833');
  const interview = h.store.read().conversations.find((r: any) => r.kind === 'venture-interview');
  const price = interview.questions.find((q: any) => q.id === 'q_price');
  assert.equal(price.answerMinor, null, 'the interview no longer holds the old fixed price');
  const rewritten = (await h.call('venture.blueprint.draft', { useTemplate: true })).blueprint;
  assert.deepEqual(rewritten.offers.map((offer: any) => [offer.pricing.share?.bps ?? null, offer.pricing.unitPriceMinor]), [['833', null], ['1200', null]]);
});
