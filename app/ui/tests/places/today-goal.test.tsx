import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { NARROW } from '../../src/shell/useNarrow';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient, type GoalSuggestion, type GoalView } from '../../src/engine/types';
import { assertFiguresProved, assertInkRules, assertOnePrimary, receiptMark } from '../helpers/ink-rules';

/*
 * Today's goal card and next best step from the engine (W4 4I2, D-Today `.goal` and `.next`, D-Phone-Today). The goal
 * counts money invoiced this month before tax (founder, 23 Oct). Every amount is the engine's text with its receipt, or
 * "model estimate" for a suggestion the owner asked for; the percents and days left are the engine's own integers.
 */

/** 19:05 in Kolkata on Friday 23 October 2026: day 23 of 31, so 8 days are left. */
const NOW = '2026-10-23T13:35:00.000Z';
const at = () => new Date(2026, 9, 23, 19, 5);

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const settleHash = async () => { await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); }); };

function stubWidth(narrow: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW && narrow, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}
afterEach(() => { vi.restoreAllMocks(); });

type Asked = (method: string, params: unknown) => Promise<unknown>;
type Override = Partial<Record<string, (params: unknown, asked: Asked) => unknown>>;

/** The fake engine's client, with any method answered by `override` and every call listed. */
function client(engine: FakeEngine, override: Override = {}) {
  const fake = createFakeClient(engine);
  const request = fake.request.bind(fake);
  const calls: [string, unknown][] = [];
  const asked: Asked = (method, params) => request(method as never, params as never) as Promise<unknown>;
  const wrapped: EngineClient = {
    ...fake,
    request: (async (method: string, params?: unknown) => {
      calls.push([method, params]);
      const answer = override[method];
      return answer ? answer(params, asked) : asked(method, params);
    }) as EngineClient['request'],
  };
  return { client: wrapped, calls };
}

async function start({ engine = new FakeEngine({ now: () => NOW }), override, folder, narrow = false, language = 'en' }: { engine?: FakeEngine; override?: Override; folder?: string; narrow?: boolean; language?: 'en' | 'hi' } = {}) {
  stubWidth(narrow);
  const made = client(engine, override);
  if (folder) {
    await made.client.request('workspace.lock', {});
    await made.client.request('workspace.open', { folder });
  }
  window.location.hash = '#/today';
  render(<ClockProvider now={at}><App client={made.client} language={language} /></ClockProvider>);
  await settle();
  return made;
}

/** The goals view the fake sends, changed by `change`. */
const changed = (change: (view: GoalView) => GoalView) => async (_params: unknown, asked: Asked) => change(await asked('venture.goals.get', {}) as GoalView);
const goalCard = (name: string) => screen.findByRole('region', { name });

