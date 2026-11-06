// C2 task 2: the engine answers venture.find (read). It looks through the open business's clients, invoices, orders, runs
// and chats through the lists the owner's screens read, ranks them with find-core.ts, and writes nothing: no read mark on
// a chat it found, no event, no new record.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { ChatPart, ChiefThreadRecord, ChiefThreadsView, ClientRecord, InvoiceRecord, OrderRecord, VentureRunEvent } from '../runtime/venture/contracts.ts';
import type { FindItem, FindView } from '../runtime/venture/views/find-core.ts';
import { parseFindRequest } from '../runtime/venture/views/find-core.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { appendChiefMessage } from '../runtime/venture/chief/store.ts';
import { threadsHandler } from '../runtime/venture/chief/threads.ts';
import { VentureHost } from '../runtime/venture/host.ts';
import { listInvoices } from '../runtime/venture/money/invoices.ts';
import { ChausarError, type ModelTransport } from '../runtime/contracts.ts';
import { call, owner, seedBlueprint, seedOrder, seedRun, setup, type Env } from './venture-views-env.ts';

const find = (env: Env, payload: unknown, ctx: Context = owner) => call<FindView>(env, 'venture.find' as never, payload, ctx);
const kinds = (view: FindView) => view.groups.map(group => group.kind);
const items = (view: FindView, kind: FindItem['kind']) => view.groups.find(group => group.kind === kind)?.items ?? [];

async function seedClient(env: Env, name: string): Promise<ClientRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.client', tx => tx.put<ClientRecord>({ ...tx.base('venture-client'), name, email: null, countryCode: 'IN', taxId: null, stateCode: '27', note: null }));
}

async function seedInvoice(env: Env, order: OrderRecord, clientId: string, number: string | null): Promise<InvoiceRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.invoice', tx => tx.put({
    ...tx.base('venture-invoice'), number, documentTitle: 'TAX INVOICE', orderId: order.id, clientId, currency: 'INR', issueDate: number ? '2026-10-14' : null, dueDate: number ? '2026-10-24' : null, dueInDays: 10,
    lines: [], subtotalMinor: '249900', discountMinor: '0', taxMinor: '44982', totalMinor: '294882', taxLabel: 'GST', taxRateBps: '1800', taxTreatment: 'cgst-sgst',
    taxLines: [], supplierTaxId: null, clientTaxId: null, placeOfSupply: null, sacCode: null, status: number ? 'issued' : 'draft', priceReceiptId: order.priceReceiptId, digest: `digest-${number}`,
    issuedAt: number ? '2026-10-14T10:00:00.000Z' : null, factIds: [], booksReceiptId: null, booksNote: null, paidMinor: '0', balanceMinor: '294882',
  } as InvoiceRecord));
}

async function seedChat(env: Env, title: string, answer: ChatPart[] | string, read = false): Promise<string> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.chief', tx => {
    const thread = tx.put<ChiefThreadRecord>({ ...tx.base('venture-chief-thread'), title, pinned: false, routine: null, lastAt: tx.now });
    appendChiefMessage(tx, { threadId: thread.id, from: 'owner', text: title, author: 'owner' });
    const parts = typeof answer === 'string' ? undefined : answer;
    const text = typeof answer === 'string' ? answer : answer.map(part => part.kind === 'figure' ? part.display : part.text).join(' ');
    const message = appendChiefMessage(tx, { threadId: thread.id, from: 'chief', text, ...(parts ? { parts } : {}), author: 'model' });
    if (read) tx.replace({ ...message, read: true });
    return thread.id;
  });
}

/** The plan's seeds: Meera Iyer with an issued invoice, Test Bakery, a delivered order, a run, a chat that says Razorpay. */
async function seeded() {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order: cafeOrder } = await seedOrder(env, plan);
  env.advance(60_000);
  const meera = await seedClient(env, 'Meera Iyer');
  const bakery = await seedClient(env, 'Test Bakery');
  const order = await ventureAction(env.deps, owner, 'prepare', 'seed.meera.order', tx => tx.put<OrderRecord>({
    ...tx.base('venture-order'), clientId: meera.id, offerId: 'offer_1', quantity: '1', request: 'Wedding album design for the December function', status: 'delivered',
    priceReceiptId: cafeOrder.priceReceiptId, deliveredOn: '2026-10-14', saleFactId: null,
  }));
  const internal = await ventureAction(env.deps, owner, 'prepare', 'seed.internal', tx => tx.put<OrderRecord>({
    ...tx.base('venture-order'), clientId: meera.id, offerId: 'offer_1', quantity: '1', request: 'Chausar own bookkeeping review', status: 'open', internal: true,
    priceReceiptId: cafeOrder.priceReceiptId, deliveredOn: null, saleFactId: null,
  }));
  const invoice = await seedInvoice(env, order, meera.id, 'INV-0041');
  const run = await seedRun(env, order, { status: 'accepted', verdict: { choice: 'accepted', reason: null, at: env.now() } });
  env.advance(60_000);
  const chat = await seedChat(env, 'Money this month', 'Your Razorpay payouts are settled every Tuesday.');
  return { env, meera, bakery, order, internal, invoice, run, chat };
}

