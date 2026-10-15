import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { initialState, now } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { ModelGateway } from '../runtime/gateway.ts';
import { flushMcpCalls, MCPService } from '../runtime/mcp.ts';
import { assistantsView } from '../runtime/trust-ext/tools-assistants.ts';
import { today } from '../runtime/trust-ext/core-state.ts';
import { canaryHit, checkCanary, payloadLeaks } from '../runtime/trust-ext/tools-network.ts';
import { visibleFacts } from '../runtime/trust.ts';
import '../runtime/trust-ext/core-hooks.ts';

// Synthetic people, sources and GSTINs only.
const passphrase = 'Synthetic-trust-hooks-fixture';
const LANE = 'reports-tools-trust';
const code = (name: string) => (e: any) => { assert.equal(e.code, name, e.message); return true; };
const csv = (rows: string) => `id,kind,date,amount,currency,branch\n${rows}`;
const recipe = (id: string) => ({ version: 1, id, system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic trust hooks', branches: ['main'] },
  bindings: [{ target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' }, { target: 'branch', source: 'branch', type: 'string', nulls: 'reject' }],
  allowedKinds: ['invoice'], allowedStatuses: [], onUnmapped: 'reject' });

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-trust-hooks-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  const app = createLocalServer(engine); const { origin, token } = await app.listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const post = async (path: string, body: unknown, bearer: string) => {
    const response = await fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  };
  const call = (method: string, payload: any = {}, bearer = token) => post('/api/rpc', { method, payload }, bearer);
  async function rpc(method: string, payload: any = {}, bearer = token) { const r = await call(method, payload, bearer); assert.equal(r.status, 200, `${method}: ${JSON.stringify(r.body.error)}`); return r.body.result; }
  await rpc('workspace.create', { name: 'Synthetic trust hooks', passphrase, demo: false });
  const load = (sourceId: string, rows: string, rowCount: number, amountMinor: string) =>
    rpc('sources.import', { sourceId, format: 'csv', content: csv(rows), expectedTotals: { rowCount, amountMinor }, recipe: recipe(`${sourceId}-v1`) });
  const as = (ctx: Context, method: string, payload: any = {}) => engine.requestAs(ctx, method, payload);
  const ctxOf = (id: string, role: Context['role']): Context => ({ memberId: id, role, epoch: 1, channel: 'desktop' });
  return { engine, vault: () => engine.vault!, directory, call, rpc, post, load, as, ctxOf };
}

test('dual control on the five core paths: owner alone unchanged; with a cofounder each refuses SECOND_PERSON_REQUIRED, trustx still applies', async t => {
  const f = await fixture(t); const owner = f.engine.bootstrapContext();
  // Owner alone: every core path applies as before.
  assert.equal((await f.rpc('trust.update', { send: 'shape' })).send, 'shape');
  assert.deepEqual(await f.rpc('learning.sharing', { enabled: true }), { enabled: true });
  assert.equal(typeof (await f.rpc('auth.invite', { name: 'Synthetic invitee', role: 'viewer' })).token, 'string');
  await f.rpc('members.add', { id: 'accountant-1', name: 'Synthetic accountant', role: 'accountant' });
  await f.rpc('members.add', { id: 'viewer-1', name: 'Synthetic viewer', role: 'viewer' });
  assert.equal((await f.rpc('members.revoke', { id: 'viewer-1' })).active, false);
  await f.rpc('members.add', { id: 'cofounder-1', name: 'Synthetic cofounder', role: 'cofounder' });
  const cofounder = f.ctxOf('cofounder-1', 'cofounder');

  // With a cofounder: neither the owner nor the cofounder changes Send, Sharing or seats alone on a core path.
  const refusals: [string, any][] = [['trust.update', { send: 'samples' }], ['trust.update', { policy: { sharing: false, send: 'samples' } }],
    ['learning.sharing', { enabled: true }], ['auth.invite', { name: 'Synthetic second', role: 'viewer' }],
    ['members.add', { id: 'staff-1', name: 'Synthetic staff', role: 'accountant' }]];
  await f.rpc('learning.sharing', { enabled: false });
  for (const ctx of [owner, cofounder]) for (const [method, payload] of refusals) await assert.rejects(f.as(ctx, method, payload), code('SECOND_PERSON_REQUIRED'), `${ctx.role} ${method}`);
  const state = f.vault().read();
  assert.equal(state.policy.send, 'shape'); assert.equal(state.policy.sharing, false);
  assert.equal(state.members.some(m => m.id === 'staff-1'), false);
  // Taking access away is one admin's to do at once: a compromised seat is cut off without waiting.
  await f.as(cofounder, 'members.revoke', { id: 'accountant-1' }); assert.equal(f.vault().read().members.find(m => m.id === 'accountant-1')!.active, false);
  assert.equal(state.sessions.filter(s => s.kind === 'member-invite' && s.name === 'Synthetic second').length, 0);
  // Sending less, sharing off and other policy fields need one person.
  assert.equal((await f.as(cofounder, 'trust.update', { send: 'nothing' })).send, 'nothing');
  assert.equal((await f.rpc('trust.update', { retentionDays: 30 })).retentionDays, 30);
  assert.deepEqual(await f.as(cofounder, 'learning.sharing', { enabled: false }), { enabled: false });

  // The change goes through trustx.*, which keeps it waiting, and applies once the other person confirms.
  const send = await f.rpc('trustx.setSend', { level: 'samples' }); assert.equal(send.state, 'waiting-for-second');
  assert.equal((await f.as(cofounder, 'trustx.confirmChange', { id: send.change.id })).state, 'applied'); assert.equal(f.vault().read().policy.send, 'samples');
  const seat = await f.as(cofounder, 'trustx.invite', { seat: 'accountant', name: 'Synthetic second' }); assert.equal(seat.state, 'waiting-for-second');
  assert.equal(typeof (await f.rpc('trustx.confirmChange', { id: seat.change.id })).invite.token, 'string');
  // Removing a seat through Trust applies at once too (the accountant was already removed on the core path above).
  await assert.rejects(f.rpc('trustx.removeSeat', { memberId: 'accountant-1' }), /MEMBER_ALREADY_REMOVED/);
  // A request payload cannot claim the confirmation: there is no flag to set.
  const claimed = await f.call('trust.update', { send: 'shape', confirmed: true }); assert.equal(claimed.status, 400); assert.equal(claimed.body.error.code, 'INVALID_POLICY');
  assert.equal(f.vault().read().policy.send, 'samples');
});

test('seat visibility of markings: an accountant that does not see financial gets no facts from a financial source, in visibleFacts and calculations; the owner still does', async t => {
  const f = await fixture(t);
  await f.load('synthetic-hooks-shop', 'inv-a,invoice,2026-09-02,100.00,INR,main\n', 1, '10000');
  await f.load('synthetic-hooks-ledger', 'inv-b,invoice,2026-09-03,50.00,INR,main\n', 1, '5000');
  await f.rpc('members.add', { id: 'accountant-1', name: 'Synthetic accountant', role: 'accountant' });
  const accountant = f.ctxOf('accountant-1', 'accountant'); const owner = f.engine.bootstrapContext();
  const billed = async (ctx: Context) => (await f.as(ctx, 'calculation.run', { operation: 'billed' })).totalMinor;
  const sources = (ctx: Context) => [...new Set(visibleFacts(f.vault(), ctx).map(fact => fact.sourceId))].sort();

  assert.equal(await billed(accountant), '15000');
  const before = await f.as(accountant, 'calculation.run', { operation: 'billed' });
  await f.rpc('trustx.setMarking', { kind: 'financial', target: { type: 'source', sourceId: 'synthetic-hooks-ledger' }, on: true });
  // Marked, but the accountant sees financial by default.
  assert.deepEqual(sources(accountant), ['synthetic-hooks-ledger', 'synthetic-hooks-shop']);
  await f.rpc('trustx.setSeatMarking', { seat: 'accountant', kind: 'financial', sees: false });
  assert.deepEqual(sources(accountant), ['synthetic-hooks-shop']);
  assert.equal(await billed(accountant), '10000');
  await assert.rejects(f.as(accountant, 'calculation.run', { operation: 'billed', sourceIds: ['synthetic-hooks-ledger'] }), code('SOURCE_REVOKED'));
  await assert.rejects(f.as(accountant, 'receipts.get', { id: before.id }), code('RECEIPT_FORBIDDEN'));
  // The owner and the cofounder are not affected.
  assert.deepEqual(sources(owner), ['synthetic-hooks-ledger', 'synthetic-hooks-shop']); assert.equal(await billed(owner), '15000');
  await f.rpc('members.add', { id: 'cofounder-1', name: 'Synthetic cofounder', role: 'cofounder' });
  assert.equal(await billed(f.ctxOf('cofounder-1', 'cofounder')), '15000');
  // Seeing it again widens the seat, which needs both people: it waits for the cofounder, then restores it.
  const widen = await f.rpc('trustx.setSeatMarking', { seat: 'accountant', kind: 'financial', sees: true });
  assert.equal(widen.state, 'waiting-for-second'); assert.equal(await billed(accountant), '10000');
  await f.as(f.ctxOf('cofounder-1', 'cofounder'), 'trustx.confirmChange', { id: widen.change.id });
  assert.equal(await billed(accountant), '15000');
});

class MemoryStore implements StateStore {
  state: State = initialState('Synthetic canary books');
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return await change(this.state); }
}

