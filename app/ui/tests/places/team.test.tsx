import { describe, expect, it, vi } from 'vitest';
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
    expect(await screen.findByRole('complementary', { name: 'R-0412' })).toBeTruthy();
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
  it('says its posture in words and what that means in one sentence', async () => {
    start();
    const editor = await openAgent('Editor');
    expect(within(editor).getByText('Approve each')).toBeTruthy();
    expect(within(editor).getByText('Asks you to approve each piece of work before it goes out.')).toBeTruthy();
    // Ink v2 (3D): the agent panel's close button says whose panel it closes.
    await click(screen.getByRole('button', { name: 'Close Editor' }));
    const researcher = await openAgent('Researcher');
    expect(within(researcher).getByText('Shadow')).toBeTruthy();
    expect(within(researcher).getByText('Works on real orders, but anything outside Chausar is only simulated.')).toBeTruthy();
  });

  it('offers the four postures, the current one chosen', async () => {
    start();
    const sheet = await openAgent('Editor');
    const group = within(sheet).getByRole('group', { name: 'Posture' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual(['Rehearsal', 'Shadow', 'Approve each', 'Auto with spot checks']);
    expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(['approve-each']);
  });

  it('choosing a posture asks the engine, is disabled while it answers, and keeps its answer', async () => {
    let answer: (value: unknown) => void = () => {};
    const { base } = start('#/team', {
      intercept: (method, params) => method === 'venture.team.posture'
        ? new Promise((resolve) => { answer = resolve; }).then(() => base.request('venture.team.posture', params as never)) : undefined,
    });
    const sheet = await openAgent('Editor');
    const group = within(sheet).getByRole('group', { name: 'Posture' }) as HTMLFieldSetElement;
    await act(async () => { fireEvent.click(within(group).getByRole('radio', { name: 'Shadow' })); });
    expect((within(group).getByRole('radio', { name: 'Shadow' }) as HTMLInputElement).checked).toBe(true);
    expect(group.disabled).toBe(true);
    await act(async () => { answer(undefined); });
    await waitFor(() => expect(group.disabled).toBe(false));
    expect((within(group).getByRole('radio', { name: 'Shadow' }) as HTMLInputElement).checked).toBe(true);
    expect(within(sheet).getByText('Works on real orders, but anything outside Chausar is only simulated.')).toBeTruthy();
    const stored = (await base.request('venture.team.list', {})).agents.find((a) => a.id === 'editor')!;
    expect(stored.posture).toBe('shadow');
  });

  it('a posture above what the business has earned is refused in the engine words and the choice goes back', async () => {
    // W4 4J22a: auto is built but locked (team-readiness.test.tsx), so the stage refusal is shown on another posture.
    // Engine-shaped (views/team.ts): a business at rehearsal lets an agent work at rehearsal or tighter, so Shadow is refused.
    const line = 'The business is at rehearsal, so this agent can work at rehearsal or tighter. Move the business up first.';
    start('#/team', {
      intercept: (method) => (method === 'venture.team.posture' ? Promise.reject(new EngineError('POSTURE_ABOVE_STAGE', line)) : undefined),
    });
    const sheet = await openAgent('Editor');
    const group = within(sheet).getByRole('group', { name: 'Posture' });
    await act(async () => { fireEvent.click(within(group).getByRole('radio', { name: 'Shadow' })); });
    await waitFor(() => expect(within(sheet).getByRole('alert').textContent).toBe(line));
    expect((within(group).getByRole('radio', { name: 'Approve each' }) as HTMLInputElement).checked).toBe(true);
    expect((within(group).getByRole('radio', { name: 'Shadow' }) as HTMLInputElement).checked).toBe(false);
  });

  it('any other posture refusal says what the engine said', async () => {
    start('#/team', {
      intercept: (method) => method === 'venture.team.posture' ? Promise.reject(new EngineError('OFFLINE', 'The engine is not answering.')) : undefined,
    });
    const sheet = await openAgent('Editor');
    await act(async () => { fireEvent.click(within(sheet).getByRole('radio', { name: 'Rehearsal' })); });
    await waitFor(() => expect(within(sheet).getByRole('alert').textContent).toBe("Couldn't change the posture: The engine is not answering."));
    expect((within(sheet).getByRole('radio', { name: 'Approve each' }) as HTMLInputElement).checked).toBe(true);
  });

  it('lists only its assigned playbook steps, each with a gate', async () => {
    start();
    const sheet = await openAgent('Editor');
    const steps = within(sheet).getByRole('list', { name: 'Steps' });
    // Ink v2 (3B5b): a gate draws both words, Auto and Hold, with the one in force marked data-on.
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Cut the episodeAutoHold', 'Cut shorts from the episodeAutoHold', 'Finishing checkAutoHold',
    ]);
    expect(within(steps).getAllByRole('listitem').map((li) => li.querySelector('[data-on]')?.textContent ?? null)).toEqual(['Auto', 'Auto', 'Hold']);
    expect(within(steps).getByRole('switch', { name: 'Cut the episode: Auto runs without asking, Hold waits for you' }).getAttribute('aria-checked')).toBe('true');
    expect(within(steps).getByRole('switch', { name: 'Finishing check: Auto runs without asking, Hold waits for you' }).getAttribute('aria-checked')).toBe('false');
    expect(within(steps).queryByRole('switch', { name: /Publish to YouTube/ })).toBeNull();
    expect(within(steps).getAllByRole('switch')).toHaveLength(3);
  });

  it('the assigned Billing issue step always asks and has no switch', async () => {
    const { base } = start();
    await rowOf('Editor');
    await act(async () => { await base.request('workspace.open', { folder: 'ledgerline' }); });
    const sheet = await openAgent('Billing');
    const steps = within(sheet).getByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Draft invoicesAutoHold', 'Issue an invoice to a clientAlways asks you',
    ]);
    expect(within(steps).queryByRole('switch', { name: /Issue an invoice/ })).toBeNull();
    expect(within(steps).getAllByRole('switch')).toHaveLength(1);
  });

  it('switching a gate asks the engine and keeps its answer', async () => {
    const { base } = start();
    const spy = vi.spyOn(base.engine, 'request');
    const sheet = await openAgent('Editor');
    const finish = within(sheet).getByRole('switch', { name: 'Finishing check: Auto runs without asking, Hold waits for you' });
    await act(async () => { fireEvent.click(finish); });
    expect(spy).toHaveBeenCalledWith('venture.team.gate', { agentId: 'editor', stepId: 'finish', gate: 'auto' });
    await waitFor(() => expect(within(sheet).getByRole('switch', { name: 'Finishing check: Auto runs without asking, Hold waits for you' }).getAttribute('aria-checked')).toBe('true'));
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
    const finish = () => within(sheet).getByRole('switch', { name: 'Finishing check: Auto runs without asking, Hold waits for you' });
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
    await act(async () => { fireEvent.click(within(sheet).getByRole('switch', { name: 'Cut the episode: Auto runs without asking, Hold waits for you' })); });
    await waitFor(() => expect(within(sheet).getByRole('alert').textContent).toBe("Couldn't change this: The engine is not answering."));
    expect(within(sheet).getByRole('switch', { name: 'Cut the episode: Auto runs without asking, Hold waits for you' }).getAttribute('aria-checked')).toBe('true');
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
    await click(within(sheet).getByRole('tab', { name: 'Runs' }));
    const runs = await within(sheet).findByRole('list', { name: 'Runs' });
    expect(within(runs).getAllByRole('listitem')).toHaveLength(2);
    expect(runs.textContent).toContain('Cutting shorts from episode 13');
    expect(runs.textContent).toContain('Rendering the thumbnail set');
    // 4Z2: the engine sends no result line on a failed run; the sheet says it failed (never "Stopped").
    expect(runs.textContent).toContain('This run failed.');
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
    await click(within(producer).getByRole('tab', { name: 'Runs' }));
    const waiting = await within(producer).findByRole('list', { name: 'Runs' });
    expect(waiting.textContent).toContain('Pricing the sponsor slot');
    expect(within(waiting).getByText('Waiting on you')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Close Producer' }));
    await act(async () => { await base.request('workspace.open', { folder: 'ledgerline' }); });
    const bookkeeper = await openAgent('Bookkeeper');
    await click(within(bookkeeper).getByRole('tab', { name: 'Runs' }));
    const done = await within(bookkeeper).findByRole('list', { name: 'Runs' });
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
    expect(link.getAttribute('href')).toBe('#/business/plan');
    expect(within(main()).queryByRole('list', { name: 'Agents' })).toBeNull();
  });

  it('says what went wrong when the team does not load', async () => {
    start('#/team', { intercept: (method) => (method === 'venture.team.list' ? Promise.reject(new EngineError('OFFLINE', 'The engine is not answering.')) : undefined) });
    expect(await within(main()).findByText("Couldn't load the team: The engine is not answering.")).toBeTruthy();
    expect(within(main()).queryByText('No team yet.')).toBeNull();
  });

  it('speaks Hindi', async () => {
    const { base } = start('#/team', { language: 'hi' });
    expect(await screen.findByRole('heading', { level: 1, name: 'टीम' })).toBeTruthy();
    await act(async () => { await base.request('workspace.open', { folder: 'ledgerline' }); });
    const sheet = await openAgent('Billing');
    expect(within(sheet).getByText('हर काम पर मंज़ूरी')).toBeTruthy();
    expect(within(sheet).getByText('हमेशा आपसे पूछता है')).toBeTruthy();
  });
});
