// Shared connector parity regressions (5A6). Written for Chausar; no outside code.
import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

describe('shared connector fake parity', () => {
  it('a webhook is an approved write and is not refused by the reading policy', async () => {
    const client = createFakeClient(new FakeEngine());
    const view = await client.request('venture.webhook.set', { kind: 'n8n', url: 'https://hooks.linkedin.com/owner-inbox' });
    expect(view.set).toBe(true);
    expect(view.host).toBe('hooks.linkedin.com');
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