test('the gateway stops a payload carrying the canary or a GSTIN from the books before the transport, and the receipt records CANARY_BLOCKED', async () => {
  const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
  const reply = { status: 200, endpoint: 'https://api.example.test/v1/responses', body: JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ operation: 'earned' }) }] }] }) };
  for (const planted of ['CANARY-0123456789abcdef01234567', '27ABCDE1234F1Z5']) {
    const store = new MemoryStore(); store.state.policy.send = 'samples';
    store.state.facts.push({ id: 'fact_note', sourceId: 'books', sourceRow: 1, entityId: 'inv_1', kind: 'invoice', validFrom: '2026-09-01', validTo: null, learnedAt: now(), supersededAt: null, branch: 'main',
      fields: { amountMinor: '100', note: planted } });
    store.state.extensions = { [LANE]: { reports: {}, trust: {}, tools: planted.startsWith('CANARY') ? { canary: { value: planted, plantedAt: now(), alert: null } } : {} } };
    let sent = 0; const gateway = new ModelGateway(store, { http: async () => { sent++; return reply; } });
    await gateway.configureRoute(owner, { id: 'api', kind: 'openai-responses', model: 'explicit-model', endpoint: 'https://api.example.test/v1/responses', maxCostMinor: '100', budgetMinor: '10000' }, 'api-secret-value');
    const preview = await gateway.preview(owner, { question: 'revenue', samples: [{ factId: 'fact_note', fields: ['note'] }] });
    assert.ok(preview.payload.includes(planted), 'the synthetic sample reaches the payload');
    const approval = await gateway.approveOutbound(owner, preview.id);
    await assert.rejects(gateway.execute(owner, { previewId: preview.id, approvalId: approval.id }), code('CANARY_BLOCKED'));
    assert.equal(sent, 0, 'the transport is never called');
    const receipt = store.state.modelReceipts.find(r => r.id === preview.id);
    assert.equal(receipt.status, 'failed'); assert.equal(receipt.errorCode, 'CANARY_BLOCKED');
    // A block is kept apart from the leak alert: nothing left.
    assert.equal((store.state.extensions as any)[LANE].tools.canary.blocked.callId, preview.id); assert.equal((store.state.extensions as any)[LANE].tools.canary.alert, null);
    assert.ok(store.state.activity.some(a => a.event === 'trustx.canary.blocked'));
  }
  // A clean payload still goes out.
  const store = new MemoryStore(); store.state.policy.send = 'shape'; let sent = 0;
  const gateway = new ModelGateway(store, { http: async () => { sent++; return reply; } });
  await gateway.configureRoute(owner, { id: 'api', kind: 'openai-responses', model: 'explicit-model', endpoint: 'https://api.example.test/v1/responses', maxCostMinor: '100', budgetMinor: '10000' }, 'api-secret-value');
  const preview = await gateway.preview(owner, { question: 'revenue' }); const approval = await gateway.approveOutbound(owner, preview.id);
  await gateway.execute(owner, { previewId: preview.id, approvalId: approval.id }); assert.equal(sent, 1);
});

