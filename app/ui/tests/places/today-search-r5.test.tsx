import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient, OpenSearchView } from '../../src/engine/types';
import { SEARCH_LINES } from '../../../../platform/runtime/venture/customers/find-states';

/*
 * Round 5 (re-check 028): while an approved customer search ran for 83 s, its card said "Approved, working on it" but
 * Working now said "Nothing is running." and Team at work "0 working": both read the runs list only. The engine's runs
 * list now carries each open search beside the runs (venture-find-run.test.ts proves it on the engine); here the app
 * shows that search as running work, done by Chausar, with its own line and time and no made-up progress, and lets it
 * go once the engine stops listing it.
 */

const SEARCH: OpenSearchView = {
  searchId: 'leadsearch_1', title: 'Find possible customers: company offices in Indore', line: SEARCH_LINES.running,
  state: 'running', agent: null, startedAt: '2026-10-23T13:34:00.000Z', elapsed: '1 min 23 s',
};

function start() {
  const engine = new FakeEngine();
  const fake = createFakeClient(engine);
  const request = fake.request.bind(fake);
  const open = { searches: [SEARCH], reads: 0 };
  const client: EngineClient = {
    ...fake,
    request: (async (method: string, params?: unknown) => {
      const reply = await request(method as never, params as never);
      // The engine's answer while the search runs: the same runs, and the open search beside them.
      if (method !== 'venture.runs.list') return reply;
      open.reads += 1;
      const listed = reply as unknown as { runs: unknown[]; searches: OpenSearchView[] };
      expect(listed.searches).toEqual([]);
      return { ...listed, searches: open.searches };
    }) as EngineClient['request'],
  };
  window.location.hash = '#/today';
  render(<App client={client} language="en" />);
  return { engine, open };
}

describe('Today, round 5: a customer search that is running is running work', () => {
  it('Working now lists it with Chausar doing it, its own line and its time; it leaves when the search ends', async () => {
    const { engine, open } = start();
    const working = await screen.findByRole('region', { name: 'Working now' });
    const row = await waitFor(() => { const found = working.querySelector<HTMLElement>('[data-row-id="search-leadsearch_1"]'); expect(found).toBeTruthy(); return found!; });
    expect(row.textContent).toContain('Find possible customers: company offices in Indore');
    expect(row.textContent).toContain('Chausar · Looking now. Nothing is sent.');
    expect(row.textContent).toContain('1 min 23 s');
    // No made-up progress: the bar says it has no step count, and no "n of m".
    expect(row.textContent).not.toMatch(/\d+ of \d+/);
    expect(working.textContent).not.toContain('Nothing is running.');
    expect(working.textContent).toMatch(/4 running/);
    // The search ends: the engine stops listing it and says so with a pipeline change.
    open.searches = [];
    await act(async () => { engine.emit({ type: 'pipeline.changed', businessId: 'lumen', at: new Date().toISOString() }); });
    await waitFor(() => expect(working.querySelector('[data-row-id="search-leadsearch_1"]')).toBeNull());
  });

  it('Team at work counts Chausar as working while it searches, and its story says so', async () => {
    start();
    const team = await screen.findByRole('region', { name: 'Team at work' });
    // The sample's agents: 2 working from their runs, and Chausar's search makes 3.
    await waitFor(() => expect(team.textContent).toContain('3 working · 1 needs you · 2 idle'));
    const stories = within(team).getByRole('list', { name: 'Your agents' });
    const chausar = within(stories).getAllByRole('button')[0]!;
    expect(chausar.getAttribute('aria-label')).toBe('Chausar, working. Ask anything');
    expect(chausar.textContent).toContain('Working');
  });
  it('re-reads while a search runs, so its time moves on, and stops once nothing is open (Windows re-check, 17 Nov 2026)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { engine, open } = start();
      const working = await screen.findByRole('region', { name: 'Working now' });
      await waitFor(() => expect(working.querySelector('[data-row-id="search-leadsearch_1"]')).toBeTruthy());
      // The engine works the time out on each read; the next read says 1 min 28 s.
      open.searches = [{ ...SEARCH, elapsed: '1 min 28 s' }];
      const before = open.reads;
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      await waitFor(() => expect(working.querySelector('[data-row-id="search-leadsearch_1"]')!.textContent).toContain('1 min 28 s'));
      expect(open.reads).toBeGreaterThan(before);
      // The search ends: no open search, so Today holds no timer and asks for nothing more.
      open.searches = [];
      await act(async () => { engine.emit({ type: 'pipeline.changed', businessId: 'lumen', at: new Date().toISOString() }); });
      await waitFor(() => expect(working.querySelector('[data-row-id="search-leadsearch_1"]')).toBeNull());
      const after = open.reads;
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
      expect(open.reads).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });
});