test('"INV" finds the invoice with its number, total and receipt; "meera" finds the client first, then her invoice and order', async () => {
  const { env, meera, invoice, order } = await seeded();
  const inv = await find(env, { text: 'INV' });
  const found = items(inv, 'invoice');
  assert.equal(found.length, 1);
  const row = found[0] as Extract<FindItem, { kind: 'invoice' }>;
  assert.equal(row.id, invoice.id);
  assert.equal(row.number, 'INV-0041');
  assert.equal(row.receiptId, invoice.priceReceiptId);
  assert.match(row.total, /2,948\.82/);
  assert.equal(row.clientName, 'Meera Iyer');
  assert.deepEqual(row.hit, { field: 'number', start: 0, length: 8 });
  const listed = (await listInvoices(env.deps, owner, {})).find(item => item.id === invoice.id)!;
  assert.deepEqual([row.number, row.status, row.total, row.receiptId], [listed.number, listed.status, listed.total, listed.receiptId], 'the row the invoice list shows');

  const byName = await find(env, { text: 'meera' });
  assert.equal(kinds(byName)[0], 'client');
  assert.equal(items(byName, 'client')[0]!.id, meera.id);
  assert.deepEqual(items(byName, 'client')[0]!.hit, { field: 'name', start: 0, length: 5 });
  assert.deepEqual(items(byName, 'invoice').map(item => item.id), [invoice.id]);
  assert.deepEqual(items(byName, 'order').map(item => item.id), [order.id]);
  for (const group of byName.groups) assert.ok(group.best >= (byName.groups.at(-1)!.best), 'groups come in score order');
});

test('"razorpay" finds the chat by its answer, with a snippet holding the word; one character finds nothing', async () => {
  const { env, chat } = await seeded();
  const view = await find(env, { text: 'razorpay' });
  assert.deepEqual(kinds(view), ['chat']);
  const row = items(view, 'chat')[0] as Extract<FindItem, { kind: 'chat' }>;
  assert.equal(row.id, chat);
  assert.equal(row.title, 'Money this month');
  assert.equal(row.hit, null);
  assert.equal(row.state, 'active');
  assert.ok(row.snippet);
  assert.match(row.snippet!.line, /Razorpay/);
  assert.equal(row.snippet!.from, 'chief');
  assert.deepEqual(await find(env, { text: 'r' }), { groups: [] });
  assert.deepEqual(await find(env, { text: '  m  ' }), { groups: [] });
});

test('a find leaves an unread answer unread', async () => {
  const { env } = await seeded();
  const unread = async () => (await threadsHandler(env.deps, owner, {}) as ChiefThreadsView).groups.flatMap(group => group.threads).reduce((sum, thread) => sum + thread.unread, 0);
  const before = await unread();
  assert.ok(before > 0);
  await find(env, { text: 'razorpay' });
  assert.equal(await unread(), before);
  assert.ok(listRecords(env.store.read(), 'venture-chief-message').some(message => message.from === 'chief' && !message.read));
});

test('an internal order is never found; a run and an invoice of the same client both come back; a cofounder finds what its lists show', async () => {
  const { env, invoice, run, internal } = await seeded();
  const own = await find(env, { text: 'chausar own' });
  assert.ok(!items(own, 'order').some(item => item.id === internal.id));
  const meera = await find(env, { text: 'meera', limit: 20 });
  assert.ok(items(meera, 'invoice').some(item => item.id === invoice.id));
  assert.ok(items(meera, 'run').some(item => item.id === run.id), 'the run is "Draft a reply for Meera Iyer"');
  await env.store.update(state => { state.members.push({ id: 'cofounder-1', name: 'Synthetic cofounder', role: 'cofounder', active: true, epoch: 1, branches: ['*'] }); });
  const cofounder: Context = { ...owner, memberId: 'cofounder-1', role: 'cofounder' };
  assert.deepEqual(await find(env, { text: 'meera', limit: 20 }, cofounder), meera);
  const viewer: Context = { ...owner, memberId: 'viewer-1', role: 'viewer' };
  await assert.rejects(find(env, { text: 'meera' }, viewer), (error: any) => error.code === 'ACCESS_REVOKED');
});

