import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { App } from '../../src/shell/App';
import { EngineProvider } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type AgentView, type DepartmentView, type EngineClient, type RunSummary, type TeamListView } from '../../src/engine/types';
import { TextProvider } from '../../src/text';
import { DepartmentPanel } from '../../src/places/team/DepartmentPanel';
import { OneDepartment } from '../../src/places/team/OneDepartment';
import type { DepartmentData, Member } from '../../src/places/team/departments';
import { assertInkRules, receiptMark } from '../helpers/ink-rules';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Team in the direction D look (w3 plan, package 3D): stats tiles, agent cards with rings, the department panels and
 * the one-department view when the engine sends departments (W4 4A), and the agent panel with its tabs. The fake
 * engine sends no departments yet, so the department tests give the engine's own TeamListView shape here, in the test.
 */

type FakeClient = ReturnType<typeof createFakeClient>;
type Intercept = (method: string, params: Record<string, unknown>, base: FakeClient) => Promise<unknown> | undefined;

/**
 * The team as the engine sent it before W4 4A1: agents only, with no department, kind, state, health or Keeper, and no
 * departments or totals. These wave 3 tests hold Team's fallback for such an engine; team-w4.test.tsx holds Team with
 * the engine's departments, which the fake engine now sends.
 */
function beforeW4(view: TeamListView): TeamListView {
  return {
    agents: view.agents.filter((one) => one.id !== 'keeper').map(({ department: _d, kind: _k, state: _s, health: _h, postureSetBy: _p, chat: _c, parentId: _r, ...rest }) => rest),
  };
}

function start(hash = '#/team', options: { language?: 'en' | 'hi'; intercept?: Intercept } = {}) {
  window.location.hash = hash;
  const fake = createFakeClient(new FakeEngine());
  const base: FakeClient = {
    ...fake,
    request: ((method: string, params?: Record<string, unknown>) => (method === 'venture.team.list'
      ? fake.request('venture.team.list', {}).then(beforeW4)
      : fake.request(method as never, params as never))) as FakeClient['request'],
  };
  const client: EngineClient = options.intercept
    ? {
        ...base,
        request: ((method: string, params?: Record<string, unknown>) =>
          options.intercept!(method, params ?? {}, base) ?? base.request(method as never, params as never)) as EngineClient['request'],
      }
    : base;
  const view = render(<App client={client} language={options.language ?? 'en'} />);
  return { base, ...view };
}

const hashChanged = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const click = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); hashChanged(); }); };
const main = () => screen.getByRole('main');
const cardOf = async (name: string) => (await within(main()).findByRole('button', { name })).closest('li') as HTMLElement;
const avatarIn = (scope: HTMLElement) => scope.querySelector('[data-dept][aria-hidden="true"]') as HTMLElement;
const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const KEY_LIKE = /^[a-z]+(\.[a-zA-Z0-9-]+)+$/;

/** The engine's department views (W4 4A1's TeamListView), for the fake's Lumen Studio team. */
const DEPARTMENT_OF: Record<string, AgentView['department']> = { editor: 'production', researcher: 'marketing', producer: 'sales', publisher: 'marketing' };
function departmentView(id: DepartmentView['id'], counts: DepartmentView['counts'], jobs: number, spend: string, receiptId: string): DepartmentView {
  return {
    id, name: id, counts, doneThisWeek: { count: jobs, receiptId }, spendThisMonth: { display: spend, receiptId },
    series: { jobs: [], spend: [] },
  };
}
const withDepartments: Intercept = (method, _params, base) => method === 'venture.team.list'
  ? base.request('venture.team.list', {}).then((view): TeamListView => ({
      agents: view.agents.map((agent) => ({ ...agent, department: DEPARTMENT_OF[agent.id] })),
      departments: [
        departmentView('sales', { working: 0, waiting: 1, stopped: 0, idle: 0 }, 3, '₹0.00', 'R-0415'),
        departmentView('marketing', { working: 1, waiting: 0, stopped: 0, idle: 1 }, 7, '₹18.00', 'R-0412'),
        departmentView('production', { working: 1, waiting: 0, stopped: 1, idle: 0 }, 6, '₹42.10', 'R-0419'),
        departmentView('money', { working: 0, waiting: 0, stopped: 0, idle: 0 }, 0, '₹0.00', 'R-0402'),
        departmentView('operations', { working: 0, waiting: 0, stopped: 0, idle: 0 }, 0, '₹0.00', 'R-0402'),
      ],
    }))
  : undefined;

