import { expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { workChanged } from '../../src/places/work/refresh';
import type { RunSummary } from '../../src/engine/types';

it('a run keeps the same list item when it moves from Running now through Needs you to Finished', async () => {
  const engine = new FakeEngine();
  const reply = await engine.request('venture.runs.list', { state: 'all' }) as { runs: RunSummary[] };
  let run = reply.runs.find(row => row.state === 'active')!;
  const client = createFakeClient(engine);
  const request = client.request.bind(client);
  client.request = ((method, params) => method === 'venture.runs.list' ? Promise.resolve({ runs: [run] }) : request(method, params as never)) as typeof client.request;
  window.location.hash = '#/work';
  render(<App client={client} language="en" />);
  const running = await screen.findByRole('region', { name: 'Running now' });
  const row = (await within(running).findByText(run.purpose)).closest('li')!;
  await act(async () => { run = { ...run, state: 'waiting' }; workChanged(); });
  const waiting = await screen.findByRole('region', { name: 'Needs you' });
  await waitFor(() => expect(within(waiting).getByText(run.purpose).closest('li')).toBe(row));
  await act(async () => { run = { ...run, state: 'done', finishedAt: '2026-11-06T14:00:00Z' }; workChanged(); });
  const finished = await screen.findByRole('region', { name: 'Finished' });
  await waitFor(() => expect(within(finished).getByText(run.purpose).closest('li')).toBe(row));
  expect(document.querySelectorAll(`[data-run-id="${run.runId}"]`)).toHaveLength(1);
});
