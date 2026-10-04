import assert from 'node:assert/strict';
import test from 'node:test';
import { FIRST_RUN_METHODS, validateDraft } from '../../src/screens/first-run/contracts.ts';
import type { DictionaryPublicationReceipt, FirstRunCode, FirstRunMethod } from '../../src/screens/first-run/contracts.ts';
import { createFirstRunController, handoffPinOf } from '../../src/screens/first-run/controller.ts';
import type { FirstRunController, FirstRunState, IssuanceEvent } from '../../src/screens/first-run/controller.ts';
import { draftJson } from '../../src/screens/first-run/digest.ts';
import type { TextDigest } from '../../src/screens/first-run/digest.ts';
import { acceptedRows, allReviewed, pinOf } from '../../src/screens/first-run/review.ts';
import type { ReviewPin } from '../../src/screens/first-run/review.ts';
import {
  ENGINE_PACK_IDS, MEMBER_ID, MEMBER_NAME, WORKSPACE, deferred, engine, gatedDigest, guard, issued, nodeDigest, refusal, rehashed, settle, sha256, syntheticEngine,
} from './fixture.ts';
import type { Role, SyntheticEngine } from './fixture.ts';

/** Controller contract simulation using the Engine's own packs/compiler. Actual Engine join evidence is separate. */
const PUBLISH_SEQUENCE: FirstRunMethod[] = ['ui.context', 'ontology.publish', 'ui.context', 'ontology.get', 'ui.context'];
const NAMES = ['billed', 'received', 'earned', 'refunds', 'costs', 'purchases'];
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`missing ${what}`); return value; };

let attemptIds = 0;
const createAttemptId = () => `attempt_fixture_${++attemptIds}`;

function expect<K extends FirstRunState['kind']>(controller: FirstRunController, kind: K): Extract<FirstRunState, { kind: K }> {
  const state = controller.snapshot();
  assert.equal(state.kind, kind, `expected ${kind}, got ${state.kind}`);
  return state as Extract<FirstRunState, { kind: K }>;
}
interface Options { role?: Role; live?: boolean; current?: unknown; digest?: TextDigest; createAttemptId?: () => string }
async function loaded(options: Options = {}) {
  const fixture = await syntheticEngine({ ...(options.role === undefined ? {} : { role: options.role }), ...(options.current === undefined ? {} : { current: options.current }) });
  const live = guard(options.live ?? true);
  const controller = createFirstRunController(fixture.port, { guard: live, digest: options.digest ?? nodeDigest, createAttemptId: options.createAttemptId ?? createAttemptId });
  const events: IssuanceEvent[] = [];
  controller.onIssuance(event => { events.push(event); });
  const result = await controller.load();
  return { fixture, live, controller, result, events };
}
async function reviewing(pack = 'ecommerce', options: Options = {}) {
  const context = await loaded(options);
  assert.equal(context.controller.choosePack(pack).ok, true);
  await settle();
  const review = expect(context.controller, 'review').review;
  const pin = must(pinOf(review), 'pin');
  return { ...context, pin };
}
function acceptEverything(controller: FirstRunController, pin: ReviewPin): void {
  for (const name of NAMES) assert.equal(controller.acceptRow(name, pin).ok, true, name);
  assert.equal(controller.acceptSettings(pin).ok, true);
  assert.equal(allReviewed(expect(controller, 'review').review), true);
}
async function readyToPublish(pack = 'ecommerce', options: Options = {}) {
  const context = await reviewing(pack, options);
  acceptEverything(context.controller, context.pin);
  return context;
}
const sinceIndex = (fixture: SyntheticEngine, from: number) => fixture.methods().slice(from);
const hold = (fixture: SyntheticEngine, method: FirstRunMethod) => {
  const gate = deferred<unknown>();
  fixture.onRequest((called, _payload, defaults) => {
    if (called !== method) return undefined;
    fixture.onRequest(null);
    return gate.promise.then(value => value ?? defaults());
  });
  return gate;
};
/** A publish whose reply is lost after the Engine did (or did not) commit. */
const lostReply = (fixture: SyntheticEngine, committed: boolean) => fixture.onRequest((method, _payload, defaults) => {
  if (method !== 'ontology.publish') return undefined;
  fixture.onRequest(null);
  if (committed) defaults();
  throw new Error('socket closed');
});
const onlyKnownMethods = (fixture: SyntheticEngine) => assert.deepEqual(fixture.methods().filter(method => !FIRST_RUN_METHODS.includes(method)), []);
/** The public snapshot holds no workspace or member name, no id, no pack, no label, no digest and no key. */
function assertNeutral(controller: FirstRunController): void {
  const text = JSON.stringify(controller.snapshot());
  for (const secret of [WORKSPACE.name, WORKSPACE.id, MEMBER_NAME, MEMBER_ID, 'ecommerce', 'Online brand', 'attempt_fixture_']) assert.equal(text.includes(secret), false, `public state must not carry ${secret}`);
  assert.doesNotMatch(text, /[a-f0-9]{64}/, 'public state must not carry a digest, hash or key');
}

test('load reads context, packs and the current dictionary between two matching context reads', async () => {
  const { fixture, controller, result, events } = await loaded();
  assert.equal(result.ok, true);
  const state = expect(controller, 'choose');
  assert.deepEqual(state.packs.map(pack => pack.pack), ENGINE_PACK_IDS, 'Engine order is kept');
  assert.equal(state.current, null);
  assert.deepEqual(fixture.methods(), ['ui.context', 'ontology.packs', 'ontology.get', 'ui.context']);
  assert.equal(fixture.count('ontology.publish'), 0);
  assert.deepEqual(events, []);
  assert.equal(controller.issuance(), 'none');
});

test('with no guard there is no authority: nothing is read and every operation refuses', async () => {
  const fixture = await syntheticEngine();
  const controller = createFirstRunController(fixture.port, { digest: nodeDigest });
  assert.deepEqual(await controller.load(), { ok: false, code: 'NO_AUTHORITY' });
  assert.deepEqual(fixture.methods(), []);
  assert.equal(controller.snapshot().kind, 'unavailable');
  assert.equal(controller.choosePack('ecommerce').ok, false);
  assert.equal((await controller.publishDictionary({ revision: 'c0s0/0', digest: 'a'.repeat(64) })).ok, false);
  assert.equal(fixture.count('ontology.publish'), 0);
});

test('accountant and viewer seats are read only: one context read, no packs, no mutation control', async () => {
  for (const role of ['accountant', 'viewer'] as const) {
    const { fixture, controller, result } = await loaded({ role });
    assert.deepEqual(result, { ok: false, code: 'ROLE_FORBIDDEN' });
    expect(controller, 'read-only');
    assert.deepEqual(fixture.methods(), ['ui.context']);
    assert.equal(controller.choosePack('ecommerce').ok, false);
    assert.equal((await controller.publishDictionary({ revision: 'c0s0/0', digest: 'a'.repeat(64) })).ok, false);
    assert.equal(fixture.count('ontology.publish'), 0);
  }
});

test('a changed Engine state, a changed seat, or an unverifiable current dictionary during the load clears the read', async () => {
  const moved = await syntheticEngine();
  moved.onRequest(method => { if (method === 'ontology.packs') moved.touch(); return undefined; });
  const first = createFirstRunController(moved.port, { guard: guard(), digest: nodeDigest });
  assert.deepEqual(await first.load(), { ok: false, code: 'CONTEXT_CHANGED' });
  expect(first, 'unavailable');
  const seat = await syntheticEngine();
  seat.onRequest(method => { if (method === 'ontology.packs') seat.bumpEpoch(); return undefined; });
  const second = createFirstRunController(seat.port, { guard: guard(), digest: nodeDigest });
  assert.deepEqual(await second.load(), { ok: false, code: 'ACCESS_DENIED' });
  expect(second, 'unavailable');
  const frozen = await engine();
  const forged = await syntheticEngine({ current: { ...frozen.compileRaw(frozen.rawPack(0), 1, MEMBER_ID), hash: 'e'.repeat(64) } });
  const third = createFirstRunController(forged.port, { guard: guard(), digest: nodeDigest });
  assert.deepEqual(await third.load(), { ok: false, code: 'READBACK_MISMATCH' }, 'a current dictionary whose hash does not verify is never a baseline');
  expect(third, 'unavailable');
});

test('a valid custom published identity is tolerated as current and is never offered as a starter', async () => {
  const frozen = await engine();
  const custom = frozen.compileRaw({ ...frozen.rawPack(0), pack: 'Custom Acme workspace', label: 'Explicit synthetic custom dictionary' }, 1, MEMBER_ID);
  const { controller, result } = await loaded({ current: custom });
  assert.deepEqual(result, { ok: true });
  const state = expect(controller, 'choose');
  assert.equal(state.current?.pack, 'Custom Acme workspace');
  assert.equal(state.current?.version, 1);
  assert.deepEqual(state.packs.map(pack => pack.pack), ENGINE_PACK_IDS);
  assert.deepEqual(controller.choosePack('Custom Acme workspace'), { ok: false, code: 'PACK_UNKNOWN' });
  assert.equal(controller.choosePack('services').ok, true);
  await settle();
  const pin = must(pinOf(expect(controller, 'review').review));
  acceptEverything(controller, pin);
  assert.deepEqual(await controller.publishDictionary(pin), { ok: true });
  assert.equal(expect(controller, 'published').published.version, 2);
});

test('choosing a pack starts a review with a generation and a SHA-256 review digest over the exact draft JSON', async () => {
  const frozen = await engine();
  const { controller, pin } = await reviewing('retail');
  const review = expect(controller, 'review').review;
  assert.equal(review.pack, 'retail');
  assert.equal(pin.digest, sha256(JSON.stringify(frozen.rawPack(1))), 'the digest is over JSON.stringify of the exact Engine draft');
  assert.equal(review.draftJson, JSON.stringify(frozen.rawPack(1)));
  assert.equal(pin.revision, review.revision);
  assert.equal(acceptedRows(review).length, 0);
  assert.deepEqual(controller.acceptRow('billed', { ...pin, digest: 'f'.repeat(64) }), { ok: false, code: 'DIGEST_STALE' }, 'a stale digest cannot accept');
  assert.deepEqual(controller.acceptRow('billed', { ...pin, revision: 'c0s0/0' }), { ok: false, code: 'DIGEST_STALE' }, 'another review cannot accept');
  assert.equal(controller.choosePack('nope').ok, false);
});

test('Publish is refused until every row and the settings are accepted; nothing is sent before that', async () => {
  const { fixture, controller, pin } = await reviewing();
  for (const name of NAMES) controller.acceptRow(name, pin);
  assert.deepEqual(await controller.publishDictionary(pin), { ok: false, code: 'NOT_REVIEWED' });
  assert.equal(fixture.count('ontology.publish'), 0);
  assert.equal(fixture.count('ui.context'), 2, 'no extra context read either');
});

