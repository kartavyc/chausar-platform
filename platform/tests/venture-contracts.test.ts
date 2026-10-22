// P0 contract tests for the venture launcher: shared lists, record helpers, text guards, the host
// environment reader, the test store, and the engine registration of the venture methods.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import {
  APP_ONLY_METHODS, CHECK_IDS, CONNECTOR_CATEGORIES, DRAFT_METHODS, EVIDENCE_METHODS, EXTERNAL_ORIGINS, INDIA_STATES, JUDGE_QUESTIONS, LAUNCH_STAGES,
  METHOD_OWNERS, MODEL_PRESET_IDS, PRE_VAULT_METHODS, REQUIRED_SECTIONS, SECOND_OFFER_MODEL, SERVICE_TYPE_LABELS, SERVICE_TYPES,
  STEP_IDS, STEP_PLAN, VENTURE_ERRORS, VENTURE_EVENTS, VENTURE_METHODS, VENTURE_RECORD_KINDS,
} from '../runtime/venture/contracts.ts';
import type { ClientRecord, TermRecord, VentureDeps, VentureMethod } from '../runtime/venture/contracts.ts';
import {
  MAX_EVENTS, activateTerm, amountText, assertNoMoney, assertNoNumbers, assertNoPriceWords, bpsPercent, copiedTokens, currentVenture, doneClaimFindings, exactPayload, formatMicros,
  formatVentureDate, houseStyleFindings, isoDate, listRecords, modelNumbers, modelWords, percentBps, plainText, requireAppChannel, singleLine, sumMicros, tidyWords,
  ventureAction, type VentureTx,
} from '../runtime/venture/records.ts';
import { ventureHostEnv } from '../runtime/venture/host-env.ts';
import { ONBOARDING_METHODS } from '../runtime/venture/onboarding-contracts.ts';
import { VentureTestStore } from './venture-test-store.ts';

const METHOD_NAME = /^[a-z]+(\.[a-zA-Z][a-zA-Z0-9]*)+$/;
const ERROR_CODE = /^[A-Z_]{1,64}$/;
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const clock = () => new Date('2026-10-15T10:00:00.000Z');

function setup() {
  const store = new VentureTestStore();
  const deps = { store, clock } as unknown as VentureDeps;
  return { store, deps };
}
const unique = (list: readonly string[]) => new Set(list).size === list.length;
const code = (expected: string) => (error: any) => { assert.equal(error.code, expected); return true; };

