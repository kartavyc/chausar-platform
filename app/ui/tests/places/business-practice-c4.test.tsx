import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { MethodName, RunSummary } from '../../src/engine/types';

/*
 * One-shot C4 task 17: from Work to Adopt, and Practice's results open: focus=adopt lands on Use this version, a practice
 * client's row opens its draft in the draft sheet, Suggest fixes starts the loop from a result with failures, and going
 * live says so with an Undo.
 */

type Call = { method: string; params: unknown };
const NOW = '2026-10-23T10:00:00.000Z';

function start(hash = '#/business/practice', options: { engine?: FakeEngine; intercept?: Partial<Record<MethodName, (params: unknown) => unknown>> } = {}) {
  window.location.hash = hash;
  const engine = options.engine ?? new FakeEngine({ now: () => NOW });
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = options.intercept?.[method];
    if (own) return Promise.resolve().then(() => own(params));
    return request(method, params as never);
  }) as typeof client.request;
  render(<App client={client} language="en" />);
  return { engine, calls };
}
const region = (name: string) => screen.findByRole('region', { name });
const press = async (scope: HTMLElement, name: string | RegExp) => {
  const button = await within(scope).findByRole('button', { name });
  await act(async () => { fireEvent.click(button); window.dispatchEvent(new HashChangeEvent('hashchange')); });
};
const sheetEl = () => document.querySelector<HTMLElement>('[data-sheet]') ?? document.body;

afterEach(() => { window.location.hash = ''; });

describe('Practice: results open (C4 task 17)', () => {
  it('focus=adopt focuses Use this version', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('venture.simulation.run', {});
    await engine.request('venture.improve.run', {});
    start('#/business/practice?focus=adopt', { engine });
    const improve = await region('Improve how the work is done');
    const adopt = await within(improve).findByRole('button', { name: 'Use this version' });
    await waitFor(() => expect(document.activeElement).toBe(adopt));
  });

  it('each practice client\'s row opens its practice draft in the draft sheet', async () => {
    start();
    const practice = await region('Practice clients');
    await press(practice, 'Rehearse now');
    await waitFor(() => expect(within(practice).getByText('2 of 3 passed')).toBeTruthy());
    // The failed client keeps its reason in the row; a passed one says so.
    expect(within(practice).getByText('A pushy client: The draft uses a word on the avoid list: free.')).toBeTruthy();
    await press(practice, /A clear request: passed/);
    expect(window.location.hash).toMatch(/sheet=draft%3Apractice/);
    await waitFor(() => expect(sheetEl().querySelector('[data-draft-message]')?.textContent).toBeTruthy());
    expect(sheetEl().querySelector('[data-draft-message]')!.textContent).not.toMatch(/[#*]/);
    expect(within(sheetEl()).getByText('A practice draft. It never goes to a client.')).toBeTruthy();
    expect(within(sheetEl()).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(sheetEl()).queryByRole('button', { name: 'Share on WhatsApp' })).toBeNull();
  });

  it('a failed client\'s draft shows what failed', async () => {
    start();
    const practice = await region('Practice clients');
    await press(practice, 'Rehearse now');
    await press(practice, /A pushy client: The draft uses a word/);
    await waitFor(() => expect(within(sheetEl()).getByText('The draft uses a word on the avoid list: free.')).toBeTruthy());
  });

  it('under a result with failures, Suggest fixes calls the same improve.run, and the kept version is ready in place', async () => {
    const { calls } = start();
    const practice = await region('Practice clients');
    expect(within(practice).queryByRole('button', { name: 'Suggest fixes' })).toBeNull();
    await press(practice, 'Rehearse now');
    await press(practice, 'Suggest fixes');
    expect(calls.find((c) => c.method === 'venture.improve.run')?.params).toEqual({});
    const improve = await region('Improve how the work is done');
    const adopt = await within(improve).findByRole('button', { name: 'Use this version' });
    await waitFor(() => expect(document.activeElement).toBe(adopt));
    expect(within(practice).getByText('A better version is ready. Use it under Improve.')).toBeTruthy();
  });

  it('a result with no failures offers no Suggest fixes', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const real = (await engine.request('venture.simulation.run', {})) as { episodes: { passed: boolean }[]; summary: Record<string, number> };
    const clean = { ...real, passed: true, summary: { scenarios: 3, passed: 3, failed: 0 }, episodes: real.episodes.map((episode) => ({ ...episode, passed: true, firstFailure: null })) };
    start('#/business/practice', { engine, intercept: { 'venture.simulation.run': () => clean } });
    const practice = await region('Practice clients');
    await press(practice, 'Rehearse now');
    await within(practice).findByText('3 of 3 passed');
    expect(within(practice).queryByRole('button', { name: 'Suggest fixes' })).toBeNull();
  });

  it('after going live: one line, and Undo brings Practice back', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    let stage: 'practice' | 'live' = 'practice';
    const status = () => ({ stage, acceptedDeliveries: 1, improvement: { judged: 0, rejectedOrEdited: 0, due: false, reason: '', status: 'available' }, stages: [{ stage: 'practice', allowed: true, reason: 'In practice.', current: stage === 'practice' }, { stage: 'live', allowed: true, reason: 'Ready.', current: stage === 'live' }] });
    const { calls } = start('#/business/practice', { engine, intercept: {
      'venture.launch.status': status,
      'venture.launch.advance': (params) => { stage = (params as { to: 'practice' | 'live' }).to; return status(); },
    } });
    const tile = await region('Stage');
    await press(tile, 'Go live');
    await press(tile, 'Go live now');
    expect(await within(tile).findByText("You're live. Drafts go to clients after you approve each.")).toBeTruthy();
    await press(tile, 'Undo');
    expect(calls.filter((c) => c.method === 'venture.launch.advance').at(-1)?.params).toEqual({ to: 'practice' });
    await waitFor(() => expect(within(tile).queryByText("You're live. Drafts go to clients after you approve each.")).toBeNull());
  });
});

describe('Work: the better instructions row (C4 task 17)', () => {
  it('links to Practice, on Use this version', async () => {
    const row: RunSummary = { runId: 'imp-1', businessId: 'lumen', agent: 'Producer', purpose: 'Improve how the work is done from your feedback', state: 'done', startedAt: NOW, elapsed: '4 min', result: 'Better work instructions are ready for you to adopt.', adoptReady: true };
    const engine = new FakeEngine({ now: () => NOW });
    const real = await engine.request('venture.runs.list', { state: 'all' }) as { runs: RunSummary[] };
    start('#/work', { engine, intercept: { 'venture.runs.list': () => ({ runs: [row, ...real.runs] }) } });
    const link = await screen.findByRole('link', { name: 'Better work instructions are ready for you to adopt.' });
    expect(link.getAttribute('href')).toBe('#/business/practice?focus=adopt');
  });
});
