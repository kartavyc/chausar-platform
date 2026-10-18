// Chausar venture launcher, delivery package (P5): draft replies for real orders.
// A template outline needs no agent and works at any stage. An agent draft needs shadow or approve each; it shows the
// exact text first and is sent once, only after the owner approves it. Nothing here sends anything to a client.
// With files on the order, the agent loop runs: each model turn holds client data, so each one waits for the owner's
// approval of its exact text. Tools run on this computer between turns and send nothing anywhere. An agent may ask for
// heavy work by the owner's own Claude Code or Codex: the run then waits for the owner to approve the exact brief, and
// the tool starts only after that, on this computer.
import { check, newId, type Context, type State } from '../../contracts.ts';
import { copiedTokens, exactPayload, findRecord, identifier, listRecords, plainText, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { DELIVERY_REASONS, REQUIRED_SECTIONS } from '../contracts.ts';
import type {
  BlueprintRecord, CheckId, CheckResult, ClaimProof, DelegateFigure, DelegateRunRecord, DelegationRequest, Deliverable, DeliveryReason, DeliveryRunRecord,
  DeliveryRunView, HarnessState, ModelPreview, ModelTask, OrderRecord, PlaybookRecord, PriceReceiptRecord, RecordBase, SignalRecord, ToolEnvelope,
  VentureDeps, VentureRecord, VentureRecordKind, WorkReceiptRecord, WorkTableRecord,
} from '../contracts.ts';
import { firstFailedCheck, runChecks } from './checks.ts';
import { deliveryTask, draftAllowedTokens, orderRefs, renderDeliverable, TEMPLATE_OUTLINE_LINE, templateOutline, templateTotal, validateDraft, type AnyReceipt, type DraftRefs } from './deliverable.ts';
import {
  DELEGATE_LABELS, delegateAvailability, delegateOffer, delegatePorts, delegationEnvelopeResult, runDelegation, type DelegateAvailability,
} from './harness/delegate.ts';
import { dictionaryEntries, manifest, ownerDefinitions } from './harness/dictionary.ts';
import { buildToolEnv, fileList, madeSoFar, namer, orderUploads, uploadsById } from './harness/env.ts';
import type { FileLike } from './harness/files.ts';
import {
  actTask, answerHandoff, applyTurn, finishWrite, newHarnessState, openDelegation, playbookGrant, provenSentences, REPORT_SECTIONS, settleDelegation, skipActs,
  startDelegation, validateTurn, writeGuidance, writeTask, type AgentTurn, type LoopContext,
} from './harness/loop.ts';
import { HOSTED_NO_OWNER_CLI } from './harness/sandbox.ts';
import { ensurePlaybook, playbookLimits, verifyChecks } from './playbook.ts';
import { localDayAt } from '../local-day.ts';
import { acceptedBlueprint, errorCode, newestFirst, optionalFlag, readAs, todayIso, ventureReceipts } from './shared.ts';

export const STAGE_BLOCKED_REASON = 'Rehearse with your AI first, then move to shadow.';
export const PRACTICE_REASON = 'Practice drafts are not for clients. Move to approve each to use drafts.';
export const DONE_CLAIM_REASON = 'This draft claims work that was not done. Edit it or reject it.';
export const NO_QUICK_AI = 'No AI serves quick work, so the agent could not use its tools. The reply is written from the message alone.';
const MAX_EDITED_CHARS = 20000;
const MAX_ANSWER_CHARS = 2000;

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
  const refs = orderRefs(context.blueprint, context.order, context.receipt, today, localDayAt(context.order.at, context.venture.country));
  const offer = context.blueprint.offers.find(item => item.id === context.order.offerId);
  return { refs, offer: { name: offer?.name.value ?? 'Your service', description: offer?.description.value ?? 'The service in your plan.' } };
}

type DraftCheckExtras = { work?: readonly WorkReceiptRecord[]; proofs?: readonly ClaimProof[]; sections?: readonly string[]; answers?: readonly string[] };

