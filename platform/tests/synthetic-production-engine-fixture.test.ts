import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseCalculator } from '../runtime/analytics.ts';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import { PostgresSnapshotAdapter, type PostgresOptions } from '../runtime/postgres.ts';
import { hash } from '../runtime/contracts.ts';
import { installSyntheticProductionStorage, syntheticProjectionConnection } from './fixtures/synthetic-production-engine.ts';

// These are independently authored projection figures, not database/native
// qualification or provider predictions. All connections are in-memory ports.
function receipt(operation: string, definitions: {name: string; kind: string; sign?: number}[],
  rows: {factId: string; kind: string; amountMinor: string; validFrom: string; dueDate?: string; invoiceId?: string; customerId?: string}[],
  figures: Record<string, string>, primary: string, extra: Record<string, unknown> = {}): CalculationReceipt {
  return {
    id: 'synthetic-production-projection', operation, currency: 'INR',
    definitions: definitions.map(value => ({ ...value, label: value.name, meaning: 'Authored synthetic measure.',
      field: 'amountMinor', currency: 'INR', nulls: 'reject' })),
    rows: rows.map(value => ({ ...value, entityId: value.factId, sourceId: 'synthetic', sourceRow: 1 })),
    rowIds: rows.map(value => value.factId),
    figures: Object.entries(figures).map(([key, minor]) => ({ key, label: key, minor, display: minor,
      unit: key.endsWith('Bps') ? 'basis-points' : 'money', ...(key.endsWith('Bps') ? {} : { currency: 'INR' }) })),
    valueMinor: primary, totalMinor: primary, period: null, comparePeriod: null, assumptions: {}, ...extra,
  } as CalculationReceipt;
}
const sale = (id: string, amount: string, date = '2026-09-02') => ({factId: id, kind: 'sale', amountMinor: amount, validFrom: date});
const database = () => new DatabaseCalculator({ connectionFactory: async () => syntheticProjectionConnection() });

test('synthetic production snapshot admission allows only explicit owned slots and fake connection identity', async t => {
  const directory = resolve(tmpdir(), 'chausar-synthetic-admission-not-created');
  const options = installSyntheticProductionStorage(directory, ['main', 'reviewed'], t.mock);
  assert.equal(options.demo, false); assert.equal(options.storage, 'postgres'); assert.ok(options.analytics?.connectionFactory);
  const connection: PostgresOptions = { host: '127.0.0.1', port: 15432, user: 'synthetic',
    password: 'synthetic-fixture-only', database: 'synthetic', vaultSlot: hash(resolve(directory, 'reviewed')) };
  const adapter = await PostgresSnapshotAdapter.connect(connection);
  assert.equal(adapter.kind as string, 'experimental-file');
  await assert.rejects(PostgresSnapshotAdapter.connect({ ...connection, vaultSlot: hash(resolve(directory, 'unlisted')) }), /unlisted owned workspace/);
  await assert.rejects(PostgresSnapshotAdapter.connect({ ...connection, host: '::1' }));
  await assert.rejects(PostgresSnapshotAdapter.connect({ ...connection, password: 'other-synthetic-input' }));
  assert.throws(() => installSyntheticProductionStorage(directory, ['../outside'], t.mock));
});

test('synthetic SQL derives signed sums and every registered margin figure from inserted projection parameters', async () => {
  const signed = receipt('earned', [{name: 'earned', kind: 'sale', sign: -1}],
    [sale('a', '900719925474099325'), sale('b', '75')], {total: '-900719925474099400'}, '-900719925474099400');
  assert.equal((await database().verify(signed)).engine, 'injected-sql');
  const rows = [sale('sale', '205000'), {factId:'refund',kind:'refund',amountMinor:'12500',validFrom:'2026-09-03'},
    {factId:'cost',kind:'cost',amountMinor:'58000',validFrom:'2026-09-04'}];
  const margin = receipt('margin', [{name:'earned',kind:'sale'},{name:'refunds',kind:'refund'},{name:'costs',kind:'cost'}],
    rows, {earned:'205000',refunds:'12500',netSales:'192500',costs:'58000',contribution:'134500',marginBps:'6987'}, '134500');
  await database().verify(margin);
  const wrong = structuredClone(margin); wrong.figures.find(value => value.key === 'contribution')!.minor = '134499';
  await assert.rejects(database().verify(wrong), {code:'SQL_RESULT_MISMATCH'});
  const zero = receipt('margin', [{name:'earned',kind:'sale'},{name:'refunds',kind:'refund'},{name:'costs',kind:'cost'}],
    [], {earned:'0',refunds:'0',netSales:'0',costs:'0',contribution:'0'}, '0');
  await database().verify(zero);
  const net = receipt('net_sales', [{name:'earned',kind:'sale'},{name:'refunds',kind:'refund'}], rows.slice(0,2), {total:'192500'}, '192500');
  await database().verify(net);
});

