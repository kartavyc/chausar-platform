import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { AgingView, CashView, EngineClient } from '../../src/engine/types';
import { assertFiguresProved, assertInkRules, assertOnePrimary, receiptMark } from '../helpers/ink-rules';
import { cssOf } from '../helpers/css';

/*
 * Money's overview with the W4 money views (chausar-private/docs/superpowers/plans/2026-10-23-chausar-ink-v2-w4.md, package 4J20):
 * owed by age with its reminders, in and out by month, cash over the next 13 weeks, the next three weeks, the month
 * picker with last month beside this one, and Export for your CA. The fake engine answers venture.money.aging, .flow,
 * .cash and .export from its own invoices and payments the way the engine does (fake-money-views.ts); overrides below
 * send what the real engine sends where a case needs data the samples do not hold.
 */

type Call = [string, unknown];
type Request = (method: string, params?: unknown) => Promise<unknown>;
type Override = (params: unknown, request: Request) => unknown;

/** 21 Oct 2026: INV-0039 (Lumen, due 28 Oct) is open and not due; the sample statement's balance is from 21 Oct. */
const OCT_21 = () => '2026-10-21T11:00:00.000Z';
/** 10 Nov 2026: INV-0039 is 13 days late, past its 10-day reminder. */
const NOV_10 = () => '2026-11-10T06:00:00.000Z';

function start(hash: string, options: { now?: () => string; override?: Record<string, Override>; language?: 'en'; extra?: Partial<EngineClient>; before?: (engine: FakeEngine) => unknown } = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine({ now: options.now ?? OCT_21 });
  // The fake answers at once: what before asks of it is done before the page first reads.
  options.before?.(engine);
  const base = createFakeClient(engine);
  const calls: Call[] = [];
  const request = base.request.bind(base);
  const client: EngineClient = {
    ...base,
    ...options.extra,
    request: (async (method: string, params?: unknown) => {
      calls.push([method, params]);
      const replace = options.override?.[method];
      return replace ? replace(params, (m, p) => request(m as never, p as never)) : request(method as never, params as never);
    }) as EngineClient['request'],
  };
  const now = options.now ?? OCT_21;
  render(<ClockProvider now={() => new Date(now())}><App client={client} language={options.language ?? 'en'} /></ClockProvider>);
  return { engine, client, calls };
}
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const tile = (name: string | RegExp) => screen.findByRole('region', { name });

afterEach(() => { vi.restoreAllMocks(); });

/** The sample's one open invoice split across two ages, as an engine with two open invoices answers. */
const twoAges: Override = async (params, request) => {
  const view = await request('venture.money.aging', params) as AgingView;
  const part = (permille: number, display: string) => ({ count: 1, permille, countLine: '1 invoice', amount: { ...view.total, display } });
  return { ...view, buckets: view.buckets.map((bucket) => (bucket.id === 'not-due' ? { ...bucket, ...part(240, '₹6,200') } : bucket.id === '1-30' ? { ...bucket, ...part(760, '₹20,000') } : bucket)) };
};

