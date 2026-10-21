import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type AgentView, type EngineClient } from '../../src/engine/types';

type FakeClient = ReturnType<typeof createFakeClient>;
type Intercept = (method: string, params: Record<string, unknown>) => Promise<unknown> | undefined;

/** The fake engine, with one method answered differently where a test needs it. Everything else goes to the fake. */
function wrap(base: FakeClient, intercept: Intercept): EngineClient {
  return {
    ...base,
    request: ((method: string, params?: Record<string, unknown>) => intercept(method, params ?? {}) ?? base.request(method as never, params as never)) as EngineClient['request'],
  };
}

function start(hash = '#/team', options: { language?: 'en' | 'hi'; intercept?: Intercept } = {}) {
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
    const list = await screen.findByRole('list', { name: 'Agents' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(4));
    const editor = await rowOf('Editor');
    expect(editor.textContent).toContain('Cuts episodes and shorts');
    expect(editor.textContent).toContain('Cutting shorts from episode 13');
    expect(editor.textContent).toContain('Episode 14 cut, 11 min 42 s');
  });

  it('a receipted last result opens its receipt; a model-written one says "model estimate" and has no receipt', async () => {
    start();
    const producer = await rowOf('Producer');
    expect(within(producer).getByRole('button', { name: 'Receipt R-0415' })).toBeTruthy();
    const researcher = await rowOf('Researcher');
    expect(researcher.textContent).toContain('About 18,000 views in 30 days');
    expect(within(researcher).getByText('model estimate')).toBeTruthy();
    expect(researcher.querySelector('[data-receipt]')).toBeNull();
    await click(within(producer).getByRole('button', { name: 'Receipt R-0415' }));
    expect(await screen.findByRole('complementary', { name: 'R-0415' })).toBeTruthy();
  });

  it('an idle agent with nothing finished says so', async () => {
    start();
    const publisher = await rowOf('Publisher');
    expect(publisher.textContent).toContain('Idle');
    expect(publisher.textContent).toContain('Nothing finished yet.');
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
    await rowOf('Editor');
    await act(async () => { fireEvent.keyDown(document.body, { key: 'j' }); });
    expect(document.activeElement).toBe(await rowOf('Editor'));
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Enter' }); hashChanged(); });
    expect(window.location.hash).toBe('#/team?sheet=agent%3Aeditor');
    expect(await screen.findByRole('complementary', { name: 'Editor' })).toBeTruthy();
  });
});

