import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { Context, Fact } from '../runtime/contracts.ts';

// Synthetic firms, businesses, customers and amounts only.
const wording = { version: 'v-test', text: 'Synthetic consent wording for tests.' };
const noon = Date.parse('2026-10-15T06:30:00.000Z'); // India date 2026-10-15; close month 2026-09
const customers = ['Zephyrine Quillon Traders', 'Marigold Vexley Stores'];
const amounts = ['918273645', '827364519'];
const code = (name: string) => (e: any) => { assert.equal(e.code, name, e.message); return true; };
function fact(id: string, fields: Record<string, unknown>): Fact {
  return { id, entityId: id, sourceId: 'synthetic-sales', sourceRow: 1, kind: 'invoice', validFrom: '2026-09-05', validTo: null, learnedAt: '2026-10-10T09:00:00.000Z', supersededAt: null, fields, branch: 'main' };
}

async function workspace(t: any, name: string, clock: () => number) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-ca-firm-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'ca-enterprise': { consentWording: wording, clock } } });
  const app = createLocalServer(engine); const { origin, token } = await app.listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const replies: unknown[] = [];
  async function call(method: string, payload: any = {}) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }) });
    const body = await response.json() as any; replies.push(body); return { status: response.status, body };
  }
  async function rpc(method: string, payload: any = {}) { const r = await call(method, payload); assert.equal(r.status, 200, `${method}: ${JSON.stringify(r.body.error)}`); return r.body.result; }
  const fails = async (method: string, payload: any, expected: string) => { const r = await call(method, payload); assert.equal(r.body.error?.code, expected, `${method}: ${JSON.stringify(r.body)}`); };
  await rpc('workspace.create', { name, passphrase: `Synthetic-${name.replace(/\W/g, '')}-passphrase`, demo: false });
  const as = async (ctx: Context, method: string, payload: any = {}) => { const result = await engine.requestAs(ctx, method, payload); replies.push(result); return result; };
  async function member(memberName: string, role: string): Promise<Context> {
    const invite = await rpc('auth.invite', { name: memberName, role }); const accepted = await rpc('auth.accept', { token: invite.token }); return { ...accepted.context, channel: 'desktop' };
  }
  async function seat(kind: 'ca' | 'accountant', seatName: string, endsOn?: string) {
    const invited = await rpc('trustx.invite', { seat: kind, name: seatName, ...(endsOn ? { endsOn } : {}) }); await rpc('auth.accept', { token: invited.invite.token });
  }
  return { engine, store: engine.vault!, rpc, call, fails, as, member, seat, replies };
}

/** A client workspace that links the firm with `linkCode`, agrees, and issues cards. */
async function client(t: any, name: string, linkCode: string) {
  const c = await workspace(t, name, () => noon);
  await c.store.update(state => {
    state.facts.push(fact('s1', { customerName: customers[0], amountMinor: amounts[0], gstin: '27ABCDE1234F1Z5' }), fact('s2', { customerName: customers[1], amountMinor: amounts[1] }));
    state.imports.push({ id: 'import-1', at: '2026-10-13T07:00:00.000Z', sourceId: 'synthetic-sales', format: 'csv', totalsMinor: amounts[0] });
    ((state.extensions ??= {})['reports-tools-trust'] ??= { reports: { questions: [{ id: 'q1', at: '2026-10-02T05:00:00.000Z', path: '/nowhere/q.html', sourceIds: [] }] }, trust: {}, tools: {} });
  });
  await c.rpc('castatus.link', { firmName: 'Synthetic and Co', code: linkCode });
  await c.rpc('castatus.consent', { agree: true, version: 'v-test' });
  return c;
}

