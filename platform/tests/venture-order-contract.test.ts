// Ink v2 wave 4 (4J12, H24): the per-order contract. For an offer marked contract: 'required' (a fixture: no shipped
// plan sets it in W4), a run is refused ORDER_CONTRACT_UNSIGNED until the owner signs the newest revision. A contract
// holds a goal, scope, constraints, protected items the engine enforces, deliverables with done by stage, and
// acceptance checks with stable ids. Done needs evidence, skipped needs a reason, only the auditor reopens. An agent
// may propose scope and check changes, never the goal, constraints, protections or deliverables. Revisions append.
// The contract records what the owner agreed; it never changes a price.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { OrderContract, OrderContractRecord } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { acceptedBlueprint } from '../runtime/venture/delivery/shared.ts';
import { contractChecks, markContractItem, protectedBreaks } from '../runtime/venture/money/order-contracts.ts';
import { approveFromToday, business, code, owner, phone, PLAIN_IDEA } from './venture-judge-helpers.ts';
import { agentBusiness, askingRun, TEST_CARD } from './venture-agent-helpers.ts';
import type { PersonRecord } from '../runtime/venture/contracts.ts';
import { handlers as networkHandlers } from '../runtime/venture/network/index.ts';
import { ERASED_NAMED } from '../runtime/venture/agents/notes.ts';

const agent: Context = { ...owner, channel: 'mcp' };
const REQUEST = 'Please look at my pricing for the new product line and advise.';

const contract = (extra: Partial<OrderContract> = {}): OrderContract => ({
  goal: 'Advise on the prices of the new product line.',
  scope: ['The new product line only.'],
  constraints: ['Spend no more than the run cap.', 'Ask before anything goes to the client.'],
  protected: [{ kind: 'phrase', value: 'before the work starts' }],
  deliverables: [{ id: 'advice', what: 'A short pricing note', stage: 'draft', doneWhen: 'The draft passed its checks and you approved it.' }],
  checks: [{ id: 'prices-from-list', what: 'Every price comes from your price list.' }],
  ...extra,
});

/** A plan-of-pricing business whose first offer needs a signed contract, and one order on that offer. */
async function contractBusiness(required = true) {
  const env = await business(PLAIN_IDEA);
  if (required) await requireContract(env);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: REQUEST });
  return { ...env, order };
}
/** Marks the accepted plan's first offer as needing a signed contract (a fixture: no shipped plan does). */
async function requireContract(env: { deps: Awaited<ReturnType<typeof business>>['deps'] }): Promise<void> {
  await ventureAction(env.deps, owner, 'approve', 'seed.contract', tx => {
    const plan = acceptedBlueprint(tx.state, tx.venture!);
    tx.replace({ ...plan, offers: plan.offers.map(offer => (offer.id === 'offer_1' ? { ...offer, contract: 'required' as const } : offer)) });
  });
}
type Env = Awaited<ReturnType<typeof contractBusiness>>;
const revisions = (env: Env): OrderContractRecord[] => listRecords(env.store.read(), 'venture-order-contract').sort((a, b) => a.revision - b.revision);
const runs = (env: Env) => listRecords(env.store.read(), 'venture-delivery-run');

test('order contract: an order on an offer with no contract runs as before and has none', async () => {
  const env = await contractBusiness(false);
  assert.equal(await env.call('venture.order.contract', { orderId: env.order.id }), null);
  const waiting = await env.call('venture.delivery.run', { orderId: env.order.id });
  assert.equal(waiting.status, 'waiting-for-you');
});

test('order contract: a required contract refuses the run until the owner signs the newest revision', async () => {
  const env = await contractBusiness();
  await assert.rejects(env.call('venture.delivery.run', { orderId: env.order.id }), code('ORDER_CONTRACT_UNSIGNED'));
  assert.equal(runs(env).length, 0, 'a refused run stores nothing');
  const proposed = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract() });
  assert.equal(proposed.revision, 1);
  assert.equal(proposed.signed, null);
  assert.equal(proposed.proposedBy, 'owner');
  assert.match(proposed.digest, /^[0-9a-f]{64}$/);
  assert.match(proposed.line, /sign/i);
  await assert.rejects(env.call('venture.delivery.run', { orderId: env.order.id }), code('ORDER_CONTRACT_UNSIGNED'));
  // Signing binds to what the owner saw, inside the app.
  await assert.rejects(env.call('venture.order.contract.sign', { orderId: env.order.id, digest: '0'.repeat(64) }), code('APPROVAL_STALE'));
  await assert.rejects(env.call('venture.order.contract.sign', { orderId: env.order.id, digest: proposed.digest }, phone), code('APP_APPROVAL_REQUIRED'));
  const signed = await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: proposed.digest });
  assert.deepEqual(signed.signed, { at: signed.signed.at, by: 'owner' });
  assert.equal(signed.digest, proposed.digest);
  assert.deepEqual(await env.call('venture.order.contract', { orderId: env.order.id }), signed);
  const waiting = await env.call('venture.delivery.run', { orderId: env.order.id });
  assert.equal(waiting.status, 'waiting-for-you');
});