describe('Team: the agent sheet', () => {
  it('says its posture in words and what that means in one sentence', async () => {
    start();
    const editor = await openAgent('Editor');
    expect(within(editor).getByText('Approve each')).toBeTruthy();
    expect(within(editor).getByText('Asks you to approve each piece of work before it goes out.')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Close' }));
    const researcher = await openAgent('Researcher');
    expect(within(researcher).getByText('Shadow')).toBeTruthy();
    expect(within(researcher).getByText('Works on real orders, but anything outside Chausar is only simulated.')).toBeTruthy();
  });

  it('lists its playbook steps, each with a gate; a floor step always asks and has no switch', async () => {
    start();
    const sheet = await openAgent('Editor');
    const steps = within(sheet).getByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Cut the episodeAuto', 'Cut shorts from the episodeAuto', 'Finishing checkHold', 'Publish to YouTubeAlways asks you',
    ]);
    expect(within(steps).getByRole('switch', { name: 'Cut the episode: runs without asking' }).getAttribute('aria-checked')).toBe('true');
    expect(within(steps).getByRole('switch', { name: 'Finishing check: runs without asking' }).getAttribute('aria-checked')).toBe('false');
    expect(within(steps).queryByRole('switch', { name: /Publish to YouTube/ })).toBeNull();
    expect(within(steps).getAllByRole('switch')).toHaveLength(3);
  });

  it('switching a gate asks the engine and keeps its answer', async () => {
    const { base } = start();
    const spy = vi.spyOn(base.engine, 'request');
    const sheet = await openAgent('Editor');
    const finish = within(sheet).getByRole('switch', { name: 'Finishing check: runs without asking' });
    await act(async () => { fireEvent.click(finish); });
    expect(spy).toHaveBeenCalledWith('venture.team.gate', { agentId: 'editor', stepId: 'finish', gate: 'auto' });
    await waitFor(() => expect(within(sheet).getByRole('switch', { name: 'Finishing check: runs without asking' }).getAttribute('aria-checked')).toBe('true'));
    const stored = (await base.request('venture.team.list', {})).agents.find((a) => a.id === 'editor')!;
    expect(stored.steps.find((s) => s.id === 'finish')!.gate).toBe('auto');
  });

  it('a GATE_FLOOR refusal is said in plain words and the switch snaps back', async () => {
    let refuse: (error: unknown) => void = () => {};
    start('#/team', {
      intercept: (method, params) => method === 'venture.team.gate' && params.stepId === 'finish'
        ? new Promise((_resolve, reject) => { refuse = reject; }) : undefined,
    });
    const sheet = await openAgent('Editor');
    const finish = () => within(sheet).getByRole('switch', { name: 'Finishing check: runs without asking' });
    await act(async () => { fireEvent.click(finish()); });
    expect(finish().getAttribute('aria-checked')).toBe('true');
    await act(async () => { refuse(new EngineError('GATE_FLOOR', 'GATE_FLOOR: floor')); });
    await waitFor(() => expect(finish().getAttribute('aria-checked')).toBe('false'));
    const alert = within(sheet).getByRole('alert');
    expect(alert.textContent).toBe("This step always asks you, so it can't run on its own.");
    expect(alert.closest('li')!.textContent).toContain('Finishing check');
  });

  it('any other refusal says what the engine said and the switch snaps back', async () => {
    start('#/team', {
      intercept: (method) => method === 'venture.team.gate' ? Promise.reject(new EngineError('OFFLINE', 'The engine is not answering.')) : undefined,
    });
    const sheet = await openAgent('Editor');
    await act(async () => { fireEvent.click(within(sheet).getByRole('switch', { name: 'Cut the episode: runs without asking' })); });
    await waitFor(() => expect(within(sheet).getByRole('alert').textContent).toBe("Couldn't change this: The engine is not answering."));
    expect(within(sheet).getByRole('switch', { name: 'Cut the episode: runs without asking' }).getAttribute('aria-checked')).toBe('true');
  });

  it('shows spend so far as the engine wrote it', async () => {
    start();
    const sheet = await openAgent('Editor');
    const spend = within(sheet).getByRole('heading', { level: 3, name: 'Spend so far' }).closest('section')!;
    expect(spend.textContent).toContain('₹42.10 this month');
  });

  it('lists only its own runs, and a run opens in the shell run sheet with focus going back to the agent row', async () => {
    start();
    const sheet = await openAgent('Editor');
    const runs = await within(sheet).findByRole('list', { name: 'Runs' });
    expect(within(runs).getAllByRole('listitem')).toHaveLength(2);
    expect(runs.textContent).toContain('Cutting shorts from episode 13');
    expect(runs.textContent).toContain('Rendering the thumbnail set');
    expect(runs.textContent).toContain('Stopped: ffmpeg was not found on this computer.');
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
    const waiting = await within(producer).findByRole('list', { name: 'Runs' });
    expect(waiting.textContent).toContain('Pricing the sponsor slot');
    expect(within(waiting).getByText('Waiting on you')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Close' }));
    await act(async () => { await base.request('workspace.open', { folder: 'ledgerline' }); });
    const bookkeeper = await openAgent('Bookkeeper');
    const done = await within(bookkeeper).findByRole('list', { name: 'Runs' });
    expect(done.textContent).toContain('Matched 212 of 214 lines. 2 need your data.');
    expect(within(done).getByRole('button', { name: 'Receipt R-0412' })).toBeTruthy();
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
    expect(link.getAttribute('href')).toBe('#/business/plan');
    expect(within(main()).queryByRole('list', { name: 'Agents' })).toBeNull();
  });

  it('says what went wrong when the team does not load', async () => {
    start('#/team', { intercept: (method) => (method === 'venture.team.list' ? Promise.reject(new EngineError('OFFLINE', 'The engine is not answering.')) : undefined) });
    expect(await within(main()).findByText("Couldn't load the team: The engine is not answering.")).toBeTruthy();
    expect(within(main()).queryByText('No team yet.')).toBeNull();
  });

  it('speaks Hindi', async () => {
    start('#/team', { language: 'hi' });
    expect(await screen.findByRole('heading', { level: 1, name: 'टीम' })).toBeTruthy();
    const sheet = await openAgent('Editor');
    expect(within(sheet).getByText('हर काम पर मंज़ूरी')).toBeTruthy();
    expect(within(sheet).getByText('हमेशा आपसे पूछता है')).toBeTruthy();
  });
});
