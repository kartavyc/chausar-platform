// Wave 6, package 6C3 (DECISIONS D17): price ranges with sources. One data file covers the 57 beta professions in
// their 11 families (PACKAGES 6E6). A range carries its currency, BigInt minor amounts, unit, city, sources (link,
// publisher, title), the date checked and a note; a profession with no credible source says "No reliable data" and has
// no range. The gallery shows a sourced range in place of the model estimate where it fits the way's service, and the
// plan carries its profession's guide. Nothing here ever sets or changes a price.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PRICE_FAMILIES, PRICES_CHECKED_ON, PROFESSION_PRICES } from '../runtime/venture/core/price-ranges-data.ts';
import { WAY_PRICES, priceGuide, priceGuideForPlaybook, validatePriceRanges, wayPrice } from '../runtime/venture/core/price-ranges.ts';
import { priceGuideField } from '../runtime/venture/core/lookups.ts';
import { listWays } from '../runtime/venture/core/ways.ts';
import { WAY_SOURCE } from '../runtime/venture/playbooks/ways.ts';
import { PLAYBOOK_REGISTRY } from '../runtime/venture/playbooks/registry.ts';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import type { ModelOutcome, ModelPort, ModelTask, SecretShelf, VentureDeps, VentureMethod } from '../runtime/venture/contracts.ts';
import { handlers } from '../runtime/venture/core/index.ts';
import { VentureTestStore } from './venture-test-store.ts';

const FAMILY_SIZES: Record<string, number> = {
  'money-and-tax': 5, 'teaching-and-coaching': 8, 'creative-work': 6, 'writing-and-content': 6, 'local-services': 7,
  'documents-and-reports': 7, 'research-and-analysis': 5, 'people-and-careers': 2, 'shop-and-back-office': 4, 'tech-services': 4,
  'licensed-work': 3,
};
const EM_DASH = String.fromCodePoint(0x2014);