test('a paired assistant token works on /mcp only; each call, refused ones included, is listed', async t => {
  const f = await fixture(t);
  await f.load('synthetic-hooks-shop', 'inv-a,invoice,2026-09-02,100.00,INR,main\n', 1, '10000');
  await f.rpc('trustx.setAssistants', { on: true });
  const paired = await f.rpc('trustx.pairAssistant', { name: 'Synthetic assistant' });
  assert.ok(Date.parse(paired.expiresAt) - Date.now() <= 86400000);
  // The paired session is refused on /api/rpc, as an expired session would be.
  const rpc = await f.call('trust.get', {}, paired.token); assert.equal(rpc.status, 401); assert.equal(rpc.body.error.code, 'UNAUTHENTICATED');
  const mcp = (body: any) => f.post('/mcp', body, paired.token);
  const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic-client' } } });
  assert.equal(init.status, 200); assert.equal(init.body.result.serverInfo.name, 'chausar-verified-numbers');
  assert.equal((await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 200);
  const tools = (await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).body.result.tools.map((tool: any) => tool.name);
  assert.ok(tools.includes('calculate'), tools.join(','));
  const answered = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'calculate', arguments: { operation: 'billed' } } });
  assert.equal(answered.body.result.isError, false, JSON.stringify(answered.body)); const receiptId = answered.body.result.structuredContent.receipt.id;
  const write = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'delete_source', arguments: { sourceId: 'synthetic-hooks-shop' } } });
  assert.equal(write.body.error.data.code, 'UNKNOWN_TOOL');
  assert.equal((await mcp({ jsonrpc: '2.0', id: 5, method: 'resources/write', params: {} })).body.error.data.code, 'METHOD_NOT_FOUND');

  await flushMcpCalls(); // records wait up to a second or twenty calls before one store update
  const view = await f.rpc('trustx.assistants');
  assert.deepEqual(view.calls.map((c: any) => [c.client, c.calculation, c.refused]).sort(), [
    ['Synthetic assistant', 'An unregistered request', true], ['Synthetic assistant', 'An unregistered request', true], ['Synthetic assistant', 'calculate', false]]);
  assert.equal(view.calls.find((c: any) => c.calculation === 'calculate').receiptId, receiptId);
  assert.deepEqual(view.calls.filter((c: any) => c.refused).map((c: any) => c.code).sort(), ['METHOD_NOT_FOUND', 'UNKNOWN_TOOL']);
  assert.ok(view.assistants[0].lastCall);
  // The record keeps structure only: no arguments, no values.
  const records = (f.vault().read().extensions as any)[LANE].tools.mcpCalls as any[]; assert.equal(records.length, 3);
  assert.deepEqual(Object.keys(records[0]).sort(), ['at', 'code', 'id', 'memberId', 'method', 'outcome', 'receiptId', 'removed', 'tool']);
  assert.ok(records.every(r => !JSON.stringify(r).includes('synthetic-hooks-shop') && !JSON.stringify(r).includes('delete_source')));
  // Revoking takes the token away from /mcp too.
  await f.rpc('trustx.revokeAssistant', { id: paired.id });
  assert.equal((await mcp({ jsonrpc: '2.0', id: 6, method: 'ping' })).status, 401);
});