test('a firm imports a client\'s card, lists status without any figure, and opens the client with the seat it gave', async t => {
  let firmNow = noon;
  const firm = await workspace(t, 'Synthetic and Co', () => firmNow);
  assert.deepEqual(await firm.rpc('firm.status'), { firm: null });
  await firm.fails('clients.list', {}, 'CA_NOT_A_FIRM');
  await firm.fails('firm.setup', { name: '' }, 'CA_REQUEST_INVALID');
  assert.deepEqual(await firm.rpc('firm.setup', { name: 'Synthetic & Co' }), { firm: { name: 'Synthetic & Co', reportName: null, pricing: 'planned' } });
  assert.equal((firm.store.read().extensions as any)['ca-enterprise'].shell.kind, 'ca-firm');
  assert.deepEqual(await firm.rpc('firm.name.set', { name: 'Synthetic and Co', reportName: 'Synthetic and Co, Chartered Accountants' }), { firm: { name: 'Synthetic and Co', reportName: 'Synthetic and Co, Chartered Accountants', pricing: 'planned' } });

  // CA-09: invite a client. The guide is one escaped page and never carries the code.
  const added = await firm.rpc('clients.add', { name: 'Synthetic <client> shop' });
  assert.match(added.code, /^[A-Z2-7]{16}$/); assert.match(added.clientId, /^client_/);
  const html: string = added.guide.html;
  assert.match(html, /<title>Joining Synthetic and Co on Chausar<\/title>/); assert.ok(html.includes('Synthetic &lt;client&gt; shop'));
  assert.equal(html.includes(added.code), false);
  for (const words of ['Install Chausar', 'Trust, then People', 'CA seat', 'accountant seat', 'link code', 'agree to share status', 'What is shared', 'What is never shared', 'Figures', 'customers', 'Documents']) assert.ok(html.includes(words), words);
  const other = await firm.rpc('clients.add', { name: 'Second synthetic client' });

  // The client links, agrees, gives a CA seat and issues a card.
  const shop = await client(t, 'Synthetic client shop', added.code);
  await shop.seat('ca', 'Synthetic CA', '2026-10-20');
  const card = await shop.rpc('castatus.card');
  await firm.fails('clients.statusImport', { card: { ...card, note: 'Paid by Asha' } }, 'CA_CARD_INVALID');
  await firm.fails('clients.statusImport', { card: { ...card, close: { ...card.close, bank: card.close.bank === 'done' ? 'not-done' : 'done' } } }, 'CA_CARD_FORGED');
  await firm.fails('clients.statusImport', { card: { ...card, link: 'f'.repeat(64) } }, 'CA_CARD_UNKNOWN_CLIENT');
  const imported = await firm.rpc('clients.statusImport', { card });
  assert.deepEqual(imported, { clientId: added.clientId, cardAt: card.issuedAt });
  await firm.fails('clients.statusImport', { card }, 'CA_CARD_STALE');

  // Another workspace that somehow holds the same code cannot speak for this client.
  const impostor = await client(t, 'Synthetic impostor', added.code);
  await impostor.seat('accountant', 'Synthetic accountant');
  const forged = await impostor.rpc('castatus.card');
  await firm.fails('clients.statusImport', { card: forged }, 'CA_CARD_FORGED');

  // CA-01: the list.
  let list = await firm.rpc('clients.list', {});
  assert.equal(list.month, '2026-09'); assert.deepEqual(list.counts, { needsYou: 1, closeNotDone: 2, all: 2 }); assert.equal(list.nextCursor, null);
  const row = list.rows.find((r: any) => r.clientId === added.clientId);
  assert.deepEqual(row, { clientId: added.clientId, name: 'Synthetic <client> shop', state: 'joined', booksReadAt: '2026-10-13T07:00:00.000Z', close: card.close,
    awaiting: card.cosign.meanings + card.cosign.recipes + card.cosign.accountClasses, dueNext: card.dueNext, cardAt: card.issuedAt, stale: false, seat: { seat: 'ca', endsOn: '2026-10-20' } });
  assert.deepEqual(list.rows.find((r: any) => r.clientId === other.clientId), { clientId: other.clientId, name: 'Second synthetic client', state: 'invited', booksReadAt: null, close: null, awaiting: null, dueNext: null, cardAt: null, stale: true, seat: null });
  assert.deepEqual((await firm.rpc('clients.list', { filter: 'needs-you' })).rows.map((r: any) => r.clientId), [added.clientId]);

  // CA-03: open the client with the seat it gave.
  assert.deepEqual(await firm.rpc('clients.open', { clientId: added.clientId }), { clientId: added.clientId, workspaceId: shop.store.read().workspace.id, seat: { seat: 'ca', endsOn: '2026-10-20' } });
  await firm.fails('clients.open', { clientId: other.clientId }, 'CA_CLIENT_NOT_JOINED');
  await firm.fails('clients.open', { clientId: 'client_missing' }, 'CA_CLIENT_NOT_FOUND');
  await firm.fails('clients.statusFetch', {}, 'CA_RELAY_NOT_DEPLOYED');

  // CA-02, CA-04, CA-05, CA-10 from stored cards.
  const today = await firm.rpc('firm.today');
  assert.equal(today.month, '2026-09'); assert.equal(today.totals.clients, 2);
  assert.deepEqual(today.awaiting.map((a: any) => [a.clientId, a.questions]), [[added.clientId, 1]]);
  assert.deepEqual(today.due, card.dueNext ? [{ clientId: added.clientId, name: 'Synthetic <client> shop', ...card.dueNext }] : []);
  assert.deepEqual((await firm.rpc('firm.cosign')).rows.find((r: any) => r.clientId === other.clientId), { clientId: other.clientId, name: 'Second synthetic client', meanings: null, recipes: null, accountClasses: null });
  assert.deepEqual((await firm.rpc('firm.questions')).rows.find((r: any) => r.clientId === added.clientId), { clientId: added.clientId, name: 'Synthetic <client> shop', count: 1, oldestAt: '2026-10-02T05:00:00.000Z' });
  const handover = await firm.rpc('firm.handover', { clientId: added.clientId });
  assert.deepEqual(handover, { month: '2026-09', rows: [{ clientId: added.clientId, name: 'Synthetic <client> shop', handover: card.handover }] });

  // The seat ends: the firm cannot open the client, and the card is stale.
  firmNow = Date.parse('2026-10-25T06:30:00.000Z');
  await firm.fails('clients.open', { clientId: added.clientId }, 'CA_SEAT_ENDED');
  list = await firm.rpc('clients.list', {}); assert.equal(list.rows[0].stale, true); assert.equal(list.rows[0].seat, null); assert.equal(list.rows[0].dueNext, card.dueNext && card.dueNext.date >= '2026-10-25' ? card.dueNext : null);
  firmNow = noon;

  // The client adds an accountant seat; the next card is preferred with that seat.
  await shop.seat('accountant', 'Synthetic accountant');
  const next = await shop.rpc('castatus.card'); assert.ok(next.issuedAt > card.issuedAt);
  await firm.rpc('clients.statusImport', { card: next });
  assert.deepEqual((await firm.rpc('clients.open', { clientId: added.clientId })).seat, { seat: 'accountant', endsOn: null });

  // A new guide issues a new code; a card made with the old one is from an unknown client.
  const again = await firm.rpc('clients.guide', { clientId: added.clientId }); assert.notEqual(again.code, added.code); assert.equal(again.guide.html.includes(again.code), false);
  await firm.fails('clients.statusImport', { card: await shop.rpc('castatus.card') }, 'CA_CARD_UNKNOWN_CLIENT');
  await shop.rpc('castatus.link', { firmName: 'Synthetic and Co', code: again.code }); await shop.rpc('castatus.consent', { agree: true, version: 'v-test' });
  await firm.rpc('clients.statusImport', { card: await shop.rpc('castatus.card') });

  // Never a figure: no firm reply holds the client's amounts, customers, GSTIN or the client's own seat names.
  const everything = JSON.stringify(firm.replies);
  for (const secret of [...customers, ...amounts, '27ABCDE1234F1Z5', 'Synthetic CA', 'Synthetic accountant', 'Synthetic client shop']) assert.equal(everything.includes(secret), false, `a firm reply carries ${secret}`);

  assert.deepEqual(await firm.rpc('clients.remove', { clientId: other.clientId }), { clientId: other.clientId, removed: true });
  assert.equal((await firm.rpc('clients.list')).counts.all, 1);
});

