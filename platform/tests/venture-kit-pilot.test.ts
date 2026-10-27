// Ink v2 wave 5, package 5A2: the paid pilot (catalogue P2, from paulklayvc's pilot offer, MIT, ideas only). One page:
// one hypothesis, a window of 2 to 6 weeks, a success measure (what, the number as the owner types it, and a date that
// falls inside the window by code date arithmetic), the hours needed from the owner and from the client, the owner's
// price (a pilot is never free), permission to reference (asked, and recorded yes or no), then the after-pilot asks: a
// case study and a referral. A fact the owner has not given yet is a bracketed placeholder, never a guess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PILOT_AFTER_ASKS, pilotOf, type PilotTerms } from '../runtime/venture/playbooks/kit/pilot.ts';
import { PLAYBOOK_DEFINITIONS } from '../runtime/venture/playbooks/definitions.ts';
import { FIXTURE } from './venture-kit-sales-fixture.ts';
import { code } from './venture-views-env.ts';

const terms = (overrides: Partial<PilotTerms> = {}): PilotTerms => ({
  startsOn: '2026-11-02', weeks: 4, hypothesis: 'Matching the bank every week cuts month-end work for the owner',
  measure: { what: 'Hours the owner spends on month-end', target: 'under 2 hours', by: '2026-11-27' },
  ownerHours: 1, clientHours: 2, priceMinor: '500000', reference: true, ...overrides,
});

test('a pilot page: hypothesis, window, success measure, hours, price, permission to reference, then the after-pilot asks', () => {
  const page = pilotOf(FIXTURE, 'monthly-books', terms());
  assert.equal(page.offerId, 'monthly-books');
  assert.equal(page.offerName, 'Monthly books');
  assert.deepEqual(page.window, { weeks: 4, from: '2026-11-02', to: '2026-11-30' });
  assert.deepEqual(page.measure, { what: 'Hours the owner spends on month-end', target: 'under 2 hours', by: '2026-11-27' });
  assert.deepEqual(page.hours, { owner: 1, client: 2 });
  assert.equal(page.priceMinor, '500000');
  assert.equal(page.reference, 'yes');
  assert.deepEqual(page.after, PILOT_AFTER_ASKS);
  assert.deepEqual(PILOT_AFTER_ASKS, ['A short case study, if the pilot meets its measure.', 'An introduction to one business like yours.']);
  assert.deepEqual(page.placeholders, []);
  assert.deepEqual(page.lines, [
    'A paid pilot of Monthly books for 4 weeks, from 2026-11-02 to 2026-11-30.',
    'What we test: Matching the bank every week cuts month-end work for the owner.',
    'Success: Hours the owner spends on month-end, under 2 hours, by 2026-11-27.',
    // The page is for the client: "you" is the client (clientHours), "us" is the business (ownerHours).
    'Time needed: 2 hours a week from you, 1 hour a week from us.',
    'You agreed we may mention you as a client.',
  ]);
  assert.equal(pilotOf(FIXTURE, 'monthly-books', terms({ reference: false })).reference, 'no');
  assert.equal(pilotOf(FIXTURE, 'monthly-books', terms({ reference: false })).lines.at(-1), 'You asked us not to mention you as a client.');
});

test('a fact not given yet is a bracketed placeholder on the page, and listed', () => {
  const page = pilotOf(FIXTURE, 'monthly-books', terms({ weeks: null, hypothesis: null, measure: { what: null, target: null, by: null }, ownerHours: null, clientHours: null, reference: null }));
  assert.deepEqual(page.window, { weeks: null, from: '2026-11-02', to: null });
  assert.equal(page.reference, 'ask');
  assert.deepEqual(page.placeholders, [
    '[2 to 6 weeks]', '[the one thing we expect to change]', '[what we measure]', '[the number you agree on]', '[the date, inside the pilot]',
    '[hours a week from you]', '[hours a week from us]', '[may we mention you as a client: yes or no]',
  ]);
  assert.equal(page.lines[0], 'A paid pilot of Monthly books for [2 to 6 weeks], from 2026-11-02.');
});

