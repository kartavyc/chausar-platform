// Isolated client-ledger projection reuses W4 calculators without service-owner records (cfo, MIT ideas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientLedgerPack } from '../runtime/venture/playbooks/bookkeeping-cfo/client-ledger.ts';
import { setup } from './venture-views-env.ts';

test('client ledger projections reuse ageing, cash flow and bank balance from only the named source client', async () => {
  const env = await setup();
  const rows = [
    { id: 'ar', clientId: 'client-source', kind: 'receivable' as const, on: '2026-10-01', amountMinor: '300000', dueOn: '2026-10-15' },
    { id: 'in', clientId: 'client-source', kind: 'receipt' as const, on: '2026-10-12', amountMinor: '900000' },
    { id: 'out', clientId: 'client-source', kind: 'payment' as const, on: '2026-10-15', amountMinor: '1100000' },
    { id: 'bank', clientId: 'client-source', kind: 'balance' as const, on: '2026-10-27', amountMinor: '1200000' },
  ];
  const pack = clientLedgerPack(env.venture, { clientId: 'client-source', sourceId: 'upload_client', rows }, '2026-10-27');
  assert.equal(pack.totals.receivablesMinor, '300000');
  assert.equal(pack.totals.revenueMinor, '900000');
  assert.equal(pack.totals.costsMinor, '1100000');
  assert.equal(pack.totals.cashMinor, '1200000');
  assert.ok(pack.plans.ageing.addends[0].recordId.includes('upload_client:ar'));
  assert.ok(pack.plans.cash.addends[0].recordId.includes('upload_client'));
  assert.ok(!JSON.stringify(pack).includes(env.venture.id));
  assert.throws(() => clientLedgerPack(env.venture, { clientId: 'other-client', sourceId: 'upload_client', rows }, '2026-10-27'), { code: 'CLIENT_LEDGER_MISMATCH' });
  assert.equal(clientLedgerPack(env.venture, { clientId: 'client-source', sourceId: 'upload_client', rows: rows.filter(row => row.kind !== 'balance') }, '2026-10-27').totals.cashMinor, null);
});

test('client cash pack contains thirteen weeks for on-time and late-unpaid with source receipts', async () => {
  const env = await setup();
  const pack = clientLedgerPack(env.venture, { clientId: 'shop', sourceId: 'client-file', rows: [
    { id: 'late', clientId: 'shop', kind: 'receivable', on: '2026-10-01', dueOn: '2026-10-15', amountMinor: '30000' },
    { id: 'bank', clientId: 'shop', kind: 'balance', on: '2026-10-27', amountMinor: '100000' },
  ] }, '2026-10-27');
  assert.equal(pack.projection.length, 13);
  assert.equal(pack.projection[0].week, '2026-11-03');
  assert.equal(pack.projection[12].week, '2027-01-26');
  assert.equal(pack.projection[0].onTime.value, '130000');
  assert.equal(pack.projection[0].lateUnpaid.value, '100000');
  for (const week of pack.projection) for (const scenario of [week.onTime, week.lateUnpaid]) {
    assert.ok(scenario.plan.estimateWords?.includes('Projected'));
    assert.ok(scenario.plan.addends.every(row => row.estimate));
    assert.ok(scenario.plan.addends.some(row => row.recordId.includes('client-file')));
  }
});
