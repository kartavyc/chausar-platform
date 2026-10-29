import {careerRunSource,careerRunCurrent} from '../playbooks/job-search-desk/run-source.ts';
import {careerPackDeliverable} from '../playbooks/job-search-desk/pack.ts';
import {refuseYoutubeDraft,youtubeDispatchGuard} from '../playbooks/youtube/run-guard.ts';
import { caNamedTokens } from '../playbooks/ca-firm/draft-references.ts';
// Chausar venture launcher, delivery package (P5): draft replies for real orders.
// A template outline needs no agent and works at any stage. An agent draft needs shadow or approve each; it shows the
// exact text first and is sent once, only after the owner approves it. Nothing here sends anything to a client.
// With files on the order, the agent loop runs: each model turn holds client data, so each one waits for the owner's
// approval of its exact text. Tools run on this computer between turns and send nothing anywhere. An agent may ask for
// heavy work by the owner's own Claude Code or Codex: the run then waits for the owner to approve the exact brief, and
// the tool starts only after that, on this computer.
import {socialSlotContext,keepSocialPostPlan} from '../playbooks/social/slots-live.ts';
import { ChausarError, check, newId, type Context, type State } from '../../contracts.ts';
import { copiedTokens, exactPayload, findRecord, identifier, listRecords, plainText, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { DELIVERY_REASONS, REQUIRED_SECTIONS } from '../contracts.ts';
import { writtenByLine } from '../models/written-by.ts';
import type {
  BlueprintRecord, CheckId, CheckResult, ClaimProof, DelegateFigure, DelegateRunRecord, DelegationRequest, Deliverable, DeliveryReason, DeliveryRunRecord,
  DeliveryRunView, HarnessState, ModelPreview, ModelTask, OrderRecord, PlaybookCheckResult, PlaybookRecord, PriceReceiptRecord, RecordBase, SignalRecord, ToolEnvelope,
  VentureDeps, VentureRecord, VentureRecordKind, WorkReceiptRecord, WorkTableRecord,
  MicroString, ToolName,
} from '../contracts.ts';
import { preserveOtherPosts } from '../playbooks/social/ghostwriting.ts';
import { correctDraft, firstFailedCheck, knownNames, runChecks, withDraftChecks, type CheckInput } from './checks.ts';
import type { ReceiptCorrection } from './judge/claim-check.ts';
import { deliveryTask, draftAllowedTokens, orderRefs, renderDeliverable, TEMPLATE_OUTLINE_LINE, templateOutline, templateTotal, validateDraft, type AnyReceipt, type DraftRefs, type DraftTimes } from './deliverable.ts';
import {
  DELEGATE_CLAUDE_TERMS, DELEGATE_LABELS, delegateAvailability, delegateGateOpen, delegateOffer, delegatePorts, delegateSpend, delegateSpendOutcome,
  delegationEnvelopeResult, runDelegation, type DelegateAvailability, type DelegationResult, takeDelegateSlot,
} from './harness/delegate.ts';
import { budgetPressure, countedMicros, fixedEstimate, ownerRates, reserveSpend, resolveRate, settleSpendAction, spendRefused } from '../money/spend.ts';
import { dictionaryEntries, manifest, ownerDefinitions } from './harness/dictionary.ts';
import { buildToolEnv, fileList, madeSoFar, namer, orderUploads, uploadsById } from './harness/env.ts';
import type { FileLike } from './harness/files.ts';
import {
  actTask, addCapWindow, answerHandoff, applyTurn, capShortfall, finishWrite, newHarnessState, openDelegation, playbookGrant, provenSentences, REPORT_SECTIONS, reserveRunCall,
  settleDelegation, skipActs, startDelegation, validateTurn, writeGuidance, writeTask, type AgentTurn, type LoopContext,
} from './harness/loop.ts';
import { youtubeWorked } from './harness/tools-youtube.ts';
import { HOSTED_NO_OWNER_CLI } from './harness/sandbox.ts';
import { recheckRun, recheckSend } from './harness/recheck.ts';
import { storeRunEvidence } from './harness/tools-evidence.ts';
import { mediaAcceptBlock, recordHandedOverFiles, storeRunAssets } from '../playbooks/kit/assets.ts';
import { requireOrderPeopleConsent, todayOf } from '../playbooks/kit/voice-consent.ts';
import { brandKitPart, resolveKit } from '../playbooks/kit/brand-kit.ts';
import {pinSocialOrder,socialVoicePart,socialVoiceGuard} from '../playbooks/social/chain.ts';
import { ensurePlaybook, flagshipDraft, playbookLimits, verifyChecks } from './playbook.ts';
import { failedPlaybookCheck, runFlagshipChecks, voiceDraftCheck, withQuoteFixes, withVoiceCheck } from '../playbooks/draft-checks.ts';
import { voicePart, voiceRules } from '../agents/voice.ts';
import { personaInputs, personaPart, writingStyle } from '../agents/persona.ts';
import { refusalsOf } from '../playbooks/ca-firm/claims.ts';
import { caOfferFor, caSignoffBlock } from '../playbooks/ca-firm/signoff-gate.ts';
import { citationUseFor } from '../playbooks/ca-firm/citations.ts';
import { diffExplanations } from '../playbooks/ca-firm/signoff.ts';
import { localDayAt } from '../local-day.ts';
import { acceptedBlueprint, errorCode, newestFirst, optionalFlag, previewShownWhole, readAs, todayIso, ventureReceipts } from './shared.ts';
import { journalled } from '../journal/journal.ts';
import { spotCheckOnFinish } from '../policy/spot-check.ts';
import { screenSettingOf } from '../policy/untrusted-methods.ts';
import { freezeScope, refuseMissingCapability, refuseNewWork } from './run-guards.ts';
import { loadQuarantineCheck, refuseQuarantined } from './quarantine-gate.ts';
import { contractChecks, draftWords, refuseUnsignedContract, refuseUnsignedRun } from '../money/order-contracts.ts';
import { carryControls, gateWaits, stampOwnerWords, stoppedNow, STOPPED_BY_YOU } from './harness/controls.ts';
import { notesCarried, recallNotes, staleNotes } from '../agents/recall.ts';
import { knowledgeForTurn, SOURCES_CHANGED, sourcesCarried, staleSources, turnQuery } from '../agents/knowledge-recall.ts';
import { repairTurn } from './harness/repair.ts';
import { acceptManifest } from './file-manifest.ts';
import { chainOnAnswer, chainOnQuestion, chainOnReview, orderChain } from '../playbooks/kit/chain.ts';
import { requireConfirmedRules } from '../playbooks/kit/rules.ts';
import { recordDecision } from '../journal/decisions.ts';
import { unconfirmedActions } from './harness/hygiene.ts';
import { questionWindowMs, refuseExpiredQuestion, withQuestionExpiry } from './timed-questions.ts';
import { withRunLease } from './leases.ts';
import { withReport } from './report-back.ts';
import { playbookForOrder, playbookForRun, type RunPlaybook } from './workflow.ts';
import { guardedPlaybookChecks } from './trace-scan.ts';
import { landRevision, withRevision } from './revise.ts';

/** 4J1: what each review verdict says in the decision record. */
const REVIEW_DECISION_WORDS: Readonly<Record<'accepted' | 'edited' | 'rejected', string>> = Object.freeze({
  accepted: 'Draft accepted.', edited: 'You edited the draft into your own version.', rejected: 'Draft rejected.',
});

export const STAGE_BLOCKED_REASON = 'Rehearse with your AI first, then move to shadow.';
export const PRACTICE_REASON = 'Practice drafts are not for clients. Move to approve each to use drafts.';
export const DONE_CLAIM_REASON = 'This draft claims work that was not done. Edit it or reject it.';
export const NO_QUICK_AI = 'No AI serves quick work, so the agent could not use its tools. The reply is written from the message alone.';
/** The judge's line on a run the owner edited: the edit is the owner's own words, which the judge never reads. */
export const JUDGE_EDIT_LINE = "Your edit is your own words, so the judge does not read it. Any verdict here is on the agent's draft.";
export const JUDGE_READING = 'The judge is reading this draft. Accept it once its answer is in.';

/** How long a ready draft stays marked as due for the judge (judgePending) before Accept opens anyway. */
export const JUDGE_PENDING_MS = 10 * 60_000;

/**
 * True while the judge is due on this draft or reading it (judge-run.ts): marked due by the commit that made it ready
 * and not asked yet, or its automatic call out, with no line saying it stopped and its preview still live. Each holds
 * only for its own time, so a judge that never came back stops holding. Accept waits meanwhile, so a failing verdict
 * never lands on an accepted draft.
 */
export function judgeReading(run: Pick<DeliveryRunRecord, 'judge' | 'judgePending'>, nowMs: number): boolean {
  const judge = run.judge;
  if (!judge) return !!run.judgePending && Date.parse(run.judgePending.until) > nowMs;
  return judge.status === 'waiting' && judge.auto === true && !judge.line && !!judge.preview && Date.parse(judge.preview.expiresAt) > nowMs;
}
const MAX_EDITED_CHARS = 20000;
const MAX_ANSWER_CHARS = 2000;

/**
 * known: the names a draft may use without a source (the client, the business, its plan and offers, the country).
 * offerKey: the flagship playbook offer the order is (Offer.playbookOffer), or null.
 */
/** ownerWords: the owner's own words that may hold the business's links (the idea, the client's record, the offers), for the receipts check. */
type OrderContext = {
  venture: VentureRecord; blueprint: BlueprintRecord; order: OrderRecord; receipt: PriceReceiptRecord; receipts: PriceReceiptRecord[]; known: string[]; offerKey: string | null;
  ownerWords: string[];
};

function orderContext(state: State, venture: VentureRecord, orderId: string): OrderContext {
  const order = findRecord(state, 'venture-order', orderId);
  check(order && order.ventureId === venture.id, 'ORDER_NOT_FOUND', 'That order was not found.');
  const blueprint = acceptedBlueprint(state, venture);
  const receipt = findRecord(state, 'venture-price-receipt', order.priceReceiptId);
  check(receipt && receipt.ventureId === venture.id, 'RECEIPT_NOT_FOUND', 'The price receipt for this order was not found.');
  const client = findRecord(state, 'venture-client', order.clientId);
  const known = knownNames(client?.ventureId === venture.id ? client.name : null, venture.workingName, blueprint.name.value, venture.country.name, ...blueprint.offers.map(offer => offer.name.value));
  // A CA firm offer an older plan kept no playbook id for is read from its own words, so its checks still apply.
  const offerKey = blueprint.offers.find(offer => offer.id === order.offerId)?.playbookOffer ?? caOfferFor(state, venture, order.id)?.id ?? null;
  const ownerWords = [venture.idea, ...(client?.ventureId === venture.id ? [client.name, client.email ?? ''] : []), ...blueprint.offers.map(offer => offer.description.value)];
  return { venture, blueprint, order, receipt, receipts: ventureReceipts(state, venture.id), known, offerKey, ownerWords };
}

/**
 * A flagship playbook's own checks on a draft (playbooks/draft-checks.ts), after the harness checks; undefined for
 * the eight fixed steps. The finishing check reads a cut on this computer, so the hosted server never runs it. The CA
 * firm calculator's refusals among the run's tool calls go with them, so a refused working fails, do not retry. The
 * tables the run's tools made and its tool calls go too, for the checks that read them. An order whose signed contract
 * protects anything gets the contract's check last, on the eight fixed steps too (4J12).
 */
async function flagshipChecks(deps: VentureDeps, context: OrderContext, playbook: PlaybookRecord, deliverable: Deliverable, servedBy: 'model' | 'template', extras: { runId?: string; work?: readonly WorkReceiptRecord[]; tables?: readonly WorkTableRecord[]; files?: readonly FileLike[]; harness?: HarnessState } = {}): Promise<PlaybookCheckResult[] | undefined> {
  (await import('../playbooks/podcast-to-article/run-guard.ts')).refuseArticleDraft(deps.store.read(), context.venture, context.order, deps.clock().toISOString());
  refuseYoutubeDraft(deps.store.read(),context.venture,context.order,deps.clock().toISOString(),extras.harness?.toolCalls);
  // Ink v2 wave 4 (4J12, H24): a signed order contract's protected items, on every playbook's drafts, after its own.
  const contract = contractChecks(deps.store.read(), context.venture, context.order.id, { text: draftWords(deliverable), ...(extras.files ? { files: extras.files.map(file => ({ name: file.name, digest: file.digest })) } : {}) });
  // Ink v2 wave 4 (4J17, A8): the owner's voice, by code, on every playbook's drafts; it only ever adds a result.
  const voice = servedBy === 'template' ? null : voiceDraftCheck(deliverable, voiceRules(deps.store.read(), context.venture), playbook.flagship ?? null);
  if (!playbook.flagship) return withVoiceCheck(contract.length ? contract : undefined, voice);
  const checkInput = {
    ...(playbook.flagship==='job-search-desk'?{careerPack:careerRunSource(deps.store.read(),context.venture.id,context.order.id)}:{}),
    ...(playbook.flagship==='podcast-to-article'?{articleRecord:listRecords(deps.store.read(),'venture-article-ledger',context.venture.id).find(row=>row.orderId===context.order.id&&row.clientId===context.order.clientId)??null}:{}),
    ...(playbook.flagship==='newsletter-studio'?{newsletterIssue:listRecords(deps.store.read(),'venture-newsletter-issue',context.venture.id).filter(row=>row.orderId===context.order.id&&row.clientId===context.order.clientId).at(-1)??null}:{}),
    ...(playbook.flagship==='tender-desk'?{tenderRows:(await (await import('../playbooks/tender-desk/run-source.ts')).tenderRunSource(deps,context.venture.id,context.order.id,true)).rows}:{}),
    ...(playbook.flagship==='narration-studio'?{narrationRows:(await (await import('../playbooks/narration-studio/run-source.ts')).narrationRunSource(deps,context.venture.id,context.order.id,true)).rows}:{}),
    ...(playbook.flagship==='website-studio'?{siteProject:listRecords(deps.store.read(),'venture-site-requirement',context.venture.id).filter(row=>row.orderId===context.order.id&&row.clientId===context.order.clientId).at(-1)??null}:{}),
    flagship: playbook.flagship, offerKey: context.offerKey, stageId:flagshipDraft(playbook,context.offerKey,context.order.intake??null,context.order.chainStage??null)?.stepId, servedBy, deliverable, request: context.order.request, intake: context.order.intake ?? null,
    brandKit: resolveKit(deps.store.read(), context.venture, context.order.clientId),
    socialSlotContext: socialSlotContext(deps.store.read(), context.venture, context.order, deps.clock().toISOString(), extras.runId ?? null),
    files: extras.files ?? [], receipts: [...context.receipts, ...(extras.work ?? [])], known: context.known, mode: 'client' as const,
    today: todayIso(deps, context.venture), dateOrder: context.venture.country.dateOrder, ...(deps.host === 'hosted-web' ? { finishing: null } : {}),
    refusals: refusalsOf(extras.harness?.toolCalls ?? []),
    tables: extras.tables ?? [], toolCalls: extras.harness?.toolCalls ?? [],
    // The CA's explanations of portal differences, so one recorded while the run waited counts now (Ink v2 2A2).
    caExplanations: diffExplanations(deps.store.read(), context.venture.id),
    caHealthReviews: listRecords(deps.store.read(),'venture-ca-working',context.venture.id).filter(row=>row.mode==='health'),
    caCitationUse: citationUseFor(deps.store.read(), context.venture.id, 'client'),
  };
  // Ink v2 wave 4 (4J15, Q14): a check that changes what it checks is voided and what it changed is put back.
  const own = await guardedPlaybookChecks(playbook.flagship, { deliverable, files: checkInput.files, tables: checkInput.tables, toolCalls: checkInput.toolCalls }, () => runFlagshipChecks(checkInput)) as PlaybookCheckResult[];

  if (playbook.flagship === 'seo-visibility') {
    const verified = await (await import('../playbooks/seo-visibility/verify-article.ts')).verifySeoArticle(checkInput, deps.net);
    if (verified.length) return withVoiceCheck([...own.filter(row => !verified.some(check => check.check === row.check)), ...verified, ...contract], voice);
  }
  return withVoiceCheck([...own, ...contract], voice);
}

function draftContext(context: OrderContext, today: string): { refs: DraftRefs; offer: { name: string; description: string } } {
  const refs = orderRefs(context.blueprint, context.order, context.receipt, today, localDayAt(context.order.at, context.venture.country));
  const offer = context.blueprint.offers.find(item => item.id === context.order.offerId);
  return { refs, offer: { name: offer?.name.value ?? 'Your service', description: offer?.description.value ?? 'The service in your plan.' } };
}

type DraftCheckExtras = {
  work?: readonly WorkReceiptRecord[]; proofs?: readonly ClaimProof[]; sections?: readonly string[]; answers?: readonly string[];
  harness?: HarnessState | null; files?: readonly FileLike[]; corrections?: readonly ReceiptCorrection[];
  /** The run's own chapter time codes and their heading (youtubeWorked), which no-numeric-prose leaves out. */
  times?: DraftTimes | null;
};

/**
 * The verify step's checks on a real order's draft. The claim check reads the order's request, the owner's answers,
 * the client's files, the tool results and the receipts. The rules judge is never asked here: its call carries the
 * client's words, so it goes through the action journal after these checks pass (judge-run.ts), on its own under the
 * business's standing consent or when the owner sends it.
 */
function checkDraft(context: OrderContext, playbook: PlaybookRecord, deliverable: Deliverable, renderedText: string, extras: DraftCheckExtras = {}): CheckResult[] {
  return runChecks(draftCheckInput(context, playbook, deliverable, renderedText, extras));
}

/**
 * The calculator's figure in place of each number it refutes in the draft (delivery/checks.ts correctDraft), before
 * the draft is rendered and checked; the receipts check then lists each correction with its note. 4J16 (Q4): round 1
 * of the quote check first, a quote's time moved to where the order's transcript says it (withQuoteFixes).
 */
function correctOrderDraft(context: OrderContext, playbook: PlaybookRecord, deliverable: Deliverable, extras: DraftCheckExtras = {}): { deliverable: Deliverable; corrections: ReceiptCorrection[] } {
  const quoted = withQuoteFixes(deliverable, extras.files ?? [], playbook.flagship);
  return correctDraft(draftCheckInput(context, playbook, quoted, '', extras));
}

/**
 * The check input of a real order's draft. flagship sets the estimate rule (the CA firm forbids estimates of money)
 * and leaves prompt-leak to the playbook's own checks.
 */
function draftCheckInput(context: OrderContext, playbook: PlaybookRecord, deliverable: Deliverable, renderedText: string, extras: DraftCheckExtras): CheckInput {
  return {
    // A playbook stored before the receipts and prompt-leak checks never lists them; every draft runs them anyway.
    checks: withDraftChecks(verifyChecks(playbook)), deliverable, renderedText, serviceType: context.blueprint.serviceType, flagship: playbook.flagship ?? null,
    ...(extras.corrections?.length ? { corrections: extras.corrections } : {}),
    allowed: [...copiedTokens(context.order.request, context.venture.idea, ...(extras.answers ?? [])),...(playbook.flagship==='ca-firm'?caNamedTokens(extras.harness?.toolCalls??[],extras.files??[]):[])], receipts: [...context.receipts, ...(extras.work ?? [])], ventureId: context.venture.id,
    mocks: [], mockModes: {}, agentTurns: 1, turnLimit: 1, askedQuestions: deliverable.questionsForClient.length > 0,
    ...(extras.sections ? { sections: extras.sections } : {}), ...(extras.proofs ? { proofs: extras.proofs } : {}), ...(extras.times ? { times: extras.times } : {}),
    grounding: {
      clientRequest: context.order.request, answers: extras.answers ?? [], harness: extras.harness ?? null, files: extras.files ?? [],
      known: context.known, dateOrder: context.venture.country.dateOrder, ownerWords: context.ownerWords,
    },
  };
}

function recordCheckSignal(tx: VentureTx, runId: string, checks: readonly CheckResult[]) {
  const failed: CheckId | null = firstFailedCheck(checks);
  if (!failed) return;
  const signal: SignalRecord = { ...tx.base('venture-signal'), source: 'check-failed', runId, reason: failed, scenarioId: null };
  tx.put(signal);
  tx.emit('signal-recorded', { signalId: signal.id, runId, source: signal.source, reason: failed });
}

/**
 * A new run's common fields. Ink v2 wave 4 (4F1): checked again in the commit that stores it, no new run while paused
 * (or on its own while the owner is away), and its scope frozen from the tools it is granted and its spend cap.
 */
function baseRun(tx: VentureTx, order: OrderRecord, playbook: PlaybookRecord, grant: readonly ToolName[], capMicros: MicroString): Omit<DeliveryRunRecord, 'status' | 'servedBy' | 'practice' | 'callId' | 'preview' | 'deliverable' | 'renderedText' | 'checks'> {
  refuseNewWork(tx.state, tx.venture!, tx.ctx, tx.now);
  // Ink v2 wave 4 (4A1): and none while the team or one of its agents is quarantined (quarantine-gate.ts).
  refuseQuarantined(tx.state, tx.venture!, tx.now);
  // 4J12 (H24): and none on an order whose contract the owner has not signed (money/order-contracts.ts).
  refuseUnsignedContract(tx.state, tx.venture!, order);
  return {
    ...tx.base('venture-delivery-run'), orderId: order.id, playbookId: playbook.id, playbookHash: playbook.hash, verdict: null, editedText: null,
    ...((playbook as RunPlaybook).runWorkflow ? { workflow: (playbook as RunPlaybook).runWorkflow } : {}),
    ...(playbook.flagship==='job-search-desk'?{careerPackBinding:careerRunSource(tx.state,tx.venture!.id,order.id).sourceBinding}:{}),
    scope: freezeScope(tx.state, tx.venture!, grant, capMicros, tx.now),
    // Ink v2 wave 5 (5A1): the chain stage this run drafts, once a kit chain order is past its first (playbooks/kit/chain.ts).
    ...(order.chainStage ? { chainStage: order.chainStage } : {}),
  };
}

/** venture.delivery.run: a template outline at any stage, or an agent draft waiting for the owner to approve the send. */
export async function deliveryRunHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunView> {
  const body = exactPayload(payload, ['orderId', 'useTemplate'], ['orderId']);
  const orderId = identifier(body.orderId, 'Order');
  const useTemplate = optionalFlag(body.useTemplate, 'useTemplate');
  await pinSocialOrder(deps,ctx,orderId);
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const order = findRecord(state, 'venture-order', orderId);
  check(order && order.ventureId === venture.id, 'ORDER_NOT_FOUND', 'That order was not found.');
  // Ink v2 wave 4 (4F1): no new run while paused, or on its own while the owner is away (run-guards.ts).
  refuseNewWork(state, venture, ctx, deps.clock().toISOString());
  // Ink v2 wave 4 (4A1): a quarantined agent starts no work until the owner clears it on Team (quarantine-gate.ts).
  await loadQuarantineCheck();
  refuseQuarantined(state, venture, deps.clock().toISOString());
  // 4J12 (H24): an order whose contract waits for the owner's signature starts nothing, before any preview.
  refuseUnsignedContract(state, venture, order);
  (await import('../playbooks/support-desk/run-guard.ts')).refuseSupportDraft(state, venture, order);
  (await import('../playbooks/recruiting-desk/run-guard.ts')).refuseRecruitDraft(state, venture, order);
  (await import('../playbooks/podcast-to-article/run-guard.ts')).refuseArticleDraft(state, venture, order, deps.clock().toISOString());
  refuseYoutubeDraft(state,venture,order,deps.clock().toISOString());
  (await import('../playbooks/social/run-guard.ts')).refuseSocialDraft(state, venture, order, deps.clock().toISOString().slice(0,10));
  // 5A4 (P9): everyone the order names as seen or heard still has their consent, at every run (a chain's next stage too).
  requireOrderPeopleConsent(state, venture, order, todayOf(venture, deps.clock()));
  // Ink v2 wave 5 (5A3): a client order on a kit offer starts nothing, before any preview or spend, while a rule its
  // stages or the playbook's checks rest on waits for a CA or lawyer (RULE_UNCONFIRMED). The check-time gate stays as a backstop.
  const chain = orderChain(state, venture, order);
  if(chain?.definition.registration.id==='job-search-desk')careerRunSource(deps.store.read(),venture.id,order.id);
  if(chain?.definition.registration.id==='tender-desk')await (await import('../playbooks/tender-desk/run-source.ts')).tenderRunSource(deps,venture.id,order.id,true);
  if(chain?.definition.registration.id==='narration-studio')await (await import('../playbooks/narration-studio/run-source.ts')).narrationRunSource(deps,venture.id,order.id,true);
  if(chain?.definition.registration.id==='website-studio')check(order.intake?.fields?.private!==true,'PRIVATE_NEEDS_LOCAL','Private website source needs a qualified local model. Review it manually meanwhile.');
  if(chain?.definition.registration.id==='translation-studio')check(order.intake?.fields?.private===false,'PRIVATE_NEEDS_LOCAL','This private job needs a local model. Use the local review sheet meanwhile.');
    if(chain?.definition.registration.id==='newsletter-studio')check(order.intake?.fields?.private!==true,'PRIVATE_NEEDS_LOCAL','Private source notes need a qualified local model. Write the issue manually meanwhile.');
  if (chain) requireConfirmedRules(chain.definition.rules, [...chain.offer.stages, ...chain.definition.checkIds], 'client');
  // Decide before any preview, so a blocked request records nothing.
  const status = useTemplate ? null : deps.models.status(ctx);
  const template = chain?.definition.registration.id==='job-search-desk' || useTemplate || status!.tiers.main.presetId === 'built-in-templates';
  check(!template||!order.socialChain,'NOT_BUILT_YET','Social writing stages need an AI draft. Connect your AI and start this stage again.');
  if (!template) check(agentStage(venture.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  const basePlaybook = await ensurePlaybook(deps, ctx);
  // 4F1 (O21): an agent step that needs a connector only planned refuses the run; nothing is put in its place.
  await refuseMissingCapability(basePlaybook);
  const fresh = readAs(deps, ctx, 'prepare');
  const context = orderContext(fresh.state, fresh.venture, orderId);
  const playbook = playbookForOrder(deps, ctx, fresh.state, fresh.venture, basePlaybook, context.order, context.offerKey);
  if (chain) requireConfirmedRules(chain.definition.rules, [...playbook.steps.map(step => step.id), ...chain.definition.checkIds], 'client');
  if (playbook.flagship === 'seo-visibility' && ['content-retainer','local-seo'].includes(context.offerKey ?? '')) (await import('../playbooks/seo-visibility/article-budget.ts')).articleLimitMicros(context.order.intake?.fields?.articleLimitUsd);
  const { refs, offer } = draftContext(context, todayIso(deps, context.venture));
  const uploads = orderUploads(fresh.state, fresh.venture.id, orderId);
  const socialGuard=await socialVoiceGuard();
  const socialSnapshot=(state:State,venture:VentureRecord)=>JSON.stringify({order:findRecord(state,'venture-order',orderId),uploads:orderUploads(state,venture.id,orderId)});
  const socialBefore=context.order.socialChain?socialSnapshot(fresh.state,fresh.venture):null;
  const fenceSocialPreview=(tx:VentureTx)=>{if(socialBefore===null)return;check(socialBefore===socialSnapshot(tx.state,tx.venture!),'APPROVAL_STALE','The order or its sources changed. Start again and read the new preview.');socialGuard(tx.state,tx.venture!,tx.find('venture-order',orderId)!);};
  const socialReport = !template ? await (await import('../playbooks/social/report-run.ts')).prepareSocialReport(deps,ctx,fresh.state,fresh.venture,playbook,context.order,uploads) : null;
  const sellerReport = await (await import('../playbooks/online-seller/prepare-run.ts')).prepareSellerReport(deps,ctx,fresh.state,fresh.venture,playbook,context.order,context.offerKey,uploads);
  const codeReport = socialReport ?? sellerReport;
  const sellerBefore = sellerReport ? socialSnapshot(fresh.state,fresh.venture) : null;

  if (!template && (codeReport || uploads.length && playbookGrant(playbook).length)) {
    let harness = newHarnessState(playbookGrant(playbook), playbookLimits(playbook), uploads.map(upload => upload.id));
    if (codeReport) harness={...harness,phase:'write',codePrerequisites:[{tool:sellerReport?.tool??'social.report',result:codeReport.result}],workReceiptIds:codeReport.receipts.map(r=>r.id),proofs:codeReport.receipts.map(r=>({kind:'totals' as const,toolCallId:'code:'+r.id,receiptId:r.id,tableId:null}))};
    else if (status!.tiers.fast.presetId === 'built-in-templates') harness = skipActs(harness, NO_QUICK_AI);
    const loop = loopContext(deps, ctx, fresh.state, context, playbook, offer, uploads, [], harness.phase === 'act' ? await delegateOffer(deps) : []);
    const preview = await deps.models.preview(ctx, nextTask(loop, context, refs, harness, codeReport?.receipts??[], uploads, []));
    check(preview, 'NO_MODEL_CONNECTED', 'Connect an AI first, or use built-in templates.');
    return ventureAction(deps, ctx, 'prepare', 'delivery.run', tx => {
      fenceSocialPreview(tx);
      if(sellerBefore!==null)check(sellerBefore===socialSnapshot(tx.state,tx.venture!),'APPROVAL_STALE','The seller order or its source changed. Start again.');
      const stage = tx.venture!.launchStage;
      check(agentStage(stage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
      const run: DeliveryRunRecord = {
        ...baseRun(tx, context.order, playbook, harness.grant, harness.limits.maxCostMicros), status: 'waiting-for-you', servedBy: 'model', practice: stage === 'shadow', callId: preview.callId,
        preview, deliverable: null, renderedText: null, checks: [], harness, uploadIds: uploads.map(upload => upload.id),
        ...(codeReport?{id:codeReport.runId}:{}),
      };
      if(codeReport)for(const receipt of codeReport.receipts)tx.put(receipt);
      tx.put(run);
      tx.emit('run.started', { runId: run.id });
      tx.emit('delivery-waiting', { runId: run.id, orderId: run.orderId, practice: run.practice });
      tx.emit('run.waiting', { runId: run.id });
      return runView(run, tx.venture!, Date.parse(tx.now), tx.state);
    });
  }

  // A flagship playbook drafts with its own step for this offer: that step's headings and guidance, and this order's slots.
  const draft = flagshipDraft(playbook, context.offerKey, context.order.intake ?? null, context.order.chainStage ?? null);
  const preview: ModelPreview | null = template ? null : await deps.models.preview(ctx, deliveryTask({
    serviceType: context.blueprint.serviceType, offer, clientRequest: context.order.request, idea: context.venture.idea, refs,
    containsClientData: true, templateTotalRef: 'order.total', guidance: draft?.guidance ?? writeGuidance(playbook), ...(draft ? { sections: draft.sections } : {}),
    // 4J18: the sources that share words with the draft's work, as the writing turn's (agents/knowledge-recall.ts).
    knowledge: oneStepKnowledge(fresh.state, context, playbook, offer, draft),
    // 4J17: the writer's persona and the owner's voice, as the writing turn's.
    style: { ...writingStyle(fresh.state, context.venture, playbook), ...brandKitPart(fresh.state, context.venture, context.order.clientId), ...socialVoicePart(context.order) }, // 5A4: the client's kit
  }));

  if (!preview) {
    const career=playbook.flagship==='job-search-desk'?careerRunSource(deps.store.read(),venture.id,order.id):null;
    const deliverable = career?careerPackDeliverable(career.text):templateOutline(context.blueprint.serviceType, templateTotal(refs, 'order.total'));
    const renderedText = career?career.text:`${TEMPLATE_OUTLINE_LINE}\n\n${renderDeliverable(deliverable, context.receipts, context.venture.country)}`;
    const checks = checkDraft(context, playbook, deliverable, renderedText,career?{sections:['Approved evidence'],answers:[career.text]}:{});
    const playbookChecks = await flagshipChecks(deps, context, playbook, deliverable, 'template');
    return ventureAction(deps, ctx, 'prepare', 'delivery.run', tx => {
      fenceSocialPreview(tx);
      if(career)check(careerRunSource(tx.state,tx.venture!.id,order.id).sourceBinding===career.sourceBinding,'CAREER_SOURCE_CHANGED','The career pack changed during preparation.');
      const run: DeliveryRunRecord = {
        ...baseRun(tx, context.order, playbook, [], '0'), status: 'ready-for-review', servedBy: 'template', practice: false, callId: null, preview: null,
        deliverable, renderedText, checks, ...(playbookChecks ? { playbookChecks } : {}),
      };
      tx.put(run);
      tx.emit('run.started', { runId: run.id });
      recordCheckSignal(tx, run.id, checks);
      tx.emit('delivery-ready', { runId: run.id, orderId: run.orderId, servedBy: 'template' });
      tx.emit('run.waiting', { runId: run.id });
      return runView(run, tx.venture!, Date.parse(tx.now), tx.state);
    });
  }

  return ventureAction(deps, ctx, 'prepare', 'delivery.run', tx => {
      fenceSocialPreview(tx);
    const stage = tx.venture!.launchStage;
    check(agentStage(stage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
    const run: DeliveryRunRecord = {
      ...baseRun(tx, context.order, playbook, [], preview.estimatedMaxCostMicros), status: 'waiting-for-you', servedBy: 'model', practice: stage === 'shadow', callId: preview.callId,
      preview, deliverable: null, renderedText: null, checks: [],
    };
    tx.put(run);
    tx.emit('run.started', { runId: run.id });
    tx.emit('delivery-waiting', { runId: run.id, orderId: run.orderId, practice: run.practice });
    tx.emit('run.waiting', { runId: run.id });
    return runView(run, tx.venture!, Date.parse(tx.now), tx.state);
  });
}

/**
 * answers: the owner's answers to earlier hand-offs; tokens copied from them may be repeated, like the request's.
 * delegate: the owner's command-line tools found and checked now; agent.delegate is offered only with one.
 */
function loopContext(deps: VentureDeps, ctx: Context, state: State, context: OrderContext, playbook: PlaybookRecord, offer: { name: string; description: string }, files: readonly FileLike[], answers: readonly string[], delegate: readonly DelegateAvailability[] = []): LoopContext {
  const entries = (playbook as RunPlaybook).runWorkflow?.dictionary ?? dictionaryEntries(state, context.venture, playbook.aliases ?? {}, ownerDefinitions(deps, ctx));
  const draft = flagshipDraft(playbook, context.offerKey, context.order.intake ?? null, context.order.chainStage ?? null);
  return {
    serviceType: context.blueprint.serviceType, offer, clientRequest: context.order.request, playbook, dictionaryManifest: manifest(entries),
    files: fileList(files), containsClientData: true, allowed: copiedTokens(context.order.request, context.venture.idea, ...answers), host: deps.host,
    delegate: delegate.map(item => item.cli), draft,
    // 4B2: the agents' notes this order recalls, for the act turns (agents/recall.ts).
    notes: recallNotes(state, context.venture, playbook, context.order),
    // 4J18: the sources from what the AI knows that share words with each turn's own work, screened as read
    // (agents/knowledge-recall.ts): the act steps', and the writing step's with its drafting guidance.
    knowledge: knowledgeForTurn(state, context.venture, turnQuery('act', playbook.steps, context.order.request, offer.name)),
    writeKnowledge: knowledgeForTurn(state, context.venture, turnQuery('write', playbook.steps, context.order.request, offer.name, draft?.guidance ?? writeGuidance(playbook))),
    // 4F2 (M5): near the day's or the month's spend limit the act turn is told to report, not start new work.
    budget: budgetPressure(state, context.venture, deps.clock().toISOString()),
    // 4J11 (H29): this order's journalled actions that may still happen or may already have happened (harness/hygiene.ts).
    unconfirmed: unconfirmedActions(state, context.venture.id, context.order.id),
    // 4J17: the personas of the agents doing the act turns and the writer's (agents/persona.ts), and the owner's voice.
    personas: personaPart(personaInputs(state, context.venture, playbook, 'act')),
    writePersonas: personaPart(personaInputs(state, context.venture, playbook, 'write')),
    voice: voicePart(state, context.venture, playbook.flagship ?? null),
    // 5A4 (P7): the client's brand kit, for the writing turn.
    brandKit: {...brandKitPart(state, context.venture, context.order.clientId),...socialVoicePart(context.order)},
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
  // The hooks the scorer kept and the drafted chapters, as screened, go to the writer as given (tools-youtube.ts).
  return writeTask({
    ...loop, idea: context.venture.idea, allowed: copiedTokens(context.order.request, context.venture.idea, ...answers), priceRefs: refs,
    templateTotalRef: 'order.total', proven, worked: youtubeWorked(harness.toolCalls, tables),
  }, harness, receipts);
}

function findRun(state: State, venture: VentureRecord, runId: string): DeliveryRunRecord {
  const run = findRecord(state, 'venture-delivery-run', runId);
  check(run && run.ventureId === venture.id, 'DELIVERY_NOT_FOUND', 'That draft reply was not found.');
  return run;
}

/** venture.delivery.approve: sends the exact previewed text once, then checks and stores the draft (or runs the turn). */
export async function deliveryApproveHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunView> {
  return approveDelivery(deps, ctx, payload);
}

/**
 * The approval itself. judgeNoticeShown: the judge's notice exactly as the approving surface showed it, bound by that
 * surface's own digest (Today's row, views/queue.ts). Only then does approving the write turn give the judge's standing
 * consent; venture.delivery.approve binds the turn's text, not the notice, so it gives none.
 */
export async function approveDelivery(deps: VentureDeps, ctx: Context, payload: unknown, options: { judgeNoticeShown?: string | null } = {}): Promise<DeliveryRunView> {
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
  // Ink v2 wave 4 (4F1): nothing goes out while the business is paused (run-guards.ts).
  refuseNewWork(state, venture, ctx, deps.clock().toISOString());
  // Ink v2 wave 4 (4A1): nor while the team or one of its agents is quarantined (quarantine-gate.ts).
  await loadQuarantineCheck();
  refuseQuarantined(state, venture, deps.clock().toISOString());
  // 4J12 (H24): nor while the order's contract waits for the owner's signature (money/order-contracts.ts).
  refuseUnsignedRun(state, venture, run);
  const callId = run.callId;
  const context = orderContext(state, venture, run.orderId);
  (await import('../playbooks/support-desk/run-guard.ts')).refuseSupportDraft(state, venture, context.order);
  (await import('../playbooks/recruiting-desk/run-guard.ts')).refuseRecruitDraft(state, venture, context.order);
  (await import('../playbooks/podcast-to-article/run-guard.ts')).refuseArticleDraft(state, venture, context.order, deps.clock().toISOString());
  (await import('../playbooks/social/run-guard.ts')).refuseSocialDraft(state, venture, context.order, deps.clock().toISOString().slice(0,10));
  (await socialVoiceGuard())(deps.store.read(),venture,context.order);
  const playbook = playbookForRun(state, run);
  check(playbook, 'PLAYBOOK_NOT_FOUND', 'The playbook for this draft was not found.');
  if(playbook.flagship==='job-search-desk')careerRunSource(deps.store.read(),venture.id,run.orderId);
  if(playbook.flagship==='tender-desk')await (await import('../playbooks/tender-desk/run-source.ts')).tenderRunSource(deps,venture.id,run.orderId,true);
  if(playbook.flagship==='narration-studio')await (await import('../playbooks/narration-studio/run-source.ts')).narrationRunSource(deps,venture.id,run.orderId,true);
  const { refs, offer } = draftContext(context, todayIso(deps, context.venture));
  // The model port's own refusals, made first, so a stale or run-out approval never reaches the journal.
  if (run.preview) {
    check(run.preview.digest === approved, 'APPROVAL_STALE', 'This changed since you read it. Read it again.');
    if (Date.parse(run.preview.expiresAt) <= deps.clock().getTime()) {
      const stale = new ChausarError('APPROVAL_STALE', 'Run it again; the approved text is no longer available.');
      await markFailedWhenSpent(deps, ctx, run, callId, stale);
      throw stale;
    }
    // The run's own spend cap, held before the call: the call that would cross it is refused before it is sent.
    if (run.harness) reserveRunCall(run.harness, run.preview.estimatedMaxCostMicros);
  }
  // The write turn of a draft the judge will then read on its own: its approval says so, with what the judge's check
  // could cost (judge-run.ts judgeNotice). The commit that makes the draft ready keeps that bound and marks the judge
  // as due, so Accept waits until the judge was asked, and the judge goes on its own only within the bound shown.
  const judge = await import('./judge-run.ts').catch(() => null);
  const notice = judge?.judgeNotice(deps, ctx, state, venture, run) ?? null;
  const pending: DeliveryRunRecord['judgePending'] = notice
    ? { boundMicros: notice.boundMicros, bound: notice.cost, until: new Date(deps.clock().getTime() + JUDGE_PENDING_MS).toISOString() }
    : null;

  // 4F1: set once the AI answered, so the journal says the call went out even when its answer is not kept here.
  const went = { out: false };
  let notKept: unknown = null;
  const send = async (): Promise<DeliveryRunView> => {
    // The gate again, just before the send, on what the vault says now; a deny closes the journal entry with its reason.
    // A pause that came meanwhile (4F1) refuses it the same way: nothing was sent.
    refuseNewWork(deps.store.read(), venture, ctx, deps.clock().toISOString());
    // 4J12: a contract revision proposed meanwhile stops the send too, before anything goes.
    refuseUnsignedRun(deps.store.read(), venture, run);
    const latestSupport=deps.store.read();
    (await import('../playbooks/support-desk/run-guard.ts')).refuseSupportDraft(latestSupport, venture, orderContext(latestSupport, venture, run.orderId).order);
    (await import('../playbooks/recruiting-desk/run-guard.ts')).refuseRecruitDraft(latestSupport, venture, orderContext(latestSupport, venture, run.orderId).order);
    (await import('../playbooks/podcast-to-article/run-guard.ts')).refuseArticleDraft(latestSupport, venture, orderContext(latestSupport, venture, run.orderId).order, deps.clock().toISOString());
  (await import('../playbooks/social/run-guard.ts')).refuseSocialDraft(latestSupport, venture, orderContext(latestSupport, venture, run.orderId).order, deps.clock().toISOString().slice(0,10));
  (await socialVoiceGuard())(deps.store.read(),venture,orderContext(deps.store.read(),venture,run.orderId).order);
    recheckSend(deps, venture.id, runId, callId, approved);
    if(playbook.flagship==='job-search-desk')careerRunSource(deps.store.read(),venture.id,run.orderId);
    if(playbook.flagship==='tender-desk')await (await import('../playbooks/tender-desk/run-source.ts')).tenderRunSource(deps,venture.id,run.orderId,true);
    if(playbook.flagship==='narration-studio')await (await import('../playbooks/narration-studio/run-source.ts')).narrationRunSource(deps,venture.id,run.orderId,true);
    if (run.harness) return approveHarnessTurn(deps, ctx, { state, run, harness: run.harness, context, playbook, refs, offer, callId, approved, pending, answered: () => { went.out = true; } });
    const allowed = draftAllowedTokens(context.order.request, context.venture.idea);
    const draft = flagshipDraft(playbook, context.offerKey, context.order.intake ?? null, context.order.chainStage ?? null);
    // 4J18: a source this draft's text carries that was removed, changed or held since never goes; it is made again.
    await refuseStaleSources(deps, ctx, { run, callId, context, harness: null });
    const knowledge = sourcesCarried(state, venture, run.preview?.payloadText ?? '');
    const youtubeGuard=youtubeDispatchGuard(deps,venture,context.order);
    let deliverable: Deliverable;
    try {
      const outcome = await deps.models.runPreview(ctx, callId, approved, raw => validateDraft(raw, { serviceType: context.blueprint.serviceType, refs, allowed, ...(draft ? { sections: draft.sections } : {}) }),{beforeDispatch:()=>{youtubeGuard();}});
      went.out = true;
      deliverable = outcome.value;
    } catch (error) {
      await markFailedWhenSpent(deps, ctx, run, callId, error);
      throw error;
    }
    const corrected = correctOrderDraft(context, playbook, deliverable);
    deliverable = preserveOtherPosts(run,corrected.deliverable);
    const renderedText = renderDeliverable(deliverable, context.receipts, context.venture.country);
    const checks = checkDraft(context, playbook, deliverable, renderedText, { ...(draft ? { sections: draft.sections } : {}), corrections: corrected.corrections });
    const playbookChecks = await flagshipChecks(deps, context, playbook, deliverable, 'model', {runId:run.id});
    try {
      return await ventureAction(deps, ctx, 'approve', 'delivery.approve', tx => {
        const current = tx.find('venture-delivery-run', runId);
        // 4F1: force stopped while this call was out (the stopped run keeps the cut call): the answer is not kept, what
        // was sent stays sent, and the cut is settled so Resume can go on.
        if (current?.status === 'stopped' && current.callId === callId) {
          const settled = tx.replace({ ...current, callId: null });
          tx.emit('run.step', { runId });
          return runView(settled, tx.venture!, Date.parse(tx.now), tx.state);
        }
        check(current && current.status === 'waiting-for-you' && current.callId === callId, 'DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
        // Checked again: the stage can move down while the call is out. At shadow the answer is a practice draft.
        const stage = tx.venture!.launchStage;
        check(agentStage(stage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
        const next: DeliveryRunRecord = {
          ...current, status: 'ready-for-review', practice: current.practice || stage === 'shadow', preview: null, deliverable, renderedText, checks,
          ...(playbookChecks ? { playbookChecks } : {}), ...(pending ? { judgePending: pending } : {}),
          // 4F2 (H32): when the AI-written draft was kept; the drafts cap counts these (harness/write-caps.ts).
          readyAt: tx.now,
          // 4J18: the sources the approved text carried, by id.
          ...(knowledge.length ? { knowledge } : {}),
          // 4J2 (O5, O6): a revision the owner asked for lands: merged by paragraph with the owner's words (revise.ts).
          ...landRevision(current, { renderedText, checks, ...(playbookChecks ? { playbookChecks } : {}) }, tx.now),
        };
        tx.replace(next);
        recordCheckSignal(tx, runId, checks);
        tx.emit('delivery-ready', { runId, orderId: next.orderId, servedBy: 'model' });
        tx.emit('run.step', { runId });
        tx.emit('run.waiting', { runId });
        return runView(next, tx.venture!, Date.parse(tx.now), tx.state);
      });
    } catch (error) {
      // The call is spent, so a draft that could not be stored can never be approved again.
      await markFailedWhenSpent(deps, ctx, run, callId, error);
      throw error;
    }
  };

  // The send is an outside effect, so it goes through the action journal (venture/journal/): described, approved with a
  // token bound to this exact text, the owner, the session and the business, claimed before the call, then applied,
  // rejected or outcome_unknown. An unknown outcome (a timeout) is never sent again. The token stays in memory here.
  const client = findRecord(state, 'venture-client', context.order.clientId)?.name ?? 'your client';
  const sent = await journalled(deps, ctx, {
    action: 'delivery.send', subject: `${run.id}:${callId}`, target: client, actionDigest: approved, line: `Send the next step for ${client} to your AI.${notice ? ` ${notice.short}` : ''}`,
    notAfter: run.preview?.expiresAt ?? null,
    quote: run.preview ? { figure: run.preview.estimatedMaxCostMicros, payer: run.preview.presetId } : null,
    descriptionComplete: run.preview ? previewShownWhole(run.preview) : false,
  }, async (): Promise<{ outcome: 'applied'; line: string; value: DeliveryRunView | null }> => {
    try {
      // 4J13 (H34): the call holds a lease on its run while it is out (leases.ts): if Chausar dies, the run goes back to waiting.
      return { outcome: 'applied', line: 'Sent to your AI. It answered.', value: await withRunLease(deps, ctx, runId, callId, send) };
    } catch (error) {
      // 4F1: once the AI answered, the call went out: the journal says so honestly, and the error still reaches the owner.
      if (!went.out) throw error;
      notKept = error;
      return { outcome: 'applied', line: 'Sent to your AI. It answered, but its answer was not kept.', value: null };
    }
  });
  if (notKept) throw notKept;
  const sentView = sent.value!;
  // The consent is recorded only when none exists, and only when the approving surface bound the setting's words it
  // showed (Today's row digest); never from the cost line alone.
  if (notice && !notice.consented && judge && options.judgeNoticeShown === notice.line) await judge.recordDefaultConsent(deps, ctx, sent.entry.id).catch(() => null);
  // The rules judge on its own (judgeAuto, judge-run.ts): a ready draft for a client or the public is judged once,
  // before the CA sees any papers, so papers the judge failed never go to the CA. It never fails or undoes the run.
  const view = sentView.status === 'ready-for-review' && judge
    ? await judge.autoJudge(deps, ctx, sentView).catch(() => sentView)
    : sentView;
  // AI-native CA firm: a ready draft for a regulated offer goes in front of the CA of record (a Send to CA row on
  // Today). Loaded only for a ready draft; it never fails or undoes the run.
  if (view.status === 'ready-for-review') {
    await import('../playbooks/ca-firm/delivery-signoff.ts').then(module => module.requestSignoffForRun(deps, ctx, view)).catch(() => null);
  }
  return view;
}

type HarnessApproval = {
  state: State; run: DeliveryRunRecord; harness: HarnessState; context: OrderContext; playbook: PlaybookRecord; refs: DraftRefs;
  offer: { name: string; description: string }; callId: string; approved: string;
  /** The judge's due marker for the write turn's ready commit (judge-run.ts), or null. */
  pending?: DeliveryRunRecord['judgePending'];
  /** 4F1: told once the AI answered, so the journal records that the call went out (approveDelivery). */
  answered?: () => void;
};

/**
 * One approved turn of the agent loop. An act turn: the model answers, the tools run here, then the next turn (or the
 * write step) is previewed and waits for the owner. A hand-off waits for the owner's answer instead. The write turn:
 * the draft is rendered with its attachments, checked against what the tools proved, and stored for review.
 */
async function approveHarnessTurn(deps: VentureDeps, ctx: Context, a: HarnessApproval): Promise<DeliveryRunView> {
  const { run, harness, context, playbook, refs, callId } = a;
  const youtubeGuard=youtubeDispatchGuard(deps,context.venture,context.order,harness.toolCalls);
  // 4F1: from here to the commit is the time this turn took to run (the run's measured working time, estimates.ts).
  const began = deps.clock().getTime();
  const files = uploadsById(a.state, context.venture.id, harness.uploadIds);
  const made = madeSoFar(a.state, harness);
  const available = harness.phase === 'act' ? await delegateOffer(deps) : [];
  const loop = loopContext(deps, ctx, a.state, context, playbook, a.offer, files, answersOf(harness), available);
  const task = nextTask(loop, context, refs, harness, made.receipts, files, made.tables);
  // 4B2: a note this turn's text carries that was forgotten or changed since never goes; the step is made again.
  if (harness.phase === 'act') await refuseStaleNotes(deps, ctx, a);
  // 4J18: and a source removed, changed or held since, read from the vault just before the send (act or writing turn).
  await refuseStaleSources(deps, ctx, a);
  let value: unknown, by: 'model' | 'template', costMicros: string;
  try {
    const outcome = await deps.models.runPreview(ctx, callId, a.approved, raw => harness.phase === 'act' ? validateTurn(raw, harness.limits) : task.validate(raw),{beforeDispatch:()=>{youtubeGuard();}});
    value = outcome.value; by = outcome.by; costMicros = outcome.costMicros;
    a.answered?.();
  } catch (error) {
    // 4F2 (H35): an act turn answered in a shape Chausar cannot read gets one repair turn (harness/repair.ts).
    const repaired = await repairTurn(deps, ctx, run, harness, callId, error, a.answered);
    if (repaired) return repaired;
    await markFailedWhenSpent(deps, ctx, run, callId, error);
    throw error;
  }

  try {
    if (harness.phase === 'act') {
      // The owner approved this turn's exact text before it ran: that is the approval a step on hold waits for.
      const env = buildToolEnv({ deps, ctx, state: a.state, venture: context.venture, playbook, runRef: { kind: 'delivery', runId: run.id }, files, tables: made.tables, receipts: made.receipts, allowed: loop.allowed, delegateOffer: available, approval: { kind: 'owner-turn', callId }, intake: context.order.intake ?? null });
      // 4A1: quarantined while the call was out: none of this turn's tools run.
      refuseQuarantined(deps.store.read(), context.venture, deps.clock().toISOString());
      // 4B2: the notes this turn recalled, read from the exact text the owner approved (agents/recall.ts notesCarried).
      // 4J18: and the sources it read, the same way (agents/knowledge-recall.ts sourcesCarried).
      const approvedText = run.preview?.payloadText ?? '';
      const turned = await applyTurn(env, harness, value as AgentTurn, { by, callId, costMicros, recalled: notesCarried(a.state, context.venture, approvedText), knowledge: sourcesCarried(a.state, context.venture, approvedText) });
      const newTables = env.tables.slice(made.tables.length), newReceipts = env.receipts.slice(made.receipts.length);
      // 4F1: what the owner changed while the turn ran (a stop, a note, the gate) joins what the turn made.
      const next = carryControls(turned, liveHarness(deps, run.id));
      // A hand-off waits for an answer and a heavy-work brief for the owner's decision: neither previews a turn yet.
      // Nor does a stop (the owner's, a force stop, or the gate's) or the round gate holding the run for the owner (4F1).
      const pauses = next.phase === 'needs-answer' || next.phase === 'brief' || !!next.control?.stop || gateWaits(next);
      const preview = pauses ? null : await deps.models.preview(ctx, nextTask(loop, context, refs, next, env.receipts, files, env.tables));
      check(pauses || preview, 'NO_MODEL_CONNECTED', 'Connect an AI first, or use built-in templates.');
      return await ventureAction(deps, ctx, 'approve', 'delivery.approve', tx => {
        const current = tx.find('venture-delivery-run', run.id);
        // 4F1: a force stop cut this very call: the turn is thrown away, nothing it made is stored, only what it cost.
        if (current?.harness?.control?.cutCallId === callId) return keepCutTurn(tx, current, costMicros);
        check(current && current.status === 'waiting-for-you' && current.callId === callId, 'DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
        const stage = tx.venture!.launchStage;
        check(agentStage(stage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
        for (const table of newTables) tx.put(table);
        for (const receipt of newReceipts) tx.put(receipt);
        const merged = workedFor(carryControls(next, current.harness), began, tx.now);
        const practice = current.practice || stage === 'shadow';
        // 4F1: the owner's stop, or the gate's, takes effect now: finished steps are kept and nothing more runs.
        const stopping = !!merged.control?.stop;
        const stored: DeliveryRunRecord = stopping
          ? { ...current, status: 'stopped', callId: null, preview: null, harness: stoppedNow(merged, tx.now, STOPPED_BY_YOU), practice }
          : preview
            // The owner's notes this next text carries are stamped with its call; only that turn takes them (4F1).
            ? { ...current, status: 'waiting-for-you', callId: preview.callId, preview, harness: stampOwnerWords(merged, next, preview.callId), practice }
            : next.phase === 'needs-answer' || next.phase === 'brief'
              // 4J13 (A13): a question carries when it stops being answerable (timed-questions.ts).
              ? { ...current, status: next.phase === 'brief' ? 'brief-waiting' : 'needs-answer', callId: null, preview: null, harness: withQuestionExpiry(merged, tx.now, questionWindowMs(playbook)), practice }
              // The round gate (4F1): the run waits for the owner's Continue or Stop on Today; nothing is previewed yet.
              : { ...current, status: 'waiting-for-you', callId: null, preview: null, harness: merged, practice };
        tx.replace(stored);
        // Facts the agent noted (evidence.record), checked again against the trace just stored: suggestions for the owner.
        storeRunEvidence(tx, env.evidence ?? [], { runId: run.id, clientId: context.order.clientId });
        // 5A4 (P8): the files its tools recorded (assets.record, media.clean), as the order's asset records.
        storeRunAssets(tx, stored.harness?.toolCalls ?? [], { runId: run.id, orderId: run.orderId, clientId: context.order.clientId });
        if (stopping) tx.emit('run.stopped', { runId: stored.id });
        else if (preview) tx.emit('delivery-waiting', { runId: stored.id, orderId: stored.orderId, practice: stored.practice });
        else if (next.phase === 'brief') tx.emit('delivery-brief-waiting', { runId: stored.id, orderId: stored.orderId });
        else if (next.phase === 'needs-answer') {
          tx.emit('delivery-needs-answer', { runId: stored.id, orderId: stored.orderId });
          // Ink v2 wave 5 (5A1): a kit chain stage that asks the client waits on the client (playbooks/kit/chain.ts).
          chainOnQuestion(tx, stored);
        }
        tx.emit('run.step', { runId: stored.id });
        if (!stopping) tx.emit('run.waiting', { runId: stored.id });
        return runView(stored, tx.venture!, Date.parse(tx.now), tx.state);
      });
    }

    // 4A1: quarantined while the call was out: the draft is not stored.
    refuseQuarantined(deps.store.read(), context.venture, deps.clock().toISOString());
    // 4J18: the sources the writing turn read, from the exact text the owner approved (agents/knowledge-recall.ts).
    const done = finishWrite(harness, { by, callId, costMicros, knowledge: sourcesCarried(a.state, context.venture, run.preview?.payloadText ?? '') });
    const answers = harness.handoffs.flatMap(handoff => handoff.answer === null ? [] : [handoff.answer]);
    const corrected = correctOrderDraft(context, playbook, value as Deliverable, { work: made.receipts, answers, harness: done, files });
    const deliverable = preserveOtherPosts(run,corrected.deliverable);
    const corrections = corrected.corrections;
    const receipts: AnyReceipt[] = [...context.receipts, ...made.receipts];
    const renderedText = renderDeliverable(deliverable, receipts, context.venture.country);
    const draft = flagshipDraft(playbook, context.offerKey, context.order.intake ?? null, context.order.chainStage ?? null);
    const checks = checkDraft(context, playbook, deliverable, renderDeliverable(deliverable, receipts, context.venture.country, { attachments: false }), {
      work: made.receipts, proofs: harness.proofs, answers, harness: done, files, corrections, times: youtubeWorked(harness.toolCalls, made.tables).times,
      sections: draft?.sections ?? (harness.sections === 'report' ? REPORT_SECTIONS : REQUIRED_SECTIONS[context.blueprint.serviceType]),
    });
    const playbookChecks = await flagshipChecks(deps, context, playbook, deliverable, 'model', { runId:run.id, work: made.receipts, tables: made.tables, files, harness: done });
    return await ventureAction(deps, ctx, 'approve', 'delivery.approve', tx => {
      const current = tx.find('venture-delivery-run', run.id);
      // 4F1: a force stop cut this write turn's call: the draft is thrown away; only what its call cost is kept.
      if (current?.harness?.control?.cutCallId === callId) return keepCutTurn(tx, current, costMicros);
      check(current && current.status === 'waiting-for-you' && current.callId === callId, 'DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
      const stage = tx.venture!.launchStage;
      check(agentStage(stage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
      // 4F1: the last step finished, so a stop asked meanwhile has nothing left to stop; the owner's notes and gate stay.
      const carried = carryControls(done, current.harness);
      const finished = workedFor(carried.control?.stop ? { ...carried, control: { stop: null, stoppedAt: null, line: null } } : carried, began, tx.now);
      const next: DeliveryRunRecord = {
        ...current, status: 'ready-for-review', practice: current.practice || stage === 'shadow', preview: null, deliverable, renderedText, checks, harness: finished,
        ...(playbookChecks ? { playbookChecks } : {}), ...(a.pending ? { judgePending: a.pending } : {}),
        // 4F2 (H32): when the AI-written draft was kept; the drafts cap counts these (harness/write-caps.ts).
        readyAt: tx.now,
        // 4J2 (O5, O6): a revision the owner asked for lands: merged by paragraph with the owner's words (revise.ts).
        ...landRevision(current, { renderedText, checks, ...(playbookChecks ? { playbookChecks } : {}) }, tx.now),
      };
      tx.replace(next);
      // The spot-check completion hook (policy/spot-check.ts): at auto with spot checks the finished run gets its
      // decision in this same commit. That launch stage is still planned, so today this records nothing.
      spotCheckOnFinish(tx, { runId: run.id, spendMicros: done.used.costMicros });
      recordCheckSignal(tx, run.id, checks);
      tx.emit('delivery-ready', { runId: run.id, orderId: next.orderId, servedBy: 'model' });
      tx.emit('run.step', { runId: run.id });
      tx.emit('run.waiting', { runId: run.id });
      return runView(next, tx.venture!, Date.parse(tx.now), tx.state);
    });
  } catch (error) {
    await markFailedWhenSpent(deps, ctx, run, callId, error);
    throw error;
  }
}

/** 4B2: the owner's words when a turn waiting for approval carried a note forgotten or changed since. */
export const NOTES_CHANGED = 'A note this step carried was forgotten or changed, so Chausar made the step again with your notes as they are now. Read it again.';

/**
 * 4B2: a turn whose approved text carries a note the owner forgot or changed since (agents/recall.ts staleNotes) is never
 * sent. The step is made again from the notes as they are now and waits for the owner's approval like any other, and
 * the approval that was asked is refused with APPROVAL_STALE before anything goes to the AI.
 */
async function refuseStaleNotes(deps: VentureDeps, ctx: Context, a: HarnessApproval): Promise<void> {
  const { run, callId } = a;
  const venture = a.context.venture;
  if (!staleNotes(a.state, venture, run.preview?.payloadText ?? '').length) return;
  const made = await previewNextTurn(deps, ctx, a.state, venture, run, a.harness);
  await ventureAction(deps, ctx, 'approve', 'delivery.approve', tx => {
    const current = tx.find('venture-delivery-run', run.id);
    check(current && current.status === 'waiting-for-you' && current.callId === callId, 'DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
    const harness = made.harness ? stampOwnerWords(carryControls(made.harness, current.harness), made.harness, made.preview.callId) : current.harness;
    tx.replace<DeliveryRunRecord>({ ...current, callId: made.preview.callId, preview: made.preview, harness });
    tx.emit('delivery-waiting', { runId: run.id, orderId: current.orderId, practice: current.practice });
    tx.emit('run.waiting', { runId: run.id });
  });
  throw new ChausarError('APPROVAL_STALE', NOTES_CHANGED);
}

/**
 * 4J18: the sources a one-step draft (the client's message, no files) carries: those that share words with its
 * writing work, matched the way the writing turn's are (agents/knowledge-recall.ts).
 */
function oneStepKnowledge(state: State, context: OrderContext, playbook: PlaybookRecord, offer: { name: string }, draft: { guidance: readonly string[] } | null | undefined) {
  return knowledgeForTurn(state, context.venture, turnQuery('write', playbook.steps, context.order.request, offer.name, draft?.guidance ?? writeGuidance(playbook)));
}

/**
 * 4J18: a turn (act, writing or one-step draft) whose approved text carries a source from what the AI knows that was removed, changed
 * (by Forget, say) or held since (agents/knowledge-recall.ts staleSources), read from the vault as it is just before
 * the send, is never sent. The step is made again from what the AI knows now and waits for the owner's approval, and
 * the approval that was asked is refused with APPROVAL_STALE before anything goes to the AI.
 */
async function refuseStaleSources(deps: VentureDeps, ctx: Context, a: Pick<HarnessApproval, 'run' | 'callId' | 'context'> & { harness: HarnessState | null }): Promise<void> {
  // A one-step draft (harness null) is made again by previewNextTurn the same way: with what the AI knows now.
  const { run, callId } = a;
  const venture = a.context.venture;
  const fresh = deps.store.read();
  if (!staleSources(fresh, venture, run.preview?.payloadText ?? '').length) return;
  const made = await previewNextTurn(deps, ctx, fresh, venture, run, a.harness);
  await ventureAction(deps, ctx, 'approve', 'delivery.approve', tx => {
    const current = tx.find('venture-delivery-run', run.id);
    check(current && current.status === 'waiting-for-you' && current.callId === callId, 'DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
    const harness = made.harness ? stampOwnerWords(carryControls(made.harness, current.harness), made.harness, made.preview.callId) : current.harness;
    tx.replace<DeliveryRunRecord>({ ...current, callId: made.preview.callId, preview: made.preview, harness });
    tx.emit('delivery-waiting', { runId: run.id, orderId: current.orderId, practice: current.practice });
    tx.emit('run.waiting', { runId: run.id });
  });
  throw new ChausarError('APPROVAL_STALE', SOURCES_CHANGED);
}

// ---------------------------------------------------------------------------
// Ink v2 wave 4 (4F1): run controls inside a turn in flight
// ---------------------------------------------------------------------------

/** The run's loop state as stored now, so what the owner changed while a turn ran is not lost. */
function liveHarness(deps: VentureDeps, runId: string): HarnessState | null {
  return findRecord(deps.store.read(), 'venture-delivery-run', runId)?.harness ?? null;
}

/** Adds the time from began to now to the run's measured working time. */
function workedFor(state: HarnessState, began: number, nowIso: string): HarnessState {
  return { ...state, workedMs: (state.workedMs ?? 0) + Math.max(0, Date.parse(nowIso) - began) };
}

/**
 * A turn the owner force stopped while it ran: what it made is not stored, its call cost still counts toward the run's
 * cap, and the run stays stopped. The journal entry of its send settles as its journal says (applied: it went out).
 */
function keepCutTurn(tx: VentureTx, current: DeliveryRunRecord, costMicros: string): DeliveryRunView {
  // The cut is settled here: its cost joins the run's, and Resume may go on (run-controls.ts).
  const harness = current.harness ? {
    ...current.harness, used: { ...current.harness.used, costMicros: String(BigInt(current.harness.used.costMicros) + BigInt(costMicros)) },
    ...(current.harness.control ? { control: { ...current.harness.control, cutCallId: null } } : {}),
  } : current.harness;
  const kept: DeliveryRunRecord = { ...current, harness };
  tx.replace(kept);
  tx.emit('run.step', { runId: kept.id });
  return runView(kept, tx.venture!, Date.parse(tx.now), tx.state);
}

/**
 * A heavy-work brief the owner force stopped while their tool ran: the record of what ran is kept (it ran on this
 * computer and its cost is on the ledger), what it made does not join the run, and the brief is closed so Resume goes
 * on with the next turn. The run stays stopped.
 */
function keepCutBrief(tx: VentureTx, current: DeliveryRunRecord, record: DelegateRunRecord, costMicros: string): DeliveryRunView {
  tx.put(record);
  tx.emit('delegate-finished', { runId: current.id, delegateRunId: record.id, cli: record.cli, outcome: record.outcome });
  const message = 'You force stopped the run, so what the tool made was not kept.';
  const closed = openDelegation(current.harness!)
    ? settleDelegation(current.harness!, { status: 'declined', envelope: { ok: false, error: { code: 'TOOL_SKIPPED', name: 'ToolSkipped', message } }, outcome: 'cancelled', delegateRunId: record.id, receiptIds: [], proofs: [], costMicros })
    : current.harness!;
  // The cut is settled here, so Resume may go on (run-controls.ts).
  const harness = closed.control ? { ...closed, control: { ...closed.control, cutCallId: null } } : closed;
  const kept: DeliveryRunRecord = { ...current, harness };
  tx.replace(kept);
  tx.emit('run.step', { runId: kept.id });
  return runView(kept, tx.venture!, Date.parse(tx.now), tx.state);
}

/**
 * The next turn of a run, previewed from its own playbook version (never a newer one in use), for Resume, a steer note
 * on a waiting run and the round gate's Continue (run-controls.ts). An agent run previews its act or write turn; when
 * no AI serves quick work any more, the act phase gives way to writing, as when the run started. A one-step run
 * previews its draft again. Returns the loop state the preview was made from, which the caller stores with it.
 */
export async function previewNextTurn(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, run: DeliveryRunRecord, harness: HarnessState | null): Promise<{ preview: ModelPreview; harness: HarnessState | null }> {
  const context = orderContext(state, venture, run.orderId);
  const playbook = playbookForRun(state, run);
  check(playbook && playbook.ventureId === venture.id, 'PLAYBOOK_NOT_FOUND', 'The playbook for this draft was not found.');
  const { refs, offer } = draftContext(context, todayIso(deps, venture));
  if (!harness) {
    const draft = flagshipDraft(playbook, context.offerKey, context.order.intake ?? null, context.order.chainStage ?? null);
    // 4J2: a revision the owner asked for puts their words first in the step's input (revise.ts withRevision).
    const preview = await deps.models.preview(ctx, withRevision(deliveryTask({
      serviceType: context.blueprint.serviceType, offer, clientRequest: context.order.request, idea: context.venture.idea, refs,
      containsClientData: true, templateTotalRef: 'order.total', guidance: draft?.guidance ?? writeGuidance(playbook), ...(draft ? { sections: draft.sections } : {}),
      knowledge: oneStepKnowledge(state, context, playbook, offer, draft), // 4J18
      style: { ...writingStyle(state, context.venture, playbook), ...brandKitPart(state, context.venture, context.order.clientId), ...socialVoicePart(context.order) }, // 4J17; 5A4 the client's kit
    }), run.revision));
    check(preview, 'NO_MODEL_CONNECTED', 'Connect an AI first, or use built-in templates.');
    return { preview, harness: null };
  }
  const next = harness.phase === 'act' && deps.models.status(ctx).tiers.fast.presetId === 'built-in-templates' ? skipActs(harness, NO_QUICK_AI) : harness;
  const files = uploadsById(state, venture.id, next.uploadIds);
  const made = madeSoFar(state, next);
  const available = next.phase === 'act' ? await delegateOffer(deps) : [];
  const loop = loopContext(deps, ctx, state, context, playbook, offer, files, answersOf(next), available);
  const preview = await deps.models.preview(ctx, withRevision(nextTask(loop, context, refs, next, made.receipts, files, made.tables), run.revision));
  check(preview, 'NO_MODEL_CONNECTED', 'Connect an AI first, or use built-in templates.');
  return { preview, harness: next };
}

/**
 * venture.delivery.answer { runId, answer } (app only): the owner answers the agent's hand-off question (their own
 * decision, or what the client said). The next turn is previewed and waits for approval like every other turn.
 * within: more writes in the same commit as the answer (4B1: the owner's message in the agent's thread); absent for the method.
 */
export async function deliveryAnswerHandler(deps: VentureDeps, ctx: Context, payload: unknown, within?: (tx: VentureTx, handoff: number) => void): Promise<DeliveryRunView> {
  requireAppChannel(ctx, 'venture.delivery.answer');
  const body = exactPayload(payload, ['runId', 'answer'], ['runId', 'answer']);
  const runId = identifier(body.runId, 'Draft reply');
  const answer = plainText(body.answer, 'Answer', { min: 1, max: MAX_ANSWER_CHARS });
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = findRun(state, venture, runId);
  check(run.status === 'needs-answer' && run.harness?.phase === 'needs-answer', 'DELIVERY_NOT_ASKING', 'This draft reply is not waiting for an answer.');
  // 4J13 (A13): a question that ran out takes no answer, so a late approval never lets a held call run.
  refuseExpiredQuestion(run.harness, deps.clock().getTime(), venture);
  check(agentStage(venture.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  // Ink v2 wave 4 (4A1): an answer does not move a quarantined team's run on (quarantine-gate.ts).
  await loadQuarantineCheck();
  refuseQuarantined(state, venture, deps.clock().toISOString());
  // 4J12: nor one whose order contract waits for the owner's signature (again in the commit).
  refuseUnsignedRun(state, venture, run);
  const context = orderContext(state, venture, run.orderId);
  const playbook = playbookForRun(state, run);
  check(playbook, 'PLAYBOOK_NOT_FOUND', 'The playbook for this draft was not found.');
  const { refs, offer } = draftContext(context, todayIso(deps, context.venture));
  const files = uploadsById(state, venture.id, run.harness.uploadIds);
  const made = madeSoFar(state, run.harness);
  const next = answerHandoff(run.harness, answer, 'owner', screenSettingOf(state, venture.id));
  const available = next.phase === 'act' ? await delegateOffer(deps) : [];
  const preview = await deps.models.preview(ctx, nextTask(loopContext(deps, ctx, state, context, playbook, offer, files, answersOf(next), available), context, refs, next, made.receipts, files, made.tables));
  check(preview, 'NO_MODEL_CONNECTED', 'Connect an AI first, or use built-in templates.');
  return ventureAction(deps, ctx, 'approve', 'delivery.answer', tx => {
    const current = tx.find('venture-delivery-run', runId);
    // The same question this answer was read against: another answer and a new hand-off may have landed meanwhile.
    check(current && current.status === 'needs-answer' && current.harness?.turns.length === run.harness!.turns.length
      && current.harness?.handoffs.length === run.harness!.handoffs.length, 'DELIVERY_NOT_ASKING', 'This draft reply is not waiting for an answer.');
    refuseExpiredQuestion(current.harness, Date.parse(tx.now), tx.venture!);
    refuseQuarantined(tx.state, tx.venture!, tx.now);
    // 4J12: an answer does not move on a run whose order contract waits for the owner's signature.
    refuseUnsignedRun(tx.state, tx.venture!, current);
    const stage = tx.venture!.launchStage;
    check(agentStage(stage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
    // 4F1: notes the owner sent meanwhile stay; those this text carries are stamped with its call (harness/controls.ts).
    const harness = stampOwnerWords(carryControls(next, current.harness), next, preview.callId);
    const stored: DeliveryRunRecord = { ...current, status: 'waiting-for-you', callId: preview.callId, preview, harness, practice: current.practice || stage === 'shadow' };
    tx.replace(stored);
    tx.emit('delivery-waiting', { runId, orderId: stored.orderId, practice: stored.practice });
    tx.emit('run.step', { runId });
    tx.emit('run.waiting', { runId });
    within?.(tx, current.harness!.handoffs.findLastIndex(handoff => handoff.answer === null));
    // Ink v2 wave 5 (5A1): the answer resumes a kit chain at the stage its step names (playbooks/kit/chain.ts).
    chainOnAnswer(tx, stored);
    return runView(stored, tx.venture!, Date.parse(tx.now), tx.state);
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
  // Ink v2 wave 4 (4F1): heavy work does not start while the business is paused; declining stays open.
  if (decision === 'approve') refuseNewWork(state, venture, ctx, deps.clock().toISOString());
  // Ink v2 wave 4 (4A1): heavy work does not start for a quarantined team; declining stays open.
  if (decision === 'approve') { await loadQuarantineCheck(); refuseQuarantined(state, venture, deps.clock().toISOString()); }
  // 4J12: nor while the order's contract waits for the owner's signature; declining stays open.
  if (decision === 'approve') refuseUnsignedRun(state, venture, run);
  const harness = run.harness!;
  const context = orderContext(state, venture, run.orderId);
  const playbook = playbookForRun(state, run);
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
      // 4F1: notes sent meanwhile stay; those this text carries are stamped with its call (harness/controls.ts).
      const kept = stampOwnerWords(carryControls(next, current.harness), next, preview.callId);
      const stored: DeliveryRunRecord = { ...current, status: 'waiting-for-you', callId: preview.callId, preview, harness: kept, practice: current.practice || stage === 'shadow' };
      tx.replace(stored);
      tx.emit('delivery-waiting', { runId, orderId: stored.orderId, practice: stored.practice });
      tx.emit('run.step', { runId });
      tx.emit('run.waiting', { runId });
      return runView(stored, tx.venture!, Date.parse(tx.now), tx.state);
    });
  }

  // The gate again on what the vault says now (harness/recheck.ts): the order, the client, the stage and the run's cap.
  const denial = recheckRun(deps, venture.id, runId);
  if (denial) throw new ChausarError(denial.code, denial.reason);
  // The owner's send setting rules this send too: the tool passes what it reads to its own provider.
  check(deps.models.status(ctx).sendPolicy !== 'nothing', 'SEND_DISABLED', 'Sending is off for this workspace, so the tool was not started. Change it on Trust & access.');
  // The Claude Code terms gate may have closed since the brief was written; then Claude Code is not started.
  check(delegateGateOpen(open.cli, deps.claudeCodeTerms), 'TIER_UNAVAILABLE', `${DELEGATE_CLAUDE_TERMS} Decline the brief and the agent can carry on without it.`);
  const ports = delegatePorts(deps);
  const now = await delegateAvailability(ports, open.cli, deps.claudeCodeTerms);
  check(ports && now.state !== 'needs-setup' && now.executable === open.executable && now.version === open.version, 'TIER_UNAVAILABLE',
    `${label} is gone or changed since the brief was written, so it was not started. Decline the brief and the agent can ask again.`);
  // 4J11 (H31): one delegated run on this computer at a time. The slot is taken here, synchronously, so a second
  // approval is refused before its claim: its brief stays waiting and nothing is reserved for it. runDelegation releases
  // it when the tool is done; every throw before that releases it here.
  const releaseSlot = takeDelegateSlot();
  let delegateFiles: FileLike[];
  // Claimed first, in its own write: a second approval finds the brief running and starts nothing. The same write holds
  // the run's cost on the spend ledger (its charge record), or refuses the run when it has no price or passes the cap.
  const spend = delegateSpend(open, runId);
  let estimate = '0';
  let claimed: HarnessState;
  try {
    delegateFiles = uploadsById(state, venture.id, open.uploadIds);
    claimed = await ventureAction(deps, ctx, 'approve', 'delivery.delegate', tx => {
      const current = tx.find('venture-delivery-run', runId);
      const live = current?.harness ? openDelegation(current.harness) : null;
      check(current && current.status === 'brief-waiting' && live && live.status === 'waiting' && live.digest === open.digest, 'DELIVERY_NOT_BRIEFING', NOT_BRIEFING);
      check(agentStage(tx.venture!.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
      // 4F1: a pause that came while the tool was checked refuses the start here too (run-guards.ts).
      refuseNewWork(tx.state, tx.venture!, ctx, tx.now);
      refuseQuarantined(tx.state, tx.venture!, tx.now);
      // 4J12: nor while the order's contract waits for the owner's signature.
      refuseUnsignedRun(tx.state, tx.venture!, current);
      // The owner's approval of this exact brief (its digest was checked above) opens the floor gate on starting it.
      const rate = resolveRate({ item: spend.item, list: spend.list, owner: ownerRates(tx.list('venture-spend-policy')), subject: spend });
      estimate = fixedEstimate(rate, spend);
      // Heavy work counts against the run's spend cap. The owner approved this brief with its cost in view, so that one
      // approval raises the cap by its reserve: nothing asks twice, and the run is then held against the raised cap.
      const raised = addCapWindow(current.harness!, estimate, tx.now, ctx.memberId);
      reserveRunCall(raised, estimate);
      const started = startDelegation(raised, tx.now, { kind: 'owner-action', digest: body.digest as string, memberId: ctx.memberId });
      reserveSpend(tx, { ...spend, rate, estimateMicros: estimate });
      tx.replace({ ...current, harness: started });
      tx.emit('run.step', { runId });
      return started;
    }).catch(error => spendRefused(deps, ctx, error));
  } catch (error) {
    releaseSlot();
    throw error;
  }
  const request = openDelegation(claimed)!;
  // 4F1: the time the owner's tool works counts toward the run's measured working time (estimates.ts).
  const began = deps.clock().getTime();
  let result: DelegationResult;
  try {
    result = await runDelegation(ports!, request, delegateFiles, { currency: venture.country.currency, dateOrder: venture.country.dateOrder, runRef: { kind: 'delivery', runId } }, releaseSlot);
  } catch (error) {
    // The tool may have run and spent: the reservation stays held and is never retried on its own.
    await settleSpendAction(deps, ctx, spend.key, { kind: 'unknown' }).catch(() => null);
    throw error;
  }
  // Settled in its own write, before anything else can fail: what the run cost does not depend on the next turn.
  const settled = await settleSpendAction(deps, ctx, spend.key, delegateSpendOutcome(result)).catch(() => null);
  // What it cost joins the run's spend: the settled figure, or the estimate when the settle could not be written.
  const costMicros = settled ? countedMicros(settled) : estimate;

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
  const next = settleDelegation(claimed, { status: 'finished', envelope, outcome: result.outcome, delegateRunId: record.id, receiptIds: receipts.map(receipt => receipt.id), proofs, costMicros }, screenSettingOf(state, venture.id));

  let preview: ModelPreview | null = null;
  let previewError: unknown = null;
  // 4F1: a stop the owner asked for while the tool ran: what it made is kept and no next turn is previewed.
  const stopping = !!liveHarness(deps, runId)?.control?.stop;
  if (!stopping) try { preview = await previewNext(next, [...made.receipts, ...receipts]); } catch (error) { previewError = error; }
  // What the tool made is stored even when the next turn can't be previewed: the owner's plan paid for it.
  const { view, blocked } = await ventureAction(deps, ctx, 'approve', 'delivery.delegate', tx => {
    const current = tx.find('venture-delivery-run', runId);
    // 4F1: a force stop cut this very brief while the tool ran: the record of what ran is kept, what it made does not join the run.
    if (current?.harness?.control?.cutCallId === request.toolCallId) return { view: keepCutBrief(tx, current, record, costMicros), blocked: false };
    check(current && current.status === 'brief-waiting', 'DELIVERY_NOT_BRIEFING', NOT_BRIEFING);
    for (const receipt of receipts) tx.put(receipt);
    tx.put(record);
    // 5A4 (P8): what the tool left is handed over, so each file gets an asset record (source unknown until recorded).
    recordHandedOverFiles(tx, record);
    tx.emit('delegate-finished', { runId, delegateRunId: record.id, cli: record.cli, outcome: record.outcome });
    const stage = tx.venture!.launchStage;
    const merged = workedFor(carryControls(next, current.harness), began, tx.now);
    const halted = !!merged.control?.stop;
    const going = !halted && preview !== null && agentStage(stage);
    const stored: DeliveryRunRecord = halted
      ? { ...current, status: 'stopped', callId: null, preview: null, harness: stoppedNow(merged, tx.now, STOPPED_BY_YOU) }
      : going
        ? { ...current, status: 'waiting-for-you', callId: preview!.callId, preview, harness: stampOwnerWords(merged, next, preview!.callId), practice: current.practice || stage === 'shadow' }
        : { ...current, status: 'failed', callId: null, preview: null, harness: merged };
    // 4J13 (H30): the heavy work reports into this run under the brief's fixed id, with its marker, in this same write;
    // its sources are the order's files it read (none: the report carries the no-sources warning).
    tx.replace(withReport(stored, { messageId: `brief:${request.toolCallId}`, from: 'heavy-work', line: `${label} reported back. ${record.reason}`, sources: delegateFiles.map(file => file.name) }, tx.now).run);
    if (going) tx.emit('delivery-waiting', { runId, orderId: stored.orderId, practice: stored.practice });
    tx.emit('run.step', { runId });
    tx.emit(halted ? 'run.stopped' : going ? 'run.waiting' : 'run.failed', { runId });
    return { view: runView(stored, tx.venture!, Date.parse(tx.now), tx.state), blocked: !halted && !agentStage(stage) };
  });
  if (previewError) throw previewError;
  check(!blocked, 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  return view;
}

/** The stages at which an agent may draft for a real order. Moving down is always allowed, so each step checks again. */
export function agentStage(stage: VentureRecord['launchStage']): boolean {
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
      tx.emit('run.failed', { runId });
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
  const voiceGuard=await socialVoiceGuard();
  let chainNext: string | null = null;
  const reviewed = await ventureAction(deps, ctx, 'approve', 'delivery.review', async tx => {
    const run = tx.find('venture-delivery-run', runId);
    check(run, 'DELIVERY_NOT_FOUND', 'That draft reply was not found.');
    check(run.status === 'ready-for-review', 'DELIVERY_NOT_READY', 'This draft reply is not ready for review.');
    if(verdict!=='rejected'&&playbookForRun(tx.state,run)?.flagship==='job-search-desk'){const source=careerRunCurrent(tx.state,tx.venture!.id,run,tx.now,true)!;check(verdict!=='edited'||editedText===source.text,'CAREER_CLAIM_BOUNDARY','Revise the evidence in the career desk and approve a new rendered pack.');}
    if(verdict!=='rejected'&&playbookForRun(tx.state,run)?.flagship==='tender-desk')await (await import('../playbooks/tender-desk/run-source.ts')).tenderRunSource(deps,tx.venture!.id,run.orderId,true);
    if(verdict!=='rejected'&&playbookForRun(tx.state,run)?.flagship==='narration-studio')await (await import('../playbooks/narration-studio/run-source.ts')).narrationRunSource(deps,tx.venture!.id,run.orderId,true);
    if(verdict!=='rejected'){const order=tx.find('venture-order',run.orderId);if(order)voiceGuard(tx.state,tx.venture!,order);}
    if(verdict!=='rejected'){const order=tx.find('venture-order',run.orderId);if(order)refuseYoutubeDraft(tx.state,tx.venture!,order,tx.now,run.harness?.toolCalls);}
    // An agent draft is a practice draft unless the business is at approve each now: moving down is the owner's
    // safety lever, so a draft approved earlier can't be accepted, and an edit made now can't be copied.
    const practice = run.practice || (run.servedBy === 'model' && tx.venture!.launchStage !== 'approve-each');
    check(!(practice && verdict === 'accepted'), 'PRACTICE_DRAFT', PRACTICE_REASON);
    if (verdict === 'accepted') {
      acceptableAsIs(run.checks, run.playbookChecks);
      check(!judgeReading(run, Date.parse(tx.now)), 'INVALID_VENTURE_REQUEST', JUDGE_READING);
      // AI-native CA firm: regulated papers are accepted only once the CA of record signed off this exact draft.
      const unsigned = caSignoffBlock(tx.state, tx.venture!, run);
      if (unsigned) throw new ChausarError('CA_SIGNOFF_REQUIRED', unsigned);
      // 5A4: a file it hands over with no known licence, stale, held, made with withdrawn consent, or not made yet.
      const media = mediaAcceptBlock(tx.state, tx.venture!, run, tx.now);
      if (media) throw new ChausarError(media.code, media.line);
    }
    // 4J1 (J2): Accept or an edit binds the files the draft hands over, by the sha256 of their bytes, to whoever decided.
    const manifest = verdict !== 'rejected' ? acceptManifest(tx.state, run, tx.now, ctx.memberId) : null;
    const next: DeliveryRunRecord = {
      // 4J1: Accept of a draft the owner edited and that came back for review keeps the owner's words (draft-text.ts).
      ...run, status: verdict, practice, verdict: { choice: verdict, reason, at: tx.now }, editedText: verdict === 'accepted' ? run.editedText ?? null : editedText,
      // The owner's edit is the owner's own words: the judge never reads it, and its line says so (judge-run.ts).
      ...(verdict === 'edited' && run.judge ? { judge: { ...run.judge, line: JUDGE_EDIT_LINE } } : {}),
      ...(manifest ? { manifest } : {}),
    };
    tx.replace(next);
    keepSocialPostPlan(tx,next);
    // 4J1 (O17): who decided and when, wherever the owner reviewed it (Today, Work or the run sheet).
    recordDecision(tx, { subject: `run:${runId}`, action: verdict, who: 'owner', ruleId: null, reason: REVIEW_DECISION_WORDS[verdict], rowId: null });
    if (verdict !== 'accepted') {
      const signal: SignalRecord = { ...tx.base('venture-signal'), source: verdict === 'edited' ? 'owner-edited' : 'owner-rejected', runId, reason, scenarioId: null };
      tx.put(signal);
      tx.emit('signal-recorded', { signalId: signal.id, runId, source: signal.source, reason });
    }
    tx.emit('delivery-reviewed', { runId, verdict, practice });
    tx.emit('run.done', { runId });
    // Ink v2 wave 5 (5A1): a kit chain order moves on only after Accept, or goes back or stops after a rejection.
    chainNext = chainOnReview(tx, next, verdict);
    return runView(next, tx.venture!, Date.parse(tx.now), tx.state);
  });
  // The next stage's run starts through the order path, so its gates, posture and floor hold; if it can't start now
  // (no AI, a pause, a quarantine), the order stays at its new stage and the owner starts it from Work.
  if (chainNext) await deliveryRunHandler(deps, ctx, { orderId: chainNext }).catch(() => null);
  // AI-native CA firm: the owner's edit of regulated papers is new papers, so it goes in front of the CA of record too.
  if (reviewed.status === 'edited') {
    await import('../playbooks/ca-firm/delivery-signoff.ts').then(module => module.requestSignoffForRun(deps, ctx, reviewed)).catch(() => null);
  }
  return reviewed;
}

/**
 * Why a draft can't be accepted as it stands, or null when every check passed: the harness checks first, then a
 * flagship playbook's own (a check that did not run blocks nothing). The owner edits or rejects it. A draft that
 * claims work no tool run proves gets its own words. The rules judge's result comes last (judge-run.ts): a checked no
 * blocks with the judge's reason; a verdict no checked vote settled was not checked, so it blocks nothing.
 */
export function failedCheckReason(checks: readonly CheckResult[], playbookChecks?: readonly PlaybookCheckResult[]): string | null {
  const failed = checks.filter(result => !result.passed && !result.notChecked);
  if (failed.some(result => result.check === 'no-done-claims')) return DONE_CLAIM_REASON;
  if (failed.length) return `This draft failed a check: ${failed[0].detail} Edit it or reject it.`;
  const playbook = failedPlaybookCheck(playbookChecks);
  return playbook ? `This draft failed a check: ${playbook.detail} Edit it or reject it.` : null;
}

function acceptableAsIs(checks: readonly CheckResult[], playbookChecks?: readonly PlaybookCheckResult[]) {
  const reason = failedCheckReason(checks, playbookChecks);
  check(reason === null, 'INVALID_VENTURE_REQUEST', reason ?? '');
}

/**
 * A run as the screens read it, with what the engine would allow right now. The same rules as the handlers:
 * a ready agent draft is practice unless the business is at approve each (review refuses Accept otherwise), a draft
 * with a failed check can't be accepted, and a waiting draft is sent only at shadow or approve each while its preview
 * is live. Practice drafts wait for the owner only at shadow, the one stage that makes them; once the stage moves on
 * they drop off Today's list, though they stay in the list for review. A run asking a question waits for the owner's
 * answer while an agent may draft. Read with the vault's state, a CA firm's regulated papers can't be accepted until
 * the CA of record signed them off (playbooks/ca-firm/signoff-gate.ts); review and share check that again either way.
 */
export function runView(run: DeliveryRunRecord, venture: VentureRecord, nowMs: number, state?: State): DeliveryRunView {
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
  // Read with the vault's state, a run whose order was cancelled is not live: nothing more of it is sent or started.
  const cancelled = !!state && findRecord(state, 'venture-order', run.orderId)?.status === 'cancelled';
  const live = waiting && !cancelled && run.callId !== null && agentStage(stage) && run.preview !== null && Date.parse(run.preview.expiresAt) > nowMs;
  // A next call that would cross the run's spend cap waits for one more window on Today instead of an approval.
  const capped = live && !!run.harness && capShortfall(run.harness, run.preview!.estimatedMaxCostMicros) !== null;
  const canApprove = live && !capped;
  const blocked = ready
    ? (practiceNow ? PRACTICE_REASON : failedCheckReason(run.checks, run.playbookChecks) ?? (judgeReading(run, nowMs) ? JUDGE_READING : null) ?? (state ? caSignoffBlock(state, venture, run) : null)
      ?? (state ? mediaAcceptBlock(state, venture, run, new Date(nowMs).toISOString())?.line ?? null : null)) // 5A4: consent and its files' asset records
    : null;
  const canAccept = ready && blocked === null;
  const awaitingYou = waiting ? live : asking ? agentStage(stage) && !cancelled : brief ? briefWaits && agentStage(stage) && !cancelled : ready ? !practiceNow || stage === 'shadow' : false;
  // 4H1 (U17): which engine wrote the draft, read from its own call record; only with the vault's state.
  return { ...run, practiceNow, awaitingYou, canApprove, canAccept, acceptBlocked: blocked, ...(state ? { writtenBy: writtenByLine(state, run) } : {}) };
}

/** venture.delivery.list: every run, newest first, each with what the engine would allow now (see runView). */
export async function deliveryListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunView[]> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  const nowMs = deps.clock().getTime();
  return newestFirst(listRecords(state, 'venture-delivery-run', venture.id)).map(run => runView(run, venture, nowMs, state));
}
