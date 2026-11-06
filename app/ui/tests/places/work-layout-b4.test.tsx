import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertOnePrimaryPerView } from '../helpers/ink-rules';
import type { PipelineIdeaView } from '../../src/engine/types';
import { RUNS } from '../../src/engine/fixtures';
import { ClockProvider } from '../../src/shell/clock';

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
async function open(hash = '#/work', change?: (method: string, answer: unknown) => unknown) {
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-23T13:35:00.000Z' }));
  const request = client.request.bind(client);
  client.request = (async (method, params) => {
    const answer = await request(method, params as never);
    return change ? change(method, answer) : answer;
  }) as typeof client.request;
  window.location.hash = hash;
  render(<ClockProvider now={() => new Date('2026-10-23T13:35:00.000Z')}><App client={client} language="en" /></ClockProvider>);
  await settle();
}

describe('B4 task 15: Work layout', () => {
  it('gives the first waiting run the one filled action, in Needs you', async () => {
    await open();
    const needs = screen.getByRole('region', { name: 'Needs you' });
    expect(within(needs).getByRole('button', { name: 'Answer' }).getAttribute('data-variant')).toBe('primary');
    expect(within(screen.getByRole('region', { name: 'Running now' })).queryByText('Pricing the sponsor slot')).toBeNull();
    assertOnePrimaryPerView();
  });

  it('keeps each order card in a plain client section', async () => {
    await open();
    const group = screen.getByRole('heading', { level: 4, name: /episode 14/i }).closest('article')!;
    expect(group.hasAttribute('data-plain')).toBe(true);
    expect(group.querySelector('[data-card]')).toBeTruthy();
  });

  it('explains the owner handoff on a locked order stage', async () => {
    await open();
    const lock = document.querySelector('[data-order-steps] [data-state="always-asks"] [title]');
    expect(lock?.getAttribute('title')).toBe('You send this yourself');
  });

  it('offers New client directly beneath the Client field', async () => {
    await open('#/work?sheet=new-order:new');
    const panel = screen.getByRole('complementary', { name: 'New order' });
    const add = within(panel).getByRole('button', { name: '+ New client' });
    expect(add.getAttribute('data-variant')).toBe('quiet');
    await act(async () => { fireEvent.click(add); });
    expect(within(panel).getByRole('textbox', { name: "Client's name" })).toBeTruthy();
  });

  it('uses a grouped list and omits empty stages below five ideas', async () => {
    await open('#/work/ideas', (method, answer) => {
      if (method !== 'venture.ideas.list') return answer;
      const view = answer as { pipeline: PipelineIdeaView[] };
      return { ...view, pipeline: view.pipeline.filter(idea => idea.stage !== 'dropped').slice(0, 2) };
    });
    const list = document.querySelector('[data-ideas-layout="list"]');
    expect(list).toBeTruthy();
    expect(list!.querySelectorAll('[data-stage]').length).toBeLessThanOrEqual(2);
  });

  it('keeps Stop one step away, with only one wait line', async () => {
    await open();
    const running = screen.getByRole('region', { name: 'Running now' });
    for (const stop of within(running).getAllByRole('button', { name: /^Stop:/ })) expect(stop.closest('details')?.open).toBe(false);
    const tile = within(running).getByRole('button', { name: 'Cutting shorts from episode 13' }).closest('li')!;
    const fold = tile.querySelector('details')!;
    expect(fold).toBeTruthy();
    await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    expect(within(tile).getByRole('button', { name: /^Stop:/ })).toBeTruthy();
    expect(screen.queryByText('2 of 3 done, waits on you')).toBeNull();
  });

  it('sorts finished runs newest first, shows each time and omits repeated avatars', async () => {
    const sample = RUNS.find(run => run.state === 'done')!;
    await open('#/work?state=done', (method, answer) => method === 'venture.runs.list' ? { runs: [
      { ...sample, runId: 'older', purpose: 'Older completed job', startedAt: '2026-10-23T08:00:00.000Z', finishedAt: '2026-10-23T08:04:00.000Z' },
      { ...sample, runId: 'newer', purpose: 'Newer completed job', startedAt: '2026-10-23T09:00:00.000Z', finishedAt: '2026-10-23T09:04:00.000Z' },
    ] } : answer);
    const rows = within(screen.getByRole('region', { name: 'Finished' })).getAllByRole('listitem');
    expect(rows.map(row => row.querySelector('[data-open]')?.textContent)).toEqual(['Newer completed job', 'Older completed job']);
    expect(rows.every(row => /\d+:\d+ [ap]m/.test(row.textContent!))).toBe(true);
    expect(rows.some(row => row.querySelector('[data-size="32"]'))).toBe(false);
  });

  it('counts the completion day and separates practice from client work', async () => {
    const sample = RUNS.find(run => run.state === 'done')!;
    await open('#/work?state=done', (method, answer) => method === 'venture.runs.list' ? { runs: [
      { ...sample, runId: 'client-job', purpose: 'Client work from yesterday', startedAt: '2026-10-22T08:00:00.000Z', finishedAt: '2026-10-23T08:00:00.000Z' },
      { ...sample, runId: 'practice-job', purpose: 'Practice work', startedAt: '2026-10-23T09:00:00.000Z', finishedAt: '2026-10-23T09:05:00.000Z', practice: true },
    ] } : answer);
    const finished = screen.getByRole('region', { name: 'Finished' });
    expect(within(finished).getByText('2 done today')).toBeTruthy();
    const practice = within(finished).getByRole('list', { name: 'Practice' });
    expect(practice.textContent).toContain('Practice work');
    expect(practice.textContent).not.toContain('Client work from yesterday');
  });
});
