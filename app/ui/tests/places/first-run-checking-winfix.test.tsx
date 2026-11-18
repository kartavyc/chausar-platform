import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { SIGN_IN_CHATGPT, SIGN_IN_CLAUDE } from './first-run-steps';

/**
 * Seen in the real app on Windows (15 Nov 2026): the first screen's "Checking this computer" took 32 to 38 seconds on
 * the first start, and the two sign-in buttons could not be pressed until it ended. The check (venture.ai.tools) looks
 * for each tool, checks the reviewed Codex's digest and runs each tool's own status command, and on a first start
 * those are slow. The buttons need only the engine's words of what a connection sends (venture.ai.options), which
 * starts nothing. So the words are asked for first, the buttons can be pressed as soon as they are here, and the check
 * runs behind them; a press before the check has answered waits for it and then goes on, with every step still the
 * engine's own.
 */
type Held = { method: string; release: () => void };
function start() {
  window.location.hash = '#/today';
  const fake = createFakeClient(new FakeEngine({ fresh: true }));
  const sent: string[] = [];
  const held: Held[] = [];
  const hold = new Set(['venture.ai.options', 'venture.ai.tools']);
  const client: EngineClient = { ...fake, request: ((method: string, params?: unknown) => {
    sent.push(method);
    const answer = () => fake.request(method as never, params as never) as Promise<unknown>;
    if (!hold.has(method)) return answer();
    return new Promise((resolve, reject) => { held.push({ method, release: () => { answer().then(resolve, reject); } }); });
  }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  const release = async (method: string) => {
    const index = held.findIndex((item) => item.method === method);
    expect(index, `${method} is not waiting`).toBeGreaterThan(-1);
    const [item] = held.splice(index, 1);
    await act(async () => { item!.release(); await Promise.resolve(); });
  };
  return { sent, held, release, stopHolding: (method: string) => { hold.delete(method); } };
}
const button = (name: string) => screen.findByRole('button', { name }) as Promise<HTMLButtonElement>;

describe('Connect your AI: the sign-in buttons do not wait for the check of this computer', () => {
  it('asks for the words of what is sent first, and starts the check only once they are here', async () => {
    const env = start();
    await screen.findByRole('heading', { name: 'Connect your AI' });
    await waitFor(() => expect(env.sent).toContain('venture.ai.options'));
    // The check starts nothing while the words are on their way.
    expect(env.sent).not.toContain('venture.ai.tools');
    expect((await button(SIGN_IN_CHATGPT)).disabled).toBe(true);
    await env.release('venture.ai.options');
    await waitFor(() => expect(env.sent).toContain('venture.ai.tools'));
    expect(env.sent.indexOf('venture.ai.options')).toBeLessThan(env.sent.indexOf('venture.ai.tools'));
  });

  it('the buttons can be pressed while the check is still running, and say it is still checking', async () => {
    const env = start();
    await screen.findByRole('heading', { name: 'Connect your AI' });
    await waitFor(() => expect(env.held.some((item) => item.method === 'venture.ai.options')).toBe(true));
    await env.release('venture.ai.options');
    await waitFor(() => expect(env.held.some((item) => item.method === 'venture.ai.tools')).toBe(true));
    // The check has not answered, and both buttons are ready; the line says the check is still on.
    for (const name of [SIGN_IN_CHATGPT, SIGN_IN_CLAUDE]) expect((await button(name)).disabled).toBe(false);
    expect(screen.getByText('Checking this computer')).toBeTruthy();
    // The words of what a connection sends are on the screen before any press.
    expect(screen.getByText(/What's sent/i)).toBeTruthy();
  });

  it('a press before the check answered waits for it, then goes on with the tool\'s own sign-in', async () => {
    const env = start();
    await screen.findByRole('heading', { name: 'Connect your AI' });
    await waitFor(() => expect(env.held.some((item) => item.method === 'venture.ai.options')).toBe(true));
    await env.release('venture.ai.options');
    await waitFor(() => expect(env.held.some((item) => item.method === 'venture.ai.tools')).toBe(true));
    const chatgpt = await button(SIGN_IN_CHATGPT);
    await act(async () => { fireEvent.click(chatgpt); });
    // The press is being carried out: the button is busy, nothing was started yet, and no second press can go.
    expect(chatgpt.getAttribute('aria-busy')).toBe('true');
    expect(chatgpt.disabled).toBe(true);
    expect(env.sent).not.toContain('venture.ai.login.start');
    // The check answers (the page's own look and the press's): the sample Codex is signed out, so its sign-in starts.
    env.stopHolding('venture.ai.tools');
    while (env.held.some((item) => item.method === 'venture.ai.tools')) await env.release('venture.ai.tools');
    await waitFor(() => expect(env.sent).toContain('venture.ai.login.start'));
    // Signing in is the tool's own step; nothing is connected until it ends.
    expect(env.sent).not.toContain('venture.ai.connect');
  });
});