function checkDraft(context: OrderContext, playbook: PlaybookRecord, deliverable: Deliverable, renderedText: string, extras: DraftCheckExtras = {}): CheckResult[] {
  return runChecks({
    checks: verifyChecks(playbook), deliverable, renderedText, serviceType: context.blueprint.serviceType,
    allowed: copiedTokens(context.order.request, context.venture.idea, ...(extras.answers ?? [])), receipts: [...context.receipts, ...(extras.work ?? [])], ventureId: context.venture.id,
    mocks: [], mockModes: {}, agentTurns: 1, turnLimit: 1, askedQuestions: deliverable.questionsForClient.length > 0,
    ...(extras.sections ? { sections: extras.sections } : {}), ...(extras.proofs ? { proofs: extras.proofs } : {}),
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
export async function deliveryRunHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunView> {
  const body = exactPayload(payload, ['orderId', 'useTemplate'], ['orderId']);
  const orderId = identifier(body.orderId, 'Order');
  const useTemplate = optionalFlag(body.useTemplate, 'useTemplate');
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const order = findRecord(state, 'venture-order', orderId);
  check(order && order.ventureId === venture.id, 'ORDER_NOT_FOUND', 'That order was not found.');
  // Decide before any preview, so a blocked request records nothing.
  const status = useTemplate ? null : deps.models.status(ctx);
  const template = useTemplate || status!.tiers.main.presetId === 'built-in-templates';
  if (!template) check(agentStage(venture.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  const playbook = await ensurePlaybook(deps, ctx);
  const fresh = readAs(deps, ctx, 'prepare');
  const context = orderContext(fresh.state, fresh.venture, orderId);
  const { refs, offer } = draftContext(context, todayIso(deps, context.venture));
  const uploads = orderUploads(fresh.state, fresh.venture.id, orderId);

  if (!template && uploads.length && playbookGrant(playbook).length) {
    let harness = newHarnessState(playbookGrant(playbook), playbookLimits(playbook), uploads.map(upload => upload.id));
    if (status!.tiers.fast.presetId === 'built-in-templates') harness = skipActs(harness, NO_QUICK_AI);
    const loop = loopContext(deps, ctx, fresh.state, context, playbook, offer, uploads, [], harness.phase === 'act' ? await delegateOffer(deps) : []);
    const preview = await deps.models.preview(ctx, nextTask(loop, context, refs, harness, [], uploads, []));
    check(preview, 'NO_MODEL_CONNECTED', 'Connect an AI first, or use built-in templates.');
    return ventureAction(deps, ctx, 'prepare', 'delivery.run', tx => {
      const stage = tx.venture!.launchStage;
      check(agentStage(stage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
      const run: DeliveryRunRecord = {
        ...baseRun(tx, context.order, playbook), status: 'waiting-for-you', servedBy: 'model', practice: stage === 'shadow', callId: preview.callId,
        preview, deliverable: null, renderedText: null, checks: [], harness, uploadIds: uploads.map(upload => upload.id),
      };
      tx.put(run);
      tx.emit('delivery-waiting', { runId: run.id, orderId: run.orderId, practice: run.practice });
      return runView(run, tx.venture!, Date.parse(tx.now));
    });
  }

  const preview: ModelPreview | null = template ? null : await deps.models.preview(ctx, deliveryTask({
    serviceType: context.blueprint.serviceType, offer, clientRequest: context.order.request, idea: context.venture.idea, refs,
    containsClientData: true, templateTotalRef: 'order.total', guidance: writeGuidance(playbook),
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
      return runView(run, tx.venture!, Date.parse(tx.now));
    });
  }

  return ventureAction(deps, ctx, 'prepare', 'delivery.run', tx => {
    const stage = tx.venture!.launchStage;
    check(agentStage(stage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
    const run: DeliveryRunRecord = {
      ...baseRun(tx, context.order, playbook), status: 'waiting-for-you', servedBy: 'model', practice: stage === 'shadow', callId: preview.callId,
      preview, deliverable: null, renderedText: null, checks: [],
    };
    tx.put(run);
    tx.emit('delivery-waiting', { runId: run.id, orderId: run.orderId, practice: run.practice });
    return runView(run, tx.venture!, Date.parse(tx.now));
  });
}

/**
 * answers: the owner's answers to earlier hand-offs; tokens copied from them may be repeated, like the request's.
 * delegate: the owner's command-line tools found and checked now; agent.delegate is offered only with one.
 */
function loopContext(deps: VentureDeps, ctx: Context, state: State, context: OrderContext, playbook: PlaybookRecord, offer: { name: string; description: string }, files: readonly FileLike[], answers: readonly string[], delegate: readonly DelegateAvailability[] = []): LoopContext {
  const entries = dictionaryEntries(state, context.venture, playbook.aliases ?? {}, ownerDefinitions(deps, ctx));
  return {
    serviceType: context.blueprint.serviceType, offer, clientRequest: context.order.request, playbook, dictionaryManifest: manifest(entries),
    files: fileList(files), containsClientData: true, allowed: copiedTokens(context.order.request, context.venture.idea, ...answers), host: deps.host,
    delegate: delegate.map(item => item.cli),
  };
}

function answersOf(harness: HarnessState): string[] {
  return harness.handoffs.flatMap(handoff => handoff.answer === null ? [] : [handoff.answer]);
}

/** The next model task for a run in the act or write phase. The write step's proven list comes from the stored proofs. */
function nextTask(loop: LoopContext, context: OrderContext, refs: DraftRefs, harness: HarnessState, receipts: readonly WorkReceiptRecord[], files: readonly FileLike[], tables: readonly WorkTableRecord[]): ModelTask<unknown> {
  if (harness.phase === 'act') return actTask(loop, harness);
  const answers = answersOf(harness);
  const proven = provenSentences(harness, receipts, namer({ files: [...files], tables: [...tables] }));
  return writeTask({
    ...loop, idea: context.venture.idea, allowed: copiedTokens(context.order.request, context.venture.idea, ...answers), priceRefs: refs,
    templateTotalRef: 'order.total', proven,
  }, harness, receipts);
}

function findRun(state: State, venture: VentureRecord, runId: string): DeliveryRunRecord {
  const run = findRecord(state, 'venture-delivery-run', runId);
  check(run && run.ventureId === venture.id, 'DELIVERY_NOT_FOUND', 'That draft reply was not found.');
  return run;
}

/** venture.delivery.approve: sends the exact previewed text once, then checks and stores the draft (or runs the turn). */
export async function deliveryApproveHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunView> {
  requireAppChannel(ctx, 'venture.delivery.approve');
  const body = exactPayload(payload, ['runId', 'digest'], ['runId', 'digest']);
  const runId = identifier(body.runId, 'Draft reply');
  check(typeof body.digest === 'string' && /^[a-f0-9]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the text you approved.');
  const approved = body.digest;
  // A read outside any transaction: model calls can't run inside one. runPreview claims the call before sending.
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = findRun(state, venture, runId);
  check(run.status === 'waiting-for-you' && run.callId, 'DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
  // The owner may have moved the stage down since the draft was made: nothing is sent unless an agent may draft now.
  check(agentStage(venture.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  const callId = run.callId;
  const context = orderContext(state, venture, run.orderId);
  const playbook = findRecord(state, 'venture-playbook', run.playbookId);
  check(playbook, 'PLAYBOOK_NOT_FOUND', 'The playbook for this draft was not found.');
  const { refs, offer } = draftContext(context, todayIso(deps, context.venture));
  if (run.harness) return approveHarnessTurn(deps, ctx, { state, run, harness: run.harness, context, playbook, refs, offer, callId, approved });
  const allowed = draftAllowedTokens(context.order.request, context.venture.idea);

  let deliverable: Deliverable;
  try {
    const outcome = await deps.models.runPreview(ctx, callId, approved, raw => validateDraft(raw, { serviceType: context.blueprint.serviceType, refs, allowed }));
    deliverable = outcome.value;
  } catch (error) {
    await markFailedWhenSpent(deps, ctx, run, callId, error);
    throw error;
  }
  const renderedText = renderDeliverable(deliverable, context.receipts, context.venture.country);
  const checks = checkDraft(context, playbook, deliverable, renderedText);
  try {
    return await ventureAction(deps, ctx, 'approve', 'delivery.approve', tx => {
      const current = tx.find('venture-delivery-run', runId);
      check(current && current.status === 'waiting-for-you' && current.callId === callId, 'DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
      // Checked again: the stage can move down while the call is out. At shadow the answer is a practice draft.
      const stage = tx.venture!.launchStage;
      check(agentStage(stage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
      const next: DeliveryRunRecord = {
        ...current, status: 'ready-for-review', practice: current.practice || stage === 'shadow', preview: null, deliverable, renderedText, checks,
      };
      tx.replace(next);
      recordCheckSignal(tx, runId, checks);
      tx.emit('delivery-ready', { runId, orderId: next.orderId, servedBy: 'model' });
      return runView(next, tx.venture!, Date.parse(tx.now));
    });
  } catch (error) {
    // The call is spent, so a draft that could not be stored can never be approved again.
    await markFailedWhenSpent(deps, ctx, run, callId, error);
    throw error;
  }
}

type HarnessApproval = {
  state: State; run: DeliveryRunRecord; harness: HarnessState; context: OrderContext; playbook: PlaybookRecord; refs: DraftRefs;
  offer: { name: string; description: string }; callId: string; approved: string;
};

/**
 * One approved turn of the agent loop. An act turn: the model answers, the tools run here, then the next turn (or the
 * write step) is previewed and waits for the owner. A hand-off waits for the owner's answer instead. The write turn:
 * the draft is rendered with its attachments, checked against what the tools proved, and stored for review.
 */
async function approveHarnessTurn(deps: VentureDeps, ctx: Context, a: HarnessApproval): Promise<DeliveryRunView> {
  const { run, harness, context, playbook, refs, callId } = a;
  const files = uploadsById(a.state, context.venture.id, harness.uploadIds);
  const made = madeSoFar(a.state, harness);
  const available = harness.phase === 'act' ? await delegateOffer(deps) : [];
  const loop = loopContext(deps, ctx, a.state, context, playbook, a.offer, files, answersOf(harness), available);
  const task = nextTask(loop, context, refs, harness, made.receipts, files, made.tables);
  let value: unknown, by: 'model' | 'template', costMicros: string;
  try {
    const outcome = await deps.models.runPreview(ctx, callId, a.approved, raw => harness.phase === 'act' ? validateTurn(raw, harness.limits) : task.validate(raw));
    value = outcome.value; by = outcome.by; costMicros = outcome.costMicros;
  } catch (error) {
    await markFailedWhenSpent(deps, ctx, run, callId, error);
    throw error;
  }

  try {
    if (harness.phase === 'act') {
      const env = buildToolEnv({ deps, ctx, state: a.state, venture: context.venture, playbook, runRef: { kind: 'delivery', runId: run.id }, files, tables: made.tables, receipts: made.receipts, allowed: loop.allowed, delegateOffer: available });
      const next = await applyTurn(env, harness, value as AgentTurn, { by, callId, costMicros });
      const newTables = env.tables.slice(made.tables.length), newReceipts = env.receipts.slice(made.receipts.length);
      // A hand-off waits for an answer and a heavy-work brief for the owner's decision: neither previews a turn yet.
      const pauses = next.phase === 'needs-answer' || next.phase === 'brief';
      const preview = pauses ? null : await deps.models.preview(ctx, nextTask(loop, context, refs, next, env.receipts, files, env.tables));
      check(pauses || preview, 'NO_MODEL_CONNECTED', 'Connect an AI first, or use built-in templates.');
      return await ventureAction(deps, ctx, 'approve', 'delivery.approve', tx => {
        const current = tx.find('venture-delivery-run', run.id);
        check(current && current.status === 'waiting-for-you' && current.callId === callId, 'DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
        const stage = tx.venture!.launchStage;
        check(agentStage(stage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
        for (const table of newTables) tx.put(table);
        for (const receipt of newReceipts) tx.put(receipt);
        const stored: DeliveryRunRecord = preview
          ? { ...current, status: 'waiting-for-you', callId: preview.callId, preview, harness: next, practice: current.practice || stage === 'shadow' }
          : { ...current, status: next.phase === 'brief' ? 'brief-waiting' : 'needs-answer', callId: null, preview: null, harness: next, practice: current.practice || stage === 'shadow' };
        tx.replace(stored);
        if (preview) tx.emit('delivery-waiting', { runId: stored.id, orderId: stored.orderId, practice: stored.practice });
        else if (next.phase === 'brief') tx.emit('delivery-brief-waiting', { runId: stored.id, orderId: stored.orderId });
        else tx.emit('delivery-needs-answer', { runId: stored.id, orderId: stored.orderId });
        return runView(stored, tx.venture!, Date.parse(tx.now));
      });
    }

    const deliverable = value as Deliverable;
    const done = finishWrite(harness, { by, callId, costMicros });
    const receipts: AnyReceipt[] = [...context.receipts, ...made.receipts];
    const renderedText = renderDeliverable(deliverable, receipts, context.venture.country);
    const answers = harness.handoffs.flatMap(handoff => handoff.answer === null ? [] : [handoff.answer]);
    const checks = checkDraft(context, playbook, deliverable, renderDeliverable(deliverable, receipts, context.venture.country, { attachments: false }), {
      work: made.receipts, proofs: harness.proofs, sections: harness.sections === 'report' ? REPORT_SECTIONS : REQUIRED_SECTIONS[context.blueprint.serviceType], answers,
    });
    return await ventureAction(deps, ctx, 'approve', 'delivery.approve', tx => {
      const current = tx.find('venture-delivery-run', run.id);
      check(current && current.status === 'waiting-for-you' && current.callId === callId, 'DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
      const stage = tx.venture!.launchStage;
      check(agentStage(stage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
      const next: DeliveryRunRecord = {
        ...current, status: 'ready-for-review', practice: current.practice || stage === 'shadow', preview: null, deliverable, renderedText, checks, harness: done,
      };
      tx.replace(next);
      recordCheckSignal(tx, run.id, checks);
      tx.emit('delivery-ready', { runId: run.id, orderId: next.orderId, servedBy: 'model' });
      return runView(next, tx.venture!, Date.parse(tx.now));
    });
  } catch (error) {
    await markFailedWhenSpent(deps, ctx, run, callId, error);
    throw error;
  }
}

/**
 * venture.delivery.answer { runId, answer } (app only): the owner answers the agent's hand-off question (their own
 * decision, or what the client said). The next turn is previewed and waits for approval like every other turn.
 */
export async function deliveryAnswerHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunView> {
  requireAppChannel(ctx, 'venture.delivery.answer');
  const body = exactPayload(payload, ['runId', 'answer'], ['runId', 'answer']);
  const runId = identifier(body.runId, 'Draft reply');
  const answer = plainText(body.answer, 'Answer', { min: 1, max: MAX_ANSWER_CHARS });
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = findRun(state, venture, runId);
  check(run.status === 'needs-answer' && run.harness?.phase === 'needs-answer', 'DELIVERY_NOT_ASKING', 'This draft reply is not waiting for an answer.');
  check(agentStage(venture.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  const context = orderContext(state, venture, run.orderId);
  const playbook = findRecord(state, 'venture-playbook', run.playbookId);
  check(playbook, 'PLAYBOOK_NOT_FOUND', 'The playbook for this draft was not found.');
  const { refs, offer } = draftContext(context, todayIso(deps, context.venture));
  const files = uploadsById(state, venture.id, run.harness.uploadIds);
  const made = madeSoFar(state, run.harness);
  const next = answerHandoff(run.harness, answer, 'owner');
  const available = next.phase === 'act' ? await delegateOffer(deps) : [];
  const preview = await deps.models.preview(ctx, nextTask(loopContext(deps, ctx, state, context, playbook, offer, files, answersOf(next), available), context, refs, next, made.receipts, files, made.tables));
  check(preview, 'NO_MODEL_CONNECTED', 'Connect an AI first, or use built-in templates.');
  return ventureAction(deps, ctx, 'approve', 'delivery.answer', tx => {
    const current = tx.find('venture-delivery-run', runId);
    // The same question this answer was read against: another answer and a new hand-off may have landed meanwhile.
    check(current && current.status === 'needs-answer' && current.harness?.turns.length === run.harness!.turns.length
      && current.harness?.handoffs.length === run.harness!.handoffs.length, 'DELIVERY_NOT_ASKING', 'This draft reply is not waiting for an answer.');
    const stage = tx.venture!.launchStage;
    check(agentStage(stage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
    const stored: DeliveryRunRecord = { ...current, status: 'waiting-for-you', callId: preview.callId, preview, harness: next, practice: current.practice || stage === 'shadow' };
    tx.replace(stored);
    tx.emit('delivery-waiting', { runId, orderId: stored.orderId, practice: stored.practice });
    return runView(stored, tx.venture!, Date.parse(tx.now));
  });
}

const NOT_BRIEFING = 'This draft reply is not waiting for a brief to be approved.';
/** A run that started and never came back (the app closed while the tool worked) can be declined once its time is up. */
const STALE_GRACE_MS = 120_000;
function staleDelegation(open: DelegationRequest, nowMs: number): boolean {
  return open.status === 'running' && open.startedAt !== null && Date.parse(open.startedAt) + open.limits.minutes * 60_000 + STALE_GRACE_MS < nowMs;
}

/**
 * venture.delivery.delegate { runId, digest, decision } (app only): the owner approves or declines the exact
 * heavy-work brief. Approve starts the owner's own tool here and now, in a fresh folder with copies of the order's
 * files; its files and log come back as untrusted data, figures it lists are worked out again by the calculator with
 * receipts, and the next turn is previewed like any other. Decline tells the agent and previews the next turn. Nothing
 * starts on the hosted server, below shadow, with sending off, or when the tool changed since the brief was written.
 */
export async function deliveryDelegateHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunView> {
  requireAppChannel(ctx, 'venture.delivery.delegate');
  const body = exactPayload(payload, ['runId', 'digest', 'decision'], ['runId', 'digest', 'decision']);
  const runId = identifier(body.runId, 'Draft reply');
  check(typeof body.digest === 'string' && /^[a-f0-9]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the brief you read.');
  check(body.decision === 'approve' || body.decision === 'decline', 'INVALID_VENTURE_REQUEST', 'Choose approve or decline.');
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', HOSTED_NO_OWNER_CLI);
  const decision = body.decision;
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = findRun(state, venture, runId);
  const open = run.harness ? openDelegation(run.harness) : null;
  const nowMs = deps.clock().getTime();
  check(run.status === 'brief-waiting' && open && (open.status === 'waiting' || (decision === 'decline' && staleDelegation(open, nowMs))), 'DELIVERY_NOT_BRIEFING', NOT_BRIEFING);
  check(agentStage(venture.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  check(body.digest === open.digest, 'APPROVAL_STALE', 'The brief changed since you read it. Read it again.');
  const harness = run.harness!;
  const context = orderContext(state, venture, run.orderId);
  const playbook = findRecord(state, 'venture-playbook', run.playbookId);
  check(playbook, 'PLAYBOOK_NOT_FOUND', 'The playbook for this draft was not found.');
  const { refs, offer } = draftContext(context, todayIso(deps, context.venture));
  const files = uploadsById(state, venture.id, harness.uploadIds);
  const made = madeSoFar(state, harness);
  const label = DELEGATE_LABELS[open.cli];

  const previewNext = async (next: HarnessState, receipts: readonly WorkReceiptRecord[]): Promise<ModelPreview> => {
    const available = next.phase === 'act' ? await delegateOffer(deps) : [];
    const preview = await deps.models.preview(ctx, nextTask(loopContext(deps, ctx, state, context, playbook, offer, files, answersOf(next), available), context, refs, next, receipts, files, made.tables));
    check(preview, 'NO_MODEL_CONNECTED', 'Connect an AI first, or use built-in templates.');
    return preview;
  };

  if (decision === 'decline') {
    const message = open.status === 'running'
      ? `${label} started but never reported back; Chausar may have closed while it worked. Nothing it made was kept.`
      : 'The owner declined this brief. Nothing was started.';
    const next = settleDelegation(harness, { status: 'declined', envelope: { ok: false, error: { code: 'DELEGATE_DECLINED', name: 'DelegateDeclined', message } }, outcome: 'cancelled', delegateRunId: null, receiptIds: [], proofs: [] });
    const preview = await previewNext(next, made.receipts);
    return ventureAction(deps, ctx, 'approve', 'delivery.delegate', tx => {
      const current = tx.find('venture-delivery-run', runId);
      const live = current?.harness ? openDelegation(current.harness) : null;
      check(current && current.status === 'brief-waiting' && live && live.digest === open.digest && live.status === open.status, 'DELIVERY_NOT_BRIEFING', NOT_BRIEFING);
      const stage = tx.venture!.launchStage;
      check(agentStage(stage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
      const stored: DeliveryRunRecord = { ...current, status: 'waiting-for-you', callId: preview.callId, preview, harness: next, practice: current.practice || stage === 'shadow' };
      tx.replace(stored);
      tx.emit('delivery-waiting', { runId, orderId: stored.orderId, practice: stored.practice });
      return runView(stored, tx.venture!, Date.parse(tx.now));
    });
  }

  // The owner's send setting rules this send too: the tool passes what it reads to its own provider.
  check(deps.models.status(ctx).sendPolicy !== 'nothing', 'SEND_DISABLED', 'Sending is off for this workspace, so the tool was not started. Change it on Trust & access.');
  const ports = delegatePorts(deps);
  const now = await delegateAvailability(ports, open.cli);
  check(ports && now.state !== 'needs-setup' && now.executable === open.executable && now.version === open.version, 'TIER_UNAVAILABLE',
    `${label} is gone or changed since the brief was written, so it was not started. Decline the brief and the agent can ask again.`);
  const delegateFiles = uploadsById(state, venture.id, open.uploadIds);
  // Claimed first, in its own write: a second approval finds the brief running and starts nothing.
  const claimed = await ventureAction(deps, ctx, 'approve', 'delivery.delegate', tx => {
    const current = tx.find('venture-delivery-run', runId);
    const live = current?.harness ? openDelegation(current.harness) : null;
    check(current && current.status === 'brief-waiting' && live && live.status === 'waiting' && live.digest === open.digest, 'DELIVERY_NOT_BRIEFING', NOT_BRIEFING);
    check(agentStage(tx.venture!.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
    const started = startDelegation(current.harness!, tx.now);
    tx.replace({ ...current, harness: started });
    return started;
  });
  const request = openDelegation(claimed)!;
  const result = await runDelegation(ports!, request, delegateFiles, { currency: venture.country.currency, dateOrder: venture.country.dateOrder, runRef: { kind: 'delivery', runId } });

  const at = deps.clock().toISOString();
  const base = <K extends VentureRecordKind>(kind: K, prefix: string): RecordBase<K> => ({ id: newId(prefix), kind, ventureId: venture.id, memberId: ctx.memberId, epoch: ctx.epoch, at });
  const receipts: WorkReceiptRecord[] = [];
  const figureRefs: (string | null)[] = [];
  const figures: DelegateFigure[] = result.figures.map(item => {
    if (!item.draft) { figureRefs.push(null); return item.figure; }
    const receipt: WorkReceiptRecord = { ...base('venture-work-receipt', 'work'), ...item.draft };
    receipts.push(receipt);
    figureRefs.push(`w${made.receipts.length + receipts.length}.total`);
    return { ...item.figure, receiptId: receipt.id };
  });
  const record: DelegateRunRecord = {
    ...base('venture-delegate-run', 'delegaterun'), runId, toolCallId: request.toolCallId, cli: request.cli, executable: request.executable, version: request.version,
    approvedDigest: request.digest, limits: request.limits, outcome: result.outcome, exitCode: result.exitCode, reason: result.reason, outputs: result.outputs,
    log: result.log, reportedCost: result.reportedCost, figures, uncheckedNumbers: result.uncheckedNumbers, untrusted: true,
  };
  const details = delegationEnvelopeResult(result, figureRefs, request.cli);
  const envelope: ToolEnvelope = result.outcome === 'succeeded' ? { ok: true, result: details }
    : { ok: false, error: { code: result.outcome === 'timedOut' ? 'TOOL_TIMEOUT' : 'DELEGATE_FAILED', name: result.outcome === 'timedOut' ? 'ToolTimeout' : 'DelegateFailed', message: result.reason, details } };
  // Only a finished run proves the tool worked, and that proves no claim on its own; receipts prove their totals.
  const proofs: ClaimProof[] = result.outcome === 'succeeded'
    ? [{ kind: 'delegated', toolCallId: request.toolCallId, receiptId: null, tableId: null }, ...receipts.map(receipt => ({ kind: 'totals' as const, toolCallId: request.toolCallId, receiptId: receipt.id, tableId: null }))]
    : [];
  const next = settleDelegation(claimed, { status: 'finished', envelope, outcome: result.outcome, delegateRunId: record.id, receiptIds: receipts.map(receipt => receipt.id), proofs });

  let preview: ModelPreview | null = null;
  let previewError: unknown = null;
  try { preview = await previewNext(next, [...made.receipts, ...receipts]); } catch (error) { previewError = error; }
  // What the tool made is stored even when the next turn can't be previewed: the owner's plan paid for it.
  const { view, blocked } = await ventureAction(deps, ctx, 'approve', 'delivery.delegate', tx => {
    const current = tx.find('venture-delivery-run', runId);
    check(current && current.status === 'brief-waiting', 'DELIVERY_NOT_BRIEFING', NOT_BRIEFING);
    for (const receipt of receipts) tx.put(receipt);
    tx.put(record);
    tx.emit('delegate-finished', { runId, delegateRunId: record.id, cli: record.cli, outcome: record.outcome });
    const stage = tx.venture!.launchStage;
    const going = preview !== null && agentStage(stage);
    const stored: DeliveryRunRecord = going
      ? { ...current, status: 'waiting-for-you', callId: preview!.callId, preview, harness: next, practice: current.practice || stage === 'shadow' }
      : { ...current, status: 'failed', callId: null, preview: null, harness: next };
    tx.replace(stored);
    if (going) tx.emit('delivery-waiting', { runId, orderId: stored.orderId, practice: stored.practice });
    return { view: runView(stored, tx.venture!, Date.parse(tx.now)), blocked: !agentStage(stage) };
  });
  if (previewError) throw previewError;
  check(!blocked, 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  return view;
}

/** The stages at which an agent may draft for a real order. Moving down is always allowed, so each step checks again. */
function agentStage(stage: VentureRecord['launchStage']): boolean {
  return stage === 'shadow' || stage === 'approve-each';
}

/**
 * When an approval shows that a waiting draft can never be approved, the draft is marked failed so it stops looking
 * approvable, and the owner drafts again. That is the case when the approved call was claimed and then failed (the
 * model's answer was refused, the provider failed, or the draft could not be stored), and when a stale approval comes
 * after the preview's time is up or the call is no longer a preview. A refusal while the preview is live (a wrong
 * digest, the send setting, the budget, the phone) leaves it waiting.
 */
async function markFailedWhenSpent(deps: VentureDeps, ctx: Context, run: DeliveryRunRecord, callId: string, error: unknown) {
  const code = errorCode(error);
  if (code === 'APP_APPROVAL_REQUIRED') return;
  // Looked up by id only: the contract's ModelCallRecord type narrows to never (see docs/venture/delivery.md).
  const call: { status?: unknown } | undefined = deps.store.read().conversations.find((record: { id?: unknown } | null) => record?.id === callId);
  if (code === 'APPROVAL_STALE') {
    const live = run.preview !== null && Date.parse(run.preview.expiresAt) > deps.clock().getTime() && call?.status === 'preview';
    if (live) return;
  } else if (!call || call.status === 'preview') {
    return;
  }
  const runId = run.id;
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
export async function deliveryReviewHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunView> {
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
    // An agent draft is a practice draft unless the business is at approve each now: moving down is the owner's
    // safety lever, so a draft approved earlier can't be accepted, and an edit made now can't be copied.
    const practice = run.practice || (run.servedBy === 'model' && tx.venture!.launchStage !== 'approve-each');
    check(!(practice && verdict === 'accepted'), 'PRACTICE_DRAFT', PRACTICE_REASON);
    if (verdict === 'accepted') acceptableAsIs(run.checks);
    const next: DeliveryRunRecord = { ...run, status: verdict, practice, verdict: { choice: verdict, reason, at: tx.now }, editedText };
    tx.replace(next);
    if (verdict !== 'accepted') {
      const signal: SignalRecord = { ...tx.base('venture-signal'), source: verdict === 'edited' ? 'owner-edited' : 'owner-rejected', runId, reason, scenarioId: null };
      tx.put(signal);
      tx.emit('signal-recorded', { signalId: signal.id, runId, source: signal.source, reason });
    }
    tx.emit('delivery-reviewed', { runId, verdict, practice });
    return runView(next, tx.venture!, Date.parse(tx.now));
  });
}

/**
 * Why a draft can't be accepted as it stands, or null when every check passed. The owner edits or rejects it. A draft
 * that claims work no tool run proves gets its own words.
 */
function failedCheckReason(checks: readonly CheckResult[]): string | null {
  const failed = checks.filter(result => !result.passed);
  if (!failed.length) return null;
  if (failed.some(result => result.check === 'no-done-claims')) return DONE_CLAIM_REASON;
  return `This draft failed a check: ${failed[0].detail} Edit it or reject it.`;
}

function acceptableAsIs(checks: readonly CheckResult[]) {
  const reason = failedCheckReason(checks);
  check(reason === null, 'INVALID_VENTURE_REQUEST', reason ?? '');
}

/**
 * A run as the screens read it, with what the engine would allow right now. The same rules as the handlers:
 * a ready agent draft is practice unless the business is at approve each (review refuses Accept otherwise), a draft
 * with a failed check can't be accepted, and a waiting draft is sent only at shadow or approve each while its preview
 * is live. Practice drafts wait for the owner only at shadow, the one stage that makes them; once the stage moves on
 * they drop off Today's list, though they stay in the list for review. A run asking a question waits for the owner's
 * answer while an agent may draft.
 */
export function runView(run: DeliveryRunRecord, venture: VentureRecord, nowMs: number): DeliveryRunView {
  const stage = venture.launchStage;
  const ready = run.status === 'ready-for-review';
  const waiting = run.status === 'waiting-for-you';
  const asking = run.status === 'needs-answer';
  // A brief waits for the owner while no tool runs it, or once a run that never came back is past its time.
  const brief = run.status === 'brief-waiting';
  const open = brief && run.harness ? openDelegation(run.harness) : null;
  const briefWaits = !!open && (open.status === 'waiting' || staleDelegation(open, nowMs));
  const practiceNow = ready ? run.practice || (run.servedBy === 'model' && stage !== 'approve-each')
    : waiting || asking || brief ? run.practice || stage !== 'approve-each'
      : run.practice;
  const canApprove = waiting && run.callId !== null && agentStage(stage) && run.preview !== null && Date.parse(run.preview.expiresAt) > nowMs;
  const blocked = ready ? (practiceNow ? PRACTICE_REASON : failedCheckReason(run.checks)) : null;
  const canAccept = ready && blocked === null;
  const awaitingYou = waiting ? canApprove : asking ? agentStage(stage) : brief ? briefWaits && agentStage(stage) : ready ? !practiceNow || stage === 'shadow' : false;
  return { ...run, practiceNow, awaitingYou, canApprove, canAccept, acceptBlocked: blocked };
}

/** venture.delivery.list: every run, newest first, each with what the engine would allow now (see runView). */
export async function deliveryListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunView[]> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  const nowMs = deps.clock().getTime();
  return newestFirst(listRecords(state, 'venture-delivery-run', venture.id)).map(run => runView(run, venture, nowMs));
}

