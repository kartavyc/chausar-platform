import { describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { MethodName, QueueList, QueueRow, RunDetail, RunSummary } from '../../src/engine/types';
import { assertInkRules, assertOnePrimary } from '../helpers/ink-rules';

/*
 * Run controls on Work, Today and the run sheet (W4 package 4F3; spec 5.6; D-Work `.rt` Stop, `.stopped`, `.sd-*`;
 * D-Today Working now). The engine's words are shown as they come; its codes (the breaker's trigger, the fix, the
 * failure kind) are worded by the screen. Stop and Stopped are the owner's own stop or Chausar's; an engine failure is
 * "Failed" (NOTES 27), and a run a crash cut is "Interrupted", never "Stopped by you".
 */

type Call = { method: string; params: unknown };
type Intercept = (params: unknown, real: () => Promise<unknown>) => unknown;
interface StartOptions { language?: 'en' | 'hi'; intercept?: Partial<Record<MethodName, Intercept>> }

const NOW = () => new Date('2026-10-23T19:05:00.000+05:30');

async function start(hash = '#/work', options: StartOptions = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine();
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = options.intercept?.[method];
    if (own) return Promise.resolve().then(() => own(params, () => request(method, params as never)));
    return request(method, params as never);
  }) as typeof client.request;
  render(<ClockProvider now={NOW}><App client={client} language={options.language ?? 'en'} /></ClockProvider>);
  await screen.findByRole('heading', { level: 1 });
  return { engine, client, calls };
}

const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); }); await settle(); };
const tileOf = async (text: string) => (await screen.findByRole('heading', { level: 3, name: text })).closest('li')!;
const of = (calls: Call[], method: string) => calls.filter((c) => c.method === method).map((c) => c.params);

/** A run the engine stopped, as it lists it: waiting for Resume, its stop line, and a trigger when the breaker stopped it. */
const STOPPED: RunDetail = {
  runId: '25', businessId: 'lumen', agent: 'Editor', purpose: 'Rendering the poster set', state: 'waiting', startedAt: '2026-10-21T09:40:00.000Z', elapsed: '2m',
  progress: { done: 1, total: 3 }, result: 'Stopped: the same error came back three times: ffmpeg was not found on this computer.',
  stop: { state: 'stopped', line: 'Stopped: the same error came back three times: ffmpeg was not found on this computer.', trigger: 'same-error' },
  fix: 'Install ffmpeg, or turn off the finishing check, then run again.', fixKind: 'install-ffmpeg',
  steps: [
    { id: 's1', purpose: 'Picked 3 frames for the poster', state: 'done', elapsed: '20s' },
    { id: 's2', purpose: 'Render the poster', state: 'waiting' },
    { id: 's3', purpose: 'Send drafts to you', state: 'pending' },
  ],
};
const summaryOf = ({ steps: _s, question: _q, error: _e, fix: _f, fixKind: _k, interrupted: _i, ...summary }: RunDetail): RunSummary => summary;
const withRun = (run: RunDetail): Partial<Record<MethodName, Intercept>> => ({
  'venture.runs.list': async (_p, real) => { const sent = (await real()) as { runs: RunSummary[] }; return { ...sent, runs: [...sent.runs, summaryOf(run)] }; },
  'venture.runs.get': async (p, real) => ((p as { runId: string }).runId === run.runId ? structuredClone(run) : real()),
});
const stoppedRow = (run: RunDetail): QueueRow => ({
  id: `runctl:${run.runId}:stopped-1`, businessId: 'lumen', businessName: 'Lumen Studio', agent: run.agent, kind: 'draft', createdAt: '2026-10-21T09:45:00.000Z',
  title: `${run.purpose} is stopped`, line: run.stop!.line, digest: 'd-stopped', viewRef: { kind: 'run', id: run.runId },
  actions: [{ id: 'run-again', label: 'Run again', primary: false }, { id: 'resume', label: 'Resume', primary: true }],
});
const withRows = (...rows: QueueRow[]): Intercept => async (_p, real) => { const sent = (await real()) as QueueList; return { ...sent, rows: [...sent.rows, ...rows] }; };

