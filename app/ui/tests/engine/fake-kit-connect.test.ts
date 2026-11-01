// Shared connector parity regressions (5A6). Written for Chausar; no outside code.
import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

describe('shared connector fake parity', () => {
  it('a webhook is an approved write and is not refused by the reading policy', async () => {
    const client = createFakeClient(new FakeEngine());
    const view = await client.request('venture.webhook.set', { kind: 'n8n', url: 'https://hooks.linkedin.com/owner-inbox', secret: 'a-long-signing-secret' });
    expect(view.set).toBe(true);
    expect(view.host).toBe('hooks.linkedin.com');
  });
  it('6F4: a webhook needs a signing secret, as the engine refuses one without', async () => {
    const client = createFakeClient(new FakeEngine());
    for (const extra of [{}, { secret: 'short' }, { secret: 'has a space in it here' }]) {
      await expect(client.request('venture.webhook.set', { kind: 'n8n', url: 'https://flows.example/hook', ...extra } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    }
    await expect(client.request('venture.webhook.set', { kind: 'n8n', url: null, secret: 'a-long-signing-secret' } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });
  it('6F4: webhook.send previews the exact text, sends only that digest, and never twice', async () => {
    const client = createFakeClient(new FakeEngine());
    await expect(client.request('venture.webhook.send', { kind: 'make', subject: 'ord_1', payload: { a: 1 } })).rejects.toMatchObject({ code: 'WEBHOOK_NOT_SET' });
    await client.request('venture.webhook.set', { kind: 'make', url: 'https://flows.example/hook', secret: 'a-long-signing-secret' });
    const preview = await client.request('venture.webhook.send', { kind: 'make', subject: 'ord_1', payload: { b: 2, a: 1 } });
    expect(preview).toMatchObject({ kind: 'make', host: 'flows.example', text: '{"a":1,"b":2}', state: 'preview', status: null, deliveryId: null, attempts: 0, entryId: null });
    await expect(client.request('venture.webhook.send', { kind: 'make', subject: 'ord_1', payload: { a: 2 }, digest: preview.digest })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    const done = await client.request('venture.webhook.send', { kind: 'make', subject: 'ord_1', payload: { a: 1, b: 2 }, digest: preview.digest });
    expect(done).toMatchObject({ state: 'applied', status: 200, attempts: 1 });
    expect(done.line).toContain(done.deliveryId!);
    await expect(client.request('venture.webhook.send', { kind: 'make', subject: 'ord_1', payload: { a: 1, b: 2 }, digest: preview.digest })).rejects.toMatchObject({ code: 'JOURNAL_ALREADY_DECIDED' });
    await expect(client.request('venture.webhook.send', { kind: 'make', subject: 'bad subject', payload: {} })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });
  it('price monitors accept rupee text and refuse the engine\'s invalid and conflicting prices', async () => {
    const client = createFakeClient(new FakeEngine());
    const base = { url: 'https://shop.example/tea', kind: 'price-below' as const, selector: '#price' };
    expect((await client.request('venture.monitors.add', { ...base, belowRupees: '1,200.50' })).kind).toBe('price-below');
    for (const belowRupees of ['0', '-1', '1.505', 'one thousand']) {
      await expect(client.request('venture.monitors.add', { ...base, belowRupees })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    }
    await expect(client.request('venture.monitors.add', { ...base, belowRupees: '1200', belowMinor: '120000' } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(client.request('venture.monitors.add', { ...base, belowMinor: '120000' } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });
});
