import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

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
const main = () => screen.getByRole('main');
const lineOf = (text: string) => within(main()).getByText(text).closest('li')!;

/** The words a reader sees, one per run of text, so "Money" and "Overview" in two elements count as two. */
function words(root: Element): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node.parentElement?.closest('.sr-only'))) continue;
    out.push(...(node.textContent ?? '').split(/\s+/).filter(Boolean));
  }
  return out;
}

describe('Money overview', () => {
  it('shows what is owed, what came in this month and what AI and tools cost, each figure as the engine wrote it', async () => {
    start('#/money');
    expect(screen.getByRole('heading', { level: 1, name: 'Money' })).toBeTruthy();
    const owed = await waitFor(() => lineOf('Owed to you'));
    expect(owed.textContent).toContain('₹26,200.00');
    expect(owed.textContent).toContain('Boat Audio, due 28 Oct 2026');
    expect(within(owed).getByRole('button', { name: 'Invoice INV-0039' })).toBeTruthy();
    const received = await waitFor(() => lineOf('Received this month'));
    expect(received.textContent).toContain('₹86,200.00');
    expect(within(received).getByRole('button', { name: 'Receipt R-0402' })).toBeTruthy();
    const spent = await waitFor(() => lineOf('Spent on AI and tools'));
    expect(spent.textContent).toContain('₹60.10 this month (includes estimates)');
    expect(within(spent).getByRole('link', { name: 'Each call' }).getAttribute('href')).toBe('#/money/spend');
  });

  it('asks the engine for this month only, and every figure on it carries its reference', async () => {
    const { calls } = start('#/money');
    await screen.findByText('₹86,200.00');
    await screen.findByText('₹60.10 this month (includes estimates)');
    expect(calls).toContainEqual(['venture.books.summary', { period: 'this-month' }]);
    const figures = main().querySelectorAll('[data-figure]');
    expect(figures.length).toBe(3);
    for (const figure of figures) expect(figure.closest('li')!.querySelector('[data-receipt], [data-invoice], [data-ref]'), figure.textContent ?? '').toBeTruthy();
  });

  it('says plainly when nothing is owed', async () => {
    start('#/money', { override: { 'venture.books.summary': () => ({ currency: 'INR', period: { from: '2026-10-01', to: '2026-10-31' }, figures: [], openInvoices: [], notes: [] }) } });
    expect(await screen.findByText('Nothing is owed to you.')).toBeTruthy();
  });

  it('a receipt opens the receipt sheet and an invoice number opens the invoice', async () => {
    start('#/money');
    await click(await screen.findByRole('button', { name: 'Receipt R-0402' }));
    expect(window.location.hash).toBe('#/money?sheet=receipt%3AR-0402');
    expect(await screen.findByRole('complementary', { name: 'R-0402' })).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Invoice INV-0039' }));
    expect(await screen.findByRole('complementary', { name: 'INV-0039' })).toBeTruthy();
  });

  it('keeps each part of Money in the address; an unknown part shows the overview', async () => {
    start('#/money');
    const nav = screen.getByRole('navigation', { name: 'Money' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Overview', '#/money'], ['Invoices', '#/money/invoices'], ['Books', '#/money/books'], ['Spend', '#/money/spend'], ['Journal', '#/money/journal'],
    ]);
    expect(links[0]!.getAttribute('aria-current')).toBe('page');
    await go('#/money/journal');
    expect(within(nav).getByRole('link', { name: 'Journal' }).getAttribute('aria-current')).toBe('page');
    expect(links[0]!.getAttribute('aria-current')).toBeNull();
    expect(await screen.findByText('Send invoice · Mehta Traders')).toBeTruthy();
    await go('#/money/nowhere');
    expect(await screen.findByText('Owed to you')).toBeTruthy();
  });

  it('stays near forty words at rest', async () => {
    start('#/money');
    await screen.findByText('₹86,200.00');
    await screen.findByText('₹60.10 this month (includes estimates)');
    await screen.findByText('Boat Audio, due 28 Oct 2026');
    expect(words(main()).length).toBeLessThanOrEqual(45);
  });

  it('speaks Hindi', async () => {
    start('#/money', { language: 'hi' });
    expect(await screen.findByRole('heading', { level: 1, name: 'पैसा' })).toBeTruthy();
    expect(await screen.findByText('आपको मिलना है')).toBeTruthy();
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
