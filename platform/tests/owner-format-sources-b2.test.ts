// One-shot B2 task 7 (and fix round 1): amounts on owner screens use the owner form (owner-format.ts formatMoney, formatUsd, formatCost);
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

/**
 * B2 fix round 1: the one list of places under venture/ (build/ included) that write the exact form, each with how many
 * calls it makes and why. Every other amount a screen shows goes through formatMoney, formatUsd or formatCost.
 */
const EXACT: Readonly<Record<string, readonly [calls: number, why: string]>> = {
  // The exact form itself.
  'records.ts': [1, 'formatMicros is defined here'],
  // Files, links and messages that leave the app.
  'money/document.ts': [1, 'the invoice PDF leaves the app, and its standard font has no rupee sign'],
  'money/payment-receipt.ts': [3, 'the receipt and the thank-you words go to the client (C6)'],
  'money/invoice-pdf.ts': [2, 'the PDF caption and the words sent with it go to the client'],
  'money/how-to-pay.ts': [1, "the client's copy of the invoice says how to pay, and it leaves the app"],
  'money/reminders.ts': [1, 'the payment reminder goes to the client'],
  'playbooks/booking-desk/core.ts': [1, 'the deposit message to the client quotes the balance (the desk shows the owner form)'],
  'playbooks/kit/client-room-state.ts': [1, "the client room's price is what the client reads on the hosted room page, and the approved brief binds its digest"],
  'delivery/deliverable.ts': [1, "a deliverable goes to the client: each amount is rebuilt in the exact form from its minor units"],
  'build/share-links.ts': [1, "the month's books text goes to the owner's accountant through a link, exact like the CSV"],
  'build/storefront-assistant-core.ts': [1, "the shop assistant's answer goes to a buyer on the shop's own site"],
  'playbooks/document-desk/core.ts': [4, 'the exported Word document and its figures CSV (the desk shows the owner form)'],
  'playbooks/bookkeeping-cfo/finance-receipt-core.ts': [1, 'the setup handoff file for the accountant (the desk shows the owner form)'],
  'playbooks/trading-journal/tax-pack.ts': [1, "the tax pack file for the CA (desk-core.ts shows the pack's figures in the owner form)"],
  'playbooks/phone-receptionist/script.ts': [1, 'the call script is what the receptionist says to callers, and the report quotes it'],
  'playbooks/phone-receptionist/report.ts': [1, 'the receptionist report is a text file the owner downloads and hands over'],
  'playbooks/kit/documents/money.ts': [1, "a source amount receipt records the exact transcription from the client's document; its id is that body's digest and the bid's price-receipts.json carries it out"],
  // Receipts that keep the exact figure, and text only the AI reads.
  'money/model-receipt.ts': [1, "a model call's receipt keeps the AI cost to four decimals"],
  'agent-runtime/cost-proof.ts': [1, "a sum receipt's addend row keeps the AI cost to four decimals, as the model receipt does"],
  'agent-runtime/quality-cost.ts': [1, "a sum receipt's addend row keeps the AI cost to four decimals (the run's cost line shows the owner form)"],
  'views/row-receipts.ts': [8, "a Today receipt's rows keep the exact figure; its allowed numbers hold the owner form too"],
  'money/across.ts': [2, 'a saved business summary keeps the exact form at rest, which the custody snapshot checks'],
  'agents/helper-brief.ts': [2, "the helper's brief is text only the AI reads"],
  'playbooks/ca-firm/claims.ts': [1, "the claim check's source text, read by code and the AI judge only"],
  'playbooks/ca-firm/money.ts': [1, "a CA step's label is its figure's label, which a client's deliverable quotes (B2 fix round 3)"],
};

const EXACT_CALL = /\bformat(?:Minor|Micros)\(/g;

test('under venture/, the exact money form appears only in the listed places, as many times as listed', () => {
  const found = code
    .map(({ f, text }) => [f, (text.match(EXACT_CALL) ?? []).length] as const)
    .filter(([f, calls]) => calls !== (EXACT[f]?.[0] ?? 0))
    .map(([f, calls]) => `${f}: ${calls} exact call(s), listed ${EXACT[f]?.[0] ?? 0}`);
  assert.deepEqual(found, []);
});

test('under venture/, nothing writes an amount its own way: no own currency formatter and no own digit grouping', () => {
  // The grouping lookahead every hand-made formatter carries, read as its own text: (?=(\d{3})+(?!\d))
  const own = code.filter(({ text }) => /formatSellerMinor/.test(text) || text.includes(String.raw`(?=(\d{3})+(?!\d))`)).map(({ f }) => f);
  assert.deepEqual(own, [], 'amounts go through owner-format.ts formatMoney and counts through formatCount');
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

test('C4 task 36: formatBytes reads a size in steps of 1024, never 0 KB', async () => {
  const { formatBytes } = await import('../runtime/owner-format.ts');
  assert.deepEqual([0, 1, 512, 1023, 1024, 1500, 47_902, 1_048_576, 1_258_291, 12_582_912, 1_610_612_736].map(formatBytes),
    ['0 bytes', '1 byte', '512 bytes', '1023 bytes', '1 KB', '1 KB', '47 KB', '1 MB', '1.2 MB', '12 MB', '1.5 GB']);
});
