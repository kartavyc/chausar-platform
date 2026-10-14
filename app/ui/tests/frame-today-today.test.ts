import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_SENTENCES, ACTIVITY_SENTENCE_TYPES, activitySentence, catalogueText } from '../src/format/sentences.ts';
import { projectWorth, WORTH_ROW_PREFIX } from '../src/screens/today/worth.ts';
import { cashWeek } from '../src/screens/today/cash.ts';
import { PHONE_MESSAGE_KINDS, PHONE_MESSAGES, phoneMessageBody } from '../src/screens/today/phone-messages.ts';
import { isWorthReply, type ActivityEvent, type WorthReply } from '../src/bridge/todayx-contract.ts';
import type { ColumnsChart, Figure, Language } from '../src/app/presentation.ts';
import en from '../src/text/en.json' with { type: 'json' };
import hi from '../src/text/hi.json' with { type: 'json' };

// Synthetic events and rows only. Names end in Demo; nothing here is a real workspace.
const LANGUAGES: readonly Language[] = ['en', 'hi'];
const DEVANAGARI = /[ऀ-ॿ]/;
const VALUES: Readonly<Record<string, string>> = {
  source: 'Zoho Books Demo', rows: '124500', route: 'local-small-demo', action: 'invoice.create',
  system: 'Tally Demo', job: 'Morning brief Demo', version: '7', lesson: 'freight-outward', name: 'Meera Demo', rule: 'approval',
};
const event = (type: string, values: Readonly<Record<string, string>> = VALUES, route: string | null = null): Pick<ActivityEvent, 'type' | 'values' | 'route'> => ({ type, values, route });

function clean(sentence: string, label: string) {
  assert.ok(sentence.trim().length > 0, `${label} is empty`);
  assert.doesNotMatch(sentence, /—/, `${label} has an em dash`);
  assert.doesNotMatch(sentence, /!/, `${label} has an exclamation mark`);
  assert.doesNotMatch(sentence, /\{[A-Za-z]+\}/, `${label} left a value unfilled`);
}

test('every listed activity event type has its own sentence function, in English and Hindi', () => {
  assert.deepEqual(Object.keys(ACTIVITY_SENTENCES).sort(), [...ACTIVITY_SENTENCE_TYPES].sort());
  assert.equal(new Set(Object.values(ACTIVITY_SENTENCES)).size, ACTIVITY_SENTENCE_TYPES.length);
  for (const type of ACTIVITY_SENTENCE_TYPES) {
    const english = activitySentence(event(type), 'en');
    const hindi = activitySentence(event(type), 'hi');
    clean(english, `${type} en`);
    clean(hindi, `${type} hi`);
    // No untranslated fallback: the Hindi is its own sentence, written in Devanagari.
    assert.notEqual(hindi, english, `${type} hi is the English sentence`);
    assert.match(hindi, DEVANAGARI, `${type} hi has no Hindi words`);
    assert.notEqual(english, activitySentence(event('zz.unknown'), 'en'), `${type} falls back`);
  }
});

test('sentences carry values as written, digits through the format module, and missing values as words', () => {
  assert.equal(activitySentence(event('import.done'), 'en'), '1,24,500 rows were imported from Zoho Books Demo.');
  assert.equal(activitySentence(event('import.done', { source: 'Zoho Books Demo', rows: 'many' }), 'en'), 'not recorded rows were imported from Zoho Books Demo.');
  assert.equal(activitySentence(event('import.done', {}), 'hi'), 'दर्ज नहीं से दर्ज नहीं पंक्तियाँ आयात हुईं।');
  assert.equal(activitySentence(event('model.request', {}, 'Claude Demo route'), 'en'), 'A request went to the AI model by Claude Demo route.');
  assert.equal(activitySentence(event('job.stopped', { job: 'Brief Demo', rule: 'budget' }), 'en'), 'Brief Demo was stopped by the budget.');
  assert.equal(activitySentence(event('job.stopped', { job: 'Brief Demo', rule: 'budget' }), 'hi'), 'Brief Demo को बजट ने रोका।');
  assert.equal(activitySentence(event('job.stopped', { job: 'Brief Demo' }), 'en'), 'Brief Demo was stopped by a rule.');
  // A value that looks like a template is data and stays as written.
  assert.equal(activitySentence(event('source.read', { source: '{rows} Demo' }), 'en'), '{rows} Demo was read.');
});

test('an unknown event type gets the fallback sentence, naming the type code as data', () => {
  for (const language of LANGUAGES) {
    const sentence = activitySentence(event('payroll.queued'), language);
    clean(sentence.replace('payroll.queued', ''), `fallback ${language}`);
    assert.ok(sentence.includes('payroll.queued'));
  }
  assert.match(activitySentence(event('payroll.queued'), 'hi'), DEVANAGARI);
});

test('every new frame-today key exists in both catalogues, without em dash or exclamation mark', () => {
  const english: Readonly<Record<string, string>> = en, hindi: Readonly<Record<string, string>> = hi;
  const keys = Object.keys(english).filter(k => /^(TD-01\.worth\.|TD-03\.(waiting|close\.|keys)|TD-04\.|PH-0[1-3]\.)/.test(k));
  assert.ok(keys.length > 80);
  for (const key of keys) {
    assert.ok(key in hindi, `${key} missing in Hindi`);
    for (const text of [english[key]!, hindi[key]!]) assert.doesNotMatch(text, /[—!]/, key);
  }
  for (const key of ['TD-04.more', 'TD-01.worth.fewer', 'TD-01.worth.seeAll']) for (const text of [english[key]!, hindi[key]!]) assert.ok([...text].length <= 22, key);
  assert.throws(() => catalogueText('en', 'TD-04.no-such-key'), /TEXT_KEY_MISSING/);
});

