// Seller ads: sealeap-amazon-skills (MIT), independently implemented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseAds } from '../runtime/venture/playbooks/online-seller/ads.ts';

test('ACOS comes from raw spend and sales; a difference greater than a hundredth point does not reconcile', () => {
  const input = { spendMinor: '8000', salesMinor: '99900', reportedAcosBps: '803', basis: null, source: 'Ads export', observedAt: '2026-10-27T10:00:00Z' };
  const r = diagnoseAds(input);
  assert.equal(r.acosBps, '801'); assert.equal(r.reconciles, false);
  assert.equal(r.line, 'The ads report does not reconcile.');
  assert.equal(r.breakEven, null); assert.equal(r.reason, 'ADS_BASIS_REQUIRED');
});
