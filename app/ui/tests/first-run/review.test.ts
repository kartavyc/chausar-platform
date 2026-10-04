import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDraft } from '../../src/screens/first-run/contracts.ts';
import { definitionJson, draftJson, settingsJson } from '../../src/screens/first-run/digest.ts';
import { acceptRow, acceptSettings, acceptedRows, allReviewed, changeMeaning, pinMatches, pinOf, rowAccepted, settingsAccepted, startReview, withDigest } from '../../src/screens/first-run/review.ts';
import type { Review, ReviewPin, ReviewRow } from '../../src/screens/first-run/review.ts';
import { engine } from './fixture.ts';

const DIGEST = 'd'.repeat(64);
const GENERATION = 'c1s1';
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`missing ${what}`); return value; };
const names = ['billed', 'received', 'earned', 'refunds', 'costs', 'purchases'];
const pack = async (index = 0) => validateDraft((await engine()).rawPack(index));
const pinned = (review: Review): ReviewPin => must(pinOf(review), 'pin');
const rowNamed = (review: Review, name: string): ReviewRow => must(review.rows.find(row => row.definition.name === name), name);
function acceptAll(review: Review): Review {
  let next = review;
  for (const name of names) next = must(acceptRow(next, name, pinned(next)), name);
  return must(acceptSettings(next, pinned(next)), 'settings');
}

test('a new review proposes everything, accepts nothing, has no digest yet and carries its generation', async () => {
  const review = startReview(await pack(), GENERATION);
  assert.equal(review.digest, null);
  assert.equal(review.generation, GENERATION);
  assert.equal(review.revision, `${GENERATION}/0`);
  assert.equal(pinOf(review), null, 'no pin exists before the digest');
  assert.deepEqual(review.rows.map(row => row.status), names.map(() => 'proposed'));
  assert.deepEqual(review.rows.map(row => row.definition.name), names);
  assert.equal(review.settings.accepted, false);
  assert.equal(allReviewed(review), false);
  assert.equal(review.draftJson, draftJson(review.draft));
});

test('only an Accept with the current revision and digest accepts, and it pins the exact definition text', async () => {
  const fresh = startReview(await pack(), GENERATION);
  assert.equal(acceptRow(fresh, 'billed', { revision: fresh.revision, digest: DIGEST }), null, 'no digest yet: nothing is accepted');
  const review = withDigest(fresh, DIGEST);
  const pin = pinned(review);
  assert.deepEqual(pin, { revision: `${GENERATION}/0`, digest: DIGEST });
  assert.equal(acceptRow(review, 'billed', { ...pin, digest: 'e'.repeat(64) }), null, 'a stale digest is refused');
  assert.equal(acceptRow(review, 'billed', { ...pin, revision: 'c1s0/0' }), null, 'another generation is refused even with the same digest');
  assert.equal(acceptRow(review, 'missing', pin), null, 'an unknown row is refused');
  const accepted = must(acceptRow(review, 'billed', pin));
  const row = rowNamed(accepted, 'billed');
  assert.ok(rowAccepted(row));
  assert.equal(row.pin, definitionJson(row.definition));
  assert.equal(acceptRow(accepted, 'billed', pin), null, 'accepting twice changes nothing');
  assert.equal(acceptedRows(accepted).length, 1);
  assert.equal(allReviewed(accepted), false);
  assert.equal(pinMatches(accepted, pin), true, 'an acceptance does not move the revision');
});

test('all rows plus the settings make the review complete; a pack change starts from nothing with a new generation', async () => {
  let review = withDigest(startReview(await pack(), GENERATION), DIGEST);
  for (const name of names) review = must(acceptRow(review, name, pinned(review)), name);
  assert.equal(allReviewed(review), false, 'the settings still need an answer');
  assert.equal(acceptSettings(review, { ...pinned(review), digest: 'e'.repeat(64) }), null);
  assert.equal(acceptSettings(review, { ...pinned(review), revision: 'c9s9/0' }), null);
  const complete = must(acceptSettings(review, pinned(review)));
  assert.ok(settingsAccepted(complete));
  assert.equal(complete.settings.pin, settingsJson(complete.draft));
  assert.equal(allReviewed(complete), true);
  const again = withDigest(startReview(await pack(), 'c1s2'), DIGEST);
  assert.equal(acceptedRows(again).length, 0);
  assert.equal(again.settings.accepted, false);
  assert.equal(again.digest, complete.digest, 'the same bytes give the same digest');
  assert.notEqual(again.revision, complete.revision, 'but never the same revision');
  assert.equal(acceptRow(again, 'billed', pinned(complete)), null, 'a pin from the earlier review of the same pack is refused');
});

test('a changed meaning resets only that row, clears the digest, moves the revision, keeps the original text and the other bindings', async () => {
  const settled = acceptAll(withDigest(startReview(await pack(), GENERATION), DIGEST));
  const edited = 'Delivered goods only, by the delivery date in the courier record.';
  assert.equal(changeMeaning(settled, 'earned', edited, 'c1s1/9'), null, 'an editor rendered for another revision changes nothing');
  const changed = must(changeMeaning(settled, 'earned', edited, settled.revision));
  assert.equal(changed.digest, null, 'the whole-draft digest must be computed again');
  assert.equal(changed.revision, `${GENERATION}/1`);
  assert.equal(changed.generation, GENERATION);
  assert.equal(allReviewed(changed), false);
  const earned = rowNamed(changed, 'earned');
  assert.equal(earned.status, 'changed');
  assert.equal(earned.pin, null);
  assert.equal(earned.definition.meaning, edited);
  assert.equal(earned.proposed, rowNamed(settled, 'earned').definition.meaning, 'the Engine text is kept beside the change');
  assert.equal(acceptedRows(changed).length, names.length - 1, 'other rows keep their exact pins');
  assert.ok(settingsAccepted(changed), 'the settings pin still names the unchanged settings');
  assert.equal(changed.draftJson, draftJson(changed.draft));
  assert.notEqual(changed.draftJson, settled.draftJson);
  assert.equal(changeMeaning(settled, 'earned', 'short', settled.revision), null, 'invalid text changes nothing');
  assert.equal(changeMeaning(settled, 'earned', rowNamed(settled, 'earned').definition.meaning, settled.revision), null, 'the same text changes nothing');
  const rehashed = withDigest(changed, 'f'.repeat(64));
  assert.equal(acceptRow(rehashed, 'earned', pinned(settled)), null, 'an Accept rendered before the edit names a revision that no longer exists');
  const back = must(changeMeaning(rehashed, 'earned', earned.proposed, rehashed.revision));
  assert.equal(rowNamed(back, 'earned').status, 'proposed', 'restoring the proposed text is proposed again, still unaccepted');
  assert.equal(rowNamed(back, 'earned').pin, null);
  assert.equal(back.revision, `${GENERATION}/2`);
  const restored = withDigest(back, DIGEST);
  assert.equal(restored.digest, settled.digest, 'the restored bytes digest as before');
  assert.equal(acceptRow(restored, 'earned', pinned(settled)), null, 'but the original Accept still cannot land on the round-tripped row');
  assert.ok(acceptRow(restored, 'earned', pinned(restored)), 'a fresh Accept for the current revision does');
});
