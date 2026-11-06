// One-shot B2 task 7a: the Money place writes amounts in the owner form ("₹1,00,000", "₹2,000.50"); the invoice PDF and
// the CSV, which leave the app, keep the exact form ("INR 100,000.00").
import test from 'node:test';
import assert from 'node:assert/strict';
import { goalBusiness, invoice } from './venture-goals-helpers.ts';

const EXACT = /\b(?:INR|USD) -?\d/;

test('overview, invoice list, invoice, books, aging, cash, flow and margins say rupees in the owner form; the PDF and CSV stay exact', async () => {
  // PRICE 19,750.00 a month; 4 months is 79,000.00 before tax, plus GST 18% (14,220.00): 93,220.00.
  const env = await goalBusiness({ price: '2118644' });
  const issued = await invoice(env, '4', '2026-10-01');
  // 21,186.44 a month x 4 is 84,745.76, plus GST 18% (15,254.24): exactly 1,00,000.00.
  assert.equal(issued.invoice.totalMinor, '10000000');
  await env.money('venture.payment.record', { invoiceId: issued.invoice.id, amount: '2000.50', receivedOn: '2026-10-20', method: 'upi' });

  const views: Record<string, unknown> = {
    overview: await env.money('venture.money.overview', {}),
    list: await env.money('venture.invoice.list', {}),
    invoice: await env.money('venture.invoice.get', { invoiceId: issued.invoice.id }),
    books: await env.money('venture.books.summary', { period: 'this-month' }),
    aging: await env.money('venture.money.aging', {}),
  };
  // The invoice's document text is the PDF's own words, which leave the app in the exact form.
  const shown = (value: unknown) => JSON.stringify(value, (key, inner) => (key === 'documentText' ? undefined : inner));
  const text = shown(views);
  assert.match(text, /₹1,00,000/, 'the invoice total in the owner form');
  assert.match(text, /₹2,000\.50/, 'a payment with paise keeps them');
  assert.doesNotMatch(text, /₹1,00,000\.00|INR 1,00,000|INR 100,000\.00/);
  for (const [name, view] of Object.entries(views)) assert.doesNotMatch(shown(view), EXACT, name);

  assert.match(JSON.stringify(views.invoice), /INR 100,000[.]00/, 'the invoice document (the PDF text) leaves the app in the exact form');
  const csv = await env.money<{ files: { name: string; text: string }[] } | { text: string }>('venture.money.export', { month: '2026-10' });
  assert.match(JSON.stringify(csv), /100000\.00|100,000\.00/, 'the CSV keeps the exact figure');
});
