import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { hash, type Context, type State } from '../runtime/contracts.ts';
import { OntologyService, type DictionaryDraft } from '../runtime/ontology.ts';
import { Vault } from '../runtime/vault.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const syntheticPassphrase = 'Synthetic publication fixture passphrase only';
const fixturePrefix = 'chausar-ontology-publication-';

async function fixture(t: TestContext, dictionaryMode?: 'legacy' | 'deferred') {
  const root = await realpath(tmpdir());
  const directory = await mkdtemp(join(root, fixturePrefix));
  const created = await Vault.create({ directory, name: 'Synthetic dictionary publication', storage: 'experimental-file', passphrase: syntheticPassphrase,
    ...(dictionaryMode === undefined ? {} : { dictionaryMode }) });
  let vault = created.vault;
  t.after(async () => {
    await vault.close();
    const target = await realpath(directory), child = relative(root, target);
    assert.ok(child.startsWith(fixturePrefix) && !child.startsWith('..') && !isAbsolute(child) && !child.includes('/'), 'Remove only this exact synthetic temp fixture.');
    await rm(target, { recursive: true, force: true });
  });
  return {
    directory,
    get vault() { return vault; },
    get ontology() { return new OntologyService(vault); },
    async reopen() {
      await vault.close();
      vault = await Vault.open({ directory, storage: 'experimental-file', passphrase: syntheticPassphrase });
    },
    async recover() {
      await vault.close();
      vault = await Vault.recover({ directory, storage: 'experimental-file', recoveryCode: created.recoveryCode, newPassphrase: syntheticPassphrase });
    },
    authorityBytes() { return readFile(join(directory, 'authority.encrypted.json')); },
  };
}

function draft(f: Awaited<ReturnType<typeof fixture>>, pack = 'ecommerce'): DictionaryDraft {
  return f.ontology.packs().find(item => item.pack === pack)!;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

async function holdQueue(f: Awaited<ReturnType<typeof fixture>>) {
  const entered = deferred(), released = deferred();
  const held = f.vault.snapshot(async () => { entered.resolve(); await released.promise; });
  await entered.promise;
  return { release: released.resolve, held };
}

function assertNoPublication(state: State) {
  assert.equal(state.ontology?.current ?? (state.ontology?.operations ? state.ontology : null), null);
  assert.deepEqual(state.ontology?.history ?? [], []);
  assert.equal(state.learning.filter(item => item.category === 'dictionary').length, 0);
  assert.equal(state.activity.filter(item => item.event === 'dictionary.published').length, 0);
}

test('deferred first-run marker survives reopen and requires an explicit empty baseline with a retained reviewed attempt', async t => {
  const f = await fixture(t, 'deferred');
  assert.equal(f.vault.read().revision, 0);
  assert.equal(JSON.parse((await f.authorityBytes()).toString()).revision, 0, 'The initial encrypted commit already retains deferred mode.');
  assert.deepEqual(f.vault.read().ontology, { current: null, history: [], firstRunReviewRequired: true });
  assertNoPublication(f.vault.read());
  await f.reopen();
  assert.deepEqual(f.vault.read().ontology, { current: null, history: [], firstRunReviewRequired: true });
  const before = f.vault.read(), bytes = await f.authorityBytes();
  await assert.rejects(f.ontology.publish(owner, 'ecommerce'), { code: 'DICTIONARY_REVIEW_REQUIRED' });
  await assert.rejects(f.ontology.publish(owner, draft(f), { expectedCurrentHash: null }), { code: 'DICTIONARY_REVIEW_REQUIRED' });
  await assert.rejects(f.ontology.publish(owner, draft(f), { expectedCurrentHash: '0'.repeat(64), attemptId: 'wrong_first_baseline' }), { code: 'DICTIONARY_REVIEW_REQUIRED' });
  assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.authorityBytes(), bytes);
  const published = await f.ontology.publish(owner, draft(f), { expectedCurrentHash: null, attemptId: 'explicit_first_review' });
  assert.equal(published.version, 1);
  assert.equal(f.vault.read().revision, 1);
  assert.equal(Object.hasOwn(f.vault.read().ontology, 'firstRunReviewRequired'), false);
  assert.equal(f.vault.read().learning.filter(item => item.category === 'dictionary').length, 1);
  assert.equal(f.vault.read().activity.filter(item => item.event === 'dictionary.published').length, 1);
});

