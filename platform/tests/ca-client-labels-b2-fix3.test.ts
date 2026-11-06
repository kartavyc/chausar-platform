// B2 fix round 3 (HIGH 1 of the final review): a CA engine step's label is copied into the work receipt's figure
// (delivery/harness/tools-ca.ts caWorkReceipt) and renderDeliverable writes "label: display" into the CLIENT's
// document. What leaves the app is the exact form, so no label may carry an owner-form amount ("₹1,50,000").
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeIncomeTax } from '../runtime/venture/playbooks/ca-firm/income-tax.ts';
import { reconcileTaxStatements } from '../runtime/venture/playbooks/ca-firm/reconcile.ts';
import type { CaReceipt } from '../runtime/venture/playbooks/ca-firm/receipt.ts';
import { renderDeliverable } from '../runtime/venture/delivery/deliverable.ts';

const R = (rupees: number) => String(BigInt(rupees) * 100n);

/** The client document a draft quoting every figure of this receipt renders, through the work receipt's figures. */
function clientText(receipt: CaReceipt): string {
  const work = { id: 'r-ca', figures: receipt.figures.map(item => ({ key: item.key, label: item.label, minor: item.minor, display: item.display, currency: 'INR', unit: 'money' })) };
  const draft = { title: 'Your working', sections: [{ heading: 'Figures', parts: receipt.figures.map(item => ({ kind: 'figure', receiptId: work.id, figureKey: item.key })) }], questionsForClient: [] };
  return renderDeliverable(draft as never, [work as never], { dateOrder: 'DMY' } as never);
}

test('a capped 80C claim reaches the client document in the exact form, never "₹"', () => {
  const receipt = computeIncomeTax({
    assessmentYear: '2026-27', regime: 'old', residency: 'resident', ageBand: 'below-60', salaryMinor: R(12_00_000),
    deductions: [{ code: '80C', claimedMinor: R(3_00_000) }],
  });
  const text = clientText(receipt);
  assert.match(text, /capped/);
  assert.doesNotMatch(text, /₹/);
  assert.match(text, /claimed INR 300,000\.00, capped at INR 150,000\.00/);
});

test('every reconcile difference reaches the client document in the exact form, never "₹"', () => {
  const receipt = reconcileTaxStatements({ entries: [
    { source: 'books', category: 'salary', payer: 'MUMA12345B', grossMinor: R(12_00_000), tdsMinor: R(80_000) },
    { source: 'ais', category: 'salary', payer: 'MUMA12345B', grossMinor: R(12_00_000), tdsMinor: R(80_000) },
    { source: '26as', category: 'salary', payer: 'MUMA12345B', grossMinor: R(12_10_000), tdsMinor: R(78_000) },
    { source: '26as', category: 'interest', payer: 'MUMH01234C', grossMinor: R(5_000), tdsMinor: '0' },
  ] });
  const text = clientText(receipt);
  assert.match(text, /the books show/);
  assert.doesNotMatch(text, /₹/);
});