test('no phone message body carries a digit, in either language', () => {
  assert.deepEqual([...PHONE_MESSAGE_KINDS].sort(), Object.keys(PHONE_MESSAGES).sort());
  assert.equal(PHONE_MESSAGE_KINDS.length, 4);
  for (const language of LANGUAGES) {
    for (const kind of PHONE_MESSAGE_KINDS) {
      const body = phoneMessageBody(kind, language);
      for (const part of [body.headline, body.link]) {
        assert.ok(part.length > 0);
        // Latin digits and Devanagari digits both fail.
        assert.doesNotMatch(part, /[0-9०-९]/, `${kind} ${language}: ${part}`);
        assert.doesNotMatch(part, /₹|[—!]/, `${kind} ${language}`);
      }
    }
  }
  assert.equal(phoneMessageBody('review', 'en').headline, 'Something is ready for your review.');
  assert.equal(phoneMessageBody('week-ahead', 'en').headline, 'The week ahead is ready.');
  assert.equal(phoneMessageBody('document', 'en').headline, 'A document was received.');
  assert.equal(phoneMessageBody('due-date', 'en').headline, 'A due date is near.');
});

const worthReply: WorthReply = {
  state: 'ready',
  rows: [
    { id: 'w1', kind: 'moved', subject: 'Freight Outward Demo', at: null, figure: { unit: 'paise', exact: '31000000', receiptId: 'R-w1' }, opens: '#/reports/month' },
    { id: 'w2', kind: 'moved', subject: null, at: null, finding: 'tested', figure: { unit: 'basis-points', exact: '-1800', receiptId: 'R-w2' }, opens: null },
    { id: 'w3', kind: 'due-soon', subject: 'GSTR-3B', at: '2026-10-20', opens: '#/reports/due' },
    { id: 'w4', kind: 'file-refused', subject: 'statement-demo.pdf', at: '2026-10-14T06:05:00Z', figure: { unit: 'count', exact: '212', receiptId: 'R-w4' }, opens: '#/books/sources' },
    { id: 'w5', kind: 'approval-expired', subject: null, at: null, opens: '#/nowhere/at-all' },
  ],
};

test('worth a look: rows from kind, subject as written, figures with receipts, findings as words', () => {
  assert.ok(isWorthReply(worthReply));
  const guided = projectWorth(worthReply, { language: 'en', view: 'guided' });
  assert.equal(guided.missing, undefined);
  assert.equal(guided.rows.length, 5);
  const [moved, tested, due, refused, expired] = guided.rows;
  assert.equal(moved!.id, `${WORTH_ROW_PREFIX}w1`);
  assert.equal(moved!.what, 'A figure moved');
  assert.equal(moved!.note, 'lead, not tested');
  assert.equal(moved!.asWritten, 'Freight Outward Demo');
  assert.deepEqual(moved!.figure, { kind: 'money', exact: '31000000', display: '₹3,10,000', receiptId: 'R-w1', labels: [] });
  assert.deepEqual(moved!.can, ['open']);
  assert.equal(tested!.note, 'tested');
  assert.equal((tested!.figure as Figure).display, '-18%');
  assert.deepEqual(tested!.can, []);
  assert.equal(due!.note, 'due 20 Oct 2026');
  assert.equal(due!.figure, undefined);
  assert.equal((refused!.figure as Figure).display, '212');
  assert.equal(refused!.note, 'as of 14 Oct 2026');
  // A hash for an unknown place opens nothing rather than somewhere else.
  assert.deepEqual(expired!.can, []);
  assert.deepEqual(guided.opens.map(o => [o.rowId, o.address]), [
    ['worth:w1', { place: 'reports', sub: 'month' }], ['worth:w3', { place: 'reports', sub: 'due' }], ['worth:w4', { place: 'books', sub: 'sources' }],
  ]);
  const simple = projectWorth(worthReply, { language: 'hi', view: 'simple' });
  assert.equal((simple.rows[0]!.figure as Figure).display, '₹3.1 लाख');
  assert.equal(simple.rows[0]!.note, 'संकेत, जाँचा नहीं गया');
  assert.equal(simple.rows[0]!.asWritten, 'Freight Outward Demo');
});

test('worth a look not loaded yet is its words, never an empty list', () => {
  const projected = projectWorth({ state: 'not-loaded-yet', rows: [] }, { language: 'en', view: 'guided' });
  assert.equal(projected.missing, 'not-loaded-yet');
  assert.equal(projected.rows.length, 0);
});

const money = (id: string, exact: string, display: string): Figure => ({ kind: 'money', exact, display, receiptId: id, labels: [] });
const week = (today: ColumnsChart['values'][number]['value']): ColumnsChart => ({
  form: 'columns', sentence: 'Cash sales, seven days',
  values: [{ id: 'd1', label: 'Thu', value: money('R-d1', '120000', '₹1,200') }, { id: 'd7', label: 'Wed', value: today }],
});

test('Simple cash: today open until entered, then filled with what the owner said', () => {
  const open = cashWeek({ week: week({ kind: 'missing', missing: 'cash-not-captured' }) });
  assert.equal(open.values[1]!.outline, true);
  assert.equal(open.values[0]!.outline, undefined);
  const told = money('R-told', '845000', '₹8,450');
  const entered = cashWeek({ entered: told, week: week({ kind: 'missing', missing: 'cash-not-captured' }) });
  assert.equal(entered.values[1]!.outline, undefined);
  assert.deepEqual(entered.values[1]!.value, told);
  const supplied = cashWeek({ entered: told, week: week(money('R-d7', '845000', '₹8,450')) });
  assert.equal((supplied.values[1]!.value as Figure).receiptId, 'R-d7');
});