test('firm people: assignment narrows which clients a member sees and opens; the list pages with an opaque cursor', async t => {
  const firm = await workspace(t, 'Synthetic and Co', () => noon);
  await firm.rpc('firm.setup', { name: 'Synthetic and Co' });
  const ids: string[] = [];
  for (const name of ['Alpha synthetic', 'Beta synthetic', 'Gamma synthetic']) ids.push((await firm.rpc('clients.add', { name })).clientId);
  const staff = await firm.member('Synthetic article clerk', 'accountant');
  let people = await firm.rpc('firm.people.list');
  assert.deepEqual(people.people.map((p: any) => [p.role, p.clients]), [['owner', '*'], ['accountant', []]]);
  let mine = await firm.as(staff, 'clients.list', {});
  assert.deepEqual(mine.rows, []); assert.deepEqual(mine.counts, { needsYou: 0, closeNotDone: 0, all: 0 });
  await assert.rejects(firm.as(staff, 'clients.open', { clientId: ids[0] }), code('CA_CLIENT_NOT_ASSIGNED'));
  await assert.rejects(firm.as(staff, 'firm.handover', { clientId: ids[0] }), code('CA_CLIENT_NOT_ASSIGNED'));
  await assert.rejects(firm.as(staff, 'firm.people.assign', { memberId: staff.memberId, clients: '*' }), code('FORBIDDEN'));
  await firm.fails('firm.people.assign', { memberId: 'owner', clients: [ids[0]] }, 'CA_OWNER_SEES_ALL');
  await firm.fails('firm.people.assign', { memberId: staff.memberId, clients: ['client_unknown'] }, 'CA_CLIENT_NOT_FOUND');
  await firm.fails('firm.people.assign', { memberId: 'nobody', clients: '*' }, 'MEMBER_NOT_FOUND');
  assert.deepEqual(await firm.rpc('firm.people.assign', { memberId: staff.memberId, clients: [ids[1], ids[0]] }), { memberId: staff.memberId, clients: [ids[0], ids[1]].sort() });
  mine = await firm.as(staff, 'clients.list', {});
  assert.deepEqual(mine.rows.map((r: any) => r.name), ['Alpha synthetic', 'Beta synthetic']);
  await assert.rejects(firm.as(staff, 'clients.open', { clientId: ids[0] }), code('CA_CLIENT_NOT_JOINED'));
  assert.equal((await firm.as(staff, 'firm.cosign')).rows.length, 2);

  // Pagination: one row a page, the cursor bound to its filter.
  const seen: string[] = []; let cursor: string | null = null;
  do { const page: any = await firm.rpc('clients.list', { limit: 1, ...(cursor ? { cursor } : {}) }); seen.push(...page.rows.map((r: any) => r.name)); cursor = page.nextCursor; } while (cursor);
  assert.deepEqual(seen, ['Alpha synthetic', 'Beta synthetic', 'Gamma synthetic']);
  const first = await firm.rpc('clients.list', { limit: 1 });
  await firm.fails('clients.list', { limit: 1, cursor: first.nextCursor, filter: 'needs-you' }, 'CA_CURSOR_INVALID');
  await firm.fails('clients.list', { cursor: 'not a cursor' }, 'CA_CURSOR_INVALID');
  await firm.fails('clients.list', { limit: 0 }, 'CA_REQUEST_INVALID');

  // CA-06: the same step for many clients. Every ready row is held: no relay, and messages to outsiders wait for a person.
  assert.deepEqual(await firm.rpc('firm.many.kinds'), { kinds: [{ id: 'gst-guide', needsMonth: true }, { id: 'month-end-reminder', needsMonth: true }, { id: 'documents-request', needsMonth: false }] });
  await firm.fails('firm.many.prepare', { kind: 'documents-request', clientIds: [ids[0]], month: '2026-09' }, 'CA_REQUEST_INVALID');
  await firm.fails('firm.many.prepare', { kind: 'free-text', clientIds: [ids[0]] }, 'CA_REQUEST_INVALID');
  await firm.fails('firm.many.prepare', { kind: 'gst-guide', clientIds: [ids[0], ids[0]] }, 'CA_REQUEST_INVALID');
  // Make Alpha joined with a fresh card stored directly, as an import would.
  await firm.store.update(state => {
    const c = (state.extensions as any)['ca-enterprise'].firm.clients[ids[0]];
    c.workspaceId = 'workspace_synthetic'; c.card = { workspaceId: 'workspace_synthetic', issuedAt: '2026-10-15T06:00:00.000Z', month: '2026-09', booksReadAt: null,
      close: { bank: 'done', gst: 'done', tds: 'done', tb: 'done' }, cosign: { meanings: 0, recipes: 0, accountClasses: 0 }, questions: { count: 0, oldestAt: null },
      handover: { tb: 'ready', bankRec: 'ready', gstMatch: 'ready', tdsMatch: 'ready', ageing: 'ready' }, dueNext: null, seats: [{ seat: 'accountant', endsOn: null }], consent: 'v-test' };
  });
  assert.equal((await firm.rpc('clients.list', { filter: 'close-not-done' })).counts.closeNotDone, 2);
  const batch = await firm.as(staff, 'firm.many.prepare', { kind: 'gst-guide', clientIds: ids });
  assert.equal(batch.state, 'prepared'); assert.equal(batch.month, '2026-09'); assert.equal(batch.kind, 'gst-guide');
  assert.deepEqual(batch.rows.map((r: any) => r.result), ['ready', 'not-joined', 'not-assigned']);
  await assert.rejects(firm.as(staff, 'firm.many.send', { batchId: batch.batchId }), code('FORBIDDEN'));
  const held = await firm.rpc('firm.many.send', { batchId: batch.batchId });
  assert.equal(held.state, 'held');
  assert.deepEqual(held.rows.map((r: any) => [r.result, r.code ?? null]), [['held', 'CA_RELAY_NOT_DEPLOYED'], ['not-joined', null], ['not-assigned', null]]);
  await firm.fails('firm.many.send', { batchId: batch.batchId }, 'CA_BATCH_DONE');
  await firm.fails('firm.many.send', { batchId: 'batch_missing' }, 'CA_BATCH_NOT_FOUND');
  const docs = await firm.rpc('firm.many.prepare', { kind: 'documents-request', clientIds: [ids[0]] }); assert.equal(docs.month, null);
  assert.deepEqual((await firm.rpc('firm.many.list')).batches.map((b: any) => b.batchId), [docs.batchId, batch.batchId]);
  for (let i = 0; i < 50; i++) await firm.rpc('firm.many.prepare', { kind: 'month-end-reminder', clientIds: [ids[2]], month: '2026-08' });
  assert.equal((await firm.rpc('firm.many.list')).batches.length, 50);
});