test('Vault creation rejects explicit invalid dictionary modes and deferred demo mode before touching existing authority', async t => {
  const f = await fixture(t), before = f.vault.read(), bytes = await f.authorityBytes();
  const cases: Record<string, unknown>[] = [
    { dictionaryMode: undefined }, { dictionaryMode: null }, { dictionaryMode: 'forged_mode' },
    { dictionaryMode: 'deferred', demo: true }, { dictionaryMode: 'deferred', demo: 'false' },
  ];
  for (const options of cases) await assert.rejects(Vault.create({
    directory: f.directory, name: 'Synthetic invalid dictionary mode', storage: 'experimental-file', passphrase: syntheticPassphrase, ...options,
  } as never), { code: 'INVALID_DICTIONARY_MODE' });
  assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.authorityBytes(), bytes);
});

test('fresh encrypted authority remains unpublished after reopen and explicit reviewed publication starts at version one', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.ontology.get(owner, {}), { current: null, history: [] });
  assertNoPublication(f.vault.read());
  await f.reopen();
  assert.deepEqual(f.ontology.get(owner, {}), { current: null, history: [] });
  assertNoPublication(f.vault.read());
  const reviewed = draft(f);
  const published = await f.ontology.publish(owner, reviewed, { expectedCurrentHash: null, attemptId: 'first_reviewed_publish' });
  assert.equal(published.version, 1);
  assert.equal(published.publishedBy, owner.memberId);
  assert.deepEqual(f.ontology.get(owner, {}), { current: published, history: [published] });
  assert.equal(f.vault.read().learning.filter(item => item.category === 'dictionary').length, 1);
  assert.equal(f.vault.read().activity.filter(item => item.event === 'dictionary.published').length, 1);
  await f.reopen();
  assert.deepEqual(f.ontology.get(owner, {}), { current: published, history: [published] });
});

test('stale reviewed hash refuses before compilation and leaves all authority bytes and side effects unchanged', async t => {
  const f = await fixture(t);
  const reviewed = await f.ontology.publish(owner, draft(f), { expectedCurrentHash: null, attemptId: 'reviewed_baseline' });
  const winner = await f.ontology.publish(owner, draft(f, 'retail'), { expectedCurrentHash: reviewed.hash, attemptId: 'newer_publication' });
  await f.vault.update(state => {
    state.answers.push({ id: 'synthetic_answer', stale: false });
    state.receipts.push({ id: 'synthetic_receipt', stale: false });
  });
  const before = f.vault.read(), bytes = await f.authorityBytes();
  const invalid = draft(f); invalid.definitions[0].meaning = 'short';
  await assert.rejects(f.ontology.publish(owner, invalid, { expectedCurrentHash: reviewed.hash, attemptId: 'stale_review_attempt' }), { code: 'DICTIONARY_CONFLICT' });
  assert.deepEqual(f.vault.read(), before);
  assert.deepEqual(await f.authorityBytes(), bytes);
  assert.deepEqual(f.ontology.get(owner, { attemptId: 'stale_review_attempt' }), { current: winner, history: before.ontology.history, attempt: null });
});

