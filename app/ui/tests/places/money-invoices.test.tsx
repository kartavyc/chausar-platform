import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

type Call = [string, unknown];
const NOW = () => '2026-10-21T11:00:00.000Z';

function start(hash: string, engine = new FakeEngine({ now: NOW })) {
  window.location.hash = hash;
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = (async (method: string, params?: unknown) => {
    calls.push([method, params]);
    return request(method as never, params as never);
  }) as typeof client.request;
  render(<App client={client} language="en" />);
  return { engine, client, calls };
}
/** A business with a draft invoice for Boat Audio's episode 14 order, prepared before the screen opens. */
async function withDraft() {
  const engine = new FakeEngine({ now: NOW });
  const view = (await engine.request('venture.invoice.prepare', { orderId: 'o-boat-14' })) as { invoice: { id: string; digest: string } };
  return { engine, draft: view.invoice };
}
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const main = () => screen.getByRole('main');
const called = (calls: Call[], method: string) => calls.filter(([m]) => m === method);
const figuresOf = (sheet: HTMLElement) => [...sheet.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);

describe('Money: invoices', () => {
  it('lists open and closed invoices and the orders still to invoice; each total shows with the receipt that priced it', async () => {
    start('#/money/invoices');
    expect(await screen.findByRole('heading', { level: 2, name: 'Open' })).toBeTruthy();
    const open = (await screen.findByText('INV-0039 · Boat Audio')).closest('li')!;
    expect(open.textContent).toContain('Issued 14 Oct 2026, due 28 Oct 2026');
    await waitFor(() => expect(open.textContent).toContain('Owed ₹26,200.00'));
    expect(open.textContent).toContain('Total ₹26,200.00');
    expect(within(open).getByRole('button', { name: 'Receipt R-0416' })).toBeTruthy();
    expect(within(open).getByRole('button', { name: 'Record payment' }).dataset.variant).toBe('primary');

    expect(screen.getByRole('heading', { level: 2, name: 'Closed' })).toBeTruthy();
    const paid = (await screen.findByText('INV-0038 · Boat Audio')).closest('li')!;
    expect(paid.textContent).toContain('Paid');
    await waitFor(() => expect(paid.textContent).toContain('Total ₹86,200.00'));
    expect(paid.querySelector('[data-variant="primary"]')).toBeNull();

    expect(screen.getByRole('heading', { level: 2, name: 'To invoice' })).toBeTruthy();
    const order = (await screen.findByText('Boat Audio · Two mentions in episode 14')).closest('li')!;
    expect(order.textContent).toContain('Not delivered yet');
    expect(within(order).getByRole('button', { name: 'Receipt R-0415' })).toBeTruthy();
    expect(within(order).getByRole('button', { name: 'Prepare invoice' })).toBeTruthy();
    // An order with an invoice is not offered again.
    expect(screen.queryByText(/Two mentions in episode 12/)).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Drafts' })).toBeNull();

    for (const row of main().querySelectorAll('[data-row]')) expect(row.querySelectorAll('[data-variant="primary"]').length).toBeLessThanOrEqual(1);
  });

  it('prepares an invoice from an order, opens the draft beside the list and moves the order to drafts', async () => {
    const { calls } = start('#/money/invoices');
    const order = (await screen.findByText('Boat Audio · Two mentions in episode 14')).closest('li')!;
    await click(within(order).getByRole('button', { name: 'Prepare invoice' }));
    expect(called(calls, 'venture.invoice.prepare')).toEqual([['venture.invoice.prepare', { orderId: 'o-boat-14' }]]);
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/money\/invoices\?sheet=invoice%3Ainv-/));
    const sheet = await screen.findByRole('complementary', { name: 'Draft invoice' });
    await waitFor(() => expect(sheet.textContent).toContain('₹30,000.00'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Drafts' })).toBeTruthy();
    const draft = (await within(main()).findByText('Draft · Boat Audio')).closest('li')!;
    expect(draft.textContent).toContain('Draft. Due 15 days after it is issued.');
    expect(within(draft).getByRole('button', { name: 'Review' }).dataset.variant).toBe('primary');
    await waitFor(() => expect(screen.queryByText('Boat Audio · Two mentions in episode 14')).toBeNull());
  });

  it('shows an invoice beside the list: the engine figures, the receipt that priced it, payments and the text', async () => {
    start('#/money/invoices?sheet=invoice:inv-0038');
    const sheet = await screen.findByRole('complementary', { name: 'INV-0038' });
    await waitFor(() => expect(sheet.textContent).toContain('Balance'));
    expect(figuresOf(sheet)).toEqual([['Subtotal', '₹86,200.00'], ['Total', '₹86,200.00'], ['Paid', '₹86,200.00'], ['Balance', '₹0.00']]);
    expect(sheet.textContent).toContain('Boat Audio');
    expect(within(sheet).getByRole('button', { name: 'Receipt R-0391' })).toBeTruthy();
    expect(sheet.textContent).toContain('The books receipt covers more than this invoice.');
    expect(sheet.textContent).toContain('20 Oct 2026 · Bank transfer');
    expect(within(sheet).getByRole('button', { name: 'Receipt R-0402' })).toBeTruthy();
    expect(within(sheet).getByText('The invoice as written')).toBeTruthy();
    expect(sheet.querySelector('pre')?.textContent).toContain('INV-0038');
    expect(within(sheet).queryByRole('button', { name: 'Record payment' })).toBeNull();
  });

  it('shows the tax lines of a tax invoice as the engine wrote them', async () => {
    const engine = new FakeEngine({ now: NOW });
    await engine.request('workspace.open', { folder: 'ledgerline' });
    start('#/money/invoices?sheet=invoice:inv-0041', engine);
    const sheet = await screen.findByRole('complementary', { name: 'INV-0041' });
    await waitFor(() => expect(sheet.textContent).toContain('Balance'));
    expect(figuresOf(sheet)).toEqual([['Subtotal', '₹16,000.00'], ['CGST at 9%', '₹1,440.00'], ['SGST at 9%', '₹1,440.00'], ['Total', '₹18,880.00'], ['Paid', '₹0.00'], ['Balance', '₹18,880.00']]);
    expect(within(sheet).getByRole('button', { name: 'Receipt R-0419' })).toBeTruthy();
  });

  it('issuing asks a second time, sends the digest of the invoice shown, and then shows the issued invoice', async () => {
    const { engine, draft } = await withDraft();
    const { calls } = start(`#/money/invoices?sheet=invoice:${draft.id}`, engine);
    const sheet = await screen.findByRole('complementary', { name: 'Draft invoice' });
    await click(await within(sheet).findByRole('button', { name: 'Issue invoice' }));
    expect(sheet.textContent).toContain("Issue this invoice? It gets its number and can't be changed after.");
    await click(within(sheet).getByRole('button', { name: 'Not now' }));
    expect(called(calls, 'venture.invoice.issue')).toEqual([]);
    await click(within(sheet).getByRole('button', { name: 'Issue invoice' }));
    await click(within(sheet).getByRole('button', { name: 'Issue' }));
    expect(called(calls, 'venture.invoice.issue')).toEqual([['venture.invoice.issue', { invoiceId: draft.id, digest: draft.digest }]]);
    await waitFor(() => expect(sheet.textContent).toContain('Issued as INV-0042.'));
    expect(within(sheet).getByRole('heading', { level: 2 }).textContent).toBe('INV-0042');
    expect(sheet.textContent).toContain('Issued 21 Oct 2026, due 5 Nov 2026');
    expect(within(sheet).queryByRole('button', { name: 'Issue invoice' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Record payment' })).toBeTruthy();
  });

  it('an invoice that changed after it was opened is refused and shown again; deciding again works', async () => {
    const { engine, draft } = await withDraft();
    start(`#/money/invoices?sheet=invoice:${draft.id}`, engine);
    const sheet = await screen.findByRole('complementary', { name: 'Draft invoice' });
    await waitFor(() => expect(sheet.textContent).toContain('Draft. Due 15 days after it is issued.'));
    act(() => { engine.money.touch(draft.id); });
    await click(within(sheet).getByRole('button', { name: 'Issue invoice' }));
    await click(within(sheet).getByRole('button', { name: 'Issue' }));
    await waitFor(() => expect(sheet.textContent).toContain('This changed since you opened it. The new version is below. Decide again.'));
    await waitFor(() => expect(sheet.textContent).toContain('Draft. Due 30 days after it is issued.'));
    await click(within(sheet).getByRole('button', { name: 'Issue invoice' }));
    await click(within(sheet).getByRole('button', { name: 'Issue' }));
    await waitFor(() => expect(sheet.textContent).toContain('Issued as INV-0042.'));
  });

  it('records a payment through a form sheet that asks a second time, then shows the engine figures', async () => {
    const { calls } = start('#/money/invoices?sheet=invoice:inv-0039');
    const invoice = await screen.findByRole('complementary', { name: 'INV-0039' });
    await click(await within(invoice).findByRole('button', { name: 'Record payment' }));
    expect(window.location.hash).toBe('#/money/invoices?sheet=payment%3Ainv-0039');
    const sheet = await screen.findByRole('complementary', { name: 'Record a payment' });
    await waitFor(() => expect(sheet.textContent).toContain('Still owed: ₹26,200.00'));
    const date = within(sheet).getByLabelText('Received on') as HTMLInputElement;
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.change(within(sheet).getByLabelText('Amount received'), { target: { value: '26,200' } });
    fireEvent.change(date, { target: { value: '2026-10-21' } });
    fireEvent.change(within(sheet).getByLabelText('How it was paid'), { target: { value: 'upi' } });
    await click(within(sheet).getByRole('button', { name: 'Record payment' }));
    expect(sheet.textContent).toContain("Record 26,200 INR received on 21 Oct 2026? This can't be undone.");
    expect(called(calls, 'venture.payment.record')).toEqual([]);
    await click(within(sheet).getByRole('button', { name: 'Not now' }));
    expect((within(sheet).getByLabelText('Amount received') as HTMLInputElement).value).toBe('26,200');
    await click(within(sheet).getByRole('button', { name: 'Record payment' }));
    await click(within(sheet).getByRole('button', { name: 'Record' }));
    expect(called(calls, 'venture.payment.record')).toEqual([['venture.payment.record', { invoiceId: 'inv-0039', amount: '26,200', receivedOn: '2026-10-21', method: 'upi' }]]);
    await waitFor(() => expect(sheet.textContent).toContain('Payment recorded.'));
    expect(within(sheet).getByRole('button', { name: /^Receipt R-/ })).toBeTruthy();
    await click(within(sheet).getByRole('button', { name: 'Back to the invoice' }));
    const back = await screen.findByRole('complementary', { name: 'INV-0039' });
    await waitFor(() => expect(figuresOf(back)).toContainEqual(['Balance', '₹0.00']));
    expect(back.textContent).toContain('21 Oct 2026 · UPI');
  });

  it('shows the engine refusal of a payment in its own words and keeps the form', async () => {
    start('#/money/invoices?sheet=payment:inv-0039');
    const sheet = await screen.findByRole('complementary', { name: 'Record a payment' });
    await waitFor(() => expect(sheet.textContent).toContain('Still owed: ₹26,200.00'));
    fireEvent.change(within(sheet).getByLabelText('Amount received'), { target: { value: '30000' } });
    await click(within(sheet).getByRole('button', { name: 'Record payment' }));
    await click(within(sheet).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(sheet.textContent).toContain("Couldn't record it: This is more than the balance of ₹26,200.00."));
    expect(within(sheet).getByLabelText('Amount received')).toBeTruthy();
  });

  it('a draft or a paid invoice takes no payment', async () => {
    const { engine, draft } = await withDraft();
    start(`#/money/invoices?sheet=payment:${draft.id}`, engine);
    const sheet = await screen.findByRole('complementary', { name: 'Record a payment' });
    await waitFor(() => expect(sheet.textContent).toContain('This invoice takes no payment now.'));
    expect(within(sheet).queryByLabelText('Amount received')).toBeNull();
  });
});
