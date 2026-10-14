import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { booksPlace } from '../../app/ui/src/screens/books/index';
import { sheetOf } from '../../app/ui/src/screens/books/shared';
import { paiseOf, rupeesOf } from '../../app/ui/src/screens/books/BillPhoto';
import { rateOf } from '../../app/ui/src/screens/books/Rates';

// Synthetic replies shaped by the round-two Books contract in docs/lanes/work-books.md.
type Handler = (payload: Record<string, unknown>) => unknown;
type Calls = { method: string; payload: Record<string, unknown> }[];

const field = (value: string | null, certainty = 'sure', line = 1) => ({ value, certainty, region: value === null && certainty === 'could-not-read' ? null : { page: 1, line, of: 12 } });
const billRead = (over: Record<string, unknown> = {}) => ({
  readId: 'billread-1', digest: 'd'.repeat(64), mime: 'image/png', stored: false, expiresAt: '2026-10-14T12:30:00.000Z', untrusted: true,
  reader: { engine: 'tesseract', version: '5.3.4', pages: 1, confidence: 91 },
  supplier: field('Sharma Paper Mart', 'check-this', 1), billNumber: field('SPM-0042', 'sure', 4), date: field('2026-09-05', 'sure', 5),
  total: field(null, 'could-not-read'),
  lines: [{ description: field('A4 Paper Ream', 'sure', 7), quantity: field('2', 'sure', 7), amount: field('50000', 'sure', 7) }],
  tax: [{ name: field('CGST 9%', 'sure', 9), amount: field('4500', 'sure', 9) }],
  sums: { linesPlusTax: { minor: '54500' }, total: { missing: 'unknown' }, equal: null },
  routes: { zohoBooks: { available: false, connections: [] }, tallyPreview: { available: true } }, ...over,
});
const billView = (over: Record<string, unknown> = {}) => ({
  id: 'bill-1', approvalId: 'bill:bill-1', route: 'tally-preview', state: 'prepared', supplier: 'Sharma Paper Mart', billNumber: 'SPM-0042', date: '2026-09-05',
  lines: [{ description: 'A4 Paper Ream', quantity: '2', amount: { minor: '50000' } }], tax: [{ name: 'CGST 9%', amount: { minor: '4500' } }], total: { minor: '54500' },
  voucher: { type: 'Purchase', number: 'SPM-0042', date: '2026-09-05', note: 'prepare-only', lines: [
    { ledger: 'Purchase: A4 Paper Ream', debit: { minor: '50000' }, credit: null }, { ledger: 'Input CGST 9%', debit: { minor: '4500' }, credit: null }, { ledger: 'Sharma Paper Mart', debit: null, credit: { minor: '54500' } }] },
  writeback: null, createdAt: '2026-10-14T10:00:00.000Z', by: 'Owner', ...over,
});
const recordView = { id: 'rec-1', kind: 'customer', name: 'Fixture Traders', details: [], owes: { value: { missing: 'not-counted' }, receiptId: null }, timeline: [],
  optIn: [{ channel: 'mail', answer: 'not-asked', source: null, on: null }, { channel: 'whatsapp', answer: 'not-asked', source: null, on: null }], stoppedOn: null };
const plan = (canDelete = true) => ({ recordId: 'rec-1', canDelete, sourceDeletion: { available: true }, stores: [
  { store: 'facts', count: 12, state: 'needs-owner', reason: 'These rows came from your source files and systems.' },
  { store: 'opt-ins', count: canDelete ? 1 : 0, state: canDelete ? 'can-delete' : 'nothing-held', reason: null }] });