test('serialized competing submissions against one reviewed hash commit one publication and one exact attempt', async t => {
  const f = await fixture(t), reviewed = draft(f);
  const h0 = await f.ontology.publish(owner, reviewed, { expectedCurrentHash: null, attemptId: 'concurrent_baseline' });
  const before = f.vault.read(), queue = await holdQueue(f);
  const winning = f.ontology.publish(owner, reviewed, { expectedCurrentHash: h0.hash, attemptId: 'concurrent_winner' });
  const invalid = structuredClone(reviewed); invalid.definitions[0].meaning = 'short';
  const losing = assert.rejects(f.ontology.publish(owner, invalid, { expectedCurrentHash: h0.hash, attemptId: 'concurrent_stale' }), { code: 'DICTIONARY_CONFLICT' });
  queue.release(); await queue.held;
  const publication = await winning; await losing;
  const after = f.vault.read();
  assert.equal(publication.version, 2);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.ontology.history.length, before.ontology.history.length + 1);
  assert.equal(after.ontology.publicationAttempts.length, before.ontology.publicationAttempts.length + 1);
  assert.equal(after.learning.length, before.learning.length + 1);
  assert.equal(after.activity.length, before.activity.length + 1);
  assert.equal(f.ontology.get(owner, { attemptId: 'concurrent_stale' }).attempt, null);
  assert.equal(f.ontology.get(owner, { attemptId: 'concurrent_winner' }).attempt?.dictionaryHash, publication.hash);
});

test('identical concurrent draft and actor do not attribute the other attempt from matching content', async t => {
  const f = await fixture(t), reviewed = draft(f), queue = await holdQueue(f);
  const first = f.ontology.publish(owner, reviewed, { expectedCurrentHash: null, attemptId: 'identical_first' });
  const other = assert.rejects(f.ontology.publish(owner, reviewed, { expectedCurrentHash: null, attemptId: 'identical_other' }), { code: 'DICTIONARY_CONFLICT' });
  queue.release(); await queue.held;
  const published = await first; await other;
  assert.equal(f.ontology.get(owner, { attemptId: 'identical_other' }).attempt, null);
  assert.equal(f.ontology.get(owner, { attemptId: 'identical_first' }).attempt?.dictionaryHash, published.hash);
  const later = await f.ontology.publish(owner, reviewed, { expectedCurrentHash: published.hash, attemptId: 'identical_later' });
  assert.equal(later.version, 2);
  assert.equal(f.ontology.get(owner, { attemptId: 'identical_first' }).attempt?.version, 1);
  assert.equal(f.ontology.get(owner, { attemptId: 'identical_later' }).attempt?.version, 2);
  assert.equal(f.vault.read().ontology.publicationAttempts.length, 2);
});

test('dropped publication response is recoverable only by exact durable receipt and idempotent readback after later publication', async t => {
  const f = await fixture(t), reviewed = draft(f);
  const options = { expectedCurrentHash: null, attemptId: 'lost_response_attempt' };
  await assert.rejects((async () => {
    await f.ontology.publish(owner, reviewed, options);
    throw new Error('Synthetic dropped publication response');
  })(), /Synthetic dropped publication response/);
  const original = f.ontology.current(owner)!;
  const expectedReceipt = {
    attemptId: options.attemptId, workspaceId: f.vault.read().workspace.id, memberId: owner.memberId, epoch: owner.epoch,
    draftDigest: hash(reviewed), expectedCurrentHash: null, dictionaryHash: original.hash, version: 1,
  };
  assert.deepEqual(f.ontology.get(owner, { attemptId: options.attemptId }).attempt, expectedReceipt);
  assert.deepEqual(f.vault.read().ontology.publicationAttempts, [expectedReceipt], 'Receipts retain identities and digests without another draft or dictionary copy.');
  const later = await f.ontology.publish(owner, reviewed, { expectedCurrentHash: original.hash, attemptId: 'later_identical_attempt' });
  const before = f.vault.read(), bytes = await f.authorityBytes();
  assert.deepEqual(await f.ontology.publish(owner, reviewed, options), original);
  assert.deepEqual(f.vault.read(), before);
  assert.deepEqual(await f.authorityBytes(), bytes);
  assert.deepEqual(f.ontology.get(owner, { attemptId: options.attemptId }), { current: later, history: [original, later], attempt: expectedReceipt });
  assert.deepEqual(f.ontology.get(owner, {}), { current: later, history: [original, later] });
  assert.equal(f.ontology.get(owner, { attemptId: 'never_committed_attempt' }).attempt, null);
  await f.reopen();
  assert.deepEqual(f.ontology.get(owner, { attemptId: options.attemptId }).attempt, expectedReceipt);
  const reopenedBefore = f.vault.read(), reopenedBytes = await f.authorityBytes();
  assert.deepEqual(await f.ontology.publish(owner, reviewed, options), original);
  assert.deepEqual(f.vault.read(), reopenedBefore);
  assert.deepEqual(await f.authorityBytes(), reopenedBytes);
});

