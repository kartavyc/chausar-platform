import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import type { BooksSummaryLite, InvoiceViewLite, MoneyOverview, TaxWorking } from '../../src/engine/types';
import { Overview } from '../../src/places/money/Overview';
import { Amount } from '../../src/places/money/parts';
import type { MoneyViews } from '../../src/places/money/views';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * Money in the direction D look (docs/superpowers/plans/2026-10-23-chausar-ink-v2-w3.md, package 3F). Every figure is
 * engine text with its receipt or the "model estimate" label; the screen adds nothing up. Overrides below send what
 * the real engine sends (platform/runtime/venture/money/overview.ts gives every overview line its receipt); values are
 * written for this test.
 */

type Call = [string, unknown];
type Request = (method: string, params?: unknown) => Promise<unknown>;
type Override = (params: unknown, request: Request) => unknown;
const NOW = () => '2026-10-21T11:00:00.000Z';

function start(hash: string, options: { engine?: FakeEngine; override?: Record<string, Override>; language?: 'en' | 'hi' } = {}) {
  window.location.hash = hash;
  const engine = options.engine ?? new FakeEngine({ now: NOW });
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = (async (method: string, params?: unknown) => {
    calls.push([method, params]);
    const replace = options.override?.[method];
    return replace ? replace(params, (m, p) => request(m as never, p as never)) : request(method as never, params as never);
  }) as typeof client.request;
  render(<App client={client} language={options.language ?? 'en'} />);
  return { engine, client, calls };
}
const go = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const main = () => screen.getByRole('main');
const tile = (name: string) => screen.findByRole('region', { name });
/** A tile head's count of open invoices: the words, and the number set as a Count (DM Mono, no proof). */
const counted = async (owed: HTMLElement, words: string, count: string) => {
  await waitFor(() => expect(owed.querySelector('h2')?.parentElement?.textContent).toContain(words));
  expect(owed.querySelector('[data-count]')?.textContent).toBe(count);
};

/** Money at a glance as the real engine sends it: every line with its receipt. */
const OVERVIEW: MoneyOverview = {
  lines: [
    { id: 'owed', label: 'Clients owe you', value: '₹47,580.00', receiptId: 'R-0430' },
    { id: 'received', label: 'Came in this month', value: '₹86,200.00', receiptId: 'R-0402' },
    { id: 'spent', label: 'AI and tools this month', value: '₹60.10, includes estimates', receiptId: 'R-0431', estimate: true },
  ],
};
const overview = (lines: MoneyOverview = OVERVIEW): Override => () => structuredClone(lines);

/** Three open invoices, in no particular order: one past due, two due after today (21 Oct 2026). */
const OPEN: BooksSummaryLite['openInvoices'] = [
  { invoiceId: 'inv-0041', number: 'INV-0041', clientName: 'Mehta Traders', balanceDisplay: '₹18,880.00', dueDate: '2026-11-05' },
  { invoiceId: 'inv-0027', number: 'INV-0027', clientName: 'Iyer & Co', balanceDisplay: '₹2,500.00', dueDate: '2026-08-13' },
  { invoiceId: 'inv-0039', number: 'INV-0039', clientName: 'Boat Audio', balanceDisplay: '₹26,200.00', dueDate: '2026-10-28' },
];
const books = (open = OPEN): Override => async (params, request) => ({ ...((await request('venture.books.summary', params)) as BooksSummaryLite), openInvoices: structuredClone(open) });
const ledgerline = async () => {
  const engine = new FakeEngine({ now: NOW });
  await engine.request('workspace.open', { folder: 'ledgerline' });
  return engine;
};

