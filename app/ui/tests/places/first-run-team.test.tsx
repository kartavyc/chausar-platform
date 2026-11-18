import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { teamCardDigest } from '../../../../platform/runtime/venture/agents/team-proposal';
import { skipAi } from './first-run-steps';

/**
 * A small team proposed from the plan and hired at setup. The owner's AI proposes up to three agents beside the way to
 * earn (the engine's agents/team-proposal.ts); the plan card lists them under "How you earn", each with a way to leave
 * it out. Keeping the plan hires the ones kept (venture.agents.hire.team) once the business exists. A hire that fails
 * never blocks setup: the reason shows on the next step and the owner goes on.
 */
const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk wholesale orders from cafes and hotels in Pune.';
const agent = (name: string, job: string, duties: string[], reads: string[]) => ({ name, job, duties, reads, digest: teamCardDigest({ name, job, duties, reads } as never) });
const TEAM = [
  agent('Asha', 'Lists cafes that buy tableware in bulk.', ['Lists cafes in Pune from public listings', 'Flags the ones that fit my sets'], ['plan', 'trackers']),
  agent('Kabir', 'Drafts quotes for my approval.', ['Drafts a quote for each enquiry'], ['plan', 'clients']),
  agent('Meera', 'Keeps track of replies.', ['Tracks who replied', 'Summarises open orders each week'], ['clients', 'orders', 'trackers']),
];
const READ = {
  family: null, profession: null, country: null, evidence: null, idea: POTTER, source: 'ai',
  offers: [{ name: 'Cafe mug sets', line: 'Handmade mugs in bulk for cafes' }],
  reply: 'You make pottery by hand and want bulk orders. Where are you based?',
  way: {
    customer: 'Independent cafes and small hotels in Pune that buy tableware in bulk.',
    reach: 'A list of cafes found from public listings, then a first message you send to each owner.',
    teamDoes: 'Finds the cafes, drafts each message and quote, and keeps track of who replied.',
    youDo: 'Make the samples, set the prices, send each message and take the calls.',
    firstWeek: ['Decide the set sizes and your price for each offer.', 'Approve the first list of cafes.'],
  },
  team: TEAM,
};

type Call = [string, Record<string, unknown>];
function start(read: unknown = READ, hire?: () => Promise<unknown>) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: 'Asia/Kolkata' }; });
  window.location.hash = '#/today';
  const fake = createFakeClient(new FakeEngine({ fresh: true }));
  const calls: Call[] = [];
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => {
    calls.push([method, structuredClone(params ?? {})]);
    if (method === 'venture.about.read') return Promise.resolve(structuredClone(read));
    if (method === 'venture.agents.hire.team' && hire) return hire();
    return fake.request(method as never, params as never);
  }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { calls, fake };
}

