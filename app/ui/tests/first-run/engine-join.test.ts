import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { validateUiContext } from '../../src/host/contracts.ts';
import { ATTEMPT_ID, FIRST_RUN_METHODS, validateOntologyAttemptReadback, validateOntologyReadback, validatePacks, validatePublished } from '../../src/screens/first-run/contracts.ts';
import type { FirstRunRpcPayloads } from '../../src/screens/first-run/contracts.ts';
import { createFirstRunController, handoffPinOf } from '../../src/screens/first-run/controller.ts';
import type { FirstRunController, FirstRunState, IssuanceEvent } from '../../src/screens/first-run/controller.ts';
import { allReviewed, pinOf } from '../../src/screens/first-run/review.ts';
import type { ReviewPin } from '../../src/screens/first-run/review.ts';
import { actualEngineJoin, ENGINE_JOIN_OWNER, engineJoinDeferred, engineJoinDigest, engineJoinGuard, engineJoinSha256 } from './engine-join.fixture.ts';
import type { EngineJoinFixture } from './engine-join.fixture.ts';

// Actual Engine dispatch and encrypted synthetic file Vault. These tests are
// direct port integration evidence, not desktop bridge or storage qualification.
const must = <T>(value: T | null | undefined): T => { assert.notEqual(value, null); assert.notEqual(value, undefined); return value!; };
const object = (value: unknown): Record<string, unknown> => {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
};
function state<K extends FirstRunState['kind']>(controller: FirstRunController, kind: K): Extract<FirstRunState, { kind: K }> {
  const value = controller.snapshot(); assert.equal(value.kind, kind);
  return value as Extract<FirstRunState, { kind: K }>;
}
async function settle(): Promise<void> { for (let index = 0; index < 32; index++) await Promise.resolve(); }
let sequence = 0;
async function ready(t: TestContext, pack = 'retail', fixture?: EngineJoinFixture) {
  const f = fixture ?? await actualEngineJoin(t), live = engineJoinGuard(), events: IssuanceEvent[] = [];
  const attemptId = `ui-engine-join-${++sequence}`;
  let identities = 0;
  const controller = createFirstRunController(f.port, {
    guard: live, digest: engineJoinDigest, createAttemptId: () => { identities++; return attemptId; },
  });
  controller.onIssuance(event => { events.push(event); });
  assert.deepEqual(await controller.load(), { ok: true });
  assert.deepEqual(controller.choosePack(pack), { ok: true }); await settle();
  const review = state(controller, 'review').review, pin = must(pinOf(review));
  for (const row of review.rows) assert.deepEqual(controller.acceptRow(row.definition.name, pin), { ok: true });
  assert.deepEqual(controller.acceptSettings(pin), { ok: true });
  assert.equal(allReviewed(state(controller, 'review').review), true);
  return { f, live, events, controller, pin, draft: structuredClone(review.draft), attemptId, identities: () => identities };
}
function submission(f: EngineJoinFixture): FirstRunRpcPayloads['ontology.publish'] {
  const call = must(f.calls.find(item => item.method === 'ontology.publish')), payload = object(call.payload);
  assert.deepEqual(Object.keys(payload), ['draft', 'expectedCurrentHash', 'attemptId']);
  assert.ok(typeof payload['attemptId'] === 'string' && ATTEMPT_ID.test(payload['attemptId']));
  assert.ok(payload['expectedCurrentHash'] === null || typeof payload['expectedCurrentHash'] === 'string');
  return payload as unknown as FirstRunRpcPayloads['ontology.publish'];
}
async function lookup(f: EngineJoinFixture, attemptId: string) {
  return validateOntologyAttemptReadback(await f.request('ontology.get', { attemptId }));
}
function neutral(controller: FirstRunController, secrets: readonly string[]): void {
  const value = state(controller, 'unknown'); assert.equal(value.attempt, null);
  assert.deepEqual(Object.keys(value).sort(), ['attempt', 'code', 'kind', 'reconciling']);
  const text = JSON.stringify(value);
  for (const secret of secrets) assert.equal(text.includes(secret), false, `Private value released: ${secret}`);
  assert.doesNotMatch(text, /[a-f0-9]{64}/);
}
function noForeignMethod(f: EngineJoinFixture): void {
  assert.ok(f.calls.every(call => FIRST_RUN_METHODS.includes(call.method)));
}
function dropCommittedReply(f: EngineJoinFixture): void {
  f.intercept(async (method, _payload, forward) => {
    if (method !== 'ontology.publish') return forward();
    f.intercept(null); await forward();
    throw new Error('Synthetic lost reply after the actual encrypted commit');
  });
}

