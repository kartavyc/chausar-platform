// Original Chausar 5M tests at the kit order and client-file API boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installKitFixture, kitBusiness } from './fixtures/venture/kit-business.ts';
import { kitFixture } from './fixtures/venture/kit-fixture.ts';
import { listRecords } from '../runtime/venture/records.ts';

test('a required kit file and its order are created together, with a real upload reference', async t => {
 const definition = kitFixture();
 definition.intakeFields = [...definition.intakeFields, { id: 'source-file', label: 'Client ledger', help: 'The file supplied by the client.', kind: 'file', required: true }];
 definition.offers = definition.offers.map(offer => offer.id === 'voice-pack' ? { ...offer, intake: [...offer.intake, 'source-file'] } : offer);
 t.after(installKitFixture(definition));
 const env = await kitBusiness();
 const offer = env.offers.find(offer => offer.playbookOffer === 'voice-pack')!;
 const base = { clientId: env.client.id, offerId: offer.id, request: 'A voice sheet for Sunrise Bakery.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } };
 const order = await env.call('venture.order.create', { ...base, intakeFiles: { 'source-file': { name: 'ledger.csv', contentBase64: Buffer.from('item,amount\nsale,125.50').toString('base64') } } });
 const files = await env.call('venture.files.list', { orderId: order.id });
 assert.equal(files.length, 1);
 assert.equal(files[0].name, 'ledger.csv');
 assert.equal(files[0].scope.orderId, order.id);
 assert.equal(order.intake.fields['source-file'], files[0].id);
 const orderCount = listRecords(env.store.read(), 'venture-order').length;
 const fileCount = listRecords(env.store.read(), 'venture-upload').length;
 for (const fileId of ['upload_missing', files[0].id]) {
  await assert.rejects(env.call('venture.order.create', { ...base, intake: { fields: { ...base.intake.fields, 'source-file': fileId } } }), { code: 'UPLOAD_NOT_FOUND' });
 }

 await assert.rejects(env.call('venture.order.create', { ...base, intakeFiles: { 'source-file': { name: 'bad.exe', contentBase64: Buffer.from('bad').toString('base64') } } }));
 await assert.rejects(env.call('venture.order.create', { ...base, intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': false } }, intakeFiles: { 'source-file': { name: 'ledger.csv', contentBase64: Buffer.from('item,amount\nsale,125.50').toString('base64') } } }));
 assert.equal(listRecords(env.store.read(), 'venture-order').length, orderCount);
 assert.equal(listRecords(env.store.read(), 'venture-upload').length, fileCount);
});
