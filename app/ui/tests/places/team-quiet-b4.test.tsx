import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient, TeamListView } from '../../src/engine/types';
import { rule } from '../helpers/css';

/** One-shot B4 task 14: Team and the agent sheet, quiet. */
const NOW = '2026-10-23T13:35:00.000Z';
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

function open(hash: string, change?: (method: string, answer: unknown) => unknown) {
  const fake = createFakeClient(new FakeEngine({ now: () => NOW }));
  const client: EngineClient = {
    ...fake,
    request: (async (method: string, params?: unknown) => {
      const answer = await (fake.request as (m: string, p?: unknown) => Promise<unknown>)(method, params);
      return change ? change(method, answer) : answer;
    }) as EngineClient['request'],
  };
  window.location.hash = hash;
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
}

describe('Team', () => {
  it('departments with agents are sections; the empty ones are one line with one way on', async () => {
    open('#/team');
    await screen.findByRole('heading', { level: 1, name: 'Team' });
    await settle();
    const line = await screen.findByText(/^No agents yet in /);
    expect(line.closest('[data-dept]')).toBeNull();
    expect(within(line.parentElement!).getByRole('link', { name: 'Add an agent here' }).getAttribute('href')).toBe('#/team?sheet=hire:new');
    expect(screen.queryByText(/^No agents in .* yet\.$/)).toBeNull();
  });

  it('the department row holds All and departments with agents only', async () => {
    open('#/team');
    await settle();
    const row = await screen.findByRole('group', { name: 'Show departments' });
    const names = within(row).getAllByRole('button').map((b) => b.textContent ?? '');
    expect(names.some((name) => /^Sales/.test(name) && /0$/.test(name))).toBe(false);
    expect(names.length).toBeLessThan(6);
  });

  it('"Add an agent" sits in the header row', async () => {
    open('#/team');
    await settle();
    const button = await screen.findByRole('button', { name: 'Hire one more agent' });
    expect(button.closest('header')).not.toBeNull();
  });

  it('with nobody working and nothing waiting the stats are one line, and no zero jobs chart', async () => {
    open('#/team', (method, answer) => {
      if (method === 'venture.runs.list') return { ...(answer as object), runs: [] };
      if (method === 'venture.queue.list') return { ...(answer as object), rows: [], needsYou: 0 };
      if (method === 'venture.team.list') {
        const view = answer as TeamListView;
        return { ...view, agents: view.agents.map((a) => ({ ...a, state: 'idle' })), totals: view.totals ? { ...view.totals, doneThisWeek: { ...view.totals.doneThisWeek, count: 0, permille: {} } } : view.totals };
      }
      return answer;
    });
    await settle();
    expect(await screen.findByText('Nobody is working right now.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Team summary' })).queryByText('Waiting on you in this business')).toBeNull();
    expect(screen.queryByText('Nothing waits on you.')).toBeNull();
  });

  it('the spend tile has no currency icon', async () => {
    open('#/team');
    await settle();
    const label = await screen.findByText('Monthly AI spend');
    expect(label.querySelector('svg')).toBeNull();
  });

  it('names the business scope of the waiting count', async () => {
    open('#/team');
    expect(await screen.findByText('Waiting on you in this business')).toBeTruthy();
  });
});

describe('the agent sheet', () => {
  const sheet = () => screen.findByRole('complementary', { name: /Editor/ });

  it('an empty chat stays at the top of its message area', () => {
    expect(rule('ChatThread.module.css', '.thread[data-empty] > :first-child')).toMatch(/margin-top:\s*0/);
  });

  it('has four tabs, no version badge, and no status or chip in its head', async () => {
    open('#/team?sheet=agent:editor');
    const panel = await sheet();
    await waitFor(() => expect(within(within(panel).getByRole('tablist', { name: 'Editor' })).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Chat', 'How it works', 'Jobs 2', 'Notes']));
    const line = panel.querySelector('header')!;
    expect(line.textContent).not.toMatch(/Working|Idle|of 5/);
    expect(panel.querySelector('header [class*="_dept_"]')).toBeNull();
  });

  it('How it works holds what Can do held, one fold away', async () => {
    open('#/team?sheet=agent:editor');
    const panel = await sheet();
    const summary = [...panel.querySelectorAll('summary')].find((one) => one.textContent === 'What it can do')!;
    expect(summary.textContent).toBe('What it can do');
    expect(summary.closest('details')!.hasAttribute('open')).toBe(false);
  });

  it('Jobs has no heading of its own', async () => {
    open('#/team?sheet=agent:editor&tab=runs');
    const panel = await sheet();
    await waitFor(() => expect(within(panel).getByRole('tabpanel').querySelector('ul')).not.toBeNull());
    expect(within(within(panel).getByRole('tabpanel')).queryByRole('heading', { name: 'Jobs' })).toBeNull();
  });

  it('Keeper also names its department as plain text', async () => {
    open('#/team?sheet=agent:keeper');
    const panel = await screen.findByRole('complementary', { name: 'Keeper' });
    expect(panel.querySelector('header')!.textContent).toContain('Operations');
    expect(panel.querySelector('header [class*="_dept_"]')).toBeNull();
  });

  it('a skill does not repeat its name as its description', async () => {
    open('#/team?sheet=agent:editor&tab=instructions', (method, answer) => {
      if (method !== 'venture.persona.get') return answer;
      const view = answer as { skills: { name: string; line: string }[] };
      return { ...view, skills: view.skills.map((skill) => ({ ...skill, line: skill.name })) };
    });
    const panel = await sheet();
    const fold = [...panel.querySelectorAll('details')].find(one => one.querySelector('summary')?.textContent === 'What it can do')!;
    await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    const skills = await within(panel).findByRole('list', { name: "Editor's skills" });
    for (const item of within(skills).getAllByRole('listitem')) {
      expect(within(item).getAllByText(item.querySelector('h4')!.textContent!)).toHaveLength(1);
    }
  });

  it('the chat starters read "Add a rule..." and "Add a note...", fill the box with the words, and a used one goes', async () => {
    open('#/team?sheet=agent:editor&tab=chat');
    const panel = await sheet();
    const rule = await within(panel).findByRole('button', { name: 'Add a rule...' });
    expect(within(panel).getByRole('button', { name: 'Add a note...' })).toBeTruthy();
    await act(async () => { fireEvent.click(rule); });
    expect((within(panel).getByRole('textbox') as HTMLTextAreaElement).value).toBe('From now on, ');
    expect(within(panel).queryByRole('button', { name: 'Add a rule...' })).toBeNull();
  });
});
