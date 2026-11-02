// W6 founder follow-up F4 (2 November 2026): a statute's size threshold is per statute. Each statute says what its
// size counts: nothing (it applies at any size), yearly turnover, headcount, or both, with the figure for each, read
// on the official source or marked unconfirmed. cautionApplies is the one check of whether a statute's duty above the
// size applies to a business. BCI Rule 36 and the Telemedicine Practice Guidelines 2020 were read on their official
// sources on 2 November 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAUTIONS, SIZE_MEASURES, cautionApplies, cautionOf, sizeLine, validateProfessions, type Caution } from '../runtime/venture/core/professions.ts';
import { complianceOf, professionCompliance } from '../runtime/venture/core/compliance-data.ts';
import { SIGNOFF_RULES } from '../runtime/venture/playbooks/signoff-desk/professions.ts';
import { SIGNOFF_DESK_RULES } from '../runtime/venture/playbooks/signoff-desk/rules.ts';

const CRORE = 10_000_000n * 100n;

test('F4: every statute states what its size counts, and FSSAI counts yearly turnover with the 2026 figure', () => {
  for (const caution of CAUTIONS) assert.ok(SIZE_MEASURES.includes(caution.size.measure), caution.id);
  assert.deepEqual(CAUTIONS.filter(caution => caution.size.measure !== 'none').map(caution => caution.id), ['fssai']);
  const fssai = cautionOf('fssai')!;
  assert.equal(fssai.size.measure, 'turnover');
  if (fssai.size.measure !== 'turnover') return;
  // FSSAI order of 13 March 2026, in force from 1 April 2026: registration up to Rs 1.5 crore, a state licence above.
  assert.deepEqual(fssai.size.turnover, { aboveMinor: String(15n * CRORE / 10n), confirmed: true, basis: fssai.size.turnover.basis });
  assert.match(fssai.size.turnover.basis, /13 March 2026/);
  assert.ok(fssai.sources.some(source => /fssai\.gov\.in\/upload\/advisories\/2026\/03\//.test(source.url)));
  assert.equal(sizeLine(fssai), 'Size counts yearly turnover. Above ₹1.5 crore: an FSSAI state licence. Up to it: an FSSAI registration.');
  for (const caution of CAUTIONS.filter(item => item.size.measure === 'none')) assert.equal(sizeLine(caution), null, caution.id);
});

test('F4: cautionApplies checks a business against the statute\'s own measure, and says unknown rather than guess', () => {
  const fssai = cautionOf('fssai')!;
  assert.equal(cautionApplies(fssai, { yearlyTurnoverMinor: CRORE }), 'below');
  assert.equal(cautionApplies(fssai, { yearlyTurnoverMinor: 15n * CRORE / 10n }), 'below', 'up to the figure is below');
  assert.equal(cautionApplies(fssai, { yearlyTurnoverMinor: 2n * CRORE }), 'applies');
  assert.equal(cautionApplies(fssai, {}), 'unknown', 'no turnover known');
  assert.equal(cautionApplies(fssai, { headcount: 400 }), 'unknown', 'headcount is not what FSSAI counts');
  assert.equal(cautionApplies(cautionOf('trai-dnd')!, {}), 'applies', 'a statute with no size applies at any size');

  const base = cautionOf('trai-dnd')!;
  const both = (join: 'either' | 'all', turnover: string | null): Caution => ({
    ...base, size: {
      measure: 'both', join, above: 'the stricter duty', below: null,
      turnover: { aboveMinor: turnover, confirmed: turnover !== null, basis: 'Synthetic.' },
      headcount: { above: 10, confirmed: true, basis: 'Synthetic.' },
    },
  });
  assert.equal(cautionApplies(both('either', '100'), { yearlyTurnoverMinor: 1n, headcount: 11 }), 'applies');
  assert.equal(cautionApplies(both('either', '100'), { yearlyTurnoverMinor: 1n, headcount: 10 }), 'below');
  assert.equal(cautionApplies(both('all', '100'), { yearlyTurnoverMinor: 101n, headcount: 10 }), 'below');
  assert.equal(cautionApplies(both('all', '100'), { yearlyTurnoverMinor: 101n, headcount: 11 }), 'applies');
  assert.equal(cautionApplies(both('either', null), { yearlyTurnoverMinor: 1n, headcount: 10 }), 'unknown', 'an unconfirmed figure is never guessed');
  assert.equal(cautionApplies(both('all', null), { yearlyTurnoverMinor: 1n, headcount: 10 }), 'below', 'below on the confirmed measure is enough when both must pass');
  assert.equal(sizeLine(both('either', null)), 'Size counts yearly turnover (figure not confirmed yet) or headcount above 10. Above it: the stricter duty.');
  assert.equal(sizeLine(both('all', '1000000000')), 'Size counts yearly turnover above ₹1 crore and headcount above 10. Above it: the stricter duty.');
});

test('F4: validateProfessions refuses a size that does not state its measure honestly', () => {
  const fssai = cautionOf('fssai')!;
  const swap = (size: unknown) => CAUTIONS.map(caution => (caution.id === 'fssai' ? { ...fssai, size } as Caution : caution));
  assert.throws(() => validateProfessions(undefined, swap(undefined)), /fssai needs its size/);
  assert.throws(() => validateProfessions(undefined, swap({ measure: 'shops' })), /fssai needs its size/);
  assert.throws(() => validateProfessions(undefined, swap({ ...fssai.size, turnover: undefined })), /fssai counts yearly turnover, so it needs that figure/);
  assert.throws(() => validateProfessions(undefined, swap({ ...fssai.size, turnover: { aboveMinor: null, confirmed: true, basis: 'x' } })), /confirmed figure needs its value/);
  assert.throws(() => validateProfessions(undefined, swap({ ...fssai.size, turnover: { aboveMinor: '100', confirmed: false, basis: 'x' } })), /unconfirmed figure carries no value/);
  assert.throws(() => validateProfessions(undefined, swap({ ...fssai.size, turnover: { aboveMinor: '12.5', confirmed: true, basis: 'x' } })), /whole paise/);
  assert.throws(() => validateProfessions(undefined, swap({ measure: 'headcount', headcount: { above: 2.5, confirmed: true, basis: 'x' }, above: 'x', below: null })), /whole number of people/);
  assert.throws(() => validateProfessions(undefined, swap({ ...fssai.size, above: ' ' })), /what applies above/);
});

test('F4: the compliance screen gets the size words, so the screen formats nothing', () => {
  const chef = complianceOf(professionCompliance('home-chef-tiffin')!);
  assert.deepEqual(chef.rules.map(rule => [rule.id, rule.size]), [['fssai', sizeLine(cautionOf('fssai')!)]]);
  const advocate = complianceOf(professionCompliance('advocate')!);
  assert.deepEqual(advocate.rules.map(rule => [rule.id, rule.size]), [['bci-rule-36', null]]);
});

test('F4: BCI Rule 36 and the Telemedicine Guidelines are checked on their official sources, with the day read', () => {
  assert.deepEqual(CAUTIONS.filter(caution => !caution.checked).map(caution => caution.id), []);
  const bci = cautionOf('bci-rule-36')!;
  assert.deepEqual([bci.checked, bci.checkedOn, bci.section], [true, '2026-11-02', 'Part VI, Chapter II, Section IV, Rule 36']);
  assert.equal(bci.sources[0]!.url, 'https://www.barcouncilofindia.org/info/bar-counci-g36acc');
  const tele = cautionOf('telemedicine-2020')!;
  assert.deepEqual([tele.checked, tele.checkedOn, tele.section], [true, '2026-11-02', 'Sections 3.2.5 and 5.4']);
  assert.equal(tele.sources[0]!.url, 'https://esanjeevani.mohfw.gov.in/assets/guidelines/Telemedicine_Practice_Guidelines.pdf');
  const advocate = complianceOf(professionCompliance('advocate')!);
  assert.deepEqual(advocate.rules.map(rule => [rule.checked, rule.checkedDay, rule.source?.url]), [[true, '2 Nov 2026', 'https://www.barcouncilofindia.org/info/bar-counci-g36acc']]);

  // The sign-off desk's copies of the same two rules, and its register, say the same.
  const signoff = (id: string) => SIGNOFF_RULES.find(rule => rule.id === id)!;
  assert.deepEqual([signoff('bci-rule-36').checked, signoff('bci-rule-36').url, signoff('bci-rule-36').readOn], [true, 'https://www.barcouncilofindia.org/info/bar-counci-g36acc', '2026-11-02']);
  assert.deepEqual([signoff('telemedicine-2020').checked, signoff('telemedicine-2020').url, signoff('telemedicine-2020').readOn], [true, 'https://esanjeevani.mohfw.gov.in/assets/guidelines/Telemedicine_Practice_Guidelines.pdf', '2026-11-02']);
  const register = (id: string) => SIGNOFF_DESK_RULES.find(rule => rule.id === id)!;
  assert.deepEqual([register('bci-rule-36').read, register('bci-rule-36').checkedOn], ['official', '2026-11-02']);
  assert.deepEqual([register('telemedicine-2020').read, register('telemedicine-2020').checkedOn], ['official', '2026-11-02']);
  // Rules not re-read keep the day they were read.
  assert.equal(register('nmc-2002-6-1-1').checkedOn, '2026-11-01');
  // The SEBI, CS and CA rules were read on their official pages on 3 November.
  assert.deepEqual([register('sebi-ia-2013').read, register('sebi-ia-2013').checkedOn], ['official', '2026-11-03']);
});
