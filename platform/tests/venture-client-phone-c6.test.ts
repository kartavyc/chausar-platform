// One-shot C6 task 3 (section 9 idea 29): a client's phone or WhatsApp number. Kept as typed, its WhatsApp digits
// worked out by code, edited through the evidence ledger like the email, and erased by Forget.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClientRecord } from '../runtime/venture/contracts.ts';
import type { ClientCrmView } from '../runtime/venture/crm/crm-data.ts';
import { addClient } from '../runtime/venture/money/clients.ts';
import { clientPhone, PHONE_REFUSED } from '../runtime/venture/clients/phone.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { code, owner, setup } from './venture-views-env.ts';
import { CONTACTS, net, personNamed } from './venture-network-env.ts';

const stored = (env: Awaited<ReturnType<typeof setup>>, id: string) => listRecords(env.store.read(), 'venture-client').find(item => item.id === id)!;

test('an Indian business: "98765 43210" is kept as typed and opens WhatsApp at 919876543210', async () => {
  const env = await setup();
  const made = await addClient(env.deps, owner, { name: 'Cafe Aroma Demo', phone: ' 98765 43210 ' });
  assert.deepEqual([made.phone, made.whatsapp], ['98765 43210', '919876543210']);
  assert.deepEqual([stored(env, made.id).phone, stored(env, made.id).whatsapp], ['98765 43210', '919876543210']);
  const abroad = await addClient(env.deps, owner, { name: 'London Tea Rooms', countryCode: 'GB', phone: '+44 20 7946 0000' });
  assert.equal(abroad.whatsapp, '442079460000', 'a number with + keeps its own code');
  const without = await addClient(env.deps, owner, { name: 'No Phone Ltd' });
  assert.ok(!('phone' in without) && !('whatsapp' in without), 'absent means none: no new keys on a client without one');
});

test('anything that is not a phone number is refused in plain words', async () => {
  const env = await setup();
  for (const bad of ['12', 'call me', '98765 43210 ext 4', '+0 123 4567', '1234567890123456789'])
    await assert.rejects(addClient(env.deps, owner, { name: 'Bad Number Co', phone: bad }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST' && error.message === PHONE_REFUSED, bad);
  assert.equal(listRecords(env.store.read(), 'venture-client').length, 0, 'nothing was written');
});

test('the country rules: a leading 0 goes, a code already typed is kept, 00 is the international prefix', () => {
  assert.equal(clientPhone('098765 43210', 'IN').whatsapp, '919876543210');
  assert.equal(clientPhone('91 98765 43210', 'IN').whatsapp, '919876543210');
  assert.equal(clientPhone('(415) 555-0100', 'US').whatsapp, '14155550100');
  assert.equal(clientPhone('020 7946 0000', 'GB').whatsapp, '442079460000');
  assert.equal(clientPhone('0044 20 7946 0000', 'IN').whatsapp, '442079460000');
  assert.throws(() => clientPhone('98765 43210', 'XX'), code('INVALID_VENTURE_REQUEST'), 'elsewhere needs the + and the code');
  assert.equal(clientPhone('+971 50 123 4567', 'XX').whatsapp, '971501234567');
});

test('an edit goes through the evidence ledger and the history, and works out the WhatsApp digits again', async () => {
  const env = await setup();
  const made = await addClient(env.deps, owner, { name: 'Cafe Aroma Demo', email: 'hello@aroma.example' });
  await assert.rejects(net(env, 'venture.crm.client.edit', { clientId: made.id, field: 'phone', value: 'not a number' }), code('INVALID_VENTURE_REQUEST'));
  env.advance(60_000);
  const edited = await net<ClientCrmView>(env, 'venture.crm.client.edit', { clientId: made.id, field: 'phone', value: '98765 43210' });
  assert.deepEqual([edited.history[0].field, edited.history[0].line, edited.history[0].after], ['phone', 'You set Phone or WhatsApp', '98765 43210']);
  assert.deepEqual([stored(env, made.id).phone, stored(env, made.id).whatsapp], ['98765 43210', '919876543210']);
  const evidence = listRecords(env.store.read(), 'venture-evidence').filter(item => item.subject === `client:${made.id}` && item.field === 'phone' && item.applied);
  assert.deepEqual(evidence.map(item => [item.value, item.type]), [['98765 43210', 'owner-entered']]);
  await net(env, 'venture.crm.client.edit', { clientId: made.id, field: 'phone', value: '+44 20 7946 0000' });
  assert.equal(stored(env, made.id).whatsapp, '442079460000');
});

test('Forget leaves no number: not on the client, not in the evidence, not in the history', async () => {
  const env = await setup();
  const asha = await addClient(env.deps, owner, { name: 'Asha Rao', email: 'asha@dewdrop.example', phone: '99001 22334' });
  await net(env, 'venture.crm.client.edit', { clientId: asha.id, field: 'phone', value: '99001 22335' });
  await net(env, 'venture.network.import', { kind: 'contacts-csv', name: 'contacts.csv', text: CONTACTS });
  const person = personNamed(env, 'Asha Rao');
  assert.equal(person.clientId, asha.id);
  await net(env, 'venture.network.forget', { id: person.id });
  const client: ClientRecord = stored(env, asha.id);
  assert.ok(client, 'the client record stays in Clients');
  assert.equal(client.phone ?? null, null);
  assert.equal(client.whatsapp ?? null, null);
  const text = JSON.stringify(env.store.read().conversations);
  for (const digits of ['99001 22334', '99001 22335', '919900122334', '919900122335']) assert.ok(!text.includes(digits), `${digits} is still kept`);
});

test("an invoice's WhatsApp share opens the client's own chat when the client has a number; without one, as before", async () => {
  const { goalBusiness } = await import('./venture-goals-helpers.ts');
  const env = await goalBusiness();
  const issue = async () => {
    const order = await env.money<any>('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Close the month of books.' });
    const draft = await env.money<any>('venture.invoice.prepare', { orderId: order.id });
    return env.money<any>('venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
  };
  const before = await issue();
  const plain = await env.money<any>('venture.invoice.pdf', { invoiceId: before.invoice.id });
  assert.ok(plain.share.whatsappUrl.startsWith('https://wa.me/?text='), 'no number, no chat');
  await net(env, 'venture.crm.client.edit', { clientId: env.client.id, field: 'phone', value: '98765 43210' });
  const file = await env.money<any>('venture.invoice.pdf', { invoiceId: before.invoice.id });
  assert.ok(file.share.whatsappUrl.startsWith('https://wa.me/919876543210?text='), file.share.whatsappUrl);
  assert.equal(file.share.text, plain.share.text, 'the words are the same');
});
