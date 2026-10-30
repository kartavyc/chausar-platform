// P4 tests for the venture launcher's build package: the brief, its lint, builder handoff links and the
// GitHub reader. No network: the model is a stub port and GitHub is a synthetic recording or a stub fetch.
import test from 'node:test';
import {PLAYBOOK_CATALOGUE_ENTRIES} from '../runtime/venture/build/catalogue-playbooks.ts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import { SERVICE_TYPE_LABELS, SERVICE_TYPES, STEP_PLAN, VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import type {
  BlueprintRecord, BriefModelOutput, BriefRecord, BuilderId, ClientRecord, CountryProfile, GitHubFixture, GitHubRequest, GitHubResponse,
  GitHubTransport, Json, LineAuthor, LineLabel, ModelPort, ModelTask, OrderRecord, PriceReceiptRecord, SecretName, SecretShelf, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { assertNoNumbers, houseStyleFindings, listRecords, requireAppChannel, ventureAction, type VentureTx } from '../runtime/venture/records.ts';
import {
  CONNECTOR_CATALOGUE, REQUIRED_BRIEF_LINES, TOKEN_LINK, UI_POLICY, compressToEncodedURIComponent, createFixtureGitHubTransport,
  decompressFromEncodedURIComponent, defaultGitHubTransport, handlers, lintBrief, planHandoff,
} from '../runtime/venture/build/index.ts';
import { BRIEF_HEADINGS, RLS_LINE, SIGN_IN_LINE } from '../runtime/venture/build/brief-lint.ts';
import { briefTask, briefTemplateWords, hasClientArea, lintFor, templateFixedText } from '../runtime/venture/build/brief.ts';
import { CAFE_COMPOSE, CAFE_COMPOSE_CLIENT_AREA, CAFE_DECIDE, CAFE_TEXT, planEntries } from './fixtures/venture/compose-unit/plans.ts';
import { PASSPHRASE, compose as composePlan, connectPair, engineFor } from './fixtures/venture/compose-unit/harness.ts';
import { CANNOT_SAY, CANNOT_SAY_FIXTURE, CANNOT_SAY_WORKFLOW } from '../runtime/venture/build/github.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const phone: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' };
const clock = () => new Date('2026-10-15T10:00:00.000Z');
const IDEA = 'Monthly bookkeeping for cafes and small shops in Pune, done by AI helpers with me checking every report.';
const TOKEN = 'github_pat_test_not_a_real_token_00';
const REPO_URL = 'https://github.com/demo-owner/ledger-cafe-books';
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const BASE = '/repos/demo-owner/ledger-cafe-books';
const code = (expected: string) => (error: any) => { assert.equal(error.code, expected, error.message); return true; };

const INDIA: CountryProfile = {
  code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, region: 'india',
  tax: {
    mode: 'gst', label: 'GST', standardRateBps: '1800',
    registrationNote: 'Service businesses usually register for GST above a yearly turnover of INR 20 lakh (INR 10 lakh in special category states). Some must register earlier. Check with a CA.',
    idLabel: 'GSTIN', idPattern: null, invoiceKind: 'tax-invoice', checkedOn: '2026-10-15',
  },
  paymentRails: ['razorpay', 'cashfree', 'paypal'], dateOrder: 'day-month-year', complianceNotes: [],
};

const githubFixture: GitHubFixture = JSON.parse(await readFile(new URL('./fixtures/venture/build/github-lovable.json', import.meta.url), 'utf8'));
const briefFixture: { label: string; output: BriefModelOutput } = JSON.parse(await readFile(new URL('./fixtures/venture/build/brief-model.json', import.meta.url), 'utf8'));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function createShelf(): SecretShelf {
  const map = new Map<SecretName, string>();
  return {
    get: name => map.get(name) ?? null,
    set: (name, value) => { map.set(name, value); },
    delete: name => { map.delete(name); },
    has: name => map.has(name),
    clear: () => map.clear(),
  };
}

function stubModels() {
  const tasks: ModelTask<any>[] = [];
  let fixture: unknown;
  const unused = () => { throw new Error('This stub port method is not used by the build package.'); };
  const port: ModelPort = {
    status: unused, presets: unused, checkCli: async () => unused(),
    preview: async () => unused(), runPreview: async () => unused(),
    async generate<T>(_ctx: Context, task: ModelTask<T>) {
      tasks.push(task);
      if (fixture === undefined) {
        return { value: task.template!(), by: 'template' as const, callId: null, presetId: 'built-in-templates' as const, model: null, costMicros: '0', priceConfirmed: true };
      }
      const value = task.validate(structuredClone(fixture));
      return { value, by: 'model' as const, callId: 'modelcall_synthetic', presetId: 'anthropic-sonnet-5-5' as const, model: 'claude-sonnet-5-5', costMicros: '0', priceConfirmed: true };
    },
  };
  return { port, tasks, setFixture(value: unknown) { fixture = value; } };
}

type Recorder = { requests: GitHubRequest[] };
function recording(transport: GitHubTransport, recorder: Recorder): GitHubTransport {
  return { kind: transport.kind, read: async request => { recorder.requests.push(structuredClone(request)); return transport.read(request); } };
}

function latestBriefId(store: VentureTestStore): string {
  const briefs = listRecords(store.read(), 'venture-brief');
  return briefs.length ? briefs.reduce((a, b) => (b.version > a.version ? b : a)).briefId : '';
}

function setup() {
  const store = new VentureTestStore();
  const models = stubModels();
  const secrets = createShelf();
  const recorder: Recorder = { requests: [] };
  const deps: VentureDeps = {
    store, clock, models: models.port, services: {} as VentureDeps['services'],
    github: recording(createFixtureGitHubTransport(githubFixture, () => ({ briefId: latestBriefId(store) })), recorder),
    secrets, host: 'test', demo: true, storage: 'experimental-file',
  };
  const useGitHub = (fixture: GitHubFixture | GitHubTransport) => {
    const transport = 'read' in fixture ? fixture : createFixtureGitHubTransport(fixture as GitHubFixture, () => ({ briefId: latestBriefId(store) }));
    deps.github = recording(transport, recorder);
  };
  return { store, deps, models, secrets, recorder, useGitHub };
}

const label = <T>(value: T, lineLabel: LineLabel = 'assumption', by: LineAuthor = 'template') => ({ value, label: lineLabel, by });

function blueprintRecord(tx: VentureTx, options: { status: 'draft' | 'accepted'; digest: string; offer1Description?: string; offer2Price?: string | null; starter?: string[] }): BlueprintRecord {
  const offer2Price = options.offer2Price ?? null;
  return {
    ...tx.base('venture-blueprint'), version: 1, status: options.status, source: 'template', structureHash: 'synthetic-structure', digest: options.digest,
    modelCallIds: [], serviceType: 'bookkeeping',
    name: label('Ledger Cafe Books'), oneLiner: label('Monthly books for cafes and small shops.'), customer: label('Cafe and small shop owners in Pune'),
    offers: [
      { id: 'offer_1', name: label('Monthly books'), description: label(options.offer1Description ?? 'Monthly bookkeeping with a report you check.'),
        pricing: { model: 'monthly', quantityUnit: 'month', unitPriceMinor: '249900', unitPriceLabel: 'told-by-you', defaultQuantity: '1' } },
      { id: 'offer_2', name: label('Clean up project'), description: label('A one time clean up of past books.'),
        pricing: { model: 'project', quantityUnit: 'project', unitPriceMinor: offer2Price, unitPriceLabel: offer2Price ? 'told-by-you' : 'not-set', defaultQuantity: '1' } },
    ],
    deliverySteps: STEP_PLAN.map((step, i) => ({
      id: step.id, title: label(['Collect the bills', 'Sort the entries', 'Draft the monthly report for review', 'Send the report'][i]),
      doneBy: step.doneBy, capability: step.capability, note: step.note,
    })),
    approvals: [label('The monthly report before it goes out'), label('Every invoice before it is sent')],
    backOffice: {
      currency: 'INR', taxMode: 'gst', taxLabel: 'GST', taxRegistered: label(true, 'told-by-you', 'owner'), taxRateBps: '1800', taxRateBy: 'country-table',
      taxId: null, taxState: null, sacCode: null, lutConfirmed: false, invoiceKind: 'tax-invoice', taxInvoiceReady: false,
      taxInvoiceMissing: ['Your GSTIN', 'Your state', 'Your SAC code'], paymentRail: 'razorpay', invoicePrefix: 'INV',
    },
    starterConnectorIds: options.starter ?? ['lovable', 'github', 'razorpay', 'mail-app', 'cal-com', 'chausar-books'],
  };
}

