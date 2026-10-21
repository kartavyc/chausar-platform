import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError } from '../../src/engine/types';
import { TAX_WORKINGS } from '../../src/engine/fixtures-extras';

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
const type = async (element: Element, value: string) => { await act(async () => { fireEvent.change(element, { target: { value } }); }); };
const settings = () => screen.getByRole('region', { name: 'Limits and rates' });

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

  it('shows the tax working under the books; a business without GST says so in one line', async () => {
    const { calls } = start('#/money/books');
    expect(await screen.findByRole('heading', { level: 2, name: 'Tax working, October 2026' })).toBeTruthy();
    expect(screen.getByText('Not registered for GST, so there is no GST to work out.')).toBeTruthy();
    expect(screen.queryByText('Needs your CA to confirm')).toBeNull();
    expect(calls).toContainEqual(['venture.tax.working', {}]);
  });

  it('each tax line shows its figure with its receipt, and a working the CA must confirm says so', async () => {
    start('#/money/books', { 'venture.tax.working': () => TAX_WORKINGS.ledgerline });
    expect(await screen.findByRole('heading', { level: 2, name: 'Tax working, September 2026' })).toBeTruthy();
    expect(screen.getByText('Needs your CA to confirm')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'GST on your sales' })).toBeTruthy();
    const cgst = screen.getAllByText('CGST at 9%')[0]!.closest('li')!;
    expect(cgst.textContent).toContain('₹1,440.00');
    expect(within(cgst).getByRole('button', { name: 'Receipt R-0419' })).toBeTruthy();
    const credit = lineOf('Input credit');
    expect(credit.textContent).toContain('₹0.00');
    expect(credit.querySelector('[data-receipt]')).toBeNull();
    expect(screen.getByText('No purchase bills were uploaded for September.')).toBeTruthy();
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
  it('shows each paid call reserved against settled, says estimate, billed or refused in words, and why a call was refused', async () => {
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
    expect(refused.textContent).toContain('Instagram has no price on your rate card, so the call was refused.');
    expect(screen.queryByText(/never counted as free/)).toBeNull();
  });

  it('a refused call the engine gave no reason for falls back to the plain note', async () => {
    start('#/money/spend', { 'venture.spend.list': () => ({ rows: [{ id: 'sp9', connector: 'Instagram', label: 'Paid boost', reserved: 'No price', kind: 'refused' }], total: '₹0.00 this month' }) });
    expect((await screen.findByText(/never counted as free/)).textContent).toContain('Limits and rates');
  });

  it('says so when there are no paid calls', async () => {
    start('#/money/spend', { 'venture.spend.list': () => ({ rows: [], total: '₹0.00 this month' }) });
    expect(await screen.findByText('No paid calls yet.')).toBeTruthy();
    expect(screen.queryByText(/never counted as free/)).toBeNull();
  });
});

