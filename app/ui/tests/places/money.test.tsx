import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertFiguresProved, assertInkRules, receiptMark } from '../helpers/ink-rules';

type Call = [string, unknown];
type Override = (params: unknown) => unknown;

function start(hash: string, options: { language?: 'en' | 'hi'; override?: Record<string, Override> } = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine({ now: () => '2026-10-21T11:00:00.000Z' });
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = (async (method: string, params?: unknown) => {
    calls.push([method, params]);
    const override = options.override?.[method];
    return override ? override(params) : request(method as never, params as never);
  }) as typeof client.request;
  render(<App client={client} language={options.language ?? 'en'} />);
  return { engine, client, calls };
}
const go = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };

/** Money at a glance as the real engine sends it: every line with its receipt (platform/runtime/venture/money/overview.ts). */
const RECEIPTED = {
  lines: [
    { id: 'owed', label: 'Clients owe you', value: '₹26,200.00', receiptId: 'R-0430' },
    { id: 'received', label: 'Came in this month', value: '₹86,200.00', receiptId: 'R-0402' },
    { id: 'spent', label: 'AI and tools this month', value: '₹60.10, includes estimates', receiptId: 'R-0431', estimate: true },
  ],
};
const receipted: Override = () => structuredClone(RECEIPTED);
const tileOf = (name: string) => screen.findByRole('region', { name });