test('queued duplicate attempt returns the original dictionary with one durable publication and no duplicate writes', async t => {
  const f = await fixture(t), reviewed = draft(f), options = { expectedCurrentHash: null, attemptId: 'queued_same_attempt' };
  const before = f.vault.read(), queue = await holdQueue(f);
  const first = f.ontology.publish(owner, reviewed, options), duplicate = f.ontology.publish(owner, reviewed, options);
  queue.release(); await queue.held;
  const [published, readback] = await Promise.all([first, duplicate]);
  assert.deepEqual(readback, published);
  const after = f.vault.read();
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.ontology.history.length, 1);
  assert.equal(after.ontology.publicationAttempts.length, 1);
  assert.equal(after.learning.length, 1);
  assert.equal(after.activity.length, 1);
});

test('missing receipt during a queued request can subsequently commit and is not proof of non-publication', async t => {
  const f = await fixture(t), queue = await holdQueue(f);
  const pending = f.ontology.publish(owner, draft(f), { expectedCurrentHash: null, attemptId: 'still_pending_attempt' });
  assert.deepEqual(f.ontology.get(owner, { attemptId: 'still_pending_attempt' }), { current: null, history: [], attempt: null });
  queue.release(); await queue.held;
  const published = await pending;
  assert.equal(f.ontology.get(owner, { attemptId: 'still_pending_attempt' }).attempt?.dictionaryHash, published.hash);
});

test('publish snapshots context draft and options before queued work', async t => {
  const f = await fixture(t), reviewed = draft(f), unchangedDraft = structuredClone(reviewed);
  const context = { ...owner }, options: { expectedCurrentHash: string | null; attemptId: string } = { expectedCurrentHash: null, attemptId: 'snapshot_original_attempt' };
  const queue = await holdQueue(f);
  const pending = f.ontology.publish(context, reviewed, options);
  context.memberId = 'untrusted_replacement'; context.role = 'viewer'; context.epoch = 999;
  reviewed.label = 'Mutated after submission'; reviewed.definitions[0].meaning = 'Changed after the exact reviewed request entered its queue.';
  options.expectedCurrentHash = '0'.repeat(64); options.attemptId = 'snapshot_mutated_attempt';
  queue.release(); await queue.held;
  const publication = await pending;
  assert.equal(publication.label, unchangedDraft.label);
  assert.equal(publication.definitions[0].meaning, unchangedDraft.definitions[0].meaning);
  assert.equal(publication.publishedBy, owner.memberId);
  const receipt = f.ontology.get(owner, { attemptId: 'snapshot_original_attempt' }).attempt!;
  assert.equal(receipt.draftDigest, hash(unchangedDraft));
  assert.equal(receipt.expectedCurrentHash, null);
  assert.equal(receipt.memberId, owner.memberId);
  assert.equal(receipt.epoch, owner.epoch);
  assert.equal(f.ontology.get(owner, { attemptId: 'snapshot_mutated_attempt' }).attempt, null);
});

test('authorization is rechecked inside publication after queued revocation epoch change and role change', async t => {
  for (const change of ['inactive', 'epoch', 'role'] as const) await t.test(change, async sub => {
    const f = await fixture(sub), entered = deferred(), released = deferred();
    const revocation = f.vault.update(async state => {
      entered.resolve(); await released.promise;
      if (change === 'inactive') state.members[0].active = false;
      if (change === 'epoch') state.members[0].epoch++;
      if (change === 'role') state.members[0].role = 'viewer';
    });
    await entered.promise;
    const rejected = assert.rejects(f.ontology.publish(owner, draft(f), { expectedCurrentHash: null, attemptId: `revoked_${change}` }), { code: 'ACCESS_REVOKED' });
    released.resolve(); await revocation; await rejected;
    const state = f.vault.read();
    assert.equal(state.revision, 1, 'Only the prior revocation transaction can commit.');
    assertNoPublication(state);
  });
});

