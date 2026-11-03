// Chausar kit intake money boundary, 5M. Original behavior tests, no outside source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitOrderIntake } from '../runtime/venture/playbooks/kit/intake.ts';
const offer = { name: 'Client plan', rights: [], intake: [{ id: 'budget', label: 'Budget', help: 'Client budget', kind: 'money' as const, required: true }] };
const meta = { by: 'owner', at: '2026-10-27T10:00:00.000Z', today: '2026-10-27' };
test('kit intake converts rupee text in the engine and keeps only whole paise', () => {
  const intake = kitOrderIntake({ moneyAmounts: { budget: '125.50' } }, offer, meta);
  assert.deepEqual(intake?.fields, { budget: '12550' });
});
test('kit money intake rejects duplicates, unknown money fields, negative amounts and fractional paise', () => {
  for (const input of [
    { fields: { budget: '12550' }, moneyAmounts: { budget: '125.50' } },
    { moneyAmounts: { other: '10' } },
    { moneyAmounts: { budget: '-1' } },
    { moneyAmounts: { budget: '1.001' } },
    { moneyAmounts: [] },
  ]) assert.throws(() => kitOrderIntake(input, offer, meta));
  assert.deepEqual(kitOrderIntake({ moneyAmounts: { budget: '0' } }, offer, meta)?.fields, { budget: '0' });
});

test('typed kit money uses the order country minor units', async () => {
 const {countryProfile}=await import('../runtime/venture/core/countries.ts');
 const japanese={...meta,venture:{country:countryProfile('JP')} as import('../runtime/venture/contracts.ts').VentureRecord};
 assert.deepEqual(kitOrderIntake({moneyAmounts:{budget:'250'}},offer,japanese)?.fields,{budget:'250'});
 assert.throws(()=>kitOrderIntake({moneyAmounts:{budget:'250.50'}},offer,japanese),{code:'INVALID_AMOUNT'});
});
