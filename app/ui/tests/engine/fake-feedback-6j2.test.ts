import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { FeedbackCrashKept, FeedbackView } from '../../src/engine/types';
import { FEEDBACK_NOTICE_DIGEST } from '../../../../platform/runtime/venture/core/feedback-core';

/**
 * The fake engine answers feedback (6J2, D47) as the engine does (platform/tests/feedback-w6.test.ts holds the engine's
 * side): off by default, the notice by its digest, the exact preview, fixed answers to a question after a milestone,
 * scrubbed crashes, and Delete my reports. The rehearsal has no report keys, as a build without them, so Send report
 * says reports are not set up.
 */
const NOW = '2026-11-01T10:00:00.000Z';
const ask = <T>(engine: FakeEngine, method: string, params: Record<string, unknown> = {}) => engine.request(method, params) as Promise<T>;

describe('fake engine: feedback (6J2)', () => {
  it('off by default; opting in by the digest makes a random id and the exact preview; Send report needs report keys', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const first = await ask<FeedbackView>(engine, 'venture.feedback.get');
    expect([first.consent.given, first.preview, first.question, first.reportId, first.setUp.posthog]).toEqual([false, null, null, null, false]);
    expect(first.line).toBe('Reports are off. Nothing leaves this computer.');
    await expect(ask(engine, 'venture.feedback.consent', { digest: 'old', usage: true, crashes: true })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    await expect(ask(engine, 'venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: false, crashes: false })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const on = await ask<FeedbackView>(engine, 'venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: true, crashes: true });
    expect(on.reportId).toMatch(/^rep_[0-9a-f]{16}$/);
    const events = on.preview!.posthog!.events;
    expect(events.map(event => event.event)).toEqual(['chausar_report', 'chausar_milestone', 'chausar_milestone', 'chausar_milestone']);
    expect(events[0]!.properties).toMatchObject({ invoicedThisMonth: 'none', currency: 'INR', channel: 'desktop', $geoip_disable: true });
    expect(on.preview!.sentry).toBeNull();
    await expect(ask(engine, 'venture.feedback.send', { digest: on.preview!.digest })).rejects.toMatchObject({ code: 'FEEDBACK_NOT_SET_UP' });
    await ask(engine, 'venture.feedback.consent', { withdraw: true });
    await expect(ask(engine, 'venture.feedback.send', { digest: on.preview!.digest })).rejects.toMatchObject({ code: 'FEEDBACK_OFF' });
  });

  it('a question after a milestone takes a fixed answer or skip, and the answer joins the preview', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const on = await ask<FeedbackView>(engine, 'venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: true, crashes: false });
    expect(on.question?.id).toBe('ai_connected');
    expect(on.question?.choices.map(choice => choice.label)).toEqual(['Easy', 'Okay', 'Hard']);
    await expect(ask(engine, 'venture.feedback.answer', { questionId: 'ai_connected', answer: 'Fine, thanks' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const answered = await ask<FeedbackView>(engine, 'venture.feedback.answer', { questionId: 'ai_connected', answer: 'hard' });
    expect(answered.question).toBeNull();
    expect(answered.preview!.posthog!.events.filter(event => event.event === 'chausar_answer').map(event => event.properties.answer)).toEqual(['hard']);
    await expect(ask(engine, 'venture.feedback.answer', { questionId: 'ai_connected', answer: 'easy' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });

  it('a crash is kept scrubbed only with crash reports on; Delete my reports turns reports off and says nothing had left', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    expect((await ask<FeedbackCrashKept>(engine, 'venture.feedback.crash', { source: 'window', name: 'TypeError', message: 'x' })).kept).toBe(false);
    await ask(engine, 'venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: false, crashes: true });
    const kept = await ask<FeedbackCrashKept>(engine, 'venture.feedback.crash', { source: 'window', name: 'TypeError', message: 'Cannot read "Cafe Aroma Demo" for Ravi', stack: '    at go (C:\\Users\\Ravi\\app\\ui\\src\\main.tsx:3:4)' });
    expect(kept.kept).toBe(true);
    const view = await ask<FeedbackView>(engine, 'venture.feedback.get');
    const value = view.preview!.sentry!.events[0]!.exception.values[0]!;
    expect(value.value).toBe('Cannot read <text> for <word>');
    expect(value.stacktrace.frames).toEqual([{ function: 'go', filename: 'main.tsx', lineno: 3, colno: 4, in_app: true }]);
    expect(JSON.stringify(view.preview)).not.toMatch(/Ravi|Cafe Aroma/);
    const gone = await ask<FeedbackView>(engine, 'venture.feedback.delete');
    expect([gone.consent.given, gone.reportId, gone.preview]).toEqual([false, null, null]);
    expect(gone.line).toBe('Nothing had left this computer. Reports are off and what was waiting is gone.');
  });
});
