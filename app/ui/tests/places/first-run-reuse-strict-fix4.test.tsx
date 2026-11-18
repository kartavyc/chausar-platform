import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { REUSE_WAIT_MS } from '../../src/places/onboarding/FirstRun';

/*
 * Fix round 4 (sample-data item 2): New business sat at "Checking this computer" for ever in the development app. The
 * step asks the engine once whether the AI already used on this computer can be used again (venture.ai.reuse). React's
 * strict mode mounts, unmounts and mounts again: the first mount's answer was thrown away at its unmount, and the second
 * mount never asked, because a ref said it had been asked. The built app mounts once and was not affected, but nothing
 * ever left the step when the answer was lost. The request is still sent once; every mount waits on that one answer;
 * and with no answer at all the step moves on to "Connect your AI" by itself.
 */
function start(reuse?: (ask: () => Promise<unknown>) => Promise<unknown>) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: 'Asia/Kolkata' }; });
  window.location.hash = '#/today';
  const engine = new FakeEngine();
  const fake = createFakeClient(engine);
  const sent: string[] = [];
  const client: EngineClient = { ...fake, request: ((method: string, params?: unknown) => {
    sent.push(method);
    const ask = () => fake.request(method as never, params as never) as Promise<unknown>;
    return method === 'venture.ai.reuse' && reuse ? reuse(ask) : ask();
  }) as EngineClient['request'] };
  return { engine, fake, sent, show: () => { render(<StrictMode><App client={client} language="en" /></StrictMode>); } };
}
async function connectCodex(env: ReturnType<typeof start>) {
  env.engine.firstRun.signIn();
  const codex = (await env.fake.request('venture.models.presets', {})).find((preset) => preset.id === 'codex-cli')!;
  await env.fake.request('venture.models.connect', { presetId: 'codex-cli', consentDigest: codex.consentDigest });
}
async function newBusiness() {
  const rail = await screen.findByRole('navigation', { name: 'Places' });
  await act(async () => { fireEvent.click(await within(rail).findByRole('button', { name: /Lumen Studio/ })); });
  const menu = await screen.findByRole('dialog', { name: 'Business menu for Lumen Studio' });
  await act(async () => { fireEvent.click(within(menu).getByRole('button', { name: 'New business' })); });
}
const asked = (sent: string[]) => sent.filter((method) => method === 'venture.ai.reuse').length;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('New business in strict mode: "Checking this computer" always moves on', () => {
  it('with nothing to use again, step 1 shows; the engine is asked once', async () => {
    const env = start();
    env.show();
    await newBusiness();
    expect(await screen.findByRole('heading', { name: 'Connect your AI' })).toBeTruthy();
    expect(screen.queryByText('Checking this computer', { selector: '[role="status"]' })).toBeNull();
    expect(asked(env.sent)).toBe(1);
  });

  it('with Codex connected on this computer, the owner starts at "What work do you do?"', async () => {
    const env = start();
    await connectCodex(env);
    env.show();
    await newBusiness();
    expect(await screen.findByRole('heading', { name: 'What work do you do?' })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Setup steps' })).getByText('Connected: ChatGPT plan')).toBeTruthy();
    expect(asked(env.sent)).toBe(1);
  });

  it('a refused check is step 1 as ever', async () => {
    const env = start(() => Promise.reject(new EngineError('AI_SETUP_UNAVAILABLE', 'The setup could not be read.')));
    env.show();
    await newBusiness();
    expect(await screen.findByRole('heading', { name: 'Connect your AI' })).toBeTruthy();
    expect(asked(env.sent)).toBe(1);
  });

  it('a check that never answers still moves on to step 1 after the wait', async () => {
    const env = start(() => new Promise(() => { /* never */ }));
    // The fake clock runs with the real one, so the page works as ever, and the wait can be jumped over below.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    env.show();
    await newBusiness();
    expect(await screen.findByText('Checking this computer')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Connect your AI' })).toBeNull();
    expect(REUSE_WAIT_MS).toBeGreaterThanOrEqual(30_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(REUSE_WAIT_MS + 1000); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Connect your AI' })).toBeTruthy(), { timeout: 3000 });
  });
});
