import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import { FAKE_PREVIEWS, withFakeOrderSteps } from '../../src/engine/fake-previews';
import type { InvoiceLite, OrderLite, QueueList, RunDetail } from '../../src/engine/types';

const list = (engine: FakeEngine) => engine.request('venture.queue.list', { scope: 'all' }) as Promise<QueueList>;

describe('fake engine: card previews, order steps and the poster (4J3)', () => {
  it("adds the engine's previews to its own rows after the digest, and none to a row with nothing to show", async () => {
    const engine = new FakeEngine();
    const rows = (await list(engine)).rows;
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const [id, preview] of Object.entries(FAKE_PREVIEWS)) expect(byId.get(id)?.preview, id).toEqual(preview);
    expect(byId.get('q-setup-ai')?.preview).toBeUndefined();
    expect(byId.get('q-price-sponsor')?.preview).toBeUndefined();
    // A decision still binds the digest the row had before its preview: a row with a preview decides like any other.
    const invoice = byId.get('q-invoice-mehta')!;
    const decided = await engine.request('venture.queue.decide', { id: invoice.id, digest: invoice.digest, action: 'issue' });
    expect(decided).toMatchObject({ outcome: 'done' });
  });

  it('keeps the engine rules in its previews: amounts with receipts, model words flagged, no made-up still', () => {
    for (const preview of Object.values(FAKE_PREVIEWS)) {
      if (preview.kind === 'video') expect(preview.poster).toBeUndefined();
      if (preview.kind === 'choice') expect(preview.options.filter((option) => option.estimate).every((option) => option.text.estimate || option.estimate)).toBe(true);
    }
  });

  it("opens every preview figure's receipt through the method its kind names, as the engine serves it", async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    const methods = { price: 'venture.receipt.get', sum: 'venture.receipt.get', ca: 'venture.ca.receipt', work: 'venture.work.get' } as const;
    const figures = Object.values(FAKE_PREVIEWS).flatMap((preview) => (preview.kind !== 'paper' ? []
      : preview.paper === 'invoice' ? [...preview.lines, preview.subtotal, ...preview.taxLines, preview.total] : preview.working));
    expect(new Set(figures.map((figure) => figure.receiptKind))).toEqual(new Set(['price', 'ca']));
    for (const figure of figures) {
      const receipt = await engine.request(methods[figure.receiptKind], { id: figure.receiptId }) as { id: string; figures?: { label: string; display: string }[] };
      expect(receipt.id, figure.label).toBe(figure.receiptId);
      // A CA receipt's figures are the ones the working shows.
      if (figure.receiptKind === 'ca') expect(receipt.figures?.some((item) => item.label === figure.label && item.display === figure.value), figure.label).toBe(true);
    }
  });

  it('reads an order the fake made from its invoice, not from the order alone', () => {
    const order: OrderLite = { id: 'o-new', at: '2026-10-21T09:00:00.000Z', clientId: 'c-boat', offerId: 'offer_sponsor', quantity: '1', request: 'One mention', status: 'open', priceReceiptId: 'R-0415', deliveredOn: null };
    const invoice = (status: InvoiceLite['status']): InvoiceLite => ({ id: 'i-new', at: '2026-10-21T10:00:00.000Z', orderId: 'o-new', clientId: 'c-boat', number: status === 'draft' ? null : 'INV-0050', status, issueDate: null, dueDate: '2026-11-05' });
    const steps = (invoices: InvoiceLite[]) => withFakeOrderSteps(order, invoices).stages?.slice(-2).map((stage) => [stage.id, stage.state, stage.reason ?? null]);
    expect(steps([])).toEqual([['invoice', 'not-yet', null], ['paid', 'not-yet', null]]);
    expect(steps([invoice('draft')])).toEqual([['invoice', 'waits', 'to-issue'], ['paid', 'not-yet', null]]);
    expect(withFakeOrderSteps(order, [invoice('draft')]).waitsOnYou?.line).toBe('1 waits on you: the invoice.');
    expect(steps([invoice('issued')])).toEqual([['invoice', 'done', 'issued'], ['paid', 'not-yet', 'due']]);
    expect(steps([invoice('paid')])).toEqual([['invoice', 'done', 'issued'], ['paid', 'done', null]]);
    // Another order's invoice is not this one's.
    expect(steps([{ ...invoice('paid'), orderId: 'o-other' }])).toEqual([['invoice', 'not-yet', null], ['paid', 'not-yet', null]]);
  });

  it('answers each order with its stage steps and what waits on the owner', async () => {
    const engine = new FakeEngine();
    const orders = await engine.request('venture.order.list', {}) as OrderLite[];
    const boat = orders.find((order) => order.id === 'o-boat-14')!;
    expect(boat.stages?.map((stage) => [stage.label, stage.state])).toEqual([
      ['Agreed', 'done'], ['Price', 'waits'], ['Episode', 'waits'], ['Publish', 'always-asks'], ['Invoice', 'not-yet'], ['Paid', 'not-yet'],
    ]);
    expect(boat.waitsOnYou?.line).toBe('2 wait on you: the new price and the episode draft.');
    expect(boat.stages?.[3]?.line).toBe('Publish, always asks you');
    const episode12 = orders.find((order) => order.id === 'o-boat-12')!;
    expect(episode12.stages?.at(-1)).toMatchObject({ id: 'paid', state: 'not-yet', due: '2026-10-28' });
    expect(episode12.waitsOnYou).toBeNull();
  });

  it('shows the Delivered card on an accepted run only', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    const done = await engine.request('venture.runs.get', { runId: '27' }) as RunDetail;
    expect(done.delivered?.files.map((file) => [file.source, file.name])).toEqual([['table', 'September bank lines matched to invoices']]);
    // The engine's own words for the tool that made it (delivery/harness/tool-purpose.ts, books.reconcile).
    expect(done.delivered?.files[0]?.line).toBe('Matched the bank statement to the bills');
    expect(done.delivered?.changedLine).toBe("Changed during this run, not proven to be the agent's.");
    const active = await engine.request('venture.runs.get', { runId: '31' }) as RunDetail;
    expect(active.delivered).toBeUndefined();
  });

  it('gives its YouTube runs a poster of null, as the engine does with no still kept, and its other runs none', async () => {
    const engine = new FakeEngine();
    const lumen = (await engine.request('venture.runs.list', {}) as { runs: RunDetail[] }).runs.filter((run) => run.businessId === 'lumen');
    expect(lumen.length).toBeGreaterThan(0);
    for (const run of lumen) expect(run.poster, run.runId).toBeNull();
    expect((await engine.request('venture.runs.get', { runId: '31' }) as RunDetail).poster).toBeNull();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    expect('poster' in (await engine.request('venture.runs.get', { runId: '27' }) as RunDetail)).toBe(false);
  });

  it("answers venture.files.poster with the engine's refusals; the fake has no ffmpeg and makes no still", async () => {
    const engine = new FakeEngine();
    await expect(engine.request('venture.files.poster', { orderId: 'o-boat-14' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(engine.request('venture.files.poster', { orderId: 'o-missing' })).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    await expect(engine.request('venture.files.poster', { uploadId: 'u-1' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const hosted = new FakeEngine({ hosted: true });
    await expect(hosted.request('venture.files.poster', { orderId: 'o-boat-14' })).rejects.toMatchObject({ code: 'TIER_UNAVAILABLE' });
  });
});
