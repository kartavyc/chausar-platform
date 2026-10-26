// Ink v2 wave 4, package 4J4 (M13, M14): every money figure says how it was made. A contract walk over the money views
// (overview, aging, flow, cash, margins) finds every figure and checks it carries one of four kinds (reported,
// calculated, assumption, estimate) with a source that fits it: a file and row, its receipt, the input taken as given,
// or the model. Totals say what they counted and what they left out. A paged read never takes a short page as the end
// and stops with PAGING_LOOP when a cursor comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgingView, FigureKind, FigureSource, FlowView, MarginsView, MoneyOverview, SumReceiptRecord } from '../runtime/venture/contracts.ts';
import { FIGURE_KINDS, readAllPages, sourceFits } from '../runtime/venture/money/figure-kinds.ts';
import { goalBusiness, invoice } from './venture-goals-helpers.ts';
import { bankCosts, foreignInvoice, foreignPayment, paidCall } from './venture-money-env.ts';
import { code } from './venture-views-env.ts';

/** Every object in a view that holds a money figure: a display beside a receiptId, or an overview line's value. */
function figuresIn(value: unknown, path = '$', found: { path: string; figure: Record<string, unknown> }[] = []) {
  if (Array.isArray(value)) value.forEach((item, index) => figuresIn(item, `${path}[${index}]`, found));
  else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (('display' in record || 'value' in record) && 'receiptId' in record) found.push({ path, figure: record });
    for (const [key, item] of Object.entries(record)) if (key !== 'source') figuresIn(item, `${path}.${key}`, found);
  }
  return found;
}

test('every money figure in the overview and the 4J4 views carries a kind and a source that fits it', async () => {
  const env = await goalBusiness();
  await bankCosts(env, ['2026-09-10,OFFICE RENT,-1500.00,Landlord,50000.00']);
  const sale = await invoice(env, '1', '2026-09-01');
  await env.money('venture.payment.record', { invoiceId: sale.invoice.id, amount: '1000.00', receivedOn: '2026-10-20', method: 'upi' });
  await invoice(env, '1', '2026-10-20');
  await paidCall(env);
  await env.money('venture.spend.policy.set', { inrPerUsd: '83.50' });
  const views: [string, unknown][] = [
    ['venture.money.overview', await env.money('venture.money.overview')],
    ['venture.money.aging', await env.money('venture.money.aging')],
    ['venture.money.flow', await env.money('venture.money.flow')],
    ['venture.money.cash', await env.money('venture.money.cash')],
    ['venture.money.margins', await env.money('venture.money.margins', { month: '2026-10' })],
  ];
  const kinds = new Set<string>();
  for (const [method, view] of views) {
    const figures = figuresIn(view);
    assert.ok(figures.length > 0, `${method} has figures`);
    for (const { path, figure } of figures) {
      assert.ok(FIGURE_KINDS.includes(figure.kind as FigureKind), `${method} ${path} has a kind`);
      assert.ok(figure.source && sourceFits(figure.kind as FigureKind, figure.source as FigureSource), `${method} ${path} has a source that fits ${String(figure.kind)}`);
      // Every figure's receipt is a real, current one. A total shows exactly what its receipt adds up to; a part of one
      // (an aging bucket, one invoice, one item due soon) is proved by the receipt that names it.
      const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: figure.receiptId });
      assert.equal(receipt.stale, false, `${method} ${path}`);
      const shown = String(figure.display ?? figure.value).replace(', includes estimates', '');
      if (figure.kind === 'calculated' && !/(buckets\[\d+\]\.amount|invoices\[\d+\]\.balance|nextWeeks\[\d+\]\.amount)$/.test(path)) {
        assert.equal(receipt.figures[0].display, shown, `${method} ${path}`);
      } else {
        const listed = receipt.addends.map(addend => addend.display.replace('-', ''));
        assert.ok(listed.includes(shown) || /buckets/.test(path), `${method} ${path}: ${shown} is named in its receipt`);
      }
      kinds.add(String(figure.kind));
    }
  }
  assert.deepEqual([...kinds].sort(), ['assumption', 'calculated', 'reported'], 'no model estimate among these figures');
});

