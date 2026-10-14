import test from 'node:test';
import assert from 'node:assert/strict';
import { indianGrouping, interpretSpeech } from '../runtime/speech-understood.ts';

const amounts = (text: string) => interpretSpeech(text).numbers.map(n => n.integer ?? `~${n.value}`);
const negated = (text: string) => interpretSpeech(text).negations.filter(n => !n.ambiguous).map(n => n.text);
const codes = (text: string) => interpretSpeech(text).ambiguities.map(a => a.code);

test('Indian number words become exact integers in Indian grouping, romanised and Devanagari', () => {
  const cases: [string, string, string][] = [
    ['do lakh', '200000', '2,00,000'], ['दो लाख', '200000', '2,00,000'], ['dhai hazaar', '2500', '2,500'], ['ढाई हज़ार', '2500', '2,500'], ['ढाई हजार', '2500', '2,500'],
    ['dedh lakh', '150000', '1,50,000'], ['डेढ़ लाख', '150000', '1,50,000'], ['sava lakh', '125000', '1,25,000'], ['सवा लाख', '125000', '1,25,000'],
    ['saadhe teen hazaar', '3500', '3,500'], ['साढ़े तीन हज़ार', '3500', '3,500'], ['paune do lakh', '175000', '1,75,000'], ['पौने दो लाख', '175000', '1,75,000'],
    ['sava do sau', '225', '225'], ['paune sau', '75', '75'], ['teen sau pachaas', '350', '350'], ['ek crore do lakh pachaas hazaar', '10250000', '1,02,50,000'],
    ['पांच करोड़', '50000000', '5,00,00,000'], ['पाँच करोड', '50000000', '5,00,00,000'], ['das hazaar', '10000', '10,000'], ['nabbe hazaar', '90000', '90,000'],
    ['ninyaanave', '99', '99'], ['पचहत्तर हज़ार', '75000', '75,000'], ['2 lakh', '200000', '2,00,000'], ['1.5 crore', '15000000', '1,50,00,000'], ['२ लाख', '200000', '2,00,000'],
    ['2,00,000', '200000', '2,00,000'], ['200000', '200000', '2,00,000'], ['twenty five thousand', '25000', '25,000'], ['one hundred and five', '105', '105'],
    ['five hundred thousand', '500000', '5,00,000'], ['do lakh crore', '2000000000000', '20,00,00,00,00,000'], ['sau', '100', '100'], ['ek lakh', '100000', '1,00,000'],
  ];
  for (const [text, integer, indian] of cases) {
    const [number, ...rest] = interpretSpeech(text).numbers;
    assert.equal(rest.length, 0, text); assert.equal(number?.integer, integer, text); assert.equal(number.indian, indian, text); assert.equal(number.text.length > 0, true);
  }
});

test('the do lakh trap: a sentence shows 2,00,000 with exact spans and digest', () => {
  const reading = interpretSpeech('  do   lakh se upar ke invoice dikhao ');
  assert.equal(reading.normalised, 'do lakh se upar ke invoice dikhao');
  assert.equal(reading.understood, '2,00,000 se upar ke invoice dikhao');
  assert.deepEqual(reading.numbers.map(n => [n.text, n.start, n.end, n.integer]), [['do lakh', 0, 7, '200000']]);
  assert.equal(reading.language, 'hi-Latn'); assert.equal(reading.requiresConfirmation, true); assert.match(reading.digest, /^[a-f0-9]{64}$/);
  assert.equal(interpretSpeech('do lakh se upar ke invoice dikhao').digest, reading.digest);
  assert.notEqual(interpretSpeech('do lakh se neeche ke invoice dikhao').digest, reading.digest);
  assert.deepEqual(reading.segments.map(s => s.kind), ['number', 'text']);
});

test('rupee amounts carry exact paise strings; paise words stay paise', () => {
  const [bill] = interpretSpeech('दो लाख रुपये का बिल').numbers;
  assert.equal(bill.unit, 'rupees'); assert.equal(bill.paise, '20000000'); assert.equal(bill.display, '₹2,00,000');
  const [symbol] = interpretSpeech('₹2,00,000 baaki hai').numbers; assert.equal(symbol.unit, 'rupees'); assert.equal(symbol.paise, '20000000');
  const [rs] = interpretSpeech('rs 500 ka refund').numbers; assert.equal(rs.paise, '50000');
  const [half] = interpretSpeech('dedh rupaye').numbers; assert.equal(half.integer, null); assert.equal(half.value, '1.5'); assert.equal(half.paise, '150');
  assert.equal(codes('dedh rupaye').includes('FRACTION_WITHOUT_UNIT'), false);
  const [coins] = interpretSpeech('pachaas paise').numbers; assert.equal(coins.unit, 'paise'); assert.equal(coins.paise, '50'); assert.equal(coins.display, '50 paise');
  const [big] = interpretSpeech('saadhe teen hazaar rupaye').numbers; assert.equal(big.paise, '350000');
  const [english] = interpretSpeech('show invoices above 50,000 rupees').numbers; assert.equal(english.paise, '5000000');
});