test('the firm library keeps structure only and exports it as a file', async t => {
  const firm = await workspace(t, 'Synthetic and Co', () => noon);
  await firm.rpc('firm.setup', { name: 'Synthetic and Co' });
  const refused: unknown[] = [
    { amount: '1234' }, { contact: 'asha@example.in' }, { phone: '98 76 54 32 10' }, { gstin: '27ABCDE1234F1Z5' }, { pan: 'ABCDE1234F' },
    { fee: '₹5' }, { fee: 'Rs. 5' }, { limit: 100 }, { ratio: 0.5 }, { [`k${'x'.repeat(64)}`]: true }, { '12345': 'key with digits' },
    [1, 2], JSON.parse('{"a":{"b":{"c":{"d":{"e":{"f":{"g":{"h":{"i":{}}}}}}}}}}'),
  ];
  for (const body of refused.slice(0, -2)) await firm.fails('firm.library.add', { kind: 'check', title: 'A check', body }, 'CA_LIBRARY_NOT_STRUCTURE');
  await firm.fails('firm.library.add', { kind: 'check', title: 'A check', body: refused.at(-2) }, 'CA_REQUEST_INVALID');
  await firm.fails('firm.library.add', { kind: 'check', title: 'A check', body: refused.at(-1) }, 'CA_LIBRARY_NOT_STRUCTURE');
  await firm.fails('firm.library.add', { kind: 'check', title: 'Check for 2026 ₹ 5000', body: {} }, 'CA_LIBRARY_NOT_STRUCTURE');
  await firm.fails('firm.library.add', { kind: 'invoice', title: 'A check', body: {} }, 'CA_REQUEST_INVALID');
  await firm.fails('firm.library.add', { kind: 'check', title: 'Big', body: { list: Array.from({ length: 4000 }, () => 'step-x') } }, 'CA_REQUEST_INVALID');
  const body = { steps: [{ check: 'bank statement loaded for the month', then: 'gst return imported' }, { check: 'trial balance matches', order: 2 }], every: 'month', strict: true, note: null };
  const { item } = await firm.rpc('firm.library.add', { kind: 'check', title: 'Month-end checks', body });
  assert.equal(item.kind, 'check'); assert.equal(item.title, 'Month-end checks'); assert.deepEqual(Object.keys(item), ['id', 'kind', 'title', 'addedAt']);
  assert.deepEqual((await firm.rpc('firm.library.list')).items, [item]);
  const exported = await firm.rpc('firm.library.export', { id: item.id });
  assert.equal(exported.file.name, 'chausar-library-check-month-end-checks.json');
  assert.deepEqual(JSON.parse(exported.file.json), { format: 'chausar.firm-library', v: 1, kind: 'check', title: 'Month-end checks', body });
  const viewer = await firm.member('Synthetic viewer', 'viewer');
  await assert.rejects(firm.as(viewer, 'firm.library.add', { kind: 'job', title: 'X', body: {} }), code('FORBIDDEN'));
  assert.deepEqual(await firm.rpc('firm.library.remove', { id: item.id }), { id: item.id, removed: true });
  await firm.fails('firm.library.export', { id: item.id }, 'CA_LIBRARY_NOT_FOUND');
});

