// D5: the first run's "Your AI" step offers Install Claude Code when none is found. The press goes to main's own dialog;
// the step shows the install's own progress, then the tools read again, and the owner signs in themselves. Cancel in that
// dialog is said calmly, and a failure offers the same press again.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { ConnectAi } from '../../src/places/onboarding/ConnectAi';

function start(install?: () => Promise<unknown>, transport: EngineClient['transport'] = 'fake') {
  const fake = createFakeClient(new FakeEngine({ fresh: true }));
  const calls: { method: string; params: unknown }[] = [];
  const request = fake.request.bind(fake);
  const client = { ...fake, transport, request: (method: string, params?: unknown) => {
    calls.push({ method, params });
    if (method === 'venture.ai.claude.install' && install) return install();
    return (request as (m: string, p?: unknown) => Promise<unknown>)(method, params);
  } } as unknown as EngineClient;
  render(<TextProvider language="en"><EngineProvider client={client}><ConnectAi onDone={() => {}} onSkip={() => {}} /></EngineProvider></TextProvider>);
  return { calls };
}
const card = () => screen.getByRole('heading', { name: 'Claude plan' }).closest('section')!;

describe('Install Claude Code', () => {
  it('shows only when Claude Code is not found, sends no yes from the window, then reads the tools again', async () => {
    const { calls } = start();
    const button = await within(await waitFor(card)).findByRole('button', { name: 'Install Claude Code' });
    fireEvent.click(button);
    await waitFor(() => expect(within(card()).queryByRole('button', { name: 'Install Claude Code' })).toBeNull());
    expect(calls.find((call) => call.method === 'venture.ai.claude.install')?.params).toEqual({});
    await waitFor(() => expect(card().textContent).toMatch('sign in yourself'));
    expect(calls.filter((call) => call.method === 'venture.ai.tools').length).toBeGreaterThan(1);
    expect(card().textContent).toMatch('Claude Code installed');
  });

  it('a Cancel in the dialog is said calmly, and the button stays', async () => {
    start(() => Promise.reject(new EngineError('CLAUDE_INSTALL_NOT_CHOSEN', 'Nothing was downloaded.', undefined, true)));
    fireEvent.click(await within(await waitFor(card)).findByRole('button', { name: 'Install Claude Code' }));
    await waitFor(() => expect(within(card()).getByRole('status').textContent).toMatch('Nothing was downloaded.'));
    expect(within(card()).queryByRole('alert')).toBeNull();
    expect(within(card()).getByRole('button', { name: 'Install Claude Code' })).toBeTruthy();
  });

  it('a failed install says why and offers the same press', async () => {
    const install = vi.fn(() => Promise.reject(new EngineError('CLAUDE_INSTALL_FAILED', "Anthropic's Claude Code installer stopped with an error.", undefined, true)));
    start(install);
    fireEvent.click(await within(await waitFor(card)).findByRole('button', { name: 'Install Claude Code' }));
    await waitFor(() => expect(card().textContent).toMatch('stopped with an error'));
    fireEvent.click(within(card()).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(install).toHaveBeenCalledTimes(2));
  });

  it('a phone or the web has no such button', async () => {
    start(undefined, 'web');
    await waitFor(card);
    await waitFor(() => expect(card().textContent).toMatch('Not installed yet'));
    expect(within(card()).queryByRole('button', { name: 'Install Claude Code' })).toBeNull();
  });
});
