import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { TextProvider } from '../../src/text';
import { FakeEngine, createFakeClient, queueOrder } from '../../src/engine/fake';
import { QUEUE, SETUP_ROWS } from '../../src/engine/fixtures';
import type { BooksSummaryLite, EngineClient, QueueItemView, QueueRow } from '../../src/engine/types';
import { GoalCard } from '../../src/places/today/GoalCard';
import { goalFromBooks, type GoalCardData } from '../../src/places/today/goal';
import { NextStep } from '../../src/places/today/NextStep';
import { greetingKey } from '../../src/places/today/Greeting';
import { assertFiguresProved, assertInkRules, assertOnePrimary, receiptMark } from '../helpers/ink-rules';

/*
 * Today in the direction D look (w3 package 3C, docs/superpowers/designs/ink-v2-direction-d/D-Today.dc.html): the
 * greeting, the goal card (from the goals view since W4 4I2; today-goal.test.tsx), the team at work, needs you as cards with
 * filter chips, Working now and Earlier. Only what the engine sends is drawn.
 */

/** A time on this computer's own clock, built from local parts so every time zone reads the same hour. */
const at = (hour: number, minute = 0) => () => new Date(2026, 9, 23, hour, minute);

interface Start { hash?: string; engine?: FakeEngine; client?: EngineClient; language?: 'en' | 'hi'; now?: () => Date }

function start({ hash = '#/today', engine = new FakeEngine(), client, language = 'en', now = at(19, 5) }: Start = {}) {
  window.location.hash = hash;
  const used = client ?? createFakeClient(engine);
  render(<ClockProvider now={now}><App client={used} language={language} /></ClockProvider>);
  return { engine, client: used };
}

const settleHash = async () => { await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); }); await settleHash(); };
const needsYou = () => screen.getByRole('region', { name: 'Needs you' });
const rowIds = (scope: Element = needsYou()) => [...scope.querySelectorAll('[data-row]')].map((el) => el.getAttribute('data-row-id'));
const cardOf = (id: string) => needsYou().querySelector<HTMLElement>(`[data-row-id="${id}"]`)!;
/** A card's text preview, once its view arrived. */
const previewOf = (id: string) => waitFor(() => {
  const found = needsYou().querySelector<HTMLElement>(`[data-row-id="${id}"] [data-preview="text"]`);
  if (!found) throw new Error(`no text preview on ${id}`);
  return found;
});
/** A locked primary is Button's `locked`: aria-disabled, so it stays in the Tab order and says why. */
const locked = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true' || (button as HTMLButtonElement).disabled;
const ORDER = [...QUEUE].map((r) => ({ ...r, digest: '' }) as QueueRow).sort(queueOrder).map((r) => r.id);
/** The rows' titles as the fold names them. */
const titlesOf = (ids: readonly string[]) => ids.map((id) => QUEUE.find((r) => r.id === id)!.title).join(' · ');

async function loaded() {
  await waitFor(() => expect(rowIds().length).toBeGreaterThan(0));
  await settle();
}

/**
 * The fake engine's client with a hook on its replies: `view` may rewrite what `venture.queue.view` sends, decisions
 * wait until `release()` when `hold` is set, and `calls` lists every method asked with its params.
 */
function wrapped(engine: FakeEngine, { view, hold }: { view?: (view: QueueItemView) => QueueItemView; hold?: boolean } = {}) {
  const fake = createFakeClient(engine);
  const request = fake.request.bind(fake);
  const held: (() => void)[] = [];
  const calls: [string, unknown][] = [];
  const client: EngineClient = {
    ...fake,
    request: (async (method: string, params?: unknown) => {
      calls.push([method, params]);
      if (hold && method === 'venture.queue.decide') await new Promise<void>((resolve) => held.push(resolve));
      const reply = await request(method as never, params as never);
      return method === 'venture.queue.view' && view ? view(reply as unknown as QueueItemView) : reply;
    }) as EngineClient['request'],
  };
  const release = async () => { await act(async () => { held.splice(0).forEach((go) => go()); }); await settle(); };
  return { client, calls, release };
}

/** Open another sample business first, as the business menu does: the open one closes, then that one opens. */
async function opened(folder: string): Promise<{ engine: FakeEngine; client: EngineClient }> {
  const engine = new FakeEngine();
  const client = createFakeClient(engine);
  await client.request('workspace.lock', {});
  await client.request('workspace.open', { folder });
  return { engine, client };
}

/** Resolve a row somewhere else (another window, the run sheet): the engine decides it and says the queue changed. */
async function resolveElsewhere(client: EngineClient, id: string, action: string) {
  const { rows } = await client.request('venture.queue.list', { scope: 'all' });
  const row = rows.find((r) => r.id === id)!;
  await act(async () => { await client.request('venture.queue.decide', { id, digest: row.digest, action: action as never }); });
  await settle();
}