// INR 2,499.00 per month, 1 month, GST 1800 bps, single (worked by hand, spec 6.1):
// tax = (249900 x 1800 + 5000) / 10000 = 449,825,000 / 10000 = 44982 (INR 449.82); total 249900 + 44982 = 294882 (INR 2,948.82).
function receiptRecord(tx: VentureTx, offerId: string, blueprintDigest: string, options: { stale?: boolean } = {}): PriceReceiptRecord {
  const figure = (key: PriceReceiptRecord['figures'][number]['key'], text: string, minor: string, display: string) => ({ key, label: text, minor, display, currency: 'INR' });
  return {
    ...tx.base('venture-price-receipt'), subject: { type: 'offer', offerId }, operation: 'venture.price', currency: 'INR', minorDigits: 2,
    inputs: {
      unitPriceMinor: '249900', quantity: '1', discountBps: '0', taxMode: 'gst', taxRateBps: '1800', taxTreatment: 'single',
      unitPriceBy: 'told-by-you', taxRateBy: 'country-table', blueprintDigest,
    },
    steps: [],
    figures: [
      figure('unit', 'Unit price', '249900', 'INR 2,499.00'), figure('subtotal', 'Subtotal', '249900', 'INR 2,499.00'),
      figure('discount', 'Discount', '0', 'INR 0.00'), figure('taxable', 'Taxable', '249900', 'INR 2,499.00'),
      figure('tax', 'GST at 18%', '44982', 'INR 449.82'), figure('total', 'Total', '294882', 'INR 2,948.82'),
    ],
    totalMinor: '294882', allowedNumbers: [], explanation: '1 x month at INR 2,499.00, plus GST at 18% (INR 449.82) = INR 2,948.82.',
    digest: 'synthetic-receipt', stale: options.stale === true,
  };
}

type SeedOptions = { idea?: string; accepted?: boolean; receipt?: 'current' | 'none' | 'old-digest' | 'stale'; offer1Description?: string; offer2Price?: string | null; starter?: string[] };
async function seedVenture(deps: VentureDeps, options: SeedOptions = {}) {
  return ventureAction(deps, owner, 'admin', 'seed', tx => {
    const venture = tx.put({
      ...tx.base('venture-record'), idea: options.idea ?? IDEA, ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books', country: INDIA, serviceType: 'bookkeeping',
      status: 'build', launchStage: 'rehearsal', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
    });
    const accepted = options.accepted !== false;
    const blueprint = tx.put(blueprintRecord(tx, {
      status: accepted ? 'accepted' : 'draft', digest: 'blueprint-digest-1', offer1Description: options.offer1Description,
      offer2Price: options.offer2Price, starter: options.starter,
    }));
    tx.touch({ blueprintId: blueprint.id, acceptedBlueprintId: accepted ? blueprint.id : null });
    const receipt = options.receipt ?? 'current';
    if (receipt === 'current') tx.put(receiptRecord(tx, 'offer_1', blueprint.digest));
    if (receipt === 'old-digest') tx.put(receiptRecord(tx, 'offer_1', 'blueprint-digest-0'));
    if (receipt === 'stale') tx.put(receiptRecord(tx, 'offer_1', blueprint.digest, { stale: true }));
    return { venture, blueprint };
  }, { create: true });
}

async function seedClientAndOrder(deps: VentureDeps) {
  return ventureAction(deps, owner, 'prepare', 'seed.client', tx => {
    const client: ClientRecord = { ...tx.base('venture-client'), name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null };
    tx.put(client);
    const order: OrderRecord = {
      ...tx.base('venture-order'), clientId: client.id, offerId: 'offer_1', quantity: '1',
      request: 'Please close my September books. The bank statement and bills are in the shared folder.',
      status: 'open', priceReceiptId: 'price_synthetic', deliveredOn: null, saleFactId: null,
    };
    tx.put(order);
    return { client, order };
  });
}

const brief = (deps: VentureDeps, payload: Record<string, unknown> = { useTemplate: true }) =>
  handlers['venture.build.brief']!(deps, owner, payload) as Promise<BriefRecord>;
const handoff = (deps: VentureDeps, builder: BuilderId, ctx: Context = owner) => handlers['venture.build.handoff']!(deps, ctx, { builder });
const opened = (deps: VentureDeps, handoffId: string, ctx: Context = owner) => handlers['venture.build.handoffOpened']!(deps, ctx, { handoffId });
const link = (deps: VentureDeps, payload: Record<string, unknown>, ctx: Context = owner) => handlers['venture.build.link']!(deps, ctx, payload);
const sync = (deps: VentureDeps) => handlers['venture.build.sync']!(deps, owner, {});
const status = (deps: VentureDeps) => handlers['venture.build.status']!(deps, owner, {});

function sectionLines(markdown: string, heading: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.indexOf(heading);
  assert.ok(start >= 0, `missing ${heading}`);
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end++;
  while (end > start + 1 && lines[end - 1] === '') end--; // the blank line before the next heading
  return lines.slice(start + 1, end);
}

function events(store: VentureTestStore) {
  return listRecords(store.read(), 'venture-event').sort((a, b) => a.seq - b.seq).map(e => e.name);
}

// ---------------------------------------------------------------------------
// 1. Template brief
// ---------------------------------------------------------------------------

test('template brief: eleven sections, receipts copied exactly, fixed lines, the policy line and a clean lint', async () => {
  const { deps, store } = setup();
  await seedVenture(deps);
  const record = await brief(deps);
  const md = record.markdown;
  const lines = md.split('\n');

  assert.equal(record.wordsBy, 'template');
  assert.equal(record.modelCallId, null);
  assert.equal(record.version, 1);
  assert.match(record.briefId, /^chb_[a-z0-9]{8}$/);
  assert.equal(record.lint.ok, true, JSON.stringify(record.lint.findings));
  assert.ok(md.length < 9000);
  assert.equal(record.chars, md.length);
  for (const heading of BRIEF_HEADINGS) assert.equal(lines.filter(line => line === heading).length, 1, heading);
  assert.deepEqual(lines.filter(line => line.startsWith('## ')), [...BRIEF_HEADINGS]);

  assert.equal(lines[0], `Build brief from Chausar. Business type: ${SERVICE_TYPE_LABELS.bookkeeping}. Brief id: ${record.briefId}.`);
  const prices = sectionLines(md, '## 3. Offer and prices (copy exactly)');
  assert.ok(prices.includes('- Monthly books: INR 2,948.82 per month, including GST. Monthly bookkeeping with a report you check.'), prices.join('\n'));
  assert.ok(prices.includes('- Clean up project: price to be set. A one time clean up of past books.'));

  const data = sectionLines(md, '## 5. Data rules');
  for (const line of REQUIRED_BRIEF_LINES.slice(0, 4)) assert.ok(data.includes(line), line);
  assert.ok(data.includes('Add no tracking scripts.'));
  assert.ok(data.some(line => line.startsWith('Turn on row level security for every table')));

  const look = sectionLines(md, '## 7. Look and feel');
  assert.ok(look.some(line => line.includes('lintapple@0.1.20')));
  for (const line of REQUIRED_BRIEF_LINES.slice(4)) assert.ok(look.includes(line), line);
  const policyLine = look.find(line => line.startsWith('- Save this as ui-policy.json at the root: '))!;
  assert.equal(policyLine.slice('- Save this as ui-policy.json at the root: '.length), UI_POLICY);
  const policy = JSON.parse(UI_POLICY);
  assert.deepEqual(Object.keys(policy), ['fonts', 'fontSizes', 'typeRules', 'minControlSize', 'controlSizeRules', 'minControlGap', 'minControlInset',
    'controlContainers', 'minLayoutGap', 'bannedCopy', 'viewports', 'colorSchemes', 'exceptions']);
  assert.ok(policy.controlContainers.length > 0);
  for (const word of policy.bannedCopy) assert.deepEqual(houseStyleFindings(word), []);

  const repo = sectionLines(md, '## 9. Repo setup');
  assert.ok(repo.includes(`chausar-brief-id: ${record.briefId}`));
  assert.ok(repo.includes(`Add <meta name="chausar-brief" content="${record.briefId}"> to the page head.`));
  const country = sectionLines(md, '## 8. Country notes').join(' ');
  assert.match(country, /^Currency: INR\. Dates: day, then month, then year\./);
  assert.ok(country.includes('International cards need Terms, Privacy, Refund and Shipping pages, so add them.'));
  assert.ok(sectionLines(md, '## 6. Payments and money').join(' ').endsWith('Payments use Razorpay.'));
  assert.ok(!md.includes('—'));
  assert.deepEqual(houseStyleFindings(md), []);

  // The record and the event.
  const stored = listRecords(store.read(), 'venture-brief');
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].priceReceiptIds.length, 1);
  assert.equal(stored[0].blueprintDigest, 'blueprint-digest-1');
  assert.ok(events(store).includes('brief-ready'));

  // A second brief is version 2 with a new id.
  const second = await brief(deps);
  assert.equal(second.version, 2);
  assert.notEqual(second.briefId, record.briefId);
});

