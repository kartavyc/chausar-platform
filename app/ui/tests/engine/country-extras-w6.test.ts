import { expect, it } from 'vitest';
import { FakeExtrasDesk } from '../../src/engine/fake-extras';
import { countryProfile } from '../../../../platform/runtime/venture/core/countries';
import type { MoneyLedger } from '../../src/engine/fake-money';
import type { MoneyOverview, TaxWorking } from '../../src/engine/types';

function sample(ca = false) {
  let business = 'lumen';
  const invoice = (id: string, currency: string, countryCode: string, tax: number) => ({ id, number: id, clientId: 'client', client: 'Sample client', status: 'issued' as const, issueDate: '2026-10-10', dueDate: '2026-11-10', currency, countryCode, subtotal: 10000, tax, total: 10000 + tax, balance: 10000 + tax, priceReceiptId: 'price-' + id, description: 'Sample work', dueInDays: 30 });
  const ledger: MoneyLedger = { invoices: [invoice('old', 'INR', 'IN', 1800), invoice('new', 'USD', 'US', 0)], payments: [{ id: 'pay-new-1', at: '2026-10-12T10:00:00Z', invoiceId: 'new', receivedOn: '2026-10-12', method: 'bank-transfer', amount: 2500, state: 'cleared', tds: null, booksReceiptId: 'payment-new' }, { id: 'pay-old', at: '2026-10-12T10:00:00Z', invoiceId: 'old', receivedOn: '2026-10-12', method: 'bank-transfer', amount: 5000, state: 'cleared', tds: null, booksReceiptId: 'payment-old' }], credits: [], bills: { due: [], paid: [] } };
  const host = { current: () => business, now: () => '2026-10-20T10:00:00Z', digest: (value: unknown) => JSON.stringify(value), businessName: () => 'Sample', playbook: () => ca ? { id: 'ca-firm', label: 'CA firm' } : undefined, owed: () => ({ value: 'INR 99.00' }), hosted: () => false, emit: () => {}, ledger: () => ledger,
    ask: (method: string) => method === 'venture.get' ? { venture: { country: countryProfile(ca ? 'IN' : 'US'), originalCountry: countryProfile('IN') } } : { blueprint: { backOffice: { taxLabel: ca ? 'GST' : 'Sales tax', taxMode: ca ? 'gst' : 'sales-tax', taxRegistered: { value: false, label: ca ? 'assumption' : 'told-by-you' }, taxRateBps: '0' } } },
  };
  const desk = new FakeExtrasDesk(host);
  return { desk, ledger, switchBusiness: () => { business = 'ledgerline'; } };
}

it('overview totals use current currency and show excluded old-currency amounts through receipts', () => {
  const { desk, switchBusiness } = sample();
  const view = desk.request('venture.money.overview', {}) as MoneyOverview;
  const owed = view.lines.find(line => line.id === 'owed')!;
  const received = view.lines.find(line => line.id === 'received')!;
  expect(owed.value).toBe('USD 100.00');
  expect(received.value).toBe('USD 25.00');
  expect(received.basis?.notCounted?.count).toBe(1);
  expect(received.basis?.notCounted?.line).toContain('another currency');
  expect((desk as any).receipt(received.receiptId).figures[0].display).toBe('USD 25.00');
  switchBusiness();
  expect((desk as any).receipt(received.receiptId)).toBeUndefined();
});

it('a CA returning to India keeps its GST setup boundary and INR-only yearly income total', () => {
  const { desk } = sample(true);
  const month = desk.request('venture.tax.working', { period: '2026-10' }) as TaxWorking;
  expect(month.sections).toEqual([{ id: 'gst', title: 'GST', lines: [], note: 'Your plan says you do not charge GST, so there is no GST working. Chausar assumed this; confirm it in the business menu.' }]);
  const year = desk.request('venture.tax.working', { period: 'FY 2026-27' }) as TaxWorking;
  expect(year.sections.find(section => section.id === 'income-tax')?.lines).toContainEqual({ label: 'Billed in the year, without tax', value: 'INR 100.00' });
  expect(year.sections.find(section => section.id === 'income-tax')?.note).toContain('Invoices in other currencies are excluded; no conversion was made.');
});

it('tax working keeps original tax labels and separate currencies, honours periods, and proves totals', () => {
  const { desk, ledger } = sample();
  const view = desk.request('venture.tax.working', { period: '2026-10' }) as TaxWorking;
  expect(view.sections[0]?.title).toBe('Tax by currency');
  expect(view.sections[0]?.lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ value: 'GST INR 18.00 on INR 100.00' }),
    expect.objectContaining({ value: 'Sales tax USD 0.00 on USD 100.00' }),
    expect.objectContaining({ label: 'GST on invoices issued in October 2026', value: 'INR 18.00', receiptId: expect.any(String) }),
  ]));
  const total = view.sections[0]!.lines.find(line => line.label === 'GST on invoices issued in October 2026')!;
  expect((desk as any).receipt(total.receiptId).stale).toBe(false);
  ledger.invoices[0]!.status = 'void' as never;
  expect((desk as any).receipt(total.receiptId).stale).toBe(true);
  const empty = desk.request('venture.tax.working', { period: '2026-09' }) as TaxWorking;
  expect(empty.sections[0]?.lines).toContainEqual(expect.objectContaining({ value: 'No invoices issued' }));
  expect(() => desk.request('venture.tax.working', { period: 'bad' })).toThrow(expect.objectContaining({ code: 'INVALID_VENTURE_REQUEST' }));
});
