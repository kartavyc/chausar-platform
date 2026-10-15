import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateAllowance, validateAllowanceRoute, validateCost, validateLadder, validatePricing, validateSpeechConfigured,
} from '../src/screens/trust/models-replies.ts';

test('the assumed models.setLadder reply: an order of route ids, or the routes in their new order', () => {
  assert.deepEqual(validateLadder({ order: ['a', 'b'] }), { order: ['a', 'b'] });
  assert.deepEqual(validateLadder([{ id: 'b' }, { id: 'a' }]), { order: ['b', 'a'] });
  assert.throws(() => validateLadder({ order: [1] }), /INVALID_REPLY/);
});

test('"not counted" from the engine is missing, never zero; a number where paise belong is refused', () => {
  const p = validatePricing({ currency: 'INR', fx: 'not counted', entries: [{ kind: 'k', model: 'm', inputUsdMicroPerMillion: '1', outputUsdMicroPerMillion: '2',
    asOf: '2026-10-01', source: 's', verified: false, inputPerMillionMinor: 'not counted', outputPerMillionMinor: 'not counted' }] });
  assert.equal(p.fx, null);
  assert.equal(p.entries[0]!.inputPerMillionMinor, null);
  assert.equal(validateCost({ currency: 'INR', costMinor: 'not counted', basis: 'Subscription plan.' }).costMinor, null);
  assert.throws(() => validateCost({ currency: 'INR', costMinor: 42, basis: 'x' }), /INVALID_REPLY/);
  assert.throws(() => validateCost({ currency: 'USD', costMinor: '42', basis: 'x' }), /INVALID_REPLY/);
});

test('a reply that carries a key or credential is refused', () => {
  assert.throws(() => validateSpeechConfigured({ id: 'x', kind: 'sarvam-stt', enabled: true, credentialConfigured: true, secret: 's' }), /INVALID_REPLY/);
  assert.throws(() => validateAllowanceRoute({ id: 'r', kind: 'managed', model: 'm', credential: 'c' }), /INVALID_REPLY/);
  assert.deepEqual(validateAllowanceRoute({ id: 'r', kind: 'managed', model: 'm', enabled: true }), { id: 'r', model: 'm' });
});

test('an allowance with no grant keeps the grant and balance missing; a negative balance is kept as sent', () => {
  const base = { month: '2026-10', spentPaise: '0', reservedPaise: '0', pricing: null, models: [] };
  const none = validateAllowance({ ...base, grantPaise: null, grantState: 'not-set', balancePaise: null });
  assert.equal(none.grantMinor, null); assert.equal(none.balanceMinor, null);
  assert.equal(validateAllowance({ ...base, grantPaise: '100', grantState: 'set', balancePaise: '-20' }).balanceMinor, '-20');
  assert.throws(() => validateAllowance({ ...base, grantPaise: null, grantState: 'maybe', balancePaise: null }), /INVALID_REPLY/);
});
