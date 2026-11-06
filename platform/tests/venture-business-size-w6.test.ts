// W6 founder decisions of 3 November 2026: a business's size is asked only when one of its profession's rules counts
// it, as ranges built from the rules' own confirmed figures (with "I'd rather not say"), and the engine tells the owner,
// rule by rule, whether the duty above the size applies. venture.compliance.get returns the size question and a verdict
// line per sized rule; venture.compliance.set records the range answer with the business, next to the side-work answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitBusiness, owner } from './fixtures/venture/kit-business.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { complianceBeforeVault } from '../runtime/venture/core/compliance.ts';
import { PROFESSION_COMPLIANCE } from '../runtime/venture/core/compliance-data.ts';
import { SIZE_ASK_LINE, businessSizeOf, readSizeAnswers, sizeAskOf, sizeVerdict } from '../runtime/venture/core/business-size.ts';
import { cautionOf, type Caution } from '../runtime/venture/core/professions.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import type { ComplianceView } from '../runtime/venture/contracts.ts';

const phone = { ...owner, channel: 'phone' as const };
const code = (expected: string, message?: RegExp) => (error: any) => { assert.equal(error.code, expected, error.message); if (message) assert.match(error.message, message); return true; };
const CHEF = 'home-chef-tiffin';
const UP_TO = 'up-to-1500000000';
const ABOVE = 'above-1500000000';

/** A synthetic statute with the given size, built on a real one. */
const sized = (size: Caution['size']): Caution => ({ ...cautionOf('trai-dnd')!, size });
const turnover = (aboveMinor: string | null, above = 'the turnover duty', below: string | null = null): Caution => sized({
  measure: 'turnover', above, below, turnover: { aboveMinor, confirmed: aboveMinor !== null, basis: 'Synthetic.' },
});
const headcount = (people: number | null, above = 'the headcount duty', below: string | null = null): Caution => sized({
  measure: 'headcount', above, below, headcount: { above: people, confirmed: people !== null, basis: 'Synthetic.' },
});

test('the size question appears only for a profession whose rules count size, with the FSSAI ranges and words', () => {
  const chef = complianceBeforeVault({ profession: CHEF });
  assert.deepEqual(chef.size, {
    measures: ['turnover'],
    line: SIZE_ASK_LINE,
    questions: [{
      measure: 'turnover', question: "What's your yearly turnover?", answer: null,
      choices: [
        { id: UP_TO, label: 'Up to ₹1.5 crore a year' },
        { id: ABOVE, label: 'More than ₹1.5 crore a year' },
        { id: 'not-say', label: "I'd rather not say" },
      ],
    }],
  });
  assert.equal(SIZE_ASK_LINE, 'Some rules change with your size. Chausar uses this only to show which ones apply.');
  assert.deepEqual(chef.rules.map(rule => [rule.id, rule.verdict]), [['fssai', 'Add your yearly turnover to see which applies.']]);

  for (const profession of ['advocate', 'school-teacher', 'teaching', 'local-services']) {
    const view = complianceBeforeVault({ profession });
    assert.equal(view.size, null, profession);
    for (const rule of view.rules) assert.equal(rule.verdict, null, `${profession} ${rule.id}`);
  }
  // Across the map: asked exactly where a rule counts a size with a confirmed figure (today only FSSAI).
  for (const item of PROFESSION_COMPLIANCE) {
    const counts = item.rules.some(rule => cautionOf(rule.id)!.size.measure !== 'none');
    assert.equal(complianceBeforeVault({ profession: item.id }).size !== null, counts, item.id);
  }
  // The side-work digest is the same words as before: the size question and verdicts are not part of it.
  assert.equal(complianceBeforeVault({ profession: CHEF, size: { turnover: ABOVE } }).digest, chef.digest);
});

