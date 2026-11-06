// C5 task 33: the Updates row. Each state's words, the plain "needs" states never faked, turning Check daily off, Check now,
// and Show installer only where the desktop can show one. The engine's answer is a stand-in for the states it can't reach here.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { UpdatesView } from '../../src/places/business/UpdatesView';
import type { UpdatesView as View } from '../../src/engine/types';

const BASE: View = { configured: true, version: '0.1.0', installMode: 'manual-native-installer-required', channel: 'beta', daily: true, state: 'idle', target: null, downloadedBytes: null, reason: null, lastCheckedAt: null };
const MB = 1024 * 1024;

function mount(view: View | null, bridge: Record<string, unknown> = {}) {
  const client = Object.assign(createFakeClient(new FakeEngine()), bridge);
  const real = client.request.bind(client);
  const request = vi.spyOn(client, 'request');
  if (view) {
    request.mockImplementation(((method: string, params: never) => {
      if (method === 'updates.status' || method === 'updates.check') return Promise.resolve(view);
      if (method === 'updates.settings') return Promise.resolve({ ...view, ...(params as object) });
      return real(method as never, params);
    }) as never);
  }
  render(<TextProvider language="en"><EngineProvider client={client as never}><UpdatesView /></EngineProvider></TextProvider>);
  return { request };
}
afterEach(cleanup);

describe('task 33: Updates', () => {
  it.each([
    ['not-set-up', {}, "Updates aren't set up in this copy of Chausar yet."],
    ['idle', {}, 'Not checked yet'],
    ['checking', {}, 'Checking'],
    ['up-to-date', {}, 'Up to date'],
    ['downloading', { target: { version: '0.2.0', bytes: 300 * MB }, downloadedBytes: 120 * MB }, 'Downloading 120 MB'],
    ['ready', { target: { version: '0.2.0', bytes: 300 * MB } }, 'Ready, installs when you quit'],
    ['needs-signing', { target: { version: '0.1.1', bytes: 300 * MB } }, 'Needs a signed installer (Windows)'],
    ['publisher-mismatch', { target: { version: '0.1.1', bytes: 300 * MB } }, "This installer isn't signed by Chausar, so it won't run by itself."],
    ['manual', { target: { version: '0.1.1', bytes: 300 * MB } }, 'Update 0.1.1 is downloaded. Install it yourself:'],
    ['data-newer', { target: { version: '0.1.1', bytes: 300 * MB } }, "This update can't read your newer data."],
    ['failed', { reason: 'The update feed signature is invalid.' }, "Couldn't check: The update feed signature is invalid."],
  ] as const)('%s reads as it is', async (state, extra, words) => {
    mount({ ...BASE, state, ...extra } as View);
    expect((await screen.findByText(words)).textContent).toBe(words);
    expect(screen.getByText(/Version 0\.1\.0/).textContent).toMatch(/beta/);
  });

  it('Windows with no certificate says what it waits on, and offers Show installer on the desktop', async () => {
    const showUpdateInstaller = vi.fn(async () => {});
    mount({ ...BASE, state: 'needs-signing', target: { version: '0.1.1', bytes: 300 * MB } }, { showUpdateInstaller });
    expect(await screen.findByText('Update 0.1.1 is downloaded. Chausar can install updates by itself once its Windows installer is signed. For now, install it yourself:')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show installer' }));
    await waitFor(() => expect(showUpdateInstaller).toHaveBeenCalledWith('staged'));
  });

  it('with no desktop there is no Show installer; a refusal says so in the page', async () => {
    mount({ ...BASE, state: 'manual', target: { version: '0.1.1', bytes: 300 * MB } });
    await screen.findByText('Update 0.1.1 is downloaded. Install it yourself:');
    expect(screen.queryByRole('button', { name: 'Show installer' })).toBeNull();
    cleanup();
    const showUpdateInstaller = vi.fn(async () => { throw Object.assign(new Error('That installer changed on this computer.'), { code: 'UPDATE_NOT_VERIFIED' }); });
    mount({ ...BASE, state: 'manual', target: { version: '0.1.1', bytes: 300 * MB } }, { showUpdateInstaller });
    fireEvent.click(await screen.findByRole('button', { name: 'Show installer' }));
    expect((await screen.findByRole('alert')).textContent).toMatch('That installer changed');
  });

  it('Check daily is on by default; turning it off sends daily:false, and nothing else', async () => {
    const { request } = mount(BASE);
    const daily = await screen.findByRole('checkbox', { name: 'Check daily' }) as HTMLInputElement;
    expect(daily.checked).toBe(true);
    fireEvent.click(daily);
    await waitFor(() => expect(request).toHaveBeenCalledWith('updates.settings', { daily: false }));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Check daily' }) as HTMLInputElement).checked).toBe(false));
  });

  it('Check now asks the engine, and reads the state again while it works', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { request } = mount({ ...BASE, state: 'checking' });
      await screen.findByText('Checking');
      const reads = () => request.mock.calls.filter(([method]) => method === 'updates.status').length;
      const before = reads();
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      expect(reads()).toBeGreaterThan(before);
      expect((screen.getByRole('button', { name: 'Check now' }) as HTMLButtonElement).disabled).toBe(true);
    } finally { vi.useRealTimers(); }
    cleanup();
    const idle = mount(BASE);
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(idle.request).toHaveBeenCalledWith('updates.check', {}));
  });

  it('with no key in this build, the row has no Check daily or Check now to press: only the plain state', async () => {
    mount(null);
    expect(await screen.findByText("Updates aren't set up in this copy of Chausar yet.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Check daily' })).toBeNull();
  });
});