test('a reviewed publish is issued once, verified by hash, artifacts, draft equality, version, author and readback, and adopts the new contextKey', async () => {
  const { fixture, controller, pin, events } = await readyToPublish();
  const reviewed = expect(controller, 'review');
  const from = fixture.calls.length;
  const presses = [controller.publishDictionary(pin), controller.publishDictionary(pin), controller.publishDictionary(pin)];
  assert.equal(expect(controller, 'review').publishing, true, 'the latch is synchronous');
  const results = await Promise.all(presses);
  assert.deepEqual(results.map(result => result.ok), [true, false, false]);
  assert.deepEqual(results.slice(1).map(result => (result.ok ? null : result.code)), ['IN_FLIGHT', 'IN_FLIGHT']);
  assert.deepEqual(sinceIndex(fixture, from), PUBLISH_SEQUENCE);
  assert.equal(fixture.count('ontology.publish'), 1);
  const sent = fixture.calls.find(call => call.method === 'ontology.publish')?.payload as { draft: unknown; expectedCurrentHash: string | null; attemptId: string };
  assert.deepEqual(Object.keys(sent).sort(), ['attemptId', 'draft', 'expectedCurrentHash']);
  assert.equal(JSON.stringify(sent.draft), reviewed.review.draftJson, 'the exact reviewed bytes were sent');
  assert.equal(sent.expectedCurrentHash, null);
  assert.match(sent.attemptId, /^attempt_fixture_\d+$/);
  assert.deepEqual(fixture.calls.filter(call => call.method === 'ontology.get').at(-1)?.payload, { attemptId: sent.attemptId });
  const state = expect(controller, 'published');
  const current = must(fixture.current());
  assert.equal(state.published.hash, current.hash);
  assert.equal(state.published.version, 1);
  assert.equal(state.published.publishedBy, MEMBER_ID);
  assert.equal(state.handoff.dictionary.hash, current.hash);
  assert.notEqual(state.reviewDigest, current.hash, 'the review digest is not the Engine hash');
  assert.equal(state.reviewDigest, pin.digest);
  assert.notEqual(state.context.contextKey, reviewed.context.contextKey, 'publication changes the key on purpose');
  assert.equal(state.context.contextKey, fixture.contextKey());
  assert.equal(state.handoff.contextKey, state.context.contextKey);
  assert.deepEqual(state.handoff.pending, { calendar: 'not-configured', timeZone: 'not-configured', ordering: 'not-configured', todayDefaults: 'not-configured' });
  assert.ok(state.review && allReviewed(state.review));
  assert.deepEqual(events, [{ kind: 'issued' }, { kind: 'settled', outcome: 'verified' }, { kind: 'resolved', outcome: 'published' }]);
  assert.equal(controller.issuance(), 'none');
  onlyKnownMethods(fixture);
});

test('before dispatch the draft is rehashed first, then one fresh context is read, then the raw call follows with nothing awaited between', async () => {
  const log: string[] = [];
  const digest: TextDigest = async text => { log.push('digest'); return sha256(text); };
  const { fixture, controller, pin } = await readyToPublish('ecommerce', { digest });
  log.length = 0;
  fixture.onRequest(method => { log.push(method); return undefined; });
  assert.deepEqual(await controller.publishDictionary(pin), { ok: true });
  assert.deepEqual(log.slice(0, 3), ['digest', 'ui.context', 'ontology.publish'], 'hash, then the final context, then the effect');
});

test('a contextKey change during the rehash is caught by the final context read: nothing is dispatched', async () => {
  const gate = gatedDigest();
  const { fixture, controller, pin, events } = await readyToPublish('ecommerce', { digest: gate.digest });
  const held = gate.holdNext();
  const press = controller.publishDictionary(pin);
  await held.held;
  fixture.touch();
  held.release();
  assert.deepEqual(await press, { ok: false, code: 'CONTEXT_CHANGED' });
  assert.equal(fixture.count('ontology.publish'), 0);
  expect(controller, 'unavailable');
  assert.deepEqual(events, []);
  assert.equal(controller.issuance(), 'none');
  const seat = gatedDigest();
  const other = await readyToPublish('ecommerce', { digest: seat.digest });
  const otherHeld = seat.holdNext();
  const otherPress = other.controller.publishDictionary(other.pin);
  await otherHeld.held;
  other.fixture.bumpEpoch();
  otherHeld.release();
  assert.deepEqual(await otherPress, { ok: false, code: 'ACCESS_DENIED' });
  assert.equal(other.fixture.count('ontology.publish'), 0);
});

test('a changed meaning resets only its row and the revision, is sent exactly, and the Engine publication carries it', async () => {
  const frozen = await engine();
  const { fixture, controller, pin } = await reviewing('saas');
  acceptEverything(controller, pin);
  const edited = 'Subscription service delivered during the period, from imported recognition events only.';
  assert.deepEqual(controller.changeMeaning('earned', 'short', pin.revision), { ok: false, code: 'MEANING_INVALID' });
  assert.deepEqual(controller.changeMeaning('earned', edited, 'c0s0/0'), { ok: false, code: 'DIGEST_STALE' }, 'an editor rendered for another review changes nothing');
  assert.equal(controller.changeMeaning('earned', edited, pin.revision).ok, true);
  let review = expect(controller, 'review').review;
  assert.equal(review.digest, null);
  assert.notEqual(review.revision, pin.revision);
  assert.equal(acceptedRows(review).length, 5);
  assert.deepEqual(await controller.publishDictionary(pin), { ok: false, code: 'DIGEST_STALE' }, 'the old Publish press names a revision that is gone');
  await settle();
  review = expect(controller, 'review').review;
  const next = must(pinOf(review));
  assert.notEqual(next.digest, pin.digest);
  assert.deepEqual(controller.acceptRow('earned', pin), { ok: false, code: 'DIGEST_STALE' }, 'the old pin is stale');
  assert.equal(controller.acceptRow('earned', next).ok, true);
  assert.equal((await controller.publishDictionary(next)).ok, true);
  const current = must(fixture.current());
  assert.equal(current.definitions.find(item => item.name === 'earned')?.meaning, edited);
  const proposed = must(frozen.pack(5).definitions.find(item => item.name === 'earned'));
  assert.deepEqual({ ...current.definitions.find(item => item.name === 'earned'), meaning: proposed.meaning }, proposed, 'every other binding is unchanged');
});

test('a rendered control names its review: a same-pack round trip, an old editor and an old Publish press are all refused', async () => {
  const { fixture, controller, pin: first } = await reviewing('ecommerce');
  const firstReview = expect(controller, 'review').review;
  acceptEverything(controller, first);
  assert.equal(controller.choosePack('retail').ok, true);
  await settle();
  const retail = expect(controller, 'review').review;
  const retailMeaning = must(retail.draft.definitions.find(item => item.name === 'earned')).meaning;
  const staleMeaning = 'Old ecommerce editor text delivered after the selection changed to retail.';
  assert.deepEqual(controller.changeMeaning('earned', staleMeaning, firstReview.revision), { ok: false, code: 'DIGEST_STALE' });
  assert.equal(must(expect(controller, 'review').review.draft.definitions.find(item => item.name === 'earned')).meaning, retailMeaning, 'the retail definition is untouched');
  assert.equal(controller.choosePack('ecommerce').ok, true);
  await settle();
  const again = expect(controller, 'review').review;
  assert.equal(again.digest, first.digest, 'the same bytes give the same content digest');
  assert.notEqual(again.generation, firstReview.generation);
  assert.notEqual(again.revision, first.revision);
  assert.deepEqual(controller.acceptRow('earned', first), { ok: false, code: 'DIGEST_STALE' }, 'an old Accept cannot land in the reset review');
  assert.deepEqual(controller.acceptSettings(first), { ok: false, code: 'DIGEST_STALE' });
  assert.equal(acceptedRows(expect(controller, 'review').review).length, 0);
  assert.equal(expect(controller, 'review').review.settings.accepted, false);
  assert.deepEqual(await controller.publishDictionary(first), { ok: false, code: 'DIGEST_STALE' }, 'an old Publish press cannot publish the reset review');
  assert.equal(fixture.count('ontology.publish'), 0);
  const pin = must(pinOf(again));
  acceptEverything(controller, pin);
  assert.deepEqual(await controller.publishDictionary(first), { ok: false, code: 'DIGEST_STALE' });
  assert.equal(fixture.count('ontology.publish'), 0);
  assert.equal((await controller.publishDictionary(pin)).ok, true);
  assert.equal(fixture.count('ontology.publish'), 1);
});