test('ranges come from every distinct confirmed figure of the sized rules, for turnover and headcount alike', () => {
  const ask = sizeAskOf([turnover('50000000000'), turnover('1500000000'), turnover('1500000000'), headcount(50), headcount(10), turnover(null), headcount(null)], null)!;
  assert.deepEqual(ask.measures, ['turnover', 'headcount']);
  assert.deepEqual(ask.questions.map(question => [question.measure, question.question]), [['turnover', "What's your yearly turnover?"], ['headcount', 'How many people work in your business?']]);
  assert.deepEqual(ask.questions[0]!.choices, [
    { id: 'up-to-1500000000', label: 'Up to ₹1.5 crore a year' },
    { id: '1500000000-to-50000000000', label: 'More than ₹1.5 crore, up to ₹50 crore a year' },
    { id: 'above-50000000000', label: 'More than ₹50 crore a year' },
    { id: 'not-say', label: "I'd rather not say" },
  ]);
  assert.deepEqual(ask.questions[1]!.choices, [
    { id: 'up-to-10', label: 'Up to 10 people' },
    { id: '10-to-50', label: '11 to 50 people' },
    { id: 'above-50', label: 'More than 50 people' },
    { id: 'not-say', label: "I'd rather not say" },
  ]);
  // Rules with no size, or only unconfirmed figures, ask nothing: a range is never built from a guess.
  assert.equal(sizeAskOf([cautionOf('trai-dnd')!, turnover(null), headcount(null)], null), null);
  assert.equal(sizeAskOf([], null), null);
  // A saved answer shows only while it is still offered.
  assert.equal(sizeAskOf([turnover('1500000000')], { turnover: ABOVE })!.questions[0]!.answer, ABOVE);
  assert.equal(sizeAskOf([turnover('1500000000')], { turnover: 'above-1200000' })!.questions[0]!.answer, null);
});

test('a range maps to a value it can judge: up to X is X, above X is X plus 1 paisa, and not saying stays unknown', () => {
  const rules = [turnover('1500000000'), turnover('50000000000'), headcount(10)];
  assert.deepEqual(businessSizeOf(rules, { turnover: 'up-to-1500000000' }), { yearlyTurnoverMinor: 1500000000n });
  assert.deepEqual(businessSizeOf(rules, { turnover: '1500000000-to-50000000000' }), { yearlyTurnoverMinor: 50000000000n });
  assert.deepEqual(businessSizeOf(rules, { turnover: 'above-50000000000', headcount: 'above-10' }), { yearlyTurnoverMinor: 50000000001n, headcount: 11 });
  assert.deepEqual(businessSizeOf(rules, { turnover: 'not-say', headcount: 'up-to-10' }), { headcount: 10 });
  assert.deepEqual(businessSizeOf(rules, { turnover: 'above-1' }), {}, 'an id not offered is unknown');
  assert.deepEqual(businessSizeOf(rules, null), {});
  assert.equal(typeof businessSizeOf(rules, { turnover: UP_TO }).yearlyTurnoverMinor, 'bigint');
});