test('negations flip the meaning in Hindi, Hinglish and English', () => {
  const flips: [string, string[]][] = [
    ['payment nahi aaya', ['nahi']], ['payment nahin aaya', ['nahin']], ['पेमेंट नहीं आया', ['नहीं']], ['पेमेंट नही आया', ['नही']], ['reminder mat bhejo', ['mat']], ['रिमाइंडर मत भेजो', ['मत']],
    ['do not send', ['not']], ["don't send the reminder", ["don't"]], ['don’t send', ["don't"]], ['never pay this', ['never']], ['no reminders', ['no']], ['customer ne kabhi nahi diya', ['nahi']],
    ['न भेजें', ['न']], ['nhi chahiye', ['nhi']], ['it cannot go', ['cannot']], ['dont send', ['dont']], ["it isn't paid", ["isn't"]],
  ];
  for (const [text, words] of flips) {
    const reading = interpretSpeech(text);
    assert.deepEqual(negated(text), words, text); assert.equal(reading.flipsMeaning, true, text);
    assert.ok(reading.negations.every(n => n.note === 'This flips the meaning.'), text);
    assert.ok(reading.segments.some(s => s.kind === 'negation'), text);
  }
  const without = interpretSpeech('GST ke bina total'); assert.equal(without.negations[0].kind, 'exclusion'); assert.equal(without.negations[0].note, 'This leaves something out.');
  assert.equal(interpretSpeech('बिना जीएसटी').negations[0].kind, 'exclusion'); assert.equal(interpretSpeech('total except returns').negations[0].kind, 'exclusion');
  assert.equal(interpretSpeech('payment aaya').flipsMeaning, false);
});

test('both traps in one sentence are both shown', () => {
  const reading = interpretSpeech('do lakh ka payment nahi aaya');
  assert.equal(reading.understood, '2,00,000 ka payment nahi aaya');
  assert.deepEqual(reading.numbers.map(n => n.integer), ['200000']); assert.deepEqual(reading.negations.map(n => n.text), ['nahi']);
  assert.deepEqual(reading.segments.map(s => s.kind), ['number', 'text', 'negation', 'text']);
});

test('ambiguous words are flagged, not guessed', () => {
  assert.deepEqual(amounts('mujhe do invoice'), []); assert.deepEqual(codes('mujhe do invoice'), ['DO_TWO_OR_VERB']);
  assert.deepEqual(codes('do not send'), []); assert.deepEqual(amounts('do not send'), []);
  assert.deepEqual(codes('saath mein bhejo'), ['SAATH_SIXTY_OR_WITH']); assert.deepEqual(amounts('saath mein bhejo'), []);
  assert.deepEqual(amounts('saath hazaar'), ['60000']); assert.deepEqual(amounts('do rupaye'), ['2']); assert.equal(interpretSpeech('do rupaye').numbers[0].paise, '200');
  assert.deepEqual(codes('karo na'), ['NA_TAG_OR_NEGATION']); assert.equal(interpretSpeech('karo na').negations[0].ambiguous, true);
  assert.deepEqual(codes('invoice no 45'), ['NO_NUMBER_ABBREVIATION']); assert.deepEqual(negated('invoice no 45'), []); assert.deepEqual(amounts('invoice no 45'), ['45']);
  assert.deepEqual(codes('dedh'), ['FRACTION_WITHOUT_UNIT']); assert.deepEqual(amounts('dedh'), ['~1.5']);
  assert.deepEqual(codes('1.234 kilo'), ['TOO_PRECISE']); assert.deepEqual(amounts('1.234 kilo'), []);
  assert.deepEqual(codes('lakh ka order'), ['MULTIPLIER_WITHOUT_COUNT']); assert.deepEqual(amounts('lakh ka order'), []);
  assert.deepEqual(amounts('2 lakh and 5 invoices'), ['200000', '5']); assert.deepEqual(amounts('ek do'), []);
  assert.deepEqual(codes('the sat report'), ['NUMBER_WORD_OR_ENGLISH']);
});

test('missing or unclear parts stay words, never zero', () => {
  const unheard = interpretSpeech('[inaudible] lakh ka order');
  assert.deepEqual(unheard.numbers, []); assert.equal(unheard.unclear[0].text, '[inaudible]'); assert.equal(unheard.unclear[0].state, 'unknown'); assert.equal(unheard.unclear[0].note, 'Not heard clearly.');
  assert.ok(unheard.segments.some(s => s.kind === 'unclear')); assert.ok(!unheard.understood.includes('0'));
  const empty = interpretSpeech('   '); assert.equal(empty.unclear[0].state, 'absent'); assert.equal(empty.understood, ''); assert.deepEqual(empty.numbers, []);
  assert.equal(interpretSpeech('payment ... aaya').unclear.length, 1); assert.equal(interpretSpeech('payment <unk> aaya').unclear.length, 1);
});

test('language is detected for Devanagari, Hinglish, English and mixed', () => {
  assert.equal(interpretSpeech('पेमेंट नहीं आया').language, 'hi-Deva'); assert.equal(interpretSpeech('payment nahi aaya').language, 'hi-Latn');
  assert.equal(interpretSpeech('show overdue invoices').language, 'en'); assert.equal(interpretSpeech('GST बिना total').language, 'mixed'); assert.equal(interpretSpeech('42').language, 'unknown');
});

test('Indian grouping and input limits', () => {
  assert.equal(indianGrouping('0'), '0'); assert.equal(indianGrouping('999'), '999'); assert.equal(indianGrouping('1000'), '1,000'); assert.equal(indianGrouping('123456789'), '12,34,56,789');
  assert.throws(() => indianGrouping('-5'), (e: any) => e.code === 'INVALID_NUMBER');
  assert.throws(() => interpretSpeech('a'.repeat(10001)), (e: any) => e.code === 'INVALID_TRANSCRIPT');
  assert.throws(() => interpretSpeech(42 as any), (e: any) => e.code === 'INVALID_TRANSCRIPT');
});
