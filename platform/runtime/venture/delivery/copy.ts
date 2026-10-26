// Chausar delivery (Ink v2 wave 4, package 4J2 review; catalogue O6): "Make a copy". A draft that went out (the owner
// accepted it or made it their own version) opens read-only; Make a copy starts a new owner draft on the same order
// with its text, the owner's edit when there is one, else the draft as it was. The copy is the owner's own words
// (servedBy 'owner'): no AI wrote it and none reads it, nothing is sent, and it waits for the owner's review on Today
// like any draft. The draft that went out never changes.
import { check, type Context } from '../../contracts.ts';
import { exactPayload, findRecord, identifier, ventureAction } from '../records.ts';
import type { DeliveryRunRecord, DeliveryRunView, VentureDeps } from '../contracts.ts';
import { recordDecision } from '../journal/decisions.ts';
import { readAs } from './shared.ts';
import { PRACTICE_REASON, runView } from './runs.ts';

export const COPY_NOT_SENT_LINE = 'Only a draft that went out can be copied. This one still waits for your review.';

/** venture.delivery.copy { runId } (prepare): a new owner draft on the same order with the sent draft's text. */
export async function deliveryCopyHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunView> {
  const body = exactPayload(payload, ['runId'], ['runId']);
  const runId = identifier(body.runId, 'Draft reply');
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'delivery.copy', tx => {
    const source = tx.find('venture-delivery-run', runId);
    check(source, 'DELIVERY_NOT_FOUND', 'That draft reply was not found.');
    check(source.status === 'accepted' || source.status === 'edited', 'COPY_NOT_SENT', COPY_NOT_SENT_LINE);
    check(!source.practice, 'PRACTICE_DRAFT', PRACTICE_REASON);
    const order = findRecord(tx.state, 'venture-order', source.orderId);
    check(order && order.ventureId === tx.venture!.id, 'ORDER_NOT_FOUND', 'That order was not found.');
    const text = source.editedText ?? source.renderedText ?? '';
    const copy: DeliveryRunRecord = {
      ...tx.base('venture-delivery-run'), orderId: source.orderId, playbookId: source.playbookId, playbookHash: source.playbookHash,
      status: 'ready-for-review', servedBy: 'owner', practice: false, callId: null, preview: null, deliverable: source.deliverable,
      renderedText: text, checks: [], verdict: null, editedText: text, copiedFrom: source.id,
    };
    tx.put(copy);
    recordDecision(tx, { subject: `run:${copy.id}`, action: 'copy', who: 'owner', ruleId: null, reason: 'You made a copy of a draft that went out, to work on.', rowId: null });
    tx.emit('run.started', { runId: copy.id });
    tx.emit('run.waiting', { runId: copy.id });
    return runView(copy, tx.venture!, Date.parse(tx.now), tx.state);
  });
}
