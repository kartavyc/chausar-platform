// CA5 advance tax, original Chausar tests: dated rules and exact paise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceTax } from '../runtime/venture/playbooks/ca-firm/advance-tax.ts';
import { REHEARSAL } from '../runtime/venture/playbooks/ca-firm/rates.ts';
const estimate = { taxMinor: '10000001', tdsMinor: '1', tcsMinor: '0', reliefMinor: '0', residency: 'resident' as const, ageBand: 'below-60' as const, hasBusinessIncome: true, presumptive: false };
test('advance tax uses cumulative dated shares and explicitly labels every result as based on the client estimate', () => {
    const r = advanceTax({ financialYear: '2026-27', estimate }, REHEARSAL);
    assert.deepEqual(r.working.instalments.map(row => [row.by, row.shareBps, row.requiredMinor]), [['2026-06-15', '1500', '1500000'], ['2026-09-15', '4500', '4500000'], ['2026-12-15', '7500', '7500000'], ['2027-03-15', '10000', '10000000']]);
    assert.match(r.assumptions.join(' '), /client.*estimate/i);
    assert.ok(r.working.instalments.every(row => row.basis === 'client-estimate'));
    assert.match(r.id, /^ca_/);
    const p = advanceTax({ financialYear: '2026-27', estimate: { ...estimate, presumptive: true } }, REHEARSAL);
    assert.equal(p.working.instalments.length, 1);
    assert.equal(p.working.instalments[0].by, '2027-03-15');
    assert.throws(() => advanceTax({ financialYear: '2026-27', estimate }, { mode: 'client', confirmations: [] }), (e: any) => e.code === 'RATE_UNCONFIRMED');
});
test('threshold and resident senior exemption are computed, never assumed for a freelancer', () => {
    assert.equal(advanceTax({ financialYear: '2026-27', estimate: { ...estimate, taxMinor: '999999', tdsMinor: '0' } }, REHEARSAL).working.instalments.length, 0);
    assert.equal(advanceTax({ financialYear: '2026-27', estimate: { ...estimate, taxMinor: '1000000', tdsMinor: '0' } }, REHEARSAL).working.instalments.length, 4);
    assert.equal(advanceTax({ financialYear: '2026-27', estimate: { ...estimate, ageBand: '60-79', hasBusinessIncome: false } }, REHEARSAL).working.instalments.length, 0);
    assert.equal(advanceTax({ financialYear: '2026-27', estimate: { ...estimate, ageBand: '60-79', hasBusinessIncome: true } }, REHEARSAL).working.instalments.length, 4);
});