describe('Work: Stop on each running tile (O1)', () => {
  it('each running tile has "Stop run 31"; Stop keeps finished steps and the tile reads Stopping until the engine says stopped', async () => {
    const { calls } = await start();
    await settle();
    for (const id of ['31', '30', '29']) expect(screen.getByRole('button', { name: `Stop run ${id}` })).toBeTruthy();
    const tile = await tileOf('Cutting shorts from episode 13');
    const stop = within(tile).getByRole('button', { name: 'Stop run 31' });
    await click(stop);
    expect(stop.getAttribute('aria-expanded')).toBe('true');
    const dialog = within(tile).getByRole('dialog', { name: 'Stop run 31?' });
    expect(within(dialog).getByText('Stop lets the step in progress finish, then stops. Finished steps are kept.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Not now' }));
    assertOnePrimary();
    await click(within(dialog).getByRole('button', { name: 'Stop' }));
    expect(of(calls, 'venture.runs.stop')).toEqual([{ runId: '31' }]);
    expect(await within(tile).findByText('Stop received. The step in progress finishes, then the run stops.')).toBeTruthy();
    expect(await within(tile).findByText('Stopping')).toBeTruthy();
    expect(within(tile).queryByRole('button', { name: 'Stop run 31' })).toBeNull();
    // Once the step in progress came back, the engine says stopped: the run sits with the stopped runs, with Resume.
    const stopped = await waitFor(async () => {
      const region = screen.getByRole('region', { name: 'Stopped' });
      return within(region).getByRole('heading', { level: 3, name: 'Cutting shorts from episode 13' }).closest('li')!;
    }, { timeout: 3000 });
    expect(within(stopped).getByText('Stopped by you. Finished steps are kept.')).toBeTruthy();
    expect(await within(stopped).findByText('Stopped at step 4 of 5')).toBeTruthy();
    expect(within(stopped).queryByText(/Failed/)).toBeNull();
    const resume = within(stopped).getByRole('button', { name: 'Resume' });
    expect(resume.getAttribute('data-variant')).toBe('primary');
    expect(within(stopped).getByRole('button', { name: 'Run again' })).toBeTruthy();
    assertInkRules();
    await click(resume);
    expect(of(calls, 'venture.runs.resume')).toEqual([{ runId: '31' }]);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Stopped' })).toBeNull());
  });

  it('Force stop names what is lost and asks once more; Not now leaves the run alone', async () => {
    const { calls } = await start();
    const tile = await tileOf('Cutting shorts from episode 13');
    await click(within(tile).getByRole('button', { name: 'Stop run 31' }));
    await click(within(tile).getByRole('button', { name: 'Not now' }));
    expect(within(tile).queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(within(tile).getByRole('button', { name: 'Stop run 31' }));
    await click(within(tile).getByRole('button', { name: 'Stop run 31' }));
    await click(within(tile).getByRole('button', { name: 'Force stop' }));
    expect(of(calls, 'venture.runs.stop')).toEqual([]);
    expect(within(tile).getByText('Force stop throws away the step in progress: Rendering 3 of 6. Anything already sent stays sent. Force stop?')).toBeTruthy();
    assertOnePrimary();
    await click(within(within(tile).getByRole('dialog')).getByRole('button', { name: 'Force stop' }));
    expect(of(calls, 'venture.runs.stop')).toEqual([{ runId: '31', force: true }]);
    const stopped = await waitFor(() => within(screen.getByRole('region', { name: 'Stopped' })).getByRole('heading', { level: 3, name: 'Cutting shorts from episode 13' }).closest('li')!);
    expect(within(stopped).getByText('Stopped by you. The step in progress was thrown away.')).toBeTruthy();
  });

  it('says what the engine refused, in its words', async () => {
    await start('#/work', { intercept: { 'venture.runs.stop': () => { throw Object.assign(new Error('This run is not running, so there is nothing to stop or steer.'), { code: 'RUN_NOT_RUNNING' }); } } });
    const tile = await tileOf('Checking titles against the last 30 videos');
    await click(within(tile).getByRole('button', { name: 'Stop run 30' }));
    await click(within(within(tile).getByRole('dialog')).getByRole('button', { name: 'Stop' }));
    expect(await within(tile).findByText(/This run is not running, so there is nothing to stop or steer\./)).toBeTruthy();
  });
});

