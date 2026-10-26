import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { CashView, OrderLite, RunDetail } from '../../src/engine/types';

/**
 * 4Z2: the fake answers as the engine does where a cold review of the screenshots found it did not.
 */
describe('the fake as the engine (4Z2)', () => {
  it('names no lowest week while cash stays at or above today, as money/cash.ts does, and says so in its line', async () => {
    const engine = new FakeEngine({ now: () => '2026-10-26T10:00:00.000Z' });
    const cash = await engine.request('venture.money.cash', {}) as CashView;
    expect(cash.bank).not.toBeNull();
    expect(cash.lowest.onTime).toBeNull();
    expect(cash.lowest.ifLateNeverPay).toBeNull();
    expect(cash.line).toBe('Projected, if clients pay on time: cash does not fall in the next 13 weeks.');
  });

  it('keeps episode 12 delivered before it was invoiced, as the engine records it (its Publish step is done)', async () => {
    const engine = new FakeEngine();
    const orders = await engine.request('venture.order.list', {}) as OrderLite[];
    const episode12 = orders.find((order) => order.id === 'o-boat-12')!;
    // order.deliver sets status delivered; invoice.issue then leaves a delivered order's status as it is.
    expect(episode12.status).toBe('delivered');
    expect(episode12.deliveredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(episode12.stages?.find((stage) => stage.id === 'publish')?.state).toBe('done');
  });

  it('sends no result line on a failed delivery run, as views/runs.ts resultOf does; the error and fix code stay', async () => {
    const engine = new FakeEngine();
    const failed = await engine.request('venture.runs.get', { runId: '28' }) as RunDetail;
    expect(failed.state).toBe('failed');
    expect(failed.result).toBeUndefined();
    expect(failed.fixKind).toBe('install-ffmpeg');
    expect(failed.error).toBe('The renderer stopped: ffmpeg was not found on this computer.');
  });
});
