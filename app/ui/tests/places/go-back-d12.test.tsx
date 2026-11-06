// D12 task 10: after a business couldn't be brought up to date, Welcome back offers to go back, only when the desktop has a
// release that checks out. The press goes to main's own dialog; the window decides nothing.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { Welcome } from '../../src/places/onboarding/Welcome';

function start(extra: Partial<EngineClient>, code = 'DATA_MIGRATION_FAILED') {
  const fake = createFakeClient(new FakeEngine({ fresh: true }));
  const request = fake.request.bind(fake);
  const client = { ...fake, ...extra, request: (method: string, params?: unknown) => {
    if (method === 'workspace.open') return Promise.reject(new EngineError(code, 'This version of Chausar couldn\'t bring your business up to date. Your business is unchanged.', undefined, true));
    return (request as (m: string, p?: unknown) => Promise<unknown>)(method, params);
  } } as unknown as EngineClient;
  const found = { kind: 'welcome', businesses: [{ key: 'main', name: 'Sample', opens: 'passphrase', params: { folder: 'main' } }], closedByOwner: false, complete: true } as never;
  render(<TextProvider language="en"><EngineProvider client={client}><Welcome status={null} found={found} problem={null} hosted={false} onOpen={async () => {}} onOpened={() => {}} onNew={() => {}} /></EngineProvider></TextProvider>);
}

async function failOpen() {
  fireEvent.click(await screen.findByRole('button', { name: /Sample/ }));
  const field = await screen.findByLabelText(/passphrase/i);
  fireEvent.change(field, { target: { value: 'a long private test passphrase' } });
  fireEvent.submit(field.closest('form')!);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBeTruthy());
}

describe('Go back to the kept version', () => {
  it('shows with the version, and pressing it goes to main', async () => {
    const goBack = vi.fn(async () => ({ state: 'cancelled' }));
    start({ goBackOffer: async () => ({ version: '0.1.0' }), goBack } as never);
    await failOpen();
    fireEvent.click(await screen.findByRole('button', { name: 'Go back to version 0.1.0' }));
    await waitFor(() => expect(goBack).toHaveBeenCalledTimes(1));
    expect(goBack).toHaveBeenCalledWith();
  });

  it('with nothing to go back to, or for any other refusal, there is no button', async () => {
    start({ goBackOffer: async () => null } as never);
    await failOpen();
    await new Promise((accept) => setTimeout(accept, 20));
    expect(screen.queryByRole('button', { name: /Go back to version/ })).toBeNull();
  });

  it('a wrong passphrase never offers it', async () => {
    const goBackOffer = vi.fn(async () => ({ version: '0.1.0' }));
    start({ goBackOffer } as never, 'UNLOCK_FAILED');
    await failOpen();
    expect(screen.queryByRole('button', { name: /Go back to version/ })).toBeNull();
    expect(goBackOffer).not.toHaveBeenCalled();
  });
});
