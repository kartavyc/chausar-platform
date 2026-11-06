import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient, TeamListView } from '../../src/engine/types';
import { assertFiguresProved, assertInkRules, assertOnePrimary, receiptMark } from '../helpers/ink-rules';

/*
 * Money's AI spend split by department (Ink v2 wave 4, package 4A2): the engine's department spend and the part no
 * single department can claim, each with the share the engine worked out (sharePermille), under the receipt of the
 * month's spend that they add up to. Nothing is divided in the browser; with no shares from the engine, no split.
 */

function start(intercept?: (method: string, base: ReturnType<typeof createFakeClient>) => Promise<unknown> | undefined) {
  window.location.hash = '#/money';
  const base = createFakeClient(new FakeEngine());
  const client: EngineClient = intercept
    ? { ...base, request: ((method: string, params?: Record<string, unknown>) => intercept(method, base) ?? base.request(method as never, params as never)) as EngineClient['request'] }
    : base;
  render(<App client={client} language="en" />);
}

const spendTile = async () => (await screen.findByText('AI spend this month')).closest('section') as HTMLElement;

describe('Money w4: AI spend by department', () => {
  it('the spend tile splits the month by department with a "Shared by the team" part, from the engine\'s shares, under the month\'s receipt', async () => {
    start();
    const tile = await spendTile();
    const bar = await within(tile).findByRole('img', { name: /^AI spend this month by department/ });
    expect([...bar.querySelectorAll('rect[data-dept]')].map((rect) => [rect.getAttribute('data-dept'), rect.getAttribute('width')]))
      .toEqual([['mkt', '299'], ['prod', '632'], ['shared', '68']]);
    const legend = [...tile.querySelectorAll('li[data-dept]')].map((row) => row.textContent);
    // The engine's amounts, led as the engine says (4Z3: rupees for a business in India with a rate); a part with no
    // share is left out of the legend.
    expect(legend).toEqual(['Marketing₹18.00', 'Production₹38.00', 'Shared by the team₹4.10']);
    const chart = tile.querySelector('[data-chart]') as HTMLElement;
    expect(within(chart).getAllByRole('button', { name: receiptMark('R-0431') }).length).toBeGreaterThan(0);
    assertInkRules(document.body);
    assertFiguresProved(document.body);
    assertOnePrimary(document.body);
  });

  it('a split proved by another receipt than the spend line it sits under is not drawn', async () => {
    start((method) => method === 'venture.money.overview'
      ? Promise.resolve({ lines: [{ id: 'spent', label: 'AI and tools this month', value: '₹60.10', receiptId: 'R-0499' }] })
      : undefined);
    const tile = await spendTile();
    await waitFor(() => expect(within(tile).getByRole('button', { name: receiptMark('R-0499') })).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(tile).queryByRole('img', { name: /by department/ })).toBeNull();
  });

  it('with no shares from the engine (an engine before 4A2), no split is drawn', async () => {
    start((method, base) => method === 'venture.team.list'
      ? base.request('venture.team.list', {}).then((view): TeamListView => ({
          ...view,
          departments: view.departments?.map((d) => ({ ...d, spendThisMonth: { ...d.spendThisMonth, sharePermille: undefined } })),
        }))
      : undefined);
    const tile = await spendTile();
    await waitFor(() => expect(tile.querySelector('[data-ui-number]')).not.toBeNull());
    expect(within(tile).queryByRole('img', { name: /by department/ })).toBeNull();
  });
});