describe('Today: the goal card with a goal set (W4 4I2)', () => {
  it('shows what was invoiced of the goal, the percent, the bar, days left and the foot figures, each with its receipt', async () => {
    const { calls } = await start();
    const goal = await goalCard('October goal');
    await waitFor(() => expect(goal.querySelector('[data-goal-foot]')?.textContent).toContain('₹1,109.67'));
    expect(calls.some(([method]) => method === 'venture.goals.get')).toBe(true);
    expect(goal.querySelector('[data-ui-number]')?.textContent).toBe('₹1,12,400.00');
    expect(goal.textContent).toContain('of');
    expect(goal.textContent).toContain('₹1,50,000.00');
    expect(goal.textContent).toContain('74%');
    expect(goal.textContent).toContain('8 days left');
    const bar = within(goal).getByRole('img');
    expect(bar.getAttribute('aria-label')).toBe("74% of the goal invoiced. Today's pace is 74%.");
    const foot = goal.querySelector<HTMLElement>('[data-goal-foot]')!;
    // How far ahead of today's pace comes from the engine with its receipt: "₹1,109.67 ahead of pace".
    expect(foot.textContent).toMatch(/ahead of pace/i);
    expect(foot.textContent).toContain('Still to invoice');
    expect(foot.textContent).toContain('₹37,600.00');
    expect(foot.textContent).toContain('Received so far');
    expect(within(foot).getByRole('button', { name: receiptMark('R-0402') })).toBeTruthy();
    expect(foot.querySelectorAll('[data-receipt][data-tone="dark"]')).toHaveLength(3);
    // A goal is set, so no suggestion is ever asked for, and nothing reads the pace receipt on its own.
    expect(calls.some(([method]) => method === 'venture.goals.suggest' || method === 'venture.receipt.get')).toBe(false);
    assertFiguresProved(goal);
  });

  it('behind today\'s pace, the foot says "behind pace" with its icon, as ahead has one', async () => {
    await start({ override: { 'venture.goals.get': changed((view) => ({ ...view, pace: 'behind', paceBy: { display: '₹13,406.46', receiptId: 'R-0503' } })) } });
    const goal = await goalCard('October goal');
    await waitFor(() => expect(goal.querySelector('[data-goal-foot]')?.textContent).toContain('₹13,406.46'));
    const foot = goal.querySelector<HTMLElement>('[data-goal-foot]')!;
    expect(foot.textContent).toMatch(/behind pace/i);
    expect(foot.querySelector('[data-trend="behind"] svg')).not.toBeNull();
  });

  it('names the business when Today spans businesses', async () => {
    await start();
    const goal = await goalCard('October goal');
    await waitFor(() => expect(goal.textContent).toContain('Lumen Studio'));
  });

  it('Change the goal opens Business > Goals', async () => {
    await start();
    const goal = await goalCard('October goal');
    await act(async () => { fireEvent.click(within(goal).getByRole('button', { name: 'Change the goal' })); });
    await settleHash();
    expect(window.location.hash).toBe('#/business/goals');
  });

  it('past the goal, the card says how far past with its receipt and the engine\'s percent, never "Goal reached"', async () => {
    await start({
      override: {
        'venture.goals.get': changed((view) => ({
          ...view, invoicedPermille: 1000, readyPermille: 0, invoicedPercent: 118, stillToInvoice: null, past: true, pastBy: { display: '₹27,750.00', receiptId: 'R-0501' },
        })),
      },
    });
    const goal = await goalCard('October goal');
    await waitFor(() => expect(goal.textContent).toContain('118%'));
    const foot = goal.querySelector<HTMLElement>('[data-goal-foot]')!;
    expect(foot.textContent).toContain('Past the goal by');
    expect(within(foot).getByRole('button', { name: receiptMark('R-0501') })).toBeTruthy();
    expect(goal.textContent).not.toContain('Goal reached');
    expect(foot.textContent).not.toContain('Still to invoice');
    expect(within(goal).getByRole('img').getAttribute('aria-label')).toContain('118% of the goal invoiced.');
  });

  it('on the last day it says "Last day", never "0 days left"', async () => {
    await start({ override: { 'venture.goals.get': changed((view) => ({ ...view, daysLeft: 0, lastDay: true })) } });
    const goal = await goalCard('October goal');
    await waitFor(() => expect(goal.textContent).toContain('Last day'));
    expect(goal.textContent).not.toContain('0 days left');
  });
});