describe('Money: spend settings', () => {
  it('shows the limit, the ask-first figure and the rate card in the engine words, with one quiet Change', async () => {
    start('#/money/spend');
    expect(await within(await waitFor(settings)).findByText('USD 20.0000 a month')).toBeTruthy();
    const region = settings();
    expect(within(region).getByText('Asks you first above USD 2.0000')).toBeTruthy();
    expect(within(region).getByText('USD 3.0000 in and USD 15.0000 out, per million tokens')).toBeTruthy();
    expect(within(region).getByText('Anthropic pricing page, checked 14 Oct 2026')).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Change' }).dataset.variant).toBe('quiet');
    expect(within(region).queryByRole('textbox')).toBeNull();
  });

  it('sends the figures exactly as typed, an empty one as null and the held rate as it came, only after a second ask', async () => {
    const { calls } = start('#/money/spend');
    await within(await waitFor(settings)).findByText('USD 20.0000 a month');
    await click(within(settings()).getByRole('button', { name: 'Change' }));
    const cap = within(settings()).getByLabelText('Monthly limit') as HTMLInputElement;
    expect(cap.value).toBe('20000000');
    expect((within(settings()).getByLabelText('Ask me first above') as HTMLInputElement).value).toBe('2000000');
    await type(cap, '30000000');
    await type(within(settings()).getByLabelText('Ask me first above'), '');
    await click(within(settings()).getByRole('button', { name: 'Save' }));
    expect(within(settings()).getByText('Save these limits and rates? Paid calls follow them from now on.')).toBeTruthy();
    expect(calls.filter(([m]) => m === 'venture.spend.policy.set')).toEqual([]);
    const confirm = within(settings()).getAllByRole('button', { name: 'Save' }).find((b) => b.hasAttribute('data-confirm'))!;
    confirm.focus();
    await act(async () => { fireEvent.keyDown(confirm, { key: 'a' }); });
    expect(calls.filter(([m]) => m === 'venture.spend.policy.set')).toEqual([]);
    await click(confirm);
    expect(calls.filter(([m]) => m === 'venture.spend.policy.set')).toEqual([['venture.spend.policy.set', {
      cap: '30000000', askFirst: null,
      rates: [{ item: 'model:anthropic-api', unit: 'per-million-tokens', inputMicrosPerMillion: '3000000', outputMicrosPerMillion: '15000000', source: 'Anthropic pricing page', checkedOn: '2026-10-14' }],
    }]]);
    expect(await within(settings()).findByText('USD 30.0000 a month')).toBeTruthy();
    expect(within(settings()).getByText('Never asks first')).toBeTruthy();
    expect(within(settings()).getByText('Saved.')).toBeTruthy();
  });

  it('adds a rate per call; the engine writes its price', async () => {
    const { calls } = start('#/money/spend');
    await within(await waitFor(settings)).findByText('USD 20.0000 a month');
    await click(within(settings()).getByRole('button', { name: 'Change' }));
    await click(within(settings()).getByRole('button', { name: 'Add a rate' }));
    const line = within(settings()).getByRole('group', { name: 'New rate' });
    await type(within(line).getByLabelText('What it prices'), 'connector:instagram');
    await act(async () => { fireEvent.change(within(line).getByLabelText('Priced'), { target: { value: 'per-call' } }); });
    await type(within(line).getByLabelText('Price per call'), '250000');
    await type(within(line).getByLabelText('Where the rate comes from'), 'Meta ads price list');
    await click(within(settings()).getByRole('button', { name: 'Save' }));
    await click(within(settings()).getAllByRole('button', { name: 'Save' }).find((b) => b.hasAttribute('data-confirm'))!);
    const sent = calls.find(([m]) => m === 'venture.spend.policy.set')![1] as { rates: unknown[] };
    expect(sent.rates[1]).toMatchObject({ item: 'connector:instagram', unit: 'per-call', microsPerCall: '250000', source: 'Meta ads price list' });
    expect(sent.rates[1]).not.toHaveProperty('inputMicrosPerMillion');
    expect(await within(settings()).findByText('USD 0.2500 per call')).toBeTruthy();
  });

  it('shows the engine refusal in its words and keeps the form', async () => {
    start('#/money/spend');
    await within(await waitFor(settings)).findByText('USD 20.0000 a month');
    await click(within(settings()).getByRole('button', { name: 'Change' }));
    await type(within(settings()).getByLabelText('Monthly limit'), '5.00');
    await click(within(settings()).getByRole('button', { name: 'Save' }));
    await click(within(settings()).getAllByRole('button', { name: 'Save' }).find((b) => b.hasAttribute('data-confirm'))!);
    expect(await within(settings()).findByRole('alert')).toBeTruthy();
    expect(within(settings()).getByRole('alert').textContent).toBe("Couldn't save: The monthly limit must be whole micro-dollars, like 5000000 for five US dollars.");
    expect((within(settings()).getByLabelText('Monthly limit') as HTMLInputElement).value).toBe('5.00');
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
