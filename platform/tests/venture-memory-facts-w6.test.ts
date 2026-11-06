// Wave 6 package 6G4 (D44): dated memory. A fact carries since when it is true, what it replaced, its source and who
// may see it. A replaced fact is kept, marked replaced and linked to its successor, never deleted; Forget erases every
// version's words; Forget of a person erases the facts about them. A fact from AI is labelled so and starts as the
// owner's only; an AI caller reads only current facts its owner lets an AI read, and an AI job reads them as background.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { ClientRecord, VentureDeps, VentureMethod } from '../runtime/venture/contracts.ts';
import type { MemoryChange, MemoryView } from '../runtime/venture/memory/facts-data.ts';
import { handlers } from '../runtime/venture/agents/index.ts';
import { addClient } from '../runtime/venture/money/clients.ts';
import { jobMemory } from '../runtime/venture/agent-runtime/job-memory.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';
import { CONTACTS, net, personNamed } from './venture-network-env.ts';

const ai: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp', sourceTainted: true };
function mem<T>(env: Env, method: VentureMethod, payload: unknown = {}, ctx: Context = owner): Promise<T> {
  const handler = (handlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)[method];
  assert.ok(handler, `no agents handler for ${method}`);
  return handler(env.deps, ctx, payload) as Promise<T>;
}
const add = (env: Env, payload: Record<string, unknown>, ctx: Context = owner) => mem<MemoryChange>(env, 'venture.memory.add', payload, ctx);
async function consent(env: Env, clientId: string) {
  await ventureAction(env.deps, owner, 'admin', 'seed.consent', tx => {
    const client = tx.find('venture-client', clientId)!;
    tx.replace<ClientRecord>({ ...client, aiConsent: { id: 'consent_1', revision: 1, digest: 'd', grantedAt: tx.now, grantedBy: 'owner', withdrawnAt: null } as unknown as ClientRecord['aiConsent'] });
  });
}

