import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, initialState } from '../runtime/contracts.ts';
import type { Context, Fact, State, StateStore } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { digest } from '../runtime/actions.ts';
import { MCPService, MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';

class Store implements StateStore {
  state: State = initialState('Synthetic receipt access', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(); const result = await change(draft); this.state = draft; return result;
  }
}
const context: Context = { memberId: 'reader', role: 'viewer', epoch: 1, channel: 'mcp' };
const exact = '900719925474099312345';
function fixture() {
  const store = new Store();
  store.state.members.push({ id: context.memberId, name: 'Synthetic limited reader', role: 'viewer', epoch: 1, active: true, branches: ['main'] });
  const fact = (id: string, branch: string): Fact => ({ id, entityId: id, sourceId: 'synthetic-mixed-branches', sourceRow: 1,
    kind: 'invoice', validFrom: '2026-09-01', validTo: null, learnedAt: new Date().toISOString(), supersededAt: null, branch, fields: { amountMinor: exact } });
  store.state.facts.push(fact('counted-a', 'main'), fact('counted-b', 'main'), fact('excluded', 'main'), fact('unrelated-west', 'west'));
  const receipt = { id: 'synthetic-retained-receipt', memberId: context.memberId, epoch: 1, verified: true, stale: false,
    totalMinor: exact, valueMinor: exact, sourceIds: ['synthetic-mixed-branches'], requestedSourceIds: ['synthetic-mixed-branches'],
    branch: 'main', rowIds: ['counted-a', 'counted-b'], exclusions: [{ rowId: 'excluded', reason: 'Synthetic cancelled invoice.' }],
    rows: [{ factId: 'counted-a', sourceId: 'synthetic-mixed-branches', branch: 'main', amountMinor: exact },
      { factId: 'counted-b', sourceId: 'synthetic-mixed-branches', branch: 'main', amountMinor: '0' }] };
  store.state.receipts.push(receipt);
  let calls = 0, reads = 0;
  const calculator = new CalculatorService(store, { receiptGuard: () => { reads++; } });
  const service = new MCPService(store, {
    calculations: [{ name: 'billed', description: 'Synthetic registered read', inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      calculate: () => { calls++; return { value: exact, receipt: store.read().receipts[0] }; } }],
    receiptReader: (ctx, id) => calculator.receipt(ctx, id),
  });
  let requestId = 0;
  const call = async (name: string, args: Record<string, unknown> = {}) => service.handle(context, { jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: args } });
  return { store, service, receipt, call, calls: () => calls, reads: () => reads };
}
async function ready(service: MCPService) {
  const initialized = await service.handle(context, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Synthetic plugin client', version: '1' } } });
  assert.equal((initialized?.result as any).protocolVersion, MCP_PROTOCOL_VERSION);
  assert.equal(await service.handle(context, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}
function content(response: any) { assert.equal(response.error, undefined); assert.equal(response.result.isError, false); return response.result.structuredContent; }
function refusal(response: any, code: string) {
  assert.equal(response.error?.data?.code ?? (response.result?.isError && response.result.structuredContent?.code), code);
  const output = JSON.stringify(response); assert.equal(output.includes(exact), false); assert.equal(output.includes('counted-a'), false);
  assert.equal(response.result?.structuredContent?.receipt, undefined); assert.equal(response.result?.structuredContent?.rows, undefined);
}

test('MCP joins owned receipts to the current calculator reader and reopens exact bounded evidence without recalculation', async () => {
  const f = fixture(); await ready(f.service);
  const tools = (await f.service.handle(context, { jsonrpc: '2.0', id: 3, method: 'tools/list' }))?.result as any;
  assert.deepEqual(tools.tools.map((tool: any) => tool.name), ['billed', 'open_receipt', 'list_counted_rows']);
  assert.ok(tools.tools.every((tool: any) => tool.annotations.readOnlyHint && tool.annotations.idempotentHint && !tool.annotations.destructiveHint));
  const result = content(await f.call('billed')); assert.equal(result.value, exact); assert.deepEqual(result.receipt, f.receipt);
  assert.equal(result.receiptDigest, digest(f.receipt)); assert.equal(f.reads(), 1);
  const pin = { receiptId: f.receipt.id, receiptDigest: result.receiptDigest };
  const baseline = f.store.read(); const opened = content(await f.call('open_receipt', pin));
  assert.deepEqual(opened, { receipt: f.receipt, receiptDigest: result.receiptDigest });
  const page = content(await f.call('list_counted_rows', { ...pin, limit: 1 }));
  assert.deepEqual(page, { ...pin, offset: 0, limit: 1, totalRows: 2, rows: [f.receipt.rows[0]], nextOffset: 1 });
  assert.deepEqual(content(await f.call('list_counted_rows', { ...pin, limit: 1 })), page);
  assert.deepEqual(content(await f.call('open_receipt', pin)), opened);
  const last = content(await f.call('list_counted_rows', { ...pin, offset: 1, limit: 1 }));
  assert.deepEqual(last.rows, [f.receipt.rows[1]]); assert.equal(last.nextOffset, null);
  assert.deepEqual(content(await f.call('list_counted_rows', { ...pin, offset: 2 })).rows, []);
  assert.equal(f.calls(), 1); assert.deepEqual(f.store.read(), baseline);
  // A receipt scoped to main stays readable even though its source also holds west facts.
  assert.equal(opened.receipt.branch, 'main');
});

test('receipt tools enforce closed schemas, digest pins and integer page bounds before evidence access', async () => {
  const f = fixture(); await ready(f.service); const pin = { receiptId: f.receipt.id, receiptDigest: digest(f.receipt) };
  for (const args of [{ ...pin, limit: 0 }, { ...pin, limit: 101 }, { ...pin, limit: 1.1 }, { ...pin, offset: -1 },
    { ...pin, offset: Number.MAX_SAFE_INTEGER + 1 }, { ...pin, limit: '1' }, { ...pin, query: 'SELECT * FROM facts' },
    { receiptId: pin.receiptId }, { ...pin, receiptDigest: 'invalid' }]) refusal(await f.call('list_counted_rows', args), 'INVALID_ARGUMENTS');
  refusal(await f.call('open_receipt', { ...pin, expression: 'private()' }), 'INVALID_ARGUMENTS');
  refusal(await f.call('open_receipt', { receiptId: '' }), 'INVALID_ARGUMENTS');
  assert.equal(f.reads(), 0); assert.equal(f.calls(), 0);
  refusal(await f.call('open_receipt', { receiptId: 'missing' }), 'RECEIPT_NOT_FOUND');
  refusal(await f.call('open_receipt', { ...pin, receiptDigest: '0'.repeat(64) }), 'RECEIPT_CHANGED');
  refusal(await f.call('list_counted_rows', { ...pin, receiptDigest: '0'.repeat(64) }), 'RECEIPT_CHANGED');
  const tool = f.service.calculations.get('billed')!;
  assert.throws(() => new MCPService(f.store, { calculations: [{ ...tool, name: 'open_receipt' }] }), { code: 'INVALID_MCP_TOOL' });
});

test('owned calculation, receipt reopen and counted-page reads refuse missing counted or excluded evidence', async t => {
  for (const id of ['counted-a', 'excluded']) for (const deleted of [false, true]) await t.test(`${id}: ${deleted ? 'deleted' : 'missing'}`, async () => {
    const f = fixture(); await ready(f.service); const pin = { receiptId: f.receipt.id, receiptDigest: digest(f.receipt) };
    if (deleted) f.store.state.facts.find(fact => fact.id === id)!.deletedAt = new Date().toISOString();
    else f.store.state.facts = f.store.state.facts.filter(fact => fact.id !== id);
    for (const name of ['billed', 'open_receipt', 'list_counted_rows']) refusal(await f.call(name, name === 'billed' ? {} : pin), 'RECEIPT_FORBIDDEN');
  });
});

test('receipt reads preserve historical evidence and honor current readiness rather than rerunning selection', async () => {
  const f = fixture(); await ready(f.service); const pin = { receiptId: f.receipt.id, receiptDigest: digest(f.receipt) };
  f.store.state.facts[0].supersededAt = new Date().toISOString();
  assert.deepEqual(content(await f.call('list_counted_rows', pin)).rows, f.receipt.rows);
  f.service.receiptReader = () => { throw new ChausarError('SOURCE_PROFILE_STALE', 'Private provider diagnostic ' + exact); };
  for (const name of ['billed', 'open_receipt', 'list_counted_rows']) {
    const response = await f.call(name, name === 'billed' ? {} : pin); refusal(response, 'SOURCE_PROFILE_STALE');
    assert.equal(JSON.stringify(response).includes('Private provider diagnostic'), false);
  }
});

test('existing receipts cannot survive stale evidence, source policy, branch, member or private-scope revocation', async t => {
  const changes: [string, (f: ReturnType<typeof fixture>) => void, string][] = [
    ['stale', f => { f.store.state.receipts[0].stale = true; }, 'UNVERIFIED_NUMBER'],
    ['source', f => { f.store.state.sourceRules.push({ sourceId: 'synthetic-mixed-branches', allow: false }); }, 'SOURCE_REVOKED'],
    ['source read', f => { f.store.state.sourceRules.push({ sourceId: 'synthetic-mixed-branches', read: false }); }, 'SOURCE_REVOKED'],
    ['source active', f => { f.store.state.sourceRules.push({ sourceId: 'synthetic-mixed-branches', active: false }); }, 'SOURCE_REVOKED'],
    ['empty requested source', f => { f.store.state.receipts[0].requestedSourceIds.push('synthetic-empty'); f.store.state.sourceRules.push({ sourceId: 'synthetic-empty', allow: false }); }, 'SOURCE_REVOKED'],
    ['empty requested source read', f => { f.store.state.receipts[0].requestedSourceIds.push('synthetic-empty'); f.store.state.sourceRules.push({ sourceId: 'synthetic-empty', read: false }); }, 'SOURCE_REVOKED'],
    ['empty requested source active', f => { f.store.state.receipts[0].requestedSourceIds.push('synthetic-empty'); f.store.state.sourceRules.push({ sourceId: 'synthetic-empty', active: false }); }, 'SOURCE_REVOKED'],
    ['branch', f => { f.store.state.members[1].branches = ['west']; }, 'RECEIPT_FORBIDDEN'],
    ['epoch', f => { f.store.state.members[1].epoch++; }, 'ACCESS_REVOKED'],
    ['inactive', f => { f.store.state.members[1].active = false; }, 'ACCESS_REVOKED'],
    ['foreign receipt', f => { f.store.state.receipts[0].memberId = 'owner'; }, 'RECEIPT_FORBIDDEN'],
    ['old receipt epoch', f => { f.store.state.receipts[0].epoch = 0; }, 'RECEIPT_FORBIDDEN'],
  ];
  for (const [label, change, code] of changes) await t.test(label, async () => {
    const f = fixture(); await ready(f.service); change(f); const pin = { receiptId: f.receipt.id, receiptDigest: digest(f.store.state.receipts[0]) };
    for (const name of ['billed', 'open_receipt', 'list_counted_rows']) refusal(await f.call(name, name === 'billed' ? {} : pin), code);
  });
});

test('receipt readers cannot substitute evidence or change authority or ledger during verification', async t => {
  for (const mode of ['substitute', 'ledger', 'authority', 'branch']) await t.test(mode, async () => {
    const f = fixture(); await ready(f.service);
    f.service.receiptReader = () => {
      if (mode === 'substitute') return { ...f.receipt, totalMinor: '1' };
      if (mode === 'ledger') f.store.state.receipts[0].totalMinor = '1';
      if (mode === 'authority') f.store.state.members[1].epoch++;
      if (mode === 'branch') f.store.state.members[1].branches = ['west'];
      return f.receipt;
    };
    refusal(await f.call('billed'), mode === 'authority' ? 'ACCESS_REVOKED' : mode === 'branch' ? 'BRANCH_FORBIDDEN' : 'UNVERIFIED_NUMBER');
  });
});

test('in-flight calculation completion and failure both recheck revoked caller authority', async t => {
  for (const fail of [false, true]) await t.test(fail ? 'failure' : 'completion', async () => {
    const f = fixture(); await ready(f.service); let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { started = resolve; });
    f.service.calculations.get('billed')!.calculate = async () => {
      started(); await waiting; if (fail) throw new ChausarError('PRIVATE_DIAGNOSTIC', exact);
      return { value: exact, receipt: f.receipt };
    };
    const pending = f.call('billed'); await entered; f.store.state.members[1].epoch++; release();
    refusal(await pending, 'ACCESS_REVOKED'); assert.equal(f.reads(), 0);
  });
});

test('in-flight source revocation refuses the exact retained result when caller epoch is unchanged', async () => {
  const f = fixture(); await ready(f.service); let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { started = resolve; });
  f.service.calculations.get('billed')!.calculate = async () => { started(); await waiting; return { value: exact, receipt: f.receipt }; };
  const pending = f.call('billed'); await entered; f.store.state.sourceRules.push({ sourceId: 'synthetic-mixed-branches', allow: false }); release();
  refusal(await pending, 'SOURCE_REVOKED');
});

test('missing, forged and mismatched numeric evidence fails without receipt or row disclosure', async () => {
  const f = fixture(); await ready(f.service); const tool = f.service.calculations.get('billed')!;
  for (const output of [{ value: exact, receipt: undefined }, { value: exact, receipt: { ...f.receipt, totalMinor: '1' } },
    { value: '999', receipt: f.receipt }, { value: Number(exact), receipt: f.receipt }]) {
    tool.calculate = () => output; refusal(await f.call('billed'), 'UNVERIFIED_NUMBER');
  }
  tool.calculate = () => { throw new Error('Private diagnostic ' + exact); };
  refusal(await f.call('billed'), 'UNVERIFIED_NUMBER');
  assert.equal(f.store.state.actions.length, 0);
});

test('row-backed receipts require a current reader and never use the legacy stored-scalar fallback', async () => {
  const f = fixture(); await ready(f.service); f.service.receiptReader = undefined;
  f.store.state.facts = [];
  refusal(await f.call('billed'), 'RECEIPT_UNAVAILABLE');
  for (const name of ['open_receipt', 'list_counted_rows']) refusal(await f.call(name, { receiptId: f.receipt.id, receiptDigest: digest(f.receipt) }), 'UNKNOWN_TOOL');
  const tools = (await f.service.handle(context, { jsonrpc: '2.0', id: 3, method: 'tools/list' }))?.result as any;
  assert.deepEqual(tools.tools.map((tool: any) => tool.name), ['billed']);
});

test('tool refusals withhold private messages and unrecognized callback codes', async () => {
  const f = fixture(); await ready(f.service); const tool = f.service.calculations.get('billed')!;
  for (const code of ['SOURCE_REVOKED', 'RECEIPT_FORBIDDEN', 'FORBIDDEN_BRANCH', 'SYNTHETIC_PRIVATE_CODE_' + exact]) {
    tool.calculate = () => { throw new ChausarError(code, 'Synthetic private diagnostic ' + exact); };
    const response = await f.call('billed');
    refusal(response, code.startsWith('SYNTHETIC_PRIVATE_CODE_') ? 'UNVERIFIED_NUMBER' : code);
    assert.equal(JSON.stringify(response).includes('Synthetic private diagnostic'), false);
  }
});
