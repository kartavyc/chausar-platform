import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';

async function start(hash: string, emptyPipeline = false) {
  window.location.hash = hash;
  const client = createFakeClient(new FakeEngine());
  if (emptyPipeline) {
    const base = client.request.bind(client);
    client.request = (async (method: string, params?: unknown) => {
      if (method === 'venture.pipeline.list') {
        const value = await base('venture.pipeline.list', {});
        return { ...value, columns: value.columns.map(column => ({ ...column, count: 0, cards: [] })) };
      }
      if (method === 'venture.leads.list') return { leads: [] };
      if (method === 'venture.network.people') { const value = await base('venture.network.people', { limit: 0 }); return { ...value, total: 0, people: [] }; }
      return base(method as never, params as never);
    }) as EngineClient['request'];
  }
  render(<App client={client} language="en" />);
  return client;
}

describe('Clients: quiet details (B4 task 16)', () => {
  it('keeps the count in the tabs and gives every client a next-step mark', async () => {
    await start('#/clients');
    const list = await screen.findByRole('list', { name: 'Clients' });
    const title = screen.getByRole('heading', { level: 1, name: 'Clients' });
    expect(title.nextElementSibling?.textContent).toBe('');
    for (const row of within(list).getAllByRole('listitem')) expect(row.querySelector('[data-client-next]')).toBeTruthy();
  });

  it('opens needed AI permission first, then folds the recorded permission', async () => {
    const client = await start('#/clients?sheet=client:c-boat');
    const sheet = await screen.findByRole('complementary');
    const allow = await within(sheet).findByRole('button', { name: 'Allow AI access' });
    const fold = allow.closest('details');
    expect(fold?.open).toBe(true);
    expect(sheet.querySelector('details')).toBe(fold);
    await act(async () => { fireEvent.click(allow); });
    await waitFor(() => expect(fold?.open).toBe(false));
    expect(await client.request('venture.client.aiConsent.get', { clientId: 'c-boat' })).toMatchObject({ status: 'agreed' });
    expect(within(sheet).getByText('Allowed')).toBeTruthy();
  });

  it('keeps a new client free of empty sections with one Add details menu', async () => {
    const client = await start('#/clients');
    const created = await client.request('venture.client.add', { name: 'Quiet client' });
    await act(async () => { window.location.hash = `#/clients?sheet=client:${created.id}`; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const sheet = await screen.findByRole('complementary');
    await within(sheet).findByRole('heading', { name: 'Quiet client' });
    await waitFor(() => expect(within(sheet).queryByRole('heading', { name: 'Orders and invoices' })).toBeNull());
    expect(within(sheet).queryByRole('heading', { name: 'What Chausar remembers' })).toBeNull();
    expect(within(sheet).getAllByText('Add details')).toHaveLength(1);
    expect(within(sheet).getByText('Edit details')).toBeTruthy();
  });

  it('hides sending limits until the pipeline has leads', async () => {
    await start('#/clients/pipeline', true);
    await screen.findByRole('heading', { level: 1, name: 'Clients' });
    await waitFor(() => expect(screen.queryByText('Sending limits')).toBeNull());
    expect(screen.getByRole('button', { name: 'Add a lead' }).dataset.variant).toBe('primary');
    expect(screen.getByRole('button', { name: 'Import contacts' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Find people/ })).toBeNull();
  });
  it('outlines the empty network Import button while its sheet is open', async () => {
    await start('#/clients/network', true);
    const opener = await screen.findByRole('button', { name: 'Import a file' });
    expect(opener.dataset.variant).toBe('primary');
    await act(async () => { fireEvent.click(opener); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await screen.findByRole('complementary');
    expect(opener.dataset.variant).toBe('secondary');
  });

});