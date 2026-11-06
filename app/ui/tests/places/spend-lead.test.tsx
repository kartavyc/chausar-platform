import { describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * 4Z3 (founder, 27 Oct): which currency leads AI spend. By the owner's location by default (a business in India with
 * a rupee rate: rupees lead, "₹60.10", with "USD 0.72 at ₹83.50 per $1" small beneath), changeable in the spend
 * settings (Auto, Rupees first, Dollars first). The engine sends the lead with every spend figure (fake-lead.ts as
 * money/spend.ts); the screen shows it and computes nothing, and never more than two decimals of dollars lead.
 */

type Call = [string, unknown];
const NOW = '2026-10-23T08:00:00.000Z';

async function start(hash: string, options: { lead?: 'auto' | 'inr' | 'usd'; rate?: boolean } = {}) {
  const engine = new FakeEngine({ now: () => NOW });
  if (options.rate) await engine.request('venture.spend.policy.set', { inrPerUsd: '83.50' });
  if (options.lead) await engine.request('venture.spend.policy.set', { currencyLead: options.lead });
  const base = createFakeClient(engine);
  const calls: Call[] = [];
  const request = base.request.bind(base);
  const client: EngineClient = { ...base, request: (async (method: string, params?: unknown) => { calls.push([method, params]); return request(method as never, params as never); }) as EngineClient['request'] };
  window.location.hash = hash;
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
  return { calls };
}
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const tile = (name: string) => screen.findByRole('region', { name });
const lead = (scope: Element) => scope.querySelector('[data-figure] [data-ui-number]')?.textContent;

describe('4Z3: the fake engine agrees with its own spend policy, as the engine does', () => {
  type Lead = { currency: string; figure: string; beside?: string; other?: string };
  const views = async (engine: FakeEngine) => {
    const overview = await engine.request('venture.money.overview', {}) as { lines: { id: string; rupees?: string; lead?: Lead }[] };
    const team = await engine.request('venture.team.list', {}) as { totals?: { spendThisMonth: { rupees?: string; rate?: string; held?: string; lead?: Lead } } };
    const spend = await engine.request('venture.spend.list', {}) as { total: string; totalRupees?: string; totalLead?: Lead };
    return { spent: overview.lines.find((line) => line.id === 'spent')!, team: team.totals!.spendThisMonth, spend };
  };

  it('the sample policy carries the owner\'s rate with its day; every spend view shows rupees at it, led by rupees in India', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const policy = await engine.request('venture.spend.policy.get', {}) as { inrPerUsd: string | null; rupeeRate: string | null; leads?: string };
    expect([policy.inrPerUsd, policy.rupeeRate, policy.leads]).toEqual(['83.50', '₹83.50 per $1 (your rate, set 15 Oct 2026)', 'INR']);
    // USD 0.7198 at 83.50: 719800 x 835000 / 10^8 = 6010.83 paise, to the nearest paisa ₹60.10; 72 cents.
    const { spent, team, spend } = await views(engine);
    expect(spent.rupees).toBe('₹60.10 at ₹83.50 per $1 (your rate, set 15 Oct 2026)');
    expect(spent.lead).toEqual({ currency: 'INR', figure: '₹60.10, includes estimates', beside: 'USD 0.72 at ₹83.50 per $1', other: 'USD 0.72' });
    expect(team.rupees).toBe('₹60.10 at ₹83.50 per $1 (your rate, set 15 Oct 2026)');
    expect(team.lead).toEqual({ currency: 'INR', figure: '₹60.10 (includes estimates)', beside: 'USD 0.72 at ₹83.50 per $1', other: 'USD 0.72' });
    expect(spend.totalRupees).toBe('₹60.10 at ₹83.50 per $1 (your rate, set 15 Oct 2026)');
    expect(spend.totalLead).toEqual({ currency: 'INR', figure: '₹60.10 this month (includes estimates)', beside: 'USD 0.72 at ₹83.50 per $1', other: 'USD 0.72' });
  });

  it('with the rate cleared, no view shows rupees and dollars lead with two decimals; a new rate is used everywhere', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('venture.spend.policy.set', { inrPerUsd: null });
    const cleared = await views(engine);
    expect([cleared.spent.rupees, cleared.team.rupees, cleared.team.rate, cleared.spend.totalRupees]).toEqual([undefined, undefined, undefined, undefined]);
    expect(cleared.spent.lead).toEqual({ currency: 'USD', figure: 'USD 0.72, includes estimates' });
    expect(cleared.team.lead).toEqual({ currency: 'USD', figure: 'USD 0.72 (includes estimates)' });
    expect(cleared.team.held).toBe('including USD 0.22 held for running work');
    expect(cleared.spend.totalLead).toEqual({ currency: 'USD', figure: 'USD 0.72 this month (includes estimates)' });
    // At 84.00: 719800 x 840000 / 10^8 = 6046.32 paise, ₹60.46.
    await engine.request('venture.spend.policy.set', { inrPerUsd: '84' });
    const moved = await views(engine);
    expect(moved.spent.lead).toEqual({ currency: 'INR', figure: '₹60.46, includes estimates', beside: 'USD 0.72 at ₹84.00 per $1', other: 'USD 0.72' });
    expect(moved.team.rupees).toBe('₹60.46 at ₹84.00 per $1 (your rate, set 23 Oct 2026)');
  });
});