test('attempt authority remains bound to exact actor and epoch, while valid cofounders can publish their own attempts', async t => {
  const f = await fixture(t), reviewed = draft(f);
  const cofounder: Context = { memberId: 'cofounder', role: 'cofounder', epoch: 1 };
  await f.vault.update(state => { state.members.push({ id: cofounder.memberId, role: cofounder.role, epoch: cofounder.epoch, name: 'Synthetic cofounder', active: true, branches: ['*'] }); });
  const original = await f.ontology.publish(owner, reviewed, { expectedCurrentHash: null, attemptId: 'owner_bound_attempt' });
  const before = f.vault.read(), bytes = await f.authorityBytes();
  assert.throws(() => f.ontology.get(cofounder, { attemptId: 'owner_bound_attempt' }), { code: 'DICTIONARY_ATTEMPT_AUTHORITY' });
  await assert.rejects(f.ontology.publish(cofounder, reviewed, { expectedCurrentHash: null, attemptId: 'owner_bound_attempt' }), { code: 'DICTIONARY_ATTEMPT_AUTHORITY' });
  assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.authorityBytes(), bytes);
  const own = await f.ontology.publish(cofounder, reviewed, { expectedCurrentHash: original.hash, attemptId: 'cofounder_own_attempt' });
  assert.equal(own.publishedBy, cofounder.memberId);
  await f.vault.update(state => { state.members[0].epoch++; });
  const currentOwner = { ...owner, epoch: 2 }, epochBefore = f.vault.read(), epochBytes = await f.authorityBytes();
  assert.throws(() => f.ontology.get(owner, { attemptId: 'owner_bound_attempt' }), { code: 'ACCESS_REVOKED' });
  assert.throws(() => f.ontology.get(currentOwner, { attemptId: 'owner_bound_attempt' }), { code: 'DICTIONARY_ATTEMPT_AUTHORITY' });
  await assert.rejects(f.ontology.publish(currentOwner, reviewed, { expectedCurrentHash: null, attemptId: 'owner_bound_attempt' }), { code: 'DICTIONARY_ATTEMPT_AUTHORITY' });
  assert.deepEqual(f.vault.read(), epochBefore); assert.deepEqual(await f.authorityBytes(), epochBytes);
});

test('same attempt with changed exact draft or baseline refuses without changing history audit learning or ciphertext', async t => {
  const f = await fixture(t), reviewed = draft(f), options = { expectedCurrentHash: null, attemptId: 'immutable_attempt' };
  const original = await f.ontology.publish(owner, reviewed, options), before = f.vault.read(), bytes = await f.authorityBytes();
  const changed = structuredClone(reviewed); changed.label = 'A different exact draft';
  await assert.rejects(f.ontology.publish(owner, changed, options), { code: 'DICTIONARY_ATTEMPT_REUSED' });
  await assert.rejects(f.ontology.publish(owner, reviewed, { ...options, expectedCurrentHash: original.hash }), { code: 'DICTIONARY_ATTEMPT_REUSED' });
  const reordered = { definitions: reviewed.definitions, fields: reviewed.fields, gstMode: reviewed.gstMode, currency: reviewed.currency, label: reviewed.label, pack: reviewed.pack };
  await assert.rejects(f.ontology.publish(owner, reordered, options), { code: 'DICTIONARY_ATTEMPT_REUSED' });
  assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.authorityBytes(), bytes);
});

