import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type AgentView, type EngineClient } from '../../src/engine/types';
import { receiptMark } from '../helpers/ink-rules';

type FakeClient = ReturnType<typeof createFakeClient>;
type Intercept = (method: string, params: Record<string, unknown>) => Promise<unknown> | undefined;

/** The fake engine, with one method answered differently where a test needs it. Everything else goes to the fake. */
function wrap(base: FakeClient, intercept: Intercept): EngineClient {
  return {
    ...base,
    request: ((method: string, params?: Record<string, unknown>) => intercept(method, params ?? {}) ?? base.request(method as never, params as never)) as EngineClient['request'],
  };
}

function start(hash = '#/team', options: { language?: 'en'; intercept?: Intercept } = {}) {
  window.location.hash = hash;
  const base = createFakeClient(new FakeEngine());
  const client = options.intercept ? wrap(base, options.intercept) : base;
  const view = render(<App client={client} language={options.language ?? 'en'} />);
  return { base, client, ...view };
}

const hashChanged = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const click = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); hashChanged(); }); };
const main = () => screen.getByRole('main');
const rowOf = async (name: string) => (await within(main()).findByRole('button', { name })).closest('li') as HTMLElement;
const openAgent = async (name: string) => {
  await click(await within(main()).findByRole('button', { name }));
  return screen.findByRole('complementary', { name });
};

