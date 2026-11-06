import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { QueueRow } from '../../src/engine/types';

// C5 task 9: Reject on a draft offers three one-tap reasons, sent as the decision's answer; Reject with no tap still
// sends no reason (the engine records 'other').
type Seed = Omit<QueueRow, 'digest'>;
const NOW = '2026-10-21T12:00:00.000Z';
const DRAFT: Seed = {
  id: 'q-draft-c5', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Researcher', kind: 'draft', createdAt: '2026-10-21T09:45:00.000Z',
  title: 'Draft reply for Asha Rao', line: 'Read it and tell the agent what to change.',
  actions: [{ id: 'deny', label: 'Reject', primary: false }, { id: 'read', label: 'Read', primary: true }],
};

function start() {
  window.location.hash = '#/today';
  const client = createFakeClient(new FakeEngine({ now: () => NOW, queue: [DRAFT] }));
  const request = client.request.bind(client);
  const spy = vi.fn(async (method: string, params?: unknown) => request(method as never, params as never));
  client.request = spy as unknown as typeof client.request;
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
  return spy;
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); }); await settle(); };
const decides = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.filter(([m]) => m === 'venture.queue.decide').map(([, p]) => p as Record<string, unknown>);

describe('Reject with a reason', () => {
  it('Reject shows Wrong facts, Wrong tone and Not needed; a tap sends its reason', async () => {
    const spy = start();
    const card = (await screen.findByRole('heading', { level: 3, name: 'Draft reply for Asha Rao' })).closest('article') as HTMLElement;
    await press(within(card).getByRole('button', { name: 'Reject' }));
    const reasons = within(card).getByRole('group', { name: 'Why reject it?' });
    expect(within(reasons).getAllByRole('button').map((b) => b.textContent)).toEqual(['Wrong facts', 'Wrong tone', 'Not needed', 'Just reject']);
    expect(decides(spy)).toEqual([]);
    await press(within(reasons).getByRole('button', { name: 'Wrong facts' }));
    await waitFor(() => expect(decides(spy)).toHaveLength(1));
    expect(decides(spy)[0]).toMatchObject({ id: 'q-draft-c5', action: 'deny', answer: 'wrong-fact' });
  });

  it('Just reject sends no reason', async () => {
    const spy = start();
    const card = (await screen.findByRole('heading', { level: 3, name: 'Draft reply for Asha Rao' })).closest('article') as HTMLElement;
    await press(within(card).getByRole('button', { name: 'Reject' }));
    await press(within(card).getByRole('button', { name: 'Just reject' }));
    await waitFor(() => expect(decides(spy)).toHaveLength(1));
    expect(decides(spy)[0]!.answer).toBeUndefined();
  });
});
