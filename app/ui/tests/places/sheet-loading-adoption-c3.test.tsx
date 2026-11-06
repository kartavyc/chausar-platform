import { it, expect } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';

it.each([
  ['client:c-boat', 'venture.client.list'],
  ['company:company-test', 'venture.crm.company'],
  ['list:list-test', 'venture.crm.list'],
  ['lists:all', 'venture.crm.lists'],
  ['person:person_sana', 'venture.network.person'],
  ['card:opp_seed_tara', 'venture.pipeline.list'],
  ['lead:lead-pocket', 'venture.leads.list'],
  ['agent:editor', 'venture.team.list'],
])('%s reserves a still sheet shape while its first read waits', async (sheet, method) => {
  const fake = createFakeClient(new FakeEngine());
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const client: EngineClient = { ...fake, request: (async (name: string, params: unknown) => {
    if (name === method) await pending;
    return fake.request(name as never, params as never);
  }) as EngineClient['request'] };
  window.location.hash = `#/clients?sheet=${encodeURIComponent(sheet)}`;
  const view = render(<App client={client} language="en" />);
  try {
    await waitFor(() => expect(document.querySelector('[data-sheet] [data-skeleton="sheet"]')).not.toBeNull());
    const title = document.querySelector('[data-sheet] h2');
    expect(title?.classList.contains('sr-only')).toBe(true);
    await act(async () => { finish(); });
    await waitFor(() => expect(document.querySelector('[data-sheet] [data-skeleton="sheet"]')).toBeNull());
    expect(document.querySelector('[data-sheet] [data-arrived]')).not.toBeNull();
  } finally {
    await act(async () => { finish(); });
    view.unmount();
  }
});
