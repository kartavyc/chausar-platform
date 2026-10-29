import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type AgentHealth, type EngineClient, type TeamListView } from '../../src/engine/types';
import { NARROW } from '../../src/shell/useNarrow';
import { assertFiguresProved, assertInkRules, assertOnePrimary, receiptMark } from '../helpers/ink-rules';

/*
 * Team with the engine's departments, Keeper and health (Ink v2 wave 4, package 4A2; spec 5.1). The fake engine
 * answers venture.team.list as 4A1's engine does: each agent's department, kind, state and health, Keeper last, the five
 * departments with their counts, jobs (and their bars against the busiest department), spend in US dollars with the
 * rupees beside at the owner's rate, and the six-week series, and the team's totals; venture.team.keeper and
 * venture.team.clearQuarantine too.
 */

type FakeClient = ReturnType<typeof createFakeClient>;
type Intercept = (method: string, params: Record<string, unknown>, base: FakeClient) => Promise<unknown> | undefined;

const RATE = 'at ₹83.50 per $1 (your rate, set 15 Oct 2026)';

function start(hash = '#/team', options: { language?: 'en' | 'hi'; intercept?: Intercept } = {}) {
  window.location.hash = hash;
  const base = createFakeClient(new FakeEngine());
  const spy = vi.fn();
  const client: EngineClient = {
    ...base,
    request: ((method: string, params?: Record<string, unknown>) => {
      spy(method, params);
      return options.intercept?.(method, params ?? {}, base) ?? base.request(method as never, params as never);
    }) as EngineClient['request'],
  };
  const view = render(<App client={client} language={options.language ?? 'en'} />);
  return { base, spy, ...view };
}

function phone() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

afterEach(() => { vi.restoreAllMocks(); });

const hashChanged = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const click = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); hashChanged(); }); };
const main = () => screen.getByRole('main');
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const panel = (name: string) => within(main()).findByRole('article', { name });
const cardOf = async (name: string) => (await within(main()).findByRole('button', { name })).closest('li') as HTMLElement;
const assertPlace = () => { assertInkRules(document.body); assertFiguresProved(document.body); assertOnePrimary(document.body); };

/** The team as the engine lists it, with one agent's health changed. */
const withHealth = (agentId: string, health: Omit<AgentHealth, 'digest'>): Intercept => (method, _p, base) => method === 'venture.team.list'
  ? base.request('venture.team.list', {}).then((view): TeamListView => ({
      ...view, agents: view.agents.map((agent) => (agent.id === agentId ? { ...agent, health: { ...health, digest: 'd'.repeat(64) } } : agent)),
    }))
  : undefined;

/** Ledgerline: Billing is quarantined in the sample. */
async function ledgerline(base: FakeClient) {
  await within(main()).findByRole('button', { name: 'Editor' });
  await act(async () => { await base.request('workspace.open', { folder: 'ledgerline' }); });
}

