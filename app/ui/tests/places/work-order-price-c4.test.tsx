// One-shot C4 task 11: the order form shows the picked service's price with its receipt, an unpriced service says how
// to fix it and keeps the form's words while the owner sets the price, and each order card shows its price.
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { MethodName } from '../../src/engine/types';
import { assertFiguresProved, receiptMark } from '../helpers/ink-rules';

type Call = { method: string; params: unknown };

async function start(hash = '#/work') {
  window.location.hash = hash;
  const engine = new FakeEngine();
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => { calls.push({ method, params }); return request(method, params as never); }) as typeof client.request;
  render(<App client={client} language="en" />);
  return { engine, client, calls };
}
const go = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };

async function openForm() {
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'New order' })); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  const sheet = await screen.findByRole('complementary', { name: 'New order' });
  const clientField = await within(sheet).findByLabelText('Client');
  await within(clientField).findByRole('option', { name: 'Boat Audio' });
  const service = within(sheet).getByLabelText('Service');
  await within(service).findByRole('option', { name: 'Sponsor slot' });
  return { sheet, clientField, service };
}

describe('C4 task 11: prices on the order form and the order card', () => {
  it('a picked service shows its price with the receipt under it', async () => {
    await start();
    const { sheet, service } = await openForm();
    fireEvent.change(service, { target: { value: 'offer_sponsor' } });
    const price = await within(sheet).findByTestId('picked-price');
    expect(price.textContent).toMatch(/₹/);
    expect(within(price).getByRole('button', { name: /receipt/i })).toBeTruthy();
    assertFiguresProved(price);
  });

  it('an unpriced service says what to do before submit, and Set price keeps the words for the form', async () => {
    const { calls } = await start();
    const { sheet, clientField, service } = await openForm();
    fireEvent.change(clientField, { target: { value: 'c-boat' } });
    fireEvent.change(within(sheet).getByLabelText('What they asked for'), { target: { value: 'Shorts from episode 15' } });
    fireEvent.change(service, { target: { value: 'offer_shorts' } });
    const line = await within(sheet).findByText('Set a price for Shorts from your long video first.');
    expect(line).toBeTruthy();
    expect((within(sheet).getByRole('button', { name: 'Add order' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Set price' })); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(window.location.hash.startsWith('#/business/prices')).toBe(true);
    expect(calls.some((c) => c.method === 'venture.order.create')).toBe(false);
    await go('#/work');
    const back = await openForm();
    expect((back.clientField as HTMLSelectElement).value).toBe('c-boat');
    expect((within(back.sheet).getByLabelText('What they asked for') as HTMLTextAreaElement).value).toBe('Shorts from episode 15');
  });

  it('each order card shows its price with its receipt', async () => {
    await start();
    const orders = await screen.findByRole('region', { name: 'Orders' });
    const card = (await within(orders).findByText('Two mentions in episode 14')).closest('li')!;
    await waitFor(() => expect(within(card).getByRole('button', { name: receiptMark('R-0415') })).toBeTruthy());
    expect(card.textContent).toContain('₹30,000');
    assertFiguresProved(card);
  });

  it('a refused order with a new client adds no client', async () => {
    const { engine } = await start();
    const before = (await engine.request('venture.client.list', {}) as unknown[]).length;
    await expect(engine.request('venture.order.create', { newClient: { name: 'Nobody Yet' }, offerId: 'offer_shorts', request: 'Shorts please' })).rejects.toThrow();
    expect((await engine.request('venture.client.list', {}) as unknown[]).length).toBe(before);
  });
});
