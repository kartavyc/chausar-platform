import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { RulesListView } from '../../src/engine/types';
import type { Language } from '../../src/text';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * Ink v2 wave 5, package 5A3 on screen. Work > Ideas (P13): the idea pipeline on 4J18's ideas list, one column per
 * stage from Inbox to Published, each idea with where it came from and one next step (Move to the next stage); other
 * moves and Drop one step away, a drop asking why in one sentence; a published idea asks for its grade from its
 * seventh day, and Today's grade card leads here. Business > Plan and playbook (P6): a kit playbook's recipes, with
 * their steps one fold away, and the measurement-boundaries table. Refusals are worded from the engine's codes.
 */

type Fake = ReturnType<typeof createFakeClient>;
/** The sample's ideas are made on the first day the fake is asked: its published idea went out three days before. */
const DAY = '2026-10-23T10:00:00.000Z';
/** Five days later: that idea's seven days are over, so its grade is due. */
const LATER = '2026-10-28T10:00:00.000Z';

/** A kit playbook's rules list as the engine sends it (platform/runtime/venture/playbooks/rules-view.ts rulesListOf). */
const KIT_RULES: RulesListView = {
  playbook: { id: 'kit-sample', label: 'Kit sample', riskLevel: 'low', lastReviewed: '2026-10-27' },
  rules: [], summary: 'This playbook rests on no dated platform rules.',
  recipes: [{
    id: 'traffic-drop', name: 'Find why traffic dropped', whenToUse: 'When clicks fell by a lot in one week.',
    steps: [
      { do: 'Compare the last 28 days with the 28 before.', why: 'A week is too short to tell a drop from a holiday.' },
      { do: 'Split by page, then by search words.', why: 'One page often explains most of the drop.' },
    ],
    howToRead: 'A drop on one page is a page problem; a drop on every page is a site or season problem.',
    mistakes: ['Blaming an update without dates that match.', 'Comparing a holiday week with a normal one.'],
  }],
  boundaries: [{ evidence: 'A JSON-LD block parsed', canSay: 'The page carries structured data a parser can read.', cannotSay: 'The page is eligible for rich results.' }],
};

