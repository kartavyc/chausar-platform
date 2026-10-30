// Ink v2 wave 5, package 5A2: the honest exit at intake (catalogue P4, from QuantumByte's disqualification skill, ideas
// only). Code decides first whether an ask is in, partly or outside what a kit playbook does, from the playbook's own
// phrases in English and Hindi; a model's view, when asked, is only ever "model estimate: may be outside" and the owner
// picks. Outside gives one fixed reply and no follow-up is ever scheduled for that person (their card goes to Not now
// for "outside scope", with no day to ask again). Partly makes the order for the in-scope part only and lists the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BlueprintRecord, ClientRecord, OrderRecord } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { createOrder } from '../runtime/venture/money/orders.ts';
import { cardsOf, nextStepOf } from '../runtime/venture/network/pipeline.ts';
import { localDayAt } from '../runtime/venture/local-day.ts';
import { MODEL_SCOPE_WORDS, kitDefinitionOf, parkOutsideScope, scopeOf } from '../runtime/venture/playbooks/kit/exit.ts';
import { FIXTURE, FIXTURE_HI } from './venture-kit-sales-fixture.ts';
import { add, cardById, days, followupRowsOf, recordSent, withPeople } from './venture-pipeline-env.ts';
import { owner, seedBlueprint, setup, type Env } from './venture-views-env.ts';

const hi = (en: string) => FIXTURE_HI[en] ?? null;
const OUTSIDE_REPLY = 'This is outside what we do. We can help with bookkeeping, bank reconciliation and gst returns. For website, a web designer or a lawyer near you can help.';

test('code decides in, partly or outside from the playbook\'s own phrases, in English and Hindi; no phrase leaves it to the owner', () => {
  assert.deepEqual(scopeOf(FIXTURE, 'Please do my bookkeeping and bank reconciliation for October.'), {
    verdict: 'in', inPart: ['bookkeeping', 'bank reconciliation'], rest: [], reply: null, by: 'code',
  });
  assert.deepEqual(scopeOf(FIXTURE, 'I need a new website and a logo design.'), {
    verdict: 'outside', inPart: [], rest: ['website', 'logo design'], by: 'code',
    reply: 'This is outside what we do. We can help with bookkeeping, bank reconciliation and gst returns. For website and logo design, a web designer or a lawyer near you can help.',
  });
  assert.deepEqual(scopeOf(FIXTURE, 'Can you do my Bookkeeping, and also legal advice on a lease?'), {
    verdict: 'partly', inPart: ['bookkeeping'], rest: ['legal advice'], by: 'code',
    reply: 'This is outside what we do. We can help with bookkeeping. For legal advice, a web designer or a lawyer near you can help.',
  });
  // Hindi asks match the playbook's Hindi phrases (and a nukta never hides a match).
  assert.equal(scopeOf(FIXTURE, 'मुझे वेबसाइट चाहिए', { hi }).verdict, 'outside');
  assert.deepEqual(scopeOf(FIXTURE, 'मेरा बहीखाता और कानूनी सलाह', { hi }).rest, ['legal advice']);
  assert.equal(scopeOf(FIXTURE, 'लोगो डिजाइन चाहिए', { hi }).verdict, 'outside');
  // A phrase inside a longer word is not a match ("websites" is, "webinar" and "ebookkeeping" are not).
  assert.equal(scopeOf(FIXTURE, 'I need two websites').verdict, 'outside');
  assert.equal(scopeOf(FIXTURE, 'Run my webinar ebookkeeping').verdict, 'unclear');
  assert.deepEqual(scopeOf(FIXTURE, 'Help me plan a wedding.'), { verdict: 'unclear', inPart: [], rest: [], reply: null, by: 'code' });
  // A model's view is never a decision: it is labelled, and the owner picks.
  assert.deepEqual(MODEL_SCOPE_WORDS, { outside: 'model estimate: may be outside', inside: 'model estimate: may fit' });
});