describe('Today v2: the greeting', () => {
  it('says the date in the eyebrow and good evening at 19:05, with no name', async () => {
    start();
    const title = await screen.findByRole('heading', { level: 1, name: 'Good evening' });
    const header = title.closest('header')!;
    expect(header.textContent).toContain('Friday, 23 October');
    expect(title.textContent).toBe('Good evening');
  });

  it('picks the greeting by the hour: morning, afternoon, evening', () => {
    expect([5, 8, 11, 12, 14, 16, 17, 19, 23, 0, 4].map(greetingKey)).toEqual([
      'today.greeting.morning', 'today.greeting.morning', 'today.greeting.morning',
      'today.greeting.afternoon', 'today.greeting.afternoon', 'today.greeting.afternoon',
      'today.greeting.evening', 'today.greeting.evening', 'today.greeting.evening', 'today.greeting.evening', 'today.greeting.evening',
    ]);
  });

  it.each([[8, 'Good morning'], [14, 'Good afternoon'], [19, 'Good evening']] as const)('at %i:00 it says %s', async (hour, words) => {
    start({ now: at(hour) });
    expect(await screen.findByRole('heading', { level: 1, name: words })).toBeTruthy();
  });

  it("the line under it is the engine's summary, then how many agents are working, with the count in bold", async () => {
    start();
    await loaded();
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    await waitFor(() => expect(header.textContent).toContain('13 need you, across 3 businesses. 2 agents are working.'));
    expect(header.querySelector('b')?.textContent).toBe('13');
  });

  it('with nothing waiting, the line only says who is working', async () => {
    start({ engine: new FakeEngine({ queue: [] }) });
    const header = (await screen.findByRole('heading', { level: 1 })).closest('header')!;
    await waitFor(() => expect(header.textContent).toContain('2 agents are working.'));
    expect(header.textContent).not.toContain('need you');
  });
});

describe('Today v2: the goal card', () => {
  it('reads the goal from venture.goals.get (W4 4I2); with no goal set it still says what was invoiced this month with its receipt, and draws no bar', async () => {
    // W3's rule holds with goals: the card draws no goal, bar or percent it does not have. Ledgerline has no goal yet.
    const { client } = await opened('ledgerline');
    const spy = vi.spyOn(client, 'request');
    start({ client });
    const goal = await screen.findByRole('region', { name: 'October goal' });
    await waitFor(() => expect(goal.textContent).toContain('No goal for October yet.'));
    expect(spy.mock.calls.some(([method]) => (method as string) === 'venture.goals.get')).toBe(true);
    expect(goal.querySelector('[data-ui-number]')?.textContent).toBe('₹16,000.00');
    expect(goal.textContent).toContain('Invoiced this month');
    expect(within(goal).getByRole('button', { name: receiptMark('R-0402') })).toBeTruthy();
    expect(within(goal).queryByRole('img')).toBeNull();
    expect(within(goal).queryByRole('button', { name: 'Change the goal' })).toBeNull();
    expect(goal.textContent).not.toContain('%');
    assertFiguresProved(goal);
  });

  const SET: GoalCardData = {
    state: 'set', month: 'October', invoiced: { value: '₹1,18,400', receiptId: 'R-0410' }, goal: { value: '₹1,50,000', receiptId: 'R-0409' },
    percent: '79%', daysLeft: '8 days left',
    bar: { invoicedPermille: 789, readyPermille: 126, pacePermille: 742, label: "79% of the goal invoiced. Issuing INV-0042 takes it to 92%. Today's pace is 74%." },
    ready: { value: '₹18,880', receiptId: 'R-0419' },
    foot: [
      { id: 'pace', label: 'Ahead of pace', amount: { value: '₹7,110', receiptId: 'R-0422' }, trend: 'ahead' },
      { id: 'still', label: 'Still to invoice', amount: { value: '₹31,600', receiptId: 'R-0421' } },
      { id: 'received', label: 'Received so far', amount: { value: '₹86,200', receiptId: 'R-0402' } },
    ],
  };

  it('with a goal: the amount, of the goal, the percent, the bar, its key, three foot figures and Change the goal', () => {
    const edit = vi.fn();
    const { container } = render(<TextProvider language="en"><GoalCard data={SET} onEdit={edit} /></TextProvider>);
    const goal = screen.getByRole('region', { name: 'October goal' });
    expect(goal.querySelector('[data-ui-number]')?.textContent).toBe('₹1,18,400');
    expect(goal.textContent).toContain('of');
    expect(goal.textContent).toContain('₹1,50,000');
    expect(goal.textContent).toContain('79%');
    expect(goal.textContent).toContain('8 days left');
    expect(within(goal).getByRole('img', { name: SET.bar.label })).toBeTruthy();
    expect(goal.textContent).toContain('Ready to issue');
    expect(goal.textContent).toContain("Today's pace");
    const foot = goal.querySelector('[data-goal-foot]')!;
    expect(foot.querySelectorAll('[data-receipt][data-tone="dark"]')).toHaveLength(3);
    expect(foot.textContent).toContain('Ahead of pace');
    fireEvent.click(within(goal).getByRole('button', { name: 'Change the goal' }));
    expect(edit).toHaveBeenCalledTimes(1);
    assertInkRules(container);
  });

  const books = (figures: BooksSummaryLite['figures']): BooksSummaryLite => ({
    currency: 'INR', period: { from: '2026-10-01', to: '2026-10-31' }, figures, openInvoices: [], notes: [],
  });

  it("a figure that changed since its receipt says so in Money's words, under the figure", () => {
    const data = goalFromBooks(books([
      { operation: 'billed', label: 'Billed', receiptId: 'R-0401', display: '₹1,12,400.00', stale: true },
      { operation: 'received', label: 'Received', receiptId: 'R-0402', display: '₹86,200.00', stale: false },
    ]), 'October');
    expect(data.invoiced).toEqual({ value: '₹1,12,400.00', receiptId: 'R-0401', stale: true });
    const { container } = render(<TextProvider language="en"><GoalCard data={data} /></TextProvider>);
    const goal = screen.getByRole('region', { name: 'Invoiced this month' });
    const changed = within(goal).getAllByText('changed since');
    expect(changed).toHaveLength(1);
    expect(goal.querySelector('[data-goal-foot]')!.contains(changed[0]!)).toBe(false);
    assertInkRules(container);
  });

  it('a received figure that changed says so in the foot', () => {
    const data = goalFromBooks(books([
      { operation: 'billed', label: 'Billed', receiptId: 'R-0401', display: '₹1,12,400.00', stale: false },
      { operation: 'received', label: 'Received', receiptId: 'R-0402', display: '₹86,200.00', stale: true },
    ]), 'October');
    render(<TextProvider language="en"><GoalCard data={data} /></TextProvider>);
    const foot = screen.getByRole('region', { name: 'Invoiced this month' }).querySelector('[data-goal-foot]')!;
    expect(foot.textContent).toContain('changed since');
  });

  it('a billed figure without a receipt is left out, and nothing is said in its place', () => {
    const data = goalFromBooks(books([
      { operation: 'billed', label: 'Billed', receiptId: ' ', display: '₹1,12,400.00', stale: false },
      { operation: 'received', label: 'Received', receiptId: 'R-0402', display: '₹86,200.00', stale: false },
    ]), 'October');
    expect(data.invoiced).toBeNull();
    const { container } = render(<TextProvider language="en"><GoalCard data={data} /></TextProvider>);
    const goal = screen.getByRole('region', { name: 'Invoiced this month' });
    expect(goal.textContent).not.toContain('₹1,12,400.00');
    expect(goal.textContent).not.toContain('Nothing invoiced');
    expect(goal.textContent).toContain('Received this month');
    assertInkRules(container);
  });

  it('with no goal set: asks for one with a suggested figure labelled model estimate', () => {
    const set = vi.fn();
    const data: GoalCardData = { state: 'unset', month: 'October', invoiced: { value: '₹1,18,400', receiptId: 'R-0410' }, suggested: '₹1,20,000' };
    const { container } = render(<TextProvider language="en"><GoalCard data={data} onSet={set} /></TextProvider>);
    const goal = screen.getByRole('region', { name: 'October goal' });
    expect(goal.textContent).toContain('No goal for October yet.');
    const suggested = [...goal.querySelectorAll('[data-figure]')].find((f) => f.textContent?.includes('₹1,20,000'))!;
    expect(suggested.querySelector('[data-estimate]')?.textContent).toBe('model estimate');
    expect(suggested.querySelector('[data-receipt]')).toBeNull();
    expect(within(goal).queryByRole('img')).toBeNull();
    fireEvent.click(within(goal).getByRole('button', { name: 'Set a goal' }));
    expect(set).toHaveBeenCalledTimes(1);
    assertInkRules(container);
  });
});