test('a CA seat past its end date is refused on every request, core or lane, and its session stops working', async t => {
  const f = await fixture(t);
  const ca = await f.rpc('trustx.invite', { seat: 'ca', name: 'Synthetic CA', endsOn: today() });
  const accepted = await f.rpc('auth.accept', { token: ca.invite.token }); const seat: Context = { ...accepted.context, channel: 'desktop' };
  assert.equal((await f.as(seat, 'trust.get')).send, 'nothing'); assert.equal((await f.call('trust.get', {}, accepted.token)).status, 200);
  await f.vault().update(state => { (state.extensions as any)[LANE].trust.core.seats[ca.invite.id].endsOn = '2020-01-01'; });
  for (const method of ['trust.get', 'members.list', 'calculation.run', 'trustx.rules', 'reportsx.packs']) await assert.rejects(f.as(seat, method, {}), code('ACCESS_REVOKED'), method);
  assert.equal(f.vault().read().members.find(m => m.id === seat.memberId)!.active, true, 'core refuses before the lane revokes lazily');
  assert.equal((await f.call('trust.get', {}, accepted.token)).status, 401);
  await f.rpc('trustx.seats');
  assert.equal(f.vault().read().members.find(m => m.id === seat.memberId)!.active, false);
});

test('the idle lock has one source of truth: trustx.setLock writes the frame setting the app enforces', async t => {
  const f = await fixture(t);
  assert.equal((await f.rpc('todayx.shell')).autoLockMinutes, 10); assert.equal((await f.rpc('trustx.vault')).lock.idleMinutes, 10);
  assert.deepEqual((await f.rpc('trustx.setLock', { idleMinutes: 25 })).lock, { idleMinutes: 25, deviceCheck: false });
  assert.equal((await f.rpc('todayx.shell')).autoLockMinutes, 25);
  await f.rpc('todayx.lock.settings', { minutes: 40 });
  assert.equal((await f.rpc('trustx.vault')).lock.idleMinutes, 40);
  assert.equal((await f.rpc('trustx.setLock', { deviceCheck: true })).lock.deviceCheck, true); assert.equal((await f.rpc('todayx.shell')).autoLockMinutes, 40);
  assert.equal(((f.vault().read().extensions as any)[LANE].tools.lock ?? {}).idleMinutes, undefined, 'no second copy is stored');
});