test('publication options and exact attempt lookup reject forged unknown inherited and executable properties before any write', async t => {
  const f = await fixture(t), reviewed = draft(f), before = f.vault.read(), bytes = await f.authorityBytes();
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, 'expectedCurrentHash', { enumerable: true, get() { getterCalls++; return null; } });
  const hidden = Object.defineProperty({}, 'expectedCurrentHash', { enumerable: false, value: null });
  const symbolic = { expectedCurrentHash: null, [Symbol('forged')]: true };
  const cases: unknown[] = [
    null, [], new Date(), Object.create({ expectedCurrentHash: null }), accessor, hidden, symbolic,
    { expectedCurrentHash: null, actor: owner }, { expectedCurrentHash: undefined }, { expectedCurrentHash: 'A'.repeat(64) },
    { expectedCurrentHash: '0'.repeat(63) }, { expectedCurrentHash: 0 }, { attemptId: 'missing_baseline' },
    { expectedCurrentHash: null, attemptId: '' }, { expectedCurrentHash: null, attemptId: 'unsafe/id' },
    { expectedCurrentHash: null, attemptId: 'a'.repeat(129) }, { expectedCurrentHash: null, attemptId: 7 },
  ];
  for (const options of cases) await assert.rejects(f.ontology.publish(owner, reviewed, options as never), { code: 'INVALID_DICTIONARY_OPTIONS' });
  const requestAccessor = Object.defineProperty({}, 'attemptId', { enumerable: true, get() { getterCalls++; return 'forged_lookup'; } });
  const requests: unknown[] = [null, [], new Date(), Object.create({ attemptId: 'inherited_lookup' }), requestAccessor,
    { attemptId: 'safe_lookup', memberId: 'owner' }, { attemptId: undefined }, { attemptId: 'unsafe/id' },
    { attemptId: 'safe_lookup', [Symbol('forged')]: true }, Object.defineProperty({}, 'attemptId', { value: 'hidden_lookup' })];
  for (const request of requests) assert.throws(() => f.ontology.get(owner, request as never), { code: 'INVALID_DICTIONARY_OPTIONS' });
  assert.equal(getterCalls, 0, 'Validation never invokes forged property getters.');
  assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.authorityBytes(), bytes);
});

test('forged draft properties are refused without executing getters or retaining executable values', async t => {
  const f = await fixture(t), before = f.vault.read(), bytes = await f.authorityBytes();
  let getterCalls = 0;
  const accessor = draft(f);
  Object.defineProperty(accessor, 'label', { enumerable: true, get() { getterCalls++; return 'Forged label'; } });
  await assert.rejects(f.ontology.publish(owner, accessor, { expectedCurrentHash: null, attemptId: 'forged_draft_getter' }), { code: 'INVALID_DICTIONARY' });
  const executable = { ...draft(f), label: (() => 'Forged executable label') as unknown as string };
  await assert.rejects(f.ontology.publish(owner, executable, { expectedCurrentHash: null, attemptId: 'forged_draft_function' }), { code: 'INVALID_DICTIONARY' });
  const inherited = Object.assign(Object.create({ hiddenAuthority: owner }), draft(f));
  await assert.rejects(f.ontology.publish(owner, inherited, { expectedCurrentHash: null, attemptId: 'forged_draft_prototype' }), { code: 'INVALID_DICTIONARY' });
  assert.equal(getterCalls, 0);
  assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.authorityBytes(), bytes);
});

test('legacy omitted CAS remains distinct from explicit null and pack requests retain legacy publication behavior', async t => {
  const f = await fixture(t);
  const first = await f.ontology.publish(owner, 'ecommerce');
  assert.equal(first.version, 1);
  const second = await f.ontology.publish(owner, 'retail', {});
  assert.equal(second.version, 2);
  const before = f.vault.read(), bytes = await f.authorityBytes();
  await assert.rejects(f.ontology.publish(owner, 'services', { expectedCurrentHash: null }), { code: 'DICTIONARY_CONFLICT' });
  assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.authorityBytes(), bytes);
  assert.deepEqual(f.ontology.get(owner, {}), { current: second, history: [first, second] });
  assert.deepEqual(f.vault.read().ontology.publicationAttempts ?? [], []);
});