test('each sized rule gets the engine\'s verdict line: applies, below, or a calm unknown that never guesses', () => {
  const fssai = cautionOf('fssai')!;
  const verdict = (answers: Record<string, string> | null) => sizeVerdict(fssai, [fssai], answers);
  assert.equal(verdict({ turnover: UP_TO }), 'At your size: an FSSAI registration.');
  assert.equal(verdict({ turnover: ABOVE }), 'Above ₹1.5 crore a year: an FSSAI state licence.');
  assert.equal(verdict({ turnover: 'not-say' }), 'Add your yearly turnover to see which applies.');
  assert.equal(verdict(null), 'Add your yearly turnover to see which applies.');
  assert.equal(sizeVerdict(cautionOf('trai-dnd')!, [fssai], { turnover: ABOVE }), null, 'a rule with no size gets no verdict');

  // The middle range sits above the lower figure and up to the upper one.
  const low = turnover('1500000000', 'the low duty'), high = turnover('50000000000', 'the high duty', 'a lighter duty');
  assert.equal(sizeVerdict(low, [low, high], { turnover: '1500000000-to-50000000000' }), 'Above ₹1.5 crore a year: the low duty.');
  assert.equal(sizeVerdict(high, [low, high], { turnover: '1500000000-to-50000000000' }), 'At your size: a lighter duty.');
  assert.equal(sizeVerdict(low, [low, high], { turnover: 'up-to-1500000000' }), "At your size, this rule doesn't apply.");

  const people = headcount(10);
  assert.equal(sizeVerdict(people, [people], { headcount: 'above-10' }), 'Above 10 people: the headcount duty.');
  assert.equal(sizeVerdict(people, [people], { headcount: 'up-to-10' }), "At your size, this rule doesn't apply.");
  assert.equal(sizeVerdict(people, [people], { headcount: 'not-say' }), 'Add how many people work in your business to see which applies.');

  const both = sized({ measure: 'both', join: 'either', above: 'the stricter duty', below: null, turnover: { aboveMinor: '1500000000', confirmed: true, basis: 'Synthetic.' }, headcount: { above: 10, confirmed: true, basis: 'Synthetic.' } });
  assert.equal(sizeVerdict(both, [both], { turnover: UP_TO, headcount: 'above-10' }), 'At your size: the stricter duty.');
  assert.equal(sizeVerdict(both, [both], { turnover: UP_TO }), 'Add how many people work in your business to see which applies.');
  assert.equal(sizeVerdict(both, [both], {}), 'Add your yearly turnover and how many people work in your business to see which applies.');
  // A figure not confirmed yet is never guessed, whatever the owner says.
  const unsure = sized({ measure: 'both', join: 'either', above: 'the stricter duty', below: null, turnover: { aboveMinor: null, confirmed: false, basis: 'Synthetic.' }, headcount: { above: 10, confirmed: true, basis: 'Synthetic.' } });
  assert.equal(sizeVerdict(unsure, [unsure], { headcount: 'up-to-10' }), "This rule's size figure isn't confirmed yet, so Chausar can't say which applies.");

  // Before any business exists, get previews the verdict for a picked range without keeping it.
  const preview = complianceBeforeVault({ profession: CHEF, size: { turnover: ABOVE } });
  assert.deepEqual(preview.rules.map(rule => rule.verdict), ['Above ₹1.5 crore a year: an FSSAI state licence.']);
  assert.equal(preview.size!.questions[0]!.answer, null, 'a preview is not a saved answer');
});

