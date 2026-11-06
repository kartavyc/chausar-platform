import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunRecorder } from '../runtime/venture/replay/capture.ts';
import { createRunReplay } from '../runtime/venture/replay/replay-run.ts';
import * as hooks from '../runtime/venture/replay/scope.ts';

test('recorded revocation timer ticks replay their actual guards without wall-clock polling', async () => {
  const recorder = createRunRecorder({ startState: {}, capturedAt: '2026-11-06T12:00:00.000Z' }); let calls = 0;
  await hooks.inRun({ recorder }, async () => {
    const timer = (hooks as any).runInterval(() => { calls++; hooks.runClock(); }, 1);
    while (!calls) await new Promise(resolve => setTimeout(resolve, 2));
    timer.close(); hooks.runClock();
  });
  const replay = createRunReplay(recorder.finish([])); let repeated = 0;
  hooks.inRun({ replay }, () => {
    const timer = (hooks as any).runInterval(() => { repeated++; hooks.runClock(); }, 1);
    timer.close(); hooks.runClock(); replay.done();
  });
  assert.equal(repeated, calls); assert.ok(calls > 0);
});

test('a recorded one-shot deadline replays once and can be cancelled without a wall-clock timer', async () => {
  const recorder = createRunRecorder({ startState: {}, capturedAt: '2026-11-06T12:00:00.000Z' }); let calls = 0;
  await hooks.inRun({ recorder }, async () => {
    const timer = (hooks as any).runTimeout(() => { calls++; hooks.runClock(); }, 1);
    while (!calls) await new Promise(resolve => setTimeout(resolve, 2)); timer.close(); hooks.runClock();
  });
  const replay = createRunReplay(recorder.finish([])); let repeated = 0;
  hooks.inRun({ replay }, () => {
    const timer = (hooks as any).runTimeout(() => { repeated++; hooks.runClock(); }, 1); timer.close(); hooks.runClock(); replay.done();
  }); assert.equal(repeated, 1);
});

test('generated sample identities replay exactly and a changed purpose diverges', () => {
  const recorder = createRunRecorder({ startState: {}, capturedAt: '2026-11-06T12:00:00.000Z' });
  const value = hooks.inRun({ recorder }, () => (hooks as any).runIdentity('sample', () => 'sample_00000000-0000-4000-8000-000000000001'));
  const capture = recorder.finish([]), replay = createRunReplay(capture);
  assert.equal(hooks.inRun({ replay }, () => (hooks as any).runIdentity('sample', () => { throw new Error('Identity was regenerated'); })), value); replay.done();
  assert.throws(() => hooks.inRun({ replay: createRunReplay(capture) }, () => (hooks as any).runIdentity('changed', () => value)), { code: 'REPLAY_DIVERGED' });
});
