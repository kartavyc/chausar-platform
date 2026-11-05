// One-shot B2 task 7: amounts on owner screens use the owner form (owner-format.ts formatMoney, formatUsd, formatCost);
// the exact form (currency.ts formatMinor, records.ts formatMicros) stays only where a file leaves the app, code reads
// the text back, or a receipt keeps the exact figure. Each place that may keep it is listed here with its reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const venture = join(import.meta.dirname, '../runtime/venture');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}
const code = files(venture).map(path => ({ f: relative(venture, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));

/** The places under views/ and money/ that keep the exact form, and why. */
const EXACT: Readonly<Record<string, string>> = {
  'money/document.ts': 'the invoice PDF leaves the app, and its standard font has no rupee sign',
  'money/export.ts': 'the CSV leaves the app for a spreadsheet or an accountant',
  'money/upi.ts': 'it cuts the code off the exact form to build the UPI amount',
  'money/reminders.ts': 'the reminder goes to the client, outside this batch',
  'money/model-receipt.ts': 'the AI receipt keeps four decimals',
  'views/row-receipts.ts': "a Today receipt's rows keep the exact figure (its allowed numbers hold the owner form too)",
  'money/how-to-pay.ts': "the client's copy of the invoice says how to pay, and it leaves the app",
  'money/invoice-pdf.ts': 'the PDF caption and the words sent with it go to the client',
  'money/goals.ts': 'the plain decimal ("150000.00") a goal or price field takes back, never shown as an amount',
  'money/invoices.ts': "the plain decimal of each part for the price receipt's allowed numbers",
  'money/quote.ts': "the plain decimal of each figure for the price receipt's allowed numbers",
  'money/share-price.ts': "the plain decimal of the share for its receipt's allowed numbers",
};

test('under views/ and money/, the exact money form appears only where a file leaves the app, code reads it back, or a receipt keeps it', () => {
  const found = code
    .filter(({ f }) => (f.startsWith('views/') || f.startsWith('money/')) && !Object.hasOwn(EXACT, f))
    .filter(({ text }) => /\bformat(?:Minor|Micros)\(/.test(text))
    .map(({ f }) => f);
  assert.deepEqual(found, []);
});

/** Times kept as 'HH:MM' keys to compare with a setting, never shown. */
const TIME_KEYS: Readonly<Record<string, string>> = {
  'network/followup-rows.ts': "compares the owner's clock with a send time the owner set",
  'notify/settings.ts': 'compares the owner\'s clock with the quiet hours',
  'playbooks/booking-desk/core.ts': 'reads the wall time out of a slot start the owner typed',
};

test('under venture/, no own number grouping (toLocaleString) and no raw clock slice outside the listed comparisons', () => {
  const locale = code.filter(({ text }) => /\.toLocaleString\(/.test(text)).map(({ f }) => f);
  assert.deepEqual(locale, [], 'counts and amounts go through owner-format.ts');
  const clock = code.filter(({ f, text }) => /\.slice\(11, ?16\)/.test(text) && !Object.hasOwn(TIME_KEYS, f)).map(({ f }) => f);
  assert.deepEqual(clock, [], 'times the owner reads go through ownerClock or formatTime');
});