test('actual Engine deferred first-run publishes exact reviewed bytes and returns the scoped eight-field receipt', async t => {
  const f = await actualEngineJoin(t), original = await f.ciphertext();
  assert.deepEqual(await f.request('ontology.get', {}), { current: null, history: [] });
  const r = await ready(t, 'retail', f);
  assert.deepEqual(await f.ciphertext(), original, 'Loading and accepting a review do not publish.');
  assert.equal(r.identities(), 0);
  assert.deepEqual(await r.controller.publishDictionary(r.pin), { ok: true });
  const sent = submission(f);
  assert.equal(sent.attemptId, r.attemptId); assert.equal(sent.expectedCurrentHash, null);
  assert.equal(JSON.stringify(sent.draft), JSON.stringify(r.draft));
  const found = await lookup(f, sent.attemptId), receipt = must(found.attempt), dictionary = must(found.current);
  assert.deepEqual(Object.keys(found), ['current', 'history', 'attempt']);
  assert.deepEqual(Object.keys(receipt), ['attemptId', 'workspaceId', 'memberId', 'epoch', 'draftDigest', 'expectedCurrentHash', 'dictionaryHash', 'version']);
  assert.equal(receipt.draftDigest, engineJoinSha256(JSON.stringify(structuredClone(sent.draft))));
  assert.equal(receipt.dictionaryHash, dictionary.hash); assert.equal(receipt.version, 1);
  assert.equal(receipt.memberId, 'owner'); assert.equal(receipt.epoch, 1);
  assert.equal(receipt.workspaceId, state(r.controller, 'published').context.workspace.id);
  assert.equal(r.identities(), 1); assert.equal(f.count('ontology.publish'), 1);
  assert.equal(JSON.stringify(r.controller.snapshot()).includes(r.attemptId), false);
  const published = state(r.controller, 'published'), departure = await r.controller.leave(handoffPinOf(published));
  assert.equal(departure.ok, true);
  if (!departure.ok) throw new Error('Expected Continue admission.');
  assert.equal(departure.admit()?.dictionary.hash, dictionary.hash); assert.equal(departure.admit(), null);
  assert.equal(r.controller.snapshot().kind, 'left'); noForeignMethod(f);
});