const BASE: Record<string, Handler> = {
  'books.bills': () => ({ bills: [billView({ id: 'bill-0', route: 'zoho-books', state: 'approved', voucher: null, writeback: { id: 'wb-1' } })] }),
  'books.billRead': () => billRead(),
  'books.billConfirm': () => billView(),
  'books.billBook': () => billView({ id: 'bill-0', route: 'zoho-books', state: 'verified', voucher: null, writeback: { id: 'wb-1' } }),
  'books.rates': () => ({ rates: [
    { currency: 'USD', on: '2026-09-02', rate: { units: '832150', per: '10000' }, source: 'RBI reference rate', enteredBy: 'Owner', at: '2026-09-02T10:00:00.000Z' },
    { currency: 'AED', on: '2026-09-01', rate: { units: '6800', per: '3' }, source: 'Bank advice', enteredBy: 'Owner', at: '2026-09-01T10:00:00.000Z' }],
    notCounted: [{ currency: 'EUR', rows: 3 }] }),
  'books.setRate': p => ({ currency: p['currency'], on: p['on'], rate: p['rate'], source: p['source'], enteredBy: 'Owner', at: '2026-10-14T10:00:00.000Z' }),
  'books.removeRate': p => ({ currency: p['currency'], on: p['on'], removed: true }),
  'history.beliefLine': () => ({ operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' }, from: '2026-09-01T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z', omitted: 2, points: [
    { at: '2026-09-01T00:00:00.000Z', value: { missing: 'not-loaded-yet' }, receiptId: 'r-0', changes: ['start'] },
    { at: '2026-09-03T00:00:00.000Z', value: { minor: '500000' }, receiptId: 'r-1', changes: ['new-event'] },
    { at: '2026-09-10T00:00:00.000Z', value: { minor: '450000' }, receiptId: 'r-2', changes: ['correction'] },
    { at: '2026-09-12T00:00:00.000Z', value: { minor: '450000' }, receiptId: 'r-3', changes: ['join'] }] }),
  'records.search': () => ({ records: [{ id: 'rec-1', kind: 'customer', name: 'Fixture Traders', sources: ['src:tally'], facts: 12 }] }),
  'records.get': () => recordView,
  'records.holdings': () => ({ stores: [{ store: 'facts', count: 12 }, { store: 'opt-ins', count: 1 }] }),
  'records.deletionPlan': () => plan(),
  'records.delete': () => ({ id: 'deletion-1', recordId: 'rec-1', at: '2026-10-14T10:00:00.000Z', by: 'Owner', complete: false, rows: [
    { store: 'facts', count: 12, state: 'not-possible', reason: 'These rows came from your source files and systems.' }, { store: 'opt-ins', count: 1, state: 'deleted', reason: null }] }),
};

function setup({ address, role = 'owner', viewer = false, language = 'en', view = 'guided', handlers = {} }: {
  address: Address; role?: string; viewer?: boolean; language?: Language; view?: View; handlers?: Record<string, Handler>;
}) {
  const calls: Calls = [];
  const openReceipt = vi.fn();
  const table = { ...BASE, ...handlers };
  const rpc = { request: async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    const handler = table[method];
    if (!handler) throw Object.assign(new Error('UNKNOWN_METHOD'), { code: 'UNKNOWN_METHOD' });
    return structuredClone(handler(payload));
  } };
  function Harness() {
    const [at, setAt] = useState<Address>(address);
    return <TextProvider language={language}>{booksPlace.render({ address: at, language, view, viewer, member: { id: 'm1', role }, rpc, live: () => true, openReceipt, navigate: next => setAt(next ?? { place: 'books' }) })}</TextProvider>;
  }
  render(<Harness />);
  return { calls, openReceipt, called: (method: string) => calls.filter(c => c.method === method) };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is unavailable in this fixture suite'));
  if (typeof URL.createObjectURL !== 'function') Object.assign(URL, { createObjectURL: () => 'blob:synthetic-bill', revokeObjectURL: () => undefined });
});
afterEach(() => cleanup());

const choose = (file: File) => fireEvent.change(screen.getByLabelText(/Choose a bill/), { target: { files: [file] } });

