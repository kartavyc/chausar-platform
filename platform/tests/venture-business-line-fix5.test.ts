// Seen in the real app on Windows (17 Nov 2026, re-check 082): a home baker in Indore making custom cakes for offices
// and event planners read "Local services" under the business name, the field of salons, electricians and home visits.
// No family fits a made-to-order product, and no playbook was picked, so the line came from the coarse field. venture.get
// now says what the accepted plan sells, by its first offer's own name; the screens show that before the field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from '../runtime/venture/core/venture.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { owner, seedBlueprint, setup } from './venture-views-env.ts';

test('venture.get says what the accepted plan sells, by its first offer, and nothing before a plan is accepted', async () => {
  const env = await setup();
  assert.equal(buildView(env.deps.store.read())!.sells, undefined);
  await seedBlueprint(env, { status: 'draft' });
  assert.equal(buildView(env.deps.store.read())!.sells, undefined, 'a plan not yet accepted says nothing');
  const plan = await seedBlueprint(env, { status: 'accepted' });
  assert.equal(buildView(env.deps.store.read())!.sells, plan.offers[0]!.name.value);
  // The baker's plan: its first offer is what the line says.
  await ventureAction(env.deps, owner, 'admin', 'seed.cakes', tx => {
    const found = tx.find('venture-blueprint', plan.id)!;
    tx.replace({ ...found, offers: found.offers.map((offer, at) => ({ ...offer, name: { ...offer.name, value: at === 0 ? 'Custom cakes' : 'Custom cupcakes' } })) });
  });
  assert.equal(buildView(env.deps.store.read())!.sells, 'Custom cakes');
});
