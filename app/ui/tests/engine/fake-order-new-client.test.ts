import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// One-shot A1 (row 10), as the engine's money/orders.ts: a client typed with an order is added with it or not at all.
describe('fake order with a new client', () => {
  it('a refused order adds no client; a good one adds the client with it; never both a client and a new one', async () => {
    const client = createFakeClient(new FakeEngine());
    const before = (await client.request('venture.client.list', {})).length;
    await expect(client.request('venture.order.create', { newClient: { name: 'Test Client One' }, offerId: 'offer_shorts', request: 'Six shorts please' }))
      .rejects.toMatchObject({ code: 'PRICE_REQUIRED' });
    await expect(client.request('venture.order.create', { newClient: { name: 'X' }, offerId: 'offer_sponsor', request: 'One mention' }))
      .rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(client.request('venture.order.create', { clientId: 'c-boat', newClient: { name: 'Test Client One' }, offerId: 'offer_sponsor', request: 'One mention' }))
      .rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Choose a client or add a new one, not both.' });
    expect((await client.request('venture.client.list', {})).length).toBe(before);
    const order = await client.request('venture.order.create', { newClient: { name: 'Test Client One' }, offerId: 'offer_sponsor', request: 'One mention' });
    const list = await client.request('venture.client.list', {});
    expect(list.length).toBe(before + 1);
    expect(list.find((c) => c.id === order.clientId)?.name).toBe('Test Client One');
  });
});