describe('Work: the stopped tile (O1, O14)', () => {
  it('a breaker stop shows its trigger words, what went wrong, How to fix it, Resume (primary) and Run again', async () => {
    const { calls } = await start('#/work', { intercept: { ...withRun(STOPPED), 'venture.queue.list': withRows(stoppedRow(STOPPED)) } });
    const tile = await tileOf('Rendering the poster set');
    expect(screen.getByRole('region', { name: 'Stopped' }).contains(tile)).toBe(true);
    expect(await within(tile).findByText('Stopped at step 2 of 3')).toBeTruthy();
    expect(within(tile).getByText('The same error came back 3 times')).toBeTruthy();
    expect(within(tile).getByText('Stopped: the same error came back three times: ffmpeg was not found on this computer.')).toBeTruthy();
    const fix = within(tile).getByRole('button', { name: 'How to fix it' });
    expect(fix.getAttribute('aria-expanded')).toBe('false');
    await click(fix);
    expect(fix.getAttribute('aria-expanded')).toBe('true');
    expect(within(tile).getByText('Install ffmpeg, or turn off the finishing check, then run again.')).toBeTruthy();
    expect(within(tile).getByRole('button', { name: 'Resume' }).getAttribute('data-variant')).toBe('primary');
    assertInkRules();
    await click(within(tile).getByRole('button', { name: 'Run again' }));
    expect(of(calls, 'venture.queue.decide')).toEqual([{ id: 'runctl:25:stopped-1', digest: 'd-stopped', action: 'run-again', viewed: false }]);
  });

  it('a run a crash cut reads Interrupted, never "Stopped by you"', async () => {
    const line = 'Interrupted: Chausar stopped while this ran. Nothing was sent again.';
    const cut: RunDetail = { ...STOPPED, fix: undefined, fixKind: undefined, result: line, stop: { state: 'stopped', line }, interrupted: { at: '2026-10-21T09:44:00.000Z', line, steps: [] } };
    delete cut.fix; delete cut.fixKind;
    await start('#/work', { intercept: withRun(cut) });
    const tile = await tileOf('Rendering the poster set');
    expect(await within(tile).findByText('Interrupted at step 2 of 3')).toBeTruthy();
    expect(within(tile).getByText(line)).toBeTruthy();
    expect(within(tile).queryByText(/Stopped by you/)).toBeNull();
    expect(within(tile).queryByRole('button', { name: 'How to fix it' })).toBeNull();
  });

  it('a failed run with a fix from the engine offers How to fix it; the fix is worded in Hindi too', async () => {
    const fixed = (p: unknown, real: () => Promise<unknown>) => ((p as { runId: string }).runId === '28'
      ? real().then((run) => ({ ...(run as RunDetail), fix: 'Install ffmpeg, or turn off the finishing check, then run again.', fixKind: 'install-ffmpeg' }))
      : real());
    await start('#/work', { language: 'hi', intercept: { 'venture.runs.get': fixed } });
    const tile = await tileOf('Rendering the thumbnail set');
    const fix = await within(tile).findByRole('button', { name: 'ठीक कैसे करें' });
    await click(fix);
    expect(within(tile).getByText('ffmpeg इंस्टॉल करें, या फ़िनिशिंग जाँच बंद करें, फिर दोबारा चलाएँ।')).toBeTruthy();
  });
});