describe('Team w4: the department toggle and panels from the engine', () => {
  it('shows the toggle and five tinted panels in the engine order; a head has its jobs and its spend in dollars with the rupees beside, under one receipt', async () => {
    start();
    const toggle = await screen.findByRole('group', { name: 'Show departments' });
    expect(within(toggle).getAllByRole('button').map((b) => b.textContent)).toEqual(['All departments', 'Sales and clients', 'Marketing', 'Production', 'Money', 'Operations']);
    await panel('Production');
    const panels = within(main()).getAllByRole('article').filter((a) => a.hasAttribute('data-dept'));
    expect(panels.map((p) => p.getAttribute('data-dept'))).toEqual(['sales', 'mkt', 'prod', 'money', 'ops']);

    const production = await panel('Production');
    expect(production.querySelector('[data-count]')?.textContent).toBe('4');
    const spend = production.querySelector('[data-figure-group]') as HTMLElement;
    // 4Z3: rupees lead; the dollars beside, without the rate: the page says the rate once, in the stats tile.
    expect(spend.querySelector('[data-ui-number]')?.textContent).toBe('₹38.00');
    expect(spend.textContent).toContain('USD 0.46');
    expect(spend.textContent).not.toContain('per $1');
    expect(within(spend).getAllByRole('button', { name: receiptMark(/^R-0/) })).toHaveLength(1);
    expect(within(production).getByRole('button', { name: 'Editor' })).toBeTruthy();
    assertPlace();
  });

  it('folds what repeats: no counts line beside the cards, no held line on a panel, no stats on an empty panel, a one-sentence page line', async () => {
    start();
    const production = await panel('Production');
    expect(production.querySelector('[data-counts]')).toBeNull();
    const marketing = await panel('Marketing');
    expect(marketing.querySelector('[data-held]')).toBeNull();
    const money = await panel('Money');
    expect(money.querySelector('[data-count]')).toBeNull();
    expect(money.querySelector('[data-figure-group]')).toBeNull();
    expect(within(money).getByText('No agents in Money yet.')).toBeTruthy();
    // A staffed department that spent nothing this month (share 0) has its jobs, and no spend line.
    const sales = await panel('Sales and clients');
    expect(sales.querySelector('[data-count]')?.textContent).toBe('1');
    expect(sales.querySelector('[data-figure]')).toBeNull();
    const line = screen.getByRole('heading', { level: 1, name: 'Team' }).nextElementSibling as HTMLElement;
    expect(line.textContent).toBe('5 agents in 4 departments.');
  });

  it('an agent at work shows what it does now, not its last result; an idle one shows its last result, with no label', async () => {
    const { base } = start();
    const editor = await cardOf('Editor');
    expect(editor.textContent).not.toContain('Episode 14 cut, 11 min 42 s');
    expect(editor.textContent).not.toContain('Last:');
    const publisher = await cardOf('Publisher');
    expect(publisher.textContent).not.toContain('Nothing finished yet.');
    await act(async () => { await base.request('workspace.open', { folder: 'ledgerline' }); });
    const bookkeeper = await cardOf('Bookkeeper');
    expect(bookkeeper.textContent).toContain('Matched 212 of 214 lines');
    expect(within(bookkeeper).getByRole('button', { name: receiptMark('R-0412') })).toBeTruthy();
    expect(bookkeeper.textContent).not.toContain('Last:');
  });

  it('the toggle holds one department in the address, and the address opens on it', async () => {
    start();
    const toggle = await screen.findByRole('group', { name: 'Show departments' });
    await click(within(toggle).getByRole('button', { name: 'Marketing' }));
    expect(window.location.hash).toBe('#/team?dept=mkt');
    expect(await within(main()).findByRole('region', { name: 'Marketing' })).toBeTruthy();
    expect(within(main()).queryByRole('article', { name: 'Production' })).toBeNull();
    await click(within(toggle).getByRole('button', { name: 'All departments' }));
    expect(window.location.hash).toBe('#/team');
  });

  it('on a phone the toggle is filter chips, each with how many agents it holds', async () => {
    phone();
    start();
    const chips = await screen.findByRole('group', { name: 'Show departments' });
    await waitFor(() => expect(within(chips).getByRole('button', { name: /^Marketing/ }).querySelector('[data-count]')?.textContent).toBe('2'));
    expect(within(chips).getByRole('button', { name: /^All departments/ }).querySelector('[data-count]')?.textContent).toBe('5');
    expect(within(chips).getByRole('button', { name: /^Money/ }).querySelector('[data-count]')?.textContent).toBe('0');
  });

  it('"Add an agent" leads to the ways to earn, where a way brings its team', async () => {
    start();
    const add = await within(main()).findByRole('link', { name: 'Add an agent' });
    expect(add.getAttribute('href')).toBe('#/onboarding');
  });

  it('without departments from the engine (an engine before 4A1), the agents sit in one tile and there is no toggle', async () => {
    start('#/team', { intercept: (method, _p, base) => method === 'venture.team.list' ? base.request('venture.team.list', {}).then((view) => ({ agents: view.agents })) : undefined });
    expect(await screen.findByRole('list', { name: 'Agents' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Show departments' })).toBeNull();
  });
});

describe('Team w4: jobs done this week', () => {
  it('one bar per department scaled by the engine, with its count; the spend is said once, on the panels', async () => {
    start();
    const tile = await within(main()).findByRole('region', { name: 'Jobs done this week' });
    expect(tile.textContent).toContain('8 in all');
    const rows = [...tile.querySelectorAll('[data-key]')];
    expect(rows.map((row) => row.getAttribute('data-key'))).toEqual(['sales', 'marketing', 'production', 'money', 'operations']);
    const production = tile.querySelector('[data-key="production"]') as HTMLElement;
    expect(production.querySelector('meter')?.getAttribute('value')).toBe('1000');
    expect(production.textContent).toContain('4');
    expect(production.textContent).not.toContain('USD');
    expect(tile.querySelector('[data-key="sales"] meter')?.getAttribute('value')).toBe('250');
    assertPlace();
  });
});

describe('Team w4: one department', () => {
  it('#/team?dept=prod: the hero with three stat boxes and the rupees beside the spend, how it runs with its gates and the version a change makes, recent work', async () => {
    start('#/team?dept=prod');
    const hero = await within(main()).findByRole('region', { name: 'Production' });
    expect(hero.querySelectorAll('[data-count]')).toHaveLength(2);
    expect(hero.querySelectorAll('[data-figure]')).toHaveLength(1);
    // 4Z3: rupees lead, the dollars beneath with two decimals and the rate.
    expect(hero.querySelector('[data-figure] [data-ui-number]')?.textContent).toBe('₹38.00');
    expect(hero.textContent).toContain('USD 0.46 at ₹83.50 per $1');
    // The rate once on the page: beside the hero's figure, not again after the held words.
    expect(main().textContent!.split('per $1').length - 1).toBe(1);
    const flow = await within(main()).findByRole('region', { name: 'How Production runs' });
    expect(within(flow).queryByText('Publish to YouTube')).toBeNull();
    expect(within(flow).getByRole('switch', { name: 'Finishing check: Auto runs without asking, Hold waits for you' }).getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(flow.textContent).toMatch(/An instruction change makes version \d+\. You can undo it\./));
    expect(await within(main()).findByRole('region', { name: 'Recent work' })).toBeTruthy();
    await settle();
    assertPlace();
  });

  it('spend and jobs by week: short dates from each week\'s key, the jobs as bars and each week\'s spend under it with its own receipt', async () => {
    start('#/team?dept=prod');
    const chart = await within(main()).findByRole('region', { name: 'Spend and jobs' });
    const labels = [...chart.querySelectorAll('[data-key]')].map((column) => column.getAttribute('data-key'));
    expect(labels).toEqual(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
    expect(chart.textContent).toContain('14 Sep');
    expect(chart.textContent).toContain('19 Oct');
    expect(chart.textContent).not.toContain('Week of');
    expect(chart.textContent).toContain('₹3.80');
    expect(within(chart).getByText('View chart data')).toBeTruthy();
    expect(chart.querySelectorAll('[data-receipt]').length).toBeGreaterThanOrEqual(6);
    assertPlace();
  });

  it('Operations, Keeper alone: Keeper\'s jobs open as rows; no steps to gate and no weeks with jobs, so no flow and no chart', async () => {
    start('#/team?dept=ops');
    const keeper = await cardOf('Keeper');
    expect(keeper.querySelector('details')).toBeNull();
    const jobs = await within(keeper).findByRole('list', { name: "Keeper's jobs" });
    expect(within(jobs).getAllByRole('listitem')).toHaveLength(7);
    await settle();
    expect(within(main()).queryByRole('region', { name: 'How Operations runs' })).toBeNull();
    expect(within(main()).queryByRole('region', { name: 'Spend and jobs' })).toBeNull();
  });

  it('a department with no agents says so in one sentence and links to the ways to earn for it', async () => {
    start('#/team?dept=money');
    expect(await within(main()).findByText('No agents in Money yet.')).toBeTruthy();
    expect(within(main()).getByRole('link', { name: 'See ways to earn' }).getAttribute('href')).toBe('#/onboarding?dept=money');
  });
});

describe('Team w4: Keeper', () => {
  it('is code, not AI: a chip says so, no Chat button, no posture, and one row per job with its last run or the engine\'s note', async () => {
    start();
    const keeper = await cardOf('Keeper');
    expect(within(keeper).getByText('Runs as code, not AI')).toBeTruthy();
    expect(within(keeper).queryByRole('button', { name: /chat/i })).toBeNull();
    expect(keeper.querySelector('[data-posture]')).toBeNull();
    const jobs = await within(keeper).findByRole('list', { name: "Keeper's jobs" });
    const rows = within(jobs).getAllByRole('listitem');
    expect(rows).toHaveLength(7);
    const row = (name: string) => rows.find((one) => one.textContent?.includes(name))!;
    expect(row('Backups').textContent).toContain('Done');
    expect(row('Backups').textContent).toContain('2 automatic backups kept on this computer.');
    expect(row('Platform rule dates').querySelector('[data-tone="wait"]')?.textContent).toBe('Look at this');
    // No run: the engine's note says why, once, in its own words.
    expect(row('Connection checks').textContent).toBe('Connection checksNot run yet.');
    expect(row('Tax rate tables').textContent).toBe('Tax rate tablesNot needed for this business.');
    assertPlace();
  });

  it('a job with no run and no note says "Not run yet" in the UI\'s words', async () => {
    start('#/team?dept=ops', {
      intercept: (method) => method === 'venture.team.keeper'
        ? Promise.resolve({ jobs: [{ id: 'connection-checks', name: 'Connection checks', lastRun: null, note: null }] })
        : undefined,
    });
    const jobs = await within(await cardOf('Keeper')).findByRole('list', { name: "Keeper's jobs" });
    expect(within(jobs).getByRole('listitem').textContent).toBe('Connection checksNot run yet');
  });

  it('its panel shows the same jobs and no posture to choose', async () => {
    start();
    await click(await within(main()).findByRole('button', { name: 'Keeper' }));
    const sheet = await screen.findByRole('complementary', { name: 'Keeper' });
    expect(within(sheet).getByText('Runs as code, not AI')).toBeTruthy();
    expect(await within(sheet).findByRole('list', { name: "Keeper's jobs" })).toBeTruthy();
    expect(within(sheet).queryByRole('radiogroup')).toBeNull();
    expect(within(sheet).queryByRole('group', { name: 'Posture' })).toBeNull();
  });
});

describe('Team w4: health', () => {
  it('a quarantined agent says so in fail words with the reason; Clear quarantine asks once more, then sends the digest it saw', async () => {
    const { base, spy } = start();
    await ledgerline(base);
    const billing = await cardOf('Billing');
    const health = billing.querySelector('[data-health]') as HTMLElement;
    expect(health.querySelector('[data-tone="fail"]')?.textContent).toBe('Quarantined');
    expect(health.textContent).toContain('It proposed an outside action that none of its steps allows.');
    const listed = (await base.request('venture.team.list', {})).agents.find((agent) => agent.id === 'billing')!;
    await click(within(billing).getByRole('button', { name: 'Clear quarantine' }));
    expect(spy).not.toHaveBeenCalledWith('venture.team.clearQuarantine', expect.anything());
    expect(within(billing).getByText('It can start new work again. Clear it?')).toBeTruthy();
    // Focus moves to the question's answer, so a keyboard or screen reader user lands on it.
    expect(document.activeElement).toBe(within(billing).getByRole('button', { name: 'Yes, clear it' }));
    assertOnePrimary(document.body);
    await click(within(billing).getByRole('button', { name: 'Yes, clear it' }));
    expect(spy).toHaveBeenCalledWith('venture.team.clearQuarantine', { agentId: 'billing', digest: listed.health!.digest });
    await waitFor(async () => expect((await cardOf('Billing')).querySelector('[data-health]')).toBeNull());
    assertPlace();
  });

  it('"Keep it" asks nothing of the engine and puts focus back on Clear quarantine', async () => {
    const { base, spy } = start();
    await ledgerline(base);
    const billing = await cardOf('Billing');
    await click(within(billing).getByRole('button', { name: 'Clear quarantine' }));
    await click(within(billing).getByRole('button', { name: 'Keep it' }));
    expect(spy).not.toHaveBeenCalledWith('venture.team.clearQuarantine', expect.anything());
    expect(document.activeElement).toBe(within(billing).getByRole('button', { name: 'Clear quarantine' }));
  });

  it('a stale clear is said in the engine words and the team is read again, so the health shown is the one now', async () => {
    const { base, spy } = start('#/team', {
      intercept: (method) => method === 'venture.team.clearQuarantine'
        ? Promise.reject(new EngineError('APPROVAL_STALE', "This agent's health changed since you looked, or it is not quarantined now. Look again before clearing it."))
        : undefined,
    });
    await ledgerline(base);
    const billing = await cardOf('Billing');
    const reads = () => spy.mock.calls.filter(([method]) => method === 'venture.team.list').length;
    const before = reads();
    await click(within(billing).getByRole('button', { name: 'Clear quarantine' }));
    await click(within(billing).getByRole('button', { name: 'Yes, clear it' }));
    expect(await within(main()).findByText(/health changed since you looked/)).toBeTruthy();
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });

  it('degraded says its reason in wait words; healthy says nothing', async () => {
    start('#/team', { intercept: withHealth('researcher', { status: 'degraded', reason: "The playbook is producing work people don't want. Revise it." }) });
    const researcher = await cardOf('Researcher');
    await waitFor(() => expect(researcher.querySelector('[data-health]')).not.toBeNull());
    const health = researcher.querySelector('[data-health]') as HTMLElement;
    expect(health.querySelector('[data-tone="wait"]')?.textContent).toBe('Needs a look');
    expect(health.textContent).toContain("The playbook is producing work people don't want. Revise it.");
    expect(within(researcher).queryByRole('button', { name: 'Clear quarantine' })).toBeNull();
    expect((await cardOf('Editor')).querySelector('[data-health]')).toBeNull();
  });

  it('failing says its reason in fail words, with nothing to clear', async () => {
    start('#/team', { intercept: withHealth('editor', { status: 'failing', reason: 'Its last 2 runs failed.' }) });
    const editor = await cardOf('Editor');
    await waitFor(() => expect(editor.querySelector('[data-health]')).not.toBeNull());
    expect(editor.querySelector('[data-health] [data-tone="fail"]')?.textContent).toBe('Failing');
    expect(editor.textContent).toContain('Its last 2 runs failed.');
    expect(within(editor).queryByRole('button', { name: 'Clear quarantine' })).toBeNull();
  });

  it('a team quarantine no agent can claim shows above the departments and clears with the team id', async () => {
    const { spy } = start('#/team', {
      intercept: (method, _p, base) => method === 'venture.team.list'
        ? base.request('venture.team.list', {}).then((view): TeamListView => ({ ...view, teamHealth: { status: 'quarantined', reason: 'An outside action was proposed in a turn no single agent can claim.', digest: 'e'.repeat(64) } }))
        : method === 'venture.team.clearQuarantine' ? Promise.resolve({ agent: null, teamHealth: { status: 'healthy', reason: null, digest: 'f'.repeat(64) } }) : undefined,
    });
    const team = await within(main()).findByRole('region', { name: 'The team' });
    expect(team.textContent).toContain('Quarantined');
    await click(within(team).getByRole('button', { name: 'Clear quarantine' }));
    await click(within(team).getByRole('button', { name: 'Yes, clear it' }));
    expect(spy).toHaveBeenCalledWith('venture.team.clearQuarantine', { agentId: 'team', digest: 'e'.repeat(64) });
  });
});

describe('Team w4: the stats tiles from the team totals', () => {
  it('"Done this week" counts the jobs with the departments\' bars beside; the AI spend is Money\'s own figure, the rupees beside and the held line under its receipt', async () => {
    start();
    const glance = await screen.findByRole('region', { name: 'Team at a glance' });
    const done = (await within(glance).findByText('Done this week')).closest('[data-card]') as HTMLElement;
    expect(done.querySelector('[data-count]')?.textContent).toBe('8');
    expect(done.textContent).not.toContain('jobs across five departments');
    expect([...done.querySelectorAll('svg rect')].map((bar) => bar.getAttribute('height'))).toEqual(['250', '750', '1000', '0', '0']);
    const spend = within(glance).getByText('AI spend this month').closest('[data-card]') as HTMLElement;
    // 4Z3: rupees lead, the dollars beneath with two decimals and the rate.
    expect(spend.querySelector('[data-figure] [data-ui-number]')?.textContent).toBe('₹60.10');
    expect(spend.textContent).toContain('USD 0.72 at ₹83.50 per $1');
    expect(within(spend).getAllByRole('button', { name: receiptMark('R-0431') })).toHaveLength(1);
    const held = spend.querySelector('[data-held]') as HTMLElement;
    expect(held.textContent).toContain('including ₹18.00 held for running work: USD 0.22');
    expect(held.textContent).not.toContain('per $1');
    // The rate once on the page, beside the month's figure; every other spend line shows only the rupee amount.
    await panel('Production');
    expect(main().textContent!.split('per $1').length - 1).toBe(1);
    expect(within(held).getByRole('button', { name: receiptMark(/^R-0/) })).toBeTruthy();
    assertPlace();
  });
});

describe('Team w4: axe and Hindi', () => {
  for (const hash of ['#/team', '#/team?dept=prod', '#/team?dept=ops']) {
    it(`passes axe at ${hash}`, async () => {
      const { container } = start(hash);
      await screen.findByRole('group', { name: 'Show departments' });
      await within(main()).findByRole('button', { name: hash.endsWith('prod') ? 'Editor' : 'Keeper' });
      await settle();
      const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
      expect(result.violations.flatMap((v) => v.nodes.map((node) => `${v.id}: ${node.target.join(' ')}`))).toEqual([]);
    });
  }

  it('speaks Hindi: the Keeper chip, its outcome words and the stats with no key showing as text', async () => {
    start('#/team', { language: 'hi' });
    const keeper = await cardOf('Keeper');
    await within(keeper).findByRole('list');
    expect(main().textContent).not.toMatch(/\b(team|chart|dept)\.[a-zA-Z.]+/);
    expect(keeper.textContent).not.toContain('Runs as code, not AI');
  });
});