test('every firm method except status and setup refuses outside a firm workspace', async t => {
  const plain = await workspace(t, 'Synthetic client shop', () => noon);
  const calls: [string, Record<string, unknown>][] = [
    ['firm.name.set', { name: 'X' }], ['clients.list', {}], ['clients.add', { name: 'X' }], ['clients.guide', { clientId: 'client_x' }], ['clients.remove', { clientId: 'client_x' }],
    ['clients.statusImport', { card: {} }], ['clients.statusFetch', {}], ['clients.open', { clientId: 'client_x' }], ['firm.today', {}], ['firm.cosign', {}], ['firm.questions', {}],
    ['firm.handover', {}], ['firm.many.kinds', {}], ['firm.many.prepare', { kind: 'gst-guide', clientIds: ['client_x'] }], ['firm.many.send', { batchId: 'batch_x' }], ['firm.many.list', {}],
    ['firm.library.list', {}], ['firm.library.add', { kind: 'job', title: 'X', body: {} }], ['firm.library.remove', { id: 'library_x' }], ['firm.library.export', { id: 'library_x' }],
    ['firm.people.list', {}], ['firm.people.assign', { memberId: 'owner', clients: '*' }],
  ];
  for (const [method, payload] of calls) await plain.fails(method, payload, 'CA_NOT_A_FIRM');
  assert.deepEqual(await plain.rpc('firm.status'), { firm: null });
  // A company install cannot also be a firm's console.
  await plain.store.update(state => { (state.extensions ??= {})['ca-enterprise'] = { shell: { kind: 'enterprise', by: 'owner', at: '2026-10-15T00:00:00.000Z' } }; });
  await plain.fails('firm.setup', { name: 'Synthetic and Co' }, 'CA_SHELL_TAKEN');
});