describe('Money w4: owed by age and reminders', () => {
  it('the owed tile draws the five ages at rest as the bar, each age in words in its name and its table, all under the one aging receipt', async () => {
    const { calls } = start('#/money', { now: NOV_10, override: { 'venture.money.aging': twoAges } });
    const owed = await tile('Owed to you');
    const bar = await within(owed).findByRole('img', { name: /^Owed by age, ₹26,200 in all/ });
    const chart = bar.closest('[data-chart]') as HTMLElement;
    // At rest the legend names the ages that hold money, with count and amount, so colour never carries the meaning alone.
    expect([...chart.querySelectorAll('li[data-bucket]')].map((row) => row.textContent)).toEqual(['Not due yet1 invoice₹6,200', '1 to 30 days late1 invoice₹20,000']);
    expect(bar.getAttribute('aria-label')).toBe('Owed by age, ₹26,200 in all: Not due yet ₹6,200, 1 to 30 days late ₹20,000');
    const rows = [...chart.querySelectorAll('tbody tr')].map((row) => row.textContent);
    expect(rows).toEqual([
      'Not due yet1 invoice₹6,200', '1 to 30 days late1 invoice₹20,000', '31 to 60 days lateNone₹0', '61 to 90 days lateNone₹0', 'Over 90 days lateNone₹0',
    ]);
    // One receipt: the figure's and the chart's are the same aging sum.
    const figure = owed.querySelector('[data-figure] [data-receipt]')!.getAttribute('data-receipt');
    expect(within(chart).getAllByRole('button', { name: receiptMark(figure!) }).length).toBeGreaterThan(0);
    // 4J20: what the late ones owe, with its own receipt (here the one late invoice), beside the words.
    const late = owed.querySelector('[data-late-figure]') as HTMLElement;
    expect(late.textContent).toContain('₹26,200');
    // The words lead and the figure ends the line, its mark right after it: the mark never cuts the sentence (sample item 18).
    expect(late.textContent?.startsWith('Late:')).toBe(true);
    expect(late.lastElementChild?.matches('[data-figure]')).toBe(true);
    expect(late.lastElementChild?.lastElementChild?.matches('[data-receipt]')).toBe(true);
    expect(within(late).getByRole('button', { name: receiptMark(/^R-/) }).getAttribute('data-receipt')).not.toBe(figure);
    // The bar is at rest, not in a fold; the tile is sized to what it holds.
    expect(chart.closest('details')).toBeNull();
    expect(calls.map(([method]) => method)).toContain('venture.money.aging');
    assertInkRules();
    assertFiguresProved();
  });

  it('"Billing drafts, you send": Draft 1 reminder asks the engine for it, and the draft opens to send yourself', async () => {
    const { calls } = start('#/money', { now: NOV_10 });
    const owed = await tile('Owed to you');
    expect(await within(owed).findByText('Billing drafts, you send')).toBeTruthy();
    await click(await within(owed).findByRole('button', { name: 'Draft 1 reminder' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.invoice.remind', { invoiceId: 'inv-0039' }]));
    // One draft opens in 4E4's draft sheet; nothing is sent.
    await waitFor(() => expect(window.location.hash).toMatch(/sheet=outreach%3Areminder-1/));
    expect(calls.map(([method]) => method)).not.toContain('venture.outreach.sent');
    // Once drafted, the tile offers to open it rather than draft again.
    expect(await within(owed).findByRole('button', { name: 'Open reminder' })).toBeTruthy();
    expect(within(owed).queryByRole('button', { name: /^Draft/ })).toBeNull();
  });

  it('money in one age only draws no bar: one segment says nothing, and the figure keeps its own receipt (B4 task 6)', async () => {
    start('#/money', { now: NOV_10 });
    const owed = await tile('Owed to you');
    await waitFor(() => expect(owed.querySelector('[data-ui-number]')?.textContent).toBe('₹26,200'));
    await waitFor(() => expect(owed.querySelector('[data-late-figure]')).not.toBeNull());
    expect(within(owed).queryByRole('img', { name: /^Owed by age/ })).toBeNull();
    expect(owed.querySelector('[data-figure] [data-receipt]')).not.toBeNull();
    assertFiguresProved();
  });

  it('with nothing late, there is no reminder to draft', async () => {
    start('#/money');
    const owed = await tile('Owed to you');
    await waitFor(() => expect(owed.querySelector('[data-figure] [data-receipt]')).not.toBeNull());
    expect(within(owed).queryByText('Billing drafts, you send')).toBeNull();
    expect(within(owed).queryByRole('button', { name: /reminder/ })).toBeNull();
  });
});

describe('Money w4: in and out by month', () => {
  it('paired bars with the engine values over them, what was left under each month, and every figure its own receipt', async () => {
    // What the engine leaves out it says in words: here, as for a business outside India, whose AI spend has no rate to its currency.
    const left = { count: 2, line: '2 not counted: 2 paid AI calls with no rate from US dollars to AED' };
    start('#/money', { override: { 'venture.money.flow': async (params, request) => { const view = await request('venture.money.flow', params) as { basis: object }; return { ...view, basis: { ...view.basis, notCounted: left } }; } } });
    const flow = await tile('In and out by month');
    const chart = await within(flow).findByRole('img', { name: 'Money in and out for the last 6 months' });
    expect(within(flow).getByText('May to Oct')).toBeTruthy();
    const october = chart.querySelector('[data-key="2026-10"]') as HTMLElement;
    expect(october.querySelector('[data-cap]')?.textContent).toBe('₹86,200');
    expect(october.querySelector('[data-note]')?.textContent).toBe('₹86,200');
    expect(october.textContent).toContain('Oct, so far');
    // A month with nothing recorded draws no bar, never a zero.
    expect(chart.querySelector('[data-key="2026-09"] [data-bar]')).toBeNull();
    const data = flow.querySelector('details') as HTMLElement;
    expect(within(data).getByText('View chart data')).toBeTruthy();
    expect(within(data).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['In', 'Out', 'What was left', 'Receipt']);
    expect(within(data).getAllByRole('button', { name: receiptMark(/^R-/) }).length).toBeGreaterThan(0);
    // Calls that cannot be counted in the business's currency: the engine says so, never a zero.
    expect(flow.textContent).toContain(left.line);
    assertInkRules();
    assertFiguresProved();
  });
});

describe('Money w4: cash ahead and the next three weeks', () => {
  it('the bank today, the lowest week and the forecast line, each figure with its receipt, projections labelled, assumptions listed', async () => {
    // 4Z2: a lowest week shows only when cash falls below today's: a bill of ₹2,50,000 due 20 Nov takes it there.
    start('#/money', { now: NOV_10, before: (engine) => engine.request('venture.bills.add', { vendor: 'Stage Hire', billDate: '2026-11-01', dueDate: '2026-11-20', lines: [{ description: 'Stage', amountMinor: '25000000', taxName: '', taxRateBps: '0' }] }) });
    const cash = await tile('Cash, next 13 weeks');
    expect(await within(cash).findByText('In the bank')).toBeTruthy();
    const today = within(cash).getByText('In the bank').closest('div') as HTMLElement;
    // The statement's day is in the receipt, not said at rest.
    expect(today.textContent).not.toMatch(/statement/i);
    expect(today.textContent).toContain('₹2,18,750');
    expect(within(today).getByRole('button', { name: receiptMark(/^R-/) })).toBeTruthy();
    const lowest = within(cash).getByText('Lowest week').closest('div') as HTMLElement;
    expect(within(lowest).getByRole('button', { name: receiptMark(/^R-/) })).toBeTruthy();
    expect(lowest.textContent).toContain('Projected');
    // INV-0039 is late: the lowest week if the late one never pays has its own receipt.
    const late = within(cash).getByText('If late ones never pay').closest('div') as HTMLElement;
    expect(within(late).getByRole('button', { name: receiptMark(/^R-/) })).toBeTruthy();
    const line = within(cash).getByRole('img', { name: /^Cash in the bank/ });
    expect(line.querySelector('[data-line="forecast"]')).not.toBeNull();
    expect(line.querySelector('[data-part="today"]')).not.toBeNull();
    // The assumptions, one step away in a closed fold.
    const assumes = within(cash).getByText('Clients pay open invoices on their due dates.').closest('details') as HTMLDetailsElement;
    expect(assumes.open).toBe(false);
    expect(within(assumes).getByText('Assumptions')).toBeTruthy();
    // Level lines on round amounts from the engine, and every third week named under the line.
    expect(line.parentElement!.querySelectorAll('[data-axis] span').length).toBe(14);
    expect([...line.parentElement!.querySelectorAll('[data-axis] span')].filter((span) => span.textContent).length).toBe(5);
    expect(within(cash).getByText('The 1 late invoice is paid in the first week.')).toBeTruthy();
    assertInkRules();
    assertFiguresProved();
  });

  it('what issuing a draft today brings in, and in which week, with its price receipt and the way to Today', async () => {
    start('#/money', { before: (engine) => engine.request('venture.invoice.prepare', { orderId: 'o-boat-14' }) });
    const cash = await tile('Cash, next 13 weeks');
    const line = await waitFor(() => cash.querySelector('[data-if-issued]') as HTMLElement);
    // A draft of 15 days' terms issued on 21 Oct is due 5 Nov, in the week to 11 Nov.
    expect(line.textContent).toContain('Issuing the draft for Boat Audio today adds');
    expect(line.textContent).toContain('₹30,000');
    expect(line.textContent).toContain('in the week to 28 Oct.'); // due in 7 days, the default since wave 6 (6D1)
    expect(within(line).getByRole('button', { name: receiptMark(/^R-/) })).toBeTruthy();
    expect(within(line).getByRole('link', { name: 'Open on Today' }).getAttribute('href')).toBe('#/today');
    assertInkRules();
  });

  it('without a bank statement there is no line and no figure, only a way to import one', async () => {
    const empty: CashView = {
      bank: null, opening: null, points: [], lowest: { onTime: null, ifLateNeverPay: null }, usualCosts: null, assumptions: [], nextWeeks: [], ticks: [],
      basis: { filters: [], truncated: false, notCounted: null }, line: 'Import a bank statement to see cash ahead.',
    };
    start('#/money', { override: { 'venture.money.cash': () => empty } });
    const cash = await tile('Cash, next 13 weeks');
    expect(await within(cash).findByText('Import a bank statement to see cash ahead.')).toBeTruthy();
    expect(within(cash).queryByRole('img')).toBeNull();
    expect(cash.querySelector('[data-figure]')).toBeNull();
    await click(within(cash).getByRole('button', { name: 'Import a statement' }));
    expect(window.location.hash).toContain('sheet=bank-import');
    const next = await tile('Next three weeks');
    expect(within(next).getByText('Nothing is due in or out in the next three weeks.')).toBeTruthy();
  });

  it('the next three weeks by date, one step away in a closed fold, each amount a projection proved by its week', async () => {
    start('#/money');
    const next = await tile('Next three weeks');
    expect((next.closest('details') as HTMLDetailsElement).open).toBe(false);
    expect((next.closest('details') as HTMLDetailsElement).querySelector('summary')!.textContent).toBe('Due soon');
    const item = await within(next).findByText('Due from Boat Audio on 28 Oct 2026');
    const row = item.closest('li') as HTMLElement;
    expect(row.textContent).toContain('Coming in');
    expect(row.textContent).toContain('₹26,200');
    expect(within(row).getByRole('button', { name: receiptMark(/^R-/) })).toBeTruthy();
    // Every amount the engine marks projected says so.
    expect(row.querySelector('[data-projected]')?.textContent).toBe('Projected');
    expect(screen.queryByRole('region', { name: 'Due to you next' })).toBeNull();
    assertInkRules();
  });
});

describe('Money w4: the month, last month and Export for your CA', () => {
  it('Received shows last month under this one with its receipt; the month picker moves Invoiced and Received', async () => {
    // A payment in September, so last month has something to show: a month that counts nothing has no receipt and no line.
    const { calls } = start('#/money', { before: (engine) => engine.request('venture.payment.record', { invoiceId: 'inv-0039', amount: '1000', receivedOn: '2026-09-25', method: 'upi' }) });
    const received = await tile('Received');
    const before = await waitFor(() => { const line = received.querySelector('[data-previous]') as HTMLElement | null; expect(line).not.toBeNull(); return line!; });
    expect(before.textContent).toContain('September 2026');
    expect(within(before).getByRole('button', { name: receiptMark(/^R-/) })).toBeTruthy();
    const picker = screen.getByRole('combobox', { name: 'Month' });
    expect((picker as HTMLSelectElement).value).toBe('2026-10');
    await act(async () => { fireEvent.change(picker, { target: { value: '2026-09' } }); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(window.location.hash).toBe('#/money?month=2026-09');
    expect(await tile('Invoiced in September 2026')).toBeTruthy();
    await waitFor(() => expect(calls).toContainEqual(['venture.books.summary', { period: '2026-09' }]));
    await waitFor(() => expect(calls).toContainEqual(['venture.goals.get', { month: '2026-09' }]));
    assertInkRules();
    assertFiguresProved();
  });

  it('on the web, Save the files downloads the engine file for the month as it came, and says Chausar sent nothing', async () => {
    const made: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => { made.push(blob); return 'blob:export'; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { calls } = start('#/money/books?sheet=accountant:books');
    await click(await screen.findByRole('button', { name: /^Save the files/ }));
    await waitFor(() => expect(calls).toContainEqual(['venture.money.export', { month: '2026-10' }]));
    expect(clicked).toHaveBeenCalled();
    const text = await made[0]!.text();
    // Blob.text() reads the engine's byte order mark away; the header is the engine's, with its Currency column.
    expect(text.split('\r\n')[0]).toBe('Section,Date,Number,Party,Party tax ID,Place of supply,Description,Before tax,Tax,Total,Status,Method,TDS section,TDS,Receipt,Currency');
    expect(text).toContain('Payment,2026-10-20,INV-0038,Boat Audio');
    expect(await screen.findByText('Downloaded Lumen Studio, sales, Oct 2026.csv. Chausar did not send it anywhere.')).toBeTruthy();
    // The signed receipts that rode with the file are offered as a second file, saved as they came.
    await click(screen.getByRole('button', { name: 'Download the signed receipts' }));
    expect(JSON.parse(await made[1]!.text())).toMatchObject({ format: 'chausar-signed-receipts/1', business: 'Lumen Studio' });
    // The button's name says the month it exports.
    expect(screen.getByRole('button', { name: 'Save the files, October 2026' })).toBeTruthy();
  });

  it('on the desktop, the desktop saves the month where the owner picks; a refusal is said in its words', async () => {
    const save = vi.fn(async (month: string): Promise<{ saved: true; name: string; receipts?: string; line: string }> => ({ saved: true as const, name: `ledger-${month}.csv`, line: 'Saved.' }));
    const { calls } = start('#/money/books?sheet=accountant:books', { extra: { saveMoneyExport: save } });
    await click(await screen.findByRole('button', { name: /^Save the files/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('2026-10'));
    expect(await screen.findByText('Saved ledger-2026-10.csv. Chausar did not send it anywhere.')).toBeTruthy();
    expect(calls.map(([method]) => method)).not.toContain('venture.money.export');
    save.mockResolvedValueOnce({ saved: true, name: 'october.csv', receipts: 'october-receipts.json', line: 'Saved.' });
    await click(screen.getByRole('button', { name: /^Save the files/ }));
    expect(await screen.findByText('Saved october.csv and october-receipts.json. Chausar did not send them anywhere.')).toBeTruthy();
    save.mockRejectedValueOnce(Object.assign(new Error('A file with this name appeared while you were choosing, so Chausar left it alone. Save again to pick a name.'), { code: 'EXPORT_EXISTS' }));
    await click(screen.getByRole('button', { name: /^Save the files/ }));
    expect(await screen.findByText(/^Couldn't export it: A file with this name appeared/)).toBeTruthy();
  });
});

describe('Money w4: the whole overview', () => {
  it('holds the Ink rules: every figure proved, one primary at most per card, in English and Hindi', async () => {
    start('#/money', { now: NOV_10 });
    await within(await tile('Cash, next 13 weeks')).findByText('In the bank');
    await within(await tile('In and out by month')).findByRole('img');
    assertInkRules();
    assertFiguresProved();
    assertOnePrimary(document.body);
  });


});

describe('Money w4: the overview at narrow widths', () => {
  it('under 560 px of its own width (a phone at 390) every glance tile takes the whole row, so none clips', () => {
    // cssOf reads from src/parts (comments taken out), so the path climbs back to the place's own module.
    const css = cssOf('../places/money/MoneyViews.module.css').replace(/\r/g, '');
    const narrow = css.match(/@container money \(max-width: 559px\) \{([\s\S]*?)\n\}/);
    expect(narrow, 'a container rule for the narrowest widths').not.toBeNull();
    expect(narrow![1]).toMatch(/\.page \.glanceRow > \[data-span\][^{]*\{\s*grid-column: 1 \/ -1;/);
    // It comes after the wider rule, so it wins where both match.
    expect(css.indexOf('(max-width: 559px)')).toBeGreaterThan(css.indexOf('(max-width: 899px)'));
  });
});

describe('C4 T28: why a forecast is flat', () => {
  it('shows the engine words only when it sends them', async () => {
    const flat = 'Nothing due in or out in the next 13 weeks, so it stays flat.';
    start('#/money', { override: { 'venture.money.cash': async (params, request) => ({ ...(await request('venture.money.cash', params) as object), flat }) } });
    const cash = await tile('Cash, next 13 weeks');
    expect(await within(cash).findByText(flat)).toBeTruthy();
    cleanup();
    start('#/money');
    const plain = await tile('Cash, next 13 weeks');
    await waitFor(() => expect(plain.querySelector('[data-chart]')).toBeTruthy());
    expect(plain.querySelector('[data-flat]')).toBeNull();
  });
});

describe('C4 T23: AI spend in one currency, the business\'s own', () => {
  it('with a rate the card shows rupees alone with the receipt; the dollars are in the receipt, not beside the figure', async () => {
    start('#/money');
    const spent = await tile('AI spend this month');
    const figure = await waitFor(() => { const found = spent.querySelector('[data-figure] [data-ui-number]'); expect(found).toBeTruthy(); return found!; });
    expect(figure.textContent).toBe('₹60.10');
    expect(spent.textContent).not.toContain('$0.72');
    expect(within(spent).getAllByRole('button', { name: receiptMark(/^R-/) }).length).toBeGreaterThan(0);
    assertFiguresProved();
  });

  // Fix round 4 (real-app problem 12): a business in Indore read "AI spend this month $0.00" and "Shown first: US dollars,
  // by business location" because rupees could lead only once the owner typed a rate. A rupee business now reads rupees
  // from its first day at the dated reference rate (719800 micros x 943996 / 10^8 = 6795 paise), and nothing sends the
  // owner off to set a rate first.
  it('with no rate of the owner\'s own a rupee business still reads rupees, at the reference rate, on the card and on Spend', async () => {
    start('#/money', { before: (engine) => engine.request('venture.spend.policy.set', { inrPerUsd: null }) });
    const spent = await tile('AI spend this month');
    const figure = await waitFor(() => { const found = spent.querySelector('[data-figure] [data-ui-number]'); expect(found).toBeTruthy(); return found!; });
    expect(figure.textContent).toBe('₹67.95');
    expect(spent.textContent).not.toContain('$');
    // One link in the foot, to each call; no second link runs into it (real-app problem 18a).
    expect(within(spent).getAllByRole('link').map((link) => link.textContent)).toEqual(['Each call']);
    cleanup();
    start('#/money/spend', { before: (engine) => engine.request('venture.spend.policy.set', { inrPerUsd: null }) });
    const paid = await tile('Paid calls');
    await waitFor(() => expect(paid.textContent).toContain('₹67.95 this month'));
    expect(paid.querySelector('h2')?.parentElement?.textContent ?? '').not.toContain('$0.72');
    // The settings say which currency leads and at what rate, with the rate's source and day.
    const shown = await waitFor(() => { const found = document.querySelector('[data-shown-first]'); expect(found).toBeTruthy(); return found!; });
    expect(shown.textContent).toBe('Shown first: Rupees, by business location');
    expect(document.body.textContent).toContain('₹94.40 per $1 (FBIL reference rate of 5 Nov 2026)');
    expect(screen.queryByRole('link', { name: /rupee rate/i })).toBeNull();
  });

  it('the spend page total is in one currency: rupees at the owner\'s rate', async () => {
    start('#/money/spend');
    const paid = await tile('Paid calls');
    await waitFor(() => expect(paid.textContent).toContain('₹60.10 this month'));
    expect(paid.querySelector('h2')?.parentElement?.textContent ?? '').not.toContain('$0.72');
  });

  it('margins count the spend at the reference rate until the owner types a rate, and say which rate', async () => {
    start('#/money/margins', { before: (engine) => engine.request('venture.spend.policy.set', { inrPerUsd: null }) });
    const section = await tile(/^Margins in /);
    await within(section).findByText(/at ₹94\.40 per \$1 \(FBIL reference rate of 5 Nov 2026\)/);
    expect(within(section).queryByRole('link', { name: 'Set rate' })).toBeNull();
    cleanup();
    start('#/money/margins');
    const rated = await tile(/^Margins in /);
    await within(rated).findByText(/at ₹83\.50 per \$1 \(your rate, set 15 Oct 2026\)/);
  });

  it('a business outside India with no rate to its currency reads Not counted, in the engine\'s words', async () => {
    const line = 'October 2026: invoiced before tax. The AI and tool spend is not counted: no rate from US dollars to AED.';
    start('#/money/margins', { override: { 'venture.money.margins': async (params, request) => {
      const view = await request('venture.money.margins', params) as { rows: object[] };
      return { ...view, line, rows: view.rows.map((row) => ({ ...row, spend: null, margin: null, note: 'Not counted: no rate from US dollars to AED' })) };
    } } });
    const section = await tile(/^Margins in /);
    const row = await within(section).findByRole('row', { name: /Boat Audio/ });
    expect(within(row).getAllByText('Not counted')).toHaveLength(2);
    expect(section.textContent).toContain(line);
  });
});
