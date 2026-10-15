import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { initialState } from '../runtime/contracts.ts';
import type { Context, Fact, State, StateStore } from '../runtime/contracts.ts';
import { canSeeFact, insertFacts, selectFacts } from '../runtime/memory.ts';
import { visibleFacts } from '../runtime/trust.ts';
import { coreState } from '../runtime/trust-ext/core-state.ts';
import { MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';
import '../runtime/core-data/trust-rules.ts';
import '../runtime/trust-ext/core-hooks.ts';

// Synthetic customers, phones and amounts only.
const passphrase = 'Synthetic-core-data-trust-rules';
const csv = (rows: string) => `id,kind,date,amount,currency,branch\n${rows}`;
const recipe = (id: string) => ({ version: 1, id, system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic trust rules', branches: ['main'] },
  bindings: [{ target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' }, { target: 'branch', source: 'branch', type: 'string', nulls: 'reject' }],
  allowedKinds: ['invoice'], allowedStatuses: [], onUnmapped: 'reject' });
const invoice = (id: string, fields: Record<string, unknown>): Fact => ({ id, entityId: id, sourceId: 'synthetic-sales', sourceRow: 1, kind: 'invoice', validFrom: '2026-09-01', validTo: null,
  learnedAt: new Date().toISOString(), supersededAt: null, branch: 'main', fields: { currency: 'INR', ...fields } });

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-core-data-trust-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  const app = createLocalServer(engine); const { origin, token } = await app.listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (method: string, payload: any = {}) => {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  };
  async function rpc(method: string, payload: any = {}) { const r = await call(method, payload); assert.equal(r.status, 200, `${method}: ${JSON.stringify(r.body.error)}`); return r.body.result; }
  await rpc('workspace.create', { name: 'Synthetic trust rules', passphrase, demo: false });
  const as = (ctx: Context, method: string, payload: any = {}) => engine.requestAs(ctx, method, payload) as Promise<any>;
  const member = async (id: string, role: Context['role'], seat?: string): Promise<Context> => {
    await rpc('members.add', { id, name: `Synthetic ${id}`, role });
    if (seat) await engine.vault!.update(state => { coreState(state).memberSeats[id] = seat as any; });
    return { memberId: id, role, epoch: 1, channel: 'desktop' };
  };
  const load = (ctx: Context | null, sourceId: string, rows: string, rowCount: number, amountMinor: string) => {
    const payload = { sourceId, format: 'csv', content: csv(rows), expectedTotals: { rowCount, amountMinor }, recipe: recipe(`${sourceId}-v1`) };
    return ctx ? as(ctx, 'sources.import', payload) : rpc('sources.import', payload);
  };
  return { engine, store: () => engine.vault!, call, rpc, as, member, load, owner: engine.bootstrapContext() };
}

test('staff see only the entries they added, in lists, history, corrections and calculations', async t => {
  const f = await fixture(t);
  const staff = await f.member('staff-1', 'accountant', 'staff'); const accountant = await f.member('accountant-1', 'accountant');
  await f.load(null, 'synthetic-owner-shop', 'inv-a,invoice,2026-09-01,100.00,INR,main\ninv-b,invoice,2026-09-02,200.00,INR,main\n', 2, '30000');
  await f.load(staff, 'synthetic-staff-entries', 'inv-s,invoice,2026-09-03,50.00,INR,main\n', 1, '5000');
  const stored = f.store().read().facts;
  assert.equal(stored.find(x => x.entityId === 'inv-s')!.enteredBy, 'staff-1');
  assert.equal(stored.find(x => x.entityId === 'inv-a')!.enteredBy, f.owner.memberId);
  // Rows written before authorship was recorded are not the staff member's.
  await f.store().update(state => { state.facts.push({ ...invoice('legacy-1', { amountMinor: '700' }) }); });

  const mine = await f.as(staff, 'memory.list', {});
  assert.deepEqual(mine.facts.map((x: Fact) => x.entityId), ['inv-s']);
  assert.deepEqual(f.engine.services.memory.history(staff, 'inv-a'), []);
  const staffTotal = await f.as(staff, 'calculation.run', { operation: 'billed' });
  assert.equal(staffTotal.totalMinor, '5000'); assert.deepEqual(staffTotal.rows.map((r: any) => r.entityId), ['inv-s']);
  const ownerFact = stored.find(x => x.entityId === 'inv-a')!;
  await assert.rejects(f.as(staff, 'memory.correct', { id: ownerFact.id, fields: { amountMinor: '1' } }), (e: any) => e.code === 'FACT_NOT_FOUND');
  // A correction keeps the author of the entry, so the staff member still sees it.
  const own = stored.find(x => x.entityId === 'inv-s')!;
  await f.rpc('memory.correct', { id: own.id, fields: { amountMinor: '6000' } });
  assert.equal((await f.as(staff, 'calculation.run', { operation: 'billed' })).totalMinor, '6000');

  assert.equal((await f.as(accountant, 'calculation.run', { operation: 'billed' })).totalMinor, '36700');
  assert.equal((await f.rpc('calculation.run', { operation: 'billed' })).totalMinor, '36700');
  // A staff receipt stays the staff member's own.
  await assert.rejects(f.as(accountant, 'receipts.get', { id: staffTotal.id }), (e: any) => e.code === 'RECEIPT_FORBIDDEN');
});

test('an author named in a write payload is never taken; insertFacts records the writer', () => {
  const state: State = initialState('Synthetic authorship');
  const [fact] = insertFacts(state, [{ entityId: 'x', sourceId: 's', sourceRow: 1, kind: 'invoice', validFrom: '2026-09-01', fields: {}, enteredBy: 'someone-else', withheld: ['a'] } as any], new Date().toISOString(), 'writer');
  assert.equal(fact.enteredBy, 'writer'); assert.equal(fact.withheld, undefined);
  const [anonymous] = insertFacts(state, [{ entityId: 'y', sourceId: 's', sourceRow: 2, kind: 'invoice', validFrom: '2026-09-01', fields: {}, enteredBy: 'someone-else' } as any], new Date().toISOString());
  assert.equal(Object.hasOwn(anonymous, 'enteredBy'), false);
});

test('record markings hide a record\'s facts and field markings withhold the field, from seats that do not see the kind', async t => {
  const f = await fixture(t); const accountant = await f.member('accountant-1', 'accountant');
  await f.store().update(state => {
    state.facts.push(invoice('f1', { customerId: 'C1', invoiceId: 'I1', amountMinor: '1000', phone: '+91 90000 00001' }),
      invoice('f2', { customerId: 'C2', invoiceId: 'I2', amountMinor: '2000', phone: '+91 90000 00002' }),
      invoice('f3', { customerId: 'C3', invoiceId: 'I3', amountMinor: '4000' }),
      invoice('f4', { customerId: 'C9', invoiceId: 'I4', amountMinor: '8000' }));
    // C9 was joined into C1: the marking follows it.
    state.merges.push({ id: 'merge-1', type: 'merge', entityIds: ['C1', 'C9'], targetId: 'C1', at: new Date().toISOString(), by: 'owner' });
  });
  await f.rpc('trustx.setMarking', { kind: 'personal', target: { type: 'record', sourceId: 'synthetic-sales', recordId: 'C1' }, on: true });
  await f.rpc('trustx.setMarking', { kind: 'personal', target: { type: 'field', sourceId: 'synthetic-sales', recordId: 'C2', field: 'phone' }, on: true });
  await f.rpc('trustx.setMarking', { kind: 'personal', target: { type: 'field', sourceId: 'synthetic-sales', recordId: 'C3', field: 'amountMinor' }, on: true });

  const list = await f.as(accountant, 'memory.list', {});
  assert.deepEqual(list.facts.map((x: Fact) => x.id).sort(), ['f2', 'f3']);
  const f2 = list.facts.find((x: Fact) => x.id === 'f2'); const f3 = list.facts.find((x: Fact) => x.id === 'f3');
  assert.equal(f2.fields.phone, undefined); assert.deepEqual(f2.withheld, ['phone']); assert.equal(f2.fields.amountMinor, '2000');
  assert.equal(f3.fields.amountMinor, undefined); assert.deepEqual(f3.withheld, ['amountMinor']);
  assert.ok(!JSON.stringify(list).includes('90000 00002'));
  assert.deepEqual(f.engine.services.memory.history(accountant, 'f1'), []);
  assert.deepEqual(f.engine.services.memory.history(accountant, 'f2')[0].withheld, ['phone']);
  assert.deepEqual((await f.as(accountant, 'memory.list', { customerId: 'C1' })).facts, []);

  const receipt = await f.as(accountant, 'calculation.run', { operation: 'billed' });
  assert.equal(receipt.totalMinor, '2000');
  assert.deepEqual(receipt.exclusions.filter((e: any) => e.reason === 'withheld').map((e: any) => e.rowId), ['f3']);
  assert.equal(receipt.coverage.completeness, 'partial'); assert.ok(receipt.coverage.gaps.some((g: string) => /withheld from your seat by a marking/.test(g)));
  assert.ok(!receipt.coverage.gaps.some((g: string) => /excluded by the dictionary/.test(g)));
  // The owner always sees everything.
  const owner = await f.rpc('calculation.run', { operation: 'billed' }); assert.equal(owner.totalMinor, '15000'); assert.equal(owner.coverage.completeness === 'partial', false);
  assert.equal((await f.rpc('memory.list', {})).facts.find((x: Fact) => x.id === 'f2').fields.phone, '+91 90000 00002');
  // An earlier receipt that counted a now-hidden row is no longer served.
  await f.rpc('trustx.setMarking', { kind: 'personal', target: { type: 'record', sourceId: 'synthetic-sales', recordId: 'I2' }, on: true });
  await assert.rejects(f.as(accountant, 'receipts.get', { id: receipt.id }), (e: any) => e.code === 'RECEIPT_FORBIDDEN');
  // Letting the seat see the kind shows everything again.
  await f.rpc('trustx.setSeatMarking', { seat: 'accountant', kind: 'personal', sees: true });
  assert.equal((await f.as(accountant, 'calculation.run', { operation: 'billed' })).totalMinor, '15000');
  // A marking on a source the workspace no longer knows hides nothing.
  await f.store().update(state => { coreState(state).marks.push({ id: 'stale', kind: 'financial', target: { type: 'record', sourceId: 'gone-source', recordId: 'C2' }, auto: false, by: 'owner', at: new Date().toISOString() }); });
  await f.rpc('trustx.setSeatMarking', { seat: 'accountant', kind: 'financial', sees: false });
  assert.equal((await f.as(accountant, 'calculation.run', { operation: 'billed' })).totalMinor, '15000');
});

test('a numbers-only assistant gets answers with withheld and unsendable fields removed, and the reply lists them', async t => {
  const f = await fixture(t);
  await f.store().update(state => {
    state.facts.push(invoice('f1', { customerId: 'C1', invoiceId: 'I1', amountMinor: '1000' }), invoice('f2', { customerId: 'C2', invoiceId: 'I2', amountMinor: '2000', dueDate: '2026-10-01' }),
      invoice('f3', { customerId: 'C3', invoiceId: 'I3', amountMinor: '4000' }));
  });
  await f.rpc('trustx.setMarking', { kind: 'confidential', target: { type: 'field', sourceId: 'synthetic-sales', recordId: 'C2', field: 'dueDate' }, on: true });
  await f.rpc('trustx.setMarking', { kind: 'personal', target: { type: 'field', sourceId: 'synthetic-sales', recordId: 'C3', field: 'amountMinor' }, on: true });
  await f.rpc('trustx.setAssistants', { on: true });
  const paired = await f.rpc('trustx.pairAssistant', { name: 'Synthetic assistant' });
  const assistant: Context = { memberId: paired.id, role: 'viewer', epoch: f.store().read().members.find(m => m.id === paired.id)!.epoch, channel: 'mcp' };
  const mcp = f.engine.services.mcp; let id = 0;
  const open = async (ctx: Context, session: string) => {
    await mcp.handle(ctx, { jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'synthetic-client' } } }, session);
    await mcp.handle(ctx, { jsonrpc: '2.0', method: 'notifications/initialized' }, session);
    return (name: string, args: any = {}) => mcp.handle(ctx, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, session).then((r: any) => r.result);
  };
  const ask = await open(assistant, 'assistant');
  let answer = await ask('calculate', { operation: 'billed' });
  assert.equal(answer.isError, false, JSON.stringify(answer));
  let content = answer.structuredContent;
  assert.equal(content.value, '3000'); assert.equal(content.receipt.totalMinor, '3000');
  assert.deepEqual(content.removed, [
    { field: 'amountMinor', why: 'personal', count: 1 }, { field: 'customerId', why: 'send-level', count: 2 }, { field: 'dueDate', why: 'confidential', count: 1 },
    { field: 'entityId', why: 'send-level', count: 2 }, { field: 'invoiceId', why: 'send-level', count: 2 }]);
  for (const row of content.receipt.rows) for (const key of ['customerId', 'invoiceId', 'entityId', 'dueDate']) assert.equal(Object.hasOwn(row, key), false, key);
  for (const value of ['C1', 'C2', 'I1', 'I2', '2026-10-01']) assert.equal(answer.content[0].text.includes(`"${value}"`), false, value);
  const pin = { receiptId: content.receipt.id, receiptDigest: content.receiptDigest };
  const opened = (await ask('open_receipt', pin)).structuredContent;
  assert.deepEqual(opened.removed, content.removed); assert.deepEqual(opened.receipt.rows, content.receipt.rows);
  const page = (await ask('list_counted_rows', pin)).structuredContent;
  assert.equal(page.rows.length, 2); assert.ok(page.rows.every((row: any) => !Object.hasOwn(row, 'customerId')));
  assert.deepEqual(page.removed.map((item: any) => item.field), ['customerId', 'dueDate', 'entityId', 'invoiceId']);

  // At the samples send level the names are sent; markings still apply.
  await f.rpc('trust.update', { send: 'samples' });
  content = (await ask('calculate', { operation: 'billed' })).structuredContent;
  assert.deepEqual(content.removed, [{ field: 'amountMinor', why: 'personal', count: 1 }, { field: 'dueDate', why: 'confidential', count: 1 }]);
  assert.deepEqual(content.receipt.rows.map((row: any) => row.customerId).sort(), ['C1', 'C2']);
  // The owner on the numbers server sees everything and nothing is listed.
  const owner = await open(f.owner, 'owner');
  const full = (await owner('calculate', { operation: 'billed' })).structuredContent;
  assert.equal(full.value, '7000'); assert.equal(Object.hasOwn(full, 'removed'), false);
});