test('order contract: it records what the owner agreed and never changes a price', async () => {
  const env = await contractBusiness();
  const before = { order: listRecords(env.store.read(), 'venture-order')[0], receipts: listRecords(env.store.read(), 'venture-price-receipt') };
  // A contract has exactly its six fields: a price can't ride in on one.
  await assert.rejects(env.call('venture.order.contract.propose', { orderId: env.order.id, contract: { ...contract(), price: '500' } }), code('INVALID_VENTURE_REQUEST'));
  const proposed = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract() });
  await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: proposed.digest });
  const after = { order: listRecords(env.store.read(), 'venture-order')[0], receipts: listRecords(env.store.read(), 'venture-price-receipt') };
  assert.deepEqual(after, before);
});

test('order contract: an agent may propose scope and check changes only; revisions append and need signing again', async () => {
  const env = await contractBusiness();
  // The first revision is the owner's.
  await assert.rejects(env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract() }, agent), code('CONTRACT_FIELD_LOCKED'));
  const first = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract() });
  await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: first.digest });
  for (const [name, change] of [
    ['goal', { goal: 'Rewrite the whole price list.' }],
    ['constraints', { constraints: ['Spend what it takes.'] }],
    ['protections', { protected: [] }],
    ['deliverables', { deliverables: [{ id: 'advice', what: 'A long report', stage: 'draft', doneWhen: 'Whenever.' }] }],
    ['a dropped check', { checks: [] }],
  ] as [string, Partial<OrderContract>][]) {
    await assert.rejects(env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract(change) }, agent), code('CONTRACT_FIELD_LOCKED'), name);
  }
  const refined = contract({
    scope: ['The new product line only.', 'Compare with last season.'],
    checks: [{ id: 'prices-from-list', what: 'Every price comes from your price list, with its receipt.' }, { id: 'season-compared', what: 'Last season is named.' }],
  });
  const second = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: refined }, agent);
  assert.equal(second.revision, 2);
  assert.equal(second.proposedBy, 'agent');
  assert.equal(second.signed, null);
  assert.match(second.line, /agent/i);
  // Revision 1 is still stored as it was, signed.
  const stored = revisions(env);
  assert.equal(stored.length, 2);
  assert.deepEqual(stored[0].contract, contract());
  assert.ok(stored[0].signedAt);
  // Until the owner signs revision 2, no run starts.
  await assert.rejects(env.call('venture.delivery.run', { orderId: env.order.id }), code('ORDER_CONTRACT_UNSIGNED'));
  await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: second.digest });
  assert.equal((await env.call('venture.delivery.run', { orderId: env.order.id })).status, 'waiting-for-you');
});

test('order contract: each field is checked, ids are stable and stages are the order\'s own', async () => {
  const env = await contractBusiness();
  const broken: [string, unknown][] = [
    ['no goal', contract({ goal: '' })],
    ['no scope', contract({ scope: [] })],
    ['a check id that is not one', contract({ checks: [{ id: 'Prices From List', what: 'x' }] })],
    ['two checks with one id', contract({ checks: [{ id: 'a', what: 'One.' }, { id: 'a', what: 'Two.' }] })],
    ['a deliverable and a check with one id', contract({ checks: [{ id: 'advice', what: 'One.' }] })],
    ['a stage this order does not have', contract({ deliverables: [{ id: 'advice', what: 'A note', stage: 'episode', doneWhen: 'Approved.' }] })],
    ['an unknown protected kind', contract({ protected: [{ kind: 'price' as any, value: '500' }] })],
    ['a key in the words', contract({ constraints: [`Use ${'sk_' + 'live_' + 'a'.repeat(24)}`] })],
    ['not an object', 'Do the work'],
  ];
  for (const [name, value] of broken) {
    await assert.rejects(env.call('venture.order.contract.propose', { orderId: env.order.id, contract: value }), code('INVALID_VENTURE_REQUEST'), name);
  }
  await assert.rejects(env.call('venture.order.contract.propose', { orderId: 'order_missing', contract: contract() }), code('ORDER_NOT_FOUND'));
  assert.equal(revisions(env).length, 0);
});