test('a departure during the context read before publish issues nothing and hides the review', async () => {
  const { fixture, live, controller, pin, events } = await readyToPublish();
  const gate = hold(fixture, 'ui.context');
  const press = controller.publishDictionary(pin);
  assert.ok(await issued(fixture, 'ui.context', 3));
  live.set(false);
  gate.resolve(undefined);
  assert.deepEqual(await press, { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(fixture.count('ontology.publish'), 0);
  expect(controller, 'idle');
  assert.deepEqual(events, []);
});

test('a changed contextKey or seat before publish refuses the mutation and clears the review', async () => {
  const { fixture, controller, pin } = await readyToPublish();
  fixture.touch();
  assert.deepEqual(await controller.publishDictionary(pin), { ok: false, code: 'CONTEXT_CHANGED' });
  assert.equal(fixture.count('ontology.publish'), 0);
  expect(controller, 'unavailable');
  const seat = await readyToPublish();
  seat.fixture.bumpEpoch();
  assert.deepEqual(await seat.controller.publishDictionary(seat.pin), { ok: false, code: 'ACCESS_DENIED' });
  assert.equal(seat.fixture.count('ontology.publish'), 0);
});

test('a rehash that no longer equals the reviewed digest stops the publish before dispatch', async () => {
  const fixture = await syntheticEngine();
  let calls = 0;
  const flaky: TextDigest = async text => { calls += 1; return calls === 2 ? 'c'.repeat(64) : sha256(text); };
  const controller = createFirstRunController(fixture.port, { guard: guard(), digest: flaky });
  await controller.load();
  controller.choosePack('ecommerce');
  await settle();
  const pin = must(pinOf(expect(controller, 'review').review));
  acceptEverything(controller, pin);
  assert.deepEqual(await controller.publishDictionary(pin), { ok: false, code: 'DIGEST_STALE' });
  assert.equal(fixture.count('ontology.publish'), 0);
  const state = expect(controller, 'review');
  assert.equal(state.notice?.code, 'DIGEST_STALE');
  assert.equal(state.publishing, false);
});

test('cancelling after the raw call is issued cannot retract it: the public state is neutral, the latch and then the unresolved fence hold, and only a readback adopts', async () => {
  const { fixture, controller, pin, events } = await readyToPublish();
  const gate = hold(fixture, 'ontology.publish');
  const press = controller.publishDictionary(pin);
  assert.ok(await issued(fixture, 'ontology.publish', 1));
  assert.deepEqual(events, [{ kind: 'issued' }]);
  controller.cancel();
  assert.deepEqual(controller.snapshot(), { kind: 'unknown', code: 'READ_INVALIDATED', reconciling: false, attempt: null });
  assertNeutral(controller);
  assert.equal(controller.issuance(), 'issued');
  assert.deepEqual(await controller.load(), { ok: false, code: 'IN_FLIGHT' }, 'the issued latch holds across the cancelled surface');
  assert.equal(controller.choosePack('retail').ok, false);
  assert.deepEqual(await controller.reconcile(), { ok: false, code: 'IN_FLIGHT' }, 'no readback while the raw call is unsettled');
  gate.resolve(undefined);
  assert.deepEqual(await press, { ok: false, code: 'READ_INVALIDATED' });
  assertNeutral(controller);
  assert.equal(controller.issuance(), 'unresolved');
  assert.deepEqual(events.at(-1), { kind: 'settled', outcome: 'unresolved' });
  assert.ok(fixture.current(), 'the synthetic Engine did commit');
  assert.equal(fixture.count('ontology.publish'), 1, 'no automatic retry');
  assert.deepEqual(await controller.load(), { ok: false, code: 'PUBLISH_UNRESOLVED' }, 'a reload cannot erase the unresolved attempt');
  assert.equal(controller.choosePack('retail').ok, false);
  assert.deepEqual(await controller.reconcile(), { ok: true });
  const published = expect(controller, 'published');
  assert.equal(published.published.hash, must(fixture.current()).hash);
  assert.equal(published.review, null, 'reviewed rows are not resurrected after a cancel');
  assert.equal(controller.issuance(), 'none');
  assert.deepEqual(events.at(-1), { kind: 'resolved', outcome: 'published' });
  assert.equal(fixture.count('ontology.publish'), 1);
});

test('a lock after the raw call keeps the attempt private: neutral public state, fenced replay, and a later trusted readback adopts only this attempt', async () => {
  const { fixture, live, controller, pin, events } = await readyToPublish();
  const gate = hold(fixture, 'ontology.publish');
  const press = controller.publishDictionary(pin);
  assert.ok(await issued(fixture, 'ontology.publish', 1));
  live.set(false);
  controller.invalidate('VAULT_LOCKED');
  assert.deepEqual(controller.snapshot(), { kind: 'unknown', code: 'VAULT_LOCKED', reconciling: false, attempt: null });
  assertNeutral(controller);
  assert.deepEqual(await controller.load(), { ok: false, code: 'IN_FLIGHT' });
  gate.resolve(undefined);
  assert.deepEqual(await press, { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(controller.issuance(), 'unresolved');
  assertNeutral(controller);
  assert.deepEqual(await controller.load(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  assert.deepEqual(await controller.reconcile(), { ok: false, code: 'NO_AUTHORITY' }, 'locked: no readback, nothing changes');
  assertNeutral(controller);
  live.set(true);
  assert.deepEqual(await controller.reconcile(), { ok: true });
  const published = expect(controller, 'published');
  assert.equal(published.review, null);
  assert.equal(published.published.version, 1);
  assert.equal(published.published.publishedBy, MEMBER_ID);
  assert.deepEqual(events, [{ kind: 'issued' }, { kind: 'settled', outcome: 'unresolved' }, { kind: 'resolved', outcome: 'published' }]);
  assert.equal(fixture.count('ontology.publish'), 1);
});

test('a lost reply recovers only through its receipt; null stays unknown and a historical receipt proves supersession', async () => {
  const frozen = await engine();
  const committed = await readyToPublish();
  lostReply(committed.fixture, true);
  assert.deepEqual(await committed.controller.publishDictionary(committed.pin), { ok: false, code: 'PUBLISH_UNKNOWN' });
  const unknown = expect(committed.controller, 'unknown');
  assert.deepEqual(unknown.attempt, { pack: 'ecommerce', label: 'Online brand', reviewDigest: committed.pin.digest }, 'the surface that issued it may still name it');
  assert.equal(committed.fixture.count('ontology.publish'), 1);
  assert.deepEqual(await committed.controller.load(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  assert.deepEqual(await committed.controller.reconcile(), { ok: true });
  assert.equal(expect(committed.controller, 'published').published.hash, must(committed.fixture.current()).hash);
  assert.equal(committed.controller.issuance(), 'none');
  assert.equal(committed.fixture.count('ontology.publish'), 1);
  assert.deepEqual(committed.events.at(-1), { kind: 'resolved', outcome: 'published' });

  const dropped = await readyToPublish();
  lostReply(dropped.fixture, false);
  assert.deepEqual(await dropped.controller.publishDictionary(dropped.pin), { ok: false, code: 'PUBLISH_UNKNOWN' });
  assert.deepEqual(await dropped.controller.reconcile(), { ok: false, code: 'PUBLISH_UNKNOWN' });
  expect(dropped.controller, 'unknown');
  assert.equal(dropped.fixture.count('ontology.publish'), 1);
  assert.equal(dropped.controller.issuance(), 'unresolved');
  assert.equal(dropped.events.some(event => event.kind === 'resolved'), false);
  assert.deepEqual(await dropped.controller.publishDictionary(dropped.pin), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  assert.deepEqual(dropped.controller.dispose(), { ok: false, code: 'PUBLISH_UNRESOLVED' });

  const superseded = await readyToPublish();
  lostReply(superseded.fixture, false);
  await superseded.controller.publishDictionary(superseded.pin);
  superseded.fixture.commit(frozen.rawPack(1));
  assert.deepEqual(await superseded.controller.reconcile(), { ok: false, code: 'PUBLISH_UNKNOWN' }, 'another current dictionary cannot prove this attempt never committed');
  expect(superseded.controller, 'unknown');
  assert.equal(superseded.controller.issuance(), 'unresolved');
  assert.equal(superseded.events.some(event => event.kind === 'resolved'), false);

  const overtaken = await readyToPublish();
  lostReply(overtaken.fixture, true);
  await overtaken.controller.publishDictionary(overtaken.pin);
  overtaken.fixture.commit(frozen.rawPack(1));
  assert.deepEqual(await overtaken.controller.reconcile(), { ok: false, code: 'REVIEW_NOT_CURRENT' }, 'committed, then superseded: this attempt is not what is current');
  expect(overtaken.controller, 'unavailable');
  assert.equal(overtaken.controller.issuance(), 'none');
  assert.deepEqual(overtaken.events.at(-1), { kind: 'resolved', outcome: 'not-current' });
  assert.deepEqual(await overtaken.controller.leave({ hash: must(overtaken.fixture.current()).hash, contextKey: overtaken.fixture.contextKey(), reviewDigest: overtaken.pin.digest }), { ok: false, code: 'SELECTION_INVALID' });
});

test('a pre-existing identical dictionary is never mistaken for the lost publication', async () => {
  const frozen = await engine();
  const old = frozen.compileRaw(frozen.rawPack(0), 1, MEMBER_ID);
  const { fixture, controller, pin, events } = await readyToPublish('ecommerce', { current: old });
  lostReply(fixture, false);
  assert.deepEqual(await controller.publishDictionary(pin), { ok: false, code: 'PUBLISH_UNKNOWN' });
  assert.deepEqual(await controller.reconcile(), { ok: false, code: 'PUBLISH_UNKNOWN' });
  expect(controller, 'unknown');
  assert.equal(must(fixture.current()).hash, old.hash, 'the old publication is still the only one');
  assert.equal(must(fixture.current()).version, 1);
  assert.equal(events.some(event => event.kind === 'resolved'), false);
  assert.equal(controller.issuance(), 'unresolved');
  assert.equal(fixture.count('ontology.publish'), 1);
  assert.deepEqual(await controller.publishDictionary(pin), { ok: false, code: 'PUBLISH_UNRESOLVED' });
});

test('the reviewed bytes current as a new revision by another author stay unresolved: no proof names this attempt', async () => {
  const frozen = await engine();
  const { fixture, controller, pin } = await readyToPublish();
  lostReply(fixture, false);
  assert.deepEqual(await controller.publishDictionary(pin), { ok: false, code: 'PUBLISH_UNKNOWN' });
  fixture.commitRaw(frozen.rawPack(0), 'someone_else');
  assert.deepEqual(await controller.reconcile(), { ok: false, code: 'PUBLISH_UNKNOWN' });
  assert.equal(expect(controller, 'unknown').code, 'PUBLISH_UNKNOWN');
  assert.equal(controller.issuance(), 'unresolved');
  assert.deepEqual(await controller.reconcile(), { ok: false, code: 'PUBLISH_UNKNOWN' }, 'reading back again does not invent attribution');
  assert.deepEqual(await controller.load(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  assert.equal(controller.choosePack('retail').ok, false);
  assert.equal(fixture.count('ontology.publish'), 1, 'never retried');
});

test('a separate identical publication by the same seat after our raw call failed without a commit is never adopted as ours', async () => {
  const frozen = await engine();
  const { fixture, controller, pin, events } = await readyToPublish();
  lostReply(fixture, false);
  assert.deepEqual(await controller.publishDictionary(pin), { ok: false, code: 'PUBLISH_UNKNOWN' });
  assert.equal(fixture.current(), null, 'our call did not commit');
  // Another surface of the exact same seat publishes the identical draft as exactly the expected next version.
  fixture.commitRaw(frozen.rawPack(0), MEMBER_ID);
  const theirs = must(fixture.current());
  assert.equal(theirs.version, 1);
  assert.equal(theirs.publishedBy, MEMBER_ID);
  assert.deepEqual(await controller.reconcile(), { ok: false, code: 'PUBLISH_UNKNOWN' }, 'expected version and actor are not unique attribution');
  assert.equal(expect(controller, 'unknown').code, 'PUBLISH_UNKNOWN');
  assert.equal(controller.issuance(), 'unresolved');
  assert.equal(events.some(event => event.kind === 'resolved'), false);
  assert.deepEqual(await controller.reconcile(), { ok: false, code: 'PUBLISH_UNKNOWN' }, 'reading back again does not invent attribution');
  assert.equal(fixture.count('ontology.publish'), 1, 'never retried');
});

test('a validated raw reply adds a private attribution pin even after a cancel; the receipt must identify exactly that dictionary', async () => {
  const frozen = await engine();
  // The reply arrives after the surface was cancelled: it is still this attempt's own reply.
  const late = await readyToPublish();
  const gate = hold(late.fixture, 'ontology.publish');
  const press = late.controller.publishDictionary(late.pin);
  assert.ok(await issued(late.fixture, 'ontology.publish', 1));
  late.controller.cancel();
  gate.resolve(undefined);
  assert.deepEqual(await press, { ok: false, code: 'READ_INVALIDATED' });
  assertNeutral(late.controller);
  assert.deepEqual(await late.controller.reconcile(), { ok: true }, 'the pinned returned hash attributes the current dictionary to this attempt');
  assert.equal(expect(late.controller, 'published').published.hash, must(late.fixture.current()).hash);
  assert.equal(expect(late.controller, 'published').review, null);
  // The reply arrived and verified, but the Engine state then moved to an identical revision by the same seat: not ours.
  const replaced = await readyToPublish();
  replaced.fixture.onRequest(method => { if (method !== 'ontology.get') return undefined; replaced.fixture.onRequest(null); throw refusal('INVALID_DEFINITION'); });
  assert.deepEqual(await replaced.controller.publishDictionary(replaced.pin), { ok: false, code: 'PUBLISH_REFUSED' });
  expect(replaced.controller, 'unknown');
  replaced.fixture.commitRaw(frozen.rawPack(0), MEMBER_ID);
  assert.equal(must(replaced.fixture.current()).version, 2);
  assert.deepEqual(await replaced.controller.reconcile(), { ok: false, code: 'REVIEW_NOT_CURRENT' }, 'our publication is known and is no longer current');
  expect(replaced.controller, 'unavailable');
  assert.deepEqual(replaced.events.at(-1), { kind: 'resolved', outcome: 'not-current' });
});

test('an observer that locks inside the issued event cannot withhold a call that was issued, and the event order is truthful: dispatch, then issued, then a neutral settlement', async () => {
  const { fixture, live, controller, pin, events } = await readyToPublish();
  const gate = hold(fixture, 'ontology.publish');
  let dispatchedAtIssued = -1;
  controller.onIssuance(event => {
    if (event.kind !== 'issued') return;
    dispatchedAtIssued = fixture.count('ontology.publish');
    live.set(false);
    controller.invalidate('VAULT_LOCKED');
  });
  const press = controller.publishDictionary(pin);
  assert.ok(await issued(fixture, 'ontology.publish', 1));
  assert.equal(dispatchedAtIssued, 1, 'issued is told after the raw call exists, never before');
  assert.deepEqual(controller.snapshot(), { kind: 'unknown', code: 'VAULT_LOCKED', reconciling: false, attempt: null }, 'the observer has the last word on the public state');
  assertNeutral(controller);
  gate.resolve(undefined);
  assert.deepEqual(await press, { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(fixture.count('ontology.publish'), 1);
  assert.deepEqual(events, [{ kind: 'issued' }, { kind: 'settled', outcome: 'unresolved' }], 'no verified or not-committed outcome is invented');
  assertNeutral(controller);
  assert.equal(controller.issuance(), 'unresolved');
  live.set(true);
  assert.deepEqual(await controller.reconcile(), { ok: true }, 'the returned reply pin attributes the publication later');
  // An observer that cancels before the final context read: nothing is issued at all, and no issued event exists.
  const early = await readyToPublish();
  const contextGate = hold(early.fixture, 'ui.context');
  const earlyPress = early.controller.publishDictionary(early.pin);
  assert.ok(await issued(early.fixture, 'ui.context', 3));
  early.controller.cancel();
  contextGate.resolve(undefined);
  assert.deepEqual(await earlyPress, { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(early.fixture.count('ontology.publish'), 0);
  assert.deepEqual(early.events, []);
});

test('an observer that locks inside the resolved event has the last word: no verdict resurrects the published or held state afterwards', async () => {
  // Verdict "published" from a readback: the reply verified but the later readback threw, so the returned pin is known.
  const adopted = await readyToPublish();
  adopted.fixture.onRequest(method => { if (method !== 'ontology.get') return undefined; adopted.fixture.onRequest(null); throw refusal('INVALID_DEFINITION'); });
  assert.deepEqual(await adopted.controller.publishDictionary(adopted.pin), { ok: false, code: 'PUBLISH_REFUSED' });
  expect(adopted.controller, 'unknown');
  const seen: string[] = [];
  adopted.controller.onIssuance(event => {
    if (event.kind !== 'resolved') return;
    seen.push(adopted.controller.snapshot().kind);
    adopted.live.set(false);
    adopted.controller.invalidate('VAULT_LOCKED');
  });
  assert.deepEqual(await adopted.controller.reconcile(), { ok: true }, 'the verdict itself is truthful');
  assert.deepEqual(seen, ['published'], 'the state was published before the observer was told');
  assert.deepEqual(adopted.controller.snapshot(), { kind: 'unavailable', code: 'VAULT_LOCKED' }, 'the lock wins; nothing is published after the event');
  assertNeutral(adopted.controller);
  assert.equal(adopted.controller.issuance(), 'none');
  // Verdict "not current": an attributed historical publication is not resurrected over the lock either.
  const dropped = await readyToPublish();
  lostReply(dropped.fixture, true);
  await dropped.controller.publishDictionary(dropped.pin);
  dropped.fixture.commitRaw((await engine()).rawPack(1));
  dropped.controller.onIssuance(event => { if (event.kind === 'resolved') { dropped.live.set(false); dropped.controller.invalidate('VAULT_LOCKED'); } });
  assert.deepEqual(await dropped.controller.reconcile(), { ok: false, code: 'REVIEW_NOT_CURRENT' });
  assert.deepEqual(dropped.controller.snapshot(), { kind: 'unavailable', code: 'VAULT_LOCKED' });
  assertNeutral(dropped.controller);
  assert.equal(dropped.fixture.count('ontology.publish'), 1);
});

test('every authority or surface loss the controller detects itself hides the held decisions, exactly as a parent lock does', async () => {
  // The seat changes immediately after the raw reply.
  const seat = await readyToPublish();
  seat.fixture.onRequest((method, _payload, defaults) => { if (method !== 'ontology.publish') return undefined; seat.fixture.onRequest(null); const reply = defaults(); seat.fixture.bumpEpoch(); return reply; });
  assert.deepEqual(await seat.controller.publishDictionary(seat.pin), { ok: false, code: 'ACCESS_DENIED' });
  assert.deepEqual(seat.controller.snapshot(), { kind: 'unknown', code: 'ACCESS_DENIED', reconciling: false, attempt: null });
  assertNeutral(seat.controller);
  assert.equal(seat.controller.issuance(), 'unresolved');
  // The guard goes dead immediately after the raw reply, without any parent invalidate.
  const guardLost = await readyToPublish();
  guardLost.fixture.onRequest((method, _payload, defaults) => { if (method !== 'ontology.publish') return undefined; guardLost.fixture.onRequest(null); const reply = defaults(); guardLost.live.set(false); return reply; });
  assert.deepEqual(await guardLost.controller.publishDictionary(guardLost.pin), { ok: false, code: 'READ_INVALIDATED' });
  assert.deepEqual(guardLost.controller.snapshot(), { kind: 'unknown', code: 'READ_INVALIDATED', reconciling: false, attempt: null });
  assertNeutral(guardLost.controller);
  guardLost.live.set(true);
  assert.deepEqual(await guardLost.controller.reconcile(), { ok: true }, 'the private pin survives and attributes the publication');
  assert.equal(expect(guardLost.controller, 'published').review, null, 'hidden decisions are not resurrected');
  // The seat changes before the readback.
  const readback = await readyToPublish();
  lostReply(readback.fixture, false);
  await readback.controller.publishDictionary(readback.pin);
  assert.ok(expect(readback.controller, 'unknown').attempt);
  readback.fixture.bumpEpoch();
  assert.deepEqual(await readback.controller.reconcile(), { ok: false, code: 'ACCESS_DENIED' });
  assert.deepEqual(readback.controller.snapshot(), { kind: 'unknown', code: 'ACCESS_DENIED', reconciling: false, attempt: null });
  assertNeutral(readback.controller);
  assert.equal(readback.controller.issuance(), 'unresolved');
  // A dead guard at the readback hides the summary without reading anything.
  const dead = await readyToPublish();
  lostReply(dead.fixture, false);
  await dead.controller.publishDictionary(dead.pin);
  const reads = dead.fixture.calls.length;
  dead.live.set(false);
  assert.deepEqual(await dead.controller.reconcile(), { ok: false, code: 'NO_AUTHORITY' });
  assert.equal(dead.fixture.calls.length, reads);
  assertNeutral(dead.controller);
  // The raw call itself fails with an authority code: unresolved, neutral, never assumed uncommitted.
  const revoked = await readyToPublish();
  revoked.fixture.onRequest(method => { if (method !== 'ontology.publish') return undefined; revoked.fixture.onRequest(null); throw refusal('ACCESS_REVOKED'); });
  assert.deepEqual(await revoked.controller.publishDictionary(revoked.pin), { ok: false, code: 'ACCESS_DENIED' });
  assertNeutral(revoked.controller);
  assert.equal(revoked.controller.issuance(), 'unresolved');
});

test('a background digest that lands after the guard went dead hides the review instead of releasing it', async () => {
  const gate = gatedDigest();
  const { fixture, live, controller } = await loaded({ digest: gate.digest });
  const held = gate.holdNext();
  assert.equal(controller.choosePack('ecommerce').ok, true);
  await held.held;
  live.set(false);
  held.release();
  await settle();
  assert.deepEqual(controller.snapshot(), { kind: 'unavailable', code: 'NO_AUTHORITY' });
  assertNeutral(controller);
  assert.equal(fixture.count('ontology.publish'), 0);
  // The same for a digest failure after the guard went dead.
  const failing = gatedDigest();
  const other = await loaded({ digest: failing.digest });
  const otherHeld = failing.holdNext();
  assert.equal(other.controller.choosePack('retail').ok, true);
  await otherHeld.held;
  other.live.set(false);
  otherHeld.release();
  await settle();
  assertNeutral(other.controller);
  assert.notEqual(other.controller.snapshot().kind, 'review');
});

test('dispose seals the controller before any observer is told, and refuses while an attempt is pinned', async () => {
  const sealed = await reviewing();
  const reads = sealed.fixture.calls.length;
  const reentrant: { load: Promise<FirstRunState['kind']> | null } = { load: null };
  sealed.controller.subscribe(() => { if (sealed.controller.snapshot().kind === 'idle') reentrant.load = sealed.controller.load().then(() => sealed.controller.snapshot().kind); });
  assert.deepEqual(sealed.controller.dispose(), { ok: true });
  assert.notEqual(reentrant.load, null, 'the observer did run during dispose');
  assert.equal(await must(reentrant.load), 'idle', 'the reentrant load found a disposed controller: the snapshot stays neutral');
  assert.equal(sealed.fixture.calls.length, reads, 'no context read was issued by the reentrant load');
  assert.equal(sealed.controller.snapshot().kind, 'idle');
  assert.deepEqual(sealed.controller.dispose(), { ok: true }, 'disposing twice is harmless');
  assert.equal(sealed.controller.choosePack('ecommerce').ok, false);
  assert.equal(sealed.fixture.count('ontology.publish'), 0);
  // A pinned attempt is host-owned evidence: dispose refuses and the controller stays alive for the readback.
  const pinned = await readyToPublish();
  lostReply(pinned.fixture, true);
  await pinned.controller.publishDictionary(pinned.pin);
  assert.deepEqual(pinned.controller.dispose(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  assert.equal(pinned.controller.issuance(), 'unresolved');
  assert.deepEqual(await pinned.controller.reconcile(), { ok: true });
  expect(pinned.controller, 'published');
  assert.deepEqual(pinned.controller.dispose(), { ok: true }, 'once resolved, dispose is allowed');
  const issuedOne = await readyToPublish();
  const gate = hold(issuedOne.fixture, 'ontology.publish');
  const press = issuedOne.controller.publishDictionary(issuedOne.pin);
  assert.ok(await issued(issuedOne.fixture, 'ontology.publish', 1));
  assert.deepEqual(issuedOne.controller.dispose(), { ok: false, code: 'IN_FLIGHT' });
  gate.resolve(undefined);
  assert.equal((await press).ok, true);
});

test('Continue is a controller-checked departure: the exact rendered publication, a live guard and an unchanged fresh context, cancelled before the handoff is handed over, once', async () => {
  const { fixture, live, controller, pin } = await readyToPublish();
  assert.deepEqual(await controller.publishDictionary(pin), { ok: true });
  const published = expect(controller, 'published');
  const rendered = handoffPinOf(published);
  assert.deepEqual(await controller.leave({ ...rendered, hash: 'f'.repeat(64) }), { ok: false, code: 'DIGEST_STALE' });
  assert.deepEqual(await controller.leave({ ...rendered, contextKey: 'f'.repeat(64) }), { ok: false, code: 'DIGEST_STALE' });
  expect(controller, 'published');
  const from = fixture.calls.length;
  const presses = [controller.leave(rendered), controller.leave(rendered)];
  const results = await Promise.all(presses);
  assert.deepEqual(results.map(result => result.ok), [true, false]);
  assert.deepEqual(results[1], { ok: false, code: 'IN_FLIGHT' }, 'a second press during the check hands over nothing');
  assert.deepEqual(sinceIndex(fixture, from), ['ui.context'], 'one fresh context read, no mutation');
  const first = must(results[0]);
  if (!first.ok) throw new Error('expected a handoff');
  assert.equal(controller.snapshot().kind, 'left', 'cancelled before the parent is given the handoff');
  assert.deepEqual(Object.keys(first), ['ok', 'admit'], 'no handoff is released before admission');
  assert.deepEqual(first.admit(), published.handoff);
  assert.equal(first.admit(), null, 'the admission is consumed once');
  assertNeutral(controller);
  assert.deepEqual(await controller.leave(rendered), { ok: false, code: 'SELECTION_INVALID' }, 'a retained old control finds nothing');
  assert.equal(fixture.count('ontology.publish'), 1);
  // After a cancel, a lock, a dead guard or a context replacement the retained pin hands over nothing.
  const scenarios: Array<[string, (context: Awaited<ReturnType<typeof readyToPublish>>) => void, FirstRunCode, FirstRunState['kind']]> = [
    ['cancel', context => context.controller.cancel(), 'SELECTION_INVALID', 'idle'],
    ['lock', context => { context.live.set(false); context.controller.invalidate('VAULT_LOCKED'); }, 'SELECTION_INVALID', 'unavailable'],
    ['guard', context => context.live.set(false), 'NO_AUTHORITY', 'unavailable'],
    ['context', context => context.fixture.touch(), 'CONTEXT_CHANGED', 'unavailable'],
    ['seat', context => context.fixture.bumpEpoch(), 'ACCESS_DENIED', 'unavailable'],
  ];
  for (const [name, disturb, code, kind] of scenarios) {
    const context = await readyToPublish();
    assert.deepEqual(await context.controller.publishDictionary(context.pin), { ok: true }, name);
    const retained = handoffPinOf(expect(context.controller, 'published'));
    disturb(context);
    assert.deepEqual(await context.controller.leave(retained), { ok: false, code }, name);
    assert.equal(context.controller.snapshot().kind, kind, name);
    assertNeutral(context.controller);
    assert.equal(context.fixture.count('ontology.publish'), 1, name);
  }
  // A guard that dies during the fresh read hands over nothing either.
  const dying = await readyToPublish();
  assert.deepEqual(await dying.controller.publishDictionary(dying.pin), { ok: true });
  const dyingPin = handoffPinOf(expect(dying.controller, 'published'));
  const gate = hold(dying.fixture, 'ui.context');
  const leaving = dying.controller.leave(dyingPin);
  assert.ok(await issued(dying.fixture, 'ui.context', 6));
  dying.live.set(false);
  gate.resolve(undefined);
  assert.deepEqual(await leaving, { ok: false, code: 'READ_INVALIDATED' });
  expect(dying.controller, 'idle');
});

test('the settings change is a controller-checked departure for the exact rendered review revision, cancelled before the draft is handed over', async () => {
  const { fixture, controller } = await reviewing('ecommerce');
  const review = expect(controller, 'review').review;
  assert.deepEqual(controller.leaveToSettings('c0s0/0'), { ok: false, code: 'DIGEST_STALE' });
  assert.equal(controller.changeMeaning('earned', 'Delivered goods only, by the delivery date in the courier record.', review.revision).ok, true);
  assert.deepEqual(controller.leaveToSettings(review.revision), { ok: false, code: 'DIGEST_STALE' }, 'a control rendered before an edit names a revision that is gone');
  await settle();
  const edited = expect(controller, 'review').review;
  // A retained control from an earlier pack after the pack changed hands over nothing.
  assert.equal(controller.choosePack('retail').ok, true);
  await settle();
  assert.deepEqual(controller.leaveToSettings(edited.revision), { ok: false, code: 'DIGEST_STALE' });
  const retail = expect(controller, 'review').review;
  const result = controller.leaveToSettings(retail.revision);
  if (!result.ok) throw new Error(`expected the retail draft, got ${result.code}`);
  assert.equal(controller.snapshot().kind, 'left', 'cancelled before the parent runs');
  assert.deepEqual(Object.keys(result), ['ok', 'admit'], 'no draft is released before admission');
  const admitted = must(result.admit(), 'admitted draft');
  assert.equal(admitted.pack, 'retail');
  assert.equal(JSON.stringify(admitted), retail.draftJson, 'the exact reviewed draft, edits included');
  assert.equal(result.admit(), null, 'the admission is consumed once');
  assertNeutral(controller);
  assert.deepEqual(controller.leaveToSettings(retail.revision), { ok: false, code: 'SELECTION_INVALID' });
  assert.equal(fixture.count('ontology.publish'), 0);
  // A lock, a dead guard and a publish in flight each refuse.
  const locked = await reviewing();
  locked.live.set(false); locked.controller.invalidate('VAULT_LOCKED');
  assert.deepEqual(locked.controller.leaveToSettings(locked.pin.revision), { ok: false, code: 'SELECTION_INVALID' });
  const dead = await reviewing();
  dead.live.set(false);
  assert.deepEqual(dead.controller.leaveToSettings(dead.pin.revision), { ok: false, code: 'NO_AUTHORITY' });
  const busy = await readyToPublish();
  const gate = hold(busy.fixture, 'ui.context');
  const press = busy.controller.publishDictionary(busy.pin);
  assert.deepEqual(busy.controller.leaveToSettings(busy.pin.revision), { ok: false, code: 'IN_FLIGHT' });
  gate.resolve(undefined);
  assert.equal((await press).ok, true);
});

test('LEFT observers end a departure before any handoff or settings draft can be admitted', async () => {
  type Context = Awaited<ReturnType<typeof readyToPublish>>;
  const losses: Array<[string, (context: Context) => void]> = [
    ['cancel', context => context.controller.cancel()],
    ['lock', context => context.controller.invalidate('VAULT_LOCKED')],
    ['dispose', context => { assert.deepEqual(context.controller.dispose(), { ok: true }); }],
    ['guard', context => context.live.set(false)],
  ];
  for (const [name, lose] of losses) {
    const continuing = await readyToPublish();
    assert.equal((await continuing.controller.publishDictionary(continuing.pin)).ok, true);
    const retained = handoffPinOf(expect(continuing.controller, 'published'));
    continuing.controller.subscribe(() => { if (continuing.controller.snapshot().kind === 'left') lose(continuing); });
    assert.deepEqual(await continuing.controller.leave(retained), { ok: false, code: 'READ_INVALIDATED' }, `Continue/${name}`);
    assertNeutral(continuing.controller);
    assert.equal(continuing.fixture.count('ontology.publish'), 1);

    const settings = await readyToPublish();
    settings.controller.subscribe(() => { if (settings.controller.snapshot().kind === 'left') lose(settings); });
    assert.deepEqual(settings.controller.leaveToSettings(settings.pin.revision), { ok: false, code: 'READ_INVALIDATED' }, `Settings/${name}`);
    assertNeutral(settings.controller);
    assert.equal(settings.fixture.count('ontology.publish'), 0);
  }
});

test('admission at the actual callback closes the queued microtask gap and is consumed even when refused', async () => {
  type Context = Awaited<ReturnType<typeof readyToPublish>>;
  const losses: Array<[string, (context: Context) => void]> = [
    ['cancel', context => context.controller.cancel()],
    ['lock', context => context.controller.invalidate('VAULT_LOCKED')],
    ['dispose', context => { assert.deepEqual(context.controller.dispose(), { ok: true }); }],
    ['guard', context => context.live.set(false)],
  ];
  for (const [name, lose] of losses) {
    const continuing = await readyToPublish();
    assert.equal((await continuing.controller.publishDictionary(continuing.pin)).ok, true);
    const retained = handoffPinOf(expect(continuing.controller, 'published'));
    continuing.controller.subscribe(() => {
      if (continuing.controller.snapshot().kind === 'left') queueMicrotask(() => lose(continuing));
    });
    let callbacks = 0;
    const result = await continuing.controller.leave(retained).then(result => {
      const handoff = result.ok ? result.admit() : null;
      if (handoff !== null) callbacks += 1;
      return result;
    });
    assert.equal(result.ok, true, `${name}: synchronous departure allowed before the queued loss`);
    assert.equal(callbacks, 0, `Continue/${name}`);
    if (!result.ok) throw new Error('expected an admission');
    assert.equal(result.admit(), null, `${name}: a refused admission is spent`);
    assertNeutral(continuing.controller);
    continuing.live.set(true);
    assert.equal(result.admit(), null, `${name}: authority restoration cannot revive a spent admission`);
    assert.equal(continuing.fixture.count('ontology.publish'), 1);

    const settings = await readyToPublish();
    settings.controller.subscribe(() => {
      if (settings.controller.snapshot().kind === 'left') queueMicrotask(() => lose(settings));
    });
    const settingsResult = settings.controller.leaveToSettings(settings.pin.revision);
    assert.equal(settingsResult.ok, true);
    await Promise.resolve();
    if (!settingsResult.ok) throw new Error('expected a settings admission');
    const draft = settingsResult.admit();
    if (draft !== null) callbacks += 1;
    assert.equal(callbacks, 0, `Settings/${name}`);
    assert.equal(settingsResult.admit(), null);
    assertNeutral(settings.controller);
    assert.equal(settings.fixture.count('ontology.publish'), 0);
  }
});

test('a valid admission invokes the parent once while LEFT, and an earlier departure cannot admit during a later LEFT', async () => {
  const continuing = await readyToPublish();
  assert.equal((await continuing.controller.publishDictionary(continuing.pin)).ok, true);
  const result = await continuing.controller.leave(handoffPinOf(expect(continuing.controller, 'published')));
  let callbacks = 0;
  const forward = () => {
    const handoff = result.ok ? result.admit() : null;
    if (handoff !== null) {
      callbacks += 1;
      assert.equal(continuing.controller.snapshot().kind, 'left');
      assertNeutral(continuing.controller);
      assert.equal(handoff.pending.calendar, 'not-configured');
      assert.equal(handoff.pending.timeZone, 'not-configured');
      assert.equal(handoff.pending.ordering, 'not-configured');
      assert.equal(handoff.pending.todayDefaults, 'not-configured');
    }
  };
  forward(); forward();
  assert.equal(callbacks, 1);

  const settings = await reviewing();
  const old = settings.controller.leaveToSettings(settings.pin.revision);
  assert.equal(old.ok, true);
  assert.equal((await settings.controller.load()).ok, true);
  assert.equal(settings.controller.choosePack('retail').ok, true);
  await settle();
  const next = settings.controller.leaveToSettings(expect(settings.controller, 'review').review.revision);
  if (!old.ok || !next.ok) throw new Error('expected settings admissions');
  assert.equal(settings.controller.snapshot().kind, 'left');
  assert.equal(old.admit(), null, 'the exact departure generation is required even when LEFT identity is reused');
  assert.equal(old.admit(), null);
  assert.equal(must(next.admit()).pack, 'retail');
  assert.equal(next.admit(), null);
  assert.equal(settings.fixture.count('ontology.publish'), 0);
});

test('failed raw continuations neutralize a dead guard without losing the private unresolved fence or retrying', async () => {
  const variants: Array<[string, (defaults: () => unknown) => unknown, FirstRunCode, boolean]> = [
    ['REQUEST_FAILED', () => { throw refusal('REQUEST_FAILED'); }, 'PUBLISH_UNKNOWN', true],
    ['invalid reply', () => ({}), 'INVALID_REPLY', true],
    ['bad hash', defaults => ({ ...(defaults() as Record<string, unknown>), hash: 'e'.repeat(64) }), 'PUBLISH_MISMATCH', true],
    ['Engine INVALID_DICTIONARY', () => { throw refusal('INVALID_DICTIONARY'); }, 'PUBLISH_REFUSED', false],
  ];
  for (const [name, fail, code, unresolved] of variants) {
    const context = await readyToPublish();
    context.fixture.onRequest((method, _payload, defaults) => {
      if (method !== 'ontology.publish') return undefined;
      context.fixture.onRequest(null);
      context.live.set(false);
      return fail(defaults);
    });
    assert.deepEqual(await context.controller.publishDictionary(context.pin), { ok: false, code }, name);
    assertNeutral(context.controller);
    assert.equal(context.controller.issuance(), unresolved ? 'unresolved' : 'none', name);
    if (unresolved) {
      assert.equal(expect(context.controller, 'unknown').attempt, null, name);
      assert.deepEqual(await context.controller.publishDictionary(context.pin), { ok: false, code: 'PUBLISH_UNRESOLVED' }, name);
      assert.deepEqual(await context.controller.load(), { ok: false, code: 'PUBLISH_UNRESOLVED' }, name);
      assert.deepEqual(await context.controller.reconcile(), { ok: false, code: 'NO_AUTHORITY' }, name);
    } else {
      assert.equal(context.controller.snapshot().kind, 'unavailable', name);
      assert.deepEqual(context.events, [{ kind: 'issued' }, { kind: 'settled', outcome: 'not-committed' }]);
    }
    assert.equal(context.fixture.count('ontology.publish'), 1, `${name}: no automatic or replayed mutation`);
    assertNeutral(context.controller);
  }
});

test('preflight digest and context rejections with guard loss hide the full review and issue no effect', async () => {
  let rejectNext = false;
  let lose = () => {};
  const digest: TextDigest = async text => {
    if (rejectNext) { rejectNext = false; lose(); throw refusal('REQUEST_FAILED'); }
    return sha256(text);
  };
  const hashing = await readyToPublish('ecommerce', { digest });
  lose = () => hashing.live.set(false);
  rejectNext = true;
  assert.deepEqual(await hashing.controller.publishDictionary(hashing.pin), { ok: false, code: 'REQUEST_FAILED' });
  assertNeutral(hashing.controller);
  assert.equal(hashing.controller.issuance(), 'none');
  assert.equal(hashing.fixture.count('ontology.publish'), 0);

  const reading = await readyToPublish();
  reading.fixture.onRequest(method => {
    if (method !== 'ui.context') return undefined;
    reading.fixture.onRequest(null);
    reading.live.set(false);
    throw refusal('REQUEST_FAILED');
  });
  assert.deepEqual(await reading.controller.publishDictionary(reading.pin), { ok: false, code: 'REQUEST_FAILED' });
  assertNeutral(reading.controller);
  assert.equal(reading.controller.issuance(), 'none');
  assert.equal(reading.fixture.count('ontology.publish'), 0);
});

test('a reconcile context rejection with guard loss hides attempt metadata, pins replay and permits only a later authorized readback', async () => {
  const context = await readyToPublish();
  lostReply(context.fixture, true);
  assert.deepEqual(await context.controller.publishDictionary(context.pin), { ok: false, code: 'PUBLISH_UNKNOWN' });
  assert.equal(expect(context.controller, 'unknown').attempt?.pack, 'ecommerce');
  context.fixture.onRequest(method => {
    if (method !== 'ui.context') return undefined;
    context.fixture.onRequest(null);
    context.live.set(false);
    throw refusal('REQUEST_FAILED');
  });
  assert.deepEqual(await context.controller.reconcile(), { ok: false, code: 'REQUEST_FAILED' });
  assertNeutral(context.controller);
  assert.equal(expect(context.controller, 'unknown').attempt, null);
  assert.equal(context.controller.issuance(), 'unresolved');
  assert.deepEqual(await context.controller.publishDictionary(context.pin), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  assert.equal(context.fixture.count('ontology.publish'), 1);
  context.live.set(true);
  assert.deepEqual(await context.controller.reconcile(), { ok: true });
  assert.equal(context.controller.issuance(), 'none');
  assert.equal(expect(context.controller, 'published').review, null, 'the departed decisions remain hidden after authorized recovery');
  assert.equal(context.fixture.count('ontology.publish'), 1);
});

test('a readback is adopted only if the context is unchanged after every digest await: a change during verification releases nothing', async () => {
  const frozen = await engine();
  const old = frozen.compileRaw(frozen.rawPack(0), 1, MEMBER_ID);
  const gate = gatedDigest();
  const { fixture, controller, pin } = await readyToPublish('ecommerce', { current: old, digest: gate.digest });
  lostReply(fixture, true);
  assert.deepEqual(await controller.publishDictionary(pin), { ok: false, code: 'PUBLISH_UNKNOWN' });
  const held = gate.holdNext();
  const readback = controller.reconcile();
  await held.held;
  fixture.commit(frozen.rawPack(1));
  held.release();
  assert.deepEqual(await readback, { ok: false, code: 'CONTEXT_CHANGED' });
  const still = expect(controller, 'unknown');
  assert.equal(still.attempt?.pack, 'ecommerce');
  assert.equal(controller.issuance(), 'unresolved');
  assert.deepEqual(await controller.reconcile(), { ok: false, code: 'REVIEW_NOT_CURRENT' }, 'the retail dictionary is current now');
  expect(controller, 'unavailable');
});

test('the Engine refusing the dictionary is known not to have committed and returns the review with its code', async () => {
  const { fixture, controller, pin, events } = await readyToPublish();
  fixture.onRequest(method => { if (method !== 'ontology.publish') return undefined; fixture.onRequest(null); throw refusal('INVALID_DEFINITION'); });
  assert.deepEqual(await controller.publishDictionary(pin), { ok: false, code: 'PUBLISH_REFUSED' });
  const state = expect(controller, 'review');
  assert.deepEqual(state.notice, { code: 'PUBLISH_REFUSED', engineCode: 'INVALID_DEFINITION' });
  assert.equal(fixture.current(), null);
  assert.equal(allReviewed(state.review), true, 'the review is intact for a corrected retry by the person');
  assert.deepEqual(events, [{ kind: 'issued' }, { kind: 'settled', outcome: 'not-committed' }]);
  assert.equal(controller.issuance(), 'none');
  assert.deepEqual(await controller.publishDictionary(must(pinOf(state.review))), { ok: true });
  assert.equal(fixture.count('ontology.publish'), 2);
});

test('a refusal code thrown by a later read is not proof of no commit: it stays unresolved', async () => {
  const { fixture, controller, pin } = await readyToPublish();
  fixture.onRequest(method => { if (method !== 'ontology.get') return undefined; fixture.onRequest(null); throw refusal('INVALID_DEFINITION'); });
  assert.deepEqual(await controller.publishDictionary(pin), { ok: false, code: 'PUBLISH_REFUSED' });
  expect(controller, 'unknown');
  assert.equal(controller.issuance(), 'unresolved');
  assert.deepEqual(await controller.reconcile(), { ok: true });
  expect(controller, 'published');
});

test('a reply whose draft, hash, artifacts, version or author does not match, or a readback that differs, is unresolved and never adopted', async () => {
  const frozen = await engine();
  const other = await readyToPublish();
  other.fixture.onRequest((method, _payload, defaults) => { if (method !== 'ontology.publish') return undefined; other.fixture.onRequest(null); defaults(); return other.fixture.commitRaw(frozen.rawPack(2)); });
  assert.deepEqual(await other.controller.publishDictionary(other.pin), { ok: false, code: 'PUBLISH_MISMATCH' });
  expect(other.controller, 'unknown');

  const badHash = await readyToPublish();
  badHash.fixture.onRequest((method, _payload, defaults) => { if (method !== 'ontology.publish') return undefined; badHash.fixture.onRequest(null); return { ...(defaults() as Record<string, unknown>), hash: 'e'.repeat(64) }; });
  assert.deepEqual(await badHash.controller.publishDictionary(badHash.pin), { ok: false, code: 'PUBLISH_MISMATCH' });
  expect(badHash.controller, 'unknown');

  const forgedArtifact = await readyToPublish();
  forgedArtifact.fixture.onRequest((method, _payload, defaults) => {
    if (method !== 'ontology.publish') return undefined;
    forgedArtifact.fixture.onRequest(null);
    const reply = defaults() as Record<string, unknown>;
    const sums = reply.compiledSums as Record<string, unknown>[];
    must(sums[0]).digest = 'e'.repeat(64);
    return rehashed(reply);
  });
  assert.deepEqual(await forgedArtifact.controller.publishDictionary(forgedArtifact.pin), { ok: false, code: 'PUBLISH_MISMATCH' }, 'a consistent overall hash over a forged artifact digest is not Engine proof');
  expect(forgedArtifact.controller, 'unknown');

  const wrongVersion = await readyToPublish();
  wrongVersion.fixture.onRequest((method, _payload, defaults) => { if (method !== 'ontology.publish') return undefined; wrongVersion.fixture.onRequest(null); defaults(); return frozen.compileRaw(frozen.rawPack(0), 7, MEMBER_ID); });
  assert.deepEqual(await wrongVersion.controller.publishDictionary(wrongVersion.pin), { ok: false, code: 'PUBLISH_MISMATCH' }, 'not the version this attempt would produce');
  expect(wrongVersion.controller, 'unknown');

  const wrongAuthor = await readyToPublish();
  wrongAuthor.fixture.onRequest((method, _payload, defaults) => { if (method !== 'ontology.publish') return undefined; wrongAuthor.fixture.onRequest(null); defaults(); return frozen.compileRaw(frozen.rawPack(0), 1, 'someone_else'); });
  assert.deepEqual(await wrongAuthor.controller.publishDictionary(wrongAuthor.pin), { ok: false, code: 'PUBLISH_MISMATCH' }, 'not the author this attempt would produce');
  expect(wrongAuthor.controller, 'unknown');

  const stale = await readyToPublish();
  const before = frozen.compileRaw(frozen.rawPack(3), 9, 'someone_else');
  stale.fixture.onRequest((method, _payload, defaults) => method === 'ontology.get' ? { ...(defaults() as Record<string, unknown>), current: { ...before, hash: 'e'.repeat(64) } } : undefined);
  assert.deepEqual(await stale.controller.publishDictionary(stale.pin), { ok: false, code: 'READBACK_MISMATCH' });
  expect(stale.controller, 'unknown');

  const seat = await readyToPublish();
  seat.fixture.onRequest((method, _payload, defaults) => { if (method !== 'ontology.publish') return undefined; seat.fixture.onRequest(null); const reply = defaults(); seat.fixture.bumpEpoch(); return reply; });
  assert.deepEqual(await seat.controller.publishDictionary(seat.pin), { ok: false, code: 'ACCESS_DENIED' });
  expect(seat.controller, 'unknown');
  for (const context of [other, badHash, forgedArtifact, wrongVersion, wrongAuthor, stale, seat]) {
    assert.equal(context.fixture.count('ontology.publish'), 1);
    assert.equal(context.controller.issuance(), 'unresolved');
    assert.deepEqual(await context.controller.load(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
    onlyKnownMethods(context.fixture);
  }
});

test('a pack change, a lock, a read-only turn and a dispose each drop every decision and keep late evidence out', async () => {
  const changed = await readyToPublish();
  assert.equal(changed.controller.backToPacks().ok, true);
  expect(changed.controller, 'choose');
  changed.controller.choosePack('ecommerce');
  await settle();
  assert.equal(acceptedRows(expect(changed.controller, 'review').review).length, 0);
  assert.equal(expect(changed.controller, 'review').review.settings.accepted, false);

  const locked = await readyToPublish();
  locked.controller.invalidate('VAULT_LOCKED');
  assert.deepEqual(locked.controller.snapshot(), { kind: 'unavailable', code: 'VAULT_LOCKED' });
  assert.equal((await locked.controller.publishDictionary(locked.pin)).ok, false);
  assert.equal(locked.fixture.count('ontology.publish'), 0);

  const readOnly = await readyToPublish();
  readOnly.live.set(false);
  assert.deepEqual(await readOnly.controller.publishDictionary(readOnly.pin), { ok: false, code: 'NO_AUTHORITY' });
  assert.equal(readOnly.fixture.count('ontology.publish'), 0);
  assert.equal(readOnly.controller.acceptRow('billed', readOnly.pin).ok, false);

  const disposed = await readyToPublish();
  const gate = hold(disposed.fixture, 'ui.context');
  const press = disposed.controller.publishDictionary(disposed.pin);
  assert.ok(await issued(disposed.fixture, 'ui.context', 3));
  let notified = 0;
  disposed.controller.subscribe(() => { notified += 1; });
  disposed.controller.dispose();
  assert.equal(notified, 1, 'dispose hides the review: exactly one notification, during dispose');
  gate.resolve(undefined);
  assert.equal((await press).ok, false);
  await settle();
  assert.equal(notified, 1, 'nothing is published to listeners after dispose');
  assert.equal(disposed.fixture.count('ontology.publish'), 0);
  assert.equal(disposed.controller.snapshot().kind, 'idle');
  assert.equal(disposed.controller.choosePack('ecommerce').ok, false);
});

test('a late digest for an earlier draft never lands on a newer review', async () => {
  const fixture = await syntheticEngine();
  const gates: Array<{ text: string; resolve: (value: string) => void }> = [];
  const slow: TextDigest = text => new Promise<string>(resolve => { gates.push({ text, resolve }); });
  const controller = createFirstRunController(fixture.port, { guard: guard(), digest: slow });
  await controller.load();
  controller.choosePack('ecommerce');
  controller.choosePack('retail');
  assert.equal(gates.length, 2);
  const first = must(gates[0]);
  first.resolve(sha256(first.text));
  await settle();
  assert.equal(expect(controller, 'review').review.digest, null, 'the ecommerce digest did not land on the retail review');
  const second = must(gates[1]);
  second.resolve(sha256(second.text));
  await settle();
  const review = expect(controller, 'review').review;
  assert.equal(review.pack, 'retail');
  assert.equal(review.digest, sha256(draftJson(review.draft)));
});

test('publishing again over an existing dictionary reports the current one, pins it as the baseline and makes the next version', async () => {
  const frozen = await engine();
  const existing = frozen.compileRaw(frozen.rawPack(0), 1, MEMBER_ID);
  const { controller, pin } = await reviewing('services', { current: existing });
  assert.equal(expect(controller, 'review').current?.version, 1);
  acceptEverything(controller, pin);
  assert.equal((await controller.publishDictionary(pin)).ok, true);
  const state = expect(controller, 'published');
  assert.equal(state.published.version, 2);
  assert.notEqual(state.published.hash, existing.hash);
});

test('attempt IDs are generated once and remain private and stable while a null lookup waits for a later commit', async () => {
  let generated = 0;
  const context = await readyToPublish('ecommerce', { createAttemptId: () => { generated += 1; return 'stable_pending_attempt'; } });
  const accepted: { commit: (() => unknown) | null } = { commit: null };
  context.fixture.onRequest((method, _payload, defaults) => {
    if (method !== 'ontology.publish') return undefined;
    context.fixture.onRequest(null);
    accepted.commit = defaults;
    throw new Error('response lost before the accepted operation completed');
  });
  assert.deepEqual(await context.controller.publishDictionary(context.pin), { ok: false, code: 'PUBLISH_UNKNOWN' });
  context.controller.cancel();
  assertNeutral(context.controller);
  assert.deepEqual(await context.controller.reconcile(), { ok: false, code: 'PUBLISH_UNKNOWN' });
  assert.equal(context.controller.issuance(), 'unresolved');
  assert.deepEqual(context.controller.dispose(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
  assert.equal(context.fixture.count('ontology.publish'), 1);
  must(accepted.commit)();
  assert.deepEqual(await context.controller.reconcile(), { ok: true });
  assert.equal(expect(context.controller, 'published').review, null);
  assert.equal(generated, 1);
  const lookups = context.fixture.calls.filter(call => call.method === 'ontology.get').slice(1);
  assert.ok(lookups.length >= 2);
  for (const lookup of lookups) assert.deepEqual(lookup.payload, { attemptId: 'stable_pending_attempt' });
  assert.equal(context.fixture.count('ontology.publish'), 1, 'recovery never retries');
});

test('the injected attempt factory cannot issue after cancelling, locking, disposing or killing the live guard', async () => {
  for (const action of ['cancel', 'lock', 'dispose', 'guard'] as const) {
    const context = await readyToPublish('ecommerce', { createAttemptId: () => {
      if (action === 'cancel') context.controller.cancel();
      if (action === 'lock') context.controller.invalidate('VAULT_LOCKED');
      if (action === 'dispose') context.controller.dispose();
      if (action === 'guard') context.live.set(false);
      return 'reentrant_attempt';
    } });
    assert.equal((await context.controller.publishDictionary(context.pin)).ok, false, action);
    assert.equal(context.fixture.count('ontology.publish'), 0, action);
    assert.equal(context.controller.issuance(), 'none', action);
    assert.deepEqual(context.events, []);
    assertNeutral(context.controller);
  }
  const malformed = await readyToPublish('ecommerce', { createAttemptId: () => 'invalid attempt identity' });
  assert.deepEqual(await malformed.controller.publishDictionary(malformed.pin), { ok: false, code: 'PUBLISH_REFUSED' });
  assert.deepEqual(expect(malformed.controller, 'review').notice, { code: 'PUBLISH_REFUSED', engineCode: 'INVALID_DICTIONARY_OPTIONS' });
  assert.equal(malformed.fixture.count('ontology.publish'), 0);
  assert.deepEqual(malformed.events, []);
});

test('a competing publication after preflight is atomically refused against the pinned baseline', async () => {
  const context = await readyToPublish();
  const frozen = await engine();
  context.fixture.onRequest((method, _payload, defaults) => {
    if (method !== 'ontology.publish') return undefined;
    context.fixture.onRequest(null);
    context.fixture.commitRaw(frozen.rawPack(1));
    return defaults();
  });
  assert.deepEqual(await context.controller.publishDictionary(context.pin), { ok: false, code: 'PUBLISH_REFUSED' });
  assert.deepEqual(expect(context.controller, 'review').notice, { code: 'PUBLISH_REFUSED', engineCode: 'DICTIONARY_CONFLICT' });
  assert.equal(must(context.fixture.current()).pack, 'retail');
  assert.equal(must(context.fixture.current()).version, 1);
  assert.equal(context.controller.issuance(), 'none');
  assert.deepEqual(context.events, [{ kind: 'issued' }, { kind: 'settled', outcome: 'not-committed' }]);
  const payload = context.fixture.calls.find(call => call.method === 'ontology.publish')?.payload as { attemptId: string };
  const readback = await context.fixture.port.request('ontology.get', { attemptId: payload.attemptId }) as { attempt: unknown; history: unknown[] };
  assert.equal(readback.attempt, null);
  assert.equal(readback.history.length, 1);
});

test('every receipt binding must match the private attempt; invalid lookup evidence never releases it', async () => {
  const mutations: Readonly<Record<keyof DictionaryPublicationReceipt, unknown>> = {
    attemptId: 'another_attempt', workspaceId: 'another_workspace', memberId: 'another_member', epoch: 2,
    draftDigest: 'd'.repeat(64), expectedCurrentHash: 'b'.repeat(64), dictionaryHash: 'e'.repeat(64), version: 2,
  };
  for (const [field, value] of Object.entries(mutations)) {
    const context = await readyToPublish();
    lostReply(context.fixture, true);
    await context.controller.publishDictionary(context.pin);
    context.fixture.onRequest((method, _payload, defaults) => {
      if (method !== 'ontology.get') return undefined;
      const readback = defaults() as { attempt: DictionaryPublicationReceipt; current: unknown; history: unknown[] };
      return { ...readback, attempt: { ...readback.attempt, [field]: value } };
    });
    assert.equal((await context.controller.reconcile()).ok, false, field);
    expect(context.controller, 'unknown');
    assert.equal(context.controller.issuance(), 'unresolved', field);
    assert.equal(context.events.some(event => event.kind === 'resolved'), false, field);
    assert.equal(context.fixture.count('ontology.publish'), 1);
    context.controller.cancel();
    assertNeutral(context.controller);
  }
});

test('a known refusal during receipt lookup remains unknown, while the same code at raw dispatch proves noncommit', async () => {
  for (const code of ['INVALID_DICTIONARY_OPTIONS', 'INVALID_DICTIONARY_RECEIPT', 'DICTIONARY_REVIEW_REQUIRED', 'DICTIONARY_CONFLICT', 'DICTIONARY_ATTEMPT_REUSED', 'DICTIONARY_ATTEMPT_AUTHORITY']) {
    const raw = await readyToPublish();
    raw.fixture.onRequest(method => { if (method === 'ontology.publish') throw refusal(code); return undefined; });
    assert.deepEqual(await raw.controller.publishDictionary(raw.pin), { ok: false, code: 'PUBLISH_REFUSED' }, code);
    assert.equal(raw.controller.issuance(), 'none', code);
    const lookup = await readyToPublish();
    lostReply(lookup.fixture, true);
    await lookup.controller.publishDictionary(lookup.pin);
    lookup.fixture.onRequest(method => { if (method === 'ontology.get') throw refusal(code); return undefined; });
    assert.deepEqual(await lookup.controller.reconcile(), { ok: false, code: 'PUBLISH_REFUSED' }, code);
    assert.equal(lookup.controller.issuance(), 'unresolved', code);
    assert.equal(lookup.events.some(event => event.kind === 'resolved'), false, code);
    if (code === 'DICTIONARY_ATTEMPT_AUTHORITY') assertNeutral(lookup.controller);
  }
});

test('a scoped attempt authority rejection hides decisions even while the local guard is live', async () => {
  const context = await readyToPublish();
  context.fixture.onRequest(method => method === 'ontology.get' ? (() => { throw refusal('DICTIONARY_ATTEMPT_AUTHORITY'); })() : undefined);
  assert.deepEqual(await context.controller.publishDictionary(context.pin), { ok: false, code: 'PUBLISH_REFUSED' });
  assertNeutral(context.controller);
  assert.equal(context.controller.issuance(), 'unresolved');
  assert.equal(expect(context.controller, 'unknown').attempt, null);
  assert.deepEqual(await context.controller.reconcile(), { ok: false, code: 'PUBLISH_REFUSED' });
  assertNeutral(context.controller);
  context.fixture.onRequest(null);
  assert.deepEqual(await context.controller.reconcile(), { ok: true });
  assert.equal(expect(context.controller, 'published').review, null, 'held decisions cannot reappear after an authority denial');
  assert.equal(context.fixture.count('ontology.publish'), 1);
});

test('an identical retained payload returns its original dictionary after supersession without enabling an old handoff', async () => {
  const context = await readyToPublish();
  lostReply(context.fixture, true);
  await context.controller.publishDictionary(context.pin);
  const original = must(context.fixture.current());
  const captured = context.fixture.calls.find(call => call.method === 'ontology.publish')?.payload as { draft: unknown; expectedCurrentHash: string | null; attemptId: string };
  const payload = { ...captured, draft: validateDraft(captured.draft) };
  const newer = context.fixture.commitRaw((await engine()).rawPack(1));
  const returned = await context.fixture.port.request('ontology.publish', payload);
  assert.deepEqual(returned, original);
  assert.equal(must(context.fixture.current()).hash, newer.hash);
  assert.equal(must(context.fixture.current()).version, 2);
  await assert.rejects(context.fixture.port.request('ontology.publish', { ...payload, expectedCurrentHash: 'e'.repeat(64) }), { code: 'DICTIONARY_ATTEMPT_REUSED' });
  assert.deepEqual(await context.controller.reconcile(), { ok: false, code: 'REVIEW_NOT_CURRENT' });
  assert.equal(context.controller.issuance(), 'none');
  assert.deepEqual(context.controller.snapshot(), { kind: 'unavailable', code: 'REVIEW_NOT_CURRENT' });
  assert.deepEqual(await context.controller.leave({ hash: original.hash, contextKey: context.fixture.contextKey(), reviewDigest: context.pin.digest }), { ok: false, code: 'SELECTION_INVALID' });
});

test('a receipt cannot adopt an inconsistent current/history pair or an unchanged publication context', async () => {
  for (const mode of ['current-history', 'unchanged-context'] as const) {
    const context = await readyToPublish();
    const reviewedKey = expect(context.controller, 'review').context.contextKey;
    const other = (await engine()).compileRaw((await engine()).rawPack(1), 2, MEMBER_ID);
    context.fixture.onRequest((method, _payload, defaults) => {
      if (method === 'ontology.get' && mode === 'current-history') return { ...(defaults() as Record<string, unknown>), current: other };
      if (method === 'ui.context' && mode === 'unchanged-context') return { ...(defaults() as Record<string, unknown>), contextKey: reviewedKey };
      return undefined;
    });
    assert.deepEqual(await context.controller.publishDictionary(context.pin), { ok: false, code: 'READBACK_MISMATCH' }, mode);
    assert.equal(context.controller.issuance(), 'unresolved');
    assert.equal(context.events.some(event => event.kind === 'resolved'), false);
    assert.deepEqual(await context.controller.reconcile(), { ok: false, code: 'READBACK_MISMATCH' }, mode);
    assert.equal(context.controller.issuance(), 'unresolved');
    context.fixture.onRequest(null);
    assert.deepEqual(await context.controller.reconcile(), { ok: true });
    assert.equal(context.fixture.count('ontology.publish'), 1);
  }
});

test('missing or null attempt lookup evidence never releases the attempt even after a matching dictionary committed', async () => {
  for (const missing of [true, false]) {
    const context = await readyToPublish();
    lostReply(context.fixture, true);
    await context.controller.publishDictionary(context.pin);
    context.fixture.onRequest((method, _payload, defaults) => {
      if (method !== 'ontology.get') return undefined;
      const reply = defaults() as { current: unknown; history: unknown[]; attempt: unknown };
      return missing ? { current: reply.current, history: reply.history } : { ...reply, attempt: null };
    });
    assert.equal((await context.controller.reconcile()).ok, false);
    assert.equal(context.controller.issuance(), 'unresolved');
    assert.equal(context.events.some(event => event.kind === 'resolved'), false);
    assert.deepEqual(context.controller.dispose(), { ok: false, code: 'PUBLISH_UNRESOLVED' });
    context.fixture.onRequest(null);
    assert.deepEqual(await context.controller.reconcile(), { ok: true });
    assert.equal(context.fixture.count('ontology.publish'), 1);
  }
});

test('selected historical receipt evidence must verify its whole hash and compiled proof before releasing the attempt', async () => {
  for (const mode of ['hash', 'compiled-proof'] as const) {
    const context = await readyToPublish();
    lostReply(context.fixture, true);
    await context.controller.publishDictionary(context.pin);
    context.fixture.commitRaw((await engine()).rawPack(1));
    context.fixture.onRequest((method, _payload, defaults) => {
      if (method !== 'ontology.get') return undefined;
      const reply = defaults() as { current: unknown; history: Record<string, unknown>[]; attempt: DictionaryPublicationReceipt };
      let selected = must(reply.history[0]);
      if (mode === 'hash') selected.hash = 'e'.repeat(64);
      else {
        must((selected.compiledSums as Record<string, unknown>[])[0]).digest = 'e'.repeat(64);
        selected = rehashed(selected);
      }
      return { ...reply, history: [selected, ...reply.history.slice(1)], attempt: { ...reply.attempt, dictionaryHash: selected.hash } };
    });
    assert.deepEqual(await context.controller.reconcile(), { ok: false, code: 'READBACK_MISMATCH' }, mode);
    assert.equal(context.controller.issuance(), 'unresolved');
    assert.equal(context.events.some(event => event.kind === 'resolved'), false);
    context.fixture.onRequest(null);
    assert.deepEqual(await context.controller.reconcile(), { ok: false, code: 'REVIEW_NOT_CURRENT' });
    assert.equal(context.controller.issuance(), 'none');
    assert.equal(context.fixture.count('ontology.publish'), 1);
  }
});

test('a final live guard that synchronously cancels or locks cannot resurrect publication decisions', async () => {
  for (const action of ['cancel', 'lock'] as const) {
    const fixture = await syntheticEngine();
    let reenter = false;
    const controller = createFirstRunController(fixture.port, { digest: nodeDigest, createAttemptId, guard: { live: () => {
      if (reenter) {
        reenter = false;
        if (action === 'cancel') controller.cancel();
        else controller.invalidate('VAULT_LOCKED');
      }
      return true;
    } } });
    const events: IssuanceEvent[] = [];
    controller.onIssuance(event => { events.push(event); });
    assert.deepEqual(await controller.load(), { ok: true });
    assert.equal(controller.choosePack('ecommerce').ok, true);
    await settle();
    const pin = must(pinOf(expect(controller, 'review').review));
    acceptEverything(controller, pin);
    fixture.onRequest((method, _payload, defaults) => {
      if (method === 'ui.context' && fixture.count('ontology.publish') === 1 && fixture.count('ontology.get') === 2) {
        fixture.onRequest(null);
        reenter = true;
        return defaults();
      }
      return undefined;
    });
    assert.deepEqual(await controller.publishDictionary(pin), { ok: false, code: 'READ_INVALIDATED' }, action);
    assertNeutral(controller);
    assert.equal(controller.issuance(), 'unresolved');
    assert.equal(events.some(event => event.kind === 'resolved'), false);
    assert.deepEqual(await controller.reconcile(), { ok: true });
    assert.equal(expect(controller, 'published').review, null);
    assert.equal(fixture.count('ontology.publish'), 1);
  }
});

test('reentry from every load guard preserves cancellation, lock or disposal and stops the next read', async () => {
  for (const role of ['owner', 'viewer'] as const) {
    for (const at of role === 'owner' ? [1, 2, 3, 4, 5, 6] : [1, 2]) {
      for (const action of ['cancel', 'lock', 'dispose'] as const) {
        const fixture = await syntheticEngine({ role });
        let guards = 0;
        const controller = createFirstRunController(fixture.port, { digest: nodeDigest, createAttemptId, guard: { live: () => {
          guards += 1;
          if (guards === at) {
            if (action === 'cancel') controller.cancel();
            else if (action === 'lock') controller.invalidate('VAULT_LOCKED');
            else controller.dispose();
          }
          return true;
        } } });
        assert.deepEqual(await controller.load(), { ok: false, code: 'READ_INVALIDATED' }, `${role}/${at}/${action}`);
        assertNeutral(controller);
        assert.deepEqual(controller.snapshot(), action === 'lock' ? { kind: 'unavailable', code: 'VAULT_LOCKED' } : { kind: 'idle' });
        assert.equal(fixture.calls.length, [0, 1, 2, 3, 3, 4][at - 1]);
        assert.equal(fixture.count('ontology.publish'), 0);
      }
    }
  }
});

test('entry guards cannot revive captured reviews, attempts, handoffs or settings drafts after cancelling or locking', async () => {
  for (const operation of ['load', 'choose', 'back', 'row', 'settings', 'meaning', 'publish', 'reconcile', 'leave', 'leave-settings'] as const) {
    for (const action of ['cancel', 'lock'] as const) {
      const context = await readyToPublish();
      if (operation === 'leave') assert.deepEqual(await context.controller.publishDictionary(context.pin), { ok: true });
      if (operation === 'reconcile') {
        lostReply(context.fixture, true);
        await context.controller.publishDictionary(context.pin);
      }
      const shown = context.controller.snapshot();
      const from = context.fixture.calls.length, events = context.events.length;
      const original = context.live.live;
      context.live.live = () => {
        context.live.live = original;
        if (action === 'cancel') context.controller.cancel();
        else context.controller.invalidate('VAULT_LOCKED');
        return true;
      };
      const result = await (() => {
        switch (operation) {
          case 'load': return context.controller.load();
          case 'choose': return context.controller.choosePack('retail');
          case 'back': return context.controller.backToPacks();
          case 'row': return context.controller.acceptRow('billed', context.pin);
          case 'settings': return context.controller.acceptSettings(context.pin);
          case 'meaning': return context.controller.changeMeaning('billed', 'The reviewed invoiced amount.', context.pin.revision);
          case 'publish': return context.controller.publishDictionary(context.pin);
          case 'reconcile': return context.controller.reconcile();
          case 'leave': {
            assert.equal(shown.kind, 'published');
            return context.controller.leave(handoffPinOf(shown as Extract<FirstRunState, { kind: 'published' }>));
          }
          case 'leave-settings': return context.controller.leaveToSettings(context.pin.revision);
        }
      })();
      assert.deepEqual(result, { ok: false, code: 'READ_INVALIDATED' }, `${operation}/${action}`);
      assertNeutral(context.controller);
      assert.equal(context.fixture.calls.length, from, 'the invalidated entry reads or dispatches nothing');
      assert.equal(context.events.length, events);
      if (operation === 'reconcile') {
        assert.equal(context.controller.issuance(), 'unresolved');
        assert.equal(expect(context.controller, 'unknown').attempt, null);
        assert.deepEqual(await context.controller.reconcile(), { ok: true });
        assert.equal(expect(context.controller, 'published').review, null);
        assert.equal(context.fixture.count('ontology.publish'), 1);
      }
    }
  }
});

test('a guard that replaces the review cannot apply a captured decision or digest failure to the new review', async () => {
  const context = await reviewing();
  const original = context.live.live;
  context.live.live = () => {
    context.live.live = original;
    assert.equal(context.controller.choosePack('retail').ok, true);
    return true;
  };
  assert.deepEqual(context.controller.acceptRow('billed', context.pin), { ok: false, code: 'READ_INVALIDATED' });
  await settle();
  assert.equal(expect(context.controller, 'review').review.pack, 'retail');
  assert.deepEqual(acceptedRows(expect(context.controller, 'review').review), []);

  const gate = deferred<string>();
  let holdDigest = false;
  const delayed = await reviewing('ecommerce', { digest: text => holdDigest ? gate.promise : nodeDigest(text) });
  holdDigest = true;
  assert.equal(delayed.controller.choosePack('retail').ok, true);
  const guardLive = delayed.live.live;
  delayed.live.live = () => {
    delayed.live.live = guardLive;
    holdDigest = false;
    assert.equal(delayed.controller.choosePack('services').ok, true);
    return true;
  };
  gate.reject(new Error('digest unavailable'));
  await settle();
  assert.equal(expect(delayed.controller, 'review').review.pack, 'services');
  assert.notEqual(expect(delayed.controller, 'review').review.digest, null);
});

test('an observer that ends loading or reconciliation prevents its first context read', async () => {
  const loading = await syntheticEngine();
  const first = createFirstRunController(loading.port, { digest: nodeDigest, guard: guard(), createAttemptId });
  first.subscribe(() => { if (first.snapshot().kind === 'loading') first.cancel(); });
  assert.deepEqual(await first.load(), { ok: false, code: 'READ_INVALIDATED' });
  assert.deepEqual(loading.calls, []);
  assertNeutral(first);
  const context = await readyToPublish();
  lostReply(context.fixture, true);
  await context.controller.publishDictionary(context.pin);
  const from = context.fixture.calls.length;
  context.controller.subscribe(() => {
    const shown = context.controller.snapshot();
    if (shown.kind === 'unknown' && shown.reconciling) context.controller.cancel();
  });
  assert.deepEqual(await context.controller.reconcile(), { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(context.fixture.calls.length, from);
  assertNeutral(context.controller);
  assert.equal(context.controller.issuance(), 'unresolved');
});