describe('Today: no goal for the month yet (spec 8)', () => {
  it('still says what was invoiced this month with its receipt, draws no bar or percent, and asks for a goal', async () => {
    const { calls } = await start({ folder: 'ledgerline' });
    const goal = await goalCard('October goal');
    await waitFor(() => expect(goal.textContent).toContain('No goal for October yet.'));
    expect(goal.querySelector('[data-ui-number]')?.textContent).toBe('₹16,000.00');
    expect(within(goal).queryByRole('img')).toBeNull();
    expect(goal.textContent).not.toContain('%');
    expect(within(goal).queryByRole('button', { name: 'Change the goal' })).toBeNull();
    // No model call without a press: the suggestion waits for "Suggest a goal".
    expect(calls.some(([method]) => method === 'venture.goals.suggest')).toBe(false);
    expect(goal.querySelector('[data-estimate]')).toBeNull();
    await act(async () => { fireEvent.click(within(goal).getByRole('button', { name: 'Set a goal' })); });
    await settleHash();
    expect(window.location.hash).toBe('#/business/goals');
    assertFiguresProved(goal);
  });

  it("Suggest a goal asks the engine once, on the press, and shows its figure as a model estimate with the engine's words", async () => {
    const suggestion: GoalSuggestion = { amountMinor: '20000000', display: '₹2,00,000.00', estimate: true, line: 'A model estimate from your offers and prices. Change it to what you aim for.', typed: '200000.00' };
    const { calls } = await start({
      folder: 'ledgerline',
      override: {
        'venture.goals.get': changed((view) => ({ ...view, lastMonth: { display: '₹48,600.00', receiptId: 'R-0401' } })),
        'venture.goals.suggest': () => suggestion,
      },
    });
    const goal = await goalCard('October goal');
    await waitFor(() => expect(goal.textContent).toContain('₹48,600.00'));
    const last = [...goal.querySelectorAll('[data-figure]')].find((f) => f.textContent?.includes('₹48,600.00'))!;
    expect(within(last as HTMLElement).getByRole('button', { name: receiptMark('R-0401') })).toBeTruthy();
    expect(goal.textContent).toContain('September');
    expect(calls.some(([method]) => method === 'venture.goals.suggest')).toBe(false);
    await act(async () => { fireEvent.click(within(goal).getByRole('button', { name: 'Suggest a goal' })); });
    await settle();
    const suggested = [...goal.querySelectorAll('[data-figure]')].find((f) => f.textContent?.includes('₹2,00,000.00'))!;
    expect(suggested.querySelector('[data-estimate]')?.textContent).toBe('model estimate');
    expect(suggested.querySelector('[data-receipt]')).toBeNull();
    expect(goal.textContent).toContain(suggestion.line);
    expect(calls.filter(([method]) => method === 'venture.goals.suggest')).toEqual([['venture.goals.suggest', { month: '2026-10' }]]);
    assertFiguresProved(goal);
    assertOnePrimary(goal);
  });

  it('when the engine has no suggestion, it says so, and a later press asks again (nothing is kept)', async () => {
    const { calls } = await start({ folder: 'ledgerline', override: { 'venture.goals.suggest': () => null } });
    const goal = await goalCard('October goal');
    await waitFor(() => expect(within(goal).getByRole('button', { name: 'Suggest a goal' })).toBeTruthy());
    await act(async () => { fireEvent.click(within(goal).getByRole('button', { name: 'Suggest a goal' })); });
    await settle();
    expect(goal.textContent).toContain("Chausar can't suggest a goal yet. It needs your AI and a priced offer.");
    await act(async () => { fireEvent.click(within(goal).getByRole('button', { name: 'Suggest a goal' })); });
    await settle();
    expect(calls.filter(([method]) => method === 'venture.goals.suggest')).toHaveLength(2);
  });

  it('when goals cannot be read, the card falls back to the books: what was invoiced and received, and nothing about a goal', async () => {
    await start({ override: { 'venture.goals.get': () => { throw new EngineError('NOT_BUILT_YET', 'Not built yet.'); } } });
    const goal = await goalCard('Invoiced this month');
    await waitFor(() => expect(within(goal).getByRole('button', { name: receiptMark('R-0401') })).toBeTruthy());
    expect(goal.textContent).not.toContain('%');
    expect(within(goal).queryByRole('img')).toBeNull();
  });

  it('with no business open the fake refuses the goals view, as the engine does', async () => {
    const { client: made } = client(new FakeEngine({ now: () => NOW }));
    await made.request('workspace.lock', {});
    await expect(made.request('venture.goals.get', {})).rejects.toBeInstanceOf(EngineError);
  });
});

