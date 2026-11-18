import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import { BOOKS } from '../../src/engine/fixtures';
import type { BooksSummaryLite, ChiefThreadView, MoneyOverview, OrderLite, QueueRow, RunDetail, RunSummary } from '../../src/engine/types';

/*
 * Fix round 4, sample-data items 5 to 10: figures on the sample that disagreed. Each case was the fake's or its
 * fixtures', not the engine's: the engine keeps each business in its own vault and every read names the open business
 * (views/runs.ts allRuns, money/books.ts), so one business's runs or money cannot show under another.
 */
async function opened(folder: 'lumen' | 'ledgerline'): Promise<FakeEngine> {
  const engine = new FakeEngine();
  await engine.request('workspace.open', { folder });
  return engine;
}

describe('the sample keeps each business to itself (item 7)', () => {
  it('runs are listed and read for the open business only, as the engine reads them', async () => {
    const ledgerline = await opened('ledgerline');
    const runs = ((await ledgerline.request('venture.runs.list', { state: 'all' })) as { runs: RunSummary[] }).runs;
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((run) => run.businessId === 'ledgerline')).toBe(true);
    await expect(ledgerline.request('venture.runs.get', { runId: '31' })).rejects.toMatchObject({ code: 'RUN_NOT_FOUND', message: 'That job was not found.' });
    const own = (await ledgerline.request('venture.runs.get', { runId: '27' })) as RunDetail;
    expect(own.businessId).toBe('ledgerline');
  });

  it('Ledgerline\'s money is its own: none of Lumen Studio\'s figures or receipts', async () => {
    const lumen = (await (await opened('lumen')).request('venture.books.summary', {})) as BooksSummaryLite;
    const books = (await (await opened('ledgerline')).request('venture.books.summary', {})) as BooksSummaryLite;
    const lumenReceipts = new Set(lumen.figures.map((figure) => figure.receiptId).filter(Boolean));
    expect(books.figures.filter((figure) => figure.receiptId && lumenReceipts.has(figure.receiptId))).toEqual([]);
    expect(books.figures.find((figure) => figure.operation === 'received')?.display).toBe('₹0');
    const overview = (await (await opened('ledgerline')).request('venture.money.overview', {})) as MoneyOverview;
    const received = overview.lines.find((line) => line.id === 'received');
    expect(received?.receiptId === undefined || !lumenReceipts.has(received.receiptId)).toBe(true);
  });
});

describe('figures that disagreed now agree', () => {
  it('item 5: the sample chat about billing names the month its books count, never "this month"', async () => {
    const engine = await opened('lumen');
    const thread = (await engine.request('venture.chief.thread.list', { threadId: 'chiefthread-billed' })) as ChiefThreadView;
    const message = thread.messages.find((item) => item.from === 'chief')!;
    const answer = { text: message.parts.map((part) => ('text' in part ? part.text : 'display' in part ? part.display : '')).join(' ') };
    // The sample's books are October's, whatever month the clock is in.
    expect(BOOKS.lumen!.period.from).toBe('2026-10-01');
    expect(answer.text).toContain('In October you billed');
    expect(answer.text).not.toMatch(/this month/i);
  });

  it('item 6: the sponsor slot price card starts from the price the plan holds', async () => {
    const engine = await opened('lumen');
    const queue = (await engine.request('venture.queue.list', { scope: 'all' })) as { rows: QueueRow[] };
    const card = queue.rows.find((row) => row.id === 'q-price-sponsor')!;
    const plan = (await engine.request('venture.blueprint.get', {})) as { blueprint: { offers: { id: string; pricing: { unitPriceMinor: string | null } }[] } } | null;
    const slot = plan?.blueprint.offers.find((offer) => offer.id === 'offer_sponsor');
    expect(slot?.pricing.unitPriceMinor).toBe('1500000');
    expect(card.change?.before).toBe('₹15,000');
  });

  it('item 10: an order invoiced as INV-0041 has its Invoice step done and nothing waiting on the owner', async () => {
    const engine = await opened('ledgerline');
    const orders = (await engine.request('venture.order.list', {})) as OrderLite[];
    const mehta = orders.find((order) => order.id === 'o-mehta-sep')!;
    const invoice = mehta.stages?.find((stage) => stage.id === 'invoice');
    expect(invoice?.state).toBe('done');
    expect(invoice?.detail).toBe('INV-0041');
    expect(mehta.waitsOnYou ?? null).toBeNull();
  });
});