test('order contract: done needs evidence, skipped needs a reason, only the auditor reopens, and marks carry over', async () => {
  const env = await contractBusiness();
  const mark = (input: Parameters<typeof markContractItem>[2]) => ventureAction(env.deps, owner, 'prepare', 'test.mark', tx => markContractItem(tx, env.order.id, input));
  const first = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract() });
  // Work is marked only under a signed contract.
  await assert.rejects(mark({ itemId: 'advice', state: 'done', evidence: 'Run checks passed.', by: 'agent' }), code('ORDER_CONTRACT_UNSIGNED'));
  await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: first.digest });
  await assert.rejects(mark({ itemId: 'advice', state: 'done', by: 'agent' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(mark({ itemId: 'prices-from-list', state: 'skipped', by: 'agent' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(mark({ itemId: 'nothing', state: 'done', evidence: 'Some proof.', by: 'agent' }), code('INVALID_VENTURE_REQUEST'));
  await mark({ itemId: 'advice', state: 'done', evidence: 'The draft passed its checks; receipt rcpt_1.', by: 'agent' });
  await mark({ itemId: 'prices-from-list', state: 'skipped', reason: 'The client sent no price list.', by: 'agent' });
  await assert.rejects(mark({ itemId: 'advice', state: 'done', evidence: 'Again.', by: 'agent' }), code('INVALID_VENTURE_REQUEST'));
  for (const by of ['agent', 'owner'] as const) await assert.rejects(mark({ itemId: 'advice', state: 'reopened', by }), code('CONTRACT_FIELD_LOCKED'), by);
  let view = await env.call('venture.order.contract', { orderId: env.order.id });
  assert.deepEqual(view.items, [
    { id: 'advice', kind: 'deliverable', state: 'done', evidence: 'The draft passed its checks; receipt rcpt_1.', reason: null },
    { id: 'prices-from-list', kind: 'check', state: 'skipped', evidence: null, reason: 'The client sent no price list.' },
  ]);
  await mark({ itemId: 'advice', state: 'reopened', reason: 'The client asked for more.', by: 'auditor' });
  // A new revision keeps the marks of the items it keeps; a new check starts open.
  const refined = contract({ checks: [...contract().checks, { id: 'season-compared', what: 'Last season is named.' }] });
  await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: refined }, agent);
  view = await env.call('venture.order.contract', { orderId: env.order.id });
  assert.deepEqual(view.items.map((item: any) => `${item.id}:${item.state}`), ['advice:open', 'prices-from-list:skipped', 'season-compared:open']);
  // The signed digest covers the contract, not the marks.
  assert.equal(revisions(env)[0].digest, first.digest);
});

test('order contract: a draft that changes a protected phrase or file fails its checks', () => {
  const agreed = contract({ protected: [{ kind: 'phrase', value: 'Prices exclude GST.' }, { kind: 'file', value: 'brand.pdf' }] });
  const files = [{ name: 'brand.pdf', digests: ['a'.repeat(64)] }];
  assert.deepEqual(protectedBreaks(agreed, files, { text: 'Our advice. Prices exclude GST.', files: [{ name: 'brand.pdf', digest: 'a'.repeat(64) }] }), []);
  const changed = protectedBreaks(agreed, files, { text: 'Our advice. prices exclude gst', files: [{ name: 'brand.pdf', digest: 'b'.repeat(64) }] });
  assert.deepEqual(changed.map(item => `${item.kind}:${item.value}:${item.how}`), ['phrase:Prices exclude GST.:changed', 'file:brand.pdf:changed']);
  const gone = protectedBreaks(agreed, files, { text: 'Our advice.', files: [] });
  assert.deepEqual(gone.map(item => `${item.kind}:${item.how}`), ['phrase:missing', 'file:missing']);
});

test('order contract: the run\'s checks fail a draft that changed a protected phrase, and pass one that kept it', async () => {
  for (const [phrase, outcome] of [['Prices exclude GST.', 'fail'], ['before the work starts', 'pass']] as const) {
    const env = await contractBusiness();
    const proposed = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract({ protected: [{ kind: 'phrase', value: phrase }] }) });
    await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: proposed.digest });
    const waiting = await env.call('venture.delivery.run', { orderId: env.order.id });
    const ready = await approveFromToday(env, waiting.id);
    const stored = runs(env).find(run => run.id === ready.id)!;
    const own = (stored.playbookChecks ?? []).filter(item => item.playbook === 'contract');
    assert.deepEqual(own.map(item => `${item.check}:${item.outcome}`), [`protected:${outcome}`], phrase);
    // The same check, read from the records alone.
    const state = env.store.read();
    assert.equal(contractChecks(state, listRecords(state, 'venture-record')[0], env.order.id, { text: stored.renderedText ?? '', files: [] })[0].outcome, outcome);
  }
});