async function createVenture(deps: VentureDeps) {
  return ventureAction(deps, owner, 'admin', 'create', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Bookkeeping for small studios', ideaDigest: 'digest', workingName: 'Test studio',
    country: null as any, serviceType: null, status: 'interview', launchStage: 'rehearsal', blueprintId: null, acceptedBlueprintId: null,
    playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
}
function clientRecord(tx: VentureTx, name: string): ClientRecord {
  return { ...tx.base('venture-client'), name, email: null, countryCode: null, taxId: null, stateCode: null, note: null };
}

test('VENTURE_METHODS: 101 unique valid names with owners and well-formed subsets', () => {
  assert.equal(VENTURE_METHODS.length, 101);
  assert.ok(unique(VENTURE_METHODS));
  for (const method of VENTURE_METHODS) { assert.match(method, METHOD_NAME); assert.ok(method.length <= 80); }
  assert.deepEqual(Object.keys(METHOD_OWNERS), [...VENTURE_METHODS]);
  for (const subset of [APP_ONLY_METHODS, EVIDENCE_METHODS, PRE_VAULT_METHODS, DRAFT_METHODS]) for (const method of subset) assert.ok(VENTURE_METHODS.includes(method), method);
  assert.deepEqual([...PRE_VAULT_METHODS], ['venture.countries', 'venture.preview']);
});

test('DRAFT_METHODS: the nine onboarding methods, apart from the pre-vault two, with app-only connect, decide and fill', () => {
  assert.equal(DRAFT_METHODS.length, 9);
  assert.deepEqual([...DRAFT_METHODS], [...ONBOARDING_METHODS]);
  for (const method of DRAFT_METHODS) assert.equal(PRE_VAULT_METHODS.includes(method), false, method);
  for (const method of DRAFT_METHODS) assert.equal(METHOD_OWNERS[method], method.startsWith('venture.ai.') ? 'models' : 'core', method);
  assert.deepEqual(DRAFT_METHODS.filter(method => APP_ONLY_METHODS.includes(method)), ['venture.ai.connect', 'venture.compose.decide', 'venture.compose.fill']);
  for (const code of ['COMPOSE_NOT_FOUND', 'COMPOSE_REFUSED', 'COMPOSE_NOT_A_SERVICE']) assert.ok((VENTURE_ERRORS as readonly string[]).includes(code), code);
  assert.ok((VENTURE_RECORD_KINDS as readonly string[]).includes('venture-composition'));
  assert.ok((VENTURE_EVENTS as readonly string[]).includes('plan-composed'));
});

test('VENTURE_ERRORS: unique codes the desktop keeps, including the ones packages rely on', () => {
  assert.ok(unique(VENTURE_ERRORS));
  for (const error of VENTURE_ERRORS) assert.match(error, ERROR_CODE);
  for (const needed of ['INVALID_AMOUNT', 'INVALID_TAX_RATE', 'SEND_DISABLED', 'INVALID_EXTERNAL_URL', 'EXTERNAL_URL_NOT_ALLOWED']) assert.ok((VENTURE_ERRORS as readonly string[]).includes(needed), needed);
});

test('EXTERNAL_ORIGINS: unique https origins', () => {
  assert.ok(unique(EXTERNAL_ORIGINS));
  for (const origin of EXTERNAL_ORIGINS) { const url = new URL(origin); assert.equal(url.origin, origin); assert.equal(url.protocol, 'https:'); }
});

test('shared lists are unique and connector categories number twelve', () => {
  for (const list of [VENTURE_RECORD_KINDS, VENTURE_EVENTS, SERVICE_TYPES, MODEL_PRESET_IDS, CONNECTOR_CATEGORIES, CHECK_IDS, LAUNCH_STAGES, JUDGE_QUESTIONS]) assert.ok(unique(list), list.join(','));
  assert.equal(CONNECTOR_CATEGORIES.length, 12);
});

test('template structure: sections, labels, step plan and India state codes', () => {
  for (const type of SERVICE_TYPES) {
    assert.ok(REQUIRED_SECTIONS[type].length > 0, type);
    for (const heading of REQUIRED_SECTIONS[type]) { assertNoNumbers(heading, 'heading'); assert.deepEqual(doneClaimFindings(heading), [], heading); }
    assert.ok(SECOND_OFFER_MODEL[type], type);
    assert.ok(SERVICE_TYPE_LABELS[type], type);
  }
  assert.deepEqual(Object.keys(SECOND_OFFER_MODEL).sort(), [...SERVICE_TYPES].sort());
  assert.deepEqual(Object.keys(SERVICE_TYPE_LABELS).sort(), [...SERVICE_TYPES].sort());
  assert.deepEqual(STEP_PLAN.map(step => step.id), [...STEP_IDS]);
  assert.deepEqual(STEP_PLAN.filter(step => step.capability === 'drafts-now').map(step => step.id), ['step_3']);
  const codes = Object.keys(INDIA_STATES);
  assert.equal(codes.length, 37);
  for (const stateCode of codes) assert.match(stateCode, /^\d{2}$/);
});

test('ventureAction: create, read back, rollback, nesting, concurrency, event trimming and audit', async () => {
  const { store, deps } = setup();
  const created = await createVenture(deps);
  assert.equal(created.ventureId, created.id);
  assert.equal(currentVenture(store.read())?.id, created.id);

  const seen = await ventureAction(deps, owner, 'read', 'look', tx => tx.venture?.id);
  assert.equal(seen, created.id);

  const before = store.read();
  await assert.rejects(ventureAction(deps, owner, 'prepare', 'boom', tx => {
    tx.put(clientRecord(tx, 'Discarded client'));
    tx.emit('client-added', {});
    throw new Error('stop');
  }), /stop/);
  const after = store.read();
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.conversations, before.conversations);
  assert.equal(listRecords(after, 'venture-event').length, 0);

  await ventureAction(deps, owner, 'read', 'outer', async () => {
    await assert.rejects(ventureAction(deps, owner, 'read', 'inner', () => 1), code('REENTRANT_TRANSACTION'));
  });

  await Promise.all(Array.from({ length: 20 }, (_, index) => ventureAction(deps, owner, 'prepare', 'client', tx => tx.put(clientRecord(tx, `Client ${index}`)))));
  assert.equal(listRecords(store.read(), 'venture-client', created.id).length, 20);

  await assert.rejects(ventureAction(deps, owner, 'prepare', 'bad-event', tx => tx.emit('not-an-event' as any)), code('INVALID_VENTURE_REQUEST'));

  for (let index = 0; index < 505; index += 1) await ventureAction(deps, owner, 'prepare', 'tick', tx => tx.emit('client-added', { index }));
  const events = listRecords(store.read(), 'venture-event', created.id);
  assert.equal(events.length, MAX_EVENTS);
  assert.equal(Math.max(...events.map(event => event.seq)), 505);
  assert.equal(Math.min(...events.map(event => event.seq)), 6);

  assert.ok(store.read().activity.some(entry => entry.event === 'venture.create' && entry.details.ventureId === created.id));
  assert.ok(store.read().activity.some(entry => entry.event === 'venture.tick'));
});

