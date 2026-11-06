import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient, type GoalSuggestion, type GoalView } from '../../src/engine/types';
import { assertFiguresProved, assertInkRules, assertOnePrimary, receiptMark } from '../helpers/ink-rules';

/*
 * Business > Goals (W4 4I2): set a month's goal, money invoiced in the month before tax (founder, 23 Oct), see the one
 * in use with its receipt and the bar, and the goals of the months before. The goal goes to venture.goals.set as typed;
 * the engine reads it in the business's currency, checks it and keeps it. The UI converts nothing.
 */

const NOW = '2026-10-23T13:35:00.000Z';
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

type Override = Partial<Record<string, (params: unknown, asked: (method: string, params: unknown) => Promise<unknown>) => unknown>>;

async function start({ override = {}, folder }: { override?: Override; folder?: string } = {}) {
  const fake = createFakeClient(new FakeEngine({ now: () => NOW }));
  const request = fake.request.bind(fake);
  const calls: [string, unknown][] = [];
  const asked = (method: string, params: unknown) => request(method as never, params as never) as Promise<unknown>;
  const client: EngineClient = {
    ...fake,
    request: (async (method: string, params?: unknown) => {
      calls.push([method, params]);
      const answer = override[method];
      return answer ? answer(params, asked) : asked(method, params);
    }) as EngineClient['request'],
  };
  if (folder) {
    await client.request('workspace.lock', {});
    await client.request('workspace.open', { folder });
  }
  window.location.hash = '#/business/goals';
  render(<App client={client} language="en" />);
  await settle();
  return { client, calls };
}

const tile = (name: string) => screen.findByRole('region', { name });