/** Send the sentence and wait for the plan card. */
async function plan() {
  const box = await skipAi();
  fireEvent.change(box, { target: { value: POTTER } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  const keep = await screen.findByRole('button', { name: 'Keep this plan' });
  await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
  return keep;
}

/** Keep the plan and answer the side-work question; the services step follows once the business is kept. */
async function keepAndGoOn(keep: HTMLElement) {
  await act(async () => { fireEvent.click(keep); });
  const check = await screen.findByRole('region', { name: 'Day job and rules' }, { timeout: 4000 });
  await act(async () => { fireEvent.click(within(check).getByRole('radio', { name: 'I am not sure' })); });
  await act(async () => { fireEvent.click(within(check).getByRole('button', { name: 'Continue' })); });
  return screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('first run: the team proposed from the plan', () => {
  it('lists each proposed agent under "How you earn", in the words of the AI, with the standing lines', async () => {
    start();
    await plan();
    const team = screen.getByRole('region', { name: 'Your team' });
    const way = screen.getByRole('region', { name: 'How you earn' });
    expect(way.compareDocumentPosition(team) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rows = within(team).getAllByRole('listitem').filter((item) => item.hasAttribute('data-team-agent'));
    expect(rows).toHaveLength(3);
    for (const [index, card] of TEAM.entries()) {
      const row = within(rows[index]!);
      for (const words of [card.name, card.job, ...card.duties]) expect(row.getByText(words).closest('[data-content]')).not.toBeNull();
      expect(row.getByRole('button', { name: `Leave ${card.name} out` })).toBeTruthy();
    }
    // What it reads is said with the app's own names for the areas.
    expect(within(rows[0]!).getByText('It reads: Your plan, Trackers.')).toBeTruthy();
    expect(within(team).getByText('Keeping this plan adds them to your team.')).toBeTruthy();
    expect(within(team).getByText('None of them sends, pays, posts, deletes or changes a price by itself.')).toBeTruthy();
    expect(within(team).getByText('They ask you before anything leaves.')).toBeTruthy();
    // One filled primary on the card stays "Keep this plan".
    expect([...document.querySelectorAll('main [data-variant="primary"]')].map((button) => button.textContent)).toEqual(['Keep this plan']);
  });

  it('leaving one out hires only the rest, with exactly the cards shown, once the business exists; Team then has them', async () => {
    const { calls, fake } = start();
    const keep = await plan();
    const team = screen.getByRole('region', { name: 'Your team' });
    await act(async () => { fireEvent.click(within(team).getByRole('button', { name: 'Leave Kabir out' })); });
    expect(within(team).getByText('Kabir: left out.')).toBeTruthy();
    expect(within(team).queryByText(TEAM[1]!.job)).toBeNull();
    // Put back and left out again: the last choice is the one kept.
    await act(async () => { fireEvent.click(within(team).getByRole('button', { name: 'Put Kabir back' })); });
    expect(within(team).getByText(TEAM[1]!.job)).toBeTruthy();
    await act(async () => { fireEvent.click(within(team).getByRole('button', { name: 'Leave Kabir out' })); });
    await keepAndGoOn(keep);
    const hires = calls.filter(([method]) => method === 'venture.agents.hire.team');
    expect(hires).toHaveLength(1);
    expect(hires[0]![1]).toEqual({ agents: [TEAM[0], TEAM[2]] });
    const at = (method: string, has?: string) => calls.findIndex(([name, params]) => name === method && (!has || has in params));
    expect(at('venture.agents.hire.team')).toBeGreaterThan(at('venture.create'));
    expect(at('venture.agents.hire.team')).toBeGreaterThan(at('venture.owner.set', 'way'));
    expect(screen.queryByText(/Your team was not added/)).toBeNull();
    // After setup they are hired agents on Team, as any hand hire is.
    const list = await fake.request('venture.team.list', {});
    const hired = list.agents.filter((item) => item.hired);
    expect(hired.map((item) => [item.name, item.role])).toEqual([['Asha', TEAM[0]!.job], ['Meera', TEAM[2]!.job]]);
    expect(hired[0]!.hired!.duties).toEqual(TEAM[0]!.duties);
  });

  it('a hire that fails does not block setup: the reason shows plainly and the owner goes on', async () => {
    const limit = 'A business keeps at most 5 hired agents. Retire one first.';
    const { calls, fake } = start(READ, () => Promise.reject(new EngineError('HIRE_LIMIT', limit, undefined, true)));
    const heading = await keepAndGoOn(await plan());
    expect(heading).toBeTruthy();
    expect(calls.filter(([method]) => method === 'venture.agents.hire.team')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toBe(`Your team was not added: ${limit} You can hire agents later on Team.`);
    expect((await fake.request('venture.team.list', {})).agents.filter((item) => item.hired)).toEqual([]);
    // The services step still ends setup.
    expect(screen.getByRole('button', { name: 'Go to Today' })).toBeTruthy();
  });

  it('with every agent left out, or no team proposed, nothing is hired', async () => {
    const all = start();
    const keep = await plan();
    const team = screen.getByRole('region', { name: 'Your team' });
    for (const card of TEAM) await act(async () => { fireEvent.click(within(team).getByRole('button', { name: `Leave ${card.name} out` })); });
    await keepAndGoOn(keep);
    expect(all.calls.filter(([method]) => method === 'venture.agents.hire.team')).toEqual([]);
  });

  it('a read with no team shows no team section and hires nobody', async () => {
    const { team: _team, ...bare } = READ;
    const none = start(bare);
    const keep = await plan();
    expect(screen.getByRole('region', { name: 'How you earn' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Your team' })).toBeNull();
    await keepAndGoOn(keep);
    expect(none.calls.filter(([method]) => method === 'venture.agents.hire.team')).toEqual([]);
  });
});
