import test from 'node:test';
import assert from 'node:assert/strict';
import { money, moneyShort, moneySpoken, count, percent, points, date, time, age, year, missing, figureText } from '../src/format/index.ts';
import type { MissingWords, SpokenMoneyWords } from '../src/format/index.ts';
import { ReplyValidationError } from '../src/bridge/validate.ts';
import { moneyFigure } from './fixtures.ts';

// Includes the exact reverse display cases from business-engine.test.ts/currency.test.ts.
// The repository did not expose a named shared 60-case India display fixture.
const moneyCases: readonly (readonly [string, string])[] = [
  ['0', '\u20b90'], ['1', '\u20b90.01'], ['10', '\u20b90.10'], ['99', '\u20b90.99'],
  ['100', '\u20b91'], ['101', '\u20b91.01'], ['110', '\u20b91.10'], ['199', '\u20b91.99'],
  ['200', '\u20b92'], ['999', '\u20b99.99'], ['1000', '\u20b910'], ['9999', '\u20b999.99'],
  ['10000', '\u20b9100'], ['12345', '\u20b9123.45'], ['99999', '\u20b9999.99'],
  ['100000', '\u20b91,000'], ['100001', '\u20b91,000.01'], ['999999', '\u20b99,999.99'],
  ['1000000', '\u20b910,000'], ['1234567', '\u20b912,345.67'], ['9999999', '\u20b999,999.99'],
  ['10000000', '\u20b91,00,000'], ['10000001', '\u20b91,00,000.01'], ['12345678', '\u20b91,23,456.78'],
  ['99999999', '\u20b99,99,999.99'], ['100000000', '\u20b910,00,000'], ['123456789', '\u20b912,34,567.89'],
  ['999999999', '\u20b999,99,999.99'], ['1000000000', '\u20b91,00,00,000'],
  ['31000000', '\u20b93,10,000'], ['6080000000', '\u20b96,08,00,000'],
  ['125003', '\u20b91,250.03'], ['25000000', '\u20b92,50,000'],
  ['900719925474099391', '\u20b99,00,71,99,25,47,40,993.91'],
  ['900719925474099300', '\u20b99,00,71,99,25,47,40,993'],
];

test('70 Indian money cases retain exact paise and grouping, including engine reading cases reversed', () => {
  for (const [paise, expected] of moneyCases) {
    assert.equal(money(paise), expected, paise);
    assert.equal(money(`-${paise}`), paise === '0' ? expected : `-${expected}`, `negative ${paise}`);
  }
  assert.equal(money('00000101'), '\u20b91.01');
  assert.equal(money('-00000000'), '\u20b90');
});

test('missing categorical values cannot become zero or blank in either language', () => {
  const en: MissingWords = { absent: 'Absent', null: 'Not recorded', unknown: 'Not known', withheld: 'Withheld', 'not-applicable': 'Not applicable', 'not-loaded-yet': 'Not loaded yet', 'not-counted': 'Not counted' };
  const hi: MissingWords = { absent: 'अनुपस्थित', null: 'दर्ज नहीं', unknown: 'पता नहीं', withheld: 'छिपाया गया', 'not-applicable': 'लागू नहीं', 'not-loaded-yet': 'अभी नहीं पढ़ा', 'not-counted': 'गिना नहीं' };
  for (const state of Object.keys(en) as (keyof MissingWords)[]) {
    assert.equal(figureText({ kind: 'missing', state }, en), en[state]);
    assert.equal(figureText({ kind: 'missing', state }, hi), hi[state]);
    assert.notEqual(missing(state, en), '0'); assert.notEqual(missing(state, en), '');
  }
  assert.equal(figureText(moneyFigure('0'), en), '\u20b90');
  assert.throws(() => missing('unknown', { ...en, unknown: '' }), { message: 'MISSING_FORMAT_WORD' });
});

