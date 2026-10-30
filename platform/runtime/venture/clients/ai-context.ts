import { authorize, check, type Context, type State } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { findRecord, requireVenture, stateView } from '../records.ts';
import { requireClientAiConsent } from './ai-consent.ts';
import type { ClientAiContextBinding } from './ai-consent-core.ts';
export type { ClientAiContextBinding } from './ai-consent-core.ts';

/** A retained desk AI request binds its client permission independently of exact request approval. */
export function bindClientAiContext(deps: VentureDeps, ctx: Context, orderId: string, expectedPreview?: { clientAi?: ClientAiContextBinding }) {
  const state = deps.store.read(), venture = requireVenture(state);
  const order = findRecord(state, 'venture-order', orderId);
  check(order && order.ventureId === venture.id, 'ORDER_NOT_FOUND', 'Choose an order from this business.');
  const expected = expectedPreview?.clientAi;
  if (expectedPreview) check(expected && expected.ventureId === venture.id && expected.orderId === orderId && expected.clientId === order.clientId,
    'CLIENT_AI_CONSENT_CHANGED', 'This client AI permission changed. Prepare a new request.');
  const consent = requireClientAiConsent(state, venture.id, order.clientId, expected);
  const binding: ClientAiContextBinding = Object.freeze({ ventureId: venture.id, orderId, clientId: order.clientId,
    consentId: consent.id, consentRevision: consent.revision });
  function assert(current: State = deps.store.read()): void {
    authorize(stateView(current, deps.store), ctx, 'prepare');
    const business = requireVenture(current), currentOrder = findRecord(current, 'venture-order', orderId);
    check(business.id === binding.ventureId && currentOrder?.ventureId === binding.ventureId && currentOrder.clientId === binding.clientId && currentOrder.status !== 'cancelled',
      'JOB_SOURCE_CHANGED', 'The client order changed before this AI request finished.');
    requireClientAiConsent(current, binding.ventureId, binding.clientId, binding);
  }
  assert(state);
  return { binding, assert };
}
