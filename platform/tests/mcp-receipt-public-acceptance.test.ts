import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { ImportInput, MappingRecipe } from '../runtime/ingest.ts';

// Public synthetic source acceptance only: actual CSV import, encrypted file
// storage and loopback HTTP. No direct State insertion, provider or native DB.
const SOURCE = 'synthetic-mcp-public-invoices';
const TOTAL = '900719925474099400';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const PASSPHRASE = 'Synthetic MCP public receipt acceptance passphrase';
const recipe: MappingRecipe = {
  version: 1, id: 'synthetic-mcp-public-invoices', system: 'synthetic-csv', edition: 'fixture',
  scope: { company: 'Synthetic MCP Receipts', branches: ['main', 'satellite'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    { target: 'branch', source: 'branch', type: 'string', nulls: 'reject' },
    { target: 'status', source: 'status', type: 'string', nulls: 'reject' },
  ], allowedKinds: ['invoice'], allowedStatuses: ['issued', 'cancelled'], onUnmapped: 'reject',
};
const importedInput: ImportInput = {
  sourceId: SOURCE, format: 'csv', recipe,
  content: 'id,kind,date,amount,currency,branch,status\n'
    + 'invoice-large,invoice,2026-09-04,900719925474099325,INR,main,issued\n'
    + 'invoice-small,invoice,2026-09-05,75,INR,main,issued\n'
    + 'invoice-cancelled,invoice,2026-09-06,91,INR,main,cancelled\n'
    + 'invoice-other-branch,invoice,2026-09-07,1234,INR,satellite,issued',
  expectedTotals: { rowCount: 4, amountMinor: '900719925474100725' },
};

// Independent canonical JSON oracle; does not import the service's digest code.
function canonicalJSON(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
}
const receiptDigest = (receipt: any) => createHash('sha256').update(canonicalJSON(receipt)).digest('hex');

async function fixture(t: TestContext) {
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-mcp-public-'));
  let providerCalls = 0;
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', gateway: { http: async () => {
    providerCalls++; throw new Error('Synthetic MCP receipt reads must not dispatch a model provider.');
  } } });
  const app = createLocalServer(engine), { origin, token } = await app.listen();
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  t.after(async () => {
    await app.close(); const target = resolve(directory), child = relative(base, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && target.startsWith(join(base, 'chausar-mcp-public-')));
    await rm(target, { recursive: true, force: true });
  });
  async function post(path: '/api/rpc' | '/mcp', payload: unknown, bearer: string | null = token) {
    const response = await fetch(`${origin}${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }) },
      body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: unknown = {}, bearer = token) {
    const result = await post('/api/rpc', { method, payload }, bearer);
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.error, undefined);
    return result.body.result;
  }
  let requestId = 0;
  async function mcp(method: string, params: unknown = {}, bearer: string | null = token) {
    return post('/mcp', { jsonrpc: '2.0', id: ++requestId, method, params }, bearer);
  }
  async function initialize(bearer = token) {
    const reply = await mcp('initialize', { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'Synthetic independent receipt reader', version: '1.0.0' } }, bearer);
    assert.equal(reply.status, 200); assert.equal(reply.body.error, undefined);
    assert.equal(reply.body.result.protocolVersion, '2025-11-25');
    const ready = await post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, bearer);
    assert.equal(ready.status, 200); assert.equal(ready.body, null);
  }
  async function call(name: string, arguments_: unknown, bearer = token) {
    const reply = await mcp('tools/call', { name, arguments: arguments_ }, bearer);
    assert.equal(reply.status, 200, JSON.stringify(reply.body)); assert.equal(reply.body.error, undefined, JSON.stringify(reply.body));
    assert.equal(reply.body.result.isError, false, JSON.stringify(reply.body));
    assert.deepEqual(JSON.parse(reply.body.result.content[0].text), reply.body.result.structuredContent);
    return reply.body.result.structuredContent;
  }
  async function member(branches = ['main']) {
    const invitation = await rpc('auth.invite', { name: 'Synthetic MCP branch reader', role: 'viewer', branches });
    return rpc('auth.accept', { token: invitation.token });
  }
  async function calculationCount() {
    const activity = await rpc('activity.list');
    return activity.items.filter((item: any) => item.event === 'calculation.completed').length;
  }
  await rpc('workspace.create', { name: 'Synthetic MCP Receipts', passphrase: PASSPHRASE, demo: false, pack: 'ecommerce' });
  const imported = await rpc('sources.import', importedInput);
  assert.equal(imported.coverage.reconciled, true); assert.equal(imported.rowIds.length, 4);
  return { token, post, rpc, mcp, initialize, call, member, calculationCount, providerCalls: () => providerCalls };
}

function refused(reply: { status: number; body: any }, code: string) {
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  if (reply.body.error) {
    assert.equal(reply.body.error.data?.code, code); assert.equal(reply.body.result, undefined);
  } else {
    assert.equal(reply.body.result.isError, true);
    assert.deepEqual(reply.body.result.structuredContent, { code });
  }
  assert.ok(!JSON.stringify(reply.body).includes(TOTAL), 'Refusal must not disclose the retained total.');
}
const calculate = { operation: 'billed', period: PERIOD, branch: 'main' };

test('public MCP exact calculated receipt reopens and paginates retained counted rows without recalculation or effects', async t => {
  const f = await fixture(t);
  refused(await f.mcp('tools/list'), 'NOT_INITIALIZED'); await f.initialize();
  const listing = await f.mcp('tools/list'); assert.equal(listing.status, 200); assert.equal(listing.body.error, undefined);
  assert.deepEqual(listing.body.result.tools.map((tool: any) => tool.name).sort(), ['calculate', 'dictionary_operations', 'dictionary_samples', 'dictionary_schema', 'list_counted_rows', 'open_receipt']);
  assert.ok(listing.body.result.tools.every((tool: any) => tool.annotations.readOnlyHint === true && tool.annotations.destructiveHint === false));
  const result = await f.call('calculate', calculate);
  assert.equal(result.value, TOTAL); assert.equal(result.unit, 'minor'); assert.equal(typeof result.value, 'string');
  const retained = await f.rpc('receipts.get', { id: result.receipt.id });
  assert.deepEqual(result.receipt, retained); assert.equal(result.receiptDigest, receiptDigest(retained));
  assert.equal(retained.totalMinor, TOTAL); assert.equal(retained.coverage.countedRows, 2);
  assert.equal(retained.coverage.excludedRows, 1); assert.equal(retained.databaseProof, undefined);
  assert.deepEqual(retained.rows.map((row: any) => row.amountMinor), ['900719925474099325', '75']);
  const count = await f.calculationCount(); assert.equal(count, 1);
  const pin = { receiptId: retained.id, receiptDigest: result.receiptDigest };
  const opened = await f.call('open_receipt', pin);
  assert.deepEqual(opened, { receipt: retained, receiptDigest: result.receiptDigest });
  assert.deepEqual(await f.call('open_receipt', { receiptId: retained.id }), opened);
  assert.deepEqual(await f.call('open_receipt', pin), opened);
  const first = await f.call('list_counted_rows', { ...pin, offset: 0, limit: 1 });
  assert.deepEqual(first, { ...pin, offset: 0, limit: 1, totalRows: 2, rows: retained.rows.slice(0, 1), nextOffset: 1 });
  assert.deepEqual(await f.call('list_counted_rows', { ...pin, offset: 0, limit: 1 }), first);
  const last = await f.call('list_counted_rows', { ...pin, offset: first.nextOffset, limit: 1 });
  assert.deepEqual(last, { ...pin, offset: 1, limit: 1, totalRows: 2, rows: retained.rows.slice(1), nextOffset: null });
  const defaults = await f.call('list_counted_rows', pin);
  assert.deepEqual(defaults, { ...pin, offset: 0, limit: 50, totalRows: 2, rows: retained.rows, nextOffset: null });
  assert.equal(await f.calculationCount(), count); assert.deepEqual(await f.rpc('actions.list'), []);
  assert.equal((await f.rpc('memory.list')).facts.length, 4);
  await f.rpc('workspace.lock');
  await f.rpc('workspace.open', { folder: 'main', passphrase: PASSPHRASE });
  await f.initialize();
  assert.deepEqual(await f.call('open_receipt', pin), opened);
  assert.deepEqual(await f.call('list_counted_rows', { ...pin, offset: 0, limit: 1 }), first);
  assert.equal(await f.calculationCount(), count); assert.deepEqual(await f.rpc('actions.list'), []);
  assert.equal((await f.rpc('activity.list')).modelReceipts.length, 0); assert.equal(f.providerCalls(), 0);
});

test('public MCP read tools enforce closed bounded requests, retained receipt pins and explicit refusal', async t => {
  const f = await fixture(t); await f.initialize();
  const result = await f.call('calculate', calculate), pin = { receiptId: result.receipt.id, receiptDigest: result.receiptDigest };
  const count = await f.calculationCount();
  for (const arguments_ of [
    { ...pin, limit: 0 }, { ...pin, limit: 101 }, { ...pin, limit: 1.5 }, { ...pin, offset: -1 },
    { ...pin, offset: Number.MAX_SAFE_INTEGER + 1 }, { ...pin, sql: 'SELECT private_data' },
    { ...pin, expression: 'process.env' }, { receiptId: pin.receiptId },
  ]) refused(await f.mcp('tools/call', { name: 'list_counted_rows', arguments: arguments_ }), 'INVALID_ARGUMENTS');
  refused(await f.mcp('tools/call', { name: 'calculate', arguments: { ...calculate, expression: '1 + 2' } }), 'INVALID_ARGUMENTS');
  refused(await f.mcp('tools/call', { name: 'execute_action', arguments: { id: 'forged-action' } }), 'UNKNOWN_TOOL');
  refused(await f.mcp('actions.execute', { id: 'forged-action' }), 'METHOD_NOT_FOUND');
  refused(await f.mcp('tools/call', { name: 'open_receipt', arguments: { ...pin, receiptDigest: '0'.repeat(64) } }), 'RECEIPT_CHANGED');
  refused(await f.mcp('tools/call', { name: 'list_counted_rows', arguments: { ...pin, receiptDigest: '0'.repeat(64) } }), 'RECEIPT_CHANGED');
  refused(await f.mcp('tools/call', { name: 'open_receipt', arguments: { receiptId: 'missing-synthetic-receipt' } }), 'RECEIPT_NOT_FOUND');
  assert.equal(await f.calculationCount(), count); assert.deepEqual(await f.rpc('actions.list'), []); assert.equal(f.providerCalls(), 0);
});

test('public MCP branch-limited member can read its own mixed-source receipt and current source revocation withholds it', async t => {
  const f = await fixture(t), reader = await f.member(); await f.initialize(); await f.initialize(reader.token);
  const own = await f.call('calculate', calculate), scoped = await f.call('calculate', calculate, reader.token);
  assert.equal(scoped.value, TOTAL); assert.ok(scoped.receipt.rows.every((row: any) => row.branch === 'main'));
  assert.equal(scoped.receipt.memberId, reader.member.id);
  const pin = { receiptId: scoped.receipt.id, receiptDigest: scoped.receiptDigest };
  assert.deepEqual((await f.call('list_counted_rows', pin, reader.token)).rows, scoped.receipt.rows);
  const foreign = await f.mcp('tools/call', { name: 'open_receipt', arguments: { receiptId: own.receipt.id } }, reader.token);
  refused(foreign, 'RECEIPT_FORBIDDEN'); assert.ok(foreign.body.error, 'Permission denial stays a JSON-RPC error.');
  refused(await f.mcp('tools/call', { name: 'calculate', arguments: { ...calculate, branch: 'satellite' } }, reader.token), 'FORBIDDEN_BRANCH');
  await f.rpc('trust.update', { allowedSources: [] });
  for (const name of ['open_receipt', 'list_counted_rows']) {
    const reply = await f.mcp('tools/call', { name, arguments: pin }, reader.token);
    refused(reply, 'SOURCE_REVOKED'); assert.ok(reply.body.error, 'Current source revocation stays a JSON-RPC error.');
  }
  await f.rpc('trust.update', { allowedSources: [SOURCE] });
  assert.deepEqual((await f.call('open_receipt', pin, reader.token)).receipt, scoped.receipt);
  assert.deepEqual(await f.rpc('actions.list'), []); assert.equal(f.providerCalls(), 0);
});

test('public MCP stale definitions and deleted source evidence cannot reopen an earlier receipt', async t => {
  const f = await fixture(t); await f.initialize();
  const original = await f.call('calculate', calculate);
  const firstPin = { receiptId: original.receipt.id, receiptDigest: original.receiptDigest };
  await f.rpc('ontology.publish', { pack: 'ecommerce' });
  assert.equal((await f.rpc('receipts.get', { id: original.receipt.id })).stale, true);
  for (const name of ['open_receipt', 'list_counted_rows']) {
    refused(await f.mcp('tools/call', { name, arguments: firstPin }), 'UNVERIFIED_NUMBER');
  }
  const fresh = await f.call('calculate', calculate); assert.equal(fresh.value, TOTAL);
  await f.rpc('sources.delete', { id: SOURCE });
  for (const name of ['open_receipt', 'list_counted_rows']) {
    refused(await f.mcp('tools/call', { name, arguments: { receiptId: fresh.receipt.id, receiptDigest: fresh.receiptDigest } }), 'RECEIPT_NOT_FOUND');
  }
  assert.equal((await f.rpc('memory.list')).facts.length, 0); assert.deepEqual(await f.rpc('actions.list'), []);
  assert.equal(f.providerCalls(), 0);
});

test('public MCP anonymous, revoked session and revoked member requests return no retained numbers', async t => {
  const f = await fixture(t), reader = await f.member(); await f.initialize(reader.token);
  const result = await f.call('calculate', calculate, reader.token);
  const params = { name: 'open_receipt', arguments: { receiptId: result.receipt.id, receiptDigest: result.receiptDigest } };
  for (const bearer of [null, 'synthetic-invalid-local-session']) {
    const denied = await f.mcp('tools/call', params, bearer);
    assert.equal(denied.status, 401); assert.equal(denied.body.error.code, 'UNAUTHENTICATED');
    assert.ok(!JSON.stringify(denied.body).includes(TOTAL));
  }
  const rotated = await f.rpc('auth.session', {}, reader.token);
  await f.rpc('auth.revoke', { sessionId: reader.sessionId });
  const sessionRevoked = await f.mcp('tools/call', params, reader.token);
  assert.equal(sessionRevoked.status, 401); assert.equal(sessionRevoked.body.error.code, 'UNAUTHENTICATED');
  assert.deepEqual((await f.call('open_receipt', params.arguments, rotated.token)).receipt, result.receipt);
  await f.rpc('members.revoke', { id: reader.member.id });
  const memberRevoked = await f.mcp('tools/call', params, rotated.token);
  assert.equal(memberRevoked.status, 401); assert.equal(memberRevoked.body.error.code, 'UNAUTHENTICATED');
  assert.ok(!JSON.stringify(memberRevoked.body).includes(TOTAL));
  assert.deepEqual(await f.rpc('actions.list'), []); assert.equal(f.providerCalls(), 0);
});
