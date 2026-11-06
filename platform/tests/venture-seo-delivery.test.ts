// SEO end-to-end order: internal workflow steps must not become repeated report deliveries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitBusiness, deliver, draft } from './fixtures/venture/kit-business.ts';
import { listRecords, findRecord } from '../runtime/venture/records.ts';
test('accepting the visibility report finishes the order with one delivery artifact', async () => {
  const env = await kitBusiness({ now: new Date('2026-10-27T12:00:00.000Z') }, { idea: 'SEO agency for local clinics' });
  const offer = env.offers.find(offer => offer.playbookOffer === 'visibility-check')!;
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: offer.id, request: 'A site visibility check with evidence and honest source gaps.', intake: { fields: { siteUrl: 'https://clinic.example/' } } });
  const report = draft('Site visibility report', { Evidence: ['The checked pages and captured answers are the evidence.'], 'Source gaps': ['Unobserved checks stay unknown.'], 'Fix list': ['Review the title with the site owner.'], Limits: ['No ranking or citation is promised.'] });
  const run = await deliver(env, order.id, report);
  assert.equal(run.status, 'ready-for-review', JSON.stringify(run.acceptBlocked ?? run.checks));
  await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' });
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').filter(run => run.orderId === order.id).length, 1);
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', run.id)?.status, 'accepted');
  assert.equal(findRecord(env.store.read(), 'venture-order', order.id)?.chainState, undefined, 'a single-artifact order has no cross-run chain state');
});