test('a fact carries since when, its source and who may see it; a topic is kept once', async () => {
  const env = await setup();
  await assert.rejects(add(env, { subject: 'business', topic: 'Hourly rate', text: 'x' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(add(env, { subject: 'business', topic: 'Hourly rate', text: 'Rs 1500 an hour', since: '2026-12-01' }), code('INVALID_VENTURE_REQUEST'), 'never a day after today');
  await assert.rejects(add(env, { subject: 'person:x', topic: 'Hourly rate', text: 'Rs 1500 an hour' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(add(env, { subject: 'business', topic: 'Card', text: 'Pay with 4111 1111 1111 1111' }), code('CHAT_KEY_REFUSED'));
  const kept = await add(env, { subject: 'business', topic: 'Hourly rate', text: 'Rs 1500 an hour for bookkeeping.', since: '2026-09-01' });
  assert.deepEqual(
    [kept.fact?.topic, kept.fact?.since, kept.fact?.source, kept.fact?.sourceLine, kept.fact?.visibility, kept.fact?.current, kept.fact?.replaces],
    ['Hourly rate', '2026-09-01', 'owner', 'You told Chausar.', 'ai', true, null],
  );
  const dated = await add(env, { subject: 'business', topic: 'Office hours', text: 'Weekdays 10 to 6.', visibility: 'owner' });
  assert.deepEqual([dated.fact?.since, dated.fact?.visibility, dated.fact?.visibilityLine], ['2026-10-15', 'owner', 'Only you see this.'], 'since defaults to today');
  await assert.rejects(add(env, { subject: 'business', topic: 'hourly  RATE', text: 'Rs 1800 an hour.' }), code('FACT_EXISTS'));
  const view = await mem<MemoryView>(env, 'venture.memory.list', {});
  assert.deepEqual(view.facts.map(fact => fact.topic), ['Office hours', 'Hourly rate'], 'newest since first');
});

test('replacing keeps the old fact, marked replaced and linked to its successor; it is never deleted', async () => {
  const env = await setup();
  const first = (await add(env, { subject: 'business', topic: 'Hourly rate', text: 'Rs 1500 an hour.', since: '2026-09-01' })).fact!;
  await assert.rejects(mem(env, 'venture.memory.replace', { factId: first.id, text: 'Rs 1800 an hour.', since: '2026-08-01' }), code('INVALID_VENTURE_REQUEST'), 'never before what it replaces');
  await assert.rejects(mem(env, 'venture.memory.replace', { factId: first.id, text: 'Rs 1500 an hour.', since: '2026-09-01' }), code('INVALID_VENTURE_REQUEST'));
  env.advance(1000);
  const change = await mem<MemoryChange>(env, 'venture.memory.replace', { factId: first.id, text: 'Rs 1800 an hour.', since: '2026-10-01' });
  assert.deepEqual([change.fact?.replaces, change.fact?.since, change.fact?.topic, change.replaced?.replacedBy, change.replaced?.current], [first.id, '2026-10-01', 'Hourly rate', change.fact?.id, false]);
  await assert.rejects(mem(env, 'venture.memory.replace', { factId: first.id, text: 'Rs 2000 an hour.' }), code('FACT_REPLACED'));
  const view = await mem<MemoryView>(env, 'venture.memory.list', { subject: 'business' });
  assert.deepEqual(view.facts.map(fact => fact.text), ['Rs 1800 an hour.']);
  assert.deepEqual(view.earlier.map(fact => [fact.text, fact.replacedBy, fact.replacedAt]), [['Rs 1500 an hour.', change.fact?.id, env.now()]]);
  assert.equal(listRecords(env.store.read(), 'venture-memory-fact').length, 2, 'both versions are stored');
});

test('a fact from AI is labelled so and starts as the owner\'s only; an AI reads only current facts it may see', async () => {
  const env = await setup();
  const client = await addClient(env.deps, owner, { name: 'Cafe Aroma Demo' });
  await add(env, { subject: 'business', topic: 'Hourly rate', text: 'Rs 1500 an hour.' });
  await add(env, { subject: 'business', topic: 'Office hours', text: 'Weekdays 10 to 6.', visibility: 'owner' });
  await add(env, { subject: `client:${client.id}`, topic: 'Best time', text: 'Calls after 4 pm.' });
  await assert.rejects(add(env, { subject: 'business', topic: 'Guess', text: 'Busy in March.', visibility: 'ai' }, ai), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(add(env, { subject: `client:${client.id}`, topic: 'Guess', text: 'Busy in March.' }, ai), code('CLIENT_AI_CONSENT_REQUIRED'));
  const guessed = await add(env, { subject: 'business', topic: 'Busy season', text: 'March is the busiest month.' }, ai);
  assert.deepEqual([guessed.fact?.source, guessed.fact?.sourceLine, guessed.fact?.visibility], ['ai', 'From AI. You have not checked it.', 'owner']);

  const seen = await mem<MemoryView>(env, 'venture.memory.list', {}, ai);
  assert.deepEqual(seen.facts.map(fact => fact.topic), ['Hourly rate'], 'not the owner-only facts, not the client without permission, not the AI guess');
  assert.deepEqual(seen.earlier, []);
  await consent(env, client.id);
  assert.deepEqual((await mem<MemoryView>(env, 'venture.memory.list', {}, ai)).facts.map(fact => fact.topic).sort(), ['Best time', 'Hourly rate']);

  await assert.rejects(mem(env, 'venture.memory.visibility', { factId: guessed.fact!.id, visibility: 'ai' }, ai), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(mem(env, 'venture.memory.visibility', { factId: guessed.fact!.id, visibility: 'ai' }, phone), code('APP_APPROVAL_REQUIRED'));
  const shown = await mem<MemoryChange>(env, 'venture.memory.visibility', { factId: guessed.fact!.id, visibility: 'ai' });
  assert.equal(shown.fact?.visibilityLine, 'Your AI can read this.');
  assert.ok((await mem<MemoryView>(env, 'venture.memory.list', {}, ai)).facts.some(fact => fact.topic === 'Busy season'));

  const owners = (await mem<MemoryView>(env, 'venture.memory.list', {})).facts.find(fact => fact.topic === 'Hourly rate')!;
  await assert.rejects(mem(env, 'venture.memory.replace', { factId: owners.id, text: 'Rs 900 an hour.' }, ai), code('APP_APPROVAL_REQUIRED'), 'an AI never replaces the owner\'s fact');
  const redone = await mem<MemoryChange>(env, 'venture.memory.replace', { factId: shown.fact!.id, text: 'March and April are the busiest.' }, ai);
  assert.deepEqual([redone.fact?.source, redone.fact?.visibility], ['ai', 'owner'], 'an AI rewrite goes back to the owner\'s only');
});

test('an AI job reads the business facts and its own client\'s that an AI may see, as background', async () => {
  const env = await setup();
  const aroma = await addClient(env.deps, owner, { name: 'Cafe Aroma Demo' });
  const other = await addClient(env.deps, owner, { name: 'Someone Else' });
  await consent(env, aroma.id);
  await consent(env, other.id);
  await add(env, { subject: 'business', topic: 'Hourly rate', text: 'Rs 1500 an hour.' });
  await add(env, { subject: 'business', topic: 'Private', text: 'Only for me.', visibility: 'owner' });
  await add(env, { subject: `client:${aroma.id}`, topic: 'Best time', text: 'Calls after 4 pm.' });
  await add(env, { subject: `client:${other.id}`, topic: 'Best time', text: 'Never mornings.' });
  const state = env.store.read();
  const order = { id: 'order_x', clientId: aroma.id, request: 'Close the books' } as never;
  const memory = jobMemory(state, env.venture, order, { steps: [] } as never, 'Bookkeeping', []) as { facts?: { background: true; items: { topic: string; text: string }[] } };
  assert.deepEqual(memory.facts?.background, true);
  assert.deepEqual(memory.facts?.items.map(item => item.text).sort(), ['Calls after 4 pm.', 'Rs 1500 an hour.']);
});

test('Forget erases the words of a fact and every version of it; Forget of a person erases the facts about them', async () => {
  const env = await setup();
  const first = (await add(env, { subject: 'business', topic: 'Hourly rate', text: 'Rs 1500 an hour.', since: '2026-09-01' })).fact!;
  const second = (await mem<MemoryChange>(env, 'venture.memory.replace', { factId: first.id, text: 'Rs 1800 an hour.' })).fact!;
  await assert.rejects(mem(env, 'venture.memory.forget', { factId: first.id }, phone), code('APP_APPROVAL_REQUIRED'));
  const gone = await mem<MemoryChange>(env, 'venture.memory.forget', { factId: first.id });
  assert.match(gone.line, /2 versions/);
  const stored = listRecords(env.store.read(), 'venture-memory-fact');
  assert.ok(!JSON.stringify(stored).includes('1500') && !JSON.stringify(stored).includes('1800'), 'no version keeps its words');
  assert.deepEqual(stored.map(fact => [fact.id, fact.replacedBy, fact.replaces]), [[first.id, second.id, null], [second.id, null, first.id]], 'the dates and links stay');
  const view = await mem<MemoryView>(env, 'venture.memory.list', {});
  assert.deepEqual([view.facts, view.earlier.map(fact => fact.erased)], [[], [true, true]]);

  const asha = await addClient(env.deps, owner, { name: 'Asha Rao', email: 'asha@dewdrop.example' });
  await net(env, 'venture.network.import', { kind: 'contacts-csv', name: 'contacts.csv', text: CONTACTS });
  await add(env, { subject: `client:${asha.id}`, topic: 'Best time', text: 'Mornings only.' });
  await add(env, { subject: 'business', topic: 'Referrals', text: 'Asha Rao sends us cafes.' });
  await add(env, { subject: 'business', topic: 'Office hours', text: 'Weekdays 10 to 6.' });
  await net(env, 'venture.network.forget', { id: personNamed(env, 'Asha Rao').id });
  const left = listRecords(env.store.read(), 'venture-memory-fact').filter(fact => fact.erasedAt === null);
  assert.deepEqual(left.map(fact => fact.topic), ['Office hours']);
  assert.ok(!/asha/i.test(JSON.stringify(listRecords(env.store.read(), 'venture-memory-fact'))));
});
