import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError } from '../../src/engine/types';
import { YoutubeDesk } from '../../src/places/work/desks/YoutubeDesk';
import { deskReady } from '../../src/places/work/PlaybookDesk';
import { assertInkRules } from '../helpers/ink-rules';

/**
 * The business's own desk on Work (Ink v2 wave 5, 5A1): the open business's playbook finds its desk in DESKS, beside
 * its orders, only once its package marks the desk ready; until then Work shows no "Not built yet" stub. And the fake's
 * venture.order.chain answers as the engine does for a flagship business's order.
 */

const ready = YoutubeDesk;
const originalReady = ready.ready;
beforeEach(() => { ready.ready = false; });
afterEach(() => { ready.ready = originalReady; });

async function work() {
  window.location.hash = '#/work';
  const client = createFakeClient(new FakeEngine());
  render(<App client={client} language="en" />);
  await screen.findByRole('heading', { level: 1, name: 'Work' });
  return client;
}

describe('Work: the playbook desk (5A1)', () => {
  it('a desk its package has not marked ready is not shown, so no stub says "Not built yet"', async () => {
    expect(deskReady('youtube')).toBe(false);
    await work();
    await screen.findByRole('region', { name: /Orders/ });
    expect(screen.queryByText('Not built yet')).toBeNull();
    expect(document.querySelector('[data-desk]')).toBeNull();
  });

  it('once the package marks its desk ready, Work shows it under "Your desk" with the playbook, beside the orders', async () => {
    ready.ready = true;
    expect(deskReady('youtube')).toBe(true);
    expect(deskReady('space-tourism')).toBe(false);
    await work();
    const desk = await screen.findByRole('region', { name: 'Your desk' });
    expect(desk.getAttribute('data-desk')).toBe('youtube');
    expect(desk.textContent).toContain('YouTube channel');
    assertInkRules();
  });

  it('venture.order.chain on the fake: a flagship order runs no kit stages; an unknown order is not found', async () => {
    const client = createFakeClient(new FakeEngine());
    const orders = await client.request('venture.order.list', {});
    await expect(client.request('venture.order.chain', { orderId: orders[0]!.id })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: "This order's offer runs no stages of a playbook." });
    await expect(client.request('venture.order.chain', { orderId: 'order_missing' })).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    await expect(client.request('venture.order.chain', { orderId: 'o1', more: 1 } as never)).rejects.toBeInstanceOf(EngineError);
    await waitFor(() => expect(orders.length).toBeGreaterThan(0));
  });
});
