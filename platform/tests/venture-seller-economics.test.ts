// Chausar seller economics. Ideas: sealeap-amazon-skills (MIT), independently implemented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unitEconomics, breakEvenAcos } from '../runtime/venture/playbooks/online-seller/economics.ts';
import { sellerExample } from './fixtures/venture/seller-fixture.ts';

test('India seller economics rounds each line half-up and ties contribution, payout and GST cash', () => {
  const result = unitEconomics(sellerExample(), { rehearsal: true });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.figures, {
    taxableMinor: '84661', outputGstMinor: '15239', referralMinor: '14985', feesMinor: '23985', feesGstMinor: '4317',
    tcsMinor: '423', tdsMinor: '85', payoutMinor: '71090', returnsMinor: '960', gstCashMinor: '3659',
    contributionMinor: '20516', beforeAdsMinor: '28516', contributionBps: '2423', tieMinor: '20516',
  });
  assert.equal(result.line, 'This is not a buying decision.');
  assert.equal(result.rehearsal, true);
  assert.throws(() => breakEvenAcos(result, null), { code: 'ADS_BASIS_REQUIRED' });
  assert.equal(breakEvenAcos(result, 'gst-inclusive').bps, '2854');
  assert.equal(breakEvenAcos(result, 'taxable').bps, '3368');
});

test('unknown input holds with its missing list, including an unknown zero-cost assumption', () => {
  const input = sellerExample() as any;
  input.packagingMinor = { type: 'unknown', source: 'Client has not answered', observedAt: '2026-10-27T10:00:00+05:30', missingReason: 'Packaging invoice missing' };
  assert.throws(() => unitEconomics(input, { rehearsal: true }), (error: any) => error.code === 'UNIT_ECONOMICS_HOLD' && error.missing[0].field === 'packagingMinor');
  input.packagingMinor.value = '0';
  assert.throws(() => unitEconomics(input, { rehearsal: true }), { code: 'SELLER_INPUT_INVALID' });
});

test('without input credit GST on stock, fees and ads is a cost and all three views still tie', () => {
  // Lost input credit = 43.17 + 54.00 + 14.40 = 111.57; contribution 205.16 - 111.57 = 93.59.
  // GST cash = 152.39 - TCS 4.23 = 148.16. Before ads includes ads GST: 93.59 + 94.40 = 187.99.
  const input = sellerExample(); input.inputCredit.value = 'no';
  const result = unitEconomics(input, { rehearsal: true });
  assert.equal(result.figures.contributionMinor, '9359');
  assert.equal(result.figures.tieMinor, '9359');
  assert.equal(result.figures.gstCashMinor, '14816');
  assert.equal(result.figures.beforeAdsMinor, '18799');
});

test('a real client needs dated CA confirmations and evidence cannot lose its source or time', () => {
  assert.throws(() => unitEconomics(sellerExample(), { rehearsal: false }), { code: 'RULE_UNCONFIRMED' });
  const input = sellerExample() as any;
  input.tcsRule.confirmedBy = input.tdsRule.confirmedBy = { name: 'CA test fixture', on: '2026-10-27' };
  assert.equal(unitEconomics(input, { rehearsal: false }).rehearsal, false);
  input.stockMinor.source = '';
  assert.throws(() => unitEconomics(input, { rehearsal: false }), { code: 'SELLER_INPUT_INVALID' });
});

test('an unknown referral sales basis holds the sheet with the missing evidence list', () => {
  const input = sellerExample() as any;
  input.referralBasis = { type: 'unknown', source: 'Fee card missing', observedAt: '2026-10-27T10:00:00Z', missingReason: 'Referral base not provided' };
  assert.throws(() => unitEconomics(input, { rehearsal: true }), (error: any) => error.code === 'UNIT_ECONOMICS_HOLD' && error.missing.some((item: any) => item.field === 'referralBasis'));
});

test('unused GST credit is held for review instead of being shown as a cash refund', () => {
  const input = sellerExample(); input.stockGstMinor.value = '25000';
  assert.throws(() => unitEconomics(input, { rehearsal: true }), { code: 'UNIT_ECONOMICS_HOLD' });
});

import { sellerWorkReceipt } from '../runtime/venture/playbooks/online-seller/receipt.ts';
import { digest } from '../runtime/venture/records.ts';
test('seller code receipts use the canonical content digest and source-file identity', () => {
  const receipt = sellerWorkReceipt({ result: unitEconomics(sellerExample(), { rehearsal: true }), runRef: { kind: 'rehearsal', scenarioId: 'seller-check', episode: 1 }, sourceId: 'upload-test', sourceName: 'seller.csv', sourceDigest: 'a'.repeat(64) });
  const { digest: saved, ...body } = receipt;
  assert.equal(saved, digest(body));
  assert.equal(receipt.inputs.tables[0].id, 'upload-test');
});

test('missing input reasons travel in structured error details for the tool envelope', () => {
  const input = sellerExample() as any;
  input.packagingMinor = { type: 'unknown', source: 'Client question', observedAt: '2026-10-27T10:00:00Z', missingReason: 'Packaging invoice missing' };
  assert.throws(() => unitEconomics(input, { rehearsal: true }), (error: any) => error.details?.missing?.[0]?.field === 'packagingMinor');
});