test('order contract: Today asks the owner to sign an unsigned contract, and the row goes once signed', async () => {
  const env = await contractBusiness();
  const notice = async () => (await env.call('venture.queue.list')).rows.filter((row: any) => row.kind === 'notice' && row.id.startsWith('contract:'));
  assert.equal((await notice()).length, 1, 'a required contract not yet written waits on the owner');
  const proposed = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract() });
  const rows = await notice();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].actions.map((action: any) => action.id).sort(), ['later', 'open']);
  await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: proposed.digest });
  assert.equal((await notice()).length, 0);
});

test('order contract: the same contract again returns the unsigned revision, but after signing it is a new one to sign', async () => {
  const env = await contractBusiness();
  const first = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract() });
  const again = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract() });
  assert.deepEqual([again.revision, again.digest], [1, first.digest]);
  await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: first.digest });
  const after = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract() });
  assert.equal(after.revision, 2);
  assert.equal(after.signed, null);
  assert.equal(revisions(env).length, 2);
});

test('order contract: signing again refreshes the protected files\' digests', async () => {
  const env = await contractBusiness();
  const upload = (text: string) => env.call('venture.files.add', { orderId: env.order.id, name: 'brand.txt', contentBase64: Buffer.from(text, 'utf8').toString('base64') });
  await upload('Our brand words.');
  const proposed = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract({ protected: [{ kind: 'file', value: 'brand.txt' }] }) });
  const signed = await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: proposed.digest });
  const now = () => { const state = env.store.read(); return contractChecks(state, listRecords(state, 'venture-record')[0], env.order.id, { text: '' })[0].outcome; };
  assert.equal(now(), 'pass');
  await upload('Our new brand words.');
  assert.equal(now(), 'fail', 'a changed protected file fails until the owner signs again');
  env.setNow('2026-10-21T11:00:00.000Z');
  const again = await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: proposed.digest });
  assert.equal(now(), 'pass');
  assert.equal(again.digest, signed.digest);
  assert.notEqual(again.signed.at, signed.signed.at);
});

test('order contract: a protected phrase holds no digits, and an agent\'s proposal never carries an id number', async () => {
  const env = await contractBusiness();
  await assert.rejects(env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract({ protected: [{ kind: 'phrase', value: 'Prices exclude 18% GST.' }] }) }), code('INVALID_VENTURE_REQUEST'));
  const first = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract() });
  await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: first.digest });
  const withCard = contract({ scope: ['The new product line only.', `Charge the card ${TEST_CARD} for samples.`] });
  await assert.rejects(env.call('venture.order.contract.propose', { orderId: env.order.id, contract: withCard }, agent), code('INVALID_VENTURE_REQUEST'));
  assert.equal(revisions(env).length, 1);
});

test('order contract: approve, answer and resume check the contract again before the run goes on', async () => {
  // Approve: a run made before the offer needed a contract does not send its next step without one.
  const env = await contractBusiness(false);
  const waiting = await env.call('venture.delivery.run', { orderId: env.order.id });
  await requireContract(env);
  await assert.rejects(env.call('venture.delivery.approve', { runId: waiting.id, digest: waiting.preview.digest }), code('ORDER_CONTRACT_UNSIGNED'));
  assert.equal(runs(env).find(run => run.id === waiting.id)!.status, 'waiting-for-you', 'nothing was sent');
  // Resume: a stopped run stays stopped.
  const other = await contractBusiness(false);
  const run = await other.call('venture.delivery.run', { orderId: other.order.id });
  await other.call('venture.runs.stop', { runId: run.id });
  await requireContract(other);
  await assert.rejects(other.call('venture.runs.resume', { runId: run.id }), code('ORDER_CONTRACT_UNSIGNED'));
  // Answer: a run waiting on the owner's answer does not move on.
  const asking = await agentBusiness();
  const asked = await askingRun(asking);
  await requireContract(asking);
  await assert.rejects(asking.call('venture.delivery.answer', { runId: asked.id, answer: 'About ten minutes.' }), code('ORDER_CONTRACT_UNSIGNED'));
});