test('synthetic SQL uses independently authored current/prior periods and truncates scenario basis points exactly', async () => {
  const rows = [sale('current-a', '10000'), sale('current-b', '20001'), sale('previous', '12000', '2026-08-02')];
  const change = receipt('change', [{name:'earned',kind:'sale'}], rows,
    {current:'30001',previous:'12000',change:'18001',changeBps:'15000'}, '18001', {
      period:{from:'2026-09-01',to:'2026-09-30'}, comparePeriod:{from:'2026-08-01',to:'2026-08-31'} });
  await database().verify(change);
  const scenario = receipt('scenario', [{name:'earned',kind:'sale'}], rows.slice(0,2),
    {baseline:'30001',scenario:'31501',change:'1500',priceChangeBps:'500'}, '31501',
    {period:{from:'2026-09-01',to:'2026-09-30'}, assumptions:{priceChangeBps:'500'}});
  await database().verify(scenario);
  const zeroPrevious = receipt('change', [{name:'earned',kind:'sale'}], [sale('only-current', '100')],
    {current:'100',previous:'0',change:'100'}, '100',
    {period:{from:'2026-09-01',to:'2026-09-30'},comparePeriod:{from:'2026-08-01',to:'2026-08-31'}});
  await database().verify(zeroPrevious);
});

test('synthetic SQL ages linked invoices, caps overpayment and retains unmatched credit without reading receipt totals', async () => {
  const definitions = [{name:'billed',kind:'invoice'},{name:'received',kind:'payment'},{name:'refunds',kind:'refund'}];
  const rows = [
    {factId:'invoice-a',kind:'invoice',amountMinor:'220000',validFrom:'2026-09-02',dueDate:'2026-09-15',invoiceId:'a',customerId:'c'},
    {factId:'payment-a',kind:'payment',amountMinor:'110000',validFrom:'2026-09-06',invoiceId:'a',customerId:'c'},
    {factId:'refund-a',kind:'refund',amountMinor:'12500',validFrom:'2026-09-07',invoiceId:'a',customerId:'c'},
    {factId:'invoice-b',kind:'invoice',amountMinor:'100',validFrom:'2026-09-02',dueDate:'2026-10-01',invoiceId:'b',customerId:'c'},
    {factId:'payment-b',kind:'payment',amountMinor:'150',validFrom:'2026-09-06',invoiceId:'b',customerId:'c'},
    {factId:'unmatched',kind:'payment',amountMinor:'25',validFrom:'2026-09-06',invoiceId:'absent',customerId:'c'},
  ];
  const aged = receipt('aging', definitions, rows,
    {notDue:'0',days1to30:'97500',days31to60:'0',days61to90:'0',over90:'0',outstanding:'97500',unallocated:'75'}, '97500',
    {assumptions:{onDate:'2026-09-30'}});
  await database().verify(aged);
  const wrong = structuredClone(aged); wrong.figures.find(value => value.key === 'unallocated')!.minor = '74';
  await assert.rejects(database().verify(wrong), {code:'SQL_RESULT_MISMATCH'});
});

test('synthetic projection connection refuses unknown prepared SQL and closed connections', async () => {
  const connection = syntheticProjectionConnection();
  await assert.rejects(connection.execute('SELECT 1'), /pinned registered prepared statements/);
  await connection.close();
  await assert.rejects(connection.execute('SELECT 1'), /already closed/);
});