test('outside scope: the person\'s open card goes to Not now for "outside scope", and no follow-up is ever scheduled', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const card = (await add(env, asha)).card;
  const other = (await add(env, rahul)).card;
  const today = localDayAt(env.now(), env.venture.country);
  await recordSent(env, card.id, { on: today, channel: 'own-mailbox' });
  await recordSent(env, other.id, { on: today, channel: 'own-mailbox' });

  const parked = await ventureAction(env.deps, owner, 'prepare', 'test.exit', tx => parkOutsideScope(tx, { personId: asha.id }, owner.memberId));
  assert.equal(parked.length, 1);
  const stored = cardById(env, card.id);
  assert.equal(stored.stage, 'not-now');
  assert.equal(stored.askAgainFrom, null, 'no day to ask again');
  assert.deepEqual(stored.history.at(-1)!.evidence, { kind: 'owner', id: null, line: 'Not now: outside what you do. Chausar will not follow up.' });
  const read = cardsOf(env.store.read(), env.venture, today).find(item => item.id === card.id)!;
  assert.equal(nextStepOf(read), null);

  // Days later the other card is due a follow-up; the parked one never is.
  days(env, 12); // Tuesday 27 Oct, a sending day
  const rows = await followupRowsOf(env);
  assert.deepEqual(rows.map(row => row.id.split(':')[1]), [other.id], 'only the other card still follows up');
  // Parking again changes nothing: a closed card stays as it is.
  const again = await ventureAction(env.deps, owner, 'prepare', 'test.exit', tx => parkOutsideScope(tx, { personId: asha.id }, owner.memberId));
  assert.equal(again.length, 0);
});

async function kitBusiness(env: Env): Promise<{ blueprint: BlueprintRecord; client: ClientRecord }> {
  await ventureAction(env.deps, owner, 'admin', 'test.idea', tx => { tx.touch({ idea: 'A fixture bookkeeping desk for small shops in Pune.' }); });
  const blueprint = await seedBlueprint(env, { status: 'accepted' });
  const client = await ventureAction(env.deps, owner, 'prepare', 'test.client', tx => tx.put<ClientRecord>({
    ...tx.base('venture-client'), name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null,
  }));
  return { blueprint, client };
}

test('at order intake: partly makes the order for the in-scope part and lists the rest on it; outside makes none', async () => {
  const env = await setup();
  const { client } = await kitBusiness(env);
  assert.equal(kitDefinitionOf(listRecords(env.store.read(), 'venture-record')[0], [FIXTURE])?.registration.id, FIXTURE.registration.id);
  assert.equal(kitDefinitionOf(env.venture, [FIXTURE]), null, 'the bookkeeping idea alone picks no kit playbook');
  const order = await createOrder(env.deps, owner, { clientId: client.id, offerId: 'offer_1', request: 'October bookkeeping, and a new website for the cafe.' }, { definitions: [FIXTURE] });
  assert.deepEqual(order.outOfScope, {
    rest: ['website'],
    reply: 'This is outside what we do. We can help with bookkeeping. For website, a web designer or a lawyer near you can help.',
  });
  assert.equal(order.request, 'October bookkeeping, and a new website for the cafe.', 'the client\'s words stay as they were');

  await assert.rejects(createOrder(env.deps, owner, { clientId: client.id, offerId: 'offer_1', request: 'A new website for the cafe.' }, { definitions: [FIXTURE] }), (error: any) => {
    assert.equal(error.code, 'OUTSIDE_SCOPE');
    assert.equal(error.message, OUTSIDE_REPLY);
    return true;
  });
  assert.equal(listRecords(env.store.read(), 'venture-order').length, 1, 'outside made no order');

  // In scope, or unclear, the order is made as before, with nothing listed.
  const plain = await createOrder(env.deps, owner, { clientId: client.id, offerId: 'offer_1', request: 'Please close my September books.' }, { definitions: [FIXTURE] });
  assert.equal((plain as OrderRecord).outOfScope, undefined);
  // A business no kit playbook runs is never checked.
  const env2 = await setup();
  const seeded = await seedBlueprint(env2, { status: 'accepted' });
  assert.ok(seeded);
  const other = await ventureAction(env2.deps, owner, 'prepare', 'test.client', tx => tx.put<ClientRecord>({
    ...tx.base('venture-client'), name: 'Cafe Aroma Demo', email: null, countryCode: 'IN', taxId: null, stateCode: '27', note: null,
  }));
  const free = await createOrder(env2.deps, owner, { clientId: other.id, offerId: 'offer_1', request: 'A new website for the cafe.' }, { definitions: [FIXTURE] });
  assert.equal(free.outOfScope, undefined);
});
