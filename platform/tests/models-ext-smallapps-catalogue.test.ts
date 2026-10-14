import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { ChausarError, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { compileDictionary, starterPacks } from '../runtime/ontology.ts';
import { checkPayload, coreRows, loadCatalogue, parseSchema, prepareAction, writebackRow } from '../runtime/smallapps/catalogue-adapter.ts';
import { checkAgainstMenu, parseDescriptor, type Menu } from '../runtime/smallapps/descriptor.ts';
import { plan } from '../runtime/smallapps/planner.ts';
import { smallAppsPart } from '../runtime/smallapps/methods.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const dictionary = compileDictionary(structuredClone(starterPacks.find(p => p.pack === 'ecommerce')!));
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const core = [{ id: 'local', title: 'Chausar local workspace', operations: [{ id: 'reminder-draft', title: 'Create a payment reminder draft', description: 'x', impact: 'reversible', idempotency: 'x', readback: 'x' }] }];
const reminderSchema = { type: 'object', properties: { invoiceId: { type: 'string', maxLength: 64 }, text: { type: 'string', maxLength: 400 } }, required: ['invoiceId', 'text'], additionalProperties: false };
const rows = [
  { system: 'zoho-books', operation: 'payment-reminder', label: 'Send a payment reminder by email', tier: 'review', alwaysWaits: true, status: 'full', impact: 'message', payloadSchema: reminderSchema, writeTable: { anything: true } },
  { system: 'razorpay', operation: 'refund', label: 'Issue a refund', tier: 'money', alwaysWaits: false, status: 'available', impact: 'money',
    payloadSchema: { type: 'object', properties: { paymentId: { type: 'string', maxLength: 64 }, amountMinor: { type: 'string', format: 'paise' } }, required: ['paymentId', 'amountMinor'] } },
  { system: 'shopify', operation: 'set-price', label: 'Change a product price', tier: 'always-waits', alwaysWaits: true, status: 'not-built' },
  { system: 'google-sheets', operation: 'append-row', label: 'Append a row to the sheet', tier: 'routine', alwaysWaits: false, status: 'experimental', impact: 'reversible' },
  { system: 'tally', operation: 'voucher', label: 'Import a voucher', tier: 'review', alwaysWaits: false, status: 'full', payloadSchema: { type: 'object', properties: { x: { type: 'string', pattern: '.*' } } } },
  { system: 'Bad System', operation: 'x', label: 'Bad', tier: 'review', alwaysWaits: false, status: 'full' },
  { system: 'dup', operation: 'one', label: 'Duplicate', tier: 'review', alwaysWaits: false, status: 'full' },
  { system: 'dup', operation: 'one', label: 'Duplicate again', tier: 'review', alwaysWaits: false, status: 'full' },
];

type Calls = { method: string; payload: any }[];
function fakeHost(options: { writeback?: unknown; prepare?: (payload: any) => unknown; state?: State; clock?: unknown } = {}): ModuleHost & { calls: Calls } {
  const calls: Calls = [];
  const state = options.state ?? initialState('Fake shop');
  (state as any).ontology = { current: dictionary };
  const store: StateStore = { read: () => state, update: async change => change(state) } as StateStore;
  return { calls, store, services: {}, demo: false, directory: '/nowhere', options: options.clock === undefined ? {} : { clock: options.clock },
    async call(method, payload) {
      calls.push({ method, payload });
      if (method === 'ontology.get') return { current: dictionary };
      if (method === 'actions.catalogue') return core;
      if (method === 'actions.prepare') return { id: 'action_core', status: 'prepared', digest: 'd'.repeat(64), impact: 'reversible' };
      if (method === 'writeback.catalogue') { if (options.writeback === undefined) throw new ChausarError('UNKNOWN_METHOD', 'Unknown request'); return options.writeback; }
      if (method === 'writeback.prepare') { if (!options.prepare) throw new ChausarError('UNKNOWN_METHOD', 'Unknown request'); return options.prepare(payload); }
      throw new ChausarError('UNKNOWN_METHOD', 'Unknown request');
    } };
}

test('adapter: writeback rows are checked strictly, bad and duplicate rows are not counted, core rows fill in', async () => {
  const catalogue = await loadCatalogue(fakeHost({ writeback: { rows, generatedAt: 'ignored' } }));
  assert.equal(catalogue.writeback, 'used');
  assert.deepEqual(catalogue.rows.map(r => r.key), ['google-sheets/append-row', 'local/reminder-draft', 'razorpay/refund', 'shopify/set-price', 'zoho-books/payment-reminder']);
  assert.equal(catalogue.notCounted, 4); // unsupported schema keyword, bad id, two duplicates
  assert.match(catalogue.words!, /not counted/);
  const by = Object.fromEntries(catalogue.rows.map(r => [r.key, r]));
  // A row that says it does not wait is still put on the always-waits list when it moves money.
  assert.equal(by['razorpay/refund'].alwaysWaits, true);
  assert.equal(by['google-sheets/append-row'].alwaysWaits, false);
  assert.equal(by['shopify/set-price'].available, false);
  assert.equal(by['local/reminder-draft'].origin, 'core');
  // Absent, unreadable and the plain array form.
  assert.equal((await loadCatalogue(fakeHost())).writeback, 'absent');
  assert.deepEqual((await loadCatalogue(fakeHost())).rows.map(r => r.key), ['local/reminder-draft']);
  const unreadable = await loadCatalogue(fakeHost({ writeback: 'rows' }));
  assert.equal(unreadable.writeback, 'unreadable'); assert.deepEqual(unreadable.rows.map(r => r.key), ['local/reminder-draft']);
  assert.equal((await loadCatalogue(fakeHost({ writeback: rows.slice(0, 1) }))).rows.length, 2);
  // Other refusals from writeback are not swallowed.
  await assert.rejects(loadCatalogue({ call: async () => { throw new ChausarError('ACCESS_REVOKED', 'x'); } }), code('ACCESS_REVOKED'));
  // Field aliases are allowed, both at once is ambiguous.
  assert.equal(writebackRow({ connector: 'tally', operation: 'voucher', title: 'Import a voucher', tier: 'review', alwaysWaits: false, depth: 'full' }).key, 'tally/voucher');
  assert.throws(() => writebackRow({ system: 'a', connector: 'b', operation: 'v', label: 'L', tier: 'r', alwaysWaits: false, status: 'full' }), code('SMALLAPP_ROW_INVALID'));
  assert.throws(() => writebackRow({ ...rows[0], alwaysWaits: 'no' }), code('SMALLAPP_ROW_INVALID'));
  assert.throws(() => writebackRow({ ...rows[0], label: 'Send‮reminder' }), code('SMALLAPP_ROW_INVALID'));
  assert.equal(coreRows([{ id: 'x', operations: [{ id: 'y', title: 'T', impact: 'teleport' }] }]).notCounted, 1);
});

test('adapter: payload schemas are a small subset and person-typed values are data, digits included', () => {
  const schema = parseSchema(rows[1].payloadSchema);
  assert.doesNotThrow(() => checkPayload(schema, { paymentId: 'pay_42', amountMinor: '125000' }));
  assert.throws(() => checkPayload(schema, { paymentId: 'pay_42', amountMinor: '1250.00' }), code('SMALLAPP_PAYLOAD_INVALID'));
  assert.throws(() => checkPayload(schema, { paymentId: 'pay_42', amountMinor: 1250 }), code('SMALLAPP_PAYLOAD_INVALID'));
  assert.throws(() => checkPayload(schema, { paymentId: 'pay_42' }), code('SMALLAPP_PAYLOAD_INVALID'));
  assert.throws(() => checkPayload(schema, { paymentId: 'pay_42', amountMinor: '1', approve: true }), code('SMALLAPP_PAYLOAD_INVALID'));
  assert.throws(() => checkPayload(schema, { paymentId: 'pay‮42', amountMinor: '1' }), code('SMALLAPP_PAYLOAD_INVALID'));
  for (const bad of [{ type: 'number' }, { type: 'object', properties: {}, oneOf: [] }, { type: 'object', properties: { a: { type: 'string', pattern: 'x' } } },
    { type: 'object', properties: {}, additionalProperties: true }, { type: 'object', properties: {}, required: ['missing'] }, { $ref: '#' }])
    assert.throws(() => parseSchema(bad), code('SMALLAPP_SCHEMA_UNSUPPORTED'));
  const nested = parseSchema({ type: 'object', properties: { lines: { type: 'array', maxItems: 2, items: { type: 'object', properties: { qty: { type: 'integer', minimum: 1 }, on: { type: 'string', format: 'date' }, ok: { type: 'boolean' } }, required: ['qty'] } } } });
  assert.doesNotThrow(() => checkPayload(nested, { lines: [{ qty: 3, on: '2026-02-28', ok: true }] }));
  assert.throws(() => checkPayload(nested, { lines: [{ qty: 0 }] }), code('SMALLAPP_PAYLOAD_INVALID'));
  assert.throws(() => checkPayload(nested, { lines: [{ qty: 1, on: '2026-02-30' }] }), code('SMALLAPP_PAYLOAD_INVALID'));
  assert.throws(() => checkPayload(nested, { lines: [{ qty: 1 }, { qty: 1 }, { qty: 1 }] }), code('SMALLAPP_PAYLOAD_INVALID'));
});

test('planner: any catalogue action is named by its words, English or romanised Hindi; unavailable rows never reach a card', async () => {
  const catalogue = await loadCatalogue(fakeHost({ writeback: rows }));
  const menu: Menu = { dictionary, actions: catalogue.rows, branches: ['main'] };
  const refund = plan('sales this month with a refund button', menu, ['*']);
  assert.deepEqual(refund.descriptor!.uses.actions, ['razorpay/refund']);
  assert.deepEqual(refund.descriptor!.uses.calculations, ['revenue']); // "refund button" names the action, not the refunds figure
  assert.equal(refund.supported && refund.actions[0].alwaysWaits, true);
  assert.match(refund.message, /always waits for a person/);
  const figure = plan('refunds this month and a reminder button', menu, ['*']);
  assert.deepEqual(figure.descriptor!.uses.calculations, ['refunds']);
  assert.deepEqual(figure.descriptor!.uses.actions, ['local/reminder-draft']); // ties go to the action that does not always wait
  assert.deepEqual(plan('udhaar wale customers ko email se yaad dilao', menu, ['*']).descriptor!.uses.actions, ['zoho-books/payment-reminder']);
  assert.deepEqual(plan('vasooli is mahine, sheet mein darj karo', menu, ['*']).descriptor!.uses.actions, ['google-sheets/append-row']);
  const price = plan('change the price of shoes', menu, ['*']);
  assert.equal(price.supported, false); assert.deepEqual(price.understood.unavailableActions, ['shopify/set-price']);
  assert.match(price.message, /not available now/);
  // A generic word alone does not choose an action.
  assert.deepEqual(plan('sales this month with payment', menu, ['*']).descriptor!.uses.actions, []);
  // An unavailable row cannot be smuggled in through a proposed descriptor either.
  const smuggled = structuredClone(refund.descriptor!) as any;
  smuggled.cards[1].connector = 'shopify'; smuggled.cards[1].operation = 'set-price'; smuggled.uses.actions = ['shopify/set-price'];
  assert.throws(() => checkAgainstMenu(parseDescriptor(smuggled), menu, ['*']), code('SMALLAPP_ACTION_UNAVAILABLE'));
});

async function appWith(host: ReturnType<typeof fakeHost>, line: string) {
  const proposed = await smallAppsPart.methods['smallapps.propose'].handler(owner, { line }, host) as any;
  return smallAppsPart.methods['smallapps.create'].handler(owner, { descriptor: proposed.descriptor }, host) as any;
}
test('press: writeback rows prepare through writeback.prepare, always-waits is marked, the schema guards the payload', async () => {
  const prepared: any[] = [];
  const host = fakeHost({ writeback: rows, prepare: payload => { prepared.push(payload); return { id: 'wb_action_1', status: 'prepared', digest: 'e'.repeat(64), impact: 'money' }; } });
  const app = await appWith(host, 'sales this month with a refund button');
  const card = app.descriptor.cards.find((c: any) => c.kind === 'action');
  assert.deepEqual(app.actions.map((a: any) => [a.action, a.alwaysWaits, a.tier]), [['razorpay/refund', true, 'money']]);
  const opened = await smallAppsPart.methods['smallapps.open'].handler(owner, { id: app.id, onDate: '2026-10-14' }, host) as any;
  const shown = opened.cards.find((c: any) => c.kind === 'action');
  assert.equal(shown.alwaysWaits, true); assert.equal(shown.press, 'prepares-for-approval'); assert.match(shown.words, /Always waits for a person/);
  const press = (payload: unknown) => smallAppsPart.methods['smallapps.pressAction'].handler(owner, { id: app.id, cardId: card.id, payload, idempotencyKey: 'press-key-1' }, host) as Promise<any>;
  await assert.rejects(press({ paymentId: 'pay_1', amountMinor: '12.50' }), code('SMALLAPP_PAYLOAD_INVALID'));
  await assert.rejects(press({ paymentId: 'pay_1', amountMinor: '1250', execute: true }), code('SMALLAPP_PAYLOAD_INVALID'));
  assert.equal(prepared.length, 0);
  const result = await press({ paymentId: 'pay_1', amountMinor: '125000' });
  assert.deepEqual(prepared, [{ system: 'razorpay', operation: 'refund', payload: { paymentId: 'pay_1', amountMinor: '125000' }, idempotencyKey: 'press-key-1' }]);
  assert.equal(result.action.through, 'writeback'); assert.equal(result.action.status, 'prepared');
  assert.equal(result.approval.waits, true); assert.equal(result.approval.alwaysWaits, true);
  assert.match(result.words, /waits for a person/);
  assert.ok(!host.calls.some(c => /approve|execute/.test(c.method)));
  // A writeback that answers with anything but "prepared" is refused, not passed on.
  const rogue = fakeHost({ writeback: rows, prepare: () => ({ id: 'wb_2', status: 'executed', digest: 'f'.repeat(64) }) });
  const other = await appWith(rogue, 'sales this month with a refund button');
  await assert.rejects(smallAppsPart.methods['smallapps.pressAction'].handler(owner, { id: other.id, cardId: card.id, payload: { paymentId: 'p', amountMinor: '1' } }, rogue) as Promise<unknown>, code('SMALLAPP_PREPARE_UNREADABLE'));
});

test('press: a writeback row falls back to core actions.prepare when writeback.prepare is absent; a row gone unavailable cannot be pressed', async () => {
  const listed = structuredClone(rows);
  const host = fakeHost({ writeback: listed });
  const app = await appWith(host, 'append to the sheet button');
  const card = app.descriptor.cards.find((c: any) => c.kind === 'action');
  const result = await smallAppsPart.methods['smallapps.pressAction'].handler(owner, { id: app.id, cardId: card.id, payload: { anything: 'goes to core' } }, host) as any;
  assert.equal(result.action.through, 'core'); assert.equal(result.approval.alwaysWaits, false);
  assert.deepEqual(host.calls.filter(c => c.method.endsWith('prepare')).map(c => [c.method, c.payload.connector ?? c.payload.system]), [['writeback.prepare', 'google-sheets'], ['actions.prepare', 'google-sheets']]);
  listed[3].status = 'paused';
  const opened = await smallAppsPart.methods['smallapps.open'].handler(owner, { id: app.id, onDate: '2026-10-14' }, host) as any;
  assert.equal(opened.cards.find((c: any) => c.kind === 'action').press, 'unavailable');
  await assert.rejects(smallAppsPart.methods['smallapps.pressAction'].handler(owner, { id: app.id, cardId: card.id, payload: {} }, host) as Promise<unknown>, code('SMALLAPP_ACTION_UNAVAILABLE'));
  // Removed from the catalogue altogether: the app is out of date.
  listed.splice(3, 1);
  await assert.rejects(smallAppsPart.methods['smallapps.pressAction'].handler(owner, { id: app.id, cardId: card.id, payload: {} }, host) as Promise<unknown>, code('SMALLAPP_OUT_OF_DATE'));
});

test('prepareAction never reaches past prepare and refuses malformed replies', async () => {
  const row = (await loadCatalogue(fakeHost({ writeback: rows }))).rows.find(r => r.key === 'zoho-books/payment-reminder')!;
  const host = (reply: unknown) => ({ call: async (method: string) => { if (method === 'writeback.prepare') return reply; throw new ChausarError('UNKNOWN_METHOD', 'x'); } });
  await assert.rejects(prepareAction(host({ id: 'a b', status: 'prepared', digest: 'x'.repeat(64) }), row, { payload: {}, idempotencyKey: 'key-12345' }), code('SMALLAPP_PREPARE_UNREADABLE'));
  await assert.rejects(prepareAction(host({ id: 'a', status: 'approved', digest: 'x'.repeat(64) }), row, { payload: {}, idempotencyKey: 'key-12345' }), code('SMALLAPP_PREPARE_UNREADABLE'));
  await assert.rejects(prepareAction({ call: async () => { throw new ChausarError('INVALID_PAYLOAD', 'x'); } }, row, { payload: {}, idempotencyKey: 'key-12345' }), code('INVALID_PAYLOAD'));
});

test('date independence: presets resolve against the trusted clock, never the system date', async t => {
  const host = fakeHost({ clock: () => '2026-03-05T23:30:00.000Z' });
  const app = await appWith(host, 'sales last month');
  const opened = await smallAppsPart.methods['smallapps.open'].handler(owner, { id: app.id }, host) as any;
  assert.equal(opened.onDate, '2026-03-05');
  assert.deepEqual(opened.cards[0].value.period, { from: '2026-02-01', to: '2026-02-28' });
  const broken = fakeHost({ clock: () => 'yesterday' });
  const other = await appWith(broken, 'sales last month');
  await assert.rejects(smallAppsPart.methods['smallapps.open'].handler(owner, { id: other.id }, broken) as Promise<unknown>, code('SMALLAPP_CLOCK_INVALID'));
  // Through the real engine: the module clock option sets "today" for the demo shop.
  const directory = await mkdtemp(join(tmpdir(), 'chausar-mx-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'models-ext': { clock: () => new Date('2026-10-14T08:00:00.000Z') } } });
  t.after(async () => { try { await engine.request('workspace.lock'); } catch { /* already locked */ } await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Demo Shop', passphrase: 'correct horse battery staple 42', demo: true, pack: 'ecommerce' });
  const proposed = await engine.request('smallapps.propose', { line: 'sales last month with a reminder button' });
  assert.equal(proposed.catalogue.writeback, 'absent'); // core fallback: no writeback module in this engine
  const created = await engine.request('smallapps.create', { descriptor: proposed.descriptor });
  const shown = await engine.request('smallapps.open', { id: created.id });
  assert.equal(shown.onDate, '2026-10-14');
  assert.equal(shown.cards[0].value.figures[0].minor, '250000');
  const action = shown.cards.find((c: any) => c.kind === 'action');
  assert.equal(action.alwaysWaits, false); assert.equal(action.available, true);
});
