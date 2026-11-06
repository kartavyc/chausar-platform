import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';

/**
 * One-shot C3 task 3: Settings, This app. Animations follow this computer or are off; the choice is the app's own
 * preference (app.preferences.set) and it applies at once through <html data-motion="off">. A fake that answers off at
 * start sets it once the read lands; nothing before.
 */
const MORNING = () => new Date('2026-10-23T04:30:00.000Z');

function start(hash: string, engine = new FakeEngine()) {
  window.location.hash = hash;
  const client = createFakeClient(engine);
  const sent: { method: string; params: unknown }[] = [];
  const spy: EngineClient = { ...client, request: (async (method: string, params: unknown) => { sent.push({ method, params }); return client.request(method as never, params as never); }) as EngineClient['request'] };
  render(<ClockProvider now={MORNING}><App client={spy} language="en" /></ClockProvider>);
  return { sent };
}

afterEach(() => {
  delete document.documentElement.dataset.motion;
});

describe('This app: Animations (one-shot C3 task 3)', () => {
  it('choosing Off sends the preference and puts data-motion="off" on <html>; Follow this computer takes it away', async () => {
    const { sent } = start('#/business/app');
    const off = await screen.findByRole('radio', { name: 'Off' });
    const follow = screen.getByRole('radio', { name: 'Follow this computer' });
    await waitFor(() => expect((follow as HTMLInputElement).checked).toBe(true));
    expect(document.documentElement.dataset.motion).toBeUndefined();
    await act(async () => { fireEvent.click(off); });
    expect(sent.some((call) => call.method === 'app.preferences.set' && (call.params as { motion: string }).motion === 'off')).toBe(true);
    expect(document.documentElement.dataset.motion).toBe('off');
    await waitFor(() => expect((off as HTMLInputElement).checked).toBe(true));
    await act(async () => { fireEvent.click(follow); });
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(screen.getByText(/Off stops every movement in Chausar on this computer\./)).toBeTruthy();
  });

  it('an engine that answers off at start sets data-motion after its answer, and not before', async () => {
    window.location.hash = '#/today';
    const client = createFakeClient(new FakeEngine({ motion: 'off' }));
    let answer: (() => void) | null = null;
    const slow: EngineClient = {
      ...client,
      request: (async (method: string, params: unknown) => {
        if (method === 'app.preferences.get') await new Promise<void>((resolve) => { answer = resolve; });
        return client.request(method as never, params as never);
      }) as EngineClient['request'],
    };
    render(<ClockProvider now={MORNING}><App client={slow} language="en" /></ClockProvider>);
    await waitFor(() => expect(answer).not.toBeNull());
    expect(document.documentElement.dataset.motion).toBeUndefined();
    await act(async () => { answer!(); });
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('off'));
  });

  it('the Settings list holds This app, last in Business (C1 and C3)', async () => {
    start('#/business/plan');
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    expect(within(nav).getByRole('link', { name: 'This app' }).getAttribute('href')).toBe('#/business/app');
  });
});
