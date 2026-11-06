import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { ClientAiConsentView, ClientLite } from '../../src/engine/types';

// C5 task 7: one "Allow AI for new clients" row under Clients, with its own words in a fold; off by default. Turned
// on, a client added afterwards has their own recorded permission; clients already here keep theirs.
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });

describe('Allow AI for new clients', () => {
  it('is off by default; Allow turns it on, and the next client added is allowed while older ones are not', async () => {
    window.location.hash = '#/clients';
    const engine = new FakeEngine();
    render(<App client={createFakeClient(engine)} language="en" />);
    const fold = (await screen.findByText('Allow AI for new clients', { selector: 'summary' })).closest('details') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(within(fold).getByText(/Off/)).toBeTruthy();
    fold.open = true;
    fireEvent(fold, new Event('toggle'));
    expect(within(fold).getByText(/every client you add from now on/)).toBeTruthy();
    const before = (await engine.request('venture.client.list', {}) as ClientLite[])[0]!;
    const beforeStatus = (await engine.request('venture.client.aiConsent.get', { clientId: before.id }) as ClientAiConsentView).status;
    await act(async () => { fireEvent.click(within(fold).getByRole('button', { name: 'Allow for new clients' })); });
    await settle();
    expect(within(fold).getByText('Every client you add gets your AI permission. Clients added before keep their own.')).toBeTruthy();
    const added = await engine.request('venture.client.add', { name: 'Sample Bakery' }) as ClientLite;
    expect((await engine.request('venture.client.aiConsent.get', { clientId: added.id }) as ClientAiConsentView).consent?.grantedBy).toBe('business-default');
    expect((await engine.request('venture.client.aiConsent.get', { clientId: before.id }) as ClientAiConsentView).status).toBe(beforeStatus);
    await act(async () => { fireEvent.click(within(fold).getByRole('button', { name: 'Turn off' })); });
    await settle();
    expect(within(fold).getByText('Each new client asks for your AI permission on their own.')).toBeTruthy();
  });
});
