import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { CashView, EngineClient } from '../../src/engine/types';
import { assertFiguresProved, assertInkRules, assertOnePrimary, receiptMark } from '../helpers/ink-rules';
import { cssOf } from '../helpers/css';

/*
 * Money's overview with the W4 money views (docs/superpowers/plans/2026-10-23-chausar-ink-v2-w4.md, package 4J20):
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

function start(hash: string, options: { now?: () => string; override?: Record<string, Override>; language?: 'en' | 'hi'; extra?: Partial<EngineClient>; before?: (engine: FakeEngine) => unknown } = {}) {
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

describe('Money w4: owed by age and reminders', () => {
  it('the owed tile draws the five ages at rest as the bar, each age in words in its name and its table, all under the one aging receipt', async () => {
    const { calls } = start('#/money', { now: NOV_10 });
    const owed = await tile('Owed to you');
    const bar = await within(owed).findByRole('img', { name: /^Owed by age, ₹26,200\.00 in all/ });
    const chart = bar.closest('[data-chart]') as HTMLElement;
    // At rest the legend names the ages that hold money, with count and amount, so colour never carries the meaning alone.
    expect([...chart.querySelectorAll('li[data-bucket]')].map((row) => row.textContent)).toEqual(['1 to 30 days late1 invoice₹26,200.00']);
    expect(bar.getAttribute('aria-label')).toBe('Owed by age, ₹26,200.00 in all: 1 to 30 days late ₹26,200.00');
    const rows = [...chart.querySelectorAll('tbody tr')].map((row) => row.textContent);
    expect(rows).toEqual([
      'Not due yetNone₹0.00', '1 to 30 days late1 invoice₹26,200.00', '31 to 60 days lateNone₹0.00', '61 to 90 days lateNone₹0.00', 'Over 90 days lateNone₹0.00',
    ]);
    // One receipt: the figure's and the chart's are the same aging sum.
    const figure = owed.querySelector('[data-figure] [data-receipt]')!.getAttribute('data-receipt');
    expect(within(chart).getAllByRole('button', { name: receiptMark(figure!) }).length).toBeGreaterThan(0);
    // 4J20: what the late ones owe, with its own receipt (here the one late invoice), beside the words.
    const late = owed.querySelector('[data-late-figure]') as HTMLElement;
    expect(late.textContent).toContain('₹26,200.00');
    expect(late.textContent).toContain('of it is late');
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

  it('with nothing late, there is no reminder to draft', async () => {
    start('#/money');
    const owed = await tile('Owed to you');
    await within(owed).findByRole('img', { name: /^Owed by age/ });
    expect(within(owed).queryByText('Billing drafts, you send')).toBeNull();
    expect(within(owed).queryByRole('button', { name: /reminder/ })).toBeNull();
  });
});

describe('Money w4: in and out by month', () => {
  it('paired bars with the engine values over them, what was left under each month, and every figure its own receipt', async () => {
    // The sample has the owner's rupee rate (4Z3); cleared here, the month's paid calls cannot be counted in rupees.
    start('#/money', { before: (engine) => engine.request('venture.spend.policy.set', { inrPerUsd: null }) });
    const flow = await tile('In and out by month');
    const chart = await within(flow).findByRole('img', { name: 'Money in and out for the last 6 months' });
    expect(within(flow).getByText('May to Oct')).toBeTruthy();
    const october = chart.querySelector('[data-key="2026-10"]') as HTMLElement;
    expect(october.querySelector('[data-cap]')?.textContent).toBe('₹86,200.00');
    expect(october.querySelector('[data-note]')?.textContent).toBe('₹86,200.00');
    expect(october.textContent).toContain('Oct, so far');
    // A month with nothing recorded draws no bar, never a zero.
    expect(chart.querySelector('[data-key="2026-09"] [data-bar]')).toBeNull();
    const data = flow.querySelector('details') as HTMLElement;
    expect(within(data).getByText('View chart data')).toBeTruthy();
    expect(within(data).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['In', 'Out', 'What was left', 'Receipt']);
    expect(within(data).getAllByRole('button', { name: receiptMark(/^R-/) }).length).toBeGreaterThan(0);
    // The sample's calls cannot be counted in rupees without a rate: the engine says so, never a zero.
    expect(flow.textContent).toMatch(/not counted: \d+ paid AI calls? with no rupee rate set/);
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
    expect(today.textContent).toContain('₹2,18,750.00');
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
    expect(line.textContent).toContain('₹30,000.00');
    expect(line.textContent).toContain('in the week to 11 Nov.');
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
    expect(row.textContent).toContain('₹26,200.00');
    expect(within(row).getByRole('button', { name: receiptMark(/^R-/) })).toBeTruthy();
    // Every amount the engine marks projected says so.
    expect(row.querySelector('[data-projected]')?.textContent).toBe('Projected');
    expect(screen.queryByRole('region', { name: 'Due to you next' })).toBeNull();
    assertInkRules();
  });
});

describe('Money w4: the month, last month and Export for your CA', () => {
  it('Received shows last month under this one with its receipt; the month picker moves Invoiced and Received', async () => {
    const { calls } = start('#/money');
    const received = await tile('Received');
    const before = await waitFor(() => received.querySelector('[data-previous]') as HTMLElement);
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

  it('on the web, Export for your CA downloads the engine file for the month as it came, and says Chausar sent nothing', async () => {
    const made: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => { made.push(blob); return 'blob:export'; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { calls } = start('#/money');
    await click(await screen.findByRole('button', { name: /^Export for your CA/ }));
    await waitFor(() => expect(calls).toContainEqual(['venture.money.export', { month: '2026-10' }]));
    expect(clicked).toHaveBeenCalled();
    const text = await made[0]!.text();
    // Blob.text() reads the engine's byte order mark away; the header is the engine's, with its Currency column.
    expect(text.split('\r\n')[0]).toBe('Section,Date,Number,Party,Party tax ID,Place of supply,Description,Before tax,Tax,Total,Status,Method,TDS section,TDS,Receipt,Currency');
    expect(text).toContain('Payment,2026-10-20,INV-0038,Boat Audio');
    expect(await screen.findByText('Downloaded lumen-studio-2026-10-for-ca.csv. Chausar did not send it anywhere.')).toBeTruthy();
    // The signed receipts that rode with the file are offered as a second file, saved as they came.
    await click(screen.getByRole('button', { name: 'Download the signed receipts' }));
    expect(JSON.parse(await made[1]!.text())).toMatchObject({ format: 'chausar-signed-receipts/1', business: 'Lumen Studio' });
    // The button's name says the month it exports.
    expect(screen.getByRole('button', { name: 'Export for your CA, October 2026' })).toBeTruthy();
  });

  it('on the desktop, the desktop saves the month where the owner picks; a refusal is said in its words', async () => {
    const save = vi.fn(async (month: string): Promise<{ saved: true; name: string; receipts?: string; line: string }> => ({ saved: true as const, name: `ledger-${month}.csv`, line: 'Saved.' }));
    const { calls } = start('#/money', { extra: { saveMoneyExport: save } });
    await click(await screen.findByRole('button', { name: /^Export for your CA/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('2026-10'));
    expect(await screen.findByText('Saved ledger-2026-10.csv. Chausar did not send it anywhere.')).toBeTruthy();
    expect(calls.map(([method]) => method)).not.toContain('venture.money.export');
    save.mockResolvedValueOnce({ saved: true, name: 'october.csv', receipts: 'october-receipts.json', line: 'Saved.' });
    await click(screen.getByRole('button', { name: /^Export for your CA/ }));
    expect(await screen.findByText('Saved october.csv and october-receipts.json. Chausar did not send them anywhere.')).toBeTruthy();
    save.mockRejectedValueOnce(Object.assign(new Error('A file with this name appeared while you were choosing, so Chausar left it alone. Save again to pick a name.'), { code: 'EXPORT_EXISTS' }));
    await click(screen.getByRole('button', { name: /^Export for your CA/ }));
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

  it('speaks Hindi: the ages, the months and the cash tile in Hindi words', async () => {
    start('#/money', { now: NOV_10, language: 'hi' });
    const owed = await tile('आपको मिलना बाकी');
    const chart = (await within(owed).findByRole('img')).closest('[data-chart]') as HTMLElement;
    expect(chart.textContent).toContain('1 से 30 दिन की देर');
    expect(await tile('नकद, अगले 13 हफ़्ते')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^अपने CA के लिए एक्सपोर्ट करें/ })).toBeTruthy();
    assertInkRules();
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
