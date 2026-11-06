import { describe, it, expect } from 'vitest';
import { FakeMoneyViews } from '../../src/engine/fake-money-views';
import type { MoneyLedger } from '../../src/engine/fake-money';
import type { AgingView, FlowView, MarginsView } from '../../src/engine/types';
import { FakeBills } from '../../src/engine/fake-bills';
import { FakeGoals } from '../../src/engine/fake-goals';
import type { W4DeskHost } from '../../src/engine/fake-w4';
import type { GoalView, MoneyExportFile } from '../../src/engine/types';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

const ledger: MoneyLedger = {
 invoices: ['INR', 'USD'].map((currency, index) => ({ id: `invoice-${currency}`, number: `INV-${index}`, clientId: `client-${index}`, client: `Client ${index}`, status: 'issued', issueDate: '2026-10-01', dueDate: '2026-10-10', currency, countryCode: index ? 'US' : 'IN', subtotal: index ? 250 : 10000, tax: 0, total: index ? 250 : 10000, balance: index ? 250 : 10000, priceReceiptId: `price-${index}`, description: 'Sample', dueInDays: 9 })),
 payments: ['INR', 'USD'].map((currency, index) => ({ id: `payment-${currency}`, at: '2026-10-02T00:00:00Z', invoiceId: `invoice-${currency}`, receivedOn: '2026-10-02', method: 'bank-transfer', amount: index ? 250 : 10000, state: 'cleared', tds: null, booksReceiptId: null })),
 credits: [], bills: { due: [], paid: [] },
};
function desk(rows = ledger) { return new FakeMoneyViews({ now: () => '2026-10-23T12:00:00Z', business: () => 'mixed', name: () => 'Sample', ledger: () => structuredClone(rows), ask: (method) => method === 'venture.get' ? { venture: { country: { code: 'US', currency: 'USD' } } } : { rupeeRate: null } }); }
describe('fake current-currency money views', () => {
 it('discloses foreign bills even when no invoice exists', () => {
  const views = desk({ invoices: [], payments: [], credits: [], bills: { due: [{ billId: 'old', vendor: 'Sample', dueDate: '2026-10-25', balance: 10000, expected: false, currency: 'INR' }], paid: [{ billId: 'old', vendor: 'Sample', paidOn: '2026-10-20', amount: 5000, currency: 'INR' }] } });
  expect(JSON.stringify((views.request('venture.money.flow', { months: 1 }) as FlowView).basis)).toMatch(/other currencies/);
 });
 it('books summaries use the accepted country for every period and disclose excluded history', async () => {
  const engine = createFakeClient(new FakeEngine());
  const plan = await engine.request('venture.blueprint.update', { patch: { countryCode: 'US' } });
  const queue = await engine.request('venture.queue.list', {});
  const row = queue.rows.find(item => item.viewRef?.kind === 'plan' && item.viewRef.id === plan.blueprint.id)!;
  await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true });
  expect((await engine.request('venture.goals.get', {})).next?.figure ?? null).toBeNull();
  for (const period of ['all', 'this-month', '2026-10']) {
   const books = await engine.request('venture.books.summary', { period });
   expect(books.currency).toBe('USD');
   expect(books.figures.every(figure => figure.display === '$0')).toBe(true);
   expect(books.notes.join(' ')).toMatch(/other currencies.*excluded/i);
  }
  const old = (await engine.request('venture.invoice.list', {})).find(invoice => invoice.status === 'issued')!;
  await engine.request('venture.payment.record', { invoiceId: old.id, amount: '1', receivedOn: '2026-12-01', method: 'bank-transfer' });
  expect((await engine.request('venture.books.summary', { period: '2026-12' })).notes.join(' ')).toMatch(/other currencies.*excluded/i);
 });
 it('retains an old goal without relabelling it and accepts zero-decimal new goals', () => {
  let code = 'IN';
  const goals = new FakeGoals({ current: () => 'mixed', now: () => '2026-10-23T12:00:00Z', emit() {}, rows: () => [], ask: (method: string) => method === 'venture.get' ? { venture: { country: { code }, originalCountry: code === 'IN' ? undefined : { code: 'IN' } } } : method === 'venture.invoice.list' ? [] : method === 'venture.books.summary' ? { figures: [] } : null } as unknown as W4DeskHost);
  goals.request('venture.goals.set', { month: '2026-10', amount: '250' });
  code = 'JP';
  const unset = goals.request('venture.goals.get', {}) as GoalView;
  expect(unset.state).toBe('unset'); expect(unset.line).toMatch(/INR.*JPY/);
  const next = goals.request('venture.goals.set', { month: '2026-10', amount: '250' }) as GoalView;
  expect(next.goal?.display).toBe('JPY 250');
 });
 it('zero-decimal invoiced progress keeps its exact scale', () => {
  const goals = new FakeGoals({ current: () => 'mixed', now: () => '2026-10-23T12:00:00Z', emit() {}, rows: () => [], ask: (method: string) => method === 'venture.get' ? { venture: { country: { code: 'JP' }, originalCountry: { code: 'IN' } } } : method === 'venture.invoice.list' ? [{ id: 'jp', number: 'INV-JP', status: 'issued', issueDate: '2026-10-01' }] : method === 'venture.invoice.get' ? { invoice: { currency: 'JPY' }, figures: [{ key: 'subtotal', display: 'JPY 250' }], client: { name: 'Sample client' } } : method === 'venture.books.summary' ? { figures: [] } : null } as unknown as W4DeskHost);
  const view = goals.request('venture.goals.set', { month: '2026-10', amount: '1000' }) as GoalView;
  expect(view.invoiced.display).toBe('JPY 250');
  expect(view.invoicedPercent).toBe(25);
 });
 it('exports each historical currency while total rows are explicitly current-currency only', () => {
  const exported = desk().request('venture.money.export', { month: '2026-10' }) as MoneyExportFile;
  const lines = exported.csv.split('\r\n');
  expect(lines.find(row => row.startsWith('Invoice,') && row.includes('INV-0'))).toMatch(/,INR$/);
  expect(lines.find(row => row.startsWith('Payment,') && row.includes('INV-0'))).toMatch(/,INR$/);
  expect(lines.find(row => row.startsWith('Payment,') && row.includes('INV-1'))).toMatch(/,USD$/);
  expect(lines.filter(row => row.startsWith('Total,')).every(row => row.endsWith(',USD'))).toBe(true);
  expect(lines.filter(row => row.startsWith('Total,')).join('\n')).not.toContain('102.50');
  expect(lines.filter(row => row.startsWith('Not in totals,'))).toHaveLength(2);
  expect(exported.csv).toContain('Chausar has no rate to USD.');
 });
 it('bills retain their own currency after a move, including zero-decimal amounts', () => {
  let currency = 'INR';
  const bills = new FakeBills({ now: () => '2026-10-23T12:00:00Z', business: () => 'mixed', currency: () => currency });
  const add = (vendor: string) => bills.request('venture.bills.add', { vendor, lines: [{ description: 'Sample', amount: '250', taxName: '', taxRateBps: '0' }], billDate: '2026-10-20', dueDate: '2026-10-25' }) as { bill: { id: string; total: string } };
  const old = add('Old'); currency = 'JPY'; const current = add('New');
  expect(current.bill.total).toBe('JPY 250');
  const paid = bills.request('venture.bills.pay', { billId: old.bill.id, amount: '250', paidOn: '2026-10-23', method: 'bank-transfer' }) as { bill: { paid: string } };
  expect(paid.bill.paid).toBe('₹250');
  expect(bills.ledger().paid[0]?.currency).toBe('INR');
 });
 it('books, flow, aging and margins keep unlike amounts apart and disclose exclusions', () => {
  const view = desk();
  expect(view.booksMonth('2026-10').figures[0]?.display).toBe('$2.50');
  const flow = view.request('venture.money.flow', { months: 1 }) as FlowView;
  expect(flow.months[0]?.in?.display).toBe('$2.50');
  expect(JSON.stringify(flow.basis)).toMatch(/other currencies/i);
  const aging = view.request('venture.money.aging', {}) as AgingView;
  expect(aging.invoices.map(row => row.invoiceId)).toEqual(['invoice-USD']);
  expect(aging.total.display).toBe('$2.50');
  const margins = view.request('venture.money.margins', { month: '2026-10' }) as MarginsView;
  expect(margins.rows.map(row => row.clientId)).toEqual(['client-1']);
  expect(margins.rows[0]?.invoiced.display).toBe('$2.50');
  expect(margins.rows[0]?.note).toMatch(/US dollars to USD/);
 });
});
