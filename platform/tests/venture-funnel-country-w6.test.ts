import test from 'node:test';
import assert from 'node:assert/strict';
import type { PipelineCardResult, PriceReceiptRecord } from '../runtime/venture/contracts.ts';
import { countryProfile } from '../runtime/venture/core/countries.ts';
import { funnelCountPlan } from '../runtime/venture/network/funnel.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { owner, seedBlueprint, setup } from './venture-views-env.ts';
import { add, board, manyPeople, pipe } from './venture-pipeline-env.ts';

test('a forecast names its currency and explains excluded old quotes after a country change', async () => {
  const env = await setup();
  await seedBlueprint(env);
  const people = await manyPeople(env, 11);
  const open = await add(env, people[0]);
  const quote = await money['venture.price.quote']!(env.deps, owner, { offerId: 'offer_1' }) as PriceReceiptRecord;
  await pipe<PipelineCardResult>(env, 'venture.pipeline.move', { id: open.card.id, stage: 'proposal', evidence: { kind: 'quote', id: quote.id } });
  for (const person of people.slice(1)) {
    const card = await add(env, person);
    await pipe(env, 'venture.pipeline.move', { id: card.card.id, stage: 'won' });
  }
  const subject = { type: 'count', what: 'funnel', scope: 'forecast', from: '2026-07-18', to: '2026-10-15' } as const;
  const original = funnelCountPlan(env.store.read(), env.venture, subject);
  assert.equal(original.addends.length, 1);
  assert.equal(original.words?.label, 'Forecast in INR only, from your last 90 days');
  assert.match(original.estimateWords!, /Other currencies are excluded/);

  const moved = { ...env.venture, country: countryProfile('US') };
  await ventureAction(env.deps, owner, 'admin', 'test.country', tx => tx.replace(moved));
  const plan = funnelCountPlan(env.store.read(), moved, subject);
  assert.equal(plan.currency, 'USD');
  assert.equal(plan.addends.length, 0, 'an INR quote is never relabelled or converted');
  const empty = 'No open card has a quote in USD. Other currencies are excluded.';
  assert.equal(plan.words?.none, empty);
  assert.deepEqual((await board(env)).forecast, { line: empty });
});
