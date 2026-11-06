// Seller settlements: sealeap-amazon-skills (MIT), independently implemented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSettlements } from '../runtime/venture/playbooks/online-seller/settlement.ts';

test('each payout difference splits into named items and unresolved claims are estimates, never receivables', () => {
  const r = auditSettlements([{ orderId: 'order-1', expectedMinor: '71090', paidMinor: '70000', source: 'Settlement export', observedAt: '2026-10-27T10:00:00Z',
    adjustments: [{ kind: 'weight-change', minor: '500', source: 'Weight charge line' }], holdReasons: ['Review window not confirmed'] }]);
  assert.deepEqual(r.rows[0].differences, [{ kind: 'weight-change', minor: '500', source: 'Weight charge line' }, { kind: 'unknown', minor: '590', source: 'Unexplained settlement balance' }]);
  assert.equal(r.rows[0].differenceMinor, '1090');
  assert.equal(r.rows[0].claimKind, 'estimate for review, not receivable');
  assert.equal(r.submitted, false); assert.equal(r.line, 'Nothing submitted. The seller files any claim.');
  assert.deepEqual(r.rows[0].holdReasons, ['Review window not confirmed', 'Unexplained settlement balance']);
});