test('6C3 the data covers the 57 professions in 11 families, at least 25 with sourced ranges, the rest honestly without', () => {
  validatePriceRanges();
  assert.equal(PROFESSION_PRICES.length, 57);
  assert.deepEqual([...PRICE_FAMILIES], Object.keys(FAMILY_SIZES));
  for (const family of PRICE_FAMILIES) assert.equal(PROFESSION_PRICES.filter(row => row.family === family).length, FAMILY_SIZES[family], family);
  assert.equal(new Set(PROFESSION_PRICES.map(row => row.id)).size, 57);
  const sourced = PROFESSION_PRICES.filter(row => row.ranges.length > 0);
  assert.ok(sourced.length >= 25, `only ${sourced.length} professions have sourced ranges`);
  for (const row of PROFESSION_PRICES) {
    if (row.ranges.length === 0) {
      assert.ok(row.noData && row.noData.length > 10, `${row.id} says why there is no reliable data`);
      continue;
    }
    assert.equal(row.noData, undefined, `${row.id} has ranges, so it is not marked no reliable data`);
    for (const range of row.ranges) {
      assert.ok(range.currency === 'INR' || range.currency === 'USD', range.id);
      assert.equal(typeof range.low, 'bigint', range.id);
      assert.equal(typeof range.high, 'bigint', range.id);
      assert.ok(range.low <= range.high && range.high > 0n && (range.kind === 'cap' ? range.low === 0n : range.low > 0n), `${range.id} runs low to high above zero`);
      assert.ok(range.sources.length > 0, `${range.id} names a source`);
      for (const source of range.sources) {
        assert.match(source.url, /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//, `${range.id} links its source`);
        assert.ok(source.publisher.trim() && source.title.trim(), `${range.id} names the publisher and title`);
        assert.ok(source.published === null || /^\d{4}-\d{2}(-\d{2})?$/.test(source.published), `${range.id} dates its source as published`);
      }
      assert.equal(range.checkedOn, PRICES_CHECKED_ON);
      assert.ok(range.unit.startsWith('per '), `${range.id}'s unit reads "per ..."`);
      for (const words of [range.label, range.unit, range.note, row.label, ...range.sources.map(s => s.title)]) {
        assert.equal(words.includes(EM_DASH), false, `${range.id}: no em dash`);
        assert.deepEqual(houseStyleFindings(words), [], `${range.id}: house style in "${words}"`);
      }
    }
  }
  assert.equal(PRICES_CHECKED_ON, '2026-11-01');
});

test('6C3 a guide shows a sourced range with its sources and date, as code-made words', () => {
  const ca = priceGuide('chartered-accountant');
  assert.equal(ca.status, 'sourced');
  assert.equal(ca.line, null);
  assert.equal(ca.checked, '1 Nov 2026');
  const itr = ca.ranges[0]!;
  assert.deepEqual([itr.text, itr.per, itr.lowMinor, itr.highMinor, itr.currency, itr.kind], ['₹4,000 to ₹8,000 or more', 'per return', '400000', '800000', 'INR', 'minimums']);
  assert.match(itr.sources[0]!.publisher, /ICAI/);
  assert.equal(itr.checked, '1 Nov 2026');
  assert.equal(priceGuide('translator').ranges[0]!.text, '₹0.50 to ₹1.25');
  assert.equal(priceGuide('financial-planner').ranges[0]!.text, 'Up to ₹1,51,000');
  assert.equal(priceGuide('ghostwriter').ranges[0]!.text, '$400 to $1,000');
  assert.equal(priceGuide('school-teacher').ranges[1]!.text, '₹350');
  assert.equal(priceGuide('school-teacher').ranges[1]!.city, 'Bengaluru');
});

test('6C3 a profession with no credible source says "No reliable data" and has no range or number', () => {
  const editor = priceGuide('video-editor');
  assert.equal(editor.status, 'no-reliable-data');
  assert.equal(editor.line, 'No reliable data');
  assert.deepEqual(editor.ranges, []);
  assert.ok(editor.reason && !/[₹$]\s?\d/.test(editor.reason));
  assert.throws(() => priceGuide('astronaut'), (error: any) => error?.code === 'INVALID_VENTURE_REQUEST');
});

test('6C3 the gallery shows a sourced range in place of the model estimate only where it fits the way', () => {
  for (const [playbook, mapping] of Object.entries(WAY_PRICES)) {
    assert.ok(PLAYBOOK_REGISTRY.some(entry => entry.id === playbook), `${playbook} is a registered playbook`);
    const guide = priceGuide(mapping.profession);
    if (mapping.range) assert.ok(guide.ranges.some(range => range.id === mapping.range), `${playbook} shows a range of ${mapping.profession}`);
  }
  const ways = listWays({}).ways;
  const books = ways.find(way => way.id === 'bookkeeping-cfo')!;
  assert.deepEqual([books.clientsPay.text, books.clientsPay.per, books.clientsPay.estimate, books.clientsPay.rangeId], ['₹499 to ₹15,000', 'per month', false, 'accountant-monthly-books']);
  assert.equal(books.clientsPay.source, 'IndiaMART. Checked 1 Nov 2026.');
  assert.equal(books.clientsPay.guide?.profession, 'accountant');
  // ICAI's figures are minimums for single tasks, not the CA way's whole monthly service: the estimate stays, the guide rides along.
  const ca = ways.find(way => way.id === 'ca-firm')!;
  assert.deepEqual([ca.clientsPay.estimate, ca.clientsPay.source, ca.clientsPay.guide?.profession, ca.clientsPay.rangeId], [true, WAY_SOURCE.en, 'chartered-accountant', undefined]);
  const youtube = ways.find(way => way.id === 'youtube')!;
  assert.deepEqual([youtube.clientsPay.estimate, youtube.clientsPay.source, youtube.clientsPay.guide?.status], [true, WAY_SOURCE.en, 'no-reliable-data']);
  // A profession with sourced ranges for a different service keeps the model estimate and shows the guide beside it.
  const narration = ways.find(way => way.id === 'narration-studio')!;
  assert.deepEqual([narration.clientsPay.estimate, narration.clientsPay.guide?.status], [true, 'sourced']);
  const social = ways.find(way => way.id === 'social-agency')!;
  assert.equal(social.clientsPay.guide, undefined);
  assert.equal(wayPrice('social-agency'), null);
  for (const way of ways) assert.equal(way.clientsPay.estimate, !(WAY_PRICES[way.playbook]?.range), `${way.id}: an estimate unless a sourced range fits`);
});

test('6C3 the plan carries its profession\'s guide, never a price: the owner\'s price is unaffected', () => {
  assert.equal(priceGuideForPlaybook('ca-firm')?.profession, 'chartered-accountant');
  assert.equal(priceGuideForPlaybook('social-agency'), null);
  const field = priceGuideField('A CA practice: books, GST and income tax working papers for small businesses.', 'IN');
  assert.equal(field.priceGuide?.profession, 'chartered-accountant');
  assert.deepEqual(priceGuideField('Dog walking for busy nurses in Leeds.', 'IN'), {});
  // The data is India's: a business in another country sees no rupee ranges at all.
  assert.equal(priceGuideForPlaybook('ca-firm', 'GB'), null);
  assert.deepEqual(priceGuideField('A CA practice: books, GST and income tax working papers for small businesses.', 'US'), {});
  // The guide holds no price field the plan could take: it is information beside the owner's own price.
  const text = JSON.stringify(field.priceGuide);
  assert.equal(/unitPrice|pricing/.test(text), false);
});

test('6C3 the fake engine\'s Start fixture is the engine\'s own ways, sourced ranges included', async () => {
  const fake = JSON.parse(await readFile(new URL('../../app/ui/src/engine/fixtures-start.json', import.meta.url), 'utf8'));
  assert.deepEqual(fake.ways, listWays({}));
});

// The plan through the real core handlers (template interview, no model), as venture-core.test.ts drives it.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };

function core() {
  const store = new VentureTestStore();
  const calculator = new CalculatorService(store);
  const notHere = () => { throw new ChausarError('NOT_BUILT_YET', 'Templates only.'); };
  const models = {
    status: notHere, presets: notHere, async checkCli() { notHere(); }, async preview() { return notHere(); }, async runPreview() { return notHere(); },
    async generate<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
      assert.ok(task.template, 'templates only');
      return { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
    },
  } as unknown as ModelPort;
  const map = new Map<string, string>();
  const secrets: SecretShelf = { get: name => map.get(name) ?? null, set: (name, value) => { map.set(name, value); }, delete: name => { map.delete(name); }, has: name => map.has(name), clear: () => map.clear() };
  const deps: VentureDeps = {
    store, clock: () => new Date('2026-10-15T10:00:00.000Z'), models,
    services: { calculator: { calculate: (ctx, request) => calculator.calculate(ctx, request as any), receipt: (ctx, id) => calculator.receipt(ctx, id) }, ontology: new OntologyService(store), trust: new TrustService(store) },
    github: { kind: 'fixture', async read() { throw new ChausarError('GITHUB_READ_FAILED', 'No GitHub here.'); } },
    secrets, host: 'test', demo: true, storage: 'experimental-file',
  };
  return (method: VentureMethod, payload: unknown = {}): Promise<any> => (handlers[method] as any)(deps, owner, payload);
}

test('6C3 a CA plan carries ICAI\'s ranges beside its offers, and the owner sets any price, inside the range or not', async () => {
  const call = core();
  await call('venture.create', { idea: 'A CA practice: books, GST and income tax working papers for small businesses.', countryCode: 'IN', workingName: 'Ledger Books' });
  let interview = await call('venture.interview.next', { useTemplate: true });
  for (let turn = 0; turn < 12; turn++) {
    const open = interview.interview.questions.find((q: any) => q.answer === null);
    if (!open) break;
    const answer = open.kind === 'yesno' ? { yes: false } : open.kind === 'choice' ? { choiceId: open.choices[0].id } : { skipped: true };
    interview = await call('venture.interview.answer', { questionId: open.id, answer });
  }
  const draft = await call('venture.blueprint.draft', { useTemplate: true });
  assert.equal(draft.playbook?.id, 'ca-firm');
  assert.deepEqual(draft.priceGuide, priceGuide('chartered-accountant'));
  assert.ok(draft.blueprint.offers.every((offer: any) => offer.pricing.unitPriceMinor === null), 'a guide never fills in a price');
  const first = draft.blueprint.offers[0].id;
  // Far below the ICAI minimum: the owner's price is theirs, never clamped or refused for being outside a range.
  const priced = await call('venture.blueprint.update', { patch: { offers: [{ id: first, unitPrice: '1' }] } });
  assert.equal(priced.blueprint.offers[0].pricing.unitPriceMinor, '100');
  assert.deepEqual(priced.priceGuide, draft.priceGuide, 'the guide does not move with the owner\'s price');
  const got = await call('venture.blueprint.get');
  assert.equal(got.blueprint.offers[0].pricing.unitPriceMinor, '100');
  assert.equal(got.priceGuide.status, 'sourced');
});
