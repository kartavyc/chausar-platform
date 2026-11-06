import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { DeliveryLite, QueueDecision, QueueList, QueueSetPreview } from '../../src/engine/types';

/**
 * The fake engine answers venture.queue.setPreview and venture.delivery.copy (4J2) with the engine's codes and words:
 * the set's digest, items, total and refusals as the engine works them out, and a copy of a draft that went out.
 */
const engine = () => new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' });
const ask = <T>(fake: FakeEngine, method: string, params: Record<string, unknown> = {}) => fake.request(method, params) as Promise<T>;

describe('fake engine: set preview and Make a copy (4J2)', () => {
  it('setPreview: no pick and "all" are refused; each row gets a cost, a refusal when it is not a post or a draft, and one digest', async () => {
    const fake = engine();
    await expect(ask(fake, 'venture.queue.setPreview', { rowIds: [] })).rejects.toMatchObject({ code: 'SET_NEEDS_PICK' });
    await expect(ask(fake, 'venture.queue.setPreview', { rowIds: 'all' })).rejects.toMatchObject({ code: 'SET_NEEDS_PICK' });
    const { rows } = await ask<QueueList>(fake, 'venture.queue.list');
    const picked = rows.filter((row) => row.kind !== 'locked').slice(0, 3);
    const shown = await ask<QueueSetPreview>(fake, 'venture.queue.setPreview', { rowIds: picked.map((row) => row.id) });
    expect(shown.items.map((item) => item.rowId)).toEqual(picked.map((row) => row.id));
    expect(shown.items.every((item) => item.cost === 'USD 0.0000')).toBe(true);
    expect(shown.total.display).toBe('USD 0.0000');
    expect(shown.digest).toMatch(/^[a-f0-9]{8,}/);
    for (const row of picked) {
      const refused = shown.refusals.find((item) => item.rowId === row.id);
      if (row.kind !== 'draft' && row.kind !== 'connector') expect(refused?.reason).toBe('SET_KIND_REFUSED');
    }
    const missing = await ask<QueueSetPreview>(fake, 'venture.queue.setPreview', { rowIds: ['run:gone:review'] });
    expect(missing.refusals).toEqual([{ rowId: 'run:gone:review', reason: 'APPROVAL_STALE', line: 'One of these changed since you picked them. Nothing ran. Look at the set again.' }]);
  });

  it('copy: only a draft that went out; the copy is the owner\'s own draft waiting for review, kept with the others', async () => {
    const fake = engine();
    const runs = await ask<DeliveryLite[]>(fake, 'venture.delivery.list');
    const waiting = runs.find((run) => run.status !== 'accepted' && run.status !== 'edited');
    if (waiting) await expect(ask(fake, 'venture.delivery.copy', { runId: waiting.id })).rejects.toMatchObject({ code: 'COPY_NOT_SENT' });
    await expect(ask(fake, 'venture.delivery.copy', { runId: 'nope' })).rejects.toMatchObject({ code: 'DELIVERY_NOT_FOUND' });
    const sent = runs.find((run) => (run.status === 'accepted' || run.status === 'edited') && !run.practice);
    if (!sent) return;
    const copy = await ask<DeliveryLite>(fake, 'venture.delivery.copy', { runId: sent.id });
    expect([copy.status, copy.servedBy, copy.copiedFrom, copy.orderId, copy.verdict]).toEqual(['ready-for-review', 'owner', sent.id, sent.orderId, null]);
    expect((await ask<DeliveryLite[]>(fake, 'venture.delivery.list')).some((run) => run.id === copy.id)).toBe(true);
  });

  it('set: an item that must be read first answers VIEW_FIRST until queue.view opened it, then the set runs with the preview digest', async () => {
    const fake = engine();
    const rowIds = ['run:d-ep14:review-1'];
    const before = await ask<QueueSetPreview>(fake, 'venture.queue.setPreview', { rowIds });
    expect(before.refusals).toEqual([{ rowId: 'run:d-ep14:review-1', reason: 'VIEW_FIRST', line: 'Open it and read it first.' }]);
    await expect(ask(fake, 'venture.queue.set', { rowIds, digest: before.digest })).rejects.toMatchObject({ code: 'VIEW_FIRST' });
    // 4J19: a preview fetch (no opened) leaves no mark; only the owner's explicit open does.
    await ask(fake, 'venture.queue.view', { kind: 'draft', id: 'draft-ep14' });
    expect((await ask<QueueSetPreview>(fake, 'venture.queue.setPreview', { rowIds })).refusals.map((item) => item.reason)).toEqual(['VIEW_FIRST']);
    await ask(fake, 'venture.queue.view', { kind: 'draft', id: 'draft-ep14', opened: true });
    const shown = await ask<QueueSetPreview>(fake, 'venture.queue.setPreview', { rowIds });
    expect([shown.refusals, shown.digest]).toEqual([[], before.digest]);
    await expect(ask(fake, 'venture.queue.set', { rowIds, digest: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    const result = await ask<{ decisions: QueueDecision[]; line: string }>(fake, 'venture.queue.set', { rowIds, digest: shown.digest });
    expect(result.decisions.map((item) => item.outcome)).toEqual(['done']);
    expect(result.line).toBe('Approved 1 of 1. Each one has its own record.');
    expect((await ask<QueueList>(fake, 'venture.queue.list')).rows.some((row) => row.id === 'run:d-ep14:review-1')).toBe(false);
  });
});