describe('Work: the round gate (O2)', () => {
  it('the gate row shows on the waiting tile with an optional note, and Continue carries it into the next step', async () => {
    const gated = (p: unknown, real: () => Promise<unknown>) => ((p as { runId: string }).runId === '29'
      ? real().then((run) => ({ ...(run as RunDetail), question: undefined, gate: { on: true, every: 1, waiting: { round: 2, reason: 'finished', line: 'Round 2 is done: 3 tool calls, 1 failed.' } } }))
      : real());
    const row: QueueRow = {
      id: 'runctl:29:gate-2', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'question', createdAt: '2026-10-21T10:05:00.000Z',
      title: 'Round 2 of the draft for Boat Club is done: 3 tool calls, 1 failed. Continue or stop?', line: 'Round 2 is done: 3 tool calls, 1 failed.', digest: 'd-gate',
      viewRef: { kind: 'run', id: '29' }, actions: [{ id: 'stop', label: 'Stop', primary: false }, { id: 'continue', label: 'Continue', primary: true }],
    };
    const { calls } = await start('#/work', { intercept: { 'venture.runs.get': gated, 'venture.queue.list': withRows(row) } });
    const tile = await tileOf('Pricing the sponsor slot');
    const gate = await within(tile).findByRole('group', { name: 'Round 2 is done: 3 tool calls, 1 failed.' });
    expect(within(tile).queryByRole('button', { name: 'Stop run 29' })).toBeNull();
    fireEvent.change(within(gate).getByLabelText('Anything for the next step? (optional)'), { target: { value: 'Keep the price under the brief.' } });
    expect(within(gate).getByRole('button', { name: 'Continue' }).getAttribute('data-variant')).toBe('primary');
    assertOnePrimary();
    await click(within(gate).getByRole('button', { name: 'Continue' }));
    expect(of(calls, 'venture.queue.decide')).toEqual([{ id: 'runctl:29:gate-2', digest: 'd-gate', action: 'continue', viewed: false, answer: 'Keep the price under the brief.' }]);
  });
});

describe('Today: Stop in Working now', () => {
  it('each running row has Stop; a stopped run says so in the engine words', async () => {
    const { calls } = await start('#/today');
    const working = await screen.findByRole('region', { name: 'Working now' });
    await settle();
    const stop = within(working).getByRole('button', { name: 'Stop run 31' });
    await click(stop);
    const dialog = within(working).getByRole('dialog', { name: 'Stop run 31?' });
    await click(within(dialog).getByRole('button', { name: 'Force stop' }));
    await click(within(within(working).getByRole('dialog')).getByRole('button', { name: 'Force stop' }));
    expect(of(calls, 'venture.runs.stop')).toEqual([{ runId: '31', force: true }]);
    expect(await within(working).findByText(/The step in progress is thrown away: Rendering 3 of 6\./)).toBeTruthy();
    await waitFor(() => expect(within(working).getByText('Editor · Stopped by you. The step in progress was thrown away.')).toBeTruthy());
    expect(within(working).queryByRole('button', { name: 'Stop run 31' })).toBeNull();
    expect(within(working).getAllByText('Stopped').length).toBeGreaterThan(0);
  });
});

