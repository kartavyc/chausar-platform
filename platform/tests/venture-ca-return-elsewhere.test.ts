// CA5 comparison of a typed return with a fresh income-tax computation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeIncomeTax } from '../runtime/venture/playbooks/ca-firm/income-tax.ts';
import { portalDiffReceipt } from '../runtime/venture/playbooks/ca-firm/portal.ts';
import { REHEARSAL } from '../runtime/venture/playbooks/ca-firm/rates.ts';
test('an external return comparison receipts both amounts and the calculator rule for every different line', () => {
    const income = computeIncomeTax({ assessmentYear: '2026-27', regime: 'new', residency: 'resident', ageBand: 'below-60', salaryMinor: '200000000' }, REHEARSAL);
    const tax = income.figures.find(row => row.key === 'tax-liability')!;
    const diff = portalDiffReceipt({ ours: [{ ...tax, receiptId: income.id, rule: 'income-tax: tax-liability, confirmed dated table' }], portal: [{ key: tax.key, minor: '1' }], includeBothSides: true } as any);
    assert.equal(diff.working.rows[0].state, 'differs');
    assert.equal(diff.figures.find(row => row.key === 'ours.tax-liability')?.minor, tax.minor);
    assert.equal(diff.figures.find(row => row.key === 'return.tax-liability')?.minor, '1');
    assert.match((diff.working.rows[0] as any).rule, /tax-liability/);
});