describe('Money overview', () => {
  it('shows what was invoiced, what came in, what AI cost and what clients owe, each in the engine words with its receipt', async () => {
    start('#/money', { override: { 'venture.money.overview': receipted } });
    expect(screen.getByRole('heading', { level: 1, name: 'Money' })).toBeTruthy();
    const owed = await tileOf('Owed to you');
    await waitFor(() => expect(owed.querySelector('[data-ui-number]')?.textContent).toBe('₹26,200.00'));
    // W4 4J20: the engine's aging total, under the aging receipt that also proves the five ages drawn under it.
    expect(owed.querySelector('[data-figure] [data-receipt]')).not.toBeNull();
    expect(within(owed).getByRole('img', { name: /^Owed by age/ })).toBeTruthy();
    const received = await tileOf('Received');
    expect(await within(received).findByText('₹86,200.00')).toBeTruthy();
    expect(within(received).getByRole('button', { name: receiptMark('R-0402') })).toBeTruthy();
    const spent = await tileOf('AI spend this month');
    expect(await within(spent).findByText('₹60.10')).toBeTruthy();
    expect(within(spent).getByRole('link', { name: 'Each call' }).getAttribute('href')).toBe('#/money/spend');
    // A cost estimate is not a number a model wrote: it opens its receipt, never "model estimate".
    expect(spent.textContent).not.toContain('model estimate');
    // With the month's goal (W4 4I2) the invoiced figure is the goals view's, with its own receipt (money-goal.test.tsx).
    const invoiced = await tileOf('Invoiced this month');
    await waitFor(() => expect(invoiced.querySelector('[data-ui-number]')?.textContent).toBe('₹1,12,400.00'));
    expect(invoiced.querySelector('[data-ui-number] ~ [data-receipt], [data-figure] [data-receipt]')).not.toBeNull();
  });

  it('reads two engine views and adds nothing up; every figure on it carries its proof', async () => {
    const { calls } = start('#/money', { override: { 'venture.money.overview': receipted } });
    await within(await tileOf('Received')).findByText('₹86,200.00');
    await screen.findByText('₹60.10');
    // The W4 views have landed (4J20): the cash figures and the next three weeks.
    await within(await tileOf('Cash, next 13 weeks')).findByText('In the bank');
    await within(await tileOf('Next three weeks')).findByText(/Due from Boat Audio/);
    await screen.findByText('₹1,12,400.00');
    await screen.findByText('₹1,50,000.00');
    expect(calls.map(([m]) => m)).toContain('venture.money.overview');
    expect(calls).toContainEqual(['venture.books.summary', { period: 'this-month' }]);
    expect(calls.map(([m]) => m)).not.toContain('venture.spend.list');
    // Four figures, and on the invoiced tile the month's goal and how far ahead of pace (W4 4I2); last month's received,
    // the bank today, and one amount due in the next three weeks (W4 4J20). 4Z2: cash stays above today's, so no lowest week.
    expect(assertFiguresProved().length).toBe(9);
    assertInkRules();
  });

  it('a figure a model wrote says so and never carries a receipt', async () => {
    start('#/money', { override: { 'venture.money.overview': () => ({ lines: [{ id: 'received', label: 'Came in this month', value: '₹40,000.00', receiptId: 'R-0402', estimate: true }] }) } });
    const received = await tileOf('Received');
    await within(received).findByText('₹40,000.00');
    expect(received.textContent).toContain('model estimate');
    // The tile's own figure carries no receipt (last month's, under it, has its own: W4 4J20).
    expect(within(received).getByText('₹40,000.00').closest('[data-figure]')!.querySelector('[data-receipt]')).toBeNull();
  });

  it('shows what the engine says when nothing is owed, with no aging bar', async () => {
    const none = { kind: 'calculated' as const, display: '₹0.00', receiptId: 'R-0430', source: { from: 'receipt' as const, receiptId: 'R-0430' } };
    start('#/money', {
      override: {
        'venture.money.overview': () => ({ lines: [{ id: 'owed', label: 'Clients owe you', value: '₹0.00', receiptId: 'R-0430' }] }),
        'venture.money.aging': () => ({
          asOf: '2026-10-21', total: none, invoices: [], line: 'Nothing is owed on open invoices.',
          buckets: (['not-due', '1-30', '31-60', '61-90', 'over-90'] as const).map((id) => ({ id, label: id, count: 0, countLine: 'None', amount: none, permille: 0 })),
        }),
      },
    });
    const owed = await tileOf('Owed to you');
    expect(await within(owed).findByText('₹0.00')).toBeTruthy();
    expect(await within(owed).findByText('Nobody owes you anything right now.')).toBeTruthy();
    expect(within(owed).queryByRole('img')).toBeNull();
  });

  it('a receipt opens the receipt sheet', async () => {
    start('#/money');
    await click(await screen.findByRole('button', { name: receiptMark('R-0402') }));
    expect(window.location.hash).toBe('#/money?sheet=receipt%3AR-0402');
    expect(await screen.findByRole('complementary', { name: 'R-0402' })).toBeTruthy();
  });

  it('keeps each part of Money in the address; an unknown part shows the overview', async () => {
    start('#/money');
    const nav = screen.getByRole('navigation', { name: 'Money' });
    // Businesses (W4 4J20) joins once the engine says this computer has more than one business.
    await within(nav).findByRole('link', { name: 'Businesses' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Overview', '#/money'], ['Invoices', '#/money/invoices'], ['Bills', '#/money/bills'], ['Books', '#/money/books'], ['Margins', '#/money/margins'],
      ['Spend', '#/money/spend'], ['Journal', '#/money/journal'], ['Businesses', '#/money/businesses'],
    ]);
    expect(links[0]!.getAttribute('aria-current')).toBe('page');
    await go('#/money/journal');
    expect(within(nav).getByRole('link', { name: 'Journal' }).getAttribute('aria-current')).toBe('page');
    expect(links[0]!.getAttribute('aria-current')).toBeNull();
    expect(await screen.findByText('Send invoice · Mehta Traders')).toBeTruthy();
    await go('#/money/nowhere');
    expect(await screen.findByRole('region', { name: 'Owed to you' })).toBeTruthy();
  });

  // The overview's word budget (Ink v1's 45, raised to 79 by 3F for the D tiles) moved to tests/budgets.test.tsx (w3
  // 3I), with every place's, measured the same way: the overview as the real engine sends it, with its receipts.

  it('speaks Hindi', async () => {
    start('#/money', { language: 'hi' });
    expect(await screen.findByRole('heading', { level: 1, name: 'पैसा' })).toBeTruthy();
    expect(await screen.findByRole('region', { name: 'आपको मिलना बाकी' })).toBeTruthy();
  });
});

describe('Money source', () => {
  const dir = join(import.meta.dirname, '../../src/places/money');
  const files = (path: string): string[] => readdirSync(path).flatMap((name) => (statSync(join(path, name)).isDirectory() ? files(join(path, name)) : [join(path, name)]));

  it('never does arithmetic: no number parsing, maths, sums or compound assignment', () => {
    const code = files(dir).filter((f) => /\.tsx?$/.test(f));
    expect(code.length).toBeGreaterThan(0);
    for (const file of code) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/Number\(|parseInt|parseFloat|Math\.|\.reduce\(|BigInt|toFixed|NumberFormat|[+\-*/]=(?!=)|\+\+|--(?!>)/);
    }
  });
});
