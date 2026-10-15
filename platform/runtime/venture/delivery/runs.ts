// Chausar venture launcher, delivery package (P5): draft replies for real orders.
// A template outline needs no agent and works at any stage. An agent draft needs shadow or approve each; it shows the
// exact text first and is sent once, only after the owner approves it. Nothing here sends anything to a client.
import { check, type Context, type State } from '../../contracts.ts';
import { exactPayload, findRecord, identifier, listRecords, plainText, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { DELIVERY_REASONS } from '../contracts.ts';
import type {
  BlueprintRecord, CheckId, CheckResult, Deliverable, DeliveryReason, DeliveryRunRecord, ModelPreview, OrderRecord, PlaybookRecord,
  PriceReceiptRecord, SignalRecord, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { firstFailedCheck, runChecks } from './checks.ts';
import { deliveryTask, draftAllowedTokens, orderRefs, renderDeliverable, TEMPLATE_OUTLINE_LINE, templateOutline, templateTotal, validateDraft, type DraftRefs } from './deliverable.ts';
import { ensurePlaybook, verifyChecks } from './playbook.ts';
import { acceptedBlueprint, errorCode, newestFirst, optionalFlag, readAs, todayIso, ventureReceipts } from './shared.ts';

export const STAGE_BLOCKED_REASON = 'Rehearse with your AI first, then move to shadow.';
export const PRACTICE_REASON = 'Practice drafts are not for clients. Move to approve each to use drafts.';
const MAX_EDITED_CHARS = 20000;

type OrderContext = { venture: VentureRecord; blueprint: BlueprintRecord; order: OrderRecord; receipt: PriceReceiptRecord; receipts: PriceReceiptRecord[] };

function orderContext(state: State, venture: VentureRecord, orderId: string): OrderContext {
  const order = findRecord(state, 'venture-order', orderId);
  check(order && order.ventureId === venture.id, 'ORDER_NOT_FOUND', 'That order was not found.');
  const blueprint = acceptedBlueprint(state, venture);
  const receipt = findRecord(state, 'venture-price-receipt', order.priceReceiptId);
  check(receipt && receipt.ventureId === venture.id, 'RECEIPT_NOT_FOUND', 'The price receipt for this order was not found.');
  return { venture, blueprint, order, receipt, receipts: ventureReceipts(state, venture.id) };
}

function draftContext(context: OrderContext, today: string): { refs: DraftRefs; offer: { name: string; description: string } } {
  const refs = orderRefs(context.blueprint, context.order, context.receipt, today);
  const offer = context.blueprint.offers.find(item => item.id === context.order.offerId);
  return { refs, offer: { name: offer?.name.value ?? 'Your service', description: offer?.description.value ?? 'The service in your plan.' } };
}

function checkDraft(context: OrderContext, playbook: PlaybookRecord, deliverable: Deliverable, renderedText: string): CheckResult[] {
  return runChecks({
    checks: verifyChecks(playbook), deliverable, renderedText, serviceType: context.blueprint.serviceType,
    allowed: draftAllowedTokens(context.order.request, context.venture.idea), receipts: context.receipts, ventureId: context.venture.id,
    mocks: [], mockModes: {}, agentTurns: 1, turnLimit: 1, askedQuestions: deliverable.questionsForClient.length > 0,
  });
}

function recordCheckSignal(tx: VentureTx, runId: string, checks: readonly CheckResult[]) {
  const failed: CheckId | null = firstFailedCheck(checks);
  if (!failed) return;
  const signal: SignalRecord = { ...tx.base('venture-signal'), source: 'check-failed', runId, reason: failed, scenarioId: null };
  tx.put(signal);
  tx.emit('signal-recorded', { signalId: signal.id, runId, source: signal.source, reason: failed });
}

function baseRun(tx: VentureTx, order: OrderRecord, playbook: PlaybookRecord): Omit<DeliveryRunRecord, 'status' | 'servedBy' | 'practice' | 'callId' | 'preview' | 'deliverable' | 'renderedText' | 'checks'> {
  return { ...tx.base('venture-delivery-run'), orderId: order.id, playbookId: playbook.id, playbookHash: playbook.hash, verdict: null, editedText: null };
}

/** venture.delivery.run: a template outline at any stage, or an agent draft waiting for the owner to approve the send. */
export async function deliveryRunHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunRecord> {
  const body = exactPayload(payload, ['orderId', 'useTemplate'], ['orderId']);
  const orderId = identifier(body.orderId, 'Order');
  const useTemplate = optionalFlag(body.useTemplate, 'useTemplate');
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const order = findRecord(state, 'venture-order', orderId);
  check(order && order.ventureId === venture.id, 'ORDER_NOT_FOUND', 'That order was not found.');
  // Decide before any preview, so a blocked request records nothing.
  const template = useTemplate || deps.models.status(ctx).tiers.main.presetId === 'built-in-templates';
  if (!template) check(venture.launchStage === 'shadow' || venture.launchStage === 'approve-each', 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  const playbook = await ensurePlaybook(deps, ctx);
  const fresh = readAs(deps, ctx, 'prepare');
  const context = orderContext(fresh.state, fresh.venture, orderId);
  const { refs, offer } = draftContext(context, todayIso(deps));

  const preview: ModelPreview | null = template ? null : await deps.models.preview(ctx, deliveryTask({
    serviceType: context.blueprint.serviceType, offer, clientRequest: context.order.request, idea: context.venture.idea, refs,
    containsClientData: true, templateTotalRef: 'order.total',
  }));

  if (!preview) {
    const deliverable = templateOutline(context.blueprint.serviceType, templateTotal(refs, 'order.total'));
    const renderedText = `${TEMPLATE_OUTLINE_LINE}\n\n${renderDeliverable(deliverable, context.receipts, context.venture.country)}`;
    const checks = checkDraft(context, playbook, deliverable, renderedText);
    return ventureAction(deps, ctx, 'prepare', 'delivery.run', tx => {
      const run: DeliveryRunRecord = {
        ...baseRun(tx, context.order, playbook), status: 'ready-for-review', servedBy: 'template', practice: false, callId: null, preview: null,
        deliverable, renderedText, checks,
      };
      tx.put(run);
      recordCheckSignal(tx, run.id, checks);
      tx.emit('delivery-ready', { runId: run.id, orderId: run.orderId, servedBy: 'template' });
      return run;
    });
  }

  return ventureAction(deps, ctx, 'prepare', 'delivery.run', tx => {
    const stage = tx.venture!.launchStage;
    check(stage === 'shadow' || stage === 'approve-each', 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
    const run: DeliveryRunRecord = {
      ...baseRun(tx, context.order, playbook), status: 'waiting-for-you', servedBy: 'model', practice: stage === 'shadow', callId: preview.callId,
      preview, deliverable: null, renderedText: null, checks: [],
    };
    tx.put(run);
    tx.emit('delivery-waiting', { runId: run.id, orderId: run.orderId, practice: run.practice });
    return run;
  });
}

function findRun(state: State, venture: VentureRecord, runId: string): DeliveryRunRecord {
  const run = findRecord(state, 'venture-delivery-run', runId);
  check(run && run.ventureId === venture.id, 'DELIVERY_NOT_FOUND', 'That draft reply was not found.');
  return run;
}

/** venture.delivery.approve: sends the exact previewed text once, then checks and stores the draft. */
export async function deliveryApproveHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunRecord> {
  requireAppChannel(ctx, 'venture.delivery.approve');
  const body = exactPayload(payload, ['runId', 'digest'], ['runId', 'digest']);
  const runId = identifier(body.runId, 'Draft reply');
  check(typeof body.digest === 'string' && /^[a-f0-9]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the text you approved.');
  const approved = body.digest;
  // A read outside any transaction: model calls can't run inside one. runPreview claims the call before sending.
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = findRun(state, venture, runId);
  check(run.status === 'waiting-for-you' && run.callId, 'DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
  const callId = run.callId;
  const context = orderContext(state, venture, run.orderId);
  const playbook = findRecord(state, 'venture-playbook', run.playbookId);
  check(playbook, 'PLAYBOOK_NOT_FOUND', 'The playbook for this draft was not found.');
  const { refs } = draftContext(context, todayIso(deps));
  const allowed = draftAllowedTokens(context.order.request, context.venture.idea);

  let deliverable: Deliverable;
  try {
    const outcome = await deps.models.runPreview(ctx, callId, approved, raw => validateDraft(raw, { serviceType: context.blueprint.serviceType, refs, allowed }));
    deliverable = outcome.value;
  } catch (error) {
    await markFailedWhenSpent(deps, ctx, runId, callId, error);
    throw error;
  }
  const renderedText = renderDeliverable(deliverable, context.receipts, context.venture.country);
  const checks = checkDraft(context, playbook, deliverable, renderedText);
  return ventureAction(deps, ctx, 'approve', 'delivery.approve', tx => {
    const current = tx.find('venture-delivery-run', runId);
    check(current && current.status === 'waiting-for-you' && current.callId === callId, 'DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
    const next: DeliveryRunRecord = { ...current, status: 'ready-for-review', preview: null, deliverable, renderedText, checks };
    tx.replace(next);
    recordCheckSignal(tx, runId, checks);
    tx.emit('delivery-ready', { runId, orderId: next.orderId, servedBy: 'model' });
    return next;
  });
}

/**
 * When the approved call was claimed and then failed (the model's answer was refused, or the provider failed), the
 * draft can never be approved again, so it is marked failed and the owner drafts again. A refusal before the claim
 * (a stale digest, the send setting, the budget) leaves it waiting.
 */
async function markFailedWhenSpent(deps: VentureDeps, ctx: Context, runId: string, callId: string, error: unknown) {
  if (errorCode(error) === 'APPROVAL_STALE' || errorCode(error) === 'APP_APPROVAL_REQUIRED') return;
  // Looked up by id only: the contract's ModelCallRecord type narrows to never (see docs/venture/delivery.md).
  const call: { status?: unknown } | undefined = deps.store.read().conversations.find((record: { id?: unknown } | null) => record?.id === callId);
  if (!call || call.status === 'preview') return;
  try {
    await ventureAction(deps, ctx, 'approve', 'delivery.failed', tx => {
      const current = tx.find('venture-delivery-run', runId);
      if (!current || current.status !== 'waiting-for-you' || current.callId !== callId) return;
      tx.replace({ ...current, status: 'failed', preview: null });
    });
  } catch {
    // The original error is what the owner needs to see.
  }
}

/** venture.delivery.review: accept, edit or reject a ready draft. Practice drafts are never accepted. */
export async function deliveryReviewHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunRecord> {
  requireAppChannel(ctx, 'venture.delivery.review');
  const body = exactPayload(payload, ['runId', 'verdict', 'reason', 'editedText'], ['runId', 'verdict']);
  const runId = identifier(body.runId, 'Draft reply');
  const verdict = body.verdict;
  check(verdict === 'accepted' || verdict === 'edited' || verdict === 'rejected', 'INVALID_VENTURE_REQUEST', 'Choose accept, edit or reject.');
  let reason: DeliveryReason | null = null;
  if (body.reason !== undefined) {
    check(typeof body.reason === 'string' && (DELIVERY_REASONS as readonly string[]).includes(body.reason), 'INVALID_VENTURE_REQUEST', 'Choose a reason from the list.');
    reason = body.reason as DeliveryReason;
  }
  let editedText: string | null = null;
  if (verdict === 'edited') editedText = plainText(body.editedText, 'Edited draft', { min: 1, max: MAX_EDITED_CHARS });
  else check(body.editedText === undefined, 'INVALID_VENTURE_REQUEST', 'Only an edit carries new text.');
  if (verdict === 'rejected') check(reason !== null, 'INVALID_VENTURE_REQUEST', 'Choose why you reject this draft.');
  if (verdict === 'accepted') check(reason === null, 'INVALID_VENTURE_REQUEST', 'An accepted draft needs no reason.');
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'delivery.review', tx => {
    const run = tx.find('venture-delivery-run', runId);
    check(run, 'DELIVERY_NOT_FOUND', 'That draft reply was not found.');
    check(run.status === 'ready-for-review', 'DELIVERY_NOT_READY', 'This draft reply is not ready for review.');
    check(!(run.practice && verdict === 'accepted'), 'PRACTICE_DRAFT', PRACTICE_REASON);
    const next: DeliveryRunRecord = { ...run, status: verdict, verdict: { choice: verdict, reason, at: tx.now }, editedText };
    tx.replace(next);
    if (verdict !== 'accepted') {
      const signal: SignalRecord = { ...tx.base('venture-signal'), source: verdict === 'edited' ? 'owner-edited' : 'owner-rejected', runId, reason, scenarioId: null };
      tx.put(signal);
      tx.emit('signal-recorded', { signalId: signal.id, runId, source: signal.source, reason });
    }
    tx.emit('delivery-reviewed', { runId, verdict, practice: run.practice });
    return next;
  });
}

export async function deliveryListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunRecord[]> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  return newestFirst(listRecords(state, 'venture-delivery-run', venture.id));
}