test('only offered range ids are accepted, for the measures asked, and only where a rule counts size', () => {
  const ask = sizeAskOf([cautionOf('fssai')!], null);
  assert.deepEqual(readSizeAnswers({ turnover: ABOVE }, ask), { answers: { turnover: ABOVE } });
  assert.deepEqual(readSizeAnswers({ turnover: 'not-say' }, ask), { answers: { turnover: 'not-say' } });
  assert.deepEqual(readSizeAnswers({}, ask), { answers: {} });
  for (const bad of [null, 'above-1500000000', ['x'], { turnover: 'above-1' }, { turnover: 1500000001 }, { headcount: 'up-to-10' }, { turnover: ABOVE, extra: 'x' }, { turnover: 'UP-TO-1500000000' }]) {
    assert.ok('problem' in readSizeAnswers(bad, ask), JSON.stringify(bad));
  }
  assert.ok('problem' in readSizeAnswers({ turnover: ABOVE }, null));

  assert.throws(() => complianceBeforeVault({ profession: CHEF, size: { turnover: 'above-1' } }), code('INVALID_VENTURE_REQUEST', /Choose one of the size ranges shown/));
  assert.throws(() => complianceBeforeVault({ profession: CHEF, size: { headcount: 'up-to-10' } }), code('INVALID_VENTURE_REQUEST', /Answer only the size questions shown/));
  assert.throws(() => complianceBeforeVault({ profession: 'advocate', size: {} }), code('INVALID_VENTURE_REQUEST', /rules don't depend on size/));
  assert.throws(() => complianceBeforeVault({ profession: CHEF, size: 'above' }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => complianceBeforeVault({ profession: CHEF, sideWork: 'allowed' }), code('INVALID_VENTURE_REQUEST'));
});

test('the range answer is stored with the business, kept when the side-work answer is recorded again, and changed on its own', async () => {
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00Z') }, { idea: 'Home tiffin service for office workers' });
  const get = (payload: unknown) => coreHandlers['venture.compliance.get']!(env.deps, owner, payload) as Promise<ComplianceView>;
  const set = (payload: unknown, ctx = owner) => coreHandlers['venture.compliance.set']!(env.deps, ctx, payload) as Promise<ComplianceView>;
  const view = await get({ profession: CHEF });
  assert.equal(view.size!.questions[0]!.answer, null);

  // Nothing to change before the side-work answer is recorded, and every refusal is strict.
  await assert.rejects(set({ size: { turnover: UP_TO } }), code('INVALID_VENTURE_REQUEST', /side-work question first/));
  await assert.rejects(set({ profession: CHEF, sideWork: 'allowed', digest: view.digest, size: { turnover: 'above-1' } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(set({ profession: 'advocate', sideWork: 'allowed', digest: complianceBeforeVault({ profession: 'advocate' }).digest, size: { turnover: UP_TO } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(set({ profession: CHEF, sideWork: 'allowed', digest: view.digest, size: { turnover: UP_TO } }, phone), code('APP_APPROVAL_REQUIRED'));
  assert.equal(listRecords(env.store.read(), 'venture-compliance').length, 0);

  const first = await set({ profession: CHEF, sideWork: 'allowed', digest: view.digest, size: { turnover: UP_TO } });
  assert.equal(first.size!.questions[0]!.answer, UP_TO);
  assert.deepEqual(first.rules.map(rule => rule.verdict), ['At your size: an FSSAI registration.']);
  assert.deepEqual(listRecords(env.store.read(), 'venture-compliance').map(row => row.size), [{ turnover: UP_TO }]);
  const read = await get({});
  assert.equal(read.size!.questions[0]!.answer, UP_TO);
  assert.deepEqual(read.rules.map(rule => rule.verdict), ['At your size: an FSSAI registration.']);

  // Business settings change only the size: the side-work answer and its day stay as they were.
  env.clock.now = new Date('2026-11-03T10:00:00Z');
  await assert.rejects(set({ size: { turnover: ABOVE }, profession: CHEF }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(set({ size: { turnover: 'above-1' } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(set({ size: { turnover: ABOVE } }, phone), code('APP_APPROVAL_REQUIRED'));
  const changed = await set({ size: { turnover: ABOVE } });
  assert.deepEqual(changed.recorded, { professionId: CHEF, sideWork: 'allowed', acknowledgedOn: '2026-10-27' });
  assert.deepEqual(changed.rules.map(rule => rule.verdict), ['Above ₹1.5 crore a year: an FSSAI state licence.']);
  assert.deepEqual(listRecords(env.store.read(), 'venture-compliance').map(row => [row.sideWork, row.size]), [['allowed', { turnover: UP_TO }], ['allowed', { turnover: ABOVE }]]);

  // "I'd rather not say" is kept as said and reads as unknown.
  const quiet = await set({ size: { turnover: 'not-say' } });
  assert.equal(quiet.size!.questions[0]!.answer, 'not-say');
  assert.deepEqual(quiet.rules.map(rule => rule.verdict), ['Add your yearly turnover to see which applies.']);

  // Recording the side-work answer again without a size keeps the size answer.
  const again = await set({ profession: CHEF, sideWork: 'not-sure', digest: view.digest });
  assert.equal(again.size!.questions[0]!.answer, 'not-say');
  assert.deepEqual(listRecords(env.store.read(), 'venture-compliance').at(-1)!.size, { turnover: 'not-say' });

  // A preview on get judges the picked range without storing it.
  const preview = await get({ size: { turnover: UP_TO } });
  assert.deepEqual([preview.size!.questions[0]!.answer, preview.rules[0]!.verdict], ['not-say', 'At your size: an FSSAI registration.']);
  assert.equal(listRecords(env.store.read(), 'venture-compliance').length, 4);

  // A profession whose rules count no size refuses a size answer.
  await set({ profession: 'advocate', sideWork: 'allowed', digest: complianceBeforeVault({ profession: 'advocate' }).digest });
  await assert.rejects(set({ size: { turnover: UP_TO } }), code('INVALID_VENTURE_REQUEST', /rules don't depend on size/));
  assert.equal((await get({})).size, null);
});