describe('4F3 review', () => {
  const paused = (_p: unknown, real: () => Promise<unknown>) => real().then((view) => ({ ...(view as object), paused: { since: '2026-10-23T08:00:00.000Z', line: 'Paused by you. No new work starts until you unpause.' } }));

  it('a stopped run a newer run of the same order replaced is history: Work and Today leave it out', async () => {
    const newer = { id: '25-2', at: '2026-10-21T09:50:00.000Z', orderId: 'o-poster', status: 'waiting-for-you', practice: false };
    const deliveries: Intercept = async (_p, real) => [...((await real()) as object[]), { id: '25', at: '2026-10-21T09:40:00.000Z', orderId: 'o-poster', status: 'stopped', practice: false }, newer];
    await start('#/work', { intercept: { ...withRun(STOPPED), 'venture.delivery.list': deliveries } });
    await settle();
    expect(screen.queryByRole('region', { name: 'Stopped' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3, name: 'Rendering the poster set' })).toBeNull();
  });

  it("Today lists a stopped run in Working now only while the engine's row for it is there", async () => {
    await start('#/today', { intercept: withRun(STOPPED) });
    const working = await screen.findByRole('region', { name: 'Working now' });
    await settle();
    expect(within(working).queryByRole('button', { name: 'Rendering the poster set' })).toBeNull();
    cleanup();
    await start('#/today', { intercept: { ...withRun(STOPPED), 'venture.queue.list': withRows(stoppedRow(STOPPED)) } });
    expect(await within(await screen.findByRole('region', { name: 'Working now' })).findByRole('button', { name: 'Rendering the poster set' })).toBeTruthy();
  });

  it('offers Force stop only on a run whose step is out, and keeps it while the run is Stopping', async () => {
    await start();
    const waiting = await tileOf('Pricing the sponsor slot');
    await click(within(waiting).getByRole('button', { name: 'Stop run 29' }));
    expect(within(waiting).queryByRole('button', { name: 'Force stop' })).toBeNull();
    await click(within(waiting).getByRole('button', { name: 'Not now' }));
    const tile = await tileOf('Cutting shorts from episode 13');
    await click(within(tile).getByRole('button', { name: 'Stop run 31' }));
    await click(within(within(tile).getByRole('dialog')).getByRole('button', { name: 'Stop' }));
    expect(await within(tile).findByText('Stopping')).toBeTruthy();
    // The status line takes the focus, so a screen reader hears what the engine did.
    expect(document.activeElement).toBe(within(tile).getByText('Stop received. The step in progress finishes, then the run stops.'));
    expect(within(tile).getByRole('button', { name: 'Force stop run 31' })).toBeTruthy();
  });

  it("while paused, Work's head says so and a stopped run's primary is Unpause first", async () => {
    const { calls } = await start('#/work', { intercept: { 'venture.get': paused, ...withRun({ ...STOPPED, stop: { state: 'stopped', line: 'Stopped by you. Finished steps are kept.' } }) } });
    expect(await screen.findByText('Paused by you. No new work starts until you unpause.')).toBeTruthy();
    const tile = await tileOf('Rendering the poster set');
    expect(within(tile).queryByRole('button', { name: 'Resume' })).toBeNull();
    const first = await within(tile).findByRole('button', { name: 'Unpause first' });
    expect(first.getAttribute('data-variant')).toBe('primary');
    await click(first);
    expect(of(calls, 'venture.business.pause')).toEqual([{ paused: false }]);
  });

  it("while paused, Today's head says so too", async () => {
    await start('#/today', { intercept: { 'venture.get': paused } });
    expect(await screen.findByText('Paused by you. No new work starts until you unpause.')).toBeTruthy();
  });

  it("a stopped run's step reads Waiting for Resume; the tile's Stop hides while the round gate waits", async () => {
    await start('#/work', { intercept: withRun({ ...STOPPED, stop: { state: 'stopped', line: 'Stopped by you. Finished steps are kept.' } }) });
    const tile = await tileOf('Rendering the poster set');
    expect(await within(tile).findByText('Waiting for Resume')).toBeTruthy();
  });

  it('Running now no longer repeats the counts the sub line already says', async () => {
    await start();
    const running = await screen.findByRole('region', { name: 'Running now' });
    await settle();
    expect(within(running).queryByText('3 running · 1 failed')).toBeNull();
  });

  it('after Resume the focus goes to the next tile', async () => {
    await start('#/work', { intercept: { ...withRun(STOPPED), 'venture.runs.resume': () => ({ run: STOPPED, line: 'Resumed. Approve the next step when you are ready.' }) } });
    const tile = await tileOf('Rendering the poster set');
    await click(within(tile).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(document.activeElement?.closest('li')).toBe(screen.getByRole('heading', { level: 3, name: 'Rendering the thumbnail set' }).closest('li')));
  });
});
