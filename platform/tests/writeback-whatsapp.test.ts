import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhatsAppAdapters, noStatusSource } from '../runtime/writeback/systems/whatsapp.ts';
import { effectReference } from '../runtime/writeback/reference.ts';
import { WhatsAppFake, whatsappSeed } from '../fakes/whatsapp/index.ts';
import { cycle, fakeContext, practiceConnection } from '../fakes/harness.ts';

function setup(token = whatsappSeed.token) {
  const fake = new WhatsAppFake(whatsappSeed, () => '2026-10-14T09:30:00.000Z');
  const ctx = fakeContext(fake, practiceConnection('whatsapp', { phoneNumberId: whatsappSeed.phoneNumberId, wabaId: whatsappSeed.wabaId }), { accessToken: token });
  return { fake, ctx, adapter: createWhatsAppAdapters(fake.statuses)['template.send'] };
}
const payload = { to: '919800000001', template: 'payment_reminder', language: 'en', parameters: ['Asha Traders', 'INV-000101', '1,000.00'] };

test('an approved template is sent once with its reference, confirmed by the delivered status, and a repeat finds it', async () => {
  const { fake, ctx, adapter } = setup();
  const first = await cycle(adapter, ctx, payload, 'effect-key-wa-1');
  assert.equal((first.preparation.preview as any).asWritten, 'To: +919800000001\nTemplate payment_reminder (en) with: {{1}} Asha Traders; {{2}} INV-000101; {{3}} 1,000.00');
  assert.equal(first.receipt?.outcome, 'accepted'); assert.match(first.receipt!.externalId!, /^wamid\./);
  assert.deepEqual(first.observation, { outcome: 'confirmed-applied', observed: { messageId: first.receipt!.externalId, status: 'delivered', at: '2026-10-14T09:30:00.000Z', reference: effectReference('effect-key-wa-1') }, externalId: first.receipt!.externalId, businessSuccess: true });
  const sent = JSON.parse(fake.log.find(entry => entry.method === 'POST')!.body!);
  assert.equal(sent.biz_opaque_callback_data, effectReference('effect-key-wa-1'));
  assert.deepEqual(sent.template, { name: 'payment_reminder', language: { code: 'en' }, components: [{ type: 'body', parameters: payload.parameters.map(text => ({ type: 'text', text })) }] });
  const again = await cycle(adapter, ctx, payload, 'effect-key-wa-1');
  assert.deepEqual(again.preparation.alreadyApplied, { externalId: first.receipt!.externalId }); assert.equal(again.receipt, null);
  assert.equal(fake.messages.length, 1);
  assert.equal((await cycle(adapter, ctx, { ...payload, language: 'hi' }, 'effect-key-wa-2')).observation.outcome, 'confirmed-applied');
});

test('a lost reply after WhatsApp accepted the message is settled by its status, never by sending again', async () => {
  const { fake, ctx, adapter } = setup();
  fake.fault('drop-after-commit');
  const result = await cycle(adapter, ctx, payload, 'effect-key-wa-3');
  assert.equal(result.doError, 'FAKE_CONNECTION_LOST');
  assert.equal(result.observation.outcome, 'confirmed-applied');
  assert.equal(fake.messages.length, 1);
});

test('an unapproved template, an unknown language and a parameter count mismatch are refused at prepare', async () => {
  const { fake, ctx, adapter } = setup();
  await assert.rejects(cycle(adapter, ctx, { ...payload, template: 'festival_offer', parameters: ['A', 'B'] }, 'effect-key-wa-4'), { code: 'WRITE_PRECONDITION_FAILED' });
  await assert.rejects(cycle(adapter, ctx, { ...payload, language: 'ta' }, 'effect-key-wa-5'), { code: 'WRITE_PRECONDITION_FAILED' });
  await assert.rejects(cycle(adapter, ctx, { ...payload, parameters: ['Asha Traders', 'INV-000101'] }, 'effect-key-wa-6'), { code: 'WRITE_PRECONDITION_FAILED' });
  assert.equal(fake.messages.length, 0);
});

test('without a status the read-back stays not sure; a failed delivery counts as attempted', async () => {
  const { fake, ctx, adapter } = setup();
  fake.silence();
  const silent = await cycle(adapter, ctx, payload, 'effect-key-wa-7');
  assert.equal(silent.receipt?.outcome, 'accepted');
  assert.deepEqual(silent.observation, { outcome: 'inconclusive', reason: 'WhatsApp has not reported this message yet.' });
  const unwired = createWhatsAppAdapters(noStatusSource)['template.send'];
  assert.equal((await unwired.readBack(ctx, payload, silent.preparation, 'effect-key-wa-7', silent.receipt)).outcome, 'inconclusive');
  fake.messages[0].statuses.push({ messageId: fake.messages[0].id, status: 'failed', at: '2026-10-14T09:31:00.000Z', reference: fake.messages[0].reference });
  const failed = await adapter.readBack(ctx, payload, silent.preparation, 'effect-key-wa-7', silent.receipt);
  assert.equal(failed.outcome, 'confirmed-applied'); assert.equal((failed as any).businessSuccess, false);
});

test('a wrong token and malformed payloads are refused with fixed codes', async () => {
  const { adapter, ctx } = setup('wrong-token');
  await assert.rejects(cycle(adapter, ctx, payload, 'effect-key-wa-8'), { code: 'WRITE_AUTH_REFUSED' });
  for (const bad of [{ ...payload, parameters: ['line\nbreak', 'B', 'C'] }, { ...payload, parameters: ['tab\there', 'B', 'C'] }, { ...payload, parameters: ['five     spaces', 'B', 'C'] },
    { ...payload, parameters: Array.from({ length: 11 }, () => 'x') }, { ...payload, template: 'Payment-Reminder' }, { ...payload, to: '+919800000001' }, { ...payload, extra: true }])
    assert.throws(() => adapter.validate(bad), { code: 'INVALID_WRITE_PAYLOAD' });
  assert.deepEqual(adapter.validate({ ...payload, parameters: ['four    spaces'] }).parameters, ['four    spaces']);
});
