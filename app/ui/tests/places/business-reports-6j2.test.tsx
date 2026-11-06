// Wave 6 package 6J2 (D47): Business > Reports. Off by default; the privacy notice comes first; turning reports on
// shows exactly what Send report would send; Send report goes by the preview's digest; Delete my reports asks twice.
// A short question after a milestone shows on Today with fixed answers. The app window passes its crashes to the engine,
// which keeps them only while crash reports are on. No real PostHog or Sentry is called.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { ReportsView } from '../../src/places/business/ReportsView';
import { FeedbackQuestion } from '../../src/parts/FeedbackQuestion';
import { startCrashRelay } from '../../src/shell/crash-relay';
import { FEEDBACK_NOTICE_DIGEST } from '../../../../platform/runtime/venture/core/feedback-core';

const NOW = '2026-11-01T10:00:00.000Z';

function mount(node: React.ReactElement) {
  const client = createFakeClient(new FakeEngine({ now: () => NOW }));
  const request = vi.spyOn(client, 'request');
  render(<TextProvider language="en"><EngineProvider client={client}>{node}</EngineProvider></TextProvider>);
  return { client, request };
}

describe('Business > Reports (6J2)', () => {
  it('off by default with the notice; turning on shows the exact preview; Send report goes by its digest', async () => {
    const { request } = mount(<ReportsView />);
    expect(await screen.findByText(/Reports are off. Nothing leaves this computer./)).toBeTruthy();
    // Let the page set the boxes to what is in force before ticking one (a slow runner can tick first otherwise).
    await act(async () => {});
    expect(screen.getByText(/never holds names, client details, message text, file names, amounts or keys/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'What Send report sends' })).toBeNull();
    const usage = screen.getByRole('checkbox', { name: /Usage reports/ }) as HTMLInputElement;
    const crashes = screen.getByRole('checkbox', { name: /Crash reports/ }) as HTMLInputElement;
    expect([usage.checked, crashes.checked]).toEqual([false, false]);
    fireEvent.click(usage);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on reports' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: true, crashes: false }));
    const preview = (await screen.findByRole('heading', { name: 'What Send report sends' })).parentElement!;
    expect(preview.textContent).toMatch(/chausar_report/);
    expect(preview.textContent).toMatch(/Only each service's own key is added on the way/);
    expect(preview.querySelector('[data-content]')).toBeTruthy();
    const lastFeedback = request.mock.calls.findLastIndex(([method]) => String(method).startsWith('venture.feedback'));
    const digest = (await request.mock.results[lastFeedback]!.value as { preview: { digest: string } }).preview.digest;
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('venture.feedback.send', { digest }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/not set up in this build/);
  });

  it('Delete my reports asks twice, then says what happened', async () => {
    const { client, request } = mount(<ReportsView />);
    await client.request('venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: true, crashes: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete my reports' }));
    expect(request.mock.calls.map(([method]) => method)).not.toContain('venture.feedback.delete');
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my reports' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('venture.feedback.delete', {}));
    expect(await screen.findByText('Nothing had left this computer. Reports are off and what was waiting is gone.')).toBeTruthy();
  });

  it('a short question after a milestone: fixed answers, gone once answered; nothing shows while reports are off', async () => {
    const off = mount(<FeedbackQuestion />);
    await waitFor(() => expect(off.request).toHaveBeenCalledWith('venture.feedback.get', {}));
    expect(screen.queryByRole('region', { name: 'A short question' })).toBeNull();
    off.request.mockRestore();
    document.body.innerHTML = '';
    const client = createFakeClient(new FakeEngine({ now: () => NOW }));
    await client.request('venture.feedback.consent', { digest: FEEDBACK_NOTICE_DIGEST, usage: true, crashes: false });
    const request = vi.spyOn(client, 'request');
    render(<TextProvider language="en"><EngineProvider client={client}><FeedbackQuestion /></EngineProvider></TextProvider>);
    const card = await screen.findByRole('region', { name: 'A short question' });
    expect(card.textContent).toMatch(/How easy was connecting your AI\?/);
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('venture.feedback.answer', { questionId: 'ai_connected', answer: 'hard' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'A short question' })).toBeNull());
  });

  it('the window passes its crashes to the engine, at most five a session, and never fails itself', async () => {
    const target = new EventTarget();
    const sent: unknown[] = [];
    const stop = startCrashRelay({ request: async (method: string, params: unknown) => { sent.push([method, params]); throw new Error('engine down'); } } as never, target);
    const error = new TypeError('Cannot read "Cafe Aroma Demo"');
    for (let i = 0; i < 7; i += 1) target.dispatchEvent(Object.assign(new Event('error'), { error, message: error.message }));
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new RangeError('Invalid array length') }));
    await Promise.resolve();
    expect(sent.length).toBe(5);
    expect(sent[0]).toEqual(['venture.feedback.crash', { source: 'window', name: 'TypeError', message: 'Cannot read "Cafe Aroma Demo"', stack: error.stack }]);
    stop();
  });
});