test('an accepted actual Engine publication queued behind a Vault snapshot stays unknown when its lookup is null', async t => {
  const r = await ready(t), queue = await r.f.holdVaultQueue();
  let accepted: Promise<unknown> | null = null;
  r.f.intercept(async (method, _payload, forward) => {
    if (method !== 'ontology.publish') return forward();
    r.f.intercept(null); accepted = r.f.track(forward());
    throw new Error('Synthetic reply lost while the accepted update is queued');
  });
  assert.deepEqual(await r.controller.publishDictionary(r.pin), { ok: false, code: 'PUBLISH_UNKNOWN' });
  const sent = submission(r.f);
  assert.deepEqual(await lookup(r.f, sent.attemptId), { current: null, history: [], attempt: null });
  assert.deepEqual(await r.controller.reconcile(), { ok: false, code: 'PUBLISH_UNKNOWN' });
  assert.equal(r.controller.issuance(), 'unresolved');
  assert.deepEqual(await r.controller.load(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  assert.deepEqual(r.controller.choosePack('services'), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  assert.deepEqual(await r.controller.publishDictionary(r.pin), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  assert.deepEqual(r.controller.dispose(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  r.controller.cancel();
  neutral(r.controller, [r.attemptId, r.draft.pack, r.draft.label, r.pin.digest]);
  // The parent retains this controller across a screen remount while unresolved.
  const unmount = r.controller.subscribe(() => {}); unmount();
  const remount = r.controller.subscribe(() => {});
  assert.deepEqual(await r.controller.load(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  queue.release(); await queue.drained; await must(accepted);
  const found = await lookup(r.f, sent.attemptId);
  assert.equal(found.attempt?.draftDigest, engineJoinSha256(JSON.stringify(r.draft)));
  assert.equal(found.attempt?.expectedCurrentHash, null);
  assert.deepEqual(await r.controller.reconcile(), { ok: true });
  assert.equal(state(r.controller, 'published').review, null);
  assert.equal(state(r.controller, 'published').published.hash, found.current?.hash);
  assert.equal(r.f.count('ontology.publish'), 1); assert.equal(r.identities(), 1);
  assert.equal(r.f.calls.filter(call => call.method === 'ontology.get').every(call => {
    const payload = object(call.payload); return !Object.hasOwn(payload, 'attemptId') || payload['attemptId'] === sent.attemptId;
  }), true);
  remount(); noForeignMethod(r.f);
});

test('a dropped reply after actual Engine commit is recovered by the own attempt receipt without a retry', async t => {
  const r = await ready(t); dropCommittedReply(r.f);
  assert.deepEqual(await r.controller.publishDictionary(r.pin), { ok: false, code: 'PUBLISH_UNKNOWN' });
  assert.equal(r.controller.issuance(), 'unresolved');
  const found = await lookup(r.f, r.attemptId); assert.ok(found.attempt); assert.ok(found.current);
  assert.deepEqual(await r.controller.reconcile(), { ok: true });
  assert.equal(state(r.controller, 'published').published.hash, found.current.hash);
  assert.equal(r.controller.issuance(), 'none'); assert.equal(r.f.count('ontology.publish'), 1);
  assert.deepEqual(r.events, [{ kind: 'issued' }, { kind: 'settled', outcome: 'unresolved' }, { kind: 'resolved', outcome: 'published' }]);
  noForeignMethod(r.f);
});

test('actual Engine CAS refuses a competing commit after the final context read; a generic failure remains unknown', async t => {
  await t.test('real competing publication', async sub => {
    const r = await ready(sub);
    r.f.intercept(async (method, _payload, forward) => {
      if (method !== 'ontology.publish') return forward();
      r.f.intercept(null);
      await r.f.request('ontology.publish', { draft: r.draft, expectedCurrentHash: null, attemptId: 'synthetic-competing-engine-review' });
      return forward();
    });
    assert.deepEqual(await r.controller.publishDictionary(r.pin), { ok: false, code: 'PUBLISH_REFUSED' });
    assert.deepEqual(state(r.controller, 'review').notice, { code: 'PUBLISH_REFUSED', engineCode: 'DICTIONARY_CONFLICT' });
    assert.equal(r.controller.issuance(), 'none');
    const found = await lookup(r.f, r.attemptId);
    assert.equal(found.attempt, null); assert.equal(found.history.length, 1);
    assert.deepEqual(r.events, [{ kind: 'issued' }, { kind: 'settled', outcome: 'not-committed' }]);
    assert.equal(r.f.count('ontology.publish'), 1); noForeignMethod(r.f);
  });
  await t.test('generic failure with a currently empty lookup', async sub => {
    const r = await ready(sub);
    r.f.intercept(async (method, _payload, forward) => {
      if (method !== 'ontology.publish') return forward();
      r.f.intercept(null); throw new Error('Synthetic unclassified transport failure');
    });
    assert.deepEqual(await r.controller.publishDictionary(r.pin), { ok: false, code: 'PUBLISH_UNKNOWN' });
    assert.deepEqual(await r.controller.reconcile(), { ok: false, code: 'PUBLISH_UNKNOWN' });
    assert.equal(r.controller.issuance(), 'unresolved');
    assert.deepEqual(await lookup(r.f, r.attemptId), { current: null, history: [], attempt: null });
    assert.deepEqual(await r.controller.publishDictionary(r.pin), { ok: false, code: 'PUBLISH_UNRESOLVED' });
    assert.equal(r.f.count('ontology.publish'), 1); noForeignMethod(r.f);
  });
});

test('actual Engine idempotency returns its historical commit while the controller refuses Continue for a newer current dictionary', async t => {
  const r = await ready(t); dropCommittedReply(r.f);
  assert.equal((await r.controller.publishDictionary(r.pin)).ok, false);
  const sent = submission(r.f), first = await lookup(r.f, sent.attemptId), firstDictionary = must(first.current);
  const later = validatePublished(await r.f.request('ontology.publish', {
    draft: r.draft, expectedCurrentHash: firstDictionary.hash, attemptId: 'synthetic-newer-engine-review',
  }));
  const ciphertext = await r.f.ciphertext(), authority = r.f.engine.vault?.read();
  assert.deepEqual(validatePublished(await r.f.request('ontology.publish', sent)), firstDictionary);
  assert.deepEqual(r.f.engine.vault?.read(), authority); assert.deepEqual(await r.f.ciphertext(), ciphertext);
  const historical = await lookup(r.f, sent.attemptId);
  assert.deepEqual(historical.attempt, first.attempt); assert.equal(historical.current?.hash, later.hash);
  assert.equal(historical.history.length, 2);
  assert.deepEqual(await r.controller.reconcile(), { ok: false, code: 'REVIEW_NOT_CURRENT' });
  assert.deepEqual(r.controller.snapshot(), { kind: 'unavailable', code: 'REVIEW_NOT_CURRENT' });
  assert.equal(r.controller.issuance(), 'none');
  const context = validateUiContext(await r.f.request('ui.context', {}));
  assert.deepEqual(await r.controller.leave({ hash: firstDictionary.hash, contextKey: context.contextKey, reviewDigest: r.pin.digest }), { ok: false, code: 'SELECTION_INVALID' });
  assert.equal(r.f.count('ontology.publish'), 1); noForeignMethod(r.f);
});

test('actual Engine receipt scope refuses another actor and a new epoch before releasing evidence', async t => {
  const r = await ready(t); dropCommittedReply(r.f);
  assert.equal((await r.controller.publishDictionary(r.pin)).ok, false);
  const sent = submission(r.f), found = await lookup(r.f, sent.attemptId); assert.ok(found.attempt);
  await r.f.request('members.add', { id: 'synthetic-other-owner', name: 'Synthetic other owner', role: 'owner', branches: ['*'] });
  const other = { ...ENGINE_JOIN_OWNER, memberId: 'synthetic-other-owner' };
  await assert.rejects(r.f.request('ontology.get', { attemptId: sent.attemptId }, other), { code: 'DICTIONARY_ATTEMPT_AUTHORITY' });
  await assert.rejects(r.f.request('ontology.publish', sent, other), { code: 'DICTIONARY_ATTEMPT_AUTHORITY' });
  assert.ok(r.f.engine.vault);
  await r.f.engine.vault.update(value => {
    const authority = object(value), members = authority['members']; assert.ok(Array.isArray(members));
    const member = object(must(members.find(item => object(item)['id'] === 'owner')));
    member['epoch'] = 2;
  });
  const renewed = { ...ENGINE_JOIN_OWNER, epoch: 2 };
  await assert.rejects(r.f.request('ontology.get', { attemptId: sent.attemptId }, renewed), { code: 'DICTIONARY_ATTEMPT_AUTHORITY' });
  await assert.rejects(r.f.request('ontology.publish', sent, renewed), { code: 'DICTIONARY_ATTEMPT_AUTHORITY' });
  assert.deepEqual(await r.controller.reconcile(), { ok: false, code: 'ACCESS_DENIED' });
  neutral(r.controller, [r.attemptId, r.draft.label, r.draft.pack, r.pin.digest]);
  assert.equal(r.controller.issuance(), 'unresolved'); noForeignMethod(r.f);
});

test('altering one scope field of an actual receipt never attributes that publication to this UI attempt', async t => {
  // Adversarial replies are mutations of a real DTO; no substitute receipt schema is invented.
  for (const [field, replacement, code] of [
    ['workspaceId', 'workspace_foreign_synthetic', 'READBACK_MISMATCH'],
    ['memberId', 'synthetic_other_actor', 'INVALID_REPLY'],
    ['epoch', 2, 'READBACK_MISMATCH'],
    ['attemptId', 'synthetic_other_attempt', 'READBACK_MISMATCH'],
    ['draftDigest', 'a'.repeat(64), 'READBACK_MISMATCH'],
    ['expectedCurrentHash', 'b'.repeat(64), 'READBACK_MISMATCH'],
    ['dictionaryHash', 'c'.repeat(64), 'INVALID_REPLY'],
    ['version', 2, 'INVALID_REPLY'],
  ] as const) await t.test(field, async sub => {
    const r = await ready(sub); dropCommittedReply(r.f);
    assert.equal((await r.controller.publishDictionary(r.pin)).ok, false);
    r.f.intercept(async (method, _payload, forward) => {
      const reply = await forward();
      if (method !== 'ontology.get') return reply;
      const forged = object(structuredClone(reply)), receipt = object(forged['attempt']);
      receipt[field] = replacement;
      return forged;
    });
    assert.deepEqual(await r.controller.reconcile(), { ok: false, code });
    assert.equal(r.controller.issuance(), 'unresolved'); assert.equal(r.controller.snapshot().kind, 'unknown');
    r.f.intercept(null);
    assert.deepEqual(await r.controller.reconcile(), { ok: true });
    assert.equal(r.f.count('ontology.publish'), 1); noForeignMethod(r.f);
  });
});

test('a later actual Engine lookup refusal cannot prove that the earlier publication did not commit', async t => {
  const f = await actualEngineJoin(t);
  await f.request('members.add', { id: 'synthetic-other-owner', name: 'Synthetic other owner', role: 'owner', branches: ['*'] });
  const r = await ready(t, 'retail', f); dropCommittedReply(f);
  assert.deepEqual(await r.controller.publishDictionary(r.pin), { ok: false, code: 'PUBLISH_UNKNOWN' });
  f.intercept(async (method, payload, forward) => method === 'ontology.get'
    ? f.request(method, payload, { ...ENGINE_JOIN_OWNER, memberId: 'synthetic-other-owner' }) : forward());
  assert.deepEqual(await r.controller.reconcile(), { ok: false, code: 'PUBLISH_REFUSED' });
  assert.equal(r.controller.issuance(), 'unresolved');
  assert.deepEqual(await r.controller.load(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  assert.deepEqual(r.controller.dispose(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  f.intercept(null);
  assert.deepEqual(await r.controller.reconcile(), { ok: true });
  assert.equal(f.count('ontology.publish'), 1); assert.equal(r.identities(), 1); noForeignMethod(f);
});

test('cancel and actual lock hide a delayed publication reply while retaining one ID, draft and baseline across remount', async t => {
  for (const departure of ['cancel', 'lock'] as const) await t.test(departure, async sub => {
    const f = await actualEngineJoin(sub), baselineDraft = must(validatePacks(await f.request('ontology.packs', {}))[0]);
    const baseline = validatePublished(await f.request('ontology.publish', {
      draft: baselineDraft, expectedCurrentHash: null, attemptId: 'synthetic-initial-reviewed-baseline',
    }));
    const r = await ready(sub, 'retail', f), reached = engineJoinDeferred<void>(), gate = engineJoinDeferred<void>();
    r.f.releaseOnCleanup(() => gate.resolve(undefined));
    r.f.intercept(async (method, _payload, forward) => {
      const reply = await forward();
      if (method !== 'ontology.publish') return reply;
      r.f.intercept(null); reached.resolve(undefined); await gate.promise; return reply;
    });
    const pressed = r.f.track(r.controller.publishDictionary(r.pin)); await reached.promise;
    assert.deepEqual(await r.controller.publishDictionary(r.pin), { ok: false, code: 'IN_FLIGHT' });
    assert.deepEqual(r.controller.choosePack('services'), { ok: false, code: 'IN_FLIGHT' });
    assert.deepEqual(r.controller.leaveToSettings(r.pin.revision), { ok: false, code: 'IN_FLIGHT' });
    if (departure === 'lock') { r.live.set(false); r.controller.invalidate('VAULT_LOCKED'); await r.f.lock(); }
    else r.controller.cancel();
    neutral(r.controller, [r.attemptId, r.draft.label, r.draft.pack, r.pin.digest, baseline.hash]);
    const unmount = r.controller.subscribe(() => {}); unmount();
    const remount = r.controller.subscribe(() => {});
    assert.deepEqual(r.controller.dispose(), { ok: false, code: 'IN_FLIGHT' });
    gate.resolve(undefined);
    assert.deepEqual(await pressed, { ok: false, code: 'READ_INVALIDATED' });
    neutral(r.controller, [r.attemptId, r.draft.label, r.draft.pack, r.pin.digest, baseline.hash]);
    assert.deepEqual(r.controller.dispose(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
    if (departure === 'lock') { await r.f.reopen(); r.live.set(true); }
    const sent = submission(r.f);
    assert.equal(sent.attemptId, r.attemptId); assert.equal(sent.expectedCurrentHash, baseline.hash);
    assert.equal(JSON.stringify(sent.draft), JSON.stringify(r.draft));
    assert.deepEqual(await r.controller.reconcile(), { ok: true });
    assert.equal(state(r.controller, 'published').review, null);
    const found = await lookup(r.f, sent.attemptId);
    assert.equal(found.history.length, 2); assert.equal(found.attempt?.draftDigest, r.pin.digest);
    assert.equal(found.attempt?.expectedCurrentHash, baseline.hash); assert.equal(found.attempt?.version, 2);
    assert.equal(r.identities(), 1); assert.equal(r.f.count('ontology.publish'), 1);
    remount(); noForeignMethod(r.f);
  });
});

test('a changed pack invalidates retained clicks and a cancelled late actual read cannot restore the earlier review', async t => {
  const r = await ready(t, 'ecommerce');
  assert.deepEqual(r.controller.backToPacks(), { ok: true });
  assert.deepEqual(r.controller.choosePack('retail'), { ok: true }); await settle();
  const next = state(r.controller, 'review').review;
  assert.equal(next.rows.every(row => row.status === 'proposed'), true); assert.equal(next.settings.accepted, false);
  assert.deepEqual(await r.controller.publishDictionary(r.pin), { ok: false, code: 'DIGEST_STALE' });
  assert.equal(r.identities(), 0); assert.equal(r.f.count('ontology.publish'), 0);
  const pin: ReviewPin = must(pinOf(next));
  for (const row of next.rows) assert.deepEqual(r.controller.acceptRow(row.definition.name, pin), { ok: true });
  assert.deepEqual(r.controller.acceptSettings(pin), { ok: true });
  const reached = engineJoinDeferred<void>(), gate = engineJoinDeferred<void>();
  r.f.releaseOnCleanup(() => gate.resolve(undefined));
  r.f.intercept(async (method, _payload, forward) => {
    const reply = await forward();
    if (method !== 'ui.context') return reply;
    r.f.intercept(null); reached.resolve(undefined); await gate.promise; return reply;
  });
  const pressed = r.f.track(r.controller.publishDictionary(pin)); await reached.promise;
  r.controller.cancel(); gate.resolve(undefined);
  assert.deepEqual(await pressed, { ok: false, code: 'READ_INVALIDATED' });
  assert.deepEqual(r.controller.snapshot(), { kind: 'idle' });
  assert.equal(r.identities(), 0); assert.equal(r.f.count('ontology.publish'), 0);
  assert.deepEqual(validateOntologyReadback(await r.f.request('ontology.get', {})), { current: null, history: [] });
  noForeignMethod(r.f);
});