test('ventureAction refuses without a venture and refuses a viewer who tries to prepare', async () => {
  const { store, deps } = setup();
  await assert.rejects(ventureAction(deps, owner, 'read', 'look', () => 1), code('VENTURE_NOT_FOUND'));
  await createVenture(deps);
  await store.update(state => { state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
  await assert.rejects(ventureAction(deps, viewer, 'prepare', 'client', tx => tx.put(clientRecord(tx, 'Nope'))), code('FORBIDDEN'));
  assert.equal(await ventureAction(deps, viewer, 'read', 'look', () => 'ok'), 'ok');
});

test('requireAppChannel: app-only methods need the desktop channel and an untainted source', () => {
  const contexts: Context[] = [
    { ...owner, channel: 'phone' }, { ...owner, channel: 'mcp' }, { memberId: 'owner', role: 'owner', epoch: 1 }, { ...owner, sourceTainted: true },
  ];
  for (const method of APP_ONLY_METHODS) {
    for (const ctx of contexts) assert.throws(() => requireAppChannel(ctx, method), code('APP_APPROVAL_REQUIRED'), `${method} ${JSON.stringify(ctx)}`);
    requireAppChannel(owner, method);
  }
  for (const method of VENTURE_METHODS.filter(m => !APP_ONLY_METHODS.includes(m)) as VentureMethod[]) for (const ctx of contexts) requireAppChannel(ctx, method);
});

test('model words may hold numbers, labelled as estimates; an amount of money is still refused', () => {
  // Numbers pass and are found, so the record that carries them gets estimate: true and no receipt.
  for (const text of ['We will be done in 3 days.', 'Plan for 2026', 'open 24/7', 'about 20% fewer late bills', 'a few lakh views', 'two drafts a week', 'call ३ times', 'Pay 500 now.', 'your 2nd month']) {
    assert.equal(modelWords(text, 'line'), text, text);
    assert.equal(modelNumbers(text), true, text);
  }
  // Names that hold a digit, one, first, and tokens copied from the owner are not numbers.
  for (const text of ['We help B2B and web3 teams with GPT-6 drafts', 'one call for your first client', 'Q3 planning in 3D']) assert.equal(modelNumbers(text), false, text);
  assert.equal(modelNumbers('Walks for 2 dogs'), true);
  // An amount of money would read as a price, tax or invoice figure, and those come only from the calculator.
  for (const bad of ['Pay ₹500', '₹ only', 'INR 3,000 a month', '500 rupees', 'Rs500 each', 'Rs. 500 each', 'fifteen pounds a walk', 'USD 20 per hour', 'a tenner a walk', '20 lakh rupees', '20% off your first month', 'Half price for nurses']) {
    assert.throws(() => modelWords(bad, 'line'), code('MODEL_OUTPUT_REJECTED'), bad);
    assert.throws(() => assertNoMoney(bad, 'line'), { code: 'MODEL_OUTPUT_REJECTED', message: /amount of money/ }, bad);
  }
  for (const fine of ['We bill in rupees', 'INR only', '3 CAD drawings', 'Pay 500 now.', 'about 20% fewer late bills', 'Feel free to ask']) assert.doesNotThrow(() => assertNoMoney(fine, 'line', ['cad']), fine);
  // Plan words sit beside the prices, so they also keep out price words: currency names and codes the owner did not write, free and discount.
  for (const bad of ['Priced in GBP', 'Paid in rupees', 'A free first visit', 'Discounted walks']) assert.throws(() => assertNoPriceWords(bad, 'line'), { code: 'MODEL_OUTPUT_REJECTED', message: /price word/ }, bad);
  for (const fine of ['Stress-free walks', 'Clear CAD drawings', 'Walks twice a week', 'Walks for 2 dogs']) assert.doesNotThrow(() => assertNoPriceWords(fine, 'line', ['cad']), fine);
});

test('assertNoNumbers and copiedTokens: template and engine words hold no numbers', () => {
  assertNoNumbers('Two drafts a week, one call', 'line');
  assertNoNumbers('INR only', 'line');
  for (const bad of ['Pay 500', '₹ only', '20% off', 'a few lakh', 'open 24/7', 'version 2.0', 'call ٣ times', 'call ३ times']) {
    assert.throws(() => assertNoNumbers(bad, 'line'), code('MODEL_OUTPUT_REJECTED'), bad);
  }
  const allowed = copiedTokens('Lead lists for B2B SaaS and Web3 teams using GPT-6, from Q3');
  assert.deepEqual(allowed, ['b2b', 'gpt-6', 'q3', 'web3']);
  assertNoNumbers('We help B2B and web3 teams with GPT-6 drafts', 'line', allowed);
  assert.throws(() => assertNoNumbers('B2C teams', 'line', allowed), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => assertNoNumbers('B2B teams pay 500', 'line', allowed), code('MODEL_OUTPUT_REJECTED'));
  assert.deepEqual(copiedTokens('We charge 500'), []);
  assert.throws(() => assertNoNumbers('500', 'line', [...copiedTokens('We charge 500'), '500']), code('MODEL_OUTPUT_REJECTED'));
});

test('houseStyleFindings catches em dashes and every form of the banned words; tidyWords swaps the dash', () => {
  assert.deepEqual(houseStyleFindings('one \u2014 two'), [{ rule: 'em-dash', match: '\u2014' }]);
  const forms: [string, string][] = [['leveraging', 'leverage'], ['delving', 'delve'], ['tapestries', 'tapestry'], ['Robustly', 'robust'], ['underscored', 'underscore'], ['testaments', 'testament']];
  for (const [form, base] of forms) assert.deepEqual(houseStyleFindings(`We are ${form} here`), [{ rule: 'banned-word', match: base }], form);
  assert.deepEqual(houseStyleFindings('a level average'), []);
  assert.equal(tidyWords('one \u2014 two'), 'one, two');
});

test('doneClaimFindings finds claims of finished work and passes promises', () => {
  for (const claim of ['We matched each bank entry to a bill.', 'Your books for the month are sorted and matched to the bank.', "We've reconciled the account.", 'I have already sent the report.', 'Everything has been checked.']) {
    assert.ok(doneClaimFindings(claim).length > 0, claim);
  }
  for (const promise of ['We will sort the bills and match them to the statement.', 'Nothing is sent until you approve it.', 'The price for this month comes from your plan.']) {
    assert.deepEqual(doneClaimFindings(promise), [], promise);
  }
});

test('formatMicros rounds half up to four decimals; sumMicros adds with BigInt', () => {
  // 4200 micros = 0.0042 exactly; 49 micros rounds down to 0.0000; 50 rounds up to 0.0001; 12345678 micros = 12.345678 -> 12.3457.
  assert.equal(formatMicros('4200'), 'USD 0.0042');
  assert.equal(formatMicros('49'), 'USD 0.0000');
  assert.equal(formatMicros('50'), 'USD 0.0001');
  assert.equal(formatMicros('12345678'), 'USD 12.3457');
  assert.equal(sumMicros(['1', '2']), '3');
});

test('payload checks, amounts, rates, dates and model words', () => {
  class Box { value = 1; }
  assert.deepEqual(exactPayload({ a: 1 }, ['a', 'b'], ['a']), { a: 1 });
  for (const bad of [{ a: 1, c: 2 }, { b: 1 }, [1], new Box()]) assert.throws(() => exactPayload(bad, ['a', 'b'], ['a']), code('INVALID_VENTURE_REQUEST'));

  assert.equal(plainText('  hello  ', 'Name'), 'hello');
  assert.throws(() => plainText('x'.repeat(11), 'Name', { max: 10 }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => plainText('   ', 'Name'), code('INVALID_VENTURE_REQUEST'));
  assert.equal(singleLine(' One line ', 'Name'), 'One line');
  for (const bad of ['a\nb', 'a\rb', 'a\tb']) assert.throws(() => singleLine(bad, 'Name'), code('INVALID_VENTURE_REQUEST'), JSON.stringify(bad));

  assert.equal(amountText(' 2,499.50 ', 'Price'), '2499.50');
  assert.throws(() => amountText('-5', 'Price'), code('INVALID_AMOUNT'));

  assert.equal(isoDate('2026-10-15', 'Date'), '2026-10-15');
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '9999-99-99']) assert.throws(() => isoDate(bad, 'Date'), code('INVALID_VENTURE_REQUEST'), bad);

  assert.equal(percentBps('18', 'Rate'), '1800');
  assert.equal(percentBps('8.25', 'Rate'), '825');
  assert.equal(percentBps(' 0.25 %', 'Rate'), '25');
  for (const bad of ['101', '8.255', '-1']) assert.throws(() => percentBps(bad, 'Rate'), code('INVALID_TAX_RATE'), bad);
  assert.equal(bpsPercent('1800'), '18');
  assert.equal(bpsPercent('825'), '8.25');
  assert.equal(bpsPercent('850'), '8.5');
  assert.equal(bpsPercent('25'), '0.25');

  assert.equal(formatVentureDate('2026-10-01', 'day-month-year'), '01 Oct 2026');
  assert.equal(formatVentureDate('2026-10-01', 'month-day-year'), 'Oct 01, 2026');
  assert.equal(formatVentureDate('2026-10-01', 'year-month-day'), '2026-10-01');

  assert.equal(modelWords('First line\nsecond line', 'note'), 'First line second line');
  assert.equal(modelWords('First line\n\nsecond line', 'note', 400, { multiline: true }), 'First line\nsecond line');
  assert.throws(() => modelWords('# Heading', 'note'), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => modelWords('Intro\n# Heading', 'note', 400, { multiline: true }), code('MODEL_OUTPUT_REJECTED'));
});

test('activateTerm turns a proposed term active with evidence and does nothing without the term', async () => {
  const { store, deps } = setup();
  const venture = await createVenture(deps);
  const termId = await ventureAction(deps, owner, 'prepare', 'term', tx => {
    const term: TermRecord = { ...tx.base('venture-term'), key: 'client', name: 'Client', meaning: 'Someone who pays for the service.', lifecycle: 'proposed', evidence: [] };
    tx.put(term);
    activateTerm(tx, 'invoice', { recordId: 'missing', kind: 'venture-invoice' });
    return term.id;
  });
  let term = listRecords(store.read(), 'venture-term', venture.id).find(t => t.id === termId)!;
  assert.equal(term.lifecycle, 'proposed');
  assert.equal(term.evidence.length, 0);
  await ventureAction(deps, owner, 'prepare', 'client', tx => {
    const client = tx.put(clientRecord(tx, 'First client'));
    activateTerm(tx, 'client', { recordId: client.id, kind: 'venture-client' });
  });
  term = listRecords(store.read(), 'venture-term', venture.id).find(t => t.id === termId)!;
  assert.equal(term.lifecycle, 'active');
  assert.equal(term.evidence.length, 1);
  assert.equal(term.evidence[0].kind, 'venture-client');
  assert.equal(term.evidence[0].at, '2026-10-15T10:00:00.000Z');
});

test('ventureHostEnv honours replay files only in demo mode with the replay switch', () => {
  const env = { CHAUSAR_VENTURE_MODEL_REPLAY: '/tmp/model.json', CHAUSAR_VENTURE_GITHUB_REPLAY: '/tmp/github.json' };
  const pending = { claudeCodeTerms: 'pending' };
  assert.deepEqual(ventureHostEnv(env, { demo: false, host: 'local-web' }), { host: 'local-web', ...pending });
  assert.deepEqual(ventureHostEnv({ ...env, CHAUSAR_VENTURE_REPLAY: '1' }, { demo: false, host: 'desktop', args: ['--replay'] }), { host: 'desktop', ...pending });
  assert.deepEqual(ventureHostEnv(env, { demo: true, host: 'desktop' }), { host: 'desktop', ...pending });
  const replayed = { host: 'desktop', ...pending, modelReplayPath: '/tmp/model.json', githubReplayPath: '/tmp/github.json' };
  assert.deepEqual(ventureHostEnv({ ...env, CHAUSAR_VENTURE_REPLAY: '1' }, { demo: true, host: 'desktop' }), replayed);
  assert.deepEqual(ventureHostEnv(env, { demo: true, host: 'local-web', args: ['--demo', '--replay'] }), { ...replayed, host: 'local-web' });
});

test('ventureHostEnv opens the Claude Code terms gate only for the exact word accepted', () => {
  assert.equal(ventureHostEnv({ CHAUSAR_CLAUDE_CODE_TERMS: 'accepted' }, { demo: false, host: 'desktop' }).claudeCodeTerms, 'accepted');
  for (const value of [undefined, '', 'yes', 'ACCEPTED', 'accepted ', '1']) {
    assert.equal(ventureHostEnv({ CHAUSAR_CLAUDE_CODE_TERMS: value }, { demo: false, host: 'desktop' }).claudeCodeTerms, 'pending', String(value));
  }
});

test('VentureTestStore rejects nested updates and reads copies', async () => {
  const store = new VentureTestStore();
  await store.update(async () => {
    await assert.rejects(store.update(() => 1), code('REENTRANT_TRANSACTION'));
  });
  const copy = store.read();
  copy.workspace.name = 'Changed';
  assert.equal(store.read().workspace.name, 'Venture test');
  assert.equal(store.commits, 1);
});

test('the engine routes venture methods to the venture code before and after a vault opens', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-venture-contracts-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  async function reaches(method: string, payload: Record<string, unknown>) {
    try { await engine.request(method, payload); }
    catch (error: any) {
      assert.match(String(error.code), /^[A-Z_]+$/, `${method}: ${error.message}`);
      assert.notEqual(error.code, 'REQUEST_FAILED', method);
      assert.ok(!String(error.message).startsWith('Unknown request'), method);
    }
  }
  await reaches('venture.countries', {});
  await reaches('venture.preview', { idea: 'Bookkeeping for small design studios', countryCode: 'IN' });
  await engine.request('workspace.create', { name: 'Venture contract test', passphrase: 'venture contract passphrase', demo: false });
  await reaches('venture.get', {});
  await reaches('venture.countries', {});
});