function renderWithEngine(node: React.ReactNode, language: 'en' | 'hi' = 'en') {
  return render(
    <EngineProvider client={createFakeClient(new FakeEngine())}>
      <TextProvider language={language}>{node}</TextProvider>
    </EngineProvider>,
  );
}

const agent = (id: string, name: string, extra: Partial<AgentView> = {}): AgentView => ({
  id, name, role: `${name} role`, now: 'Idle', posture: 'approve-each', spend: '', steps: [], ...extra,
});
const run = (runId: string, agentName: string, extra: Partial<RunSummary>): RunSummary => ({
  runId, businessId: 'lumen', agent: agentName, purpose: `${agentName} purpose`, state: 'active', startedAt: '2026-10-21T10:00:00.000Z', elapsed: '2m', ...extra,
});

describe('Team v2: the stats tiles', () => {
  it('says who works now and who waits on you, in counts and names, and the AI spend with its receipt as Money proves it', async () => {
    start();
    const glance = await screen.findByRole('region', { name: 'Team at a glance' });
    const working = (await within(glance).findByText('Working now')).closest('[data-card]') as HTMLElement;
    await waitFor(() => expect(working.querySelector('[data-count]')?.textContent).toBe('2'));
    expect(working.textContent).toContain('Editor and Researcher');
    // The stack: one avatar each, drawn without rings (D's `.stack`), hidden since the names are in words.
    expect(working.querySelectorAll('[data-dept][aria-hidden="true"]')).toHaveLength(2);

    const waiting = within(glance).getByText('Waiting on you').closest('[data-card]') as HTMLElement;
    expect(waiting.querySelector('[data-count]')?.textContent).toBe('1');
    expect(waiting.getAttribute('data-tone')).toBe('wait');
    expect(waiting.textContent).toContain('Producer: Pricing the sponsor slot');
    expect(waiting.querySelector('[data-state="waiting"]')).not.toBeNull();

    // "Includes estimates" means calls not settled yet, a cost code worked out, not a number a model wrote: the spend
    // line's proof is its receipt, as on Money (money/parts.tsx lineProof), never the "model estimate" label.
    const spend = (await within(glance).findByText('AI spend this month')).closest('[data-card]') as HTMLElement;
    // 4Z3: a business in India with a rupee rate leads with rupees, its words after them, the dollars beneath (two decimals).
    expect(spend.querySelector('[data-figure] [data-ui-number]')?.textContent).toBe('₹60.10');
    expect(spend.querySelector('[data-figure] [data-figure-words]')?.textContent).toBe(', includes estimates');
    expect(spend.textContent).toContain('USD 0.72 at ₹83.50 per $1');
    expect(within(spend).getByRole('button', { name: receiptMark('R-0431') })).toBeTruthy();
    expect(within(spend).queryByText('model estimate')).toBeNull();
    // No "Done this week" until the engine counts it (W4 4A).
    expect(within(glance).queryByText('Done this week')).toBeNull();
    assertInkRules(document.body);
  });

  it('another business\'s spend shows its own receipt; nobody working or waiting says so in words; no receipt, no tile', async () => {
    const { base } = start();
    await within(main()).findByRole('button', { name: 'Editor' });
    await act(async () => { await base.request('workspace.open', { folder: 'ledgerline' }); });
    const glance = await screen.findByRole('region', { name: 'Team at a glance' });
    const spend = (await within(glance).findByText('AI spend this month')).closest('[data-card]') as HTMLElement;
    await waitFor(() => expect(within(spend).getByRole('button', { name: receiptMark('R-0412') })).toBeTruthy());
    expect(spend.querySelector('[data-ui-number]')?.textContent).toBe('₹33.50');
    const working = within(glance).getByText('Working now').closest('[data-card]') as HTMLElement;
    expect(working.textContent).toContain('Nobody is working right now.');
    const waiting = within(glance).getByText('Waiting on you').closest('[data-card]') as HTMLElement;
    expect(waiting.textContent).toContain('Nothing waits on you.');
    expect(waiting.hasAttribute('data-tone')).toBe(false);
    assertInkRules(document.body);
  });

  it('a spend line with no receipt draws no spend tile, never a bare amount', async () => {
    start('#/team', {
      intercept: (method) => method === 'venture.money.overview'
        ? Promise.resolve({ lines: [{ id: 'spent', label: 'AI and tools this month', value: '₹60.10, includes estimates', estimate: true }] })
        : undefined,
    });
    const glance = await screen.findByRole('region', { name: 'Team at a glance' });
    await within(glance).findByText('Working now');
    await settle();
    expect(within(glance).queryByText('AI spend this month')).toBeNull();
    expect(glance.textContent).not.toContain('₹60.10');
  });

  it('the spend in rupees at the owner\'s rate shows beside it, proved by the same receipt (the part Money uses)', async () => {
    const rupees = '₹2,797.25 at ₹83.50 per $1 (your rate, set 23 Oct 2026)';
    start('#/team', {
      intercept: (method) => method === 'venture.money.overview'
        ? Promise.resolve({ lines: [{ id: 'spent', label: 'AI and tools this month', value: '$33.50', receiptId: 'R-0412', rupees }] })
        : undefined,
    });
    const glance = await screen.findByRole('region', { name: 'Team at a glance' });
    const spend = (await within(glance).findByText('AI spend this month')).closest('[data-card]') as HTMLElement;
    const group = spend.querySelector('[data-figure-group]') as HTMLElement;
    expect(group.querySelector('[data-ui-number]')!.textContent).toBe('$33.50');
    expect(group.textContent).toContain(rupees);
    expect(within(group).getByRole('button', { name: receiptMark('R-0412') })).toBeTruthy();
    assertInkRules(document.body);
  });

  it('the page line counts the agents, with the count in bold', async () => {
    start();
    await within(main()).findByRole('button', { name: 'Editor' });
    const line = screen.getByRole('heading', { level: 1, name: 'Team' }).nextElementSibling as HTMLElement;
    expect(line.textContent).toBe('4 agents.');
    expect(line.querySelector('b')?.textContent).toBe('4');
  });
});