test('template brief words carry no digits, no house-style words and stay within the brief limits for every service type', () => {
  for (const type of SERVICE_TYPES) {
    for (const words of templateFixedText(type)) {
      assert.doesNotThrow(() => assertNoNumbers(words, 'template words'), `${type}: ${words}`);
      assert.deepEqual(houseStyleFindings(words), [], `${type}: ${words}`);
    }
    const output = briefTemplateWords(type, { name: 'Plain Name', customer: 'Owners of small shops' });
    assert.ok(output.whatToBuild.length <= 600 && output.whoItIsFor.length <= 400 && output.lookAndFeel.length <= 300);
    assert.ok(output.pages.length >= 4 && output.pages.length <= 6);
    assert.ok(output.doneMeans.length >= 4 && output.doneMeans.length <= 8 && output.doneMeans.every(line => line.length <= 120));
    assert.doesNotThrow(() => assertNoNumbers(JSON.stringify(output), 'template output'));
  }
});

test('the brief never holds client names, emails or requests, in the model task or the markdown', async () => {
  const { deps, models } = setup();
  await seedVenture(deps);
  const { client, order } = await seedClientAndOrder(deps);
  const record = await brief(deps, {});
  assert.equal(models.tasks.length, 1);
  const task = models.tasks[0];
  assert.equal(task.purpose, 'brief');
  assert.equal(task.schemaName, 'venture-brief');
  assert.equal(task.maxOutputTokens, 4096);
  assert.equal(task.containsClientData, false);
  assert.deepEqual(Object.keys(task.input as object).sort(), ['country', 'customer', 'name', 'offers', 'oneLiner', 'serviceType', 'steps']);
  const input = JSON.stringify(task.input);
  for (const secret of [client.name, client.email!, order.request]) {
    assert.ok(!input.includes(secret), secret);
    assert.ok(!record.markdown.includes(secret), secret);
  }
  assert.ok(!/\d/.test(input.replace(/"country":"India"/, '')), 'the model input carries no amounts');
  assert.ok(!JSON.stringify(task.schema).includes('"number"') && !JSON.stringify(task.schema).includes('"integer"'));
});

// ---------------------------------------------------------------------------
// 2. Prices
// ---------------------------------------------------------------------------

test('a priced offer without a current receipt refuses PRICE_REQUIRED naming the offer; no plan refuses BLUEPRINT_NOT_ACCEPTED', async () => {
  for (const receipt of ['none', 'old-digest', 'stale'] as const) {
    const { deps, models, store } = setup();
    await seedVenture(deps, { receipt });
    await assert.rejects(brief(deps, {}), (error: any) => {
      assert.equal(error.code, 'PRICE_REQUIRED');
      assert.equal(error.message, 'Price Monthly books again before writing the brief.');
      return true;
    });
    assert.equal(models.tasks.length, 0, 'no model call before the price check');
    assert.equal(listRecords(store.read(), 'venture-brief').length, 0);
  }
  const { deps } = setup();
  await seedVenture(deps, { accepted: false });
  await assert.rejects(brief(deps), code('BLUEPRINT_NOT_ACCEPTED'));
});

test('an unpriced offer is written as "price to be set"; two priced offers each need a receipt', async () => {
  const { deps } = setup();
  await seedVenture(deps, { offer2Price: '1500000' });
  await assert.rejects(brief(deps), (error: any) => error.code === 'PRICE_REQUIRED' && error.message.includes('Clean up project'));
});

// ---------------------------------------------------------------------------
// 3. Model brief
// ---------------------------------------------------------------------------

