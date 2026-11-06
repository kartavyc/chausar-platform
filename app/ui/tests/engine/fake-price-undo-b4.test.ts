// B4 task 7: the fake answers a price's one press and its Undo as the engine does (platform/tests/venture-price-undo-b4.test.ts),
// in the same words.
import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { BlueprintViewLite, QueueDecision, QueueList, QueueRow } from '../../src/engine/types';

/** A business with an accepted plan: the sample's Lumen Studio. */
async function start() {
  const engine = new FakeEngine();
  const plan = await engine.request('venture.blueprint.get', {}) as BlueprintViewLite;
  return { engine, plan };
}
const planRow = async (engine: FakeEngine) => ((await engine.request('venture.queue.list', { scope: 'current' })) as QueueList).rows.find((row) => row.viewRef?.kind === 'plan');
const setPrice = (engine: FakeEngine, id: string, unitPrice: string) => engine.request('venture.blueprint.update', { patch: { offers: [{ id, unitPrice }] } });
const press = (engine: FakeEngine, row: QueueRow) => engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' }) as Promise<QueueDecision>;
const undo = (engine: FakeEngine, row: QueueRow) => engine.request('venture.queue.undo', { rowId: row.id }) as Promise<{ restored: boolean; line: string }>;
/** The price in use, as the fake's own orders read it. */
const accepted = (engine: FakeEngine, offerId: string) => (engine as unknown as { desk: { acceptedOffersFor(id: string): { id: string; pricing: { unitPriceMinor: string | null } }[] } }).desk.acceptedOffersFor('lumen').find((offer) => offer.id === offerId)?.pricing.unitPriceMinor;

describe('a price accepted on one press, in the fake', () => {
  it('has no second ask, and Undo restores the previous version and brings the same row back', async () => {
    const { engine, plan } = await start();
    const [first] = plan.blueprint.offers;
    const was = accepted(engine, first!.id);
    await setPrice(engine, first!.id, '3000');
    const row = (await planRow(engine))!;
    expect(row.kind).toBe('price');
    expect(row.actions.find((action) => action.id === 'approve')?.secondAsk).toBeUndefined();

    const decided = await press(engine, row);
    expect(decided).toEqual({ outcome: 'done', line: `New price for ${first!.name.value} accepted.`, undoable: true });
    expect(accepted(engine, first!.id)).toBe('300000');

    await expect(undo(engine, row)).resolves.toEqual({ restored: true, line: `You took back the new price for ${first!.name.value}.` });
    expect(accepted(engine, first!.id)).toBe(was);
    const latest = await engine.request('venture.blueprint.get', {}) as BlueprintViewLite;
    expect(latest.blueprint.status).toBe('draft');
    const back = (await planRow(engine))!;
    expect(back.id).toBe(row.id);
    expect(back.digest).toBe(row.digest);
    await expect(undo(engine, row)).rejects.toMatchObject({ code: 'UNDO_NOTHING', message: 'Nothing to undo here.' });
    const { decisions } = await engine.request('venture.decisions.list', {}) as { decisions: { action: string; reason: string; line: string }[] };
    expect(decisions.find((item) => item.action === 'undo')).toMatchObject({ reason: `You took back the new price for ${first!.name.value}.`, line: `You decided: You took back the new price for ${first!.name.value}.` });
    // Decided again, it is one press again.
    expect((await press(engine, back)).undoable).toBe(true);
  });

  it('a change beyond the price, or two prices, keeps its second ask and refuses in the engine\'s words', async () => {
    const { engine, plan } = await start();
    await engine.request('venture.blueprint.update', { patch: { oneLiner: 'Monthly books for cafes and bakeries.', offers: [{ id: plan.blueprint.offers[0]!.id, unitPrice: '3000' }] } });
    const row = (await planRow(engine))!;
    expect(row.actions.find((action) => action.id === 'approve')?.secondAsk).toBe(true);
    expect((await press(engine, row)).undoable).toBeUndefined();
    await expect(undo(engine, row)).rejects.toMatchObject({ code: 'UNDO_NOTHING', message: 'Your plan change is still a draft in the business menu. Accept it there.' });

    const other = await start();
    const [one, two] = other.plan.blueprint.offers;
    await other.engine.request('venture.blueprint.update', { patch: { offers: [{ id: one!.id, unitPrice: '3000' }, { id: two!.id, unitPrice: '9000' }] } });
    const both = (await planRow(other.engine))!;
    expect(both.title).toBe('New prices in your plan');
    expect(both.actions.find((action) => action.id === 'approve')?.secondAsk).toBe(true);
  });

  it('a quote before the press leaves Undo; one after it, an order or an invoice is too late', async () => {
    const TOO_LATE = { code: 'UNDO_TOO_LATE', message: 'Too late to undo: this price is already in use.' };
    const { engine, plan } = await start();
    const [first, second] = plan.blueprint.offers;
    await setPrice(engine, first!.id, '3000');
    await engine.request('venture.price.quote', { offerId: first!.id });
    const row = (await planRow(engine))!;
    await press(engine, row);
    // Another offer's quote does not use this price.
    if (second!.pricing.unitPriceMinor !== null) await engine.request('venture.price.quote', { offerId: second!.id });
    await undo(engine, row);

    const back = (await planRow(engine))!;
    await press(engine, back);
    await engine.request('venture.price.quote', { offerId: first!.id });
    await expect(undo(engine, back)).rejects.toMatchObject(TOO_LATE);

    const ordered = await start();
    const offer = ordered.plan.blueprint.offers[0]!;
    await setPrice(ordered.engine, offer.id, '3000');
    const orderRow = (await planRow(ordered.engine))!;
    await press(ordered.engine, orderRow);
    const clients = await ordered.engine.request('venture.client.list', {}) as { id: string }[];
    const order = await ordered.engine.request('venture.order.create', { clientId: clients[0]!.id, offerId: offer.id, request: 'September books' });
    expect(order).toBeTruthy();
    await expect(undo(ordered.engine, orderRow)).rejects.toMatchObject(TOO_LATE);

    const invoiced = await start();
    const billed = invoiced.plan.blueprint.offers[0]!;
    const clientsAgain = await invoiced.engine.request('venture.client.list', {}) as { id: string }[];
    const earlier = await invoiced.engine.request('venture.order.create', { clientId: clientsAgain[0]!.id, offerId: billed.id, request: 'October books' }) as { id: string };
    await setPrice(invoiced.engine, billed.id, '3000');
    const billRow = (await planRow(invoiced.engine))!;
    await press(invoiced.engine, billRow);
    await invoiced.engine.request('venture.invoice.prepare', { orderId: earlier.id, dueInDays: 15 });
    await expect(undo(invoiced.engine, billRow)).rejects.toMatchObject(TOO_LATE);
  });

  it('a newer version of the plan is too late', async () => {
    const { engine, plan } = await start();
    const [first] = plan.blueprint.offers;
    await setPrice(engine, first!.id, '3000');
    const row = (await planRow(engine))!;
    await press(engine, row);
    await setPrice(engine, first!.id, '3500');
    await expect(undo(engine, row)).rejects.toMatchObject({ code: 'UNDO_TOO_LATE', message: 'Too late to undo: this price is already in use.' });
  });

  it('Undo tells every screen', async () => {
    const { engine, plan } = await start();
    await setPrice(engine, plan.blueprint.offers[0]!.id, '3000');
    const row = (await planRow(engine))!;
    await press(engine, row);
    const seen: string[] = [];
    engine.subscribe((event) => { seen.push(event.type); });
    await undo(engine, row);
    expect(seen).toContain('queue.changed');
  });
});