describe('Today v2: the next best step part (shown from the engine in today-goal.test.tsx)', () => {
  it('names the row, its figure with a receipt, the goal after it, and one primary that asks once more', () => {
    const open = vi.fn();
    const go = vi.fn();
    const { container } = render(
      <TextProvider language="en">
        <NextStep
          data={{ rowId: 'q-invoice-mehta', title: 'Issue INV-0042 to Mehta Traders', line: 'Monthly books for September, due in 15 days.', agent: 'Billing', business: 'Ledgerline', total: { value: '₹18,880', receiptId: 'R-0419' }, goalAfter: '92%' }}
          primary={{ label: 'Issue invoice', locked: false, note: undefined, asksAgain: true }}
          onOpen={open}
          onPrimary={go}
        />
      </TextProvider>,
    );
    const next = screen.getByRole('region', { name: 'Issue INV-0042 to Mehta Traders' });
    expect(next.textContent).toContain('Next best step');
    expect(next.textContent).toContain('Billing · Ledgerline');
    expect(within(next).getByRole('button', { name: receiptMark('R-0419') })).toBeTruthy();
    expect(next.textContent).toContain('Goal after');
    expect(next.textContent).toContain('92%');
    expect(next.textContent).toContain('Asks you once more before it goes out');
    fireEvent.click(within(next).getByRole('button', { name: 'Open' }));
    fireEvent.click(within(next).getByRole('button', { name: 'Issue invoice' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);
    expect(next.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    assertInkRules(container);
  });

  it("a locked primary is the card's own: locked, its note says why, and pressing it does nothing", () => {
    const go = vi.fn();
    render(
      <TextProvider language="en">
        <NextStep
          data={{ rowId: 'q-signoff-gst', title: 'GST working for September', agent: 'Bookkeeper', business: 'Ledgerline' }}
          primary={{ label: 'Send to CA', locked: true, note: 'Send to CA unlocks after you read it', asksAgain: false }}
          onOpen={vi.fn()}
          onPrimary={go}
        />
      </TextProvider>,
    );
    const next = screen.getByRole('region', { name: 'GST working for September' });
    const send = within(next).getByRole('button', { name: 'Send to CA' });
    expect(locked(send)).toBe(true);
    const note = within(next).getByText('Send to CA unlocks after you read it').closest('p')!;
    expect(send.getAttribute('aria-describedby')?.split(/\s+/)).toContain(note.id);
    expect(next.textContent).not.toContain('Asks you once more before it goes out');
    fireEvent.click(send);
    expect(go).not.toHaveBeenCalled();
  });
});

describe('Today v2: the team at work', () => {
  const team = () => screen.getByRole('region', { name: 'Team at work' });

  it('counts the agents by state from their runs and lists every agent as a story, needs you first', async () => {
    start();
    await screen.findByRole('region', { name: 'Team at work' });
    // Keeper, the engine's own jobs as code, is on the team too (W4 4A1); departments are today-w4.test.tsx's.
    await waitFor(() => expect(team().textContent).toContain('2 working · 1 needs you · 2 idle'));
    const stories = within(team()).getByRole('list', { name: 'Your agents' });
    await waitFor(() => expect(within(stories).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
      .toEqual(['Chausar, ask anything', 'Producer, needs you', 'Editor, 3 of 5', 'Researcher, working', 'Publisher, idle', 'Keeper, idle', null]));
    const producer = within(stories).getByRole('button', { name: 'Producer, needs you' });
    expect(producer.querySelector('[data-state]')?.getAttribute('data-state')).toBe('waiting');
    // W4 4C2: Chausar leads the stories and opens Chats (chats.test.tsx).
    expect(within(stories).getAllByRole('button')[0]!.getAttribute('aria-label')).toBe('Chausar, ask anything');
    expect(within(stories).getByRole('button', { name: 'Add agent' })).toBeTruthy();
    expect(within(team()).getByRole('link', { name: 'See team' }).getAttribute('href')).toBe('#/team');
  });

  it('a story opens that agent', async () => {
    start();
    const story = await within(await screen.findByRole('region', { name: 'Team at work' })).findByRole('button', { name: 'Editor, 3 of 5' });
    await click(story);
    expect(window.location.hash).toBe('#/today?sheet=agent%3Aeditor');
  });

  it('a live tile per running or waiting run, with its ring and the step it is on', async () => {
    start();
    await screen.findByRole('region', { name: 'Team at work' });
    await waitFor(() => expect(within(team()).getAllByRole('article').map((a) => a.getAttribute('aria-label')))
      .toEqual(['Editor, working', 'Researcher, working', 'Producer, waiting on you']));
    const [editor, researcher, producer] = within(team()).getAllByRole('article');
    expect(within(editor!).getByRole('img', { name: '3 of 5 steps done' })).toBeTruthy();
    expect(within(researcher!).getByRole('img', { name: 'Working, no step count yet' })).toBeTruthy();
    expect(within(producer!).getByRole('img', { name: '2 of 3 steps done, waiting on you' })).toBeTruthy();
    await waitFor(() => expect(editor!.textContent).toContain('Rendering 3 of 6'));
    expect(editor!.textContent).toContain('Cutting shorts from episode 13');
    expect(editor!.textContent).toContain('4m');
    expect(producer!.textContent).toContain('Waiting on you.');
    expect(producer!.querySelector('[data-state]')?.getAttribute('data-state')).toBe('waiting');
    assertOnePrimary(team());
  });

  it('"Answer below" on a waiting tile moves focus to the card that answers it', async () => {
    start();
    await loaded();
    await click(await within(team()).findByRole('button', { name: /^Answer below/ }));
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('q-question-preview');
  });
});

describe('Today v2: needs you', () => {
  it('a heading with the wait count, and filter chips by kind and by business', async () => {
    start();
    await loaded();
    const head = within(needsYou()).getByRole('heading', { level: 2, name: 'Needs you' });
    expect(head.parentElement!.textContent).toContain('13');
    const show = within(needsYou()).getByRole('group', { name: 'Show' });
    for (const name of ['All 13', 'To approve 7', 'Questions 4', 'Setup 2', 'Lumen Studio 7', 'Ledgerline 5', 'Sitara Events, locked 1']) {
      expect(within(show).getByRole('button', { name }), name).toBeTruthy();
    }
    expect(within(show).getAllByRole('button')).toHaveLength(7);
    expect(within(show).getByRole('button', { name: 'All 13' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('Questions shows only the questions and puts show=questions in the address', async () => {
    start();
    await loaded();
    await click(within(needsYou()).getByRole('button', { name: 'Questions 4' }));
    expect(window.location.hash).toBe('#/today?show=questions');
    await waitFor(() => expect(rowIds()).toEqual(['q-question-title', 'q-question-preview', 'q-run-again-thumbs', 'contract:o-iyer-oct:contract-iyer-1']));
    expect(within(needsYou()).getByRole('button', { name: 'Questions 4' }).getAttribute('aria-pressed')).toBe('true');
    await click(within(needsYou()).getByRole('button', { name: 'All 13' }));
    expect(window.location.hash).toBe('#/today');
  });

  it('opens with Setup pressed from #/today?show=setup', async () => {
    start({ hash: '#/today?show=setup' });
    await loaded();
    expect(within(needsYou()).getByRole('button', { name: 'Setup 2' }).getAttribute('aria-pressed')).toBe('true');
    expect(rowIds()).toEqual(['q-setup-ai', 'q-locked-sitara']);
  });

  it('a business chip shows only that business', async () => {
    start();
    await loaded();
    await click(within(needsYou()).getByRole('button', { name: 'Ledgerline 5' }));
    expect(window.location.hash).toBe('#/today?show=business%3Aledgerline');
    await waitFor(() => expect(rowIds()).toEqual(['q-plan', 'q-signoff-gst', 'q-invoice-mehta', 'q-quote-iyer', 'contract:o-iyer-oct:contract-iyer-1']));
  });

  it('draws no business chips when every row is from one business', async () => {
    start({ engine: new FakeEngine({ queue: QUEUE.filter((r) => r.businessId === 'lumen') }) });
    await loaded();
    const show = within(needsYou()).getByRole('group', { name: 'Show' });
    expect(within(show).queryByRole('button', { name: /Lumen Studio/ })).toBeNull();
  });

  it('five full cards in the engine order, then the rest behind "Show 8 more", which reveals them and moves focus', async () => {
    start();
    await loaded();
    const cards = [...needsYou().querySelectorAll('[data-row]')];
    expect(cards.map((c) => c.getAttribute('data-row-id'))).toEqual(ORDER.slice(0, 5));
    expect(cards.map((c) => c.getAttribute('data-layout'))).toEqual(Array(5).fill('card'));
    const more = within(needsYou()).getByRole('button', { name: 'Show 8 more' });
    expect(more.closest('[data-more]')!.textContent).toContain('8 more need you');
    expect(more.closest('[data-more]')!.querySelector('[data-more-line]')!.textContent).toBe(`${titlesOf(ORDER.slice(5, 8))} and 5 more`);
    await click(more);
    expect(rowIds()).toEqual(ORDER);
    expect(document.activeElement?.getAttribute('data-row-id')).toBe(ORDER[5]);
    expect(within(needsYou()).queryByRole('button', { name: 'Show 8 more' })).toBeNull();
    assertOnePrimary(needsYou());
    assertFiguresProved(needsYou());
    assertInkRules(document.body);
  });

  it('the fold counts and names only the rows still waiting: one resolved elsewhere leaves it', async () => {
    const engine = new FakeEngine();
    const client = createFakeClient(engine);
    start({ client });
    await loaded();
    expect(within(needsYou()).getByRole('button', { name: 'Show 8 more' })).toBeTruthy();
    expect(ORDER.slice(5)).toContain('q-run-again-thumbs');
    await resolveElsewhere(client, 'q-run-again-thumbs', 'later');
    const more = await within(needsYou()).findByRole('button', { name: 'Show 7 more' });
    const fold = more.closest<HTMLElement>('[data-more]')!;
    expect(fold.textContent).toContain('7 more need you');
    expect(fold.textContent).not.toContain('Thumbnail set failed');
    const left = ORDER.slice(5).filter((id) => id !== 'q-run-again-thumbs');
    expect(fold.querySelector('[data-more-line]')!.textContent).toBe(`${titlesOf(left.slice(0, 3))} and 4 more`);
  });

  it('draws no fold once nothing behind it waits', async () => {
    const keep = new Set([...ORDER.slice(0, 5), 'q-run-again-thumbs']);
    const client = createFakeClient(new FakeEngine({ queue: QUEUE.filter((r) => keep.has(r.id)) }));
    start({ client });
    await loaded();
    expect(within(needsYou()).getByRole('button', { name: 'Show 1 more' })).toBeTruthy();
    await resolveElsewhere(client, 'q-run-again-thumbs', 'later');
    await waitFor(() => expect(needsYou().querySelector('[data-more]')).toBeNull());
    expect(within(needsYou()).queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
  });

  it('the fold names at most three of what it holds, then how many more', async () => {
    start({ engine: new FakeEngine({ queue: [...QUEUE, ...SETUP_ROWS] }) });
    await loaded();
    const order = [...QUEUE, ...SETUP_ROWS].map((r) => ({ ...r, digest: '' }) as QueueRow).sort(queueOrder);
    const folded = order.slice(5);
    expect(folded).toHaveLength(10);
    const fold = within(needsYou()).getByRole('button', { name: 'Show 10 more' }).closest<HTMLElement>('[data-more]')!;
    expect(fold.querySelector('[data-more-line]')!.textContent).toBe(`${folded.slice(0, 3).map((r) => r.title).join(' · ')} and 7 more`);
  });

  it('a card stays the same card across a filter change: a typed answer and a decision on its way survive', async () => {
    const { client, calls, release } = wrapped(new FakeEngine(), { hold: true });
    start({ client });
    await loaded();
    // Past the first five, the question waits behind the fold; shown, it is a compact card.
    expect(needsYou().querySelector('[data-row-id="q-question-title"]')).toBeNull();
    await click(within(needsYou()).getByRole('button', { name: 'Show 8 more' }));
    const card = cardOf('q-question-title');
    expect(card.getAttribute('data-layout')).toBe('compact');
    await click(within(card).getByRole('button', { name: 'Answer' }));
    fireEvent.change(within(card).getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Option B' } });
    await click(within(needsYou()).getByRole('button', { name: 'Questions 4' }));
    await waitFor(() => expect(rowIds()).toEqual(['q-question-title', 'q-question-preview', 'q-run-again-thumbs', 'contract:o-iyer-oct:contract-iyer-1']));
    expect(cardOf('q-question-title')).toBe(card);
    expect(card.getAttribute('data-layout')).toBe('card');
    expect((within(card).getByRole('textbox', { name: 'Your answer' }) as HTMLInputElement).value).toBe('Option B');

    await click(within(card).getByRole('button', { name: 'Send answer' }));
    const decides = () => calls.filter(([method]) => method === 'venture.queue.decide');
    expect(decides()).toHaveLength(1);
    await click(within(needsYou()).getByRole('button', { name: 'All 13' }));
    await waitFor(() => expect(rowIds()).toEqual(ORDER));
    expect(cardOf('q-question-title')).toBe(card);
    const answer = within(card).getByRole('button', { name: 'Answer' }) as HTMLButtonElement;
    expect(answer.disabled).toBe(true);
    fireEvent.click(answer);
    expect(decides()).toHaveLength(1);
    await release();
    await waitFor(() => expect(cardOf('q-question-title').hasAttribute('data-decided')).toBe(true));
    expect(decides()).toHaveLength(1);
    expect(decides()[0]![1]).toMatchObject({ id: 'q-question-title', action: 'answer', answer: 'Option B' });
  });

  it('says so in one sentence when nothing needs you, with no chips', async () => {
    start({ engine: new FakeEngine({ queue: [] }) });
    expect(await screen.findByText('Nothing needs you.')).toBeTruthy();
    expect(screen.getAllByText('Nothing needs you.')).toHaveLength(1);
    expect(within(needsYou()).queryByRole('group', { name: 'Show' })).toBeNull();
  });

  it('a filter with nothing in it says so and offers everything', async () => {
    start({ hash: '#/today?show=setup', engine: new FakeEngine({ queue: QUEUE.filter((r) => r.kind !== 'setup' && r.kind !== 'locked') }) });
    expect(await within(await screen.findByRole('region', { name: 'Needs you' })).findByText('Nothing here needs you.')).toBeTruthy();
    await click(within(needsYou()).getByRole('button', { name: 'Show everything' }));
    expect(window.location.hash).toBe('#/today');
  });
});

describe('Today v2: previews on the cards', () => {
  it('a draft to watch shows the video frame, "Not watched yet" until it was watched here', async () => {
    start();
    await loaded();
    const draft = cardOf('run:d-ep14:review-1');
    const frame = draft.querySelector('[data-preview="video"]')!;
    expect(frame.textContent).toContain('Not watched yet');
    expect(locked(within(draft).getByRole('button', { name: 'Approve' }))).toBe(true);
    expect(draft.textContent).toContain('Approve unlocks after you watch it');
    // W4 4J19: the frame takes the title the engine's own preview gives it (4J3).
    await click(within(draft).getByRole('button', { name: 'Watch The budget mic that beat the room' }));
    expect(window.location.hash).toBe('#/today?sheet=view%3Adraft%3Adraft-ep14');
    await screen.findByRole('complementary', { name: 'Episode 14' });
    await waitFor(() => expect(locked(within(cardOf('run:d-ep14:review-1')).getByRole('button', { name: 'Approve' }))).toBe(false));
    expect(cardOf('run:d-ep14:review-1').querySelector('[data-preview="video"]')!.textContent).not.toContain('Not watched yet');
  });

  it('drawing a preview does not count as viewed', async () => {
    start();
    await loaded();
    await settle();
    expect(locked(within(cardOf('run:d-ep14:review-1')).getByRole('button', { name: 'Approve' }))).toBe(true);
    expect(locked(within(cardOf('q-signoff-gst')).getByRole('button', { name: 'Send to CA' }))).toBe(true);
    expect(locked(within(cardOf('q-plan')).getByRole('button', { name: 'Accept' }))).toBe(true);
  });

  it('a plan or a file shows its text from the view; a price shows the change with its receipt; nothing to show, no frame', async () => {
    start();
    await loaded();
    await waitFor(() => expect(cardOf('q-plan').querySelector('[data-preview="text"]')?.textContent).toContain('Monthly books'));
    // W4 4J19: sign-off papers come with the engine's own preview (4J3): the working paper and its calculator receipt.
    const paper = cardOf('q-signoff-gst').querySelector('[data-preview="paper"]')!;
    expect(paper.textContent).toContain('GST working for September');
    expect(paper.querySelector('[data-receipt="w-gst-sep"][data-receipt-source="ca"]')).not.toBeNull();
    const price = cardOf('q-price-sponsor');
    expect(price.querySelector('del')?.textContent).toBe('₹25,000');
    expect(within(price).getByRole('button', { name: receiptMark('R-0415') })).toBeTruthy();
    expect(price.querySelector('[data-preview]')).toBeNull();
    expect(cardOf('q-setup-ai').querySelector('[data-preview]')).toBeNull();
    assertFiguresProved(needsYou());
  });

  it("a draft is quoted words; a plan's and a file's text is Chausar's own, on the card and in the sheet", async () => {
    // The post, the plan and the sign-off on their own, so each is one of the five full cards (4Z3) with its text.
    const keep = new Set(['post:linkedin-ep13:v1', 'q-plan', 'q-signoff-gst']);
    start({ engine: new FakeEngine({ queue: QUEUE.filter((r) => keep.has(r.id)) }) });
    await loaded();
    // W4 4J19: the post comes with the engine's own preview (4J3): its exact text is quoted words.
    const post = await waitFor(() => {
      const found = cardOf('post:linkedin-ep13:v1').querySelector<HTMLElement>('[data-preview="post"] [data-content]');
      if (!found) throw new Error('no post preview');
      return found;
    });
    expect(post.textContent).toContain('We tested five budget mics');
    expect(post.closest('[data-engine-line]')).toBeNull();
    const plan = await previewOf('q-plan');
    expect(plan.closest('[data-engine-line]')).toBeTruthy();
    expect(plan.closest('[data-content]')).toBeNull();
    // The sign-off papers' figures carry the calculator's receipt, so they need no engine-line stopgap.
    const file = cardOf('q-signoff-gst').querySelector<HTMLElement>('[data-preview="paper"]')!;
    expect(file.closest('[data-engine-line]')).toBeNull();
    expect(file.closest('[data-content]')).toBeNull();
    await click(within(cardOf('q-plan')).getByRole('button', { name: 'Read' }));
    const sheet = await screen.findByRole('complementary', { name: 'Ledgerline plan' });
    await waitFor(() => expect(sheet.querySelector('[data-engine-line]')).toBeTruthy());
    expect(sheet.querySelector('[data-content]')).toBeNull();
  });

  it('a draft opened in its sheet is quoted words', async () => {
    start({ hash: '#/today?sheet=view%3Adraft%3Apost-linkedin-ep13' });
    const sheet = await screen.findByRole('complementary', { name: 'X post for episode 13' });
    await waitFor(() => expect(sheet.querySelector('ul[data-content]')?.textContent).toContain('We tested five budget mics'));
    expect(sheet.querySelector('ul[data-engine-line]')).toBeNull();
  });

  it('a line the engine marks as a model estimate shows the "model estimate" label, on the card and in the sheet', async () => {
    const view = (v: QueueItemView): QueueItemView => (v.kind !== 'plan' ? v : {
      ...v,
      sections: [{ heading: 'What you sell', lines: ['Monthly books: ₹16,000.00 per month (model estimate)', 'GST working (model estimate): ₹5,000.00 per project.'] }],
    });
    const { client } = wrapped(new FakeEngine(), { view });
    start({ client });
    await loaded();
    const preview = await waitFor(() => {
      const found = cardOf('q-plan').querySelector<HTMLElement>('[data-preview="text"]')!;
      expect(found.textContent).toContain('Monthly books');
      return found;
    });
    const chips = [...preview.querySelectorAll('[data-estimate]')];
    expect(chips.map((chip) => chip.textContent)).toEqual(['model estimate', 'model estimate']);
    expect(preview.textContent).not.toContain('(model estimate)');
    expect(preview.textContent).toContain('Monthly books: ₹16,000.00 per month');
    assertFiguresProved(needsYou());
    await click(within(cardOf('q-plan')).getByRole('button', { name: 'Read' }));
    const sheet = await screen.findByRole('complementary', { name: 'Ledgerline plan' });
    await waitFor(() => expect(sheet.querySelectorAll('[data-estimate]')).toHaveLength(2));
    expect(sheet.textContent).not.toContain('(model estimate)');
  });

  it('a file of a business not registered for tax shows its title and line, and no tax figures', async () => {
    // Lumen Studio is open, and its plan says it does not charge GST. W4 4J19: a sign-off row the engine sent no preview
    // for (here, the sample's under another id) still follows this rule.
    start({ engine: new FakeEngine({ queue: QUEUE.map((row) => (row.id === 'q-signoff-gst' ? { ...row, id: 'q-signoff-plain' } : row)) }) });
    await loaded();
    const preview = await waitFor(() => {
      const found = cardOf('q-signoff-plain').querySelector<HTMLElement>('[data-preview="text"]')!;
      expect(found.textContent).toContain('Mehta Traders, worked by the calculator');
      return found;
    });
    expect(preview.textContent).toContain('GST working for September');
    expect(preview.textContent).not.toMatch(/₹|CGST|SGST|GST on sales/);
  });

  it('a file of a business registered for tax keeps its first three lines, and no more', async () => {
    // Ledgerline is open: its plan says it charges GST. W4 4J19: a sign-off row with no preview of the engine's own.
    const client = createFakeClient(new FakeEngine({ queue: QUEUE.map((row) => (row.id === 'q-signoff-gst' ? { ...row, id: 'q-signoff-plain' } : row)) }));
    await client.request('workspace.lock', {});
    await client.request('workspace.open', { folder: 'ledgerline' });
    start({ client });
    await loaded();
    const preview = await waitFor(() => {
      const found = cardOf('q-signoff-plain').querySelector<HTMLElement>('[data-preview="text"]')!;
      expect(found.textContent).toContain('GST on sales');
      return found;
    });
    for (const line of ['Taxable value ₹16,000.00 (R-0419)', 'CGST at 9% ₹1,440.00 (R-0419)', 'SGST at 9% ₹1,440.00 (R-0419)']) {
      expect(preview.textContent).toContain(line);
    }
    expect(preview.textContent).not.toContain('Checks');
    expect(preview.textContent).not.toContain('The sales register matches the invoices issued');
  });

  it('the draft card: Watch opens it, and once the sheet is closed Approve is unlocked', async () => {
    start();
    await loaded();
    await click(within(cardOf('run:d-ep14:review-1')).getByRole('button', { name: 'Watch' }));
    const sheet = await screen.findByRole('complementary', { name: 'Episode 14' });
    await click(within(sheet).getByRole('button', { name: /^Close/ }));
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(locked(within(cardOf('run:d-ep14:review-1')).getByRole('button', { name: 'Approve' }))).toBe(false);
  });

  it('the price card asks once more inside the card, decides once with its digest, and shrinks to its receipt line', async () => {
    const { client } = start();
    await loaded();
    const spy = vi.spyOn(client, 'request');
    const price = cardOf('q-price-sponsor');
    await click(within(price).getByRole('button', { name: 'Approve' }));
    expect(price.textContent).toContain("This can't be undone. Approve?");
    expect(spy.mock.calls.some(([m]) => m === 'venture.queue.decide')).toBe(false);
    await click(within(price).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(cardOf('q-price-sponsor').hasAttribute('data-decided')).toBe(true));
    const decides = spy.mock.calls.filter(([m]) => m === 'venture.queue.decide');
    expect(decides).toHaveLength(1);
    expect(decides[0]![1]).toMatchObject({ id: 'q-price-sponsor', action: 'approve' });
    expect((decides[0]![1] as { digest: string }).digest).toBeTruthy();
    const status = within(cardOf('q-price-sponsor')).getByRole('status');
    expect(status.textContent!.trim()).toBe('Sponsor slot price · Approved');
    expect(within(status).getByRole('button', { name: receiptMark('R-0421') })).toBeTruthy();
  });
});

describe('Today v2: working now and earlier', () => {
  const working = () => screen.getByRole('region', { name: 'Working now' });
  const rowOf = (id: string) => working().querySelector<HTMLElement>(`[data-row-id="${id}"]`)!;

  it('a row per running or waiting run, and a stopped run that can run again, each with its step and progress', async () => {
    start();
    await screen.findByRole('region', { name: 'Working now' });
    await waitFor(() => expect(rowIds(working())).toEqual(['run-31', 'run-30', 'run-29', 'run-28']));
    await waitFor(() => expect(rowOf('run-31').textContent).toContain('Rendering 3 of 6'));
    const editor = rowOf('run-31');
    expect(editor.textContent).toContain('Editor');
    expect(editor.textContent).toContain('3 of 5');
    expect(editor.textContent).toContain('4m');
    expect(editor.querySelector('[data-state]')?.getAttribute('data-state')).toBe('working');
    await waitFor(() => expect(rowOf('run-30').textContent).toContain('Step 2'));
    const waiting = rowOf('run-29');
    expect(waiting.textContent).toContain('Waiting on you');
    expect(waiting.textContent).not.toContain('6m');
    // 4Z2: a known failure in plain words; the tool's own line is on the run's sheet.
    await waitFor(() => expect(rowOf('run-28').textContent).toContain("The video tool isn't installed on this computer yet."));
    const stopped = rowOf('run-28');
    // An engine-failed run is "Failed"; "Stopped" is kept for the owner's own Stop (W4 4F).
    expect(stopped.textContent).toContain('Failed');
    expect(stopped.querySelector('[data-state]')?.getAttribute('data-state')).toBe('failed');
    expect(working().textContent).toContain('3 running · 1 failed');
    expect(within(working()).getByRole('link', { name: 'Open Work' }).getAttribute('href')).toBe('#/work');
  });

  it('the purpose opens the run sheet', async () => {
    start();
    await click(await within(await screen.findByRole('region', { name: 'Working now' })).findByRole('button', { name: 'Rendering the thumbnail set' }));
    expect(window.location.hash).toBe('#/today?sheet=run%3A28');
  });

  it('Earlier lists the latest journal lines with their receipts, and an unknown outcome says Check it', async () => {
    start();
    const earlier = await screen.findByRole('region', { name: 'Earlier' });
    await waitFor(() => expect(within(earlier).getAllByRole('listitem')).toHaveLength(5));
    expect(earlier.textContent).toContain('Recorded ₹86,200.00');
    expect(within(earlier).getByRole('button', { name: receiptMark('R-0402') })).toBeTruthy();
    expect(within(earlier).getByRole('button', { name: receiptMark('R-0420') })).toBeTruthy();
    const check = within(earlier).getByRole('link', { name: 'Check it' });
    expect(check.getAttribute('href')).toBe('#/money/journal');
    expect(check.closest('li')!.textContent).toContain('The send timed out.');
    expect(within(earlier).getByRole('link', { name: 'Open the journal' }).getAttribute('href')).toBe('#/money/journal');
    assertFiguresProved(earlier);
  });

  it("a journal line without a receipt is the engine's own words; one with a receipt sits with it", async () => {
    start();
    const earlier = await screen.findByRole('region', { name: 'Earlier' });
    await waitFor(() => expect(within(earlier).getAllByRole('listitem')).toHaveLength(5));
    const itemOf = (words: string) => within(earlier).getByText(words);
    for (const words of ['Waiting for your approval', 'You said no', 'The send timed out.']) {
      expect(itemOf(words).closest('[data-engine-line]'), words).toBeTruthy();
    }
    for (const words of ['Approved, held for one hour', 'Recorded ₹86,200.00']) {
      expect(itemOf(words).closest('[data-engine-line]'), words).toBeNull();
      expect(itemOf(words).closest('[data-figure-group]'), words).toBeTruthy();
    }
  });

  it("each run's detail is read once for the page: the team's live tiles and Working now share it", async () => {
    const { client, calls } = wrapped(new FakeEngine());
    start({ client });
    await waitFor(() => expect(rowOf('run-31')?.textContent).toContain('Rendering 3 of 6'));
    await waitFor(() => expect(rowOf('run-28')?.textContent).toContain("The video tool isn't installed on this computer yet."));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Team at work' })).getAllByRole('article')[0]!.textContent).toContain('Rendering 3 of 6'));
    await settle();
    const asked = calls.filter(([method]) => method === 'venture.runs.get').map(([, params]) => (params as { runId: string }).runId);
    expect([...asked].sort()).toEqual(['28', '29', '30', '31']);
  });

  it('the whole page keeps the Ink rules', async () => {
    start();
    await loaded();
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Earlier' })).getAllByRole('listitem')).toHaveLength(5));
    await waitFor(() => expect(screen.getByRole('region', { name: 'October goal' }).querySelector('[data-ui-number]')).toBeTruthy());
    await settle();
    assertInkRules(document.body);
  });
});

describe('Today v2 in Hindi', () => {
  it('shows no key as text', async () => {
    start({ language: 'hi' });
    await waitFor(() => expect(document.querySelectorAll('[data-row]').length).toBeGreaterThan(0));
    await settle();
    const main = screen.getByRole('main');
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const keys: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      if (/^[a-z]+(\.[a-zA-Z0-9]+)+$/.test(text)) keys.push(text);
    }
    for (const el of main.querySelectorAll('[aria-label]')) {
      const label = el.getAttribute('aria-label') ?? '';
      if (/^[a-z]+(\.[a-zA-Z0-9]+)+$/.test(label)) keys.push(label);
    }
    expect(keys).toEqual([]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('शुभ संध्या');
  });
});