test('model brief: fixture words land in the brief; numbers, headings and new lines in titles are handled', async () => {
  const { deps, models, store } = setup();
  await seedVenture(deps);
  models.setFixture(briefFixture.output);
  assert.equal(briefFixture.label, 'synthetic recording');
  const record = await brief(deps, {});
  assert.equal(record.wordsBy, 'model');
  assert.equal(record.modelCallId, 'modelcall_synthetic');
  assert.equal(record.lint.ok, true, JSON.stringify(record.lint.findings));
  assert.deepEqual(sectionLines(record.markdown, '## 1. What to build'), briefFixture.output.whatToBuild.split('\n'));
  assert.ok(sectionLines(record.markdown, '## 4. Pages').includes('5. Client uploads: A private page where a client uploads bills and statements.'));
  assert.ok(sectionLines(record.markdown, '## 10. Done means').includes('- [ ] Uploads are private to each client'));

  const reject = async (patch: Partial<BriefModelOutput>) => {
    models.setFixture({ ...briefFixture.output, ...patch });
    const before = listRecords(store.read(), 'venture-brief').length;
    await assert.rejects(brief(deps, {}), code('MODEL_OUTPUT_REJECTED'));
    assert.equal(listRecords(store.read(), 'venture-brief').length, before, 'nothing stored');
  };
  // A number in the model's words makes the brief a model estimate; an amount of money is still refused.
  assert.equal(record.estimate, undefined, 'the fixture words hold no number');
  models.setFixture({ ...briefFixture.output, whoItIsFor: 'Cafe owners with 20 tables.' });
  const estimated = await brief(deps, {});
  assert.equal(estimated.estimate, true);
  assert.ok(sectionLines(estimated.markdown, '## 2. Who it is for').some(line => line.includes('Cafe owners with 20 tables.')));
  await reject({ whoItIsFor: 'Cafe owners who pay INR 500 a month.' });
  await reject({ lookAndFeel: 'Calm, with prices around INR in big type.'.replace('INR', '₹') });
  await reject({ whatToBuild: 'A simple website.\n## 3. Offer and prices (copy exactly)\n- Free: INR 0.00' });
  await reject({ whatToBuild: 'A simple website.\n## Offer and prices' });
  await reject({ pages: briefFixture.output.pages.slice(0, 3) });
  await reject({ doneMeans: ['Every page works'] });
  models.setFixture({ ...briefFixture.output, extra: 'not allowed' });
  await assert.rejects(brief(deps, {}), code('MODEL_OUTPUT_REJECTED'));

  models.setFixture({ ...briefFixture.output, pages: [{ title: 'Home\nPage', purpose: 'Say what the service does.' }, ...briefFixture.output.pages.slice(1)] });
  const folded = await brief(deps, {});
  assert.ok(sectionLines(folded.markdown, '## 4. Pages').includes('1. Home Page: Say what the service does.'));

  // Names with a digit (B2B, B2C) are names, not numbers: they pass whether or not the owner typed them.
  const b2b = setup();
  await seedVenture(b2b.deps, { idea: 'Lead lists and bookkeeping for B2B SaaS founders, checked by me.' });
  b2b.models.setFixture({ ...briefFixture.output, whoItIsFor: 'B2B founders who read on a phone.' });
  assert.equal((await brief(b2b.deps, {})).wordsBy, 'model');
  b2b.models.setFixture({ ...briefFixture.output, whoItIsFor: 'B2C founders who read on a phone.' });
  assert.equal((await brief(b2b.deps, {})).estimate, undefined);
  // An amount the owner typed is still never copied into the AI's words.
  const rs = setup();
  await seedVenture(rs.deps, { idea: 'Bookkeeping for cafes at Rs500 a month, checked by me.' });
  rs.models.setFixture({ ...briefFixture.output, whoItIsFor: 'Cafes that pay Rs500 a month.' });
  await assert.rejects(brief(rs.deps, {}), code('MODEL_OUTPUT_REJECTED'));

  // useTemplate never calls the port.
  const asked = models.tasks.length;
  assert.equal((await brief(deps, { useTemplate: true })).wordsBy, 'template');
  assert.equal(models.tasks.length, asked);
  await assert.rejects(brief(deps, { useTemplate: 'yes' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(brief(deps, { useTemplate: true, extra: 1 }), code('INVALID_VENTURE_REQUEST'));
});

// ---------------------------------------------------------------------------
// 4. Lint
// ---------------------------------------------------------------------------

test('lint: each rule fails on one bad input and passes on the good brief', async () => {
  const { deps, store } = setup();
  await seedVenture(deps);
  const good = await brief(deps);
  const receipts = listRecords(store.read(), 'venture-price-receipt');
  const id = good.briefId;
  assert.equal(lintBrief(good.markdown, receipts, id).ok, true);

  const rules = (markdown: string, briefId = id) => lintBrief(markdown, receipts, briefId).findings.map(f => f.rule);
  const has = (markdown: string, rule: string, briefId = id) => {
    const result = lintBrief(markdown, receipts, briefId);
    assert.equal(result.ok, false);
    assert.ok(result.findings.some(f => f.rule === rule), `${rule} not in ${JSON.stringify(result.findings)}`);
    for (const finding of result.findings) {
      assert.ok(finding.message.length <= 512);
      assert.ok(finding.line === null || (Number.isInteger(finding.line) && finding.line >= 1));
    }
  };
  const md = good.markdown;

  has(md.replace('INR 2,948.82 per month', 'INR 2,999.00 per month'), 'price-mismatch');
  assert.deepEqual(rules(md.replace('INR 2,948.82 per month', 'INR 2,999.00 per month')), ['price-mismatch']);
  const mismatch = lintBrief(md.replace('INR 2,948.82 per month', 'INR 2,999.00 per month'), receipts, id).findings[0];
  assert.equal(md.split('\n')[mismatch.line! - 1].includes('INR 2,948.82'), true, 'the finding points at the offer line');
  has(md.replace('Calm and plain', 'Calm — plain'), 'em-dash');
  has(md.replace('Calm and plain', 'Calm and leveraging plain'), 'banned-word');
  has(md.replace('No features beyond this brief.', 'Write to owner@example.com.'), 'contact-detail');
  has(md.replace('No features beyond this brief.', 'Call +91 98765 43210.'), 'contact-detail');
  has(md.replace('\n## 7. Look and feel\n', '\n'), 'required-section');
  has(`${md}\n\n## 4. Pages\n1. Extra: Another page.`, 'required-section');
  has(md.replace('## 2. Who it is for', '## 2. Who it is for, maybe'), 'required-section');
  const swapped = md.replace('## 10. Done means', '## 10. TEMP').replace('## 11. Do not', '## 10. Done means').replace('## 10. TEMP', '## 11. Do not');
  has(swapped, 'required-section');
  has(md, 'brief-id', 'chb_BAD');
  has(md.replace(`Brief id: ${id}.`, 'Brief id: chb_zzzzzzzz.'), 'brief-id');
  has(md.replace(`chausar-brief-id: ${id}`, 'chausar-brief-id: chb_zzzzzzzz'), 'brief-id');
  has(md.replace('Build brief from Chausar.', 'Build brief.'), 'first-line');
  has(md.replace(`${REQUIRED_BRIEF_LINES[0]}\n`, ''), 'required-text');
  has(md.replace('lintapple@0.1.20', 'lintapple@0.1.21'), 'required-text');
  has(md.replace('Use no secrets. ', ''), 'required-text');
  has(`${md}\n${'Plain words. '.repeat(700)}`, 'too-long');
  // A trailing comma after an amount is punctuation, not part of the price.
  assert.deepEqual(rules(md.replace('INR 2,948.82 per month', 'INR 2,948.82, per month')), []);
});

// ---------------------------------------------------------------------------
// 5. Handoff
// ---------------------------------------------------------------------------

/** Deterministic made-up words, about as hard to compress as real prose (LZ ratio near one). */
function pseudoProse(length: number): string {
  let seed = 7;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed >> 16; };
  let text = '';
  while (text.length < length) {
    const size = 2 + next() % 8;
    let word = '';
    for (let i = 0; i < size; i++) word += String.fromCharCode(97 + next() % 26);
    text += word + (next() % 9 === 0 ? '. ' : ' ');
  }
  return text.slice(0, length);
}

test('handoff links: Lovable hash and Replit LZ round trips, copy for Bolt and v0, fixed notes, never autosubmit', async () => {
  assert.equal(compressToEncodedURIComponent('prompt'), 'A4Jw9gtsAuQ');
  assert.equal(compressToEncodedURIComponent('Personal portfolio site.'), 'AoUwTgzg9gdghgGwAQAcpgC4DMoIJZRIR4YgB0QA');
  assert.equal(decompressFromEncodedURIComponent('A4Jw9gtsAuQ'), 'prompt');
  assert.equal(decompressFromEncodedURIComponent('AoUwTgzg9gdghgGwAQAcpgC4DMoIJZRIR4YgB0QA'), 'Personal portfolio site.');

  const { deps } = setup();
  await seedVenture(deps);
  const markdown = (await brief(deps)).markdown;

  const lovable = planHandoff('lovable', markdown);
  assert.equal(lovable.mode, 'link');
  assert.ok(lovable.url.startsWith('https://lovable.dev/#prompt='));
  assert.equal(new URLSearchParams(new URL(lovable.url).hash.slice(1)).get('prompt'), markdown);
  assert.deepEqual(lovable.notes, ['Lovable keeps your brief in this browser until you press send.', 'To follow the build, open Project settings, then Git, then GitHub, then Connect.']);

  const replit = planHandoff('replit', markdown);
  assert.equal(replit.mode, 'link');
  assert.ok(replit.url.startsWith('https://replit.com/?stack=Build&prompt=') && replit.url.endsWith('&referrer=chausar'));
  assert.equal(decompressFromEncodedURIComponent(new URL(replit.url).searchParams.get('prompt')), markdown);
  assert.deepEqual(replit.notes, ['Replit receives this brief as soon as the page opens.', "To follow the build, open Replit's Git tool, connect GitHub and turn on auto-sync."]);

  const long = pseudoProse(12000);
  const longReplit = planHandoff('replit', long);
  assert.equal(longReplit.mode, 'copy');
  assert.equal(longReplit.url, 'https://replit.com/');
  assert.equal(longReplit.clipboardText, long);
  assert.equal(longReplit.notes[1], "To follow the build, open Replit's Git tool, connect GitHub and turn on auto-sync.");
  assert.ok(!longReplit.notes.includes('Replit receives this brief as soon as the page opens.'));

  for (const builder of ['bolt', 'v0'] as const) {
    const plan = planHandoff(builder, markdown);
    assert.equal(plan.mode, 'copy');
    assert.equal(plan.status, 'available');
    assert.equal(plan.url, builder === 'bolt' ? 'https://bolt.new/' : 'https://v0.app/');
    assert.equal(plan.clipboardText, markdown);
    assert.deepEqual(plan.notes, ['No official link exists, and a pasted link may start building at once, so Chausar copies the brief for you to paste.']);
  }
  for (const builder of ['lovable', 'replit', 'bolt', 'v0'] as const) {
    for (const text of [markdown, long]) {
      const plan = planHandoff(builder, text);
      assert.equal(plan.label, 'handoff');
      assert.equal(plan.status, 'available');
      assert.equal(new URL(plan.url).protocol, 'https:');
      for (const banned of ['autosubmit', 'newprojectprompt', 'connectornames', 'file_id']) assert.ok(!plan.url.toLowerCase().includes(banned), `${builder} ${banned}`);
      assert.ok(plan.url.length <= 30000);
    }
  }
  assert.throws(() => planHandoff('lovable', '   '), code('INVALID_VENTURE_REQUEST'));
});

test('venture.build.handoff and handoffOpened: lint gate, records, events, once only, unknown ids and app-only approval', async () => {
  const { deps, store } = setup();
  await seedVenture(deps);
  await assert.rejects(handoff(deps, 'lovable'), code('BRIEF_NOT_FOUND'));
  const written = await brief(deps);

  const plan = await handoff(deps, 'lovable');
  assert.match(plan.handoffId, /^handoff_/);
  assert.equal(plan.mode, 'link');
  assert.equal(new URLSearchParams(new URL(plan.url).hash.slice(1)).get('prompt'), written.markdown);
  const record = listRecords(store.read(), 'venture-handoff').find(r => r.id === plan.handoffId)!;
  assert.equal(record.openedAt, null);
  assert.equal(record.briefId, written.briefId);
  assert.equal(record.briefDigest, written.digest);
  assert.ok(!JSON.stringify(record).includes('lovable.dev/#prompt'), 'the URL itself is not stored');
  assert.equal(events(store).at(-1), 'handoff-prepared');

  const first = await opened(deps, plan.handoffId);
  assert.equal(first.openedAt, clock().toISOString());
  const again = await opened(deps, plan.handoffId);
  assert.equal(again.openedAt, first.openedAt);
  assert.equal(events(store).filter(name => name === 'handoff-opened').length, 1);

  await assert.rejects(opened(deps, 'handoff_unknown'), code('HANDOFF_NOT_FOUND'));
  assert.throws(() => requireAppChannel(phone, 'venture.build.handoffOpened'), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(opened(deps, plan.handoffId, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(opened(deps, plan.handoffId, { ...owner, sourceTainted: true }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(handlers['venture.build.handoff']!(deps, owner, { builder: 'cursor' }), code('INVALID_VENTURE_REQUEST'));

  const copy = await handoff(deps, 'bolt');
  assert.equal(copy.mode, 'copy');
  assert.equal(listRecords(store.read(), 'venture-handoff').find(r => r.id === copy.handoffId)!.mode, 'copy');
});

test('venture.build.handoff refuses BRIEF_LINT_FAILED when the latest brief failed its lint', async () => {
  const { deps } = setup();
  await seedVenture(deps, { offer1Description: 'Monthly books. Write to owner@example.com to start.' });
  const written = await brief(deps);
  assert.equal(written.lint.ok, false);
  assert.ok(written.lint.findings.some(f => f.rule === 'contact-detail'));
  await assert.rejects(handoff(deps, 'replit'), code('BRIEF_LINT_FAILED'));
});

// ---------------------------------------------------------------------------
// 6. GitHub
// ---------------------------------------------------------------------------

function variant(change: (responses: GitHubFixture['responses']) => void): GitHubFixture {
  const copy: GitHubFixture = structuredClone(githubFixture);
  change(copy.responses);
  return copy;
}
const commitsPath = `${BASE}/commits?sha=main&per_page=20`;
const runsPath = `${BASE}/actions/runs?head_sha=${SHA}&per_page=5`;
const workflowPath = `${BASE}/contents/.github/workflows/ui-lint.yml?ref=${SHA}`;
const agentsPath = `${BASE}/contents/AGENTS.md?ref=${SHA}`;

async function linked(seed: SeedOptions = {}) {
  const env = setup();
  await seedVenture(env.deps, seed);
  const written = await brief(env.deps);
  const follow = await link(env.deps, { repo: REPO_URL, token: TOKEN });
  return { ...env, written, follow };
}

test('GitHub sync with the Lovable recording: author from logins, marker, workflow, checks, honest limits and a read receipt', async () => {
  const { deps, store, recorder, written, follow } = await linked();
  assert.deepEqual(follow.repo, { owner: 'demo-owner', name: 'ledger-cafe-books' });
  assert.equal(follow.tokenState, 'in-memory');
  const result = await sync(deps);

  assert.equal(result.lastCommit?.by, 'lovable');
  assert.equal(result.lastCommit?.sha, SHA);
  assert.equal(result.lastCommit?.at, '2026-10-15T09:58:00.000Z');
  assert.equal(result.lastCommit?.message, 'Add plans page');
  assert.equal(result.briefMarker, 'found');
  assert.equal(result.briefMarkerVersion, written.version);
  assert.equal(result.markerFile, 'AGENTS.md');
  assert.equal(result.uiWorkflow, 'found');
  assert.equal(result.checks, 'passed');
  assert.equal(result.deployment, null);
  assert.equal(result.syncConflictBranch, null);
  assert.equal(result.word, 'builder-making-changes');
  assert.deepEqual(result.repo, { fullName: 'demo-owner/ledger-cafe-books', private: true, defaultBranch: 'main', htmlUrl: 'https://github.com/demo-owner/ledger-cafe-books' });
  assert.deepEqual(result.cannotSay, [...CANNOT_SAY, CANNOT_SAY_FIXTURE]);
  assert.equal(result.cannotSay.length, 6);
  for (const line of result.cannotSay) assert.doesNotMatch(line, /\b(built|working|launched|secure)\b/i);

  assert.deepEqual(recorder.requests.map(r => r.path), [
    BASE, commitsPath, `${BASE}/branches?per_page=100`, agentsPath, workflowPath, runsPath, `${BASE}/deployments?per_page=5`,
  ]);
  assert.deepEqual(recorder.requests.map(r => r.accept), ['json', 'json', 'json', 'raw', 'raw', 'json', 'json']);
  assert.ok(recorder.requests.every(r => r.token === TOKEN && r.etag === null));

  const reads = listRecords(store.read(), 'venture-build-read');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].id, result.readId);
  assert.equal(reads[0].transport, 'fixture');
  assert.equal(reads[0].calls.length, 7);
  assert.deepEqual(reads[0].calls.map(c => c.path), recorder.requests.map(r => r.path));
  assert.ok(reads[0].calls.every(c => /^[0-9a-f]{64}$/.test(c.bodyDigest) && c.status === 200));
  assert.equal(reads[0].calls[0].etag, '"repo-1"');
  const followRecord = listRecords(store.read(), 'venture-build-follow').at(-1)!;
  assert.deepEqual(followRecord.lastStatus, result);
  assert.equal(events(store).at(-1), 'repo-synced');
  assert.ok(!JSON.stringify(store.read()).includes(TOKEN), 'the token never reaches state');

  const view = await status(deps);
  assert.equal(view.tokenLink, TOKEN_LINK);
  assert.equal(view.follow?.id, followRecord.id);
  assert.equal(view.brief?.briefId, written.briefId);
  assert.deepEqual(view.handoffs, []);
});

test('GitHub authorship: the git author name is never trusted; Replit handoffs say "the repo\'s account"', async () => {
  const person = variant(r => {
    const commits = r[commitsPath].body as any[];
    commits[0].author = { login: 'demo-person' };
    commits[0].committer = { login: 'web-flow' };
  });
  {
    const { deps, useGitHub } = await linked();
    useGitHub(person);
    assert.equal((await sync(deps)).lastCommit?.by, 'you');
  }
  {
    const { deps, useGitHub } = await linked();
    await handoff(deps, 'lovable');
    await handoff(deps, 'replit');
    useGitHub(person);
    const result = await sync(deps);
    assert.equal(result.lastCommit?.by, 'repo-account');
    assert.equal(result.word, 'repo-connected');
    const view = await status(deps);
    assert.deepEqual(view.handoffs.map(h => h.builder), ['replit', 'lovable']);
  }
  {
    const { deps, useGitHub } = await linked();
    useGitHub(variant(r => { (r[commitsPath].body as any[])[0].author = { login: 'replit-agent[bot]' }; }));
    assert.equal((await sync(deps)).lastCommit?.by, 'replit');
    useGitHub(variant(r => { (r[commitsPath].body as any[])[0].author = { login: 'dependabot[bot]' }; }));
    assert.equal((await sync(deps)).lastCommit?.by, 'other');
    useGitHub(variant(r => { (r[commitsPath].body as any[])[0].author = null; (r[commitsPath].body as any[])[0].committer = { login: 'gpt-engineer-app[bot]' }; }));
    assert.equal((await sync(deps)).lastCommit?.by, 'lovable');
  }
});

test('GitHub marker, workflow, checks, conflicts and deployments follow what the files say', async () => {
  {
    // An older brief id in AGENTS.md gives "older" with that version.
    const { deps, useGitHub, written } = await linked();
    const newer = await brief(deps);
    assert.equal(newer.version, 2);
    useGitHub(variant(r => { r[agentsPath].body = `chausar-brief-id: ${written.briefId}\n`; }));
    const result = await sync(deps);
    assert.equal(result.briefMarker, 'older');
    assert.equal(result.briefMarkerVersion, 1);
    useGitHub(variant(r => { r[agentsPath].body = 'chausar-brief-id: chb_00000000\n'; }));
    assert.equal((await sync(deps)).briefMarker, 'missing');
  }
  {
    // No AGENTS.md: replit.md is read instead.
    const { deps, useGitHub, recorder } = await linked();
    useGitHub(variant(r => {
      r[`${BASE}/contents/replit.md?ref=${SHA}`] = { status: 200, etag: null, body: 'chausar-brief-id: {{briefId}}\n' };
      delete r[agentsPath];
    }));
    const result = await sync(deps);
    assert.equal(result.briefMarker, 'found');
    assert.equal(result.markerFile, 'replit.md');
    assert.ok(recorder.requests.some(r => r.path === `${BASE}/contents/replit.md?ref=${SHA}`));
  }
  {
    const { deps, useGitHub } = await linked();
    useGitHub(variant(r => { r[workflowPath].body = 'name: UI lint\non:\n  pull_request_target:\npermissions:\n  contents: read\n'; }));
    const result = await sync(deps);
    assert.equal(result.uiWorkflow, 'needs-fix');
    assert.deepEqual(result.cannotSay, [...CANNOT_SAY, CANNOT_SAY_WORKFLOW, CANNOT_SAY_FIXTURE]);
    useGitHub(variant(r => { r[workflowPath].body = 'name: UI lint\npermissions: write-all\n'; }));
    assert.equal((await sync(deps)).uiWorkflow, 'needs-fix');
    useGitHub(variant(r => { delete r[workflowPath]; }));
    assert.equal((await sync(deps)).uiWorkflow, 'missing');
  }
  {
    const { deps, useGitHub } = await linked();
    const runs = (list: Json[]) => variant(r => { r[runsPath].body = { total_count: list.length, workflow_runs: list }; });
    useGitHub(runs([{ name: 'Deploy', status: 'completed', conclusion: 'failure' }, { name: 'UI lint', status: 'completed', conclusion: 'success' }]));
    assert.equal((await sync(deps)).checks, 'passed');
    useGitHub(runs([{ name: 'Deploy', status: 'completed', conclusion: 'success' }]));
    assert.equal((await sync(deps)).checks, 'none-reported');
    useGitHub(runs([{ name: 'UI lint', status: 'completed', conclusion: 'failure' }, { name: 'UI lint', status: 'completed', conclusion: 'success' }]));
    assert.equal((await sync(deps)).checks, 'failed');
    useGitHub(variant(r => { r[runsPath] = { status: 403, etag: null, body: { message: 'Resource not accessible' } }; }));
    assert.equal((await sync(deps)).checks, 'not-readable');
  }
  {
    const { deps, useGitHub } = await linked();
    useGitHub(variant(r => { r[`${BASE}/branches?per_page=100`].body = [{ name: 'main' }, { name: 'lovable-sync-1760520000' }]; }));
    const result = await sync(deps);
    assert.equal(result.word, 'sync-conflict');
    assert.equal(result.syncConflictBranch, 'lovable-sync-1760520000');
  }
  {
    const { deps, useGitHub, recorder } = await linked();
    const deployed = (url: string, state = 'success') => variant(r => {
      r[`${BASE}/deployments?per_page=5`].body = [{ id: 4242, environment: 'production' }];
      r[`${BASE}/deployments/4242/statuses?per_page=1`] = { status: 200, etag: null, body: [{ state, environment_url: url, created_at: '2026-10-15T09:59:00Z' }] };
    });
    useGitHub(deployed('https://ledger-cafe-books.lovable.app/'));
    const result = await sync(deps);
    assert.deepEqual(result.deployment, { host: 'ledger-cafe-books.lovable.app', url: 'https://ledger-cafe-books.lovable.app/', at: '2026-10-15T09:59:00.000Z' });
    assert.ok(recorder.requests.some(r => r.path === `${BASE}/deployments/4242/statuses?per_page=1`));
    assert.equal(listRecords((deps.store as VentureTestStore).read(), 'venture-build-read').at(-1)!.calls.length, 8);
    useGitHub(deployed('http://ledger-cafe-books.lovable.app/'));
    assert.equal((await sync(deps)).deployment, null);
    useGitHub(deployed('https://user:secret@ledger-cafe-books.lovable.app/'));
    assert.equal((await sync(deps)).deployment, null);
    useGitHub(deployed('https://ledger-cafe-books.lovable.app/', 'failure'));
    assert.equal((await sync(deps)).deployment, null);
    useGitHub(variant(r => { r[`${BASE}/deployments?per_page=5`].body = [{ id: '42/../../user' }]; }));
    await assert.rejects(sync(deps), code('GITHUB_READ_FAILED'));
  }
  {
    // An old commit by anyone is quiet.
    const { deps, useGitHub } = await linked();
    useGitHub(variant(r => { (r[commitsPath].body as any[])[0].commit.author.date = '2026-10-10T09:00:00Z'; }));
    assert.equal((await sync(deps)).word, 'quiet');
  }
});

test('GitHub reads encode every path part and query value, check values before use, and store nothing on refusals', async () => {
  {
    const { deps, useGitHub, recorder } = await linked();
    const branch = 'main&per_page=100#';
    useGitHub(variant(r => {
      (r[BASE].body as any).default_branch = branch;
      r[`${BASE}/commits?sha=main%26per_page%3D100%23&per_page=20`] = r[commitsPath];
      delete r[commitsPath];
    }));
    const result = await sync(deps);
    assert.ok(recorder.requests.some(r => r.path === `${BASE}/commits?sha=main%26per_page%3D100%23&per_page=20`), JSON.stringify(recorder.requests.map(r => r.path)));
    assert.equal(result.repo.defaultBranch, branch);
    assert.equal(result.lastCommit?.sha, SHA);
  }
  for (const [mutate, expected] of [
    [(r: GitHubFixture['responses']) => { (r[commitsPath].body as any[])[0].sha = '../../evil'; }, 'GITHUB_READ_FAILED'],
    [(r: GitHubFixture['responses']) => { (r[commitsPath].body as any[])[0].sha = 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678'; }, 'GITHUB_READ_FAILED'],
    [(r: GitHubFixture['responses']) => { r[BASE] = { status: 401, etag: null, body: { message: 'Bad credentials' } }; }, 'GITHUB_UNAUTHORIZED'],
    [(r: GitHubFixture['responses']) => { delete r[BASE]; }, 'GITHUB_NOT_FOUND'],
    [(r: GitHubFixture['responses']) => { r[BASE] = { status: 500, etag: null, body: 'oops' }; }, 'GITHUB_READ_FAILED'],
    [(r: GitHubFixture['responses']) => { r[BASE] = { status: 200, etag: null, body: 'not json' }; }, 'GITHUB_READ_FAILED'],
  ] as const) {
    const { deps, useGitHub, store } = await linked();
    useGitHub(variant(mutate));
    const before = store.read();
    await assert.rejects(sync(deps), code(expected));
    const after = store.read();
    assert.equal(listRecords(after, 'venture-build-read').length, 0);
    assert.equal(listRecords(after, 'venture-build-follow').at(-1)!.lastStatus, null);
    assert.equal(after.conversations.length, before.conversations.length);
  }
  {
    const { deps, useGitHub } = await linked();
    useGitHub({ kind: 'github-api', read: async (): Promise<GitHubResponse> => ({ status: 403, etag: null, body: '{"message":"API rate limit exceeded"}', rateRemaining: 0 }) });
    await assert.rejects(sync(deps), code('GITHUB_RATE_LIMITED'));
    useGitHub({ kind: 'github-api', read: async (): Promise<GitHubResponse> => ({ status: 403, etag: null, body: '{}', rateRemaining: 12 }) });
    await assert.rejects(sync(deps), code('GITHUB_READ_FAILED'));
    useGitHub({ kind: 'github-api', read: async (): Promise<GitHubResponse> => { throw new TypeError('fetch failed'); } });
    await assert.rejects(sync(deps), code('GITHUB_READ_FAILED'));
  }
  {
    // An empty repo: no commit to read files at.
    const { deps, useGitHub, recorder } = await linked();
    useGitHub(variant(r => { r[commitsPath] = { status: 409, etag: null, body: { message: 'Git Repository is empty.' } }; }));
    const result = await sync(deps);
    assert.equal(result.lastCommit, null);
    assert.equal(result.briefMarker, 'not-checked');
    assert.equal(result.uiWorkflow, 'not-checked');
    assert.equal(result.checks, 'not-readable');
    assert.equal(result.word, 'repo-connected');
    assert.ok(!recorder.requests.some(r => r.path.includes('/contents/')));
  }
});

test('GitHub sync needs a linked repo and a token still in memory; the token stays out of state', async () => {
  const { deps, secrets } = setup();
  await seedVenture(deps);
  await assert.rejects(sync(deps), code('REPO_NOT_LINKED'));
  await link(deps, { repo: 'demo-owner/ledger-cafe-books.git', token: TOKEN });
  assert.equal(secrets.get('github:demo-owner/ledger-cafe-books'), TOKEN);
  secrets.clear(); // a restart: the shelf is memory only
  await assert.rejects(sync(deps), code('GITHUB_UNAUTHORIZED'));
  assert.equal((await status(deps)).follow?.tokenState, 'none');

  // Without a token: no Authorization is sent and the shelf holds nothing.
  const env = setup();
  await seedVenture(env.deps);
  await brief(env.deps);
  const follow = await link(env.deps, { repo: REPO_URL });
  assert.equal(follow.tokenState, 'none');
  await sync(env.deps);
  assert.ok(env.recorder.requests.every(r => r.token === null));

  // Linking another repo forgets the old repo's token.
  const next = await linked();
  await link(next.deps, { repo: 'demo-owner/another-repo', token: 'github_pat_another_test_token_0001' });
  assert.equal(next.secrets.has('github:demo-owner/ledger-cafe-books'), false);
  assert.equal(next.secrets.get('github:demo-owner/another-repo'), 'github_pat_another_test_token_0001');
  const dump = JSON.stringify(next.store.read());
  assert.ok(!dump.includes(TOKEN) && !dump.includes('github_pat_another_test_token_0001'));
});

test('defaultGitHubTransport sends a read-only GET with the pinned headers, no redirects, and a capped body', async () => {
  const original = globalThis.fetch;
  const seen: { url: string; init: RequestInit }[] = [];
  let reply: () => Response = () => new Response('{"ok":true}', { status: 200, headers: { etag: '"e1"', 'x-ratelimit-remaining': '59' } });
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => { seen.push({ url: String(url), init: init ?? {} }); return reply(); }) as typeof fetch;
  try {
    const transport = defaultGitHubTransport();
    assert.equal(transport.kind, 'github-api');
    const response = await transport.read({ path: `${BASE}/contents/AGENTS.md?ref=${SHA}`, accept: 'raw', etag: null, token: TOKEN });
    assert.deepEqual(response, { status: 200, etag: '"e1"', body: '{"ok":true}', rateRemaining: 59 });
    const first = seen[0];
    assert.equal(first.url, `https://api.github.com${BASE}/contents/AGENTS.md?ref=${SHA}`);
    assert.equal(first.init.method, 'GET');
    assert.equal(first.init.redirect, 'error');
    assert.ok(first.init.signal instanceof AbortSignal);
    const headers = first.init.headers as Record<string, string>;
    assert.equal(headers.Accept, 'application/vnd.github.raw+json');
    assert.equal(headers['X-GitHub-Api-Version'], '2026-03-10');
    assert.equal(headers['User-Agent'], 'chausar-local');
    assert.equal(headers.Authorization, `Bearer ${TOKEN}`);

    await transport.read({ path: BASE, accept: 'json', etag: null, token: null });
    const second = seen[1].init.headers as Record<string, string>;
    assert.equal(second.Accept, 'application/vnd.github+json');
    assert.equal('Authorization' in second, false);

    reply = () => new Response('x'.repeat(1024 * 1024 + 1), { status: 200 });
    await assert.rejects(transport.read({ path: BASE, accept: 'json', etag: null, token: null }), code('GITHUB_READ_FAILED'));
    reply = () => { throw new TypeError('fetch failed'); };
    await assert.rejects(transport.read({ path: BASE, accept: 'json', etag: null, token: TOKEN }), (error: any) => {
      assert.equal(error.code, 'GITHUB_READ_FAILED');
      assert.ok(!error.message.includes(TOKEN));
      return true;
    });
    await assert.rejects(transport.read({ path: '//evil.example/x', accept: 'json', etag: null, token: null }), code('INVALID_VENTURE_REQUEST'));
  } finally {
    globalThis.fetch = original;
  }
});

test('createFixtureGitHubTransport: label check, exact paths, 404 for unknown, placeholders and JSON bodies', async () => {
  assert.throws(() => createFixtureGitHubTransport({ ...githubFixture, label: 'live capture' as 'synthetic recording' }), code('INVALID_VENTURE_REQUEST'));
  const transport = createFixtureGitHubTransport(githubFixture, () => ({ briefId: 'chb_abcdefgh' }));
  assert.equal(transport.kind, 'fixture');
  const marker = await transport.read({ path: agentsPath, accept: 'raw', etag: null, token: null });
  assert.equal(marker.body.split('\n')[0], 'chausar-brief-id: chb_abcdefgh');
  const repo = await transport.read({ path: BASE, accept: 'json', etag: null, token: null });
  assert.equal(JSON.parse(repo.body).default_branch, 'main');
  assert.equal(repo.etag, '"repo-1"');
  assert.deepEqual(await transport.read({ path: `${BASE}/nope`, accept: 'json', etag: null, token: null }), { status: 404, etag: null, body: '{"message":"Not Found"}', rateRemaining: null });
  const plain = createFixtureGitHubTransport(githubFixture);
  assert.ok((await plain.read({ path: agentsPath, accept: 'raw', etag: null, token: null })).body.includes('{{briefId}}'));
});

// ---------------------------------------------------------------------------
// 7. Link validation
// ---------------------------------------------------------------------------

test('venture.build.link: repo shapes, fine-grained tokens only, admin and app only', async () => {
  const { deps, secrets, store } = setup();
  await seedVenture(deps);
  for (const repo of ['owner/na me', 'owner/..', 'owner/.', 'http://github.com/a/b', 'https://gitlab.com/a/b', 'https://github.com/a/b/c',
    'https://user@github.com/a/b', 'a', 'a/b/c', 'own_er/name', '-'.repeat(40) + '/name', 'https://github.com/a/b?tab=1']) {
    await assert.rejects(link(deps, { repo }), code('INVALID_REPO'), repo);
  }
  for (const token of ['ghp_' + 'a'.repeat(36), 'gho_' + 'a'.repeat(36), 'ghu_' + 'a'.repeat(36), 'ghs_' + 'a'.repeat(36), 'ghr_' + 'a'.repeat(36), 'token-' + 'a'.repeat(30)]) {
    await assert.rejects(link(deps, { repo: 'owner/name', token }), (error: any) => {
      assert.equal(error.code, 'TOKEN_NOT_FINE_GRAINED');
      assert.equal(error.message, 'Use a fine-grained token that starts with github_pat_, for this one repo. Create one with the link on this screen.');
      assert.ok(!error.message.includes(token));
      return true;
    });
  }
  await assert.rejects(link(deps, { repo: 'owner/name', token: 'github_pat_with space inside it' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(link(deps, { repo: 'owner/name', token: 'github_pat_short' }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(listRecords(store.read(), 'venture-build-follow').length, 0);
  assert.equal(secrets.has('github:owner/name'), false);

  await assert.rejects(link(deps, { repo: 'owner/name', token: TOKEN }, phone), code('APP_APPROVAL_REQUIRED'));
  assert.equal(secrets.has('github:owner/name'), false);

  const follow = await link(deps, { repo: 'https://github.com/Owner-1/my.app.git', token: TOKEN });
  assert.deepEqual(follow.repo, { owner: 'Owner-1', name: 'my.app' });
  assert.equal(follow.tokenState, 'in-memory');
  assert.equal(follow.lastStatus, null);
  assert.equal(secrets.get('github:Owner-1/my.app'), TOKEN);
  assert.equal(events(store).at(-1), 'repo-linked');
  assert.ok(!JSON.stringify(store.read()).includes(TOKEN));

  // A viewer cannot link a repo, and the token is not left on the shelf.
  await store.update(state => { state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
  await assert.rejects(link(deps, { repo: 'owner/other', token: TOKEN }, viewer), code('FORBIDDEN'));
  assert.equal(secrets.has('github:owner/other'), false);
});

test('a viewer can read the build status but cannot start a model call, a handoff or a GitHub read', async () => {
  const { deps, store, models, recorder } = await linked();
  await store.update(state => { state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
  const asked = models.tasks.length;
  await assert.rejects(handlers['venture.build.brief']!(deps, viewer, {}), code('FORBIDDEN'));
  assert.equal(models.tasks.length, asked);
  await assert.rejects(handlers['venture.build.handoff']!(deps, viewer, { builder: 'lovable' }), code('FORBIDDEN'));
  await assert.rejects(handlers['venture.build.sync']!(deps, viewer, {}), code('FORBIDDEN'));
  assert.equal(recorder.requests.length, 0);
  const view = await handlers['venture.build.status']!(deps, viewer, {});
  assert.equal(view.follow?.repo.name, 'ledger-cafe-books');
  assert.equal((await handlers['venture.connectors.list']!(deps, viewer, {})).length, 74 + PLAYBOOK_CATALOGUE_ENTRIES.length);
});

test('handlers are exactly the forty-one owned methods, and every code the package throws is a declared venture or engine code', async () => {
  // Thirty-one, the two Ink v2 wave 4 added (connectors.check and share.request, 4J7), and the eight wave 5 added (5-0
  // registered 5A6's monitors.list, .add and .remove, mail.import and .threads, localApps.list, webhook.set and
  // speechOut.providers).
  assert.deepEqual(Object.keys(handlers).sort(), [
    'venture.bank.alerts.get', 'venture.bank.alerts.set', 'venture.bank.apply', 'venture.bank.consent', 'venture.bank.import', 'venture.bank.ledger',
    'venture.build.brief', 'venture.build.handoff', 'venture.build.handoffOpened', 'venture.build.link', 'venture.build.status', 'venture.build.sync',
    'venture.connectors.check', 'venture.connectors.list',
    'venture.leads.add', 'venture.leads.block', 'venture.leads.draft', 'venture.leads.list', 'venture.leads.recordSend',
    'venture.localApps.list', 'venture.mail.import', 'venture.mail.threads', 'venture.monitors.add', 'venture.monitors.list', 'venture.monitors.remove',
    'venture.posting.checkSteps', 'venture.posting.limits.get', 'venture.posting.limits.set', 'venture.posting.propose', 'venture.posting.signIn',
    'venture.share.create', 'venture.share.list', 'venture.share.recordAnswer', 'venture.share.request', 'venture.share.revoke',
    'venture.site.apply', 'venture.site.revert', 'venture.site.stage', 'venture.social.calendar', 'venture.speechOut.providers',
    'venture.webhook.set',
  ]);
  const sources = await Promise.all(['brief.ts', 'brief-lint.ts', 'handoff.ts', 'lz.ts', 'github.ts', 'catalogue.ts', 'connectors.ts', 'index.ts', 'bank-methods.ts', 'site-methods.ts']
    .map(file => readFile(new URL(`../runtime/venture/build/${file}`, import.meta.url), 'utf8')));
  const thrown = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/(?:check\([^;]*?|ChausarError\()'([A-Z_]+)'/gs)) thrown.add(match[1]);
  }
  const engineCodes = ['INVALID_VENTURE_REQUEST'];
  for (const thrownCode of thrown) assert.ok((VENTURE_ERRORS as readonly string[]).includes(thrownCode) || engineCodes.includes(thrownCode), thrownCode);
  assert.ok(thrown.has('GITHUB_READ_FAILED') && thrown.has('BRIEF_LINT_FAILED') && thrown.has('PRICE_REQUIRED'));
  assert.equal(CONNECTOR_CATALOGUE.length, 74 + PLAYBOOK_CATALOGUE_ENTRIES.length);
});

// ---------------------------------------------------------------------------
// Onboarding v2: the brief from a composed plan (the India cafe-bills fixture, paid through Razorpay)
// ---------------------------------------------------------------------------

async function composedBrief(t: any, output: typeof CAFE_COMPOSE): Promise<BriefRecord> {
  const { engine } = await engineFor(t, { responses: planEntries(CAFE_TEXT, CAFE_DECIDE, output) });
  await connectPair(engine);
  let { plan } = await composePlan(engine, CAFE_TEXT, 'IN');
  plan = await engine.request('venture.compose.update', { composeId: plan.composeId, patch: { offers: [{ id: 'offer_1', unitPrice: '2499' }, { id: 'offer_2', unitPrice: '4999' }] } }) as any;
  await engine.request('workspace.create', { name: 'Cafe Bills Desk', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: CAFE_TEXT, countryCode: 'IN', composeId: plan.composeId, composedDigest: plan.digest });
  const draft = (await engine.request('venture.blueprint.get', {}) as any).blueprint;
  for (const offer of draft.offers) await engine.request('venture.price.quote', { offerId: offer.id });
  await engine.request('venture.blueprint.accept', { digest: draft.digest });
  return await engine.request('venture.build.brief', { useTemplate: true }) as BriefRecord;
}
const pageTitles = (markdown: string) => sectionLines(markdown, BRIEF_HEADINGS[3]).filter(line => /^\d+\. /.test(line)).map(line => line.replace(/^\d+\. /, '').split(':')[0]);

test('composed brief without a client area: the plan pages in order, the Razorpay line, no sign-in or private-upload lines, and a clean lint', async t => {
  const brief = await composedBrief(t, CAFE_COMPOSE);
  assert.deepEqual(pageTitles(brief.markdown), ['Home', 'Plans and prices', 'How it works', 'Get started']);
  assert.match(brief.markdown, /International cards need Terms, Privacy, Refund and Shipping pages, so add them\./);
  for (const line of [RLS_LINE, SIGN_IN_LINE, 'Keep client uploads private', 'A signed-in client sees only their own requests and files', 'Each signed-in client sees only their own requests and files.']) {
    assert.equal(brief.markdown.includes(line), false, line);
  }
  assert.equal(brief.lint.ok, true, JSON.stringify(brief.lint.findings));
  const plan = { pages: CAFE_COMPOSE.pages.map((page, i) => ({ id: `page_${i + 1}`, block: page.block, title: { value: page.title }, purpose: { value: page.purpose } })) } as any;
  assert.equal(hasClientArea(plan), false);
  assert.match(briefTask({ idea: CAFE_TEXT, country: { name: 'India' } } as any, { ...plan, serviceType: 'bookkeeping', name: { value: 'Cafe Bills Desk' }, oneLiner: { value: 'x' }, customer: { value: 'y' }, offers: [], deliverySteps: [] } as any, () => ({}) as any).instructions,
    /Use these pages, in this order\. Add the legal pages the country line asks for on top of them\./);
});

test('composed brief with a client-area page keeps the sign-in, row security and private-upload lines', async t => {
  const brief = await composedBrief(t, CAFE_COMPOSE_CLIENT_AREA);
  for (const line of [RLS_LINE, SIGN_IN_LINE, 'Keep client uploads private to that client.', 'A signed-in client sees only their own requests and files']) assert.ok(brief.markdown.includes(line), line);
  assert.deepEqual(pageTitles(brief.markdown), ['Home', 'Plans and prices', 'How it works', 'Your bills']);
  assert.equal(brief.lint.ok, true, JSON.stringify(brief.lint.findings));
});

test('a template brief keeps every line as before: the template pages, the client area and the sign-in lines', () => {
  const words = briefTemplateWords('bookkeeping', { name: 'Ledger Cafe Books', customer: 'Owners of small cafes' });
  assert.deepEqual(words.pages.map(page => page.title), ['Home', 'Offers and prices', 'How it works', 'Start a request', 'Client area', 'Privacy and terms']);
  assert.ok(words.doneMeans.includes('A signed-in client sees only their own requests and files'));
  assert.match(words.whatToBuild, /^A public website and a private client area for Ledger Cafe Books\./);
  const lint = lintFor('x', [], 'chb_abcd1234', true);
  assert.ok(lint.findings.some(finding => finding.rule === 'required-text' && /row level security/.test(finding.message)), 'the template lint still asks for the row security line');
  // Without a client area only the row security and sign-in lines stop being required; every other line still is.
  const open = lintFor('x', [], 'chb_abcd1234', false).findings.filter(finding => finding.rule === 'required-text').map(finding => finding.message);
  assert.equal(open.some(message => /row level security|sign-in line/.test(message)), false);
  assert.ok(open.some(message => /anon key line/.test(message)) && open.some(message => /lintapple install line/.test(message)));
});