function start({ hash = '#/work?state=ideas', language = 'en', stub }: { hash?: string; language?: Language; stub?: (method: string) => unknown } = {}) {
  window.location.hash = hash;
  let now = DAY;
  const client = createFakeClient(new FakeEngine({ now: () => now }));
  const request = client.request.bind(client);
  const spy = vi.fn(async (method: string, params?: unknown) => {
    const stubbed = stub?.(method);
    return stubbed === undefined ? request(method as never, params as never) : stubbed;
  });
  client.request = spy as unknown as Fake['request'];
  render(<ClockProvider now={() => new Date(now)}><App client={client} language={language} /></ClockProvider>);
  return { spy, setNow: (iso: string) => { now = iso; } };
}

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); }); await settle(); };
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);
const column = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name}`) });
const card = (text: string) => screen.getByRole('article', { name: text });

describe('Work > Ideas (5A3, P13)', () => {
  it('shows the pipeline one column per stage, each idea with where it came from and one next step', async () => {
    start();
    expect(await screen.findByRole('heading', { level: 2, name: 'Ideas' })).toBeTruthy();
    for (const stage of ['Inbox', 'Triage', 'Drafted', 'Made', 'Published']) expect(column(stage)).toBeTruthy();
    const inbox = card('A behind-the-scenes short of a recording day');
    expect(within(column('Inbox')).getByRole('article')).toBe(inbox);
    expect(inbox.textContent).toContain('From: My own idea');
    expect(inbox.querySelector('[data-drops]')!.textContent).toBe('Drops on 21 Jan 2027 if it does not move.');
    expect(within(inbox).getAllByRole('button').filter((b) => b.getAttribute('data-variant') === 'primary').map((b) => b.textContent)).toEqual(['Move to Triage']);
    const agent = card('Three mistakes new channels make with thumbnails');
    // 5A3 review: the role's name from the team, never its id.
    await waitFor(() => expect(agent.textContent).toContain('Suggested by Researcher'));
    expect(screen.getByText('Ideas only move forward, and may skip a stage. One left in Inbox or Triage for 90 days drops off.')).toBeTruthy();
    const published = card('A reel on how we price a 30-minute video');
    expect(published.textContent).toContain('Grade it from 27 Oct 2026.');
    expect(within(published).queryByRole('group', { name: 'How did it do?' })).toBeNull();
    expect(within(column('Drafted')).getByText('Nothing here.')).toBeTruthy();
    const chips = screen.getByRole('group', { name: 'Show' });
    expect(within(chips).getByRole('button', { name: 'Ideas' }).getAttribute('aria-pressed')).toBe('true');
    assertInkRules();
  });

  it('moves an idea forward with its one primary, and further or to Dropped one step away', async () => {
    const { spy } = start();
    await screen.findByRole('heading', { level: 2, name: 'Ideas' });
    const inbox = card('A behind-the-scenes short of a recording day');
    await press(within(inbox).getByRole('button', { name: 'Move to Triage' }));
    expect(calls(spy, 'venture.ideas.move')[0]).toEqual({ id: 'idea_sample_3', stage: 'triage' });
    expect(document.querySelector('[data-said]')!.textContent).toBe('Moved to Triage.');
    await waitFor(() => expect(within(column('Triage')).getAllByRole('article')).toHaveLength(2));
    const moved = card('A behind-the-scenes short of a recording day');
    moved.querySelector('details')!.open = true;
    await press(within(moved).getByRole('button', { name: 'Move to Made' }));
    expect(calls(spy, 'venture.ideas.move')[1]).toEqual({ id: 'idea_sample_3', stage: 'made' });
    await waitFor(() => expect(within(column('Made')).getAllByRole('article')).toHaveLength(1));
  });

  it('a drop asks why in one sentence; two sentences are refused in the screen\'s words, one drops it to the fold', async () => {
    const { spy } = start();
    await screen.findByRole('heading', { level: 2, name: 'Ideas' });
    const idea = card('Three mistakes new channels make with thumbnails');
    idea.querySelector('details')!.open = true;
    const form = within(idea).getByRole('form', { name: 'Drop' });
    fireEvent.change(within(form).getByLabelText('Why, in one sentence'), { target: { value: 'We did one last month. The client left.' } });
    await press(within(form).getByRole('button', { name: 'Drop it' }));
    expect(screen.getByRole('alert').textContent).toBe('Say in one sentence why you are dropping it.');
    fireEvent.change(within(form).getByLabelText('Why, in one sentence'), { target: { value: 'We made one like it last month.' } });
    await press(within(form).getByRole('button', { name: 'Drop it' }));
    expect(calls(spy, 'venture.ideas.move').at(-1)).toEqual({ id: 'idea_sample_2', stage: 'dropped', reason: 'We made one like it last month.' });
    await waitFor(() => expect(screen.getByText('Dropped (1)')).toBeTruthy());
    const fold = document.querySelector('details[data-fold="dropped"]') as HTMLDetailsElement;
    expect(fold.textContent).toContain('We made one like it last month.');
  });

  it('adds an idea to Inbox from the form', async () => {
    const { spy } = start();
    await screen.findByRole('heading', { level: 2, name: 'Ideas' });
    await press(screen.getByRole('button', { name: 'Add an idea' }));
    const form = screen.getByRole('form', { name: 'Add an idea' });
    fireEvent.change(within(form).getByLabelText('The idea'), { target: { value: 'A short on our editing desk' } });
    fireEvent.change(within(form).getByLabelText('Where it came from'), { target: { value: 'A comment on the last video' } });
    await press(within(form).getByRole('button', { name: 'Add to Inbox' }));
    expect(calls(spy, 'venture.ideas.add')).toEqual([{ text: 'A short on our editing desk', source: 'A comment on the last video' }]);
    expect(document.querySelector('[data-said]')!.textContent).toBe('Added to Inbox.');
    await waitFor(() => expect(within(column('Inbox')).getAllByRole('article')).toHaveLength(2));
    expect(screen.queryByRole('form', { name: 'Add an idea' })).toBeNull();
  });

  it('seven days after Published, Today has one grade card that leads to Ideas, where the grade is given', async () => {
    const { spy, setNow } = start({ hash: '#/today' });
    await screen.findByRole('heading', { level: 1 });
    await settle();
    setNow(LATER);
    // The day moves on; back on Today its rows are listed again, and the grade card is brought into view by its subject (?row=).
    await act(async () => { window.location.hash = '#/money'; });
    await settle();
    await act(async () => { window.location.hash = '#/today?row=idea-grade:idea_sample_1'; });
    await settle();
    const rows = (await spy.mock.results[spy.mock.calls.map(([m]) => m).lastIndexOf('venture.queue.list')]!.value) as { rows: { notice?: { probe: string } }[] };
    expect(rows.rows.filter((item) => item.notice?.probe === 'idea')).toHaveLength(1);
    const title = await screen.findByText('How did "A reel on how we price a 30-minute video" do?');
    const row = title.closest('[data-row-id]') as HTMLElement;
    await press(within(row).getByRole('button', { name: 'Grade it' }));
    await waitFor(() => expect(window.location.hash).toBe('#/work?state=ideas'));
    const published = await screen.findByRole('article', { name: 'A reel on how we price a 30-minute video' });
    const ask = within(published).getByRole('group', { name: 'How did it do?' });
    expect(within(ask).getAllByRole('button').map((b) => b.textContent)).toEqual(['Worked', 'So-so', 'Did not']);
    await press(within(ask).getByRole('button', { name: 'So-so' }));
    expect(calls(spy, 'venture.ideas.grade')).toEqual([{ id: 'idea_sample_1', grade: 'so-so' }]);
    await waitFor(() => expect(card('A reel on how we price a 30-minute video').querySelector('[data-graded]')!.textContent).toBe('Graded: So-so'));
  });

  it('reads in Hindi', async () => {
    start({ language: 'hi' });
    expect(await screen.findByRole('heading', { level: 2, name: 'आइडिया' })).toBeTruthy();
    expect(column('इनबॉक्स')).toBeTruthy();
    expect(within(card('A behind-the-scenes short of a recording day')).getByRole('button', { name: 'छँटाई में ले जाएँ' })).toBeTruthy();
  });
});

describe('Work > Ideas edge cases and the order card\'s manual path (5A3 review)', () => {
  it('with only dropped ideas left, it says none are in progress rather than "No ideas yet"', async () => {
    const dropped = (id: string, text: string) => ({
      id, text, source: 'My own idea', by: 'owner', role: null, stage: 'dropped', addedOn: '2026-10-01', movedOn: '2026-10-02', next: [],
      dropReason: 'Too close to the last reel.', expired: false, dropsOn: null, publishedOn: null, gradeFrom: null, gradeDue: false, grade: null,
    });
    start({ stub: (method) => (method === 'venture.ideas.list' ? { ideas: [], waiting: [], pipeline: [dropped('idea_a', 'An old reel idea')] } : undefined) });
    expect(await screen.findByText('Nothing in progress. Add an idea when it comes to you.')).toBeTruthy();
    expect(screen.queryByText('No ideas yet. Add one when it comes to you.')).toBeNull();
    expect(screen.getByText('Dropped (1)')).toBeTruthy();
  });

  it('the order card shows each stage that waits on a planned connector, with its manual path and who it waits on', async () => {
    const chain = {
      orderId: 'o-boat-12', playbook: 'kit-sample', offerKey: 'voice-pack', stage: 1, of: 2, line: 'Stage 1 of 2', state: 'running', since: null, note: null,
      stages: [
        { n: 1, stepId: 'voice', title: 'Write the voice sheet', produces: 'Voice sheet', state: 'now', manualPath: null },
        { n: 2, stepId: 'calendar', title: 'Write the calendar', produces: 'Calendar', state: 'not-started',
          manualPath: { step: 'calendar', connector: 'A scheduler', waitsOn: 'The scheduler app review.', line: 'Until then: import the calendar file into your scheduler.' } },
      ],
    };
    start({ hash: '#/work?order=o-boat-12', stub: (method) => (method === 'venture.order.chain' ? chain : undefined) });
    const tile = await screen.findByRole('region', { name: 'Done by hand for now' });
    const item = within(tile).getByText('Write the calendar').closest('li')!;
    expect(item.textContent).toContain('Until then: import the calendar file into your scheduler.');
    expect(item.textContent).toContain('A scheduler waits on: The scheduler app review.');
    expect(within(tile).queryByText('Write the voice sheet')).toBeNull();
    assertInkRules();
  });

  it('a flagship order, whose offer runs no kit stages, shows no manual path tile', async () => {
    start({ hash: '#/work?order=o-boat-12' });
    await screen.findByRole('heading', { level: 2, name: /order/i });
    await settle();
    expect(screen.queryByRole('region', { name: 'Done by hand for now' })).toBeNull();
  });
});

describe('Business > Plan and playbook: recipes and boundaries (5A3, P6)', () => {
  it('shows each recipe with when to use it, its steps with why one fold away, and the boundaries table', async () => {
    start({ hash: '#/business/plan', stub: (method) => (method === 'venture.rules.list' ? KIT_RULES : undefined) });
    const recipe = await screen.findByRole('article', { name: 'Find why traffic dropped' });
    expect(recipe.textContent).toContain('When to use it: When clicks fell by a lot in one week.');
    const fold = recipe.querySelector('details')!;
    expect(fold.open).toBe(false);
    fold.open = true;
    const steps = [...recipe.querySelectorAll('ol > li')].map((li) => li.textContent);
    expect(steps).toEqual([
      'Compare the last 28 days with the 28 before.Why: A week is too short to tell a drop from a holiday.',
      'Split by page, then by search words.Why: One page often explains most of the drop.',
    ]);
    expect(recipe.textContent).toContain('How to read the result');
    expect(recipe.textContent).toContain('Comparing a holiday week with a normal one.');
    const table = screen.getByRole('table', { name: 'What each kind of evidence can say, and what it cannot' });
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Evidence', 'Can say', 'Cannot say']);
    expect(within(table).getByRole('rowheader').textContent).toBe('A JSON-LD block parsed');
    expect(table.textContent).toContain('The page is eligible for rich results.');
    assertInkRules();
  });

  it('a flagship playbook has neither, so nothing more is drawn', async () => {
    start({ hash: '#/business/plan' });
    await screen.findByRole('heading', { level: 1 });
    await settle();
    expect(screen.queryByRole('heading', { name: 'Recipes' })).toBeNull();
    expect(screen.queryByRole('table', { name: /evidence/ })).toBeNull();
  });
});

it('a social report shows export and code prerequisites, its writing stage and the owner approval',async()=>{const chain={orderId:'o-boat-12',playbook:'social-agency',offerKey:'monthly-report',stage:1,of:1,line:'Stage 1 of 1',state:'running',since:null,note:null,stages:[{n:1,stepId:'report',title:'Write report',produces:'Report',state:'now',manualPath:null}],prerequisites:[{stepId:'collect-exports',title:'Client exports',state:'done'},{stepId:'figures',title:'Figures from code receipts',state:'done'}],approval:{stepId:'approve-report',title:'Owner approval',state:'waiting'}};start({hash:'#/work?order=o-boat-12',stub:method=>method==='venture.order.chain'?chain:undefined});const tile=await screen.findByRole('region',{name:'Order stages'});expect(within(tile).getByText('Client exports')).toBeTruthy();expect(within(tile).getByText('Figures from code receipts')).toBeTruthy();expect(within(tile).getByText('Report')).toBeTruthy();expect(within(tile).getByText('Owner approval')).toBeTruthy();expect(within(tile).getByText('Waiting')).toBeTruthy();});
