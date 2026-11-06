import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/dom';

/**
 * The hosted sign-in page (app/hosted/hosted.js, W4 4J21 from 4J23): "Start without an account" shows only when the
 * server's trials switch is on (the public GET /api/health says `trials`), says in plain words that the business is
 * temporary until an email is added, and calls POST /api/hosted/trial, then opens the app. Run in jsdom with fetch stubbed.
 */

type Answer = { status: number; body: unknown };
const json = ({ status, body }: Answer) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function load(answers: Record<string, Answer>) {
  document.body.innerHTML = '<main id="main"></main>';
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return json(answers[url] ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Nothing is here.' } } });
  }));
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, hash: '', pathname: '/', assign });
  vi.resetModules();
  // @ts-expect-error: app/hosted/hosted.js is the sign-in page's plain script, with no types.
  await import('../../hosted/hosted.js');
  return { calls, assign };
}

const SIGNED_OUT = { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in first.' } } };

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('the hosted sign-in page and the trial', () => {
  it('trials on: "Start without an account" with its plain words; it starts a trial and opens the app', async () => {
    const { calls, assign } = await load({
      '/api/hosted/session': SIGNED_OUT,
      '/api/health': { status: 200, body: { status: 'ok', mode: 'hosted-experimental', trials: true, trialIdleDays: 7, trialEmptyMinutes: 60 } },
      '/api/hosted/trial': { status: 200, body: { created: true, trial: { temporary: true, line: 'This business is temporary until you add your email.' } } },
      '/api/hosted/select': { status: 200, body: { businessId: null } },
    });
    const button = await screen.findByRole('button', { name: 'Start without an account' });
    expect(document.body.textContent).toContain('The business is temporary until you add your email. It is deleted 7 days after you last use it, or 60 minutes after if you have not made the business yet.');
    fireEvent.click(button);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/app/'));
    const trial = calls.find((call) => call.url === '/api/hosted/trial')!;
    expect(trial.init?.method).toBe('POST');
    expect(trial.init?.credentials).toBe('same-origin');
    expect(JSON.parse(String(trial.init?.body))).toEqual({});
  });

  it('trials off, or the health check unanswered: no trial button, only sign-in', async () => {
    await load({ '/api/hosted/session': SIGNED_OUT, '/api/health': { status: 200, body: { status: 'ok', mode: 'hosted-experimental', trials: false } } });
    await screen.findByRole('button', { name: 'Email me a link' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('button', { name: 'Start without an account' })).toBeNull();
    await load({ '/api/hosted/session': SIGNED_OUT, '/api/health': { status: 500, body: {} } });
    await screen.findByRole('button', { name: 'Email me a link' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('button', { name: 'Start without an account' })).toBeNull();
  });

  it("a refused start shows the server's words", async () => {
    await load({
      '/api/hosted/session': SIGNED_OUT,
      '/api/health': { status: 200, body: { status: 'ok', mode: 'hosted-experimental', trials: true } },
      '/api/hosted/trial': { status: 429, body: { error: { code: 'HOSTED_BUSY', message: 'Too many people are trying Chausar right now. Try again in a few minutes.' } } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Start without an account' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Too many people are trying Chausar right now. Try again in a few minutes.'));
  });
});
