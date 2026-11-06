import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import { FAKE_STOP_SETTLES_MS, STOPPED_BY_YOU } from '../../src/engine/fake-run-controls';
import type { AwayView, QueueList, RunControlResult, RunDetail } from '../../src/engine/types';

/*
 * The fake engine's run controls (4F3) answer like the engine's (platform/runtime/venture/delivery/run-controls.ts,
 * run-control-rows.ts, away.ts): the same codes, words and order.
 */

const get = (engine: FakeEngine, runId: string) => engine.request('venture.runs.get', { runId }) as Promise<RunDetail>;
const list = (engine: FakeEngine) => engine.request('venture.queue.list', { scope: 'all' }) as Promise<QueueList>;
const refused = async (call: Promise<unknown>) => { try { await call; } catch (error) { return (error as { code?: string }).code; } return 'answered'; };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('fake engine: run controls (4F3)', () => {
  it('stops a run that waits on the owner at once, keeps its steps, and puts Resume and Run again on Today', async () => {
    const engine = new FakeEngine();
    const before = await get(engine, '29');
    const result = await engine.request('venture.runs.stop', { runId: '29' }) as RunControlResult;
    expect(result.line).toBe(STOPPED_BY_YOU);
    expect(result.lost).toBeUndefined();
    expect(result.run.stop).toEqual({ state: 'stopped', line: STOPPED_BY_YOU });
    // A stopped run waits for the owner's Resume: never done, never failed.
    expect(result.run.state).toBe('waiting');
    expect(result.run.steps.filter((s) => s.state === 'done')).toEqual(before.steps.filter((s) => s.state === 'done'));
    const summary = (await engine.request('venture.runs.list', { state: 'all' }) as { runs: RunDetail[] }).runs.find((r) => r.runId === '29')!;
    expect(summary.stop?.state).toBe('stopped');
    const row = (await list(engine)).rows.find((r) => r.viewRef?.kind === 'run' && r.viewRef.id === '29' && r.id.startsWith('runctl:'))!;
    expect(row.actions.map((a) => [a.id, a.primary])).toEqual([['run-again', false], ['resume', true]]);
    expect(row.line).toBe(STOPPED_BY_YOU);
  });

  it('records a stop while a turn is out: the run reads Stopping, then stopped once the step comes back', async () => {
    const engine = new FakeEngine();
    const events: string[] = [];
    engine.subscribe((event) => { if (event.runId === '31') events.push(event.type); });
    const result = await engine.request('venture.runs.stop', { runId: '31' }) as RunControlResult;
    expect(result.line).toBe('Stop received. The step in progress finishes, then the run stops.');
    expect(result.run.stop).toEqual({ state: 'stopping', line: 'Stopping: the step in progress finishes first.' });
    expect(result.run.state).toBe('active');
    await wait(FAKE_STOP_SETTLES_MS + 50);
    expect((await get(engine, '31')).stop?.state).toBe('stopped');
    expect(events).toContain('run.stopped');
  });

  it('force stops at once and names what is lost', async () => {
    const engine = new FakeEngine();
    const result = await engine.request('venture.runs.stop', { runId: '31', force: true }) as RunControlResult;
    expect(result.line).toBe('Stopped by you.');
    expect(result.lost).toBe('The step in progress is thrown away: Rendering 3 of 6. Anything already sent stays sent.');
    expect(result.run.stop).toEqual({ state: 'stopped', line: 'Stopped by you. The step in progress was thrown away.' });
  });

  it('refuses with the engine codes', async () => {
    const engine = new FakeEngine();
    expect(await refused(engine.request('venture.runs.stop', { runId: 'nope' }))).toBe('RUN_NOT_FOUND');
    expect(await refused(engine.request('venture.runs.stop', { runId: '28' }))).toBe('RUN_NOT_RUNNING');
    expect(await refused(engine.request('venture.runs.stop', { runId: '26' }))).toBe('RUN_NOT_RUNNING');
    await engine.request('venture.runs.stop', { runId: '29' });
    expect(await refused(engine.request('venture.runs.stop', { runId: '29' }))).toBe('RUN_ALREADY_STOPPED');
    expect(await refused(engine.request('venture.runs.resume', { runId: '30' }))).toBe('RUN_NOT_STOPPED');
    expect(await refused(engine.request('venture.runs.steer', { runId: '30', text: 'x'.repeat(501) }))).toBe('INVALID_VENTURE_REQUEST');
    expect(await refused(engine.request('venture.runs.steer', { runId: '26', text: 'Keep it short' }))).toBe('RUN_NOT_RUNNING');
    // The hosted web app is the owner's own app channel: run controls answer there too (only a chat channel is refused).
    const hosted = new FakeEngine({ hosted: true });
    expect((await hosted.request('venture.runs.stop', { runId: '29' }) as RunControlResult).line).toBe(STOPPED_BY_YOU);
  });

  it('resumes a stopped run back to its question, from the method or from Today', async () => {
    const engine = new FakeEngine();
    await engine.request('venture.runs.stop', { runId: '29' });
    expect((await get(engine, '29')).question).toBeUndefined();
    const resumed = await engine.request('venture.runs.resume', { runId: '29' }) as RunControlResult;
    expect(resumed.line).toBe('Resumed. Answer the question to go on.');
    expect(resumed.run.stop).toBeUndefined();
    expect(resumed.run.question?.id).toBe('q-29');
    expect((await list(engine)).rows.some((r) => r.id.startsWith('runctl:29:'))).toBe(false);
    await engine.request('venture.runs.stop', { runId: '29' });
    const row = (await list(engine)).rows.find((r) => r.id.startsWith('runctl:29:'))!;
    const decided = await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'resume' });
    expect(decided).toMatchObject({ outcome: 'done', line: 'Resumed. Answer the question to go on.' });
    expect((await get(engine, '29')).stop).toBeUndefined();
  });

  it('Run again on a stopped run starts a new run of the same work, as the engine does; the stopped one stays', async () => {
    const engine = new FakeEngine();
    await engine.request('venture.runs.stop', { runId: '29' });
    const row = (await list(engine)).rows.find((r) => r.id.startsWith('runctl:29:'))!;
    const decided = await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'run-again' });
    expect(decided).toMatchObject({ outcome: 'done', line: 'Started again with the same files.' });
    const runs = (await engine.request('venture.runs.list', { state: 'all' }) as { runs: RunDetail[] }).runs;
    const again = runs.filter((r) => r.purpose === 'Pricing the sponsor slot');
    expect(again.map((r) => r.runId).sort()).toEqual(['29', '29-2']);
    expect(again.find((r) => r.runId === '29-2')).toMatchObject({ state: 'active' });
    expect(again.find((r) => r.runId === '29')?.stop?.state).toBe('stopped');
    expect(await refused(engine.request('venture.runs.resume', { runId: '29' }))).toBe('RUN_SUPERSEDED');
  });

  it("keeps the owner's notes for the next step, at most five waiting", async () => {
    const engine = new FakeEngine();
    const sent = await engine.request('venture.runs.steer', { runId: '31', text: 'Keep each short under 45 seconds.' }) as RunControlResult;
    expect(sent.line).toBe('Sent. Waiting for the agent to pick it up.');
    expect(sent.run.steer?.map((n) => [n.text, n.line])).toEqual([['Keep each short under 45 seconds.', 'Sent. Waiting for the agent to pick it up.']]);
    for (let i = 0; i < 4; i++) await engine.request('venture.runs.steer', { runId: '31', text: `Note ${i}` });
    expect(await refused(engine.request('venture.runs.steer', { runId: '31', text: 'One more' }))).toBe('INVALID_VENTURE_REQUEST');
  });

  it('pauses, stops all and unpauses with the engine words', async () => {
    const engine = new FakeEngine();
    expect(await engine.request('venture.business.pause', { paused: true })).toEqual({ paused: true, stopped: 0, line: 'Paused. No new work starts until you unpause.' });
    const all = await engine.request('venture.business.pause', { paused: true, stopRunning: true }) as { stopped: number; line: string };
    expect(all.stopped).toBe(3);
    expect(all.line).toBe('Paused. 3 runs are stopping or stopped. No new work starts until you unpause.');
    expect(await refused(engine.request('venture.business.pause', { paused: false, stopRunning: true }))).toBe('INVALID_VENTURE_REQUEST');
    expect((await engine.request('venture.business.pause', { paused: false }) as { line: string }).line).toBe('Unpaused. Stopped runs stay stopped until you resume them.');
  });

  it("venture.get says paused, since when, with the engine's line; the scope's cap has its receipt", async () => {
    const engine = new FakeEngine({ now: () => '2026-10-23T08:00:00.000Z' });
    expect((await engine.request('venture.get', {}) as { paused?: unknown }).paused).toBeUndefined();
    await engine.request('venture.business.pause', { paused: true });
    expect((await engine.request('venture.get', {}) as { paused?: unknown }).paused).toEqual({ since: '2026-10-23T08:00:00.000Z', line: 'Paused by you. No new work starts until you unpause.' });
    await engine.request('venture.business.pause', { paused: false });
    expect((await engine.request('venture.get', {}) as { paused?: unknown }).paused).toBeUndefined();
    const scope = (await get(engine, '31')).scope!;
    const receipt = await engine.request('venture.receipt.get', { id: scope.capReceiptId }) as { figures: { display: string }[] };
    // The sample has the owner's rupee rate (4Z3), so the cap's receipt also gives it in rupees, with that rate.
    expect(receipt.figures.map((f) => f.display)).toEqual([scope.cap, scope.capRupees, scope.capRate]);
  });

  it('lists what falls due while away, and a paste-ready reply; it sends nothing', async () => {
    const engine = new FakeEngine({ now: () => '2026-10-23T08:00:00.000Z' });
    const none = await engine.request('venture.away.get', {}) as AwayView;
    expect(none.away).toBeNull();
    expect(none.autoReply).toBeNull();
    expect(await refused(engine.request('venture.away.set', { from: '2026-10-30', to: '2026-10-28' }))).toBe('INVALID_VENTURE_REQUEST');
    expect(await refused(engine.request('venture.away.set', { from: '2026-10-01', to: '2026-10-02' }))).toBe('INVALID_VENTURE_REQUEST');
    const away = await engine.request('venture.away.set', { from: '2026-10-28', to: '2026-11-05' }) as AwayView;
    expect(away.away).toEqual({ from: '2026-10-28', to: '2026-11-05' });
    expect(away.autoReply).toContain('I am away from 28 Oct 2026 to 05 Nov 2026 and back on 06 Nov 2026.');
    expect(away.line).toMatch(/^Away from 28 Oct 2026 to 05 Nov 2026\. \d+ things? waits? for you\.$/);
    expect(away.keepsRunning.length).toBeGreaterThan(0);
    for (const promise of away.promises) expect(promise.due >= '2026-10-28' && promise.due <= '2026-11-05').toBe(true);
  });
});