// Synthetic large books: the hook stays cheap per fact.
class MemoryStore implements StateStore {
  state: State = initialState('Synthetic large books');
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return await change(this.state); }
}
test('fact reads stay fast with 20,000 facts, record and field markings and a staff seat', () => {
  const store = new MemoryStore(); const state = store.state; const at = new Date().toISOString();
  state.members.push({ id: 'accountant-1', name: 'Synthetic accountant', role: 'accountant', branches: ['*'], active: true, epoch: 1 }, { id: 'staff-1', name: 'Synthetic staff', role: 'accountant', branches: ['*'], active: true, epoch: 1 });
  for (let i = 0; i < 20000; i++) state.facts.push({ id: `f${i}`, entityId: `e${i}`, sourceId: `synthetic-${i % 20}`, sourceRow: i + 1, kind: 'invoice', validFrom: '2026-04-01', validTo: null, learnedAt: at, supersededAt: null,
    fields: { customerId: `C${i % 500}`, phone: '+91 90000 00000' }, ...(i % 10 === 0 ? { enteredBy: 'staff-1' } : {}) });
  const core = coreState(state); core.memberSeats['staff-1'] = 'staff';
  for (let i = 0; i < 50; i++) core.marks.push({ id: `m${i}`, kind: 'personal', target: i % 2 ? { type: 'record', sourceId: 'synthetic-1', recordId: `C${i}` } : { type: 'field', sourceId: 'synthetic-1', recordId: `C${i}`, field: 'phone' }, auto: false, by: 'owner', at });
  const accountant: Context = { memberId: 'accountant-1', role: 'accountant', epoch: 1 }, staff: Context = { memberId: 'staff-1', role: 'accountant', epoch: 1 };
  let start = performance.now(); const seen = visibleFacts(store, accountant); const read = performance.now() - start;
  assert.equal(seen.length, 20000 - 25 * 40); assert.equal(seen.filter(x => x.withheld?.includes('phone')).length, 25 * 40);
  assert.ok(read < 1500, `accountant visibleFacts took ${Math.round(read)} ms`);
  start = performance.now(); const own = state.facts.filter(x => canSeeFact(store, staff, x)).length; const loop = performance.now() - start;
  assert.equal(own, 2000); assert.ok(loop < 1500, `staff canSeeFact loop took ${Math.round(loop)} ms`);
  start = performance.now(); const selected = selectFacts(store, accountant).facts.length; const select = performance.now() - start;
  assert.equal(selected, 20000 - 25 * 40); assert.ok(select < 1500, `accountant selectFacts took ${Math.round(select)} ms`);
});
