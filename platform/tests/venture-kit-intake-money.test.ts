// Chausar kit intake money boundary, 5M. Original behavior tests, no outside source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitOrderIntake } from '../runtime/venture/playbooks/kit/intake.ts';
const offer = { name: 'Client plan', rights: [], intake: [{ id: 'budget', label: 'Budget', help: 'Client budget', kind: 'money' as const, required: true }] };
const meta = { by: 'owner', at: '2026-10-27T10:00:00.000Z', today: '2026-10-27' };
test('kit intake converts rupee text in the engine and keeps only whole paise', () => {
  const intake = kitOrderIntake({ moneyRupees: { budget: '125.50' } }, offer, meta);
  assert.deepEqual(intake?.fields, { budget: '12550' });
});
test('kit money intake rejects duplicates, unknown money fields, negative amounts and fractional paise', () => {
  for (const input of [
    { fields: { budget: '12550' }, moneyRupees: { budget: '125.50' } },
    { moneyRupees: { other: '10' } },
    { moneyRupees: { budget: '-1' } },
    { moneyRupees: { budget: '1.001' } },
    { moneyRupees: [] },
  ]) assert.throws(() => kitOrderIntake(input, offer, meta));
  assert.deepEqual(kitOrderIntake({ moneyRupees: { budget: '0' } }, offer, meta)?.fields, { budget: '0' });
});