describe('Team: one row per agent', () => {
  it('shows name, role, what it is doing now and its last result', async () => {
    start();
    expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeTruthy();
    // The agents sit in their departments (W4 4A2); Editor is Production's one agent.
    const list = await screen.findByRole('list', { name: 'Production agents' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    const editor = await rowOf('Editor');
    expect(editor.textContent).toContain('Cuts episodes and shorts');
    expect(editor.textContent).toContain('Cutting shorts from episode 13');
    // At work, a card says what it does now; its last result waits in its panel's runs (4A2 review).
    expect(editor.textContent).not.toContain('Episode 14 cut, 11 min 42 s');
  });

  it("an idle agent's receipted last result opens its receipt", async () => {
    const { base } = start();
    await rowOf('Editor');
    await act(async () => { await base.request('workspace.open', { folder: 'ledgerline' }); });
    const bookkeeper = await rowOf('Bookkeeper');
    await click(within(bookkeeper).getByRole('button', { name: receiptMark('R-0412') }));
    const sheet = await screen.findByRole('complementary', { name: '212 of 214' });
    expect(sheet.querySelector('[data-code]')?.textContent).toBe('R-0412');
  });

  it("an idle agent's model-written last result says 'model estimate' and has no receipt", async () => {
    // Researcher with nothing on now, so its card shows its last result (a model's estimate).
    const other = createFakeClient(new FakeEngine());
    start('#/team', {
      intercept: (method) => method === 'venture.runs.list'
        ? other.request('venture.runs.list', { state: 'all' }).then((view) => ({ runs: view.runs.filter((run) => run.agent !== 'Researcher') }))
        : method === 'venture.team.list'
          ? other.request('venture.team.list', {}).then((view) => ({ ...view, agents: view.agents.map((agent) => (agent.id === 'researcher' ? { ...agent, state: 'idle' as const } : agent)) }))
          : undefined,
    });
    const researcher = await rowOf('Researcher');
    await waitFor(() => expect(researcher.textContent).toContain('About 18,000 views in 30 days'));
    expect(within(researcher).getByText('model estimate')).toBeTruthy();
    expect(researcher.querySelector('[data-receipt]')).toBeNull();
  });

  it('an idle agent with nothing finished shows no last line', async () => {
    start();
    const publisher = await rowOf('Publisher');
    // W4 4H2: Lumen has no AI connected, so its idle agent waits on one in the engine's words (views/team.ts).
    expect(publisher.textContent).toContain('Connect your AI');
    expect(publisher.textContent).not.toContain('Nothing finished yet.');
  });

  it('what an agent is doing now opens that run in the run sheet; waiting on you is marked', async () => {
    start();
    const producer = await rowOf('Producer');
    const now = within(producer).getByRole('button', { name: 'Waiting on you' });
    expect(now.getAttribute('data-waiting')).toBe('');
    await click(now);
    expect(window.location.hash).toBe('#/team?sheet=run%3A29');
    expect(await screen.findByRole('complementary', { name: 'Pricing the sponsor slot' })).toBeTruthy();
    const editor = await rowOf('Editor');
    expect(within(editor).getByRole('button', { name: 'Cutting shorts from episode 13' }).hasAttribute('data-waiting')).toBe(false);
  });

  it('J moves to the first agent and Enter opens it', async () => {
    start();
    // The first agent on the page: Producer, in Sales and clients, the first department (W4 4A2).
    await rowOf('Producer');
    await act(async () => { fireEvent.keyDown(document.body, { key: 'j' }); });
    expect(document.activeElement).toBe(await rowOf('Producer'));
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Enter' }); hashChanged(); });
    expect(window.location.hash).toBe('#/team?sheet=agent%3Aproducer');
    expect(await screen.findByRole('complementary', { name: 'Producer' })).toBeTruthy();
  });
});

describe('Team: the agent sheet', () => {
  it('each agent links to the current AI review settings', async () => {
    start();
    const editor=await openAgent('Editor');
    expect(within(editor).getByRole('link',{name:'AI review settings'}).getAttribute('href')).toBe('#/connections');
    expect(within(editor).queryByRole('radio')).toBeNull();
    await click(screen.getByRole('button',{name:'Close Editor'}));
    const researcher=await openAgent('Researcher');
    expect(within(researcher).getByRole('link',{name:'AI review settings'})).toBeTruthy();
  });









  it('lists only its assigned work steps without inactive gate switches', async () => {
    start();
    const sheet = await openAgent('Editor');
    const steps = within(sheet).getByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem').map(li=>li.textContent)).toEqual(['Cut the episode','Cut shorts from the episode','Finishing check']);
    expect(within(steps).queryByRole('switch')).toBeNull();
  });

  it('the assigned Billing issue step always asks and has no switch', async () => {
    const { base } = start();
    await rowOf('Editor');
    await act(async () => { await base.request('workspace.open', { folder: 'ledgerline' }); });
    const sheet = await openAgent('Billing');
    const steps = within(sheet).getByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Draft invoices', 'Issue an invoice to a clientAlways asks you',
    ]);
    expect(within(steps).queryByRole('switch', { name: /Issue an invoice/ })).toBeNull();
    expect(within(steps).queryByRole('switch')).toBeNull();
  });







  // Ink v2 (3D): the engine sends an agent's spend with no receipt, and a money figure always carries one (or "model
  // estimate"), so the panel no longer prints it; the spend, call by call with receipts, is one link away in Money.
  it('says where its spend is, without an amount that has no receipt', async () => {
    start();
    const sheet = await openAgent('Editor');
    const spend = within(sheet).getByRole('heading', { level: 3, name: 'Spend so far' }).closest('section')!;
    expect(spend.textContent).not.toContain('₹42.10 this month');
    expect(within(spend as HTMLElement).getByRole('link', { name: 'See spend in Money' }).getAttribute('href')).toBe('#/money/spend');
  });

  it('lists only its own runs, and a run opens in the shell run sheet with focus going back to the agent row', async () => {
    start();
    const sheet = await openAgent('Editor');
    // Ink v2 (3D): runs sit on the panel's Runs tab.
    await click(within(sheet).getByRole('tab', { name: 'Jobs' }));
    const runs = await within(sheet).findByRole('list', { name: 'Jobs' });
    expect(within(runs).getAllByRole('listitem')).toHaveLength(2);
    expect(runs.textContent).toContain('Cutting shorts from episode 13');
    expect(runs.textContent).toContain('Rendering the thumbnail set');
    // 4Z2: the engine sends no result line on a failed run; the sheet says it failed (never "Stopped").
    expect(runs.textContent).toContain('This job failed.');
    expect(runs.textContent).not.toContain('Checking titles');
    await click(within(runs).getByRole('button', { name: 'Rendering the thumbnail set' }));
    expect(window.location.hash).toBe('#/team?sheet=run%3A28');
    const run = await screen.findByRole('complementary', { name: 'Rendering the thumbnail set' });
    await act(async () => { fireEvent.keyDown(within(run).getByRole('heading', { level: 2 }), { key: 'Escape' }); hashChanged(); });
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(document.activeElement).toBe(await rowOf('Editor'));
  });

  it('a waiting run says so, and a finished run shows its result with its receipt', async () => {
    const { base } = start();
    const producer = await openAgent('Producer');
    await click(within(producer).getByRole('tab', { name: 'Jobs' }));
    const waiting = await within(producer).findByRole('list', { name: 'Jobs' });
    expect(waiting.textContent).toContain('Pricing the sponsor slot');
    expect(within(waiting).getByText('Waiting on you')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Close Producer' }));
    await act(async () => { await base.request('workspace.open', { folder: 'ledgerline' }); });
    const bookkeeper = await openAgent('Bookkeeper');
    await click(within(bookkeeper).getByRole('tab', { name: 'Jobs' }));
    const done = await within(bookkeeper).findByRole('list', { name: 'Jobs' });
    expect(done.textContent).toContain('Matched 212 of 214 lines. 2 need your data.');
    expect(within(done).getByRole('button', { name: receiptMark('R-0412') })).toBeTruthy();
  });

  it('says so when the agent is not in this business', async () => {
    start('#/team?sheet=agent:nobody');
    expect(await screen.findByRole('complementary', { name: "This agent isn't in this business." })).toBeTruthy();
  });
});

describe('Team: live and empty', () => {
  it('refreshes on run events', async () => {
    let now = 'Cutting shorts from episode 13';
    const { base } = start('#/team', {
      intercept: (method) => method === 'venture.team.list'
        ? createFakeClient(new FakeEngine()).request('venture.team.list', {}).then((r) => ({ agents: r.agents.map((a: AgentView) => (a.id === 'editor' ? { ...a, now } : a)) }))
        : undefined,
    });
    await within(main()).findByText('Cutting shorts from episode 13');
    now = 'Rendering 4 of 6';
    await act(async () => { base.engine.emit({ type: 'run.step', businessId: 'lumen', runId: '31', at: '2026-10-21T10:25:00.000Z' }); });
    expect(await within(main()).findByText('Rendering 4 of 6')).toBeTruthy();
  });

  it('follows a business switch', async () => {
    const { base } = start();
    await rowOf('Editor');
    await act(async () => { await base.request('workspace.open', { folder: 'ledgerline' }); });
    expect(await rowOf('Bookkeeper')).toBeTruthy();
    expect(within(main()).queryByRole('button', { name: 'Editor' })).toBeNull();
    const billing = await rowOf('Billing');
    expect(billing.textContent).toContain('Invoices and quotes');
  });

  it('with no agents yet, says so and links to the plan', async () => {
    start('#/team', { intercept: (method) => (method === 'venture.team.list' ? Promise.resolve({ agents: [] }) : undefined) });
    expect(await within(main()).findByText('No team yet.')).toBeTruthy();
    const link = within(main()).getByRole('link', { name: 'Accept your plan to meet them.' });
    // C4 task 10 (36.x1): to Today, with the plan's card in view and the plan open to read.
    expect(link.getAttribute('href')).toBe('#/today?focus=plan&read=1');
    expect(within(main()).queryByRole('list', { name: 'Agents' })).toBeNull();
  });

  it('says what went wrong when the team does not load', async () => {
    start('#/team', { intercept: (method) => (method === 'venture.team.list' ? Promise.reject(new EngineError('OFFLINE', 'The engine is not answering.')) : undefined) });
    expect(await within(main()).findByText("Couldn't load the team: The engine is not answering.")).toBeTruthy();
    expect(within(main()).queryByText('No team yet.')).toBeNull();
  });


});
