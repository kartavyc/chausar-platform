// The id screen on numbers written to slip past it (Ink v2 wave 4, 4B1 review D1 and D3): screenReadback also looks at
// a copy with hidden characters and soft hyphens taken out, every script's digits read as 0 to 9, and up to two
// spaces, dots, slashes or dashes allowed between digit groups, so a card, Aadhaar, bank account or one-time code
// written that way is still found and taken out of the text. A labelled card or Aadhaar number counts even when its
// check digit fails. A year after a bare "code is" is not a one-time code. The untrusted screen's cleaned text loses
// soft hyphens and joiners that sit outside Indian scripts, and keeps the joiners Indian scripts need.
import test from 'node:test';
import assert from 'node:assert/strict';
import { screenReadback, verhoeffValid } from '../runtime/venture/core/secrets.ts';
import { screenUntrusted } from '../runtime/venture/policy/untrusted.ts';

const devanagari = (text: string) => text.replace(/\d/g, digit => String.fromCharCode(0x0966 + Number(digit)));
const fullwidth = (text: string) => text.replace(/\d/g, digit => String.fromCharCode(0xff10 + Number(digit)));
const CARD = ['4111', '1111', '1111', '1111'];
const AADHAAR = (() => {
  for (let last = 0; last < 10; last += 1) if (verhoeffValid(`23456789012${last}`)) return ['2345', '6789', `012${last}`];
  throw new Error('no check digit');
})();
/** Every digit of the text, in any script, as 0 to 9: what must not survive the screen. */
const asciiDigits = (text: string) => text.replace(/[०-९]/g, d => String(d.charCodeAt(0) - 0x0966)).replace(/[０-９]/g, d => String(d.charCodeAt(0) - 0xFF10)).replace(/\D/g, '');

const cases: [string, string, string, string][] = [
  // [what, text, kind found, digits that must not survive]
  ['card with dots', `card ${CARD.join('.')}`, 'card', CARD.join('')],
  ['card with slashes', `card ${CARD.join('/')}`, 'card', CARD.join('')],
  ['card with double spaces', `card ${CARD.join('  ')}`, 'card', CARD.join('')],
  ['card with no-break spaces', `card ${CARD.join('\u00A0')}`, 'card', CARD.join('')],
  ['card in Devanagari digits', `card ${devanagari(CARD.join(' '))}`, 'card', CARD.join('')],
  ['card in fullwidth digits', `card ${fullwidth(CARD.join(' '))}`, 'card', CARD.join('')],
  ['card split by zero-width spaces', `card ${CARD.join('\u200B')}`, 'card', CARD.join('')],
  ['card split by joiners', `card ${CARD.join('\u200D')}`, 'card', CARD.join('')],
  ['card split by soft hyphens', `card ${CARD.join('\u00AD')}`, 'card', CARD.join('')],
  ['card split by word joiners', `card ${CARD.join('\u2060')}`, 'card', CARD.join('')],
  ['labelled card whose check digit fails', 'my card number is 4111 1111 1111 1112', 'card', '4111111111111112'],
  ['labelled Aadhaar whose check digit fails', 'my aadhaar is 1234 5678 9012', 'aadhaar', '123456789012'],
  ['Aadhaar in Devanagari digits', `आधार ${devanagari(AADHAAR.join(' '))}`, 'aadhaar', AADHAAR.join('')],
  ['Aadhaar with dots', `aadhaar ${AADHAAR.join('.')}`, 'aadhaar', AADHAAR.join('')],
  ['Aadhaar split by joiners', `aadhaar ${AADHAAR.join('\u200D')}`, 'aadhaar', AADHAAR.join('')],
  ['IFSC beside a spaced account', 'HDFC0001234 5010 0123 4567 89', 'bank-account', '50100123456789'],
  ['lower-case IFSC beside an account', 'ifsc hdfc0001234, 50100123456780', 'bank-account', '50100123456780'],
  ['IFSC after the account', '50100123456781 HDFC0001234', 'bank-account', '50100123456781'],
  ['one-time code with a space in it', 'OTP is 482 913', 'otp', '482913'],
  ['one-time code in Devanagari digits', `OTP ${devanagari('482913')}`, 'otp', '482913'],
  ['one-time code with a Hindi label', 'ओटीपी 482913 है', 'otp', '482913'],
  ['one-time code in Hinglish', 'otp aaya 482913', 'otp', '482913'],
  ['one-time code before "is my OTP"', '482913 is my OTP', 'otp', '482913'],
  ['one-time code after "the code I got"', 'the code I got: 482913', 'otp', '482913'],
  ['one-time code split by a zero-width space', 'OTP is 48\u200B2913', 'otp', '482913'],
];

test('screenReadback finds ids written to slip past it, and takes them out of the text (D1, D3)', () => {
  for (const [what, text, kind, digits] of cases) {
    const screened = screenReadback(text);
    assert.ok((screened.found as string[]).includes(kind), `${what}: found ${JSON.stringify(screened.found)}`);
    assert.ok(!asciiDigits(screened.text).includes(digits), `${what}: ${JSON.stringify(screened.text)}`);
  }
});

test('screenReadback leaves ordinary numbers alone, a year after a bare "code is" included (D3)', () => {
  for (const text of [
    'How is order 1042 going?', 'Deliver it on 2026-10-23', 'Deliver it on 23/10/2026 at 10:42', 'Call the client on +91 98765 43210',
    'aadhaar XXXX XXXX 9012', 'Cut 12 shorts from episode 14 in 3 days', 'The promo code is 2025', 'Invoice INV-2026-0001 is due',
    'Video 1234567890123 got 18000 views', 'Paid 1,18,400 on 23.10.2026', 'SAC code 998231 applies',
  ]) {
    const screened = screenReadback(text);
    assert.deepEqual(screened.found, [], text);
    assert.equal(screened.text, text, text);
  }
});

test('the untrusted screen drops soft hyphens and stray joiners from cleaned text, and keeps joiners inside Indian scripts', () => {
  const conjunct = 'क्\u200Dष'; // a half form: the joiner sits between Devanagari characters
  const result = screenUntrusted({ source: 'client-file', text: `in\u00ADvoice ${conjunct} a\u200Db a\u200Cb` }, { mode: 'enforce' });
  assert.equal(result.text, `invoice ${conjunct} ab ab`);
  const card = screenUntrusted({ source: 'client-file', text: `card ${CARD.join('\u00AD')}.pdf` }, { mode: 'enforce' });
  assert.ok(card.text !== null && !asciiDigits(card.text).includes(CARD.join('')), JSON.stringify(card.text));
});
