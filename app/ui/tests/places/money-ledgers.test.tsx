import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError } from '../../src/engine/types';

type Call = [string, unknown];
type Override = (params: unknown) => unknown;

function start(hash: string, override: Record<string, Override> = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine({ now: () => '2026-10-21T11:00:00.000Z' });
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = (async (method: string, params?: unknown) => {
    calls.push([method, params]);
    const replace = override[method];
    return replace ? replace(params) : request(method as never, params as never);
  }) as typeof client.request;
  render(<App client={client} language="en" />);
  return { engine, client, calls };
}
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const main = () => screen.getByRole('main');
const lineOf = (text: string) => within(main()).getByText(text).closest('li')!;

describe('Money: books', () => {
  it('shows billed, received and earned for the period, each with its receipt, the engine note and open invoices', async () => {
    const { calls } = start('#/money/books');
    const billed = await waitFor(() => lineOf('Billed'));
    expect(billed.textContent).toContain('₹1,12,400.00');
    expect(within(billed).getByRole('button', { name: 'Receipt R-0401' })).toBeTruthy();
    expect(within(lineOf('Received')).getByRole('button', { name: 'Receipt R-0402' })).toBeTruthy();
    expect(lineOf('Earned').textContent).toContain('₹95,254.24');
    expect(calls).toContainEqual(['venture.books.summary', { period: 'this-month' }]);
    expect(screen.getByText('1 Oct 2026 to 31 Oct 2026')).toBeTruthy();
    expect(screen.getByText('Sample data. Clients pay through links on your site, and you record each payment here.')).toBeTruthy();
    const open = await waitFor(() => lineOf('Boat Audio, due 28 Oct 2026'));
    expect(open.textContent).toContain('₹26,200.00');
    expect(within(open).getByRole('button', { name: 'Invoice INV-0039' })).toBeTruthy();
    for (const figure of main().querySelectorAll('[data-figure]')) expect(figure.closest('li')!.querySelector('[data-receipt], [data-invoice]')).toBeTruthy();
  });

  it('chooses the period from the engine list and keeps it in the address', async () => {
    const { calls } = start('#/money/books');
    const periods = await screen.findByRole('group', { name: 'Period' });
    const buttons = within(periods).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['All time', 'This month', 'Last month', 'This year']);
    expect(within(periods).getByRole('button', { name: 'This month' }).getAttribute('aria-pressed')).toBe('true');
    await click(within(periods).getByRole('button', { name: 'This year' }));
    expect(window.location.hash).toBe('#/money/books?period=this-year');
    await waitFor(() => expect(calls).toContainEqual(['venture.books.summary', { period: 'this-year' }]));
    await waitFor(() => expect(within(periods).getByRole('button', { name: 'This year' }).getAttribute('aria-pressed')).toBe('true'));
    expect(await screen.findByText('1 Jan 2026 to 31 Dec 2026')).toBeTruthy();
  });

  it('marks a figure whose receipt changed after it was made', async () => {
    start('#/money/books', {
      'venture.books.summary': () => ({
        currency: 'INR', period: { from: '2026-10-01', to: '2026-10-31' }, notes: [], openInvoices: [],
        figures: [{ operation: 'billed', label: 'Billed', receiptId: 'R-0401', display: '₹1,12,400.00', stale: true }],
      }),
    });
    const billed = await waitFor(() => lineOf('Billed'));
    expect(billed.textContent).toContain('changed since');
  });
});

describe('Money: spend', () => {
  it('shows each paid call reserved against settled, says estimate, billed or refused in words, and that prices cannot be set here yet', async () => {
    start('#/money/spend');
    expect(await screen.findByText('₹60.10 this month (includes estimates)')).toBeTruthy();
    const billed = (await screen.findByText('Model calls for episode 14')).closest('li')!;
    expect(billed.textContent).toContain('Editor');
    expect(billed.textContent).toContain('Reserved ₹45.00');
    expect(billed.textContent).toContain('Settled ₹42.10');
    expect(billed.textContent).toContain('billed');
    expect(within(billed).getByRole('button', { name: 'Receipt R-0412' })).toBeTruthy();
    const estimate = screen.getByText('Title comparison, running').closest('li')!;
    expect(estimate.textContent).toContain('Reserved ₹18.00');
    expect(estimate.textContent).toContain('Not settled yet');
    expect(estimate.textContent).toContain('estimate');
    const refused = screen.getByText('Paid boost for the short').closest('li')!;
    expect(refused.textContent).toContain('Instagram');
    expect(refused.textContent).toContain('No price');
    expect(refused.textContent).toContain('refused');
    expect(screen.getByText(/never counted as free/).textContent).toContain("can't be set in the app yet");
  });

  it('says so when there are no paid calls', async () => {
    start('#/money/spend', { 'venture.spend.list': () => ({ rows: [], total: '₹0.00 this month' }) });
    expect(await screen.findByText('No paid calls yet.')).toBeTruthy();
    expect(screen.queryByText(/never counted as free/)).toBeNull();
  });
});

describe('Money: journal', () => {
  it('lists what was sent or changed with its state in words; an unknown outcome says to check before retrying', async () => {
    const { calls } = start('#/money/journal');
    const sent = (await screen.findByText('Send invoice · Mehta Traders')).closest('li')!;
    expect(sent.textContent).toContain('Described');
    expect(sent.textContent).toContain('Waiting for your approval');
    const held = screen.getByText('Hold quote · Iyer & Co').closest('li')!;
    expect(held.textContent).toContain('Approved');
    expect(within(held).getByRole('button', { name: 'Receipt R-0420' })).toBeTruthy();
    const applied = screen.getByText('Record payment · Boat Audio').closest('li')!;
    expect(applied.textContent).toContain('Applied');
    expect(within(applied).getByRole('button', { name: 'Receipt R-0402' })).toBeTruthy();
    expect(screen.getByText('Post · LinkedIn').closest('li')!.textContent).toContain('Rejected');
    const unknown = screen.getByText('Send email · Iyer & Co').closest('li')!;
    expect(unknown.textContent).toContain('Outcome unknown');
    expect(unknown.textContent).toContain('The send timed out.');
    expect(unknown.textContent).toContain('Check before retrying.');
    expect(calls).toContainEqual(['venture.journal.list', { limit: 50 }]);
  });

  it('says so when nothing was sent or changed', async () => {
    start('#/money/journal', { 'venture.journal.list': () => ({ entries: [] }) });
    expect(await screen.findByText('Nothing sent or changed yet.')).toBeTruthy();
  });

  it('says plainly when the engine cannot give the journal', async () => {
    start('#/money/journal', { 'venture.journal.list': () => Promise.reject(new EngineError('METHOD_NOT_ALLOWED', 'This engine has no journal yet.')) });
    expect(await screen.findByText("Couldn't load this: This engine has no journal yet.")).toBeTruthy();
  });
});
