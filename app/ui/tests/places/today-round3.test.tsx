import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient, type QueueRow } from '../../src/engine/types';
import { settingsFor } from '../../src/shell/settings';
import common from '../../src/text/en/common.json';
import business from '../../src/text/en/business.json';
import businessHi from '../../src/text/hi/business.json';

/**
 * The newest Windows build (15 Nov 2026, third round), smaller findings on Today and in the address:
 *   - the filter chips disagreed: "All 3 / To approve 1 / Setup 4" (Setup counted the locked businesses, All did not);
 *   - every switch of business logged one venture.queue.view refused QUEUE_ITEM_NOT_FOUND (a card of the business
 *     just left asked for its preview from the one just opened);
 *   - "?show=business:..." stayed in the address after the owner switched away from that business;
 *   - Settings' side list still had a group headed "Business".
 */
type Call = [string, Record<string, unknown>];
function start(hash: string, engine = new FakeEngine()) {
  window.location.hash = hash;
  const fake = createFakeClient(engine);
  const calls: Call[] = [];
  const refused: string[] = [];
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => {
    calls.push([method, structuredClone(params ?? {})]);
    const answer = fake.request(method as never, params as never) as Promise<unknown>;
    answer.then(() => { calls.push([`answered:${method}`, {}]); }, (error: unknown) => { if (error instanceof EngineError) refused.push(`${method} ${error.code}`); });
    return answer;
  }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { engine, calls, refused };
}
/** Whether `asked` was sent, from `from` on and after the business was opened, before any `list` had answered. */
function answeredBefore(calls: Call[], from: number, asked: string, list: string): boolean {
  const after = calls.slice(from).map(([method]) => method);
  const opened = after.indexOf('answered:workspace.open');
  const answered = after.indexOf(`answered:${list}`, opened);
  const sent = after.indexOf(asked, opened);
  return sent >= 0 && (answered < 0 || sent < answered);
}
const needsYou = () => screen.getByRole('region', { name: 'Needs you' });
const chip = (name: RegExp) => within(needsYou()).getByRole('button', { name });
const countOf = (name: RegExp) => Number(chip(name).textContent!.replace(/\D/g, '') || '0');

afterEach(() => { vi.restoreAllMocks(); });

describe('Today: the filter chips count the same rows', () => {
  it('the kinds add up to All: a locked business is in neither count', async () => {
    const engine = new FakeEngine();
    start('#/today', engine);
    const listed = (await engine.request('venture.queue.list', { scope: 'all' })) as { rows: QueueRow[]; needsYou: number };
    expect(listed.rows.some((row) => row.kind === 'locked')).toBe(true);
    await waitFor(() => expect(countOf(/^All/)).toBe(listed.needsYou));
    const kinds = [/^To approve/, /^From your agents/, /^Setup/].filter((name) => within(needsYou()).queryByRole('button', { name }));
    expect(kinds.map(countOf).reduce((sum, count) => sum + count, 0)).toBe(listed.needsYou);
    const setup = listed.rows.filter((row) => row.kind === 'setup').length;
    if (setup) expect(countOf(/^Setup/)).toBe(setup);
    else expect(within(needsYou()).queryByRole('button', { name: /^Setup/ })).toBeNull();
  }, 20000);
});

describe('Switching business', () => {
  /** The business menu: switch to Ledgerline, another business this computer can open. */
  async function switchToLedgerline(calls: Call[]) {
    const before = calls.length;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: new RegExp(`${common['business.switchTo']}$`) })); });
    const menu = await screen.findByRole('dialog', { name: /^Business menu/ });
    const other = within(menu).getAllByRole('button').find((button) => /Ledgerline/.test(button.textContent ?? ''))!;
    await act(async () => { fireEvent.click(other); });
    await waitFor(() => expect(calls.slice(before).some(([method]) => method === 'workspace.open')).toBe(true));
    await waitFor(() => expect(within(screen.getByRole('navigation')).getByRole('button', { name: /Ledgerline/ })).toBeTruthy());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    return before;
  }

  it('asks for no card until the newly opened business has answered with its own list', async () => {
    const { calls, refused } = start('#/today');
    await waitFor(() => expect(needsYou().querySelectorAll('[data-row-id]').length).toBeGreaterThan(0));
    await waitFor(() => expect(calls.some(([method]) => method === 'venture.queue.view')).toBe(true));
    const before = await switchToLedgerline(calls);
    expect(refused.filter((line) => line.startsWith('venture.queue.view'))).toEqual([]);
    // The app is drawn again on the business just opened. Its first drawing must not show the cards of the business
    // just left: each of them asked the new business for its own row, which the real engine refuses (it lists only
    // the open business's rows). So after the open, no card is asked for before the list has been asked again.
    const after = calls.slice(before).map(([method]) => method);
    const opened = after.indexOf('workspace.open');
    const firstView = after.indexOf('venture.queue.view', opened);
    const firstList = after.indexOf('venture.queue.list', opened);
    expect(firstList).toBeGreaterThan(opened);
    if (firstView >= 0) expect(firstView).toBeGreaterThan(firstList);
    expect(answeredBefore(calls, before, 'venture.queue.view', 'venture.queue.list')).toBe(false);
  }, 30000);

  it('takes the filter for the business just left out of the address', async () => {
    const engine = new FakeEngine();
    const first = ((await engine.request('venture.queue.list', { scope: 'current' })) as { rows: QueueRow[] }).rows.find((row) => row.kind !== 'locked')!;
    const { calls } = start('#/today', engine);
    await waitFor(() => expect(needsYou().querySelectorAll('[data-row-id]').length).toBeGreaterThan(0));
    await act(async () => { fireEvent.click(chip(new RegExp(`^${first.businessName}`))); });
    expect(decodeURIComponent(window.location.hash)).toContain(`show=business:${first.businessId}`);
    await switchToLedgerline(calls);
    // The filter named the business the owner left: it is gone from the address, and Today shows All.
    await waitFor(() => expect(decodeURIComponent(window.location.hash)).not.toContain('show=business'));
    expect(chip(/^All/).getAttribute('aria-pressed')).toBe('true');
  }, 30000);

  it('a filter that names no business on this computer leaves the address once the list has answered', async () => {
    start('#/today?show=business:gone-away');
    await waitFor(() => expect(needsYou().querySelectorAll('[data-row-id]').length).toBeGreaterThan(0));
    await waitFor(() => expect(decodeURIComponent(window.location.hash)).toBe('#/today'));
  }, 20000);
});

describe('Settings: the side list', () => {
  it('has no group headed "Business": the place is Settings, and its first group is General', () => {
    const groups = settingsFor(undefined);
    const words = business as unknown as Record<string, string>;
    const headings = groups.map((group) => words[group.title]);
    expect(headings).not.toContain('Business');
    expect(headings).toEqual(['General', 'Work', 'Money', 'Safety']);
    expect((businessHi as unknown as Record<string, string>)[groups[0]!.title]).not.toBe('बिज़नेस');
  });
});
