import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { InvoiceViewLite, UiRunEvent } from '../../src/engine/types';

/**
 * B3 task 1: the engine adds one queue.changed after an owner's record event (records.ts QUEUE_EVENTS), so every
 * window hears a payment, an invoice, a new client, an order and a quote. The fake tells its subscribers the same.
 */
const NOW = '2026-10-23T10:00:00.000Z';
const ask = <T>(engine: FakeEngine, method: string, params: Record<string, unknown> = {}) => engine.request(method, params) as Promise<T>;

function listening(engine: FakeEngine) {
  const heard: UiRunEvent['type'][] = [];
  engine.subscribe((event) => { heard.push(event.type); });
  return { heard, clear: () => { heard.length = 0; } };
}

describe('fake engine: an owner record tells every screen (B3)', () => {
  it('invoice prepare, issue and a payment each publish queue.changed', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const ear = listening(engine);
    const draft = await ask<InvoiceViewLite>(engine, 'venture.invoice.prepare', { orderId: 'o-boat-14' });
    expect(ear.heard).toContain('queue.changed');
    ear.clear();
    const issued = await ask<InvoiceViewLite>(engine, 'venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
    expect(ear.heard).toContain('queue.changed');
    ear.clear();
    await ask(engine, 'venture.payment.record', { invoiceId: issued.invoice.id, amount: '10000', receivedOn: '2026-10-23', method: 'upi' });
    expect(ear.heard).toContain('queue.changed');
  });

  it('a new client, an order and a quote each publish queue.changed', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const ear = listening(engine);
    await ask(engine, 'venture.client.add', { name: 'Test Client One' });
    expect(ear.heard).toContain('queue.changed');
    ear.clear();
    await ask(engine, 'venture.order.create', { newClient: { name: 'Test Client Two' }, offerId: 'offer_sponsor', request: 'One mention' });
    expect(ear.heard).toContain('queue.changed');
    ear.clear();
    await ask(engine, 'venture.price.quote', { offerId: 'offer_sponsor', quantity: '1' });
    expect(ear.heard).toContain('queue.changed');
  });

  it('a refused write publishes nothing', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const ear = listening(engine);
    await expect(ask(engine, 'venture.payment.record', { invoiceId: 'nope', amount: '10', receivedOn: '2026-10-23', method: 'upi' })).rejects.toBeTruthy();
    await expect(ask(engine, 'venture.client.add', { name: '' })).rejects.toBeTruthy();
    expect(ear.heard).toEqual([]);
  });
});