test('trustx.deleteSource uses the engine deletion from inside its request: managed backups and exports are removed and checked gone', async t => {
  const f = await fixture(t);
  await f.load('synthetic-hooks-shop', 'inv-a,invoice,2026-09-02,100.00,INR,main\n', 1, '10000');
  await f.rpc('trustx.backupNow'); await f.rpc('workspace.export', { confirmed: true });
  const listed = async (folder: string) => { try { return await readdir(join(f.directory, folder)); } catch { return []; } };
  assert.equal((await listed('backups')).length, 1); assert.ok((await listed('exports')).length >= 1);
  const report = await f.rpc('trustx.deleteSource', { sourceId: 'synthetic-hooks-shop', confirmation: 'synthetic-hooks-shop' });
  const row = (place: string) => report.rows.find((item: any) => item.place === place);
  assert.equal(row('Backups on this computer').state, 'deleted'); assert.equal(row('Exports on this computer').state, 'deleted');
  assert.deepEqual(await listed('backups'), []); assert.deepEqual((await listed('exports')).filter(name => name !== 'deletions'), []);
  assert.equal(f.vault().read().facts.some(fact => fact.sourceId === 'synthetic-hooks-shop'), false);
  // The engine fence is released afterwards: the next request runs.
  assert.equal((await f.rpc('trustx.deletions')).items.length, 1);
});