describe('Business > Goals', () => {
  it('is a page of its own in the business pages, after Prices', async () => {
    await start();
    const nav = screen.getByRole('navigation', { name: 'Business pages' });
    const links = within(nav).getAllByRole('link').map((link) => link.textContent);
    expect(links.indexOf('Goals')).toBe(links.indexOf('Prices') + 1);
    expect(within(nav).getByRole('link', { name: 'Goals' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 1, name: 'Goals' })).toBeTruthy();
  });

  it("shows this month's goal in use with its receipt, what was invoiced toward it and the bar", async () => {
    await start();
    const goal = await tile('October 2026 goal');
    await waitFor(() => expect(goal.textContent).toContain('₹1,50,000.00'));
    expect(goal.textContent).toContain('₹1,12,400.00');
    expect(goal.textContent).toContain('74%');
    expect(within(goal).getByRole('img').getAttribute('aria-label')).toBe("74% of the goal invoiced. Today's pace is 74%.");
    // A goal is set: no suggestion is offered, and none is ever asked for.
    expect(within(goal).queryByRole('button', { name: 'Suggest a goal' })).toBeNull();
    assertFiguresProved(goal);
    assertOnePrimary(goal);
    assertInkRules(document.body);
  });

  it('sets a goal for a later month, sent as typed for the engine to read', async () => {
    const { calls } = await start();
    const goal = await tile('October 2026 goal');
    await act(async () => { fireEvent.change(within(goal).getByLabelText('Month'), { target: { value: '2026-11' } }); });
    await settle();
    const next = await tile('November 2026 goal');
    expect(next.textContent).toContain('No goal for November 2026 yet.');
    fireEvent.change(within(next).getByLabelText('Goal amount'), { target: { value: '2,00,000.5' } });
    await act(async () => { fireEvent.click(within(next).getByRole('button', { name: 'Set the goal' })); });
    await settle();
    expect(calls).toContainEqual(['venture.goals.set', { month: '2026-11', amount: '2,00,000.5' }]);
    await waitFor(() => expect(next.textContent).toContain('₹2,00,000.50'));
    expect(within(next).getByRole('status').textContent).toBe('Goal set for November 2026.');
  });

  it('an amount the engine cannot read is asked again in words, and no goal is kept; an empty field sends nothing', async () => {
    const { calls } = await start();
    const goal = await tile('October 2026 goal');
    fireEvent.change(within(goal).getByLabelText('Goal amount'), { target: { value: '' } });
    await act(async () => { fireEvent.click(within(goal).getByRole('button', { name: 'Change the goal' })); });
    expect(within(goal).getByRole('alert').textContent).toBe('Type the goal like 150000 or 150000.50.');
    expect(calls.some(([method]) => method === 'venture.goals.set')).toBe(false);
    for (const typed of ['abc', '0', '12.345']) {
      fireEvent.change(within(goal).getByLabelText('Goal amount'), { target: { value: typed } });
      await act(async () => { fireEvent.click(within(goal).getByRole('button', { name: 'Change the goal' })); });
      await settle();
      expect(calls).toContainEqual(['venture.goals.set', { month: '2026-10', amount: typed }]);
      expect(within(goal).getByRole('alert').textContent).toBe('Type the goal like 150000 or 150000.50.');
    }
    expect(goal.textContent).toContain('₹1,50,000.00');
  });

  it("the engine's refusals are worded here: a month that is over", async () => {
    await start({ override: { 'venture.goals.set': () => { throw new EngineError('GOAL_MONTH_PAST', 'September 2026 is over. Choose this month or a later one.'); } } });
    const goal = await tile('October 2026 goal');
    fireEvent.change(within(goal).getByLabelText('Goal amount'), { target: { value: '150000' } });
    await act(async () => { fireEvent.click(within(goal).getByRole('button', { name: 'Change the goal' })); });
    await settle();
    expect(within(goal).getByRole('alert').textContent).toBe('That month is over. Choose this month or a later one.');
  });

  it('with no goal, Suggest a goal asks the engine on the press; its figure is a model estimate with its words; Use this types it for the engine to read', async () => {
    const suggestion: GoalSuggestion = { amountMinor: '20000000', display: '₹2,00,000.00', estimate: true, line: 'A model estimate from your offers and prices. Change it to what you aim for.', typed: '200000.00' };
    const { calls } = await start({ folder: 'ledgerline', override: { 'venture.goals.suggest': () => suggestion } });
    const goal = await tile('October 2026 goal');
    await waitFor(() => expect(within(goal).getByRole('button', { name: 'Suggest a goal' })).toBeTruthy());
    expect(calls.some(([method]) => method === 'venture.goals.suggest')).toBe(false);
    await act(async () => { fireEvent.click(within(goal).getByRole('button', { name: 'Suggest a goal' })); });
    await settle();
    const suggested = [...goal.querySelectorAll('[data-figure]')].find((f) => f.textContent?.includes('₹2,00,000.00'))!;
    expect(suggested.querySelector('[data-estimate]')?.textContent).toBe('model estimate');
    expect(goal.textContent).toContain(suggestion.line);
    await act(async () => { fireEvent.click(within(goal).getByRole('button', { name: 'Use this' })); });
    expect((within(goal).getByLabelText('Goal amount') as HTMLInputElement).value).toBe('200000.00');
    expect(calls.some(([method]) => method === 'venture.goals.set')).toBe(false);
    await act(async () => { fireEvent.click(within(goal).getByRole('button', { name: 'Set the goal' })); });
    await settle();
    expect(calls).toContainEqual(['venture.goals.set', { month: '2026-10', amount: '200000.00' }]);
  });

  it('a null suggestion says why, and pressing again asks again', async () => {
    const { calls } = await start({ folder: 'ledgerline', override: { 'venture.goals.suggest': () => null } });
    const goal = await tile('October 2026 goal');
    await waitFor(() => expect(within(goal).getByRole('button', { name: 'Suggest a goal' })).toBeTruthy());
    for (let i = 0; i < 2; i++) {
      await act(async () => { fireEvent.click(within(goal).getByRole('button', { name: 'Suggest a goal' })); });
      await settle();
    }
    expect(goal.textContent).toContain("Chausar can't suggest a goal yet. It needs your AI and a priced offer.");
    expect(calls.filter(([method]) => method === 'venture.goals.suggest')).toHaveLength(2);
  });

  it('past the goal, the month says how far past with its receipt, never "Goal reached"', async () => {
    await start({
      override: {
        'venture.goals.get': async (params, asked) => ({
          ...(await asked('venture.goals.get', params) as GoalView), invoicedPermille: 1000, invoicedPercent: 118, stillToInvoice: null, past: true, pastBy: { display: '₹27,750.00', receiptId: 'R-0501' },
        }),
      },
    });
    const goal = await tile('October 2026 goal');
    await waitFor(() => expect(goal.textContent).toContain('118%'));
    expect(goal.textContent).toContain('Past the goal by');
    expect(within(goal).getByRole('button', { name: receiptMark('R-0501') })).toBeTruthy();
    expect(goal.textContent).not.toContain('Goal reached');
  });

  it('lists the goals of the months before, each with its receipt and how far it got', async () => {
    const september = (view: GoalView): GoalView => ({
      ...view, month: '2026-09', state: 'set', goal: { display: '₹1,00,000.00', receiptId: 'R-0501' },
      invoiced: { display: '₹1,20,000.00', receiptId: 'R-0502' }, invoicedPermille: 1000, readyPermille: 0, stillToInvoice: null, pace: null, paceReceiptId: null, next: null, briefing: null,
      invoicedPercent: 120, past: true, pastBy: { display: '₹20,000.00', receiptId: 'R-0501' }, paceBy: null,
    });
    await start({
      override: {
        'venture.goals.get': async (params, asked) => {
          const view = await asked('venture.goals.get', params) as GoalView;
          return (params as { month?: string }).month === '2026-09' ? september(view) : view;
        },
      },
    });
    const earlier = await tile('Earlier goals');
    await waitFor(() => expect(earlier.textContent).toContain('September 2026'));
    expect(within(earlier).getByRole('button', { name: receiptMark('R-0501') })).toBeTruthy();
    expect(within(earlier).getByRole('button', { name: receiptMark('R-0502') })).toBeTruthy();
    expect(earlier.textContent).toContain('120%');
    expect(earlier.textContent).not.toContain('Goal reached');
    expect(earlier.textContent).not.toContain('August 2026');
    assertFiguresProved(earlier);
  });

  it('says so when no month before had a goal', async () => {
    await start();
    const earlier = await tile('Earlier goals');
    await waitFor(() => expect(earlier.textContent).toContain('No goals in the three months before.'));
  });
});