test('Ink views (P1-A): six methods owned by views, decide and gate app-only, run events and records declared', async () => {
  const views = ['venture.queue.list', 'venture.queue.decide', 'venture.runs.list', 'venture.runs.get', 'venture.team.list', 'venture.team.gate'] as const;
  for (const method of views) {
    assert.ok((VENTURE_METHODS as readonly string[]).includes(method), method);
    assert.equal(METHOD_OWNERS[method], 'views', method);
  }
  assert.deepEqual(views.filter(method => APP_ONLY_METHODS.includes(method)), ['venture.queue.decide', 'venture.team.gate']);
  for (const event of ['run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed']) assert.ok((VENTURE_EVENTS as readonly string[]).includes(event), event);
  for (const kind of ['venture-queue-decision', 'venture-team-gate']) assert.ok((VENTURE_RECORD_KINDS as readonly string[]).includes(kind), kind);
  for (const error of ['RUN_NOT_FOUND', 'AGENT_NOT_FOUND', 'STEP_NOT_FOUND', 'GATE_FLOOR']) assert.ok((VENTURE_ERRORS as readonly string[]).includes(error), error);
  const { METHODS } = (await import('node:module')).createRequire(import.meta.url)('../../app/desktop/ipc-contract.cjs');
  for (const method of views) assert.ok(METHODS.includes(method), `the desktop allows ${method}`);
});
