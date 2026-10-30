// Seller playbook integration: independent Chausar code, research ideas sealeap/amazon-listing-doctor (MIT).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ONLINE_SELLER_DEFINITION } from '../runtime/venture/playbooks/online-seller/definition.ts';
import { ONLINE_SELLER_REGISTRATION } from '../runtime/venture/playbooks/online-seller/registration.ts';
import { runKitBaseline } from '../runtime/venture/playbooks/kit/baseline.ts';
import { allWords, hiProblem } from '../runtime/venture/playbooks/kit/words.ts';
import { readFileSync } from 'node:fs';

test('the seller business registers owner-priced offers, honest import connectors and a Hindi-complete definition', () => {
  assert.ok(ONLINE_SELLER_DEFINITION, 'seller definition is built');
  assert.equal(ONLINE_SELLER_REGISTRATION?.id, 'online-seller');
  assert.ok(ONLINE_SELLER_DEFINITION.offers.every(o => o.price === 'owner-sets'));
  assert.ok(ONLINE_SELLER_DEFINITION.rules.every(rule => Object.hasOwn(rule, 'needs')));
  const hi = JSON.parse(readFileSync(new URL('../runtime/venture/playbooks/online-seller/hi.json', import.meta.url), 'utf8'));
  assert.ok(allWords(ONLINE_SELLER_DEFINITION).every(word => hiProblem(hi, word) === null));
  assert.equal(runKitBaseline(ONLINE_SELLER_DEFINITION).ok, true);
  assert.equal(runKitBaseline(ONLINE_SELLER_DEFINITION, undefined, () => 'Buy reviews and book the claim as receivable.').ok, false);
});

import { kitBusiness, owner } from './fixtures/venture/kit-business.ts';
import { ONLINE_SELLER_DESK } from '../runtime/venture/playbooks/online-seller/desk.ts';

test('seller desk reads uploaded source rows, stores the code receipt and refuses MCP writes', async () => {
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00Z') }, { idea: 'A consulting service for shops' });
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'Check the seller ads export.' });
  const payload = { playbook: 'online-seller' as const, kind: 'sku', id: order.id, action: 'inspect', payload: { orderId: order.id, mode: 'ads', name: 'ads.csv', contentBase64: Buffer.from('spendMinor,salesMinor,reportedAcosBps,basis,source,observedAt\n8000,99900,803,,Owner ads export,2026-10-27T10:00:00Z').toString('base64') } };
  await assert.rejects(ONLINE_SELLER_DESK.sku!.act!(env.deps, { ...owner, channel: 'mcp' }, payload), { code: 'APP_APPROVAL_REQUIRED' });
  const made = await env.call('venture.desk.act', payload);
  assert.equal(made.result.result.acosBps, '801');
  assert.equal(made.result.result.reconciles, false);
  assert.equal(made.result.figures[0].display, '8.01%');
  const get = await env.call('venture.desk.get', { playbook: 'online-seller', kind: 'sku', id: made.id });
  assert.equal(get.item.sourceName, 'ads.csv');
  assert.equal(get.item.receipt.inputs.tables[0].id, made.result.sourceId);
  assert.equal((await env.call('venture.desk.list', { playbook: 'online-seller', kind: 'sku' })).rows[0].id, made.id);
  await assert.rejects(env.call('venture.desk.act', { ...payload, payload: { ...payload.payload, reportedAcosBps: '1' } }), { code: 'INVALID_VENTURE_REQUEST' });
});

test('each audit has one drafting stage, so Accept cannot repeat the whole audit for compute steps', () => {
  for (const offer of ONLINE_SELLER_DEFINITION.offers) {
    assert.equal(offer.stages.length, 1, offer.id);
    assert.ok(offer.stages.every(id => ONLINE_SELLER_DEFINITION.steps.find(step => step.id === id)?.kind === 'write'), offer.id);
  }
});
test('seller intake explicitly asks for channels registration credit and ads basis with named source files',()=>{
 const fields=ONLINE_SELLER_DEFINITION.intakeFields.map(f=>f.id);
 for(const id of ['channels','gstRegistered','claimsInputCredit','adsSalesBasis','feeCards','settlementReports','catalogueSheet','thresholds']) assert.ok(fields.includes(id),id);
 const economic=ONLINE_SELLER_DEFINITION.offers.find(o=>o.id==='unit-economics-monthly')!;
 assert.ok(economic.intake.includes('gstRegistered'));assert.ok(economic.intake.includes('claimsInputCredit'));
 const ads=ONLINE_SELLER_DEFINITION.offers.find(o=>o.id==='ads-health-check')!;assert.ok(ads.intake.includes('adsSalesBasis'));
});
test('seller roles distinguish source work from code figures and owner approval',()=>{
 for(const id of ['lister','auditor','bookkeeper','analyst','photo-producer','chausar','keeper','billing']) assert.ok(ONLINE_SELLER_DEFINITION.roles.some(role=>role.id===id),id);
 for(const id of ['chausar','keeper','billing']) assert.equal(ONLINE_SELLER_DEFINITION.roles.find(role=>role.id===id)?.kind,'code');
});
