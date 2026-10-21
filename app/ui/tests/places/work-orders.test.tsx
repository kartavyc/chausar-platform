import { describe, expect, it } from 'vitest';
import { orderView, previousFailure } from '../../src/places/work/orders';
import type { DeliveryLite, InvoiceLite, OrderLite, RunSummary } from '../../src/engine/types';

const order = (over: Partial<OrderLite> = {}): OrderLite => ({
  id: 'o1', at: '2026-10-20T09:00:00.000Z', clientId: 'c1', offerId: 'offer_1', quantity: '1', request: 'Books for October',
  status: 'open', priceReceiptId: 'R-1', deliveredOn: null, ...over,
});
const run = (status: DeliveryLite['status'], over: Partial<DeliveryLite> = {}): DeliveryLite => ({
  id: `d-${status}`, at: '2026-10-21T09:00:00.000Z', orderId: 'o1', status, practice: false, deliverable: null, verdict: null, ...over,
});
const invoice = (status: InvoiceLite['status'], over: Partial<InvoiceLite> = {}): InvoiceLite => ({
  id: `i-${status}`, at: '2026-10-21T10:00:00.000Z', orderId: 'o1', clientId: 'c1', number: status === 'draft' ? null : 'INV-0041', status,
  issueDate: null, dueDate: null, ...over,
});
const summary = (runId: string, state: RunSummary['state']): RunSummary => ({ runId, businessId: 'b', agent: 'Bookkeeper', purpose: 'Draft a reply', state, startedAt: '', elapsed: '1m' });

describe('an order in one plain state', () => {
  it('received: nothing has run yet, and it can start', () => {
    const view = orderView(order(), [], []);
    expect(view.state).toBe('received');
    expect(view.action).toBe('start');
  });

  it('working, or waiting on you, from the engine run state when there is one', () => {
    expect(orderView(order(), [run('brief-waiting')], [], [summary('d-brief-waiting', 'active')]).state).toBe('working');
    expect(orderView(order(), [run('brief-waiting')], [], [summary('d-brief-waiting', 'waiting')]).state).toBe('waiting');
    expect(orderView(order(), [run('needs-answer')], []).state).toBe('waiting');
    expect(orderView(order(), [run('waiting-for-you', { awaitingYou: false })], []).state).toBe('working');
    expect(orderView(order(), [run('brief-waiting')], []).state).toBe('working');
    expect(orderView(order(), [run('needs-answer')], []).action).toBeUndefined();
  });

  it('draft ready, approved, sent back and stopped follow the newest run', () => {
    expect(orderView(order(), [run('ready-for-review')], []).state).toBe('draft-ready');
    const approved = orderView(order(), [run('accepted')], []);
    expect(approved.state).toBe('approved');
    expect(approved.action).toBe('deliver');
    expect(orderView(order(), [run('edited')], []).state).toBe('approved');
    const back = orderView(order(), [run('rejected')], []);
    expect(back.state).toBe('returned');
    expect(back.action).toBe('run-again');
    const stopped = orderView(order(), [run('failed')], []);
    expect(stopped.state).toBe('stopped');
    expect(stopped.action).toBe('run-again');
  });

  it('only the newest run counts, and a later run on the same moment wins', () => {
    const older = run('failed', { id: 'd1', at: '2026-10-20T09:00:00.000Z' });
    const newer = run('ready-for-review', { id: 'd2', at: '2026-10-21T09:00:00.000Z' });
    expect(orderView(order(), [newer, older], []).state).toBe('draft-ready');
    expect(orderView(order(), [older, newer], []).run?.id).toBe('d2');
    const same = [run('failed', { id: 'a', at: 'x' }), run('accepted', { id: 'b', at: 'x' })];
    expect(orderView(order(), same, []).run?.id).toBe('b');
    expect(orderView(order(), [run('failed', { orderId: 'other' })], []).state).toBe('received');
  });

  it('a practice draft is never shown as one for the client', () => {
    expect(orderView(order(), [run('ready-for-review', { practice: true })], []).state).toBe('practice');
    const practice = orderView(order(), [run('accepted', { practice: true })], []);
    expect(practice.state).toBe('practice');
    expect(practice.action).toBeUndefined();
  });

  it('delivered, then invoiced, then paid, whatever the runs say', () => {
    const delivered = orderView(order({ status: 'delivered', deliveredOn: '2026-10-21' }), [run('accepted')], []);
    expect(delivered.state).toBe('delivered');
    expect(delivered.action).toBeUndefined();
    expect(delivered.draftInvoice).toBe(false);
    expect(orderView(order({ status: 'delivered', deliveredOn: '2026-10-21' }), [], [invoice('draft')]).draftInvoice).toBe(true);
    const invoiced = orderView(order({ status: 'invoiced' }), [run('accepted')], [invoice('issued')]);
    expect(invoiced.state).toBe('invoiced');
    expect(invoiced.invoice?.number).toBe('INV-0041');
    expect(invoiced.action).toBe('deliver');
    expect(orderView(order({ status: 'invoiced' }), [], []).state).toBe('invoiced');
    expect(orderView(order(), [], [invoice('part-paid')]).partPaid).toBe(true);
    expect(orderView(order({ status: 'delivered', deliveredOn: '2026-10-21' }), [], [invoice('paid')]).state).toBe('paid');
    expect(orderView(order(), [], [invoice('void')]).state).toBe('received');
  });

  it('cancelled overrides everything and offers nothing', () => {
    const view = orderView(order({ status: 'cancelled' }), [run('failed')], [invoice('issued')]);
    expect(view.state).toBe('cancelled');
    expect(view.action).toBeUndefined();
  });

  it('only an open order starts or runs again', () => {
    expect(orderView(order({ status: 'invoiced' }), [run('failed')], []).action).toBeUndefined();
  });
});

describe('a failed run', () => {
  it('says its real error, else the summary result, else nothing', () => {
    expect(previousFailure({ ...summary('r1', 'failed'), result: 'Stopped: no ffmpeg.' }, 'The renderer stopped: ffmpeg was not found.')).toBe('The renderer stopped: ffmpeg was not found.');
    expect(previousFailure({ ...summary('r1', 'failed'), result: 'Stopped: no ffmpeg.' }, undefined)).toBe('Stopped: no ffmpeg.');
    expect(previousFailure(summary('r1', 'failed'), undefined)).toBeUndefined();
  });
});