test('totals say what they counted and what they left out, never a silent zero', async () => {
  const env = await goalBusiness();
  await invoice(env, '1', '2026-10-01');
  await paidCall(env);
  const overview = await env.money<MoneyOverview>('venture.money.overview');
  const owed = overview.lines.find(line => line.id === 'owed')!;
  assert.deepEqual([owed.kind, owed.source], ['calculated', { from: 'receipt', receiptId: owed.receiptId }]);
  assert.deepEqual(owed.basis, { filters: ['Open invoices in INR, tax included'], truncated: false, notCounted: null });
  const spent = overview.lines.find(line => line.id === 'spent')!;
  assert.deepEqual(spent.basis?.filters, ['Paid AI and tool calls this UTC month, in US dollars as providers bill']);
  assert.equal(spent.uses, undefined, 'no rupee rate, so nothing is taken as given');
  await env.money('venture.spend.policy.set', { inrPerUsd: '83.50' });
  const withRate = (await env.money<MoneyOverview>('venture.money.overview')).lines.find(line => line.id === 'spent')!;
  assert.deepEqual(withRate.uses, ['₹83.50 per $1 (your rate, set 23 Oct 2026)']);
});

test('a paged read goes on past a short page, stops at the end, and stops with PAGING_LOOP when a cursor comes back', async () => {
  const pages: Record<string, { items: number[]; next: string | null }> = { start: { items: [1, 2], next: 'b' }, b: { items: [3], next: 'c' }, c: { items: [], next: 'd' }, d: { items: [4], next: null } };
  const read = (cursor: string | null) => Promise.resolve(pages[cursor ?? 'start']);
  assert.deepEqual(await readAllPages(read), { items: [1, 2, 3, 4], truncated: false }, 'a short page and an empty one are not the end');
  const loop = { start: { items: [1], next: 'b' }, b: { items: [2], next: 'b' } } as Record<string, { items: number[]; next: string | null }>;
  await assert.rejects(readAllPages(cursor => Promise.resolve(loop[cursor ?? 'start'])), code('PAGING_LOOP'));
  const cycle = { start: { items: [1], next: 'b' }, b: { items: [2], next: 'c' }, c: { items: [3], next: 'b' } } as Record<string, { items: number[]; next: string | null }>;
  await assert.rejects(readAllPages(cursor => Promise.resolve(cycle[cursor ?? 'start'])), code('PAGING_LOOP'));
  const endless = (cursor: string | null) => Promise.resolve({ items: [Number(cursor ?? 0)], next: String(Number(cursor ?? 0) + 1) });
  assert.deepEqual(await readAllPages(endless, 3), { items: [0, 1, 2], truncated: true }, 'stopped short, and the total will say so');
});

test('money in another currency is left out of every total, and each total says how much it left out', async () => {
  const env = await goalBusiness();
  const sale = await invoice(env, '1', '2026-10-01');
  await env.money('venture.payment.record', { invoiceId: sale.invoice.id, amount: '1000.00', receivedOn: '2026-10-20', method: 'upi' });
  await foreignInvoice(env, sale.invoice, { issueDate: '2026-10-02' });
  await foreignPayment(env, '2026-10-21');
  const invoiceWords = '1 not counted: 1 open invoice in another currency, with no rate to INR';
  const overview = await env.money<MoneyOverview>('venture.money.overview');
  assert.deepEqual(overview.lines.map(line => line.basis?.notCounted?.line ?? null), [invoiceWords, '1 not counted: 1 payment in another currency, with no rate to INR', null]);
  assert.equal((await env.money<AgingView>('venture.money.aging')).total.basis?.notCounted?.line, invoiceWords);
  assert.equal((await env.money<MarginsView>('venture.money.margins', { month: '2026-10' })).basis.notCounted?.line, '1 not counted: 1 invoice in another currency, with no rate to INR');
  assert.equal((await env.money<FlowView>('venture.money.flow', { months: 1 })).basis.notCounted?.line, '1 not counted: 1 payment in another currency, with no rate to INR');
});