test('a blocked call reserves nothing and consumes no approval; after a block and a re-plant the tick does not force Send to nothing', async () => {
  const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
  const reply = { status: 200, endpoint: 'https://api.example.test/v1/responses', body: JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ operation: 'earned' }) }] }] }) };
  const store = new MemoryStore(); store.state.policy.send = 'samples';
  store.state.facts.push({ id: 'fact_note', sourceId: 'books', sourceRow: 1, entityId: 'inv_1', kind: 'invoice', validFrom: '2026-09-01', validTo: null, learnedAt: now(), supersededAt: null, branch: 'main',
    fields: { amountMinor: '100', note: '27ABCDE1234F1Z5' } });
  store.state.extensions = { [LANE]: { reports: {}, trust: {}, tools: {} } };
  let sent = 0; const gateway = new ModelGateway(store, { http: async () => { sent++; return reply; } });
  // Room for two reservations only: before the fix, two blocked calls used it all up.
  await gateway.configureRoute(owner, { id: 'api', kind: 'openai-responses', model: 'explicit-model', endpoint: 'https://api.example.test/v1/responses', maxCostMinor: '100', budgetMinor: '250' }, 'api-secret-value');
  for (let i = 0; i < 2; i++) {
    const preview = await gateway.preview(owner, { question: 'revenue', samples: [{ factId: 'fact_note', fields: ['note'] }] });
    const approval = await gateway.approveOutbound(owner, preview.id);
    await assert.rejects(gateway.execute(owner, { previewId: preview.id, approvalId: approval.id }), code('CANARY_BLOCKED'));
    const receipt = store.state.modelReceipts.find(r => r.id === preview.id);
    assert.equal(receipt.status, 'failed'); assert.equal(receipt.errorCode, 'CANARY_BLOCKED'); assert.equal(receipt.dispatchedAt, undefined);
    assert.equal(store.state.modelReceipts.find(r => r.id === approval.id).used, false);
  }
  assert.ok([undefined, '0'].includes(store.state.routes[0].costConsumedMinor), String(store.state.routes[0].costConsumedMinor)); assert.equal(sent, 0);
  store.state.policy.send = 'shape'; // a request without samples carries no protected value
  const preview = await gateway.preview(owner, { question: 'revenue' }); const approval = await gateway.approveOutbound(owner, preview.id);
  await gateway.execute(owner, { previewId: preview.id, approvalId: approval.id }); assert.equal(sent, 1); assert.equal(store.state.routes[0].costConsumedMinor, '100');
  // The owner plants a new value: the blocked payloads never left, so the tick finds nothing and Send stays as it was.
  (store.state.extensions as any)[LANE].tools.canary = { value: 'CANARY-0123456789abcdef01234567', plantedAt: now(), alert: null };
  assert.equal(canaryHit(store.state), null);
  let forced = false; const host = { store, call: async () => { forced = true; } } as any;
  assert.deepEqual(await checkCanary(owner, {}, host), { alert: null }); assert.equal(forced, false); assert.equal(store.state.policy.send, 'shape');
});

test('guarded values keep up to 5,000 values and match a phone number on its digits, however it is spaced', () => {
  const state = initialState('Synthetic phone books');
  const fact = (id: string, value: string) => ({ id, sourceId: 'books', sourceRow: 1, entityId: id, kind: 'customer', validFrom: '2026-09-01', validTo: null, learnedAt: now(), supersededAt: null, fields: { contact: value } });
  // A thousand GSTINs first: the old limit of 500 stopped before the phone number.
  for (let i = 0; i < 1000; i++) state.facts.push(fact(`gstin_${i}`, `27ABCDE${String(i).padStart(4, '0')}F1Z5`) as any);
  state.facts.push(fact('phone', 'Call 98765 43210 after six') as any);
  assert.equal(payloadLeaks(state, '{"sample":"9876543210"}'), true);
  assert.equal(payloadLeaks(state, 'reach +91 98765-43210'), true);
  assert.equal(payloadLeaks(state, '{"sample":"9876543211"}'), false);
  assert.equal(payloadLeaks(state, '{"amountMinor":"19876543210"}'), false);
  assert.equal(payloadLeaks(state, 'customer 27ABCDE0999F1Z5'), true);
});

test('numbers server call records are written in batches, at most a thousand kept, and the list still shows them', async () => {
  const store = new MemoryStore(); let updates = 0; const update = store.update.bind(store);
  store.update = async change => { updates++; return update(change); };
  store.state.extensions = { [LANE]: { reports: {}, trust: {}, tools: { assistants: { on: true, paired: [{ id: 'owner', name: 'Synthetic assistant', pairedAt: now(), sessionId: 'session_x' }] } } } };
  const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
  const mcp = new MCPService(store, { calculations: [] });
  await mcp.handle(owner, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic-client' } } });
  await mcp.handle(owner, { jsonrpc: '2.0', method: 'notifications/initialized' });
  updates = 0;
  for (let i = 0; i < 200; i++) assert.equal((await mcp.handle(owner, { jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: { name: 'synthetic_unknown', arguments: {} } }))!.error!.data!.code, 'UNKNOWN_TOOL');
  await flushMcpCalls(store);
  assert.ok(updates <= 12, `${updates} store updates for 200 calls`);
  assert.equal(assistantsView(store.state).calls.length, 200);
  for (let i = 0; i < 1000; i++) await mcp.handle(owner, { jsonrpc: '2.0', id: i + 300, method: 'tools/call', params: { name: 'synthetic_unknown', arguments: {} } });
  await flushMcpCalls(store);
  assert.equal(((store.state.extensions as any)[LANE].tools.mcpCalls as unknown[]).length, 1000);
});