describe('4Z3: which currency leads AI spend', () => {
  it('Money: in India, rupees lead the AI spend tile, the dollars small beneath with two decimals and the rate', async () => {
    await start('#/money');
    const spend = await tile('AI spend this month');
    await waitFor(() => expect(lead(spend)).toBe('₹60.10'));
    expect(within(spend).getByText('USD 0.72 at ₹83.50 per $1')).toBeTruthy();
    expect(spend.textContent).not.toContain('USD 0.7198');
    // The split by department under it leads the same way.
    await waitFor(() => expect(spend.textContent).toContain('₹18.00'));
    expect(spend.textContent).not.toContain('USD 0.2156');
    assertInkRules();
  });

  it('Money: with Dollars first, dollars lead with two decimals and the rupees sit beneath', async () => {
    await start('#/money', { lead: 'usd' });
    const spend = await tile('AI spend this month');
    await waitFor(() => expect(lead(spend)).toBe('USD 0.72'));
    expect(within(spend).getByText('₹60.10 at ₹83.50 per $1')).toBeTruthy();
    assertInkRules();
  });

  it('Team: the spend tile and each department lead as the engine says, the department with the other amount alone', async () => {
    await start('#/team');
    const glance = await screen.findByRole('region', { name: 'Team at a glance' });
    const spend = (await within(glance).findByText('AI spend this month')).closest('[data-card]') as HTMLElement;
    await waitFor(() => expect(lead(spend)).toBe('₹60.10'));
    expect(spend.textContent).toContain('USD 0.72 at ₹83.50 per $1');
    expect(spend.textContent).not.toContain('USD 0.7198');
    const marketing = (await screen.findByRole('article', { name: 'Marketing' })).querySelector<HTMLElement>('[data-figure-group]')!;
    expect(lead(marketing)).toBe('₹18.00');
    expect(marketing.textContent).toContain('USD 0.22');
    expect(marketing.textContent).not.toContain('per $1');
    assertInkRules();
  });

  it('the spend page total and the Businesses page follow the choice too', async () => {
    await start('#/money/spend', { lead: 'usd', rate: true });
    const paid = await tile('Paid calls');
    await waitFor(() => expect(paid.textContent).toContain('USD 0.72 this month (includes estimates)'));
    // The page says the rate once, in its settings: beside the total, the other amount alone.
    expect(paid.textContent).toContain('₹60.10');
    expect(paid.textContent).not.toContain('per $1');
    expect((await screen.findByRole('region', { name: 'Limits and rates' })).textContent).toContain('₹83.50 per $1');
    window.location.hash = '#/money/businesses';
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const lumen = await screen.findByRole('region', { name: 'Lumen Studio' });
    await waitFor(() => expect(lumen.textContent).toContain('USD 0.72'));
    expect(lumen.textContent).not.toContain('USD 0.7198');
    assertInkRules();
  });

  it('settings: Which currency first, Auto by default; a change is drafted, asks once more, and goes to the engine', async () => {
    const { calls } = await start('#/money/spend');
    const settings = await screen.findByRole('region', { name: 'Limits and rates' });
    await click(await within(settings).findByRole('button', { name: 'Change' }));
    const choice = within(settings).getByLabelText('Show AI spend first in') as HTMLSelectElement;
    expect(choice.value).toBe('auto');
    expect([...choice.options].map((option) => option.textContent)).toEqual(['Auto, by where your business is', 'Rupees', 'US dollars']);
    await act(async () => { fireEvent.change(choice, { target: { value: 'usd' } }); });
    await click(within(settings).getByRole('button', { name: 'Save' }));
    expect(calls.some(([method]) => method === 'venture.spend.policy.set')).toBe(false);
    await click(within(settings).getAllByRole('button', { name: 'Save' }).find((b) => b.hasAttribute('data-confirm'))!);
    await waitFor(() => expect(calls.find(([method]) => method === 'venture.spend.policy.set')?.[1]).toMatchObject({ currencyLead: 'usd' }));
    assertInkRules();
  });

  it('settings at rest say which currency leads; saving Dollars first changes the paid calls at once, with no navigation', async () => {
    await start('#/money/spend');
    const settings = await screen.findByRole('region', { name: 'Limits and rates' });
    await waitFor(() => expect(settings.textContent).toContain('Shown first: Rupees, by where your business is'));
    const paid = await tile('Paid calls');
    // The sample's calls, engine-shaped: USD 0.5389 reserved and USD 0.5041 settled, led by rupees at ₹83.50.
    const billed = (await within(paid).findByText('Model calls for episode 14')).closest('li')!;
    await waitFor(() => expect(billed.textContent).toContain('Reserved ₹45.00'));
    expect(billed.textContent).toContain('Settled ₹42.10');
    await click(within(settings).getByRole('button', { name: 'Change' }));
    await act(async () => { fireEvent.change(within(settings).getByLabelText('Show AI spend first in'), { target: { value: 'usd' } }); });
    await click(within(settings).getByRole('button', { name: 'Save' }));
    await click(within(settings).getAllByRole('button', { name: 'Save' }).find((b) => b.hasAttribute('data-confirm'))!);
    await waitFor(() => expect(billed.textContent).toContain('Reserved USD 0.54'));
    expect(billed.textContent).toContain('Settled USD 0.50');
    expect(paid.textContent).toContain('USD 0.72 this month (includes estimates)');
    expect(settings.textContent).toContain('Shown first: US dollars');
    // The limit lines follow it too: dollars to two decimals first, the rupees after them.
    expect(settings.textContent).toContain('USD 20.00 a month · ₹1,670.00');
    assertInkRules();
  });

  it('the limit lines, the held words and the weeks lead with rupees in India; dollars never past two decimals', async () => {
    await start('#/money/spend');
    const settings = await screen.findByRole('region', { name: 'Limits and rates' });
    await waitFor(() => expect(settings.textContent).toContain('₹1,670.00 a month · USD 20.00'));
    expect(settings.textContent).toContain('Asks you first above ₹167.00 · USD 2.00');
    expect(settings.textContent).not.toContain('USD 20.0000');
    cleanup();
    await start('#/team');
    const glance = await screen.findByRole('region', { name: 'Team at a glance' });
    await waitFor(() => expect(glance.querySelector('[data-held]')?.textContent).toContain('including ₹18.00 held for running work: USD 0.22'));
    expect(glance.textContent).not.toContain('USD 0.2156');
    cleanup();
    await start('#/team?dept=prod');
    const weeks = await screen.findByRole('table', { name: /Production/ }).catch(() => null);
    const notes = [...document.querySelectorAll('[data-note]')].map((note) => note.textContent);
    expect(weeks ?? notes.length).toBeTruthy();
    expect(notes.some((note) => note?.startsWith('₹'))).toBe(true);
    expect(notes.every((note) => !/USD \d+\.\d{3}/.test(note ?? ''))).toBe(true);
  });
});

describe('4Z3: the Businesses page', () => {
  it('another business leads at the open business\'s rate, and its line says so', async () => {
    await start('#/money/businesses');
    const ledgerline = await screen.findByRole('region', { name: 'Ledgerline' });
    await waitFor(() => expect(ledgerline.textContent).toContain("at the open business's rate, ₹83.50 per $1"));
    const lumen = await screen.findByRole('region', { name: 'Lumen Studio' });
    expect(lumen.textContent).not.toContain("open business's rate");
    assertInkRules();
  });
});
