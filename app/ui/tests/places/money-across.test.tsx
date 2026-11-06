import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { assertFiguresProved, assertInkRules, receiptMark } from '../helpers/ink-rules';

/*
 * Money across the businesses on this computer (W4 4J6, shown by 4J20): the business chips over the overview, "All
 * businesses" with each business from what Chausar saved when it was last open, a locked one showing nothing, and the
 * total only when they bill in one currency. Every figure carries the receipt the engine made for it in the open
 * business. The fake engine answers venture.money.across as the engine does (fake-across.ts).
 */

type Call = [string, unknown];
const NOW = '2026-10-23T08:00:00.000Z';

function start(hash: string, options: { language?: 'en' | 'hi'; hosted?: boolean } = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine({ now: () => NOW, ...(options.hosted ? { hosted: true } : {}) });
  const base = createFakeClient(engine);
  const calls: Call[] = [];
  const request = base.request.bind(base);
  const client: EngineClient = { ...base, request: (async (method: string, params?: unknown) => { calls.push([method, params]); return request(method as never, params as never); }) as EngineClient['request'] };
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language={options.language ?? 'en'} /></ClockProvider>);
  return { calls };
}
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const chips = () => screen.findByRole('group', { name: 'Businesses' });

describe('Money w4: money across businesses, on its own page', () => {
  it('the overview shows a compact chip row when there is more than one business; another chip opens the Businesses page on it', async () => {
    start('#/money');
    await screen.findByRole('region', { name: 'Owed to you' });
    const nav = screen.getByRole('navigation', { name: 'Money' });
    expect(await within(nav).findByRole('link', { name: 'Businesses' })).toBeTruthy();
    const row = await chips();
    expect(row.getAttribute('data-scroll')).toBe('');
    expect(within(row).getByRole('button', { name: /Lumen Studio/ }).getAttribute('aria-pressed')).toBe('true');
    await click(within(row).getByRole('button', { name: /Ledgerline/ }));
    expect(window.location.hash).toBe('#/money/businesses?biz=ledgerline');
  });

  it('the open business matches its own overview, and its spend shows in rupees at the owner rate once one is set', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('venture.spend.policy.set', { inrPerUsd: '83.50' });
    window.location.hash = '#/money/businesses';
    render(<ClockProvider now={() => new Date(NOW)}><App client={createFakeClient(engine)} language="en" /></ClockProvider>);
    const lumen = await screen.findByRole('region', { name: 'Lumen Studio' });
    const overview = await engine.request('venture.money.overview', {}) as { lines: { id: string; value: string }[] };
    await waitFor(() => expect(lumen.textContent).toContain(overview.lines.find((line) => line.id === 'owed')!.value));
    expect(lumen.textContent).toMatch(/at ₹83\.50 per \$1/);
    assertInkRules();
  });

  it('All businesses, then each business on this computer, All pressed and the locked one with its lock', async () => {
    start('#/money/businesses');
    const row = await chips();
    const buttons = within(row).getAllByRole('button');
    expect(buttons.map((button) => button.textContent?.replace(/\s+/g, ' ').trim())).toEqual(expect.arrayContaining(['All businesses']));
    expect(within(row).getByRole('button', { name: 'All businesses' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(row).getByRole('button', { name: /Sitara Events/ }).textContent).toMatch(/Sitara Events/);
  });

  it('All businesses shows each business with its figures and receipts as of when it was last open, the locked one with nothing, and the total', async () => {
    const { calls } = start('#/money/businesses');
    await chips();
    const all = await screen.findByRole('region', { name: 'Money across your businesses' });
    expect(calls.map(([method]) => method)).toContain('venture.money.across');
    const total = await within(all).findByRole('region', { name: 'Invoiced in October 2026' });
    expect(within(total).getByRole('button', { name: receiptMark(/^R-/) })).toBeTruthy();
    expect(total.textContent).toContain('Across 2 businesses.');
    // Its receipt sits in the total's own tile.
    expect(total.querySelector('[data-figure] [data-receipt]')).not.toBeNull();
    expect(total.textContent).toContain('Sitara Events: locked with a passphrase');
    const lumen = within(all).getByRole('region', { name: 'Lumen Studio' });
    expect(lumen.textContent).toContain('Open now.');
    const ledgerline = within(all).getByRole('region', { name: 'Ledgerline' });
    expect(ledgerline.textContent).toMatch(/^Ledgerline.*As of .+, when you last opened it\./);
    expect(within(ledgerline).getAllByRole('button', { name: receiptMark(/^R-/) }).length).toBe(4);
    const sitara = within(all).getByRole('region', { name: 'Sitara Events' });
    expect(sitara.textContent).toContain('Sitara Events is locked with a passphrase, so Chausar shows nothing about it until you open it.');
    expect(sitara.querySelector('[data-figure]')).toBeNull();
    // Export is for the open business only, so it is not offered across businesses.
    expect(screen.queryByRole('button', { name: /^Export for your CA/ })).toBeNull();
    assertInkRules();
    assertFiguresProved();
  });

  it('another business shows only its saved figures, and says to switch to it for its invoices; All shows them all again', async () => {
    start('#/money/businesses');
    await click(within(await chips()).getByRole('button', { name: /Ledgerline/ }));
    const card = await screen.findByRole('region', { name: 'Ledgerline' });
    expect(within(card).getByText('Invoiced')).toBeTruthy();
    expect(screen.getByText('Switch to it from the business menu to see its invoices and charts.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Lumen Studio' })).toBeNull();
    expect(window.location.hash).toBe('#/money/businesses?biz=ledgerline');
    await click(within(await chips()).getByRole('button', { name: 'All businesses' }));
    expect(window.location.hash).toBe('#/money/businesses');
    expect(await screen.findByRole('region', { name: 'Lumen Studio' })).toBeTruthy();
  });

  it('on the hosted app there is one business, so no Businesses page is offered', async () => {
    start('#/money', { hosted: true });
    await screen.findByRole('region', { name: 'Owed to you' });
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Money' })).queryByRole('link', { name: 'Businesses' })).toBeNull());
  });

  it('words the lines in Hindi from the engine keys', async () => {
    start('#/money/businesses', { language: 'hi' });
    const sitara = await screen.findByRole('region', { name: 'Sitara Events' });
    expect(sitara.textContent).toContain('Sitara Events पासफ़्रेज़ से बंद है');
    assertInkRules();
  });
});