describe('Today: the next best step (W4 4I2)', () => {
  const tile = () => screen.findByRole('region', { name: 'Sponsor slot price' });

  it("names the engine's first row by money at stake, its figure with a receipt, and the card's own primary, in few words", async () => {
    await start();
    const next = await tile();
    expect(next.textContent).toContain('Next best step');
    expect(next.textContent).toContain('Producer');
    expect(within(next).getByRole('button', { name: receiptMark('R-0415') })).toBeTruthy();
    expect(next.querySelector('[data-ui-number]')?.textContent).toBe('₹30,000.00');
    // The card already says what the row is and that it asks once more: the tile repeats neither.
    expect(next.textContent).not.toContain('The sponsor asked for two mentions in one episode.');
    expect(next.textContent).not.toContain('Asks you once more');
    expect(within(next).getByRole('button', { name: /^Approve/ })).toBeTruthy();
    assertOnePrimary(next);
    assertFiguresProved(next);
    assertInkRules(document.body);
  });

  it("its primary presses the card's own: the second ask opens inside the card and nothing is decided", async () => {
    const { calls } = await start();
    const next = await tile();
    await act(async () => { fireEvent.click(within(next).getByRole('button', { name: /^Approve/ })); });
    await settle();
    const card = screen.getByRole('region', { name: 'Needs you' }).querySelector<HTMLElement>('[data-row-id="q-price-sponsor"]')!;
    const notNow = within(card).getByRole('button', { name: 'Not now' });
    expect(document.activeElement).toBe(notNow);
    expect(calls.some(([method]) => method === 'venture.queue.decide')).toBe(false);
  });

  it('a locked primary stays locked and says why, as on its card', async () => {
    await start({
      override: {
        'venture.goals.get': changed((view) => ({
          ...view, next: { rowId: 'run:d-ep14:review-1', title: 'Episode 14 is cut', agent: 'Editor', line: 'Open it, then choose Approve.', figure: null, goalAfter: null, goalAfterPercent: null },
        })),
      },
    });
    const next = await screen.findByRole('region', { name: 'Episode 14 is cut' });
    const approve = within(next).getByRole('button', { name: /^Approve/ });
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    expect(next.textContent).toContain('Approve unlocks after you watch it');
  });

  it("shows the goal after it from the engine's whole percent", async () => {
    await start({ override: { 'venture.goals.get': changed((view) => ({ ...view, next: { ...view.next!, goalAfter: 'Goal after: 92%', goalAfterPercent: 92 } })) } });
    const next = await tile();
    expect(next.textContent).toContain('Goal after');
    expect(next.textContent).toContain('92%');
    const goal = await goalCard('October goal');
    expect(within(goal).getByRole('img').getAttribute('aria-label')).toBe("74% of the goal invoiced. The next step takes it to 92%. Today's pace is 74%.");
  });

  it('no tile when the engine sends no next step', async () => {
    await start({ engine: new FakeEngine({ now: () => NOW, queue: [] }) });
    await goalCard('October goal');
    expect(screen.queryByText('Next best step')).toBeNull();
  });

  it('on a phone the step folds into the goal card as one line with one primary, and there is no separate tile', async () => {
    const { calls } = await start({ narrow: true });
    const goal = await goalCard('October goal');
    await waitFor(() => expect(goal.querySelector('[data-next-folded]')).not.toBeNull());
    expect(screen.queryByRole('region', { name: 'Sponsor slot price' })).toBeNull();
    const folded = goal.querySelector<HTMLElement>('[data-next-folded]')!;
    expect(folded.textContent).toContain('Next best step');
    expect(folded.textContent).toContain('Sponsor slot price');
    expect(within(folded).getByRole('button', { name: receiptMark('R-0415') })).toBeTruthy();
    assertOnePrimary(goal);
    await act(async () => { fireEvent.click(within(folded).getByRole('button', { name: /^Approve/ })); });
    await settle();
    const card = screen.getByRole('region', { name: 'Needs you' }).querySelector<HTMLElement>('[data-row-id="q-price-sponsor"]')!;
    expect(within(card).getByRole('button', { name: 'Not now' })).toBeTruthy();
    expect(calls.some(([method]) => method === 'venture.queue.decide')).toBe(false);
  });
});

describe('Today: the goal card in Hindi', () => {
  it('words the days left and the reading of the bar in Hindi', async () => {
    await start({ language: 'hi' });
    const goal = await screen.findByRole('region', { name: /लक्ष्य/ });
    await waitFor(() => expect(goal.textContent).toContain('8 दिन बाकी'));
    expect(within(goal).getByRole('img').getAttribute('aria-label')).toMatch(/74%/);
  });
});