test('order contract: Forget of a person erases the contract words that name them (DPDP)', async () => {
  const env = await contractBusiness();
  const named = contract({ scope: ['The new product line only.', 'Meera Shah wants the prices first.'], checks: [{ id: 'asked-first', what: 'Ask Meera Shah before the draft goes.' }] });
  const proposed = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: named });
  await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: proposed.digest });
  await ventureAction(env.deps, owner, 'prepare', 'test.mark', tx => markContractItem(tx, env.order.id, { itemId: 'asked-first', state: 'done', evidence: 'Meera Shah said yes on the call.', by: 'agent' }));
  const person = await ventureAction(env.deps, owner, 'admin', 'seed.person', tx => tx.put<PersonRecord>({
    ...tx.base('venture-person'), name: 'Meera Shah', handles: { emails: [], phones: [], linkedinUrl: null }, role: null, roles: [], facts: [], hidden: false, clientId: null, history: [],
  }));
  await (networkHandlers as Record<string, (deps: unknown, ctx: unknown, payload: unknown) => Promise<unknown>>)['venture.network.forget'](env.deps, owner, { id: person.id });
  const [kept] = revisions(env);
  assert.ok(!/Meera/i.test(JSON.stringify(kept)), 'nothing of the contract names Meera');
  assert.equal(kept.contract.scope[1], ERASED_NAMED);
  assert.equal(kept.contract.scope[0], 'The new product line only.');
  assert.equal(kept.contract.checks[0].what, ERASED_NAMED);
  assert.equal(kept.marks![0].evidence, ERASED_NAMED);
  assert.equal(kept.digest, proposed.digest, 'the digest the owner signed stays');
});

test('order contract: after a Forget, a protected item that named them is dropped, and a later draft still passes (DPDP)', async () => {
  const env = await contractBusiness();
  const agreed = contract({ protected: [{ kind: 'phrase', value: 'before the work starts' }, { kind: 'phrase', value: 'Meera Shah signs off the prices' }, { kind: 'file', value: 'Meera Shah brief.txt' }] });
  const proposed = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: agreed });
  await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: proposed.digest });
  const person = await ventureAction(env.deps, owner, 'admin', 'seed.person', tx => tx.put<PersonRecord>({
    ...tx.base('venture-person'), name: 'Meera Shah', handles: { emails: [], phones: [], linkedinUrl: null }, role: null, roles: [], facts: [], hidden: false, clientId: null, history: [],
  }));
  await (networkHandlers as Record<string, (deps: unknown, ctx: unknown, payload: unknown) => Promise<unknown>>)['venture.network.forget'](env.deps, owner, { id: person.id });
  const [kept] = revisions(env);
  assert.deepEqual(kept.contract.protected, [{ kind: 'phrase', value: 'before the work starts' }]);
  assert.ok(!/Meera/i.test(JSON.stringify(kept)));
  // The next run's draft keeps what is still protected, so its contract check passes.
  const waiting = await env.call('venture.delivery.run', { orderId: env.order.id });
  const ready = await approveFromToday(env, waiting.id);
  const stored = runs(env).find(run => run.id === ready.id)!;
  assert.deepEqual((stored.playbookChecks ?? []).filter(item => item.playbook === 'contract').map(item => item.outcome), ['pass']);
});

test('order contract: a revision proposed while the approval is on its way stops it just before the send', async () => {
  const env = await contractBusiness();
  const proposed = await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract() });
  await env.call('venture.order.contract.sign', { orderId: env.order.id, digest: proposed.digest });
  const waiting = await env.call('venture.delivery.run', { orderId: env.order.id });
  // The approval's own read finds the contract signed; the first write after it (the journal entry for the send)
  // is followed by an agent's revision, so only the check inside send() can stop it.
  const update = env.store.update.bind(env.store);
  let armed = false;
  env.store.update = (async (change: any) => {
    const out = await update(change);
    if (armed) {
      armed = false;
      await env.call('venture.order.contract.propose', { orderId: env.order.id, contract: contract({ scope: ['The new product line only.', 'And the old one.'] }) }, agent);
    }
    return out;
  }) as typeof env.store.update;
  const sentBefore = env.models.sent;
  armed = true;
  await assert.rejects(env.call('venture.delivery.approve', { runId: waiting.id, digest: waiting.preview.digest }), code('ORDER_CONTRACT_UNSIGNED'));
  assert.equal(armed, false, 'the revision landed after the approval read the contract');
  assert.equal(env.models.sent, sentBefore, 'nothing was sent to the AI');
  assert.equal(revisions(env).at(-1)!.signedAt, null);
});