test('kinds and limit narrow the find; more says how many were left out', async () => {
  const { env } = await seeded();
  const only = await find(env, { text: 'meera', kinds: ['invoice'] });
  assert.deepEqual(kinds(only), ['invoice']);
  for (let index = 0; index < 4; index += 1) await seedClient(env, `Meera client ${index}`);
  const two = await find(env, { text: 'meera', kinds: ['client'], limit: 2 });
  assert.equal(two.groups[0]!.items.length, 2);
  assert.equal(two.groups[0]!.more, 3);
});

function silentTransport(): ModelTransport {
  return {
    replay: true,
    http: async () => { throw new ChausarError('FIXTURE_MISSING', 'No recording in this test.'); },
    process: async request => request.purpose === 'version-check' ? { exitCode: 0, stdout: 'synthetic recording' } : Promise.reject(new ChausarError('FIXTURE_MISSING', 'No recording in this test.')),
  };
}

test('through the host: a find publishes nothing and commits nothing; its refusals keep their code and words', async () => {
  const { env } = await seeded();
  const heard: VentureRunEvent[][] = [];
  const host = new VentureHost(env.store, env.deps.services, {
    demo: true, storage: 'experimental-file', host: 'test', modelTransport: silentTransport(), clock: env.deps.clock, workspace: env.workspace,
    notify: events => { heard.push(events); },
  });
  try {
    const commits = env.store.commits, revision = env.store.read().revision;
    for (const text of ['INV', 'meera', 'razorpay', 'test bakery']) await host.request(owner, 'venture.find', { text });
    assert.deepEqual(heard, []);
    assert.equal(env.store.commits, commits);
    assert.equal(env.store.read().revision, revision);
    const secret = 'what Meera owes me privately';
    for (const payload of [{}, { text: 'x'.repeat(201) }, { text: secret, kinds: ['person'] }, { text: secret, limit: 0 }, { text: secret, other: 1 }]) {
      let expected = '';
      try { parseFindRequest(payload); } catch (error: any) { expected = error.message; }
      assert.ok(expected);
      await assert.rejects(host.request(owner, 'venture.find', payload), (error: any) => error.code === 'INVALID_VENTURE_REQUEST' && error.message === expected && !error.message.includes(secret));
    }
  } finally {
    host.close();
  }
});

test('size: 2,000 clients, 3,000 invoices and 200 chats of 50 messages answer one find in under a second', async () => {
  const { env, order } = await seeded();
  await ventureAction(env.deps, owner, 'prepare', 'seed.many', tx => {
    const clients: string[] = [];
    for (let index = 0; index < 2000; index += 1) clients.push(tx.put<ClientRecord>({ ...tx.base('venture-client'), name: `Client number ${index}`, email: null, countryCode: 'IN', taxId: null, stateCode: '27', note: null }).id);
    for (let index = 0; index < 3000; index += 1) {
      tx.put({
        ...tx.base('venture-invoice'), number: `INV-${String(index + 100).padStart(4, '0')}`, documentTitle: 'TAX INVOICE', orderId: order.id, clientId: clients[index % clients.length], currency: 'INR',
        issueDate: '2026-10-14', dueDate: '2026-10-24', dueInDays: 10, lines: [], subtotalMinor: '1000', discountMinor: '0', taxMinor: '0', totalMinor: '1000', taxLabel: 'GST', taxRateBps: '0',
        taxTreatment: 'cgst-sgst', taxLines: [], supplierTaxId: null, clientTaxId: null, placeOfSupply: null, sacCode: null, status: 'issued', priceReceiptId: order.priceReceiptId,
        digest: `d${index}`, issuedAt: '2026-10-14T10:00:00.000Z', factIds: [], booksReceiptId: null, booksNote: null, paidMinor: '0', balanceMinor: '1000',
      } as InvoiceRecord);
    }
    for (let chat = 0; chat < 200; chat += 1) {
      const thread = tx.put<ChiefThreadRecord>({ ...tx.base('venture-chief-thread'), title: `Chat ${chat}`, pinned: false, routine: null, lastAt: tx.now });
      for (let message = 0; message < 50; message += 1) {
        appendChiefMessage(tx, { threadId: thread.id, from: message % 2 ? 'chief' : 'owner', text: `Line ${message} about the books, the bank statement and the monthly report for chat ${chat}.`, author: message % 2 ? 'model' : 'owner' });
      }
    }
  });
  await find(env, { text: 'warm' });
  const started = performance.now();
  const view = await find(env, { text: 'client 19' });
  const ms = performance.now() - started;
  assert.ok(items(view, 'client').length > 0);
  assert.ok(ms < 1000, `${ms} ms`);
});