describe('Team v2: without departments, one tile of agent cards', () => {
  it('holds the list "Agents" as cards; there is no department toggle and no department panel', async () => {
    start();
    const tile = await screen.findByRole('region', { name: 'Your agents' });
    const list = within(tile).getByRole('list', { name: 'Agents' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(4));
    for (const item of within(list).getAllByRole('listitem')) expect(item.querySelector('[data-card]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: 'Show departments' })).toBeNull();
    expect(main().querySelector('article[data-dept]')).toBeNull();
    // Avatars sit on the neutral wash: the engine has not put anyone in a department.
    for (const item of within(list).getAllByRole('listitem')) expect(avatarIn(item).getAttribute('data-dept')).toBe('none');
    assertInkRules(document.body);
  });

  it('an agent card: ring from its run, the name opens the agent panel, the now line opens the run, bar, posture, last result', async () => {
    start();
    const editor = await cardOf('Editor');
    await waitFor(() => expect(avatarIn(editor).getAttribute('data-state')).toBe('working'));
    expect(editor.textContent).toContain('Cuts episodes and shorts');
    expect(within(editor).getByRole('img', { name: '3 of 5 steps done' })).toBeTruthy();
    expect(editor.textContent).toContain('4m');
    expect(within(editor).getByText('Asks each time')).toBeTruthy();
    // At work, the card says what it does now, not its last result (4A2 review).
    expect(editor.textContent).not.toContain('Episode 14 cut, 11 min 42 s');
    // W4 4B3: the quiet Chat button (team-chat.test.tsx holds what it does).
    expect(within(editor).getByRole('button', { name: 'Chat with Editor' }).getAttribute('data-variant')).toBe('chat');
    await click(within(editor).getByRole('button', { name: 'Cutting shorts from episode 13' }));
    expect(window.location.hash).toBe('#/team?sheet=run%3A31');
    await click(screen.getByRole('button', { name: /^Close/ }));
    await click(within(await cardOf('Editor')).getByRole('button', { name: 'Editor' }));
    expect(window.location.hash).toBe('#/team?sheet=agent%3Aeditor');
  });

  it('a waiting agent: amber ring, "Waiting on you" in wait words then what it waits on, a waiting bar, and no clock', async () => {
    start('#/team', {
      // The engine's own "now" line for a waiting agent may say anything; the card says the wait in the UI's words.
      intercept: (method, _p, base) => method === 'venture.team.list'
        ? base.request('venture.team.list', {}).then((view) => ({ agents: view.agents.map((a) => (a.id === 'producer' ? { ...a, now: 'Asked about the preview' } : a)) }))
        : undefined,
    });
    const producer = await cardOf('Producer');
    await waitFor(() => expect(avatarIn(producer).getAttribute('data-state')).toBe('waiting'));
    const now = within(producer).getByRole('button', { name: 'Waiting on you' });
    expect(now.getAttribute('data-waiting')).toBe('');
    expect(now.closest('p')!.textContent).toBe('Waiting on you Pricing the sponsor slot');
    expect(within(producer).getByRole('img', { name: '2 of 3 steps done, waiting on you' })).toBeTruthy();
    // 4Z2: no "paused" beside "Waiting on you": one state, said once.
    expect(producer.textContent).not.toContain('paused');
    expect(producer.textContent).not.toContain('6m');
  });

  it('unmeasured work has a still bar with no count; an idle agent has no ring and no bar', async () => {
    start();
    const researcher = await cardOf('Researcher');
    await waitFor(() => expect(within(researcher).getByRole('img', { name: 'No step count yet' })).toBeTruthy());
    expect(avatarIn(researcher).getAttribute('data-state')).toBe('working');
    const publisher = await cardOf('Publisher');
    expect(avatarIn(publisher).hasAttribute('data-state')).toBe(false);
    expect(within(publisher).queryByRole('img')).toBeNull();
    expect(within(publisher).getByText('Rehearsing')).toBeTruthy();
  });

  it('an agent whose latest run stopped has the red ring', async () => {
    start('#/team', {
      intercept: (method, params, base) => method === 'venture.runs.list'
        ? base.request('venture.runs.list', params as never).then((r) => ({ runs: r.runs.filter((one) => one.runId !== '31') }))
        : undefined,
    });
    const editor = await cardOf('Editor');
    await waitFor(() => expect(avatarIn(editor).getAttribute('data-state')).toBe('failed'));
  });

  it('active agents come first in the engine order; idle agents past eight fold behind "Show n idle"', async () => {
    const many = (base: FakeClient) => base.request('venture.team.list', {}).then((view) => ({
      agents: [
        ...Array.from({ length: 9 }, (_, i) => agent(`idle-${i}`, `Helper ${String.fromCharCode(65 + i)}`)),
        ...view.agents,
      ],
    }));
    start('#/team', { intercept: (method, _p, base) => (method === 'venture.team.list' ? many(base) : undefined) });
    const list = await screen.findByRole('list', { name: 'Agents' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(8));
    const names = within(list).getAllByRole('listitem').map((li) => li.querySelector('[data-open]')!.textContent);
    expect(names.slice(0, 3)).toEqual(['Editor', 'Researcher', 'Producer']);
    const fold = within(main()).getByRole('button', { name: 'Show 5 idle' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    await click(fold);
    expect(within(list).getAllByRole('listitem')).toHaveLength(13);
    expect(within(main()).queryByRole('button', { name: /^Show \d+ idle$/ })).toBeNull();
  });
});

describe('Team v2: a department panel', () => {
  const members: Member[] = [
    { agent: agent('editor', 'Editor', { now: 'Cutting shorts', posture: 'approve-each' }), run: run('31', 'Editor', { progress: { done: 3, total: 5 }, elapsed: '4m' }), state: 'working' },
  ];
  const data: DepartmentData = {
    dept: 'prod', counts: { working: 1, waiting: 0, stopped: 1, idle: 0 }, jobs: 6, spend: { value: '₹42.10', receiptId: 'R-0419' }, members,
  };

  it('is an article on its tint with the name, the counts line, jobs as a count, spend with its receipt, and its agent cards', () => {
    renderWithEngine(<DepartmentPanel data={data} />);
    const panel = screen.getByRole('article', { name: 'Production' });
    expect(panel.getAttribute('data-dept')).toBe('prod');
    expect(within(panel).getByRole('heading', { level: 2, name: 'Production' })).toBeTruthy();
    // Beside its cards, each saying its own state, the panel has no counts line of its own (4A2 review).
    expect(panel.querySelector('[data-counts]')).toBeNull();
    expect(within(panel).getByText('6').hasAttribute('data-count')).toBe(true);
    expect(within(panel).getByText('done this week')).toBeTruthy();
    // The spend under the head: the figure with its receipt (Money's ProvedFigure), after the words "This month".
    const spend = panel.querySelector('[data-figure]') as HTMLElement;
    expect(spend.textContent).toContain('₹42.10');
    expect(within(spend).getByRole('button', { name: receiptMark('R-0419') })).toBeTruthy();
    expect(spend.closest('p')!.textContent).toContain('This month');
    expect(within(panel).getByRole('list', { name: 'Production agents' })).toBeTruthy();
    const editor = within(panel).getByRole('button', { name: 'Editor' }).closest('li') as HTMLElement;
    expect(avatarIn(editor).getAttribute('data-dept')).toBe('prod');
    expect(avatarIn(editor).getAttribute('data-state')).toBe('working');
    // A tinted panel holds cards: it is never a card itself.
    expect(panel.hasAttribute('data-card')).toBe(false);
    assertInkRules(document.body);
  });

  it('a waiting count reads in the amber that holds on a tint, and plural forms follow the counts', () => {
    renderWithEngine(<DepartmentPanel data={{ ...data, dept: 'sales', counts: { working: 0, waiting: 2, stopped: 2, idle: 3 }, members: [] }} />);
    const panel = screen.getByRole('article', { name: 'Sales and clients' });
    const wait = within(panel).getByText('2 waiting on you');
    expect(wait.getAttribute('data-tone')).toBe('wait');
    expect(panel.textContent).toContain('2 runs failed');
    expect(panel.textContent).toContain('3 idle');
    // A department with nobody in it says so and points to the ways to earn (spec section 8).
    expect(within(panel).getByText('No agents in Sales and clients yet.')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'See ways to earn' }).getAttribute('href')).toBe('#/onboarding?dept=sales');
    const css = readFileSync(join(import.meta.dirname, '../../src/places/team/Team.module.css'), 'utf8');
    expect(css).toMatch(/\[data-tone='wait'\][^{]*\{[^}]*color: var\(--wait-strong\)/);
  });
});

describe('Team v2: with departments from the engine', () => {
  it('shows the toggle and one tinted panel per department the engine lists, an empty one with its way forward', async () => {
    start('#/team', { intercept: withDepartments });
    const toggle = await screen.findByRole('group', { name: 'Show departments' });
    expect(within(toggle).getAllByRole('button').map((b) => b.textContent)).toEqual(['All departments', 'Sales and clients', 'Marketing', 'Production', 'Money', 'Operations']);
    expect(within(toggle).getByRole('button', { name: 'All departments' }).getAttribute('aria-pressed')).toBe('true');
    const panels = within(main()).getAllByRole('article').filter((a) => a.hasAttribute('data-dept'));
    expect(panels.map((p) => p.getAttribute('data-dept'))).toEqual(['sales', 'mkt', 'prod', 'money', 'ops']);
    const marketing = within(main()).getByRole('article', { name: 'Marketing' });
    expect(within(within(marketing).getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
    const money = within(main()).getByRole('article', { name: 'Money' });
    expect(within(money).queryByRole('list', { name: 'Money agents' })).toBeNull();
    expect(within(money).getByText('No agents in Money yet.')).toBeTruthy();
    expect(within(money).getByRole('link', { name: 'See ways to earn' }).getAttribute('href')).toBe('#/onboarding?dept=money');
    expect(screen.queryByRole('region', { name: 'Your agents' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Team' }).nextElementSibling!.textContent).toBe('4 agents in 3 departments.');
    assertInkRules(document.body);
  });

  it('the toggle shows one department at a time, held in the address', async () => {
    start('#/team', { intercept: withDepartments });
    const toggle = await screen.findByRole('group', { name: 'Show departments' });
    await click(within(toggle).getByRole('button', { name: 'Production' }));
    expect(window.location.hash).toBe('#/team?dept=prod');
    expect(within(toggle).getByRole('button', { name: 'Production' }).getAttribute('aria-pressed')).toBe('true');
    const hero = await within(main()).findByRole('region', { name: 'Production' });
    expect(hero.getAttribute('data-dept')).toBe('prod');
    expect(within(main()).queryByRole('article', { name: 'Marketing' })).toBeNull();
    await click(within(toggle).getByRole('button', { name: 'All departments' }));
    expect(window.location.hash).toBe('#/team');
  });

  it('an address with a department opens on it; one with no agents says so and offers ways to earn', async () => {
    start('#/team?dept=money', { intercept: withDepartments });
    expect(await within(main()).findByText('No agents in Money yet.')).toBeTruthy();
    expect(within(main()).getByRole('link', { name: 'See ways to earn' }).getAttribute('href')).toBe('#/onboarding?dept=money');
  });

  for (const hash of ['#/team', '#/team?dept=prod']) {
    it(`passes axe with departments at ${hash}`, async () => {
      const { container } = start(hash, { intercept: withDepartments });
      await screen.findByRole('group', { name: 'Show departments' });
      await within(main()).findAllByRole(hash.includes('dept=') ? 'switch' : 'article');
      await settle();
      const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
      expect(result.violations.flatMap((v) => v.nodes.map((node) => `${v.id}: ${node.target.join(' ')}`))).toEqual([]);
    });
  }
});

describe('Team v2: one department', () => {
  const editor = agent('editor', 'Editor', {
    now: 'Cutting shorts', steps: [
      { id: 'cut', purpose: 'Cut the episode', gate: 'auto', floor: false },
      { id: 'finish', purpose: 'Finishing check', gate: 'hold', floor: false },
      { id: 'publish', purpose: 'Publish to YouTube', gate: 'hold', floor: true },
    ],
  });
  const data: DepartmentData = {
    dept: 'prod', counts: { working: 1, waiting: 0, stopped: 1, idle: 0 }, jobs: 6, spend: { value: '₹42.10', receiptId: 'R-0419' },
    members: [{ agent: editor, run: run('31', 'Editor', { progress: { done: 3, total: 5 } }), state: 'working' }],
    runs: [
      run('31', 'Editor', { purpose: 'Cutting shorts', progress: { done: 3, total: 5 } }),
      run('28', 'Editor', { purpose: 'Rendering the thumbnail set', state: 'failed', result: 'Stopped: ffmpeg was not found on this computer.' }),
    ],
  };

  it('a hero panel with three stat boxes, the flow with gates, and recent work', () => {
    renderWithEngine(<OneDepartment data={data} />);
    const hero = screen.getByRole('region', { name: 'Production' });
    expect(hero.getAttribute('data-dept')).toBe('prod');
    expect(within(hero).getByText('done this week').closest('div')!.querySelector('[data-count]')!.textContent).toBe('6');
    expect(within(hero).getByRole('button', { name: receiptMark('R-0419') })).toBeTruthy();
    expect(within(hero).getByText('playbook steps').closest('div')!.querySelector('[data-count]')!.textContent).toBe('3');
    expect(within(hero).getByText('1 working')).toBeTruthy();
    expect(within(hero).getByText('1 run failed')).toBeTruthy();

    const flow = screen.getByRole('region', { name: 'How Production runs' });
    const steps = within(flow).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(within(steps[0]!).getByRole('switch', { name: 'Cut the episode: Auto runs without asking, Hold waits for you' }).getAttribute('aria-checked')).toBe('true');
    expect(within(steps[1]!).getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(within(steps[2]!).queryByRole('switch')).toBeNull();
    expect(steps[2]!.textContent).toContain('Always asks you');
    // No version line until the engine versions the playbook (W4 4B).
    expect(flow.textContent).not.toContain('You can undo it.');

    const recent = screen.getByRole('region', { name: 'Recent work' });
    const cards = within(recent).getAllByRole('article');
    expect(cards.map((c) => within(c).getByRole('heading', { level: 3 }).textContent)).toEqual(['Cutting shorts', 'Rendering the thumbnail set']);
    expect(cards[1]!.querySelector('[data-tone="fail"]')!.textContent).toBe('Failed');
    expect(cards[1]!.textContent).toContain('ffmpeg was not found');
    assertInkRules(document.body);
  });

  it('says which version a change makes only when a version is given', () => {
    renderWithEngine(<OneDepartment data={{ ...data, version: { current: 4, next: 5 } }} />);
    const flow = screen.getByRole('region', { name: 'How Production runs' });
    expect(flow.textContent).toContain('An instruction change makes version 5. You can undo it.');
  });

  it('with no agents: one sentence and a link to the ways to earn', () => {
    renderWithEngine(<OneDepartment data={{ dept: 'ops', counts: { working: 0, waiting: 0, stopped: 0, idle: 0 }, members: [] }} />);
    expect(screen.getByText('No agents in Operations yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See ways to earn' }).getAttribute('href')).toBe('#/onboarding?dept=ops');
    expect(screen.queryByRole('region', { name: 'How Operations runs' })).toBeNull();
  });

  const finishSwitch = () => within(screen.getByRole('region', { name: 'How Production runs' }))
    .getByRole('switch', { name: 'Finishing check: Auto runs without asking, Hold waits for you' });

  it('a flow gate keeps the engine\'s answer while the team is read again, and if that read never lands', async () => {
    let reloads = 0;
    renderWithEngine(<OneDepartment data={data} onChanged={() => { reloads += 1; }} />);
    expect(finishSwitch().getAttribute('aria-checked')).toBe('false');
    await act(async () => { fireEvent.click(finishSwitch()); });
    await waitFor(() => expect(reloads).toBe(1));
    await settle();
    // The props still say Hold (the reload has not landed); the switch holds the engine's reply, Auto.
    expect(finishSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('a refused flow gate says why under its step and goes back', async () => {
    const base = createFakeClient(new FakeEngine());
    const client: EngineClient = {
      ...base,
      request: ((method: string, params?: Record<string, unknown>) => (method === 'venture.team.gate'
        ? Promise.reject(new EngineError('OFFLINE', 'The engine is not answering.'))
        : base.request(method as never, params as never))) as EngineClient['request'],
    };
    render(<EngineProvider client={client}><TextProvider language="en"><OneDepartment data={data} /></TextProvider></EngineProvider>);
    await act(async () => { fireEvent.click(finishSwitch()); });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Couldn't change this: The engine is not answering.");
    expect(alert.closest('li')!.textContent).toContain('Finishing check');
    expect(finishSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('on a narrow page each stat box takes its own row, so a long figure is never cut', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/places/team/Team.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const narrow = /@container team \(max-width: 439px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(narrow).toMatch(/\.heroStat \{[^}]*flex: 1 1 100%/);
    // Nowhere may a stat box shrink below its figure.
    for (const [, body] of css.matchAll(/\.heroStat \{([^}]*)\}/g)) expect(body).not.toMatch(/min-width: 0/);
    expect(css).toMatch(/\.heroStat \{[^}]*flex: none/);
  });
});

describe('Team v2: the agent panel', () => {
  const openPanel = async (name = 'Editor') => {
    await click(await within(main()).findByRole('button', { name }));
    return screen.findByRole('complementary', { name });
  };

  it('is the 440 px panel with the avatar, role and state words, and a close button named for the agent', async () => {
    start();
    const panel = await openPanel();
    expect(panel.getAttribute('data-width')).toBe('panel');
    expect(avatarIn(panel).getAttribute('data-state')).toBe('working');
    expect(panel.querySelector('header')!.textContent).toContain('Cuts episodes and shorts');
    expect(panel.querySelector('header')!.textContent).toContain('Working');
    await click(within(panel).getByRole('button', { name: 'Close Editor' }));
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
  });

  // W4 4B3: Steps became Instructions (still first shown, still holding the posture and the steps' gates), with Chat
  // before it and Notes after Runs; the tabs and their keys are tested in full in team-chat.test.tsx.
  it('opens on Instructions; arrow keys, Home and End move between the tabs', async () => {
    start();
    const panel = await openPanel();
    const tabs = within(panel).getByRole('tablist', { name: 'Editor' });
    const [chat, steps, runs, notes] = within(tabs).getAllByRole('tab');
    expect([chat!.textContent, notes!.textContent]).toEqual(['Chat', 'Notes']);
    expect(steps!.textContent).toMatch(/^Instructions/);
    expect(runs!.textContent).toMatch(/^Runs/);
    expect(steps!.getAttribute('aria-selected')).toBe('true');
    expect(within(panel).getByRole('tabpanel', { name: /^Instructions/ })).toBeTruthy();
    await act(async () => { steps!.focus(); fireEvent.keyDown(steps!, { key: 'ArrowRight' }); });
    expect(runs!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(runs);
    expect(within(panel).getByRole('tabpanel', { name: 'Runs' })).toBeTruthy();
    await act(async () => { fireEvent.keyDown(runs!, { key: 'Home' }); });
    expect(chat!.getAttribute('aria-selected')).toBe('true');
    // W4 4J22b: Can do comes after Notes, so End is Can do and Left from there is Notes.
    const all = within(tabs).getAllByRole('tab');
    await act(async () => { fireEvent.keyDown(chat!, { key: 'End' }); });
    expect(all.at(-1)!.getAttribute('aria-selected')).toBe('true');
    await act(async () => { fireEvent.keyDown(all.at(-1)!, { key: 'ArrowLeft' }); });
    expect(all.at(-2)!.getAttribute('aria-selected')).toBe('true');
  });

  it('Steps: the postures as radio cards, each with what it means, and the steps with their gates', async () => {
    start();
    const panel = await openPanel();
    const group = within(panel).getByRole('group', { name: 'Posture' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(4);
    const shadow = within(group).getByRole('radio', { name: 'Shadow' });
    expect(shadow.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(shadow.getAttribute('aria-describedby')!)!.textContent).toBe('Works on real orders, but anything outside Chausar is only simulated.');
    for (const radio of radios) expect(radio.closest('[data-choice]')).not.toBeNull();
    expect(radios.find((r) => r.checked)!.closest('[data-choice]')!.hasAttribute('data-chosen')).toBe(true);
    expect(within(within(panel).getByRole('list', { name: 'Steps' })).getAllByRole('listitem')).toHaveLength(4);
    assertInkRules(document.body);
  });

  it('Steps: no spend figure without its receipt; the spend, call by call, is one link away in Money', async () => {
    start();
    const panel = await openPanel();
    const spend = within(panel).getByRole('heading', { level: 3, name: 'Spend so far' }).closest('section')!;
    expect(spend.textContent).not.toContain('₹42.10');
    expect(within(spend as HTMLElement).getByRole('link', { name: 'See spend in Money' }).getAttribute('href')).toBe('#/money/spend');
  });

  it('Runs: its runs with rings and state words, each opening the run sheet', async () => {
    start();
    const panel = await openPanel();
    await click(within(panel).getByRole('tab', { name: 'Runs' }));
    const runs = await within(panel).findByRole('list', { name: 'Runs' });
    const items = within(runs).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole('img', { name: '3 of 5 steps done' })).toBeTruthy();
    expect(within(items[0]!).getByText('Working')).toBeTruthy();
    expect(within(items[1]!).getByRole('img', { name: '1 of 3 steps done, failed' })).toBeTruthy();
    expect(within(items[1]!).getByText('Failed')).toBeTruthy();
    await click(within(items[1]!).getByRole('button', { name: 'Rendering the thumbnail set' }));
    expect(window.location.hash).toBe('#/team?sheet=run%3A28');
    assertInkRules(document.body);
  });

  it('passes axe on both tabs', async () => {
    const { container } = start();
    const panel = await openPanel();
    await settle();
    const check = async () => (await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] }))
      .violations.flatMap((v) => v.nodes.map((node) => `${v.id}: ${node.target.join(' ')}`));
    expect(await check()).toEqual([]);
    await click(within(panel).getByRole('tab', { name: 'Runs' }));
    await settle();
    expect(await check()).toEqual([]);
  });
});

describe('Team v2: Hindi', () => {
  it('renders the place, a department panel and the agent panel with no key showing as text', async () => {
    start('#/team', { language: 'hi', intercept: withDepartments });
    await screen.findByRole('group', { name: 'विभाग दिखाएँ' });
    await settle();
    // The waiting agent's card says the wait in Hindi, before the engine's own words for what it waits on.
    const waiting = within(main()).getByRole('button', { name: 'आपका इंतज़ार' });
    expect(waiting.closest('p')!.textContent).toBe('आपका इंतज़ार Pricing the sponsor slot');
    await click(within(main()).getAllByRole('button').find((b) => b.textContent === 'Editor')!);
    const panel = await screen.findByRole('complementary', { name: 'Editor' });
    await click(within(panel).getAllByRole('tab')[1]!);
    await settle();
    const texts = [...document.body.querySelectorAll('*')].flatMap((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()));
    expect(texts.filter((text) => KEY_LIKE.test(text))).toEqual([]);
    const labels = [...document.body.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label')!);
    expect(labels.filter((text) => KEY_LIKE.test(text))).toEqual([]);
  });
});