test('a share the owner set is a price too, kept apart from an amount', () => {
  const page = pilotOf(FIXTURE, 'monthly-books', terms({ priceMinor: null, shareBps: '833' }));
  assert.deepEqual([page.priceMinor, page.shareBps], [null, '833']);
  assert.throws(() => pilotOf(FIXTURE, 'monthly-books', terms({ priceMinor: null, shareBps: null })), code('PILOT_UNPRICED'));
  assert.throws(() => pilotOf(FIXTURE, 'monthly-books', terms({ priceMinor: null, shareBps: '0' })), code('PILOT_UNPRICED'));
});

test('a pilot is never free: no price, or a price of zero, refuses PILOT_UNPRICED', () => {
  for (const priceMinor of [null, '0', '000']) {
    assert.throws(() => pilotOf(FIXTURE, 'monthly-books', terms({ priceMinor })), (error: any) => {
      assert.equal(error.code, 'PILOT_UNPRICED');
      assert.equal(error.message, 'A pilot is never free. Set a price for it.');
      return true;
    });
  }
});

test('the window is 2 to 6 weeks, and the success date falls inside it by date arithmetic', () => {
  for (const weeks of [1, 7, 0, 2.5]) assert.throws(() => pilotOf(FIXTURE, 'monthly-books', terms({ weeks })), code('PILOT_WINDOW'), String(weeks));
  assert.equal(pilotOf(FIXTURE, 'monthly-books', terms({ weeks: 2, measure: { ...terms().measure, by: '2026-11-16' } })).window.to, '2026-11-16');
  assert.equal(pilotOf(FIXTURE, 'monthly-books', terms({ weeks: 6, measure: { ...terms().measure, by: '2026-12-14' } })).window.to, '2026-12-14');
  // The day the pilot starts is too early to measure; the day after the window ends is too late.
  for (const by of ['2026-11-02', '2026-12-01', '2026-10-30']) {
    assert.throws(() => pilotOf(FIXTURE, 'monthly-books', terms({ measure: { ...terms().measure, by } })), (error: any) => {
      assert.equal(error.code, 'PILOT_WINDOW');
      assert.equal(error.message, 'The success date must fall inside the pilot, after 2026-11-02 and by 2026-11-30.');
      return true;
    }, by);
  }
  // With the weeks not agreed yet, the date still has to fall within the longest pilot.
  assert.throws(() => pilotOf(FIXTURE, 'monthly-books', terms({ weeks: null, measure: { ...terms().measure, by: '2026-12-15' } })), code('PILOT_WINDOW'));
  assert.throws(() => pilotOf(FIXTURE, 'monthly-books', terms({ startsOn: '2026-13-01' })), code('INVALID_VENTURE_REQUEST'));
});

test('only an offer the playbook offers as a pilot can be one; hours are whole numbers a week', () => {
  assert.throws(() => pilotOf(FIXTURE, 'audit-share', terms()), (error: any) => {
    assert.equal(error.code, 'PILOT_NOT_OFFERED');
    assert.equal(error.message, 'Refund audit is not offered as a pilot. Choose an offer that is.');
    return true;
  });
  assert.throws(() => pilotOf(FIXTURE, 'no-such-offer', terms()), code('OFFER_NOT_FOUND'));
  for (const ownerHours of [-1, 1.5, 61]) assert.throws(() => pilotOf(FIXTURE, 'monthly-books', terms({ ownerHours })), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => pilotOf(FIXTURE, 'monthly-books', terms({ hypothesis: 'x'.repeat(201) })), code('INVALID_VENTURE_REQUEST'));
});

test('every kit playbook that has landed offers at least one paid pilot', () => {
  for (const definition of PLAYBOOK_DEFINITIONS) {
    assert.ok(definition.offers.some(item => item.pilotable), `${definition.registration.id} offers no pilot`);
  }
});