test('synthetic recovery preserves durable publication receipts original history and exact retry attribution', async t => {
  const f = await fixture(t), reviewed = draft(f), options = { expectedCurrentHash: null, attemptId: 'recovered_exact_attempt' };
  const first = await f.ontology.publish(owner, reviewed, options);
  const second = await f.ontology.publish(owner, draft(f, 'services'), { expectedCurrentHash: first.hash, attemptId: 'recovered_later_attempt' });
  const before = f.vault.read(), receipt = f.ontology.get(owner, { attemptId: options.attemptId }).attempt;
  await f.recover();
  assert.equal(f.vault.read().revision, before.revision + 1);
  assert.deepEqual(f.vault.read().ontology, before.ontology);
  assert.deepEqual(f.ontology.get(owner, { attemptId: options.attemptId }), { current: second, history: [first, second], attempt: receipt });
  const recoveredBefore = f.vault.read(), bytes = await f.authorityBytes();
  assert.deepEqual(await f.ontology.publish(owner, reviewed, options), first);
  assert.deepEqual(f.vault.read(), recoveredBefore); assert.deepEqual(await f.authorityBytes(), bytes);
  await f.reopen();
  assert.deepEqual(f.ontology.get(owner, { attemptId: options.attemptId }).attempt, receipt);
});

test('malformed retained evidence refuses exact lookup and publication without repairing or writing authority', async t => {
  const mutations: { name: string; mutate(state: State): void }[] = [
    { name: 'unknown receipt field', mutate(state) { state.ontology.publicationAttempts[0].forgedAuthority = true; } },
    { name: 'duplicate attempt identity', mutate(state) { state.ontology.publicationAttempts.push(structuredClone(state.ontology.publicationAttempts[0])); } },
    { name: 'missing dictionary history', mutate(state) { state.ontology.history = []; } },
    { name: 'missing history collection', mutate(state) { delete state.ontology.history; } },
    { name: 'duplicate dictionary history entry', mutate(state) { state.ontology.history.push(structuredClone(state.ontology.history[0])); } },
    { name: 'tampered dictionary content', mutate(state) { state.ontology.history[0].label = 'Tampered retained label'; } },
    { name: 'mismatched exact draft digest', mutate(state) { state.ontology.publicationAttempts[0].draftDigest = '0'.repeat(64); } },
    { name: 'mismatched dictionary hash', mutate(state) { state.ontology.publicationAttempts[0].dictionaryHash = '0'.repeat(64); } },
    { name: 'mismatched dictionary version', mutate(state) { state.ontology.publicationAttempts[0].version = 2; } },
    { name: 'different workspace origin', mutate(state) { state.ontology.publicationAttempts[0].workspaceId = 'synthetic_other_workspace'; } },
    { name: 'invalid retained epoch', mutate(state) { state.ontology.publicationAttempts[0].epoch = 0; } },
    { name: 'invalid reviewed hash encoding', mutate(state) { state.ontology.publicationAttempts[0].expectedCurrentHash = 'A'.repeat(64); } },
    { name: 'noncollection attempt evidence', mutate(state) { state.ontology.publicationAttempts = {}; } },
    { name: 'null retained attempt', mutate(state) { state.ontology.publicationAttempts[0] = null; } },
    { name: 'dictionary actor differs from receipt actor', mutate(state) {
      const dictionary = state.ontology.history[0];
      dictionary.publishedBy = 'synthetic_other_actor';
      dictionary.hash = hash(Object.fromEntries(Object.entries(dictionary).filter(([key]) => key !== 'hash')));
      state.ontology.publicationAttempts[0].dictionaryHash = dictionary.hash;
    } },
  ];
  for (const mutation of mutations) await t.test(mutation.name, async sub => {
    const f = await fixture(sub), reviewed = draft(f), options = { expectedCurrentHash: null, attemptId: 'malformed_retained_attempt' };
    await f.ontology.publish(owner, reviewed, options);
    await f.vault.update(mutation.mutate);
    await f.reopen();
    const before = f.vault.read(), bytes = await f.authorityBytes();
    assert.throws(() => f.ontology.get(owner, { attemptId: options.attemptId }), { code: 'INVALID_DICTIONARY_RECEIPT' });
    assert.throws(() => f.ontology.get(owner, { attemptId: 'another_exact_attempt' }), { code: 'INVALID_DICTIONARY_RECEIPT' });
    await assert.rejects(f.ontology.publish(owner, reviewed, options), { code: 'INVALID_DICTIONARY_RECEIPT' });
    await assert.rejects(f.ontology.publish(owner, 'retail'), { code: 'INVALID_DICTIONARY_RECEIPT' });
    assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.authorityBytes(), bytes);
  });
});
