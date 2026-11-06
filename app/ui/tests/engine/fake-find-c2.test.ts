import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type FindItem, type FindView } from '../../src/engine/types';
import { parseFindRequest } from '../../../../platform/runtime/venture/views/find-core';

// C2 task 3: the fake answers venture.find as views/find.ts does, from its own client, invoice, order and run lists and
// its Chats (without marking anything read), ranked by the same find-core.ts.

function setup() {
  const engine = new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' });
  const client = createFakeClient(engine);
  const find = (payload: unknown) => client.request('venture.find', payload as never) as Promise<FindView>;
  return { engine, client, find };
}
const items = (view: FindView, kind: FindItem['kind']) => view.groups.find((group) => group.kind === kind)?.items ?? [];

describe('fake venture.find', () => {
  it('finds the demo invoices by "INV" with their receipts, and a client by name', async () => {
    const { client, find } = setup();
    const invoices = items(await find({ text: 'INV' }), 'invoice') as Extract<FindItem, { kind: 'invoice' }>[];
    const listed = await client.request('venture.invoice.list', {});
    const issued = listed.find((invoice) => invoice.number === 'INV-0039')!;
    const row = invoices.find((item) => item.number === 'INV-0039')!;
    expect(row).toMatchObject({ id: issued.id, status: 'issued', total: issued.total, receiptId: issued.receiptId, clientName: 'Boat Audio' });
    expect(row.hit).toEqual({ field: 'number', start: 0, length: 8 });
    const boat = await find({ text: 'boat audio' });
    expect(boat.groups[0]!.kind).toBe('client');
    expect(items(boat, 'client')[0]).toMatchObject({ id: 'c-boat', name: 'Boat Audio', hit: { field: 'name', start: 0, length: 10 } });
  });

  it('finds a demo chat by a word only in its answer, and leaves its unread count alone', async () => {
    const { client, find } = setup();
    const unread = async () => (await client.request('venture.chief.threads', {})).groups.flatMap((group) => group.threads).find((thread) => thread.id === 'chiefthread-billed')!.unread;
    const before = await unread();
    expect(before).toBeGreaterThan(0);
    const chats = items(await find({ text: 'received' }), 'chat') as Extract<FindItem, { kind: 'chat' }>[];
    const billed = chats.find((chat) => chat.id === 'chiefthread-billed')!;
    expect(billed.title).toBe('How much have we billed this month?');
    expect(billed.hit).toBeNull();
    expect(billed.snippet?.from).toBe('chief');
    expect(billed.snippet?.line).toMatch(/received/);
    expect(billed.snippet!.amounts.length).toBeGreaterThan(0);
    for (const amount of billed.snippet!.amounts) expect(billed.snippet!.line.slice(amount.start, amount.start + amount.length)).toBe(amount.text);
    expect(await unread()).toBe(before);
  });

  it('refuses what the engine refuses, with the same code and words', async () => {
    const { find } = setup();
    for (const payload of [{}, { text: 'x'.repeat(201) }, { text: 'meera', kinds: ['person'] }, { text: 'meera', limit: 21 }, { text: 'meera', extra: 1 }]) {
      let words = '';
      try { parseFindRequest(payload); } catch (error) { words = (error as Error).message; }
      const refusal = await find(payload).then(() => null, (error: unknown) => error);
      expect(refusal).toBeInstanceOf(EngineError);
      expect((refusal as EngineError).code).toBe('INVALID_VENTURE_REQUEST');
      expect((refusal as EngineError).message).toBe(words);
    }
    expect(await find({ text: 'b' })).toEqual({ groups: [] });
  });

  it('looks only in the open business', async () => {
    const { engine, find } = setup();
    expect(items(await find({ text: 'boat' }), 'client').length).toBe(1);
    expect(items(await find({ text: 'mehta' }), 'client')).toEqual([]);
    await engine.request('workspace.open', { folder: 'ledgerline' });
    expect(items(await find({ text: 'boat' }), 'client')).toEqual([]);
    expect(items(await find({ text: 'boat' }), 'chat')).toEqual([]);
    expect(items(await find({ text: 'mehta' }), 'client').map((item) => item.id)).toEqual(['c-mehta']);
    expect(items(await find({ text: 'INV-0041' }), 'invoice').map((item) => (item as Extract<FindItem, { kind: 'invoice' }>).number)).toEqual(['INV-0041']);
  });
});