test('money and rates move as text: rupees to paise and a decimal rate to two whole numbers, never floats', () => {
  expect(paiseOf('731.6')).toBe('73160'); expect(paiseOf('1,250')).toBe('125000'); expect(paiseOf('0.05')).toBe('5'); expect(paiseOf('1.234')).toBeNull(); expect(paiseOf('abc')).toBeNull();
  expect(rupeesOf('73160')).toBe('731.60'); expect(rupeesOf('5')).toBe('0.05');
  expect(rateOf('83.2150')).toEqual({ units: '832150', per: '10000' }); expect(rateOf('3')).toEqual({ units: '3', per: '1' }); expect(rateOf('0')).toBeNull(); expect(rateOf('8e1')).toBeNull();
});

test('bill photo: the page beside the form, regions outlined, an unreadable total empty and amber, confirm sends the corrected fields and digest', async () => {
  const { called } = setup({ address: { place: 'books', sub: 'bill' } });
  choose(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'bill.png', { type: 'image/png' }));
  const form = await screen.findByRole('form', { name: 'What the bill says' });
  expect(called('books.billRead')[0]?.payload).toEqual({ bytesBase64: 'iVBORw==', mime: 'image/png' });
  expect(screen.getByRole('img', { name: 'The bill' })).toBeTruthy();
  const regions = screen.getByRole('img', { name: /Where each field was read/ });
  expect(regions.querySelectorAll('rect[data-region]').length).toBe(5);
  expect(within(form).getByLabelText('Supplier')).toHaveProperty('value', 'Sharma Paper Mart');
  expect(within(form).getAllByText('check this').length).toBeGreaterThan(0);
  const total = within(form).getByLabelText('Total (₹)');
  expect(total).toHaveProperty('value', '');
  expect(total.closest('[data-unread]')).toBeTruthy();
  expect(within(form).getByText('could not read')).toBeTruthy();
  expect(within(form).getByText(/so lines plus tax were not compared/)).toBeTruthy();
  const confirm = within(form).getByRole('button', { name: 'Confirm and prepare' });
  expect(confirm).toHaveProperty('disabled', true);
  fireEvent.change(total, { target: { value: '545.00' } });
  fireEvent.click(confirm);
  await waitFor(() => expect(called('books.billConfirm')[0]?.payload).toEqual({ readId: 'billread-1', digest: 'd'.repeat(64), fields: {
    supplier: 'Sharma Paper Mart', billNumber: 'SPM-0042', date: '2026-09-05', totalMinor: '54500',
    lines: [{ description: 'A4 Paper Ream', quantity: '2', amountMinor: '50000' }], tax: [{ name: 'CGST 9%', amountMinor: '4500' }] } }));
  expect(await screen.findByText(/Prepared as a Tally voucher. It is prepare only/)).toBeTruthy();
  expect(screen.getByRole('table', { name: 'Voucher preview' })).toBeTruthy();
});

