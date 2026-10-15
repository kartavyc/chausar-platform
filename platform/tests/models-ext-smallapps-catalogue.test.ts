import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { ChausarError, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { compileDictionary, starterPacks } from '../runtime/ontology.ts';
import { checkPayload, coreRows, loadCatalogue, prepareAction, writebackRow } from '../runtime/smallapps/catalogue-adapter.ts';
import { checkAgainstMenu, parseDescriptor, type Menu } from '../runtime/smallapps/descriptor.ts';
import { plan } from '../runtime/smallapps/planner.ts';
import { smallAppsPart } from '../runtime/smallapps/methods.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const dictionary = compileDictionary(structuredClone(starterPacks.find(p => p.pack === 'ecommerce')!));
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const core = [{ id: 'local', title: 'Chausar local workspace', operations: [{ id: 'reminder-draft', title: 'Create a payment reminder draft', description: 'x', impact: 'reversible', idempotency: 'x', readback: 'x' }] }];
const granted = (id: string, environment = 'live') => ({ id, label: `Connection ${id}`, environment, read: true, write: true });
/** Rows in the shape `writeback.catalogue` returns (WritebackService.row). */
const wb = (system: string, action: string, title: string, kind: string, tier: unknown, alwaysWaits: boolean, requiredFields: string[], connections: unknown[] = [], extra: Record<string, unknown> = {}) =>
  ({ system, action, title, kind, tier, alwaysWaits, waitsBecause: 'x', plannedStatus: 'experimental', idempotency: 'x', businessReference: 'x', readBack: 'x', retryWindowHours: 24, approvalLifetimeHours: 24,
    reviewedOn: '2026-10-14', expiresOn: '2027-04-14', reversal: null, recipe: { requiredFields, preconditions: [], reference: 'x', readBackQuery: 'x' }, undoable: kind === 'inside-undoable',
    status: 'experimental', qualification: 'unqualified', installed: true, writeScore: null, connections, ...extra });
const rows = [
  wb('zoho-books', 'invoice.paymentReminder', 'Send a payment reminder from Zoho Books', 'seen-outside', 2, true, ['invoiceId', 'to', 'subject', 'body'], [granted('connection_zoho')]),
  // Says it does not wait, but it moves money: small apps add always-waits.
  wb('razorpay', 'refund.create', 'Refund a Razorpay payment', 'money', 2, false, ['paymentId', 'amountMinor'], [granted('connection_rzp'), { ...granted('connection_rzp_read_only'), write: false }]),
  wb('shopify', 'variant.price', 'Change a product price in Shopify', 'cannot-undo', 2, true, ['variantId', 'priceMinor'], [], { status: 'not-yet' }),
  wb('google-workspace', 'sheets.append', 'Add a row to a Google Sheet', 'inside-undoable', 1, false, ['spreadsheetId', 'sheet', 'values'], [granted('connection_sheet'), granted('connection_practice', 'practice')]),
  wb('gst-portal', 'return.file', 'File a GST return', 'cannot-undo', 'prepare-only', true, ['gstin', 'period', 'form'], [], { status: 'prepare-only' }),
  wb('tally', 'ledger.create', 'Create a ledger in Tally', 'inside-undoable', 1, false, ['company', 'name', 'parent'], [], { installed: false }),
  wb('tally', 'voucher.create', 'Enter a voucher in Tally', 'inside-undoable', 'review', false, []),
  wb('Bad System', 'x', 'Bad', 'inside-undoable', 1, false, []),
  wb('dup', 'one.make', 'Duplicate', 'inside-undoable', 1, false, []),
  wb('dup', 'one.make', 'Duplicate again', 'inside-undoable', 1, false, []),
];
const SYSTEM_OF: Record<string, [string, string]> = { 'refund.create': ['razorpay', 'money'], 'sheets.append': ['google-workspace', 'inside-undoable'], 'invoice.paymentReminder': ['zoho-books', 'seen-outside'] };
/** The view `writeback.prepare` answers with (WritebackService.view), trimmed. */
const view = (request: any, extra: Record<string, unknown> = {}) => ({ id: 'action_wb_1', system: SYSTEM_OF[request.action][0], action: request.action, title: 'x', digest: 'e'.repeat(64),
  taintedSource: false, revision: 1, status: 'prepared', word: 'waiting-for-you', practice: request.connectionId === 'connection_practice', kind: SYSTEM_OF[request.action][1], tier: 2,
  alwaysWaits: request.action !== 'sheets.append', expiresAt: '2026-10-15T08:00:00.000Z', approval: { approvalId: 'action_wb_1', needsSecondAsk: request.action === 'refund.create', can: ['approve', 'notNow', 'change', 'drop'] }, ...extra });

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

test('adapter: writeback rows are checked strictly against the real row shape, bad and duplicate rows are not counted, core rows fill in', async () => {
  const catalogue = await loadCatalogue(fakeHost({ writeback: rows }));
  assert.equal(catalogue.writeback, 'used');
  assert.deepEqual(catalogue.rows.map(r => r.key), ['google-workspace/sheets.append', 'gst-portal/return.file', 'local/reminder-draft', 'razorpay/refund.create', 'shopify/variant.price',
    'tally/ledger.create', 'zoho-books/invoice.paymentReminder']);
  assert.equal(catalogue.notCounted, 4); // a tier outside the contract, a bad system id, two duplicates
  assert.match(catalogue.words!, /not counted/);
  const by = Object.fromEntries(catalogue.rows.map(r => [r.key, r]));
  // A row that says it does not wait is still put on the always-waits list when it moves money.
  assert.equal(by['razorpay/refund.create'].alwaysWaits, true); assert.equal(by['razorpay/refund.create'].impact, 'money');
  assert.equal(by['google-workspace/sheets.append'].alwaysWaits, false); assert.equal(by['google-workspace/sheets.append'].tier, 1);
  assert.deepEqual(by['google-workspace/sheets.append'].requiredFields, ['spreadsheetId', 'sheet', 'values']);
  // Not on a card: not yet built, prepare-only for good, or listed without its adapter installed.
  for (const key of ['shopify/variant.price', 'gst-portal/return.file', 'tally/ledger.create']) assert.equal(by[key].available, false, key);
  // Only connections with read and this action's write grant can prepare.
  assert.deepEqual(by['razorpay/refund.create'].connections.map(c => [c.id, c.write]), [['connection_rzp', true], ['connection_rzp_read_only', false]]);
  assert.equal(by['local/reminder-draft'].origin, 'core');
  // Absent, and unreadable (the reply is a plain array and nothing else).
  assert.equal((await loadCatalogue(fakeHost())).writeback, 'absent');
  assert.deepEqual((await loadCatalogue(fakeHost())).rows.map(r => r.key), ['local/reminder-draft']);
  for (const reply of ['rows', { rows }]) {
    const unreadable = await loadCatalogue(fakeHost({ writeback: reply }));
    assert.equal(unreadable.writeback, 'unreadable'); assert.deepEqual(unreadable.rows.map(r => r.key), ['local/reminder-draft']);
  }
  // Other refusals from writeback are not swallowed.
  await assert.rejects(loadCatalogue({ call: async () => { throw new ChausarError('ACCESS_REVOKED', 'x'); } }), code('ACCESS_REVOKED'));
  // The shape assumed before the merge (operation, label, impact, a string tier) is not the contract.
  assert.throws(() => writebackRow({ system: 'tally', operation: 'voucher', label: 'Import a voucher', tier: 'review', alwaysWaits: false, status: 'full', impact: 'reversible' }), code('SMALLAPP_ROW_INVALID'));
  assert.throws(() => writebackRow({ ...rows[0], alwaysWaits: 'no' }), code('SMALLAPP_ROW_INVALID'));
  assert.throws(() => writebackRow({ ...rows[0], title: 'Send‮reminder' }), code('SMALLAPP_ROW_INVALID'));
  assert.throws(() => writebackRow({ ...rows[0], action: 'invoice..reminder' }), code('SMALLAPP_ROW_INVALID'));
  assert.throws(() => writebackRow({ ...rows[0], status: 'full' }), code('SMALLAPP_ROW_INVALID'));
  assert.throws(() => writebackRow({ ...rows[0], recipe: { requiredFields: ['ok', 'not ok'] } }), code('SMALLAPP_ROW_INVALID'));
  assert.throws(() => writebackRow({ ...rows[0], connections: [{ id: 'c', label: 'C', environment: 'moon', read: true, write: true }] }), code('SMALLAPP_ROW_INVALID'));
  assert.equal(coreRows([{ id: 'x', operations: [{ id: 'y', title: 'T', impact: 'teleport' }] }]).notCounted, 1);
});

test("adapter: a writeback payload is a small plain object with every required field; its exact shape is the writeback adapter's", () => {
  const row = writebackRow(rows[1]);
  assert.doesNotThrow(() => checkPayload(row, { paymentId: 'pay_42', amountMinor: '125000' }));
  // Person-typed values are data: digits pass here, and the writeback adapter judges amounts and unknown fields.
  assert.doesNotThrow(() => checkPayload(row, { paymentId: 'pay_42', amountMinor: '1250.00', extra: true }));
  for (const bad of [{ paymentId: 'pay_42' }, [], 'x', null, Object.assign(Object.create({ amountMinor: '1' }), { paymentId: 'p' }), { paymentId: 'p', amountMinor: 'x'.repeat(70_000) }])
    assert.throws(() => checkPayload(row, bad), code('SMALLAPP_PAYLOAD_INVALID'));
  const cyclic: any = { paymentId: 'p', amountMinor: '1' }; cyclic.self = cyclic;
  assert.throws(() => checkPayload(row, cyclic), code('SMALLAPP_PAYLOAD_INVALID'));
});

test('planner: any catalogue action is named by its words, English or romanised Hindi; unavailable rows never reach a card', async () => {
  const catalogue = await loadCatalogue(fakeHost({ writeback: rows }));
  const menu: Menu = { dictionary, actions: catalogue.rows, branches: ['main'] };
  const refund = plan('sales this month with a refund button', menu, ['*']);
  assert.deepEqual(refund.descriptor!.uses.actions, ['razorpay/refund.create']);
  assert.deepEqual(refund.descriptor!.uses.calculations, ['revenue']); // "refund button" names the action, not the refunds figure
  assert.equal(refund.supported && refund.actions[0].alwaysWaits, true);
  assert.match(refund.message, /always waits for a person/);
  const figure = plan('refunds this month and a reminder button', menu, ['*']);
  assert.deepEqual(figure.descriptor!.uses.calculations, ['refunds']);
  assert.deepEqual(figure.descriptor!.uses.actions, ['local/reminder-draft']); // ties go to the action that does not always wait
  assert.deepEqual(plan('zoho se udhaar wale customers ko yaad dilao', menu, ['*']).descriptor!.uses.actions, ['zoho-books/invoice.paymentReminder']);
  assert.deepEqual(plan('vasooli is mahine, sheet mein darj karo', menu, ['*']).descriptor!.uses.actions, ['google-workspace/sheets.append']);
  const price = plan('change the price of shoes', menu, ['*']);
  assert.equal(price.supported, false); assert.deepEqual(price.understood.unavailableActions, ['shopify/variant.price']);
  assert.match(price.message, /not available now/);
  // A generic word alone does not choose an action.
  assert.deepEqual(plan('sales this month with payment', menu, ['*']).descriptor!.uses.actions, []);
  // An unavailable row cannot be smuggled in through a proposed descriptor either.
  const smuggled = structuredClone(refund.descriptor!) as any;
  smuggled.cards[1].connector = 'shopify'; smuggled.cards[1].operation = 'variant.price'; smuggled.uses.actions = ['shopify/variant.price'];
  assert.throws(() => checkAgainstMenu(parseDescriptor(smuggled), menu, ['*']), code('SMALLAPP_ACTION_UNAVAILABLE'));
  for (const operation of ['variant..price', 'Variant.price', 'variant.price.', 'x'.repeat(65)]) {
    const bad = structuredClone(refund.descriptor!) as any; bad.cards[1].operation = operation; bad.uses.actions = [`razorpay/${operation}`];
    assert.throws(() => parseDescriptor(bad), code('SMALLAPP_INVALID'), operation);
  }
});

async function appWith(host: ReturnType<typeof fakeHost>, line: string) {
  const proposed = await smallAppsPart.methods['smallapps.propose'].handler(owner, { line }, host) as any;
  return smallAppsPart.methods['smallapps.create'].handler(owner, { descriptor: proposed.descriptor, request: line }, host) as any;
}
const pressOf = (host: ReturnType<typeof fakeHost>, app: any, cardId: string) => (payload: unknown, more: Record<string, unknown> = {}) =>
  smallAppsPart.methods['smallapps.pressAction'].handler(owner, { id: app.id, cardId, payload, ...more }, host) as Promise<any>;

test('press: writeback rows prepare through writeback.prepare with the real request, always-waits and the second ask are marked', async () => {
  const prepared: any[] = [];
  const host = fakeHost({ writeback: rows, prepare: request => { prepared.push(request); return view(request); } });
  const app = await appWith(host, 'sales this month with a refund button');
  const card = app.descriptor.cards.find((c: any) => c.kind === 'action');
  assert.deepEqual([card.connector, card.operation], ['razorpay', 'refund.create']);
  assert.deepEqual(app.actions.map((a: any) => [a.action, a.alwaysWaits, a.tier]), [['razorpay/refund.create', true, 2]]);
  const opened = await smallAppsPart.methods['smallapps.open'].handler(owner, { id: app.id, onDate: '2026-10-14' }, host) as any;
  const shown = opened.cards.find((c: any) => c.kind === 'action');
  assert.equal(shown.alwaysWaits, true); assert.equal(shown.press, 'prepares-for-approval'); assert.match(shown.words, /Always waits for a person/);
  assert.deepEqual(shown.connections, [{ id: 'connection_rzp', label: 'Connection connection_rzp', environment: 'live', practice: false }]);
  const press = pressOf(host, app, card.id);
  await assert.rejects(press({ paymentId: 'pay_1' }), code('SMALLAPP_PAYLOAD_INVALID'));
  await assert.rejects(press({ paymentId: 'pay_1', amountMinor: '1250' }, { connectionId: 'connection_rzp_read_only' }), code('SMALLAPP_CONNECTION_NOT_GRANTED'));
  await assert.rejects(press({ paymentId: 'pay_1', amountMinor: '1250' }, { idempotencyKey: 'has spaces' }), code('SMALLAPP_INVALID'));
  await assert.rejects(press({ paymentId: 'pay_1', amountMinor: '1250' }, { approve: true }), code('SMALLAPP_INVALID'));
  assert.equal(prepared.length, 0);
  const result = await press({ paymentId: 'pay_1', amountMinor: '125000' }, { idempotencyKey: 'press-key-1', sourceIds: ['src-1'] });
  assert.deepEqual(prepared, [{ connectionId: 'connection_rzp', action: 'refund.create', payload: { paymentId: 'pay_1', amountMinor: '125000' }, intentId: 'press-key-1', sourceIds: ['src-1'] }]);
  assert.deepEqual(result.action, { id: 'action_wb_1', connector: 'razorpay', operation: 'refund.create', status: 'prepared', impact: 'money', digest: 'e'.repeat(64), through: 'writeback',
    connectionId: 'connection_rzp', practice: false, expiresAt: '2026-10-15T08:00:00.000Z' });
  assert.deepEqual(result.approval, { waits: true, alwaysWaits: true, tier: 2, kind: 'action', id: 'action_wb_1', digest: 'e'.repeat(64), secondAsk: true, approveWith: 'writeback.approve', reauthWith: 'writeback.reauth' });
  assert.match(result.words, /waits for a person/); assert.match(result.words, /passphrase again/);
  assert.ok(!host.calls.some(c => /approve|execute|reauth/.test(c.method)));
  // A writeback that answers with anything but "prepared", or for another action, is refused, not passed on.
  for (const reply of [(r: any) => view(r, { status: 'approved' }), (r: any) => view(r, { status: 'verified' }), (r: any) => view(r, { action: 'paymentLink.create' }),
    (r: any) => view(r, { approval: {} }), (r: any) => view(r, { id: 'a b' }), () => 'prepared']) {
    const rogue = fakeHost({ writeback: rows, prepare: reply });
    const other = await appWith(rogue, 'sales this month with a refund button');
    await assert.rejects(pressOf(rogue, other, card.id)({ paymentId: 'p', amountMinor: '1' }), code('SMALLAPP_PREPARE_UNREADABLE'));
  }
  // Already in the system: nothing prepared, nothing recorded as a press.
  const done = fakeHost({ writeback: rows, prepare: () => ({ status: 'already-done', externalId: 'rfnd_1', preview: { asWritten: 'x' }, target: { label: 'x', ref: null }, message: 'x' }) });
  const doneApp = await appWith(done, 'sales this month with a refund button');
  const already = await pressOf(done, doneApp, card.id)({ paymentId: 'p', amountMinor: '1' });
  assert.equal(already.action, null); assert.deepEqual(already.alreadyDone, { connector: 'razorpay', operation: 'refund.create', externalId: 'rfnd_1' });
  assert.equal((done.store.read() as any).extensions['models-ext'].smallApps.apps[0].presses.length, 0);
});

test('press: the connection is the named granted one or the only one; practice is marked; without writeback.prepare nothing is prepared', async () => {
  const listed = structuredClone(rows);
  const host = fakeHost({ writeback: listed, prepare: view });
  const app = await appWith(host, 'append to the sheet button');
  const card = app.descriptor.cards.find((c: any) => c.kind === 'action');
  const press = pressOf(host, app, card.id), payload = { spreadsheetId: 's', sheet: 'Dues', values: ['a'] };
  await assert.rejects(press(payload), code('SMALLAPP_CONNECTION_REQUIRED'));
  const practice = await press(payload, { connectionId: 'connection_practice' });
  assert.equal(practice.action.practice, true); assert.equal(practice.approval.alwaysWaits, false); assert.equal(practice.approval.secondAsk, false);
  assert.match(practice.words, /^Practice: nothing goes to a real system/);
  // A row whose grants are gone: the card says so and a press prepares nothing.
  listed[3].connections = [];
  const opened = await smallAppsPart.methods['smallapps.open'].handler(owner, { id: app.id, onDate: '2026-10-14' }, host) as any;
  assert.equal(opened.cards.find((c: any) => c.kind === 'action').press, 'needs-connection');
  await assert.rejects(press(payload), code('SMALLAPP_CONNECTION_NOT_GRANTED'));
  // Writeback rows never fall back to the core prepare: core does not know these systems.
  listed[3].connections = [granted('connection_sheet')];
  const noPrepare = fakeHost({ writeback: listed });
  const other = await appWith(noPrepare, 'append to the sheet button');
  await assert.rejects(pressOf(noPrepare, other, card.id)(payload), code('SMALLAPP_ACTION_UNAVAILABLE'));
  assert.ok(!noPrepare.calls.some(c => c.method === 'actions.prepare'));
  // A row gone unavailable cannot be pressed; removed from the catalogue, the app is out of date.
  listed[3].status = 'not-yet';
  await assert.rejects(press(payload), code('SMALLAPP_ACTION_UNAVAILABLE'));
  listed.splice(3, 1);
  await assert.rejects(press(payload), code('SMALLAPP_OUT_OF_DATE'));
});

test('press: core rows still prepare through actions.prepare when writeback is absent, and take no connection', async () => {
  const host = fakeHost();
  const app = await appWith(host, 'collections this month with a reminder button');
  const card = app.descriptor.cards.find((c: any) => c.kind === 'action');
  await assert.rejects(pressOf(host, app, card.id)({ invoiceId: 'inv-1' }, { connectionId: 'connection_x' }), code('SMALLAPP_INVALID'));
  const result = await pressOf(host, app, card.id)({ invoiceId: 'inv-1' }, { idempotencyKey: 'core-key-1' });
  assert.equal(result.action.through, 'core'); assert.equal(result.approval.approveWith, 'actions.approve');
  assert.deepEqual(host.calls.filter(c => c.method.endsWith('prepare')).map(c => [c.method, c.payload]),
    [['actions.prepare', { connector: 'local', operation: 'reminder-draft', payload: { invoiceId: 'inv-1' }, idempotencyKey: 'core-key-1' }]]);
});

test('prepareAction never reaches past prepare and passes writeback refusals through', async () => {
  const row = (await loadCatalogue(fakeHost({ writeback: rows }))).rows.find(r => r.key === 'zoho-books/invoice.paymentReminder')!;
  const host = (reply: unknown) => ({ call: async (method: string) => { if (method === 'writeback.prepare') return reply; throw new ChausarError('UNKNOWN_METHOD', 'x'); } });
  const request = { payload: {}, intentId: 'intent-1' };
  await assert.rejects(prepareAction(host({ ...view({ action: 'invoice.paymentReminder' }), id: 'a b' }), row, request), code('SMALLAPP_PREPARE_UNREADABLE'));
  await assert.rejects(prepareAction(host(view({ action: 'invoice.paymentReminder' }, { status: 'approved' })), row, request), code('SMALLAPP_PREPARE_UNREADABLE'));
  for (const refusal of ['INVALID_WRITE_PAYLOAD', 'WRITE_NOT_GRANTED', 'IDEMPOTENCY_CONFLICT'])
    await assert.rejects(prepareAction({ call: async () => { throw new ChausarError(refusal, 'x'); } }, row, request), code(refusal));
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
  // The installed writeback module answers the catalogue; the absent fallback is covered with a stub host above.
  assert.equal(proposed.catalogue.writeback, 'used'); assert.equal(proposed.catalogue.notCounted, 0);
  const created = await engine.request('smallapps.create', { descriptor: proposed.descriptor });
  const shown = await engine.request('smallapps.open', { id: created.id });
  assert.equal(shown.onDate, '2026-10-14');
  assert.equal(shown.cards[0].value.figures[0].minor, '250000');
  const action = shown.cards.find((c: any) => c.kind === 'action');
  assert.equal(action.alwaysWaits, false); assert.equal(action.available, true);
});

test('press: an app not made by the local planner presses as outside text, and a repeated press is one intent', async () => {
  const prepared: any[] = [];
  const host = fakeHost({ writeback: rows, prepare: request => { prepared.push(request); return view(request); } });
  const planned = await appWith(host, 'sales this month with a refund button');
  assert.equal(planned.madeBy, 'planner');
  const proposed = await smallAppsPart.methods['smallapps.propose'].handler(owner, { line: 'sales this month with a refund button' }, host) as any;
  const outside = await smallAppsPart.methods['smallapps.create'].handler(owner, { descriptor: proposed.descriptor }, host) as any;
  assert.equal(outside.madeBy, 'outside');
  const cardOf = (app: any) => app.descriptor.cards.find((c: any) => c.kind === 'action').id;
  await pressOf(host, outside, cardOf(outside))({ paymentId: 'pay_1', amountMinor: '125000' });
  assert.equal(prepared.at(-1).sourceTainted, true);
  await pressOf(host, planned, cardOf(planned))({ paymentId: 'pay_1', amountMinor: '125000' });
  await pressOf(host, planned, cardOf(planned))({ paymentId: 'pay_1', amountMinor: '125000' });
  assert.equal(prepared.at(-1).sourceTainted, undefined);
  assert.equal(prepared.at(-1).intentId, prepared.at(-2).intentId, 'the same card and payload is the same intent');
  await pressOf(host, planned, cardOf(planned))({ paymentId: 'pay_2', amountMinor: '125000' });
  assert.notEqual(prepared.at(-1).intentId, prepared.at(-2).intentId);
});
