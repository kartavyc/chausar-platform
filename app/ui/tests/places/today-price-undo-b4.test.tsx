// B4 task 7: on Today, a price accepts on one press and its line carries Undo. Undo opens the card again, says what happened
// and refreshes what a decision refreshes. Too late, the line says so and Undo leaves.
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { BlueprintViewLite } from '../../src/engine/types';

const TITLE = 'New price for Shorts from your long video';

async function start() {
  const engine = new FakeEngine({ queue: [] });
  const plan = await engine.request('venture.blueprint.get', {}) as BlueprintViewLite;
  const offer = plan.blueprint.offers.find((item) => item.name.value === 'Shorts from your long video')!;
  await engine.request('venture.blueprint.update', { patch: { offers: [{ id: offer.id, unitPrice: '12000' }] } });
  window.location.hash = '#/today';
  const client = createFakeClient(engine);
  const asked: string[] = [];
  const base = client.request.bind(client);
  client.request = ((method: string, params: unknown) => { asked.push(method); return base(method as never, params as never); }) as typeof client.request;
  render(<App client={client} language="en" />);
  const needs = await screen.findByRole('region', { name: 'Needs you' });
  return { engine, offer, asked, needs };
}
const cardIn = async (needs: HTMLElement) => (await within(needs).findByText(TITLE)).closest('article')!;
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); }); };

describe('Today: a price on one press', () => {
  it('accepts on one press, with Undo on its line; Undo opens the card again and reads again', async () => {
    const { engine, asked, needs } = await start();
    const card = await cardIn(needs);
    expect(card.hasAttribute('data-second-ask')).toBe(false);
    expect(card.textContent).toContain('Was not set');
    await press(within(card).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(needs.querySelector('[data-decided]')?.textContent).toContain(`${TITLE} accepted.`));
    expect(((await engine.request('venture.blueprint.get', {})) as BlueprintViewLite).blueprint.status).toBe('accepted');

    asked.length = 0;
    await press(within(needs).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(asked).toContain('venture.queue.list'));
    expect(asked).toContain('venture.queue.undo');
    const back = await cardIn(needs);
    await waitFor(() => expect(back.textContent).toContain('You took back the new price for Shorts from your long video.'));
    expect(needs.querySelector('[data-decided]')).toBeNull();
    expect(within(back).getByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(((await engine.request('venture.blueprint.get', {})) as BlueprintViewLite).blueprint.status).toBe('draft');
  });

  it('too late, the line says so and Undo leaves', async () => {
    const { engine, offer, needs } = await start();
    await press(within(await cardIn(needs)).getByRole('button', { name: 'Accept' }));
    await within(needs).findByRole('button', { name: 'Undo' });
    await act(async () => { await engine.request('venture.price.quote', { offerId: offer.id }); });
    await press(within(needs).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(needs.querySelector('[data-decided]')?.textContent).toContain('Too late to undo: this price is already in use.'));
    expect(within(needs).queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});