test('bill photo: refusals in plain words; a total mismatch is refused; too large never leaves the screen', async () => {
  const { called } = setup({ address: { place: 'books', sub: 'bill' }, handlers: {
    'books.billRead': () => { throw Object.assign(new Error('x'), { code: 'NOT_AVAILABLE_WITH_SEND_SETTING' }); } } });
  choose(new File([new Uint8Array(5 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' }));
  expect(await screen.findByText('This file is larger than 4 MB.')).toBeTruthy();
  expect(called('books.billRead').length).toBe(0);
  choose(new File(['x'], 'bill.jpg', { type: 'image/jpeg' }));
  expect(await screen.findByText('Not available with your send setting.')).toBeTruthy();
  cleanup();
  setup({ address: { place: 'books', sub: 'bill' }, handlers: {
    'books.billRead': () => billRead({ total: field('60000', 'sure', 11), sums: { linesPlusTax: { minor: '54500' }, total: { minor: '60000' }, equal: false } }),
    'books.billConfirm': () => { throw Object.assign(new Error('x'), { code: 'BILL_TOTAL_MISMATCH' }); } } });
  choose(new File(['%PDF-'], 'bill.pdf', { type: 'application/pdf' }));
  const form = await screen.findByRole('form', { name: 'What the bill says' });
  expect(within(form).getByText(/do not equal the total/)).toBeTruthy();
  fireEvent.click(within(form).getByRole('button', { name: 'Confirm and prepare' }));
  expect(await within(form).findByText('Lines plus tax do not equal the total. Correct a field first.')).toBeTruthy();
});

test('bill photo through Zoho asks for the vendor; an approved Zoho bill can be booked from the list; a viewer cannot read a bill', async () => {
  const { called } = setup({ address: { place: 'books', sub: 'bill' }, handlers: {
    'books.billRead': () => billRead({ total: field('54500'), sums: { linesPlusTax: { minor: '54500' }, total: { minor: '54500' }, equal: true }, routes: { zohoBooks: { available: true, connections: [{ id: 'conn-1', label: 'Zoho trial' }] }, tallyPreview: { available: true } } }),
    'books.billConfirm': () => billView({ route: 'zoho-books', voucher: null, writeback: { id: 'wb-2' } }) } });
  fireEvent.click(await screen.findByRole('button', { name: 'Book it now' }));
  await waitFor(() => expect(called('books.billBook')[0]?.payload).toEqual({ id: 'bill-0' }));
  choose(new File(['x'], 'bill.png', { type: 'image/png' }));
  const form = await screen.findByRole('form', { name: 'What the bill says' });
  expect(within(form).getByText('Lines plus tax equal the total as read.')).toBeTruthy();
  fireEvent.click(within(form).getByRole('radio', { name: 'A bill in Zoho Books' }));
  const confirm = within(form).getByRole('button', { name: 'Confirm and prepare' });
  expect(confirm).toHaveProperty('disabled', true);
  fireEvent.change(within(form).getByLabelText('Zoho vendor id'), { target: { value: 'vendor-7' } });
  fireEvent.click(confirm);
  await waitFor(() => expect(called('books.billConfirm')[0]?.payload['zoho']).toEqual({ connectionId: 'conn-1', vendorId: 'vendor-7' }));
  expect(await screen.findByText('Prepared. It waits for your yes in Approvals.')).toBeTruthy();
  cleanup();
  setup({ address: { place: 'books', sub: 'bill' }, role: 'viewer', viewer: true });
  expect(await screen.findByText(/cannot read or prepare one/)).toBeTruthy();
  expect(screen.queryByLabelText(/Choose a bill/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Book it now' })).toBeNull();
});

test('belief line: a step line whose marks open their receipts, with what changed each point', async () => {
  const { called, openReceipt } = setup({ address: { place: 'books', sub: 'history' } });
  fireEvent.click(screen.getByRole('button', { name: 'What we believed over time' }));
  const form = await screen.findByRole('form', { name: 'The belief line' });
  fireEvent.change(within(form).getByLabelText('Period from'), { target: { value: '2026-09-01' } });
  fireEvent.change(within(form).getByLabelText('Period to'), { target: { value: '2026-09-30' } });
  fireEvent.change(within(form).getByLabelText('Look from'), { target: { value: '2026-09-01' } });
  fireEvent.change(within(form).getByLabelText('Look to'), { target: { value: '2026-10-13' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Show' }));
  await screen.findByText('a correction');
  expect(called('history.beliefLine')[0]?.payload).toEqual({ operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' }, from: '2026-09-01T00:00:00.000Z', to: '2026-10-13T23:59:59.999Z' });
  expect(screen.getByText('customers joined')).toBeTruthy();
  expect(screen.getByText(/2 earlier changes are not drawn/)).toBeTruthy();
  const line = document.querySelector('[data-belief-line]') as HTMLElement;
  const marks = within(line).getAllByRole('button');
  fireEvent.click(marks[0]!);
  expect(openReceipt).toHaveBeenCalledWith('r-1');
  expect(line.querySelector('[data-change="correction"]')?.className).toBeTruthy();
});

test('exchange rates: exact rates, rows not counted, an owner enters and removes a rate; a viewer only reads', async () => {
  const { called } = setup({ address: { place: 'books', sub: 'rates' } });
  expect(await screen.findByText('₹83.2150 for 1 USD')).toBeTruthy();
  expect(screen.getByText('₹6800 for 3 AED')).toBeTruthy();
  expect(screen.getByText(/3 rows in EUR have no rate for their date/)).toBeTruthy();
  const form = screen.getByRole('form', { name: 'Enter a rate' });
  fireEvent.change(within(form).getByLabelText('Currency (three letters, like USD)'), { target: { value: 'usd' } });
  fireEvent.change(within(form).getByLabelText('Date of the rate'), { target: { value: '2026-09-03' } });
  fireEvent.change(within(form).getByLabelText('Rupees for one unit (like 83.2150)'), { target: { value: '83.3' } });
  fireEvent.change(within(form).getByLabelText('Where the rate came from'), { target: { value: 'RBI reference rate' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Save rate' }));
  await waitFor(() => expect(called('books.setRate')[0]?.payload).toEqual({ currency: 'USD', on: '2026-09-03', rate: { units: '833', per: '10' }, source: 'RBI reference rate' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'Remove this rate' }));
  await waitFor(() => expect(called('books.removeRate')[0]?.payload).toEqual({ currency: 'USD', on: '2026-09-02' }));
  cleanup();
  setup({ address: { place: 'books', sub: 'rates' }, role: 'viewer', viewer: true });
  await screen.findByText('₹83.2150 for 1 USD');
  expect(screen.queryByRole('form', { name: 'Enter a rate' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
});

test('delete what we hold: the plan per store, typed confirmation of the customer id, then the report', async () => {
  const { called } = setup({ address: { place: 'books', sub: 'customers', sheet: sheetOf('rec-1') } });
  fireEvent.click(await screen.findByRole('button', { name: 'Delete what we hold' }));
  const plan = await screen.findByRole('form', { name: 'Delete what we hold' });
  expect(screen.getByText('needs the owner')).toBeTruthy();
  const button = within(plan).getByRole('button', { name: 'Delete' });
  fireEvent.change(within(plan).getByLabelText('Type the customer id rec-1 to confirm'), { target: { value: 'rec-' } });
  expect(button).toHaveProperty('disabled', true);
  fireEvent.change(within(plan).getByLabelText('Type the customer id rec-1 to confirm'), { target: { value: 'rec-1' } });
  fireEvent.click(button);
  await waitFor(() => expect(called('records.delete')[0]?.payload).toEqual({ id: 'rec-1', confirmation: 'rec-1' }));
  expect(await screen.findByRole('heading', { name: 'Deletion report' })).toBeTruthy();
  expect(screen.getByText('not possible here')).toBeTruthy(); expect(screen.getByText('deleted')).toBeTruthy();
  expect(screen.getByText(/Some stores still hold rows/)).toBeTruthy();
});

test('delete: nothing the lane can delete says who can; an accountant sees no Delete; Hindi words', async () => {
  setup({ address: { place: 'books', sub: 'customers', sheet: sheetOf('rec-1') }, handlers: { 'records.deletionPlan': () => plan(false) } });
  fireEvent.click(await screen.findByRole('button', { name: 'Delete what we hold' }));
  expect(await screen.findByText(/cannot delete these records itself/)).toBeTruthy();
  expect(screen.queryByRole('form', { name: 'Delete what we hold' })).toBeNull();
  cleanup();
  setup({ address: { place: 'books', sub: 'customers', sheet: sheetOf('rec-1') }, role: 'accountant' });
  await screen.findByText('opt-ins');
  expect(screen.queryByRole('button', { name: 'Delete what we hold' })).toBeNull();
  cleanup();
  setup({ address: { place: 'books', sub: 'rates' }, language: 'hi' });
  expect(await screen.findByText('1 USD के लिए ₹83.2150')).toBeTruthy();
});