describe('Money v2: the sub-pages', () => {
  it('are a segmented row of links named Money, each with its icon, the current one marked', async () => {
    start('#/money');
    const nav = screen.getByRole('navigation', { name: 'Money' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Overview', '#/money'], ['Invoices', '#/money/invoices'], ['Books', '#/money/books'], ['Spend', '#/money/spend'], ['Journal', '#/money/journal'],
    ]);
    for (const link of links) expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(links[0]!.getAttribute('aria-current')).toBe('page');
    await go('#/money/books');
    expect(within(nav).getByRole('link', { name: 'Books' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('Money v2: the overview tiles', () => {
  it('Invoiced this month is the books billed figure for this month with its receipt, and draws no goal bar until W4', async () => {
    const { calls } = start('#/money', { override: { 'venture.money.overview': overview() } });
    const invoiced = await tile('Invoiced this month');
    expect(await within(invoiced).findByText('₹1,12,400.00')).toBeTruthy();
    expect(within(invoiced).getByRole('button', { name: 'Receipt R-0401' })).toBeTruthy();
    expect(calls).toContainEqual(['venture.books.summary', { period: 'this-month' }]);
    expect(screen.queryByRole('img', { name: /goal/i })).toBeNull();
    assertInkRules();
  });

  it('Received and AI spend this month come from the overview lines, each with its receipt; spend leads to each call', async () => {
    start('#/money', { override: { 'venture.money.overview': overview() } });
    const received = await tile('Received');
    expect(await within(received).findByText('₹86,200.00')).toBeTruthy();
    expect(within(received).getByRole('button', { name: 'Receipt R-0402' })).toBeTruthy();
    const spend = await tile('AI spend this month');
    expect(await within(spend).findByText('₹60.10')).toBeTruthy();
    expect(within(spend).getByRole('button', { name: 'Receipt R-0431' })).toBeTruthy();
    // A cost that includes estimates is still worked out by code: it is not a number a model wrote.
    expect(spend.textContent).not.toContain('model estimate');
    expect(within(spend).getByRole('link', { name: 'Each call' }).getAttribute('href')).toBe('#/money/spend');
    assertInkRules();
  });

  it('AI spend in rupees sits beside the dollars, under the same receipt', async () => {
    const at = 'at ₹83.50 per $1 (your rate, set 23 Oct 2026)';
    start('#/money', {
      override: { 'venture.money.overview': overview({ lines: [{ id: 'spent', label: 'AI and tools this month', value: 'USD 0.2500', receiptId: 'R-0412', rupees: `₹20.88 ${at}` }] }) },
    });
    const spend = await tile('AI spend this month');
    const rupees = await within(spend).findByText(`₹20.88 ${at}`);
    expect(within(spend).getByText('USD 0.2500')).toBeTruthy();
    expect(rupees.closest('[data-figure-group]')?.querySelector('[data-receipt="R-0412"]')).toBeTruthy();
    assertInkRules();
  });

  it('AI spend: the amount stays the mono figure and the words the engine wrote after it take the body face (w3 3I)', async () => {
    start('#/money', { override: { 'venture.money.overview': overview() } });
    const spend = await tile('AI spend this month');
    const amount = await within(spend).findByText('₹60.10');
    expect(amount.matches('[data-ui-number].mono')).toBe(true);
    const words = within(spend).getByText(', includes estimates');
    expect(words.matches('[data-figure-words]')).toBe(true);
    expect(words.classList.contains('mono')).toBe(false);
    expect(words.closest('[data-phrase]')).toBeNull();
    expect(within(spend).getByRole('button', { name: 'Receipt R-0431' })).toBeTruthy();
    const received = await within(await tile('Received')).findByText('₹86,200.00');
    expect(received.closest('[data-phrase]')).toBeNull();
    assertInkRules();
  });

  it('a figure a model wrote says model estimate and carries no receipt', async () => {
    start('#/money', { override: { 'venture.money.overview': overview({ lines: [{ id: 'received', label: 'Came in this month', value: '₹40,000.00', receiptId: 'R-0402', estimate: true }] }) } });
    const received = await tile('Received');
    await within(received).findByText('₹40,000.00');
    expect(received.textContent).toContain('model estimate');
    expect(received.querySelector('[data-receipt]')).toBeNull();
    assertInkRules();
  });

  it('a figure that comes without a receipt is left out, never shown bare', async () => {
    // Built here: the owed and spend lines arrive with no receipt, the received line with its own.
    const bare: MoneyOverview = {
      lines: [
        { id: 'owed', label: 'Clients owe you', value: '₹26,200.00' },
        { id: 'received', label: 'Came in this month', value: '₹86,200.00', receiptId: 'R-0402' },
        { id: 'spent', label: 'AI and tools this month', value: '₹60.10, includes estimates', estimate: true },
      ],
    };
    start('#/money', { override: { 'venture.money.overview': overview(bare) } });
    const owed = await tile('Owed to you');
    await counted(owed, '1 open invoice', '1');
    await within(owed).findByText('Boat Audio');
    // Neither the owed sum nor the open balance it would prove is shown.
    expect(main().textContent).not.toContain('₹26,200.00');
    expect(owed.querySelector('[data-receipt]')).toBeNull();
    const spend = await tile('AI spend this month');
    await waitFor(() => expect(within(spend).getByRole('link', { name: 'Each call' })).toBeTruthy());
    expect(spend.textContent).not.toContain('₹60.10');
    expect(spend.querySelector('[data-receipt]')).toBeNull();
    const received = await tile('Received');
    await within(received).findByText('₹86,200.00');
    expect(within(received).getByRole('button', { name: 'Receipt R-0402' })).toBeTruthy();
    assertInkRules();
  });

  it('with the sample engine, Owed to you and AI spend show their figures, each with its receipt', async () => {
    // The fake engine now sends both lines with their receipts, as money/overview.ts does.
    start('#/money');
    const owed = await tile('Owed to you');
    await waitFor(() => expect(within(owed).getByRole('button', { name: 'Receipt R-0430' })).toBeTruthy());
    const owedFigure = within(owed).getByRole('button', { name: 'Receipt R-0430' }).closest('[data-figure-group]');
    expect(owedFigure?.textContent).toContain('₹26,200.00');
    await counted(owed, '1 open invoice', '1');
    const spend = await tile('AI spend this month');
    expect(await within(spend).findByText('₹60.10')).toBeTruthy();
    expect(within(spend).getByRole('button', { name: 'Receipt R-0431' })).toBeTruthy();
    assertInkRules();
  });
});

describe('Money v2: owed and due next', () => {
  it('Owed to you: the figure with its receipt, the open invoices as a count, and each one oldest due first', async () => {
    start('#/money', { override: { 'venture.money.overview': overview(), 'venture.books.summary': books() } });
    const owed = await tile('Owed to you');
    expect(await within(owed).findByText('₹47,580.00')).toBeTruthy();
    expect(within(owed).getByRole('button', { name: 'Receipt R-0430' })).toBeTruthy();
    await counted(owed, '3 open invoices', '3');
    const items = within(within(owed).getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('[data-client]')?.textContent)).toEqual(['Iyer & Co', 'Boat Audio', 'Mehta Traders']);
    expect(items[0]!.textContent).toContain('INV-0027');
    expect(items[0]!.textContent).toContain('Due 13 Aug 2026');
    expect(items[0]!.textContent).toContain('₹2,500.00');
    expect(within(items[1]!).getByRole('button', { name: 'Invoice INV-0039' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /owed by age/i })).toBeNull();
    expect(within(owed).queryByRole('button', { name: /remind/i })).toBeNull();
    assertInkRules();
  });

  it('Due to you next lists what is due from today on, soonest first, with balances, and nothing about costs', async () => {
    start('#/money', { override: { 'venture.money.overview': overview(), 'venture.books.summary': books() } });
    const next = await tile('Due to you next');
    await within(next).findByText('Boat Audio');
    const items = within(within(next).getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('[data-client]')?.textContent)).toEqual(['Boat Audio', 'Mehta Traders']);
    expect(items[0]!.textContent).toContain('₹26,200.00');
    expect(items[0]!.textContent).toContain('Due 28 Oct 2026');
    expect(within(next).getByRole('button', { name: 'Receipt R-0430' })).toBeTruthy();
    expect(next.textContent).not.toMatch(/cost/i);
    assertInkRules();
  });

  it('with nothing due from today on, Due to you next says so in one line', async () => {
    start('#/money', { override: { 'venture.money.overview': overview(), 'venture.books.summary': books([OPEN[1]!]) } });
    const next = await tile('Due to you next');
    expect(await within(next).findByText('Nothing is due from today on.')).toBeTruthy();
    expect(within(next).queryByRole('list')).toBeNull();
  });

  it('draws no in-and-out chart and no cash line, and no sentence promises them', async () => {
    start('#/money', { override: { 'venture.money.overview': overview() } });
    await within(await tile('Owed to you')).findByText('₹47,580.00');
    expect(within(main()).queryAllByRole('img')).toEqual([]);
    expect(main().textContent).not.toMatch(/in and out|cash|13 weeks|coming soon/i);
  });
});

describe('Money v2: the charts, once W4 sends their data', () => {
  /** Engine-scaled integers and engine strings, written for this test (W4 4I, 4A and 4J map the real views onto these). */
  const VIEWS: MoneyViews = {
    goal: { invoicedPermille: 789, readyPermille: 126, pacePermille: 742, label: '79% of the goal invoiced. Issuing INV-0042 takes it to 92%.' },
    split: { parts: [{ dept: 'prod', amount: '₹42.10', permille: 557 }, { dept: 'money', amount: '₹33.50', permille: 443 }], proof: { receiptId: 'R-0431' }, label: 'AI spend by department: Production ₹42.10, Money ₹33.50.' },
    aging: {
      buckets: [
        { id: 'not-due', label: 'Not due yet', count: '2 invoices', amount: '₹45,080', permille: 664 },
        { id: '1-30', label: '1 to 30 days late', count: '1 invoice', amount: '₹13,320', permille: 196 },
        { id: '31-60', label: '31 to 60 days late', count: '1 invoice', amount: '₹5,900', permille: 87 },
        { id: '61-90', label: '61 to 90 days late', count: '1 invoice', amount: '₹3,540', permille: 53 },
        { id: 'over-90', label: 'Over 90 days', count: 'none', amount: '₹0', permille: 0 },
      ],
      proof: { receiptId: 'R-0430' },
      label: 'Owed by age: not due yet ₹45,080, 1 to 30 days late ₹13,320.',
    },
    flow: {
      series: [
        { label: 'In', points: [{ key: '2026-09', label: 'Sep', valuePermille: 1000, value: '₹92,600' }, { key: '2026-10', label: 'Oct', valuePermille: 931, value: '₹86,200' }] },
        { label: 'Out', points: [{ key: '2026-09', label: 'Sep', valuePermille: 294, value: '₹27,250' }, { key: '2026-10', label: 'Oct', valuePermille: 280, value: '₹25,950' }] },
      ],
      label: 'Money in and out by month. September: in ₹92,600, out ₹27,250.',
      proof: { receiptId: 'R-0432' },
    },
    cash: {
      points: [
        { key: 'w1', label: 'Week of 19 Oct', actualPermille: 520, actual: '₹1,46,500', forecastPermille: 520, forecast: '₹1,46,500' },
        { key: 'w2', label: 'Week of 26 Oct', actualPermille: null, actual: null, forecastPermille: 610, forecast: '₹1,63,520' },
      ],
      axis: ['19 Oct', '26 Oct'],
      assumptions: ['Clients pay on the due date.'],
      proof: { receiptId: 'R-0433' },
      label: 'Cash in the bank by week, next 13 weeks.',
    },
  };

  it('draws the goal bar, the spend split, the aging bar, in and out by month and the cash line from the views given', async () => {
    window.location.hash = '#/money';
    const client = createFakeClient(new FakeEngine({ now: NOW }));
    const request = client.request.bind(client);
    client.request = (async (method: string, params?: unknown) => (method === 'venture.money.overview' ? structuredClone(OVERVIEW) : request(method as never, params as never))) as typeof client.request;
    render(<EngineProvider client={client}><TextProvider language="en"><Overview views={VIEWS} /></TextProvider></EngineProvider>);
    const invoiced = await tile('Invoiced this month');
    expect(within(invoiced).getByRole('img', { name: /of the goal invoiced/ })).toBeTruthy();
    expect(within(await tile('AI spend this month')).getByRole('img', { name: /AI spend by department/ })).toBeTruthy();
    const owed = await tile('Owed to you');
    expect(within(owed).getByRole('img', { name: /Owed by age/ })).toBeTruthy();
    expect(within(await tile('In and out by month')).getByRole('img', { name: /Money in and out by month/ })).toBeTruthy();
    expect(within(await tile('Cash, next 13 weeks')).getByRole('img', { name: /Cash in the bank by week/ })).toBeTruthy();
    expect(await tile('Due to you next')).toBeTruthy();
    await within(owed).findByText('₹47,580.00');
    assertInkRules();
  });
});

describe('Money v2: the invoices table', () => {
  it('has the columns Invoice, Client, Amount, Status, Due, Receipt and an action; amounts carry their receipts', async () => {
    start('#/money/invoices');
    const table = await screen.findByRole('table', { name: /invoices/i });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Invoice', 'Client', 'Amount', 'Status', 'Due', 'Receipt', 'Action']);
    const open = (await within(table).findByRole('button', { name: 'Invoice INV-0039' })).closest('tr')!;
    expect(open.textContent).toContain('Boat Audio');
    expect(open.textContent).toContain('₹26,200.00');
    expect(open.textContent).toContain('Sent');
    expect(open.textContent).toContain('28 Oct 2026');
    expect(within(open).getByRole('button', { name: 'Receipt R-0416' })).toBeTruthy();
    expect(within(open).getByRole('button', { name: 'Record payment' }).dataset.variant).toBe('secondary');
    const paid = within(table).getByRole('button', { name: 'Invoice INV-0038' }).closest('tr')!;
    expect(paid.textContent).toContain('Paid');
    expect(within(paid).getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(paid.querySelector('[data-variant="primary"]')).toBeNull();
    assertInkRules();
  });

  it('a draft comes first, says Draft, and its Issue opens the invoice, where issuing still asks a second time', async () => {
    const engine = new FakeEngine({ now: NOW });
    const view = (await engine.request('venture.invoice.prepare', { orderId: 'o-boat-14' })) as { invoice: { id: string } };
    const { calls } = start('#/money/invoices', { engine });
    const table = await screen.findByRole('table', { name: /invoices/i });
    const draft = (await within(table).findByRole('button', { name: 'Draft · Boat Audio' })).closest('tr')!;
    expect(within(table).getAllByRole('row')[1]).toBe(draft);
    expect(draft.textContent).toContain('Draft');
    const issue = within(draft).getByRole('button', { name: 'Issue' });
    expect(issue.dataset.variant).toBe('primary');
    await click(issue);
    expect(window.location.hash).toBe(`#/money/invoices?sheet=invoice%3A${view.invoice.id}`);
    const sheet = await screen.findByRole('complementary', { name: 'Draft invoice' });
    await click(await within(sheet).findByRole('button', { name: 'Issue invoice' }));
    expect(sheet.textContent).toContain("Issue this invoice? It gets its number and can't be changed after.");
    await click(within(sheet).getByRole('button', { name: 'Not now' }));
    expect(calls.filter(([m]) => m === 'venture.invoice.issue')).toEqual([]);
    assertInkRules();
  });

  it('orders not invoiced yet sit under To invoice, each with its price receipt and Prepare invoice', async () => {
    start('#/money/invoices');
    const section = await screen.findByRole('region', { name: 'To invoice' });
    const order = (await within(section).findByText('Boat Audio · Two mentions in episode 14')).closest('li')!;
    expect(within(order).getByRole('button', { name: 'Receipt R-0415' })).toBeTruthy();
    expect(within(order).getByRole('button', { name: 'Prepare invoice' }).dataset.variant).toBe('primary');
  });
});

describe('Money v2: books, simple first', () => {
  it('billed, received and earned are tiles with their receipts; the period is a row of chips held in the address', async () => {
    start('#/money/books');
    const billed = await tile('Billed');
    expect(await within(billed).findByText('₹1,12,400.00')).toBeTruthy();
    expect(within(billed).getByRole('button', { name: 'Receipt R-0401' })).toBeTruthy();
    expect(within(await tile('Earned')).getByRole('button', { name: 'Receipt R-0403' })).toBeTruthy();
    const periods = screen.getByRole('group', { name: 'Period' });
    await click(within(periods).getByRole('button', { name: 'Last month' }));
    expect(window.location.hash).toBe('#/money/books?period=last-month');
    await waitFor(() => expect(within(periods).getByRole('button', { name: 'Last month' }).getAttribute('aria-pressed')).toBe('true'));
    assertInkRules();
  });

  it('a business not registered for GST never sees GST or the tax working, on any Money page or sheet', async () => {
    // The real engine's plain working (platform money/tax-working.ts plainWorking), sent for every business that is not
    // registered: one section with the id "tax", titled GST, holding GST lines. Built here, so the test does not lean on
    // the fake's shape.
    const plain: TaxWorking = {
      period: 'October 2026', needsCaConfirmation: false,
      sections: [{ id: 'tax', title: 'GST', lines: [{ label: 'GST on invoices issued in October 2026', value: 'No invoices issued' }], note: 'Billed and earned leave out tax.' }],
    };
    // The real engine's note on a plain invoice of a business that is not registered (money/invoices.ts invoiceView).
    // The fake's own note still names the GSTIN, so it is swapped for the real words here.
    const realNotes: Override = async (params, request) => {
      const view = (await request('venture.invoice.get', params)) as InvoiceViewLite;
      return { ...view, notes: view.notes.map((note) => (note.includes('GSTIN') ? 'To make this a tax invoice, add: the registration details your country needs.' : note)) };
    };
    const { calls } = start('#/money/books', { override: { 'venture.tax.working': () => structuredClone(plain), 'venture.invoice.get': realNotes } });
    await within(await tile('Billed')).findByText('₹1,12,400.00');
    await waitFor(() => expect(calls.map(([m]) => m)).toContain('venture.tax.working'));
    await waitFor(() => expect(calls.map(([m]) => m)).toContain('venture.blueprint.get'));
    expect(screen.queryByRole('button', { name: 'Tax details' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/GST|tax working/i);
    for (const hash of ['#/money', '#/money/invoices', '#/money/spend', '#/money/journal']) {
      await go(hash);
      await waitFor(() => expect(main().querySelector('[data-figure], [data-row]')).toBeTruthy());
      expect(main().textContent, hash).not.toMatch(/GST/);
    }
    // The sheets beside the list: an open invoice, with its text as the client gets it, and its payment form.
    await go('#/money/invoices?sheet=invoice:inv-0039');
    const invoice = await screen.findByRole('complementary', { name: 'INV-0039' });
    await waitFor(() => expect(invoice.textContent).toContain('Balance'));
    expect(invoice.querySelector('pre')?.textContent).toContain('INV-0039');
    expect(invoice.textContent).not.toMatch(/GST/);
    await go('#/money/invoices?sheet=payment:inv-0039');
    const payment = await screen.findByRole('complementary', { name: 'Record a payment' });
    await waitFor(() => expect(payment.textContent).toContain('₹26,200.00'));
    expect(payment.textContent).not.toMatch(/GST/);
  });

  it('a GST business has its tax working one step away: closed at first, opened on request', async () => {
    start('#/money/books', { engine: await ledgerline() });
    const details = await screen.findByRole('button', { name: 'Tax details' });
    expect(details.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('heading', { name: 'Tax working, September 2026' })).toBeNull();
    expect(screen.queryByText('CGST at 9%')).toBeNull();
    await click(details);
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByRole('heading', { name: 'Tax working, September 2026' })).toBeTruthy();
    expect(screen.getByText('Needs your CA to confirm')).toBeTruthy();
    expect(within(screen.getAllByText('CGST at 9%')[0]!.closest('li')!).getByRole('button', { name: 'Receipt R-0419' })).toBeTruthy();
    assertInkRules();
    await click(details);
    expect(screen.queryByText('CGST at 9%')).toBeNull();
  });
});

describe('Money v2: spend', () => {
  it('lists each paid call in a tile; a call with a receipt shows it beside its figures', async () => {
    start('#/money/spend');
    const calls = await tile('Paid calls');
    const billed = (await within(calls).findByText('Model calls for episode 14')).closest('li')!;
    expect(billed.querySelector('[data-figure-group]')?.querySelector('[data-receipt="R-0412"]')).toBeTruthy();
    expect(billed.textContent).toContain('Settled ₹42.10');
    expect(await screen.findByRole('region', { name: 'Limits and rates' })).toBeTruthy();
    assertInkRules();
  });

  it('keeps the Ink rules with the owner rupee rate set', async () => {
    start('#/money/spend');
    const settings = await screen.findByRole('region', { name: 'Limits and rates' });
    // The owner's own limits, said back in the engine's sentences: engine words, in the body face.
    for (const words of ['USD 20.0000 a month', 'Asks you first above USD 2.0000']) {
      const line = await within(settings).findByText(words);
      expect(line.closest('[data-engine-line]'), words).toBeTruthy();
      expect(line.closest('.mono'), words).toBeNull();
    }
    await click(within(settings).getByRole('button', { name: 'Change' }));
    await act(async () => { fireEvent.change(within(settings).getByLabelText('Rupees per US dollar'), { target: { value: '83.50' } }); });
    await click(within(settings).getByRole('button', { name: 'Save' }));
    await click(within(settings).getAllByRole('button', { name: 'Save' }).find((b) => b.hasAttribute('data-confirm'))!);
    await within(settings).findByText('₹1,670.00 at ₹83.50 per $1 (your rate, set 21 Oct 2026)');
    assertInkRules();
  });
});

describe('Money v2: journal', () => {
  it('is a tile of rows with the state in words; an amount it recorded sits with its receipt', async () => {
    start('#/money/journal');
    const journal = await tile('What was sent or changed');
    const applied = (await within(journal).findByText('Record payment · Boat Audio')).closest('li')!;
    expect(applied.querySelector('[data-figure-group]')?.querySelector('[data-receipt="R-0402"]')).toBeTruthy();
    expect(applied.textContent).toContain('Applied');
    const unknown = within(journal).getByText('Send email · Iyer & Co').closest('li')!;
    expect(within(unknown).getByRole('button', { name: 'Resolve' })).toBeTruthy();
    assertInkRules();
  });
});

describe('Money v2: the sheets', () => {
  it('the payment sheet shows what is still owed as a figure with the invoice receipts, not as engine words', async () => {
    start('#/money/invoices?sheet=payment:inv-0039');
    const sheet = await screen.findByRole('complementary', { name: 'Record a payment' });
    const balance = await within(sheet).findByText('₹26,200.00');
    const group = balance.closest('[data-figure-group]');
    expect(group?.textContent).toContain('Still owed');
    expect(group?.querySelector('[data-receipt="R-0416"]')).toBeTruthy();
    expect(balance.closest('[data-engine-line]')).toBeNull();
    assertInkRules();
  });

  it('the invoice sheet says in its own words what happened; only an engine refusal is marked as engine words', async () => {
    const engine = new FakeEngine({ now: NOW });
    // Boat Audio's episode 14 order, not invoiced yet.
    const draft = (await engine.request('venture.invoice.prepare', { orderId: 'o-boat-14' })) as { invoice: { id: string } };
    start(`#/money/invoices?sheet=invoice:${draft.invoice.id}`, { engine });
    const sheet = await screen.findByRole('complementary', { name: 'Draft invoice' });
    await click(await within(sheet).findByRole('button', { name: 'Issue invoice' }));
    await click(within(sheet).getByRole('button', { name: 'Issue' }));
    const done = await within(sheet).findByText(/^Issued as INV-/);
    expect(done.closest('[data-engine-line]')).toBeNull();
    assertInkRules();
  });
});

describe('Money v2: the invoices table on a phone', () => {
  it('keeps its table roles, and labels the amount and the due date where the column heads are hidden', async () => {
    start('#/money/invoices');
    const table = await screen.findByRole('table');
    expect(table.getAttribute('role')).toBe('table');
    for (const group of table.querySelectorAll('thead, tbody')) expect(group.getAttribute('role')).toBe('rowgroup');
    for (const row of table.querySelectorAll('tr')) expect(row.getAttribute('role')).toBe('row');
    for (const head of table.querySelectorAll('th')) expect(head.getAttribute('role')).toBe('columnheader');
    for (const cell of table.querySelectorAll('td')) expect(cell.getAttribute('role')).toBe('cell');
    const row = (await within(table).findByRole('button', { name: 'Invoice INV-0039' })).closest('tr')!;
    await waitFor(() => expect(row.textContent).toContain('₹26,200.00'));
    const cells = within(row).getAllByRole('cell');
    const amount = cells.find((cell) => cell.textContent?.includes('₹26,200.00'))!;
    expect(amount.querySelector('[data-phone-label]')?.textContent).toBe('Amount');
    const due = cells.find((cell) => cell.textContent?.includes('28 Oct 2026'))!;
    expect(due.querySelector('[data-phone-label]')?.textContent).toBe('Due 28 Oct 2026');
    assertInkRules();
  });
});

describe('Money v2: Amount', () => {
  it('sets an amount in DM Mono, a currency code in front included, and words the engine wrote in the body face', () => {
    render(<p><Amount text="USD 0.2500" /> <Amount text="₹45.00" /> <Amount text="No price" /> <Amount text="USD 0.2500 this month (includes estimates)" /> <Amount text="कोई कीमत नहीं" /></p>);
    expect(screen.getByText('USD 0.2500').className).toBe('mono');
    expect(screen.getByText('₹45.00').className).toBe('mono');
    expect(screen.getByText('No price').className).toBe('');
    expect(screen.getByText('USD 0.2500 this month (includes estimates)').className).toBe('');
    expect(screen.getByText('कोई कीमत नहीं').className).toBe('');
  });
});

describe('Money v2: Hindi', () => {
  for (const hash of ['#/money', '#/money/invoices', '#/money/books', '#/money/spend', '#/money/journal']) {
    it(`${hash} shows no text key`, async () => {
      start(hash, { language: 'hi' });
      await waitFor(() => expect(main().querySelector('[data-figure], [data-row], [data-receipt]')).toBeTruthy());
      const walker = document.createTreeWalker(main(), NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        expect(node.textContent?.trim() ?? '').not.toMatch(/^[a-z]+(\.[a-zA-Z0-9-]+)+$/);
      }
    });
  }
});