test('money formatters refuse numeric, decimal, exponent and unknown inputs', () => {
  for (const value of ['1.23', '1e3', '+1', '', ' ', '1,000', 'NaN', 'Infinity', 'unknown', '1'.repeat(257), null, undefined, 9007199254740992]) {
    assert.throws(() => money(value as string), ReplyValidationError);
  }
});

test('counts and basis points remain different units above the number precision limit', () => {
  assert.equal(count('124500'), '1,24,500');
  assert.equal(count('123456789012345678901234567890'), '1,23,45,67,89,01,23,45,67,89,01,23,45,67,890');
  assert.equal(percent('3140'), '31.4%'); assert.equal(percent('3145'), '31.5%');
  assert.equal(percent('-3145'), '-31.5%'); assert.equal(percent('-4'), '0%');
  assert.equal(percent('0'), '0%'); assert.equal(percent('10000'), '100%');
  assert.equal(points('-80', 'points'), '-0.8 points');
  assert.equal(points('-80', 'अंक'), '-0.8 अंक');
  assert.throws(() => count('-1'), ReplyValidationError);
  assert.throws(() => percent('31.4'), ReplyValidationError);
});

test('short money rounds only display half up and keeps full exact value available', () => {
  const words = { lakh: 'lakh', crore: 'Cr' };
  assert.equal(moneyShort('31000000', words), '\u20b93.1 lakh');
  assert.equal(moneyShort('6080000000', words), '\u20b96.08 Cr');
  assert.equal(moneyShort('10049999', words), '\u20b91 lakh');
  assert.equal(moneyShort('10050000', words), '\u20b91.01 lakh');
  assert.equal(moneyShort('-10050000', words), '-\u20b91.01 lakh');
  assert.equal(moneyShort('9999999', words), '\u20b999,999.99');
  assert.equal(money('10050000'), '\u20b91,00,500');
  assert.equal(moneyShort('31000000', { lakh: 'लाख', crore: 'करोड़' }), '\u20b93.1 लाख');
});

test('spoken money uses catalog-owned number names, including paise and negative values', () => {
  const small = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  const words: SpokenMoneyWords = { underHundred: Array.from({ length: 100 }, (_, n) => n < 20 ? small[n]! : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${small[n % 10]}` : ''}`), minus: 'minus', hundred: 'hundred', thousand: 'thousand', lakh: 'lakh', crore: 'crore', rupees: 'rupees', paise: 'paise', and: 'and' };
  assert.equal(moneySpoken('31000000', words), 'three lakh ten thousand rupees');
  assert.equal(moneySpoken('-125003', words), 'minus one thousand two hundred fifty rupees and three paise');
  assert.equal(moneySpoken('0', words), 'zero rupees');
  assert.throws(() => moneySpoken('100', { ...words, underHundred: [] }), { message: 'INVALID_FORMAT_WORDS' });
});

test('dates validate calendar reality and format in the language without machine-zone drift', () => {
  assert.equal(date('2026-09-30'), '30 Sep 2026');
  assert.equal(date('2026-10-01', 'long'), 'Thursday, 1 October');
  assert.match(date('2026-10-01', 'long', 'hi'), /गुरुवार/);
  assert.equal(time('2026-10-01T00:35:00.000Z', 'Asia/Kolkata'), '06:05');
  assert.equal(time('2026-10-01T00:00:00.000Z', 'Etc/UTC'), '00:00');
  assert.equal(age('2026-09-28T23:00:00.000Z', 'as of'), 'as of 28 Sep 2026');
  assert.equal(year('2026-04-01', 'FY'), 'FY 2026-27');
  assert.equal(year('2026-03-31', 'FY'), 'FY 2025-26');
  assert.equal(year('2026-04-01', 'वित्त वर्ष'), 'वित्त वर्ष 2026-27');
  assert.equal(date('2024-02-29'), '29 Feb 2024');
  for (const iso of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-1', '01/10/2026', '2026-10-01T00:00:00Z']) assert.throws(() => date(iso), ReplyValidationError);
  assert.throws(() => time('2026-10-01T24:00:00.000Z', 'Etc/UTC'), ReplyValidationError);
});
