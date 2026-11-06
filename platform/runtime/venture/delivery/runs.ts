import {youtubeWorked} from './harness/youtube-worked.ts';
import { testingDeliverable } from '../playbooks/app-testing/delivery-core.ts';
import { testingRunCurrent,testingRunSource } from '../playbooks/app-testing/run-source.ts';
import { caNamedTokens } from '../playbooks/ca-firm/draft-references.ts';
import { formsDeliverable,formsRunCurrent,formsRunSource } from '../playbooks/data-entry-desk/run-source.ts';
import { devDelivery } from '../playbooks/dev-agency/report.ts';
import { devStateSource } from '../playbooks/dev-agency/run-source.ts';
import { triageDelivery } from '../playbooks/it-triage/report.ts';
import { triageStateSource } from '../playbooks/it-triage/run-source.ts';
import { careerPackDeliverable } from '../playbooks/job-search-desk/pack.ts';
import { careerRunCurrent,careerRunSource } from '../playbooks/job-search-desk/run-source.ts';
import { watchDelivery } from '../playbooks/monitored-data/report.ts';
import { watchStateSource } from '../playbooks/monitored-data/run-source.ts';
import { phoneDelivery } from '../playbooks/phone-receptionist/report.ts';
import { phoneRunSource } from '../playbooks/phone-receptionist/run-source.ts';
import { vaBriefDeliverable,vaRoomEvidence,vaRunCurrent,vaRunSource } from '../playbooks/virtual-assistant/run-source.ts';
import { refuseYoutubeDraft } from '../playbooks/youtube/run-guard.ts';
// Chausar venture launcher, delivery package (P5): draft replies for real orders.
// Template outlines and deterministic playbook reports need no agent. AI drafts use the owner's native tool with
// one recorded client consent and a scoped MCP toolbox. The owner reviews the finished draft before handing it over.
import { ChausarError,check,type Context,type State } from '../../contracts.ts';
import { assertAgentDraftCurrent } from '../agent-runtime/native-job.ts';
import { writeCapDenial } from './harness/write-caps.ts';
import { failureWords } from './failure-words.ts';
import { AI_FAILURE_CODES } from '../models/ai-failure.ts';
import { selectAgentRoute } from '../agent-runtime/route.ts';
import { launchAgentWork,runNativeAgent } from '../agent-runtime/runner.ts';
import { voiceRules } from '../agents/voice.ts';
import { jobAgentFor } from '../agents/retired.ts';
import { requireClientAiConsent } from '../clients/ai-consent.ts';
import type {
BlueprintRecord,
CheckResult,ClaimProof,
Deliverable,DeliveryReason,DeliveryRunRecord,
DeliveryRunView,HarnessState,
MicroString,
OrderRecord,PlaybookCheckResult,PlaybookRecord,PriceReceiptRecord,
SignalRecord,
ToolName,ToolCallRecord,
VentureDeps,VentureRecord,
WorkReceiptRecord,WorkTableRecord
} from '../contracts.ts';
import { DELIVERY_REASONS, REQUIRED_SECTIONS } from '../contract-values.ts';
import { blueprintCountry } from '../core/country-history.ts';
import { recordDecision } from '../journal/decisions.ts';
import { localDayAt } from '../local-day.ts';
import { writtenByLine } from '../models/written-by.ts';
import { contractChecks,draftWords,refuseUnsignedContract } from '../money/order-contracts.ts';
import { citationUseFor } from '../playbooks/ca-firm/citations.ts';
import { refusalsOf } from '../playbooks/ca-firm/claims.ts';
import { caOfferFor } from '../playbooks/ca-firm/signoff-gate.ts';
import { regulatedSignoff, regulatedSignoffBlock } from '../playbooks/kit/signoff-gate.ts';
import { diffExplanations } from '../playbooks/ca-firm/signoff.ts';
import { failedPlaybookCheck,runFlagshipChecks,voiceDraftCheck,withQuoteFixes,withVoiceCheck } from '../playbooks/draft-checks.ts';
import { mediaAcceptBlock } from '../playbooks/kit/assets.ts';
import { resolveKit } from '../playbooks/kit/brand-kit.ts';
import { chainOnReview,orderChain } from '../playbooks/kit/chain.ts';
import { requireConfirmedRules } from '../playbooks/kit/rules.ts';
import { attestedRules } from '../playbooks/kit/attestation-records.ts';
import { requireOrderPeopleConsent,todayOf } from '../playbooks/kit/voice-consent.ts';
import { pinSocialOrder,socialVoiceGuard } from '../playbooks/social/chain.ts';
import { keepSocialPostPlan,socialSlotContext } from '../playbooks/social/slots-live.ts';
import { flagshipDelivery } from '../playbooks/steps.ts';
import { copiedTokens,digest,exactPayload,findRecord,identifier,listRecords,plainText,requireAppChannel,ventureAction,type VentureTx } from '../records.ts';
import { recordCheckSignal } from './check-signals.ts';
import { correctDraft,knownNames,ownerSourcesOf,runChecks,withDraftChecks,type CheckInput } from './checks.ts';
import { orderRefs,renderDeliverable,TEMPLATE_OUTLINE_LINE,templateOutline,templateTotal,type DraftRefs,type DraftTimes } from './deliverable.ts';
import { acceptManifest } from './file-manifest.ts';
import { orderUploads,uploadsById } from './harness/env.ts';
import type { FileLike } from './harness/files.ts';
import type { ReceiptCorrection } from './judge/claim-check.ts';
import { ensurePlaybook,flagshipDraft,verifyChecks } from './playbook.ts';
import { loadQuarantineCheck,refuseQuarantined } from './quarantine-gate.ts';
import { landRevision } from './revise.ts';
import { freezeScope,refuseMissingCapability,refuseNewWork } from './run-guards.ts';
import { acceptedBlueprint,newestFirst,optionalFlag,readAs,todayIso,ventureReceipts } from './shared.ts';
import { REPORT_SECTIONS } from './harness/loop.ts';
import { checksWithEdit, editInForce, jobLevelFailure, ownAmounts, OWN_WORDS_AMOUNT, type EditContext } from './owner-edit.ts';
import { agentMayDraft, isLiveStage, isPracticeStage } from '../core/launch-stage.ts';
import { guardedPlaybookChecks } from './trace-scan.ts';
import { playbookForOrder,playbookForRun,type RunPlaybook } from './workflow.ts';

/** 4J1: what each review verdict says in the decision record. */
const REVIEW_DECISION_WORDS: Readonly<Record<'accepted' | 'edited' | 'rejected', string>> = Object.freeze({
  accepted: 'Draft accepted.', edited: 'You edited the draft into your own version.', rejected: 'Draft rejected.',
});

export const STAGE_BLOCKED_REASON = 'Move the business to Practice or Live first.';
export const PRACTICE_REASON = 'This is a practice draft, so it never goes to a client. To use drafts, set How much it asks you to Approve each.';
export const DONE_CLAIM_REASON = 'This draft claims work that was not done. Edit it or reject it.';
export const NO_QUICK_AI = 'No AI serves quick work, so the agent could not use its tools. The reply is written from the message alone.';
/** The judge's line on a run the owner edited: the edit is the owner's own words, which the judge never reads. */
export const JUDGE_EDIT_LINE = "Your edit is your own words, so the quality check does not read it. Any verdict here is on the agent's draft.";
export const JUDGE_READING = 'The quality check is reading this draft. Accept it once its answer is in.';

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
  return judge.status === 'waiting' && judge.auto === true && !judge.line && !!judge.preview;
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
  roomBrief: ReturnType<typeof vaRoomEvidence>;
};

function orderContext(state: State, venture: VentureRecord, orderId: string): OrderContext {
  const order = findRecord(state, 'venture-order', orderId);
  check(order && order.ventureId === venture.id, 'ORDER_NOT_FOUND', 'That order was not found.');
  let blueprint = acceptedBlueprint(state, venture);
  const receipt = findRecord(state, 'venture-price-receipt', order.priceReceiptId);
  check(receipt && receipt.ventureId === venture.id, 'RECEIPT_NOT_FOUND', 'The price receipt for this order was not found.');
  if (venture.originalCountry) {
    const priced = listRecords(state, 'venture-blueprint', venture.id).find(item => item.digest === receipt.inputs.blueprintDigest);
    check(priced, 'RECEIPT_NOT_FOUND', 'The plan that priced this order was not found.');
    blueprint = priced;
    venture = { ...venture, country: blueprintCountry(venture, priced) };
  }
  const client = findRecord(state, 'venture-client', order.clientId);
  const known = knownNames(client?.ventureId === venture.id ? client.name : null, venture.workingName, blueprint.name.value, venture.country.name, ...blueprint.offers.map(offer => offer.name.value));
  // A CA firm offer an older plan kept no playbook id for is read from its own words, so its checks still apply.
  const offerKey = blueprint.offers.find(offer => offer.id === order.offerId)?.playbookOffer ?? caOfferFor(state, venture, order.id)?.id ?? null;
  const ownerWords = [venture.idea, ...(client?.ventureId === venture.id ? [client.name, client.email ?? ''] : []), ...blueprint.offers.map(offer => offer.description.value)];
  return { venture, blueprint, order, receipt, receipts: ventureReceipts(state, venture.id), known, offerKey, ownerWords,roomBrief:vaRoomEvidence(state,venture.id,order.id) };
}

/**
 * A flagship playbook's own checks on a draft (playbooks/draft-checks.ts), after the harness checks; undefined for
 * the eight fixed steps. The finishing check reads a cut on this computer, so the hosted server never runs it. The CA
 * firm calculator's refusals among the run's tool calls go with them, so a refused working fails, do not retry. The
 * tables the run's tools made and its tool calls go too, for the checks that read them. An order whose signed contract
 * protects anything gets the contract's check last, on the eight fixed steps too (4J12).
 */
async function flagshipChecks(deps: VentureDeps, context: OrderContext, playbook: PlaybookRecord, deliverable: Deliverable, servedBy: 'model' | 'template', extras: { runId?: string; work?: readonly WorkReceiptRecord[]; tables?: readonly WorkTableRecord[]; files?: readonly FileLike[]; harness?: HarnessState; toolCalls?: readonly ToolCallRecord[] } = {}): Promise<PlaybookCheckResult[] | undefined> {
  (await import('../playbooks/podcast-to-article/run-guard.ts')).refuseArticleDraft(deps.store.read(), context.venture, context.order, deps.clock().toISOString());
  refuseYoutubeDraft(deps.store.read(),context.venture,context.order,deps.clock().toISOString(),(extras.toolCalls ?? extras.harness?.toolCalls));
  // Ink v2 wave 4 (4J12, H24): a signed order contract's protected items, on every playbook's drafts, after its own.
  const contract = contractChecks(deps.store.read(), context.venture, context.order.id, { text: draftWords(deliverable), ...(extras.files ? { files: extras.files.map(file => ({ name: file.name, digest: file.digest })) } : {}) });
  // Ink v2 wave 4 (4J17, A8): the owner's voice, by code, on every playbook's drafts; it only ever adds a result.
  const voice = servedBy === 'template' ? null : voiceDraftCheck(deliverable, voiceRules(deps.store.read(), context.venture), playbook.flagship ?? null);
  if (!playbook.flagship) return withVoiceCheck(contract.length ? contract : undefined, voice);
  const checkInput = {
    ...(playbook.flagship==='app-testing'?{testingEvidence:testingRunSource(deps.store.read(),context.venture.id,context.order.id,deps.clock().toISOString())}:{}),
    ...(playbook.flagship==='phone-receptionist'?{phoneReport:phoneRunSource(deps.store.read(),context.venture.id,context.order.id).report}:{}),
    ...(playbook.flagship==='monitored-data'?{watchReport:watchStateSource(deps.store.read(),context.venture.id,context.order.id,deps.clock().toISOString())}:{}),
    ...(playbook.flagship==='it-triage'?{triageReport:triageStateSource(deps.store.read(),context.venture.id,context.order.id,deps.clock().toISOString())}:{}),
    ...(playbook.flagship==='dev-agency'?{devReport:devStateSource(deps.store.read(),context.venture.id,context.order.id,deps.clock().toISOString(),true).report}:{}),
    ...(playbook.flagship==='data-entry-desk'?{formsEntries:formsRunSource(deps.store.read(),context.venture.id,context.order.id).rows}:{}),
    ...(playbook.flagship==='virtual-assistant'?{roomBrief:vaRoomEvidence(deps.store.read(),context.venture.id,context.order.id)}:{}),
    ...(playbook.flagship==='job-search-desk'?{careerPack:careerRunSource(deps.store.read(),context.venture.id,context.order.id)}:{}),
    ...(playbook.flagship==='tender-desk'?{tenderRows:(await (await import('../playbooks/tender-desk/run-source.ts')).tenderRunSource(deps,context.venture.id,context.order.id,true)).rows}:{}),
    ...(playbook.flagship==='narration-studio'?{narrationRows:(await (await import('../playbooks/narration-studio/run-source.ts')).narrationRunSource(deps,context.venture.id,context.order.id,true)).rows}:{}),
    ...(playbook.flagship==='website-studio'?{siteProject:listRecords(deps.store.read(),'venture-site-requirement',context.venture.id).filter(row=>row.orderId===context.order.id&&row.clientId===context.order.clientId).at(-1)??null}:{}),
    ...(playbook.flagship==='newsletter-studio'?{newsletterIssue:listRecords(deps.store.read(),'venture-newsletter-issue',context.venture.id).filter(row=>row.orderId===context.order.id&&row.clientId===context.order.clientId).at(-1)??null}:{}),
    ...(playbook.flagship==='podcast-to-article'?{articleRecord:listRecords(deps.store.read(),'venture-article-ledger',context.venture.id).find(row=>row.orderId===context.order.id&&row.clientId===context.order.clientId)??null}:{}),
    flagship: playbook.flagship, offerKey: context.offerKey, stageId:flagshipDraft(playbook,context.offerKey,context.order.intake??null,context.order.chainStage??null)?.stepId, servedBy, deliverable, request: context.order.request, intake: context.order.intake ?? null,
    brandKit: resolveKit(deps.store.read(), context.venture, context.order.clientId),
    socialSlotContext: socialSlotContext(deps.store.read(), context.venture, context.order, deps.clock().toISOString(), extras.runId ?? null),
    files: extras.files ?? [], receipts: [...context.receipts, ...(extras.work ?? [])], known: context.known, mode: 'client' as const,
    today: todayIso(deps, context.venture), dateOrder: context.venture.country.dateOrder, ...(deps.host === 'hosted-web' ? { finishing: null } : {}),
    refusals: refusalsOf((extras.toolCalls ?? extras.harness?.toolCalls) ?? []),
    tables: extras.tables ?? [], toolCalls: (extras.toolCalls ?? extras.harness?.toolCalls) ?? [],
    // The CA's explanations of portal differences, so one recorded while the run waited counts now (Ink v2 2A2).
    caExplanations: diffExplanations(deps.store.read(), context.venture.id),
    caHealthReviews: listRecords(deps.store.read(),'venture-ca-working',context.venture.id).filter(row=>row.mode==='health'),
    caCitationUse: citationUseFor(deps.store.read(), context.venture.id, 'client'),
    // W6 6C5: the owner's standing rule attestations, read by the kit checks' rule gate.
    attestedRules: attestedRules(deps.store.read(), context.venture.id),
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
  if(context.roomBrief)refs.dates.push({ref:'room.deadline',label:'The deadline in the approved client brief',iso:context.roomBrief.fields.deadline});
  const offer = context.blueprint.offers.find(item => item.id === context.order.offerId);
  return { refs, offer: { name: offer?.name.value ?? 'Your service', description: offer?.description.value ?? 'The service in your plan.' } };
}

/** Saved approved scope is evidence in the preview, never a new instruction from a caller. */
function approvedRoomRequest(context:OrderContext){const brief=context.roomBrief;return brief?context.order.request+'\nApproved room scope: '+brief.fields.scope+'\nApproved deliverable: '+brief.fields.deliverable+'\nUse room.deadline for the agreed deadline and order.total for the owner price.':context.order.request;}

type DraftCheckExtras = {
  outputFiles?: readonly {id:string;name:string;digest:string}[];
  work?: readonly WorkReceiptRecord[]; proofs?: readonly ClaimProof[]; sections?: readonly string[]; answers?: readonly string[];
  harness?: HarnessState | null; toolCalls?: readonly ToolCallRecord[]; files?: readonly FileLike[]; corrections?: readonly ReceiptCorrection[];
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
  if(context.roomBrief)extras={...extras,answers:[...(extras.answers??[]),context.roomBrief.fields.scope,context.roomBrief.fields.deliverable,context.roomBrief.fields.deadline]};
  return {
    // A playbook stored before the receipts and prompt-leak checks never lists them; every draft runs them anyway.
    checks: withDraftChecks(verifyChecks(playbook)), deliverable, renderedText, serviceType: context.blueprint.serviceType, flagship: playbook.flagship ?? null,
    ...(extras.corrections?.length ? { corrections: extras.corrections } : {}),
    allowed: [...copiedTokens(context.order.request, context.venture.idea, ...(extras.answers ?? [])),...(playbook.flagship==='ca-firm'?caNamedTokens((extras.toolCalls ?? extras.harness?.toolCalls)??[],extras.files??[]):[])], receipts: [...context.receipts, ...(extras.work ?? [])], ventureId: context.venture.id,
    mocks: [], mockModes: {}, agentTurns: 1, turnLimit: 1, askedQuestions: deliverable.questionsForClient.length > 0,
    ...(extras.sections ? { sections: extras.sections } : {}), ...(extras.proofs ? { proofs: extras.proofs } : {}), ...(extras.times ? { times: extras.times } : {}),
    grounding: {
      codeSources: (extras.toolCalls ?? []).filter(call => call.envelope.ok).map(call => ({ id: call.id, text: JSON.stringify(call.envelope.ok ? call.envelope.result : '') })),
      clientRequest: context.order.request, answers: extras.answers ?? [], harness: extras.harness ?? null, files: extras.files ?? [], outputFiles: extras.outputFiles??[],
      known: context.known, dateOrder: context.venture.country.dateOrder, ownerWords: context.ownerWords,
      ownerSources: ownerSourcesOf([context.venture.workingName, context.blueprint.name.value], playbook),
    },
  };
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
    ...(playbook.flagship==='dev-agency'?{devReportBinding:devStateSource(tx.state,tx.venture!.id,order.id,tx.now,true).report.digest}:{}),
    ...(playbook.flagship==='data-entry-desk'?{formsSourceBinding:formsRunSource(tx.state,tx.venture!.id,order.id).binding}:{}),
    ...(playbook.flagship==='virtual-assistant'?{vaBriefBinding:vaRunSource(tx.state,tx.venture!.id,order.id).digest}:{}),
    ...(playbook.flagship==='app-testing'?{appTestingBinding:testingRunSource(tx.state,tx.venture!.id,order.id,tx.now).binding}:{}),
    ...(playbook.flagship==='phone-receptionist'?{phoneReportBinding:phoneRunSource(tx.state,tx.venture!.id,order.id).report.digest}:{}),
    ...(playbook.flagship==='monitored-data'?{watchReportBinding:watchStateSource(tx.state,tx.venture!.id,order.id,tx.now).digest}:{}),
    ...(playbook.flagship==='it-triage'?{triageReportBinding:triageStateSource(tx.state,tx.venture!.id,order.id,tx.now).digest}:{}),
    scope: freezeScope(tx.state, tx.venture!, grant, capMicros, tx.now),
    // Ink v2 wave 5 (5A1): the chain stage this run drafts, once a kit chain order is past its first (playbooks/kit/chain.ts).
    ...(order.chainStage ? { chainStage: order.chainStage } : {}),
  };
}

/** venture.delivery.run: a template outline at any stage, or an agent draft waiting for the owner to approve the send. */
export async function deliveryRunHandler(deps: VentureDeps, ctx: Context, payload: unknown, continuation: { resumeFrom?: string } = {}): Promise<DeliveryRunView> {
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
  (await import('../playbooks/social/run-guard.ts')).refuseSocialDraft(state, venture, order, todayOf(venture, deps.clock()));
  // 5A4 (P9): everyone the order names as seen or heard still has their consent, at every run (a chain's next stage too).
  requireOrderPeopleConsent(state, venture, order, todayOf(venture, deps.clock()));
  // Ink v2 wave 5 (5A3): a client order on a kit offer starts nothing, before any preview or spend, while a rule its
  // stages or the playbook's checks rest on waits for a CA or lawyer (RULE_UNCONFIRMED). The check-time gate stays as a backstop.
  const chain = orderChain(state, venture, order);
  if(chain?.definition.registration.id==='app-testing')testingRunSource(state,venture.id,order.id,deps.clock().toISOString());
  if(chain?.definition.registration.id==='phone-receptionist')phoneRunSource(state,venture.id,order.id);
  if(chain?.definition.registration.id==='monitored-data')watchStateSource(state,venture.id,order.id,deps.clock().toISOString());
  if(chain?.definition.registration.id==='it-triage')triageStateSource(state,venture.id,order.id,deps.clock().toISOString());
  if(chain?.definition.registration.id==='dev-agency')devStateSource(state,venture.id,order.id,deps.clock().toISOString(),true);
  if(chain?.definition.registration.id==='data-entry-desk')formsRunSource(state,venture.id,order.id);
  if(chain?.definition.registration.id==='virtual-assistant')vaRunSource(state,venture.id,order.id);
  if(chain?.definition.registration.id==='job-search-desk')careerRunSource(deps.store.read(),venture.id,order.id);
  if(chain?.definition.registration.id==='tender-desk')await (await import('../playbooks/tender-desk/run-source.ts')).tenderRunSource(deps,venture.id,order.id,true);
  if(chain?.definition.registration.id==='narration-studio')await (await import('../playbooks/narration-studio/run-source.ts')).narrationRunSource(deps,venture.id,order.id,true);
  if(chain?.definition.registration.id==='website-studio')check(order.intake?.fields?.private!==true,'PRIVATE_NEEDS_LOCAL','Private website source needs a qualified local model. Review it manually meanwhile.');
    if(chain?.definition.registration.id==='newsletter-studio')check(order.intake?.fields?.private!==true,'PRIVATE_NEEDS_LOCAL','Private source notes need a qualified local model. Write the issue manually meanwhile.');
  if(chain?.definition.registration.id==='translation-studio')check(order.intake?.fields?.private===false,'PRIVATE_NEEDS_LOCAL','This private job needs a local model. Use the local review sheet meanwhile.');
  if (chain) requireConfirmedRules(chain.definition.rules, [...chain.offer.stages, ...chain.definition.checkIds], 'client', attestedRules(state, venture.id));
  // Decide before any preview, so a blocked request records nothing.
  const status = useTemplate ? null : deps.models.status(ctx);
  const template = ['dev-agency','job-search-desk','phone-receptionist','app-testing','monitored-data','it-triage'].includes(chain?.definition.registration.id??'') || useTemplate || status!.tiers.main.presetId === 'built-in-templates';
  if (!template) requireClientAiConsent(state, venture.id, order.clientId);
  check(!template||!order.socialChain,'NOT_BUILT_YET','Social writing stages need an AI draft. Connect your AI and start this stage again.');
  if (!template) check(agentStage(venture.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  const basePlaybook = await ensurePlaybook(deps, ctx);
  // 4F1 (O21): an agent step that needs a connector only planned refuses the run; nothing is put in its place.
  await refuseMissingCapability(basePlaybook);
  const fresh = readAs(deps, ctx, 'prepare');
  const context = orderContext(fresh.state, fresh.venture, orderId);
  const playbook = playbookForOrder(deps, ctx, fresh.state, fresh.venture, basePlaybook, context.order, context.offerKey);
  if (chain) requireConfirmedRules(chain.definition.rules, [...playbook.steps.map(step => step.id), ...chain.definition.checkIds], 'client', attestedRules(fresh.state, fresh.venture.id));
  if (playbook.flagship === 'seo-visibility' && ['content-retainer','local-seo'].includes(context.offerKey ?? '')) (await import('../playbooks/seo-visibility/article-budget.ts')).articleLimitMicros(context.order.intake?.fields?.articleLimitUsd);
  const { refs } = draftContext(context, todayIso(deps, context.venture));
  const uploads = orderUploads(fresh.state, fresh.venture.id, orderId);
  if(playbook.flagship==='online-seller') (await import('../playbooks/online-seller/report-source.ts')).sellerReportSource(context.order,context.offerKey,uploads,todayIso(deps, context.venture));
  if (!template) {
    const denied=writeCapDenial(fresh.state,fresh.venture,'drafts',deps.clock().toISOString());
    check(!denied,denied?.code??'WRITE_CAP_REACHED',denied?.reason??'The daily draft limit was reached.');
    return startToolOwnedDelivery(deps, ctx, context, playbook, uploads, continuation);
  }
  const socialGuard=await socialVoiceGuard();
  const socialSnapshot=(state:State,venture:VentureRecord)=>JSON.stringify({order:findRecord(state,'venture-order',orderId),uploads:orderUploads(state,venture.id,orderId)});
  const formsBefore=playbook.flagship==='data-entry-desk'?formsRunSource(fresh.state,fresh.venture.id,orderId).binding:null;
  const socialBefore=context.order.socialChain?socialSnapshot(fresh.state,fresh.venture):null;
  const fenceSocialPreview=(tx:VentureTx)=>{if(formsBefore)check(formsRunSource(tx.state,tx.venture!.id,orderId).binding===formsBefore,'FORM_SOURCE_CHANGED','The source changed while the preview was prepared.');if(socialBefore===null)return;check(socialBefore===socialSnapshot(tx.state,tx.venture!),'APPROVAL_STALE','The order or its sources changed. Start again and read the new preview.');socialGuard(tx.state,tx.venture!,tx.find('venture-order',orderId)!);};
    const watch=playbook.flagship==='monitored-data'?watchStateSource(deps.store.read(),venture.id,order.id,deps.clock().toISOString()):null;
    const triage=playbook.flagship==='it-triage'?triageStateSource(deps.store.read(),venture.id,order.id,deps.clock().toISOString()):null;
    const testing=playbook.flagship==='app-testing'?testingRunSource(deps.store.read(),venture.id,order.id,deps.clock().toISOString()):null;
    const phone=playbook.flagship==='phone-receptionist'?phoneRunSource(deps.store.read(),venture.id,order.id):null;
    const dev=playbook.flagship==='dev-agency'?devStateSource(deps.store.read(),venture.id,order.id,deps.clock().toISOString(),true):null;
    const career=playbook.flagship==='job-search-desk'?careerRunSource(deps.store.read(),venture.id,order.id):null;
    const forms=playbook.flagship==='data-entry-desk'?formsRunSource(deps.store.read(),venture.id,order.id):null;
    const va=playbook.flagship==='virtual-assistant'?vaRunSource(deps.store.read(),venture.id,order.id):null;
    const deliverable = watch?watchDelivery(watch):triage?triageDelivery(triage):testing?testingDeliverable(testing):forms?formsDeliverable(forms.rows,order.chainStage):phone?phoneDelivery(phone.report):dev?devDelivery(dev.report):career?careerPackDeliverable(career.text):va?vaBriefDeliverable(va):templateOutline(context.blueprint.serviceType, templateTotal(refs, 'order.total'));
    const renderedText = testing||forms||phone||dev||watch||triage?renderDeliverable(deliverable,context.receipts,context.venture.country):career?career.text:`${TEMPLATE_OUTLINE_LINE}\n\n${renderDeliverable(deliverable, context.receipts, context.venture.country)}`;
    const checks = checkDraft(context, playbook, deliverable, renderedText,watch||triage?{sections:deliverable.sections.map(s=>s.heading),answers:deliverable.sections.flatMap(s=>s.parts.flatMap(p=>p.kind==='text'?[p.text]:[]))}:testing?{sections:['Reviewed evidence'],answers:[testing.text],outputFiles:testing.files}:forms?{sections:deliverable.sections.map(section=>section.heading),answers:deliverable.sections.flatMap(section=>section.parts.flatMap(part=>part.kind==='text'?[part.text]:[]))}:phone?{sections:['Call script','Call review'],answers:deliverable.sections.flatMap(s=>s.parts.flatMap(p=>p.kind==='text'?[p.text]:[]))}:dev?{sections:['Review'],answers:[...deliverable.sections.flatMap(s=>s.parts.flatMap(p=>p.kind==='text'?[p.text]:[]))]}:career?{sections:['Approved evidence'],answers:[career.text]}:va?{sections:['Brief','Work notes'],answers:[va.fields.scope,va.fields.deliverable,va.fields.deadline]}:{});
    const playbookChecks = await flagshipChecks(deps, context, playbook, deliverable, 'template');
    return ventureAction(deps, ctx, 'prepare', 'delivery.run', tx => {
      fenceSocialPreview(tx);
      if(testing)check(testingRunSource(tx.state,tx.venture!.id,order.id,tx.now).binding===testing.binding,'APPROVAL_STALE','The reviewed report or video changed. Start again.');
      if(phone)check(phoneRunSource(tx.state,tx.venture!.id,order.id).report.digest===phone.report.digest,'DERIVED_STALE','The call report changed. Start again.');
      if(watch)check(watchStateSource(tx.state,tx.venture!.id,order.id,tx.now).digest===watch.digest,'DERIVED_STALE','The monitored source evidence changed. Start again.');
      if(triage)check(triageStateSource(tx.state,tx.venture!.id,order.id,tx.now).digest===triage.digest,'DERIVED_STALE','The approved channel summary changed. Start again.');
      if(career)check(careerRunSource(tx.state,tx.venture!.id,order.id).sourceBinding===career.sourceBinding,'CAREER_SOURCE_CHANGED','The career pack changed during preparation.');
      if(dev)check(devStateSource(tx.state,tx.venture!.id,order.id,tx.now,true).report.digest===dev.report.digest,'DERIVED_STALE','The source report changed. Start again.');
      if(va)vaRunSource(tx.state,tx.venture!.id,order.id,va.digest);
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

/** A2: what the run says when the watchdog stopped a quiet job (one place: harness/controls.ts). */
export { QUIET_LINE, TIME_LINE } from './harness/controls.ts';
import { watchdogLine } from './harness/controls.ts';

/** The installed AI owns its turns. Chausar keeps the job's sources, checks and exact outside-action proposal. */
async function startToolOwnedDelivery(deps: VentureDeps, ctx: Context, context: OrderContext, playbook: PlaybookRecord, uploads: FileLike[], continuation: { resumeFrom?: string; existingRunId?: string }): Promise<DeliveryRunView> {
  const draft = flagshipDraft(playbook, context.offerKey, context.order.intake ?? null, context.order.chainStage ?? null);
  const sections = draft?.sections ?? REQUIRED_SECTIONS[context.blueprint.serviceType];
  const stepId = draft?.stepId ?? playbook.steps.find(step => step.kind === 'write')?.id;
  const role = (stepId && flagshipDelivery(playbook.flagship ?? null)?.roleOf[stepId]) || 'delivery';
  // W6 6G2: a retired role's new work runs as the agent that took it over (the team's own settings when the owner did).
  const agentId = role === 'delivery' ? role : jobAgentFor(deps.store.read(), context.venture.id, role);
  const revisionIdentity = (run: DeliveryRunRecord) => digest(run.revision ? { ...run.revision, callId: '' } : null);
  const expectedRevision = continuation.existingRunId
    ? revisionIdentity(findRun(deps.store.read(), context.venture, continuation.existingRunId)) : null;
  const route = await selectAgentRoute(deps, ctx, agentId, context.blueprint.serviceType === 'research');
  const run = continuation.existingRunId ? findRun(deps.store.read(), context.venture, continuation.existingRunId) : await ventureAction(deps, ctx, 'prepare', 'delivery.run', tx => {
    requireClientAiConsent(tx.state, tx.venture!.id, context.order.clientId);
    const current = orderContext(tx.state, tx.venture!, context.order.id);
    check(agentStage(tx.venture!.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
    const run: DeliveryRunRecord = { ...baseRun(tx, current.order, playbook, [], '0'), status: 'waiting-for-you', servedBy: 'model',
      practice: !isLiveStage(tx.venture!.launchStage), callId: null, preview: null, deliverable: null, renderedText: null,
      checks: [], uploadIds: uploads.map(file => file.id) };
    tx.put(run); tx.emit('run.started', { runId: run.id }); return run;
  });
  check(run.status === 'waiting-for-you' && !run.verdict
    && (expectedRevision === null || revisionIdentity(run) === expectedRevision), 'JOB_CLOSED', 'This AI job is no longer waiting to start.');
  launchAgentWork(deps.store, run.id, async () => {
    try {
      const result = await runNativeAgent(deps, ctx, run.id, {
        agentId, sections: [...sections], ...(continuation.resumeFrom ? { resumeFrom: continuation.resumeFrom } : {}),
        check(state, current) {
          check(expectedRevision === null || revisionIdentity(current) === expectedRevision, 'JOB_CLOSED', 'This requested revision changed before it finished.');
          const venture = listRecords(state, 'venture-record').find(row => row.id === current.ventureId)!;
          const order = findRecord(state, 'venture-order', current.orderId)!;
          check(venture && agentStage(venture.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
          refuseNewWork(state, venture, ctx, deps.clock().toISOString());
          refuseQuarantined(state, venture, deps.clock().toISOString());
          refuseUnsignedContract(state, venture, order);
          vaRunCurrent(state, venture.id, current);
          formsRunCurrent(state, venture.id, current);
          requireOrderPeopleConsent(state, venture, order, todayOf(venture, deps.clock()));
          const chain = orderChain(state, venture, order);
          if (chain) requireConfirmedRules(chain.definition.rules, [...playbook.steps.map(step => step.id), ...chain.definition.checkIds], 'client', attestedRules(state, venture.id));
          check(playbookForRun(state, current)?.hash === playbook.hash, 'JOB_SOURCE_CHANGED', 'The work plan changed. Start a new job.');
        },
        async checkDraft(state, current, saved, sourceNet) {
          const venture = listRecords(state, 'venture-record').find(row => row.id === current.ventureId)!;
          const source = orderContext(state, venture, current.orderId);
          const evidence = { sections, runId: current.id, files: uploadsById(state, venture.id, current.uploadIds ?? []),
            work: listRecords(state, 'venture-work-receipt', venture.id).filter(row => row.runRef.kind === 'delivery' && row.runRef.runId === current.id),
            tables: listRecords(state, 'venture-work-table', venture.id).filter(row => row.runRef.kind === 'delivery' && row.runRef.runId === current.id),
            toolCalls: current.agentJob?.calculations ?? [] };
          const checkedEvidence={...evidence,times:playbook.flagship==='youtube'?youtubeWorked(evidence.toolCalls,evidence.tables).times:null};
          return { checks: checkDraft(source, playbook, saved.deliverable, saved.renderedText, checkedEvidence),
            playbookChecks: await flagshipChecks(playbook.flagship==='seo-visibility'?{...deps,net:sourceNet}:deps, source, playbook, saved.deliverable, 'model', evidence) };
        },
      }, route);
      await ventureAction(deps, ctx, 'prepare', 'agent.job.finished', tx => {
        const latest = tx.find('venture-delivery-run', run.id);
        // A2: a failure the AI tool named (a used-up plan, its step limit and the like) is the run's failure, with its fix.
        const named = result.status === 'failed' && result.failure
          ? failureWords({ code: AI_FAILURE_CODES[result.failure], message: result.error ?? '' }, { at: tx.now, dateOrder: context.venture.country.dateOrder }) : null;
        // A2: a job that went quiet was stopped by the watchdog; its notes so far stay, and the line says so.
        const quietLine = watchdogLine(result);
        if (latest && ['waiting-for-you', 'ready-for-review'].includes(latest.status) && result.status !== 'completed') {
          tx.replace({ ...latest, status: result.status === 'interrupted' ? 'stopped' : 'failed',
            ...(latest.agentJob ? { agentJob: { ...latest.agentJob, reviewReady: false, ...(named ? { failure: named } : {}), ...(result.quiet ? { quiet: true } : {}), ...(result.quiet && result.overtime ? { overtime: true } : {}) } } : {}) });
          tx.emit('run.failed', { runId: run.id, line: quietLine ?? named?.line ?? 'The AI stopped before finishing this draft. Read its work notes before starting again.' });
          tx.emit('queue.changed', {});
          return;
        }
        if (latest?.status === 'ready-for-review' && latest.revision && latest.renderedText) {
          tx.replace({ ...latest, ...landRevision(latest, { renderedText: latest.renderedText, checks: latest.checks, playbookChecks: latest.playbookChecks }, tx.now) });
          tx.emit('run.step', { runId: run.id });
          return;
        }
        if (!latest || latest.status !== 'waiting-for-you') return;
        tx.replace({ ...latest, status: result.status === 'interrupted' ? 'stopped' : 'failed', ...(named && latest.agentJob ? { agentJob: { ...latest.agentJob, failure: named } } : {}) });
        tx.emit('run.failed', { runId: run.id, line: named?.line ?? 'The AI stopped without a checked draft. Read its work notes before starting again.' });
      });
      if (result.status === 'completed') {
        const judge = await import('./judge-run.ts');
        await judge.autoJudge(deps, ctx, { id: run.id }).catch(() => undefined);
        await ventureAction(deps, ctx, 'prepare', 'agent.job.reviewReady', tx => {
          const current = tx.find('venture-delivery-run', run.id);
          if (!current?.agentJob || current.status !== 'ready-for-review' || current.verdict) return;
          assertAgentDraftCurrent(tx.state, current);
          tx.replace({ ...current, agentJob: { ...current.agentJob, reviewReady: true } });
          tx.emit('run.step', { runId: run.id }); tx.emit('queue.changed', {});
        });
        await import('../playbooks/ca-firm/delivery-signoff.ts').then(module => module.requestSignoffForRun(deps, ctx, run)).catch(() => null);
      }
    } catch (error) {
      await ventureAction(deps, ctx, 'prepare', 'agent.job.failed', tx => {
        const latest = tx.find('venture-delivery-run', run.id);
        if (!latest || !['waiting-for-you', 'ready-for-review'].includes(latest.status)) return;
        const code = error instanceof ChausarError ? error.code : 'MODEL_FAILED';
        const details = error instanceof ChausarError && 'details' in error ? error.details : null;
        const cause = details && typeof details === 'object' && 'cause' in details && details.cause === 'not-connected' ? 'not-connected' : undefined;
        const failureContext = { at: tx.now, dateOrder: context.venture.country.dateOrder };
        const failure = failureWords({ code, message: error instanceof Error ? error.message : '', ...(cause ? { cause } : {}) }, failureContext)
          ?? failureWords({ code: 'MODEL_FAILED', message: '' }, failureContext)!;
        tx.replace({ ...latest, status: 'failed', ...(latest.agentJob ? { agentJob: { ...latest.agentJob, failure } } : {}) });
        tx.emit('run.failed', { runId: run.id, line: failure.line });
      }).catch(() => undefined);
    }
  });
  return runView(run, context.venture, deps.clock().getTime(), deps.store.read());
}

/** Restart an owner-revised draft through the same scoped driver, with no per-turn preview. */
export async function restartNativeDelivery(deps: VentureDeps, ctx: Context, runId: string): Promise<DeliveryRunView> {
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const run = findRun(state, venture, runId);
  check(run.revision, 'JOB_CLOSED', 'This draft has no requested AI revision.');
  const order = findRecord(state, 'venture-order', run.orderId);
  check(order, 'ORDER_NOT_FOUND', 'This order was not found.');
  requireClientAiConsent(state, venture.id, order.clientId);
  const playbook = playbookForRun(state, run);
  check(playbook, 'PLAYBOOK_NOT_FOUND', 'The work instructions for this draft were not found.');
  return startToolOwnedDelivery(deps, ctx, orderContext(state, venture, run.orderId), playbook,
    uploadsById(state, venture.id, run.uploadIds ?? []), { existingRunId: runId });
}

/**
 * answers: the owner's answers to earlier hand-offs; tokens copied from them may be repeated, like the request's.
 * delegate: the owner's command-line tools found and checked now; agent.delegate is offered only with one.
 */
function findRun(state: State, venture: VentureRecord, runId: string): DeliveryRunRecord {
  const run = findRecord(state, 'venture-delivery-run', runId);
  check(run && run.ventureId === venture.id, 'DELIVERY_NOT_FOUND', 'That draft reply was not found.');
  return run;
}

/** The stages at which an agent may draft for a real order. Moving down is always allowed, so each step checks again. */
export function agentStage(stage: VentureRecord['launchStage']): boolean {
  // 6C4: Practice (the old rehearsal or shadow) and Live; never the hidden unfinished stages.
  return agentMayDraft(stage);
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
    if (verdict !== 'rejected') check(!run.agentJob || run.agentJob.reviewReady === true, 'DELIVERY_NOT_READY', 'AI work must finish before you can approve this draft.');
    if (verdict !== 'rejected') assertAgentDraftCurrent(tx.state, run);
    // One-shot A3 review (M1): an owner's edit from Today, then accepted, is the owner's own words as an edited verdict is,
    // so each desk's no-edit rule holds for it too.
    const ownWords = verdict === 'edited' || (verdict === 'accepted' && typeof run.editedText === 'string');
    if(verdict!=='rejected'&&run.appTestingBinding){testingRunCurrent(tx.state,tx.venture!.id,run,tx.now);check(!ownWords,'APPROVAL_STALE','Revise the evidence in the testing desk and start Work again.');}
    if(verdict!=='rejected'&&run.watchReportBinding)check(watchStateSource(tx.state,tx.venture!.id,run.orderId,tx.now).digest===run.watchReportBinding&&!ownWords,'DERIVED_STALE','Review current measured sources in the monitored desk and prepare a new report.');
    if(verdict!=='rejected'&&run.triageReportBinding)check(triageStateSource(tx.state,tx.venture!.id,run.orderId,tx.now).digest===run.triageReportBinding&&!ownWords,'DERIVED_STALE','Review current source excerpts in the triage desk and prepare a new report.');
    if(verdict!=='rejected'&&run.phoneReportBinding){const report=phoneRunSource(tx.state,tx.venture!.id,run.orderId).report;check(report.digest===run.phoneReportBinding&&!ownWords,'DERIVED_STALE','Revise the approved script or imported evidence in the receptionist desk and prepare a new report.');}
    if(verdict!=='rejected'&&run.devReportBinding){const report=devStateSource(tx.state,tx.venture!.id,run.orderId,tx.now,true).report;check(report.digest===run.devReportBinding&&!ownWords,'DERIVED_STALE','Revise the source evidence in the developer desk and prepare a new report.');}
    if(verdict!=='rejected'){vaRunCurrent(tx.state,tx.venture!.id,run);formsRunCurrent(tx.state,tx.venture!.id,run);if(run.formsSourceBinding)check(!ownWords,'FORM_SOURCE_CHANGED','Revise source evidence in the data-entry desk and start a new draft.');}
    if(verdict!=='rejected'&&playbookForRun(tx.state,run)?.flagship==='job-search-desk'){const source=careerRunCurrent(tx.state,tx.venture!.id,run,tx.now,true)!;check(!ownWords||(verdict==='edited'?editedText:run.editedText)===source.text,'CAREER_CLAIM_BOUNDARY','Revise the evidence in the career desk and approve a new rendered pack.');}
    if(verdict!=='rejected'&&playbookForRun(tx.state,run)?.flagship==='tender-desk')await (await import('../playbooks/tender-desk/run-source.ts')).tenderRunSource(deps,tx.venture!.id,run.orderId,true);
    if(verdict!=='rejected'&&playbookForRun(tx.state,run)?.flagship==='narration-studio')await (await import('../playbooks/narration-studio/run-source.ts')).narrationRunSource(deps,tx.venture!.id,run.orderId,true);
    if(verdict!=='rejected'){const order=tx.find('venture-order',run.orderId);if(order)voiceGuard(tx.state,tx.venture!,order);}
    if(verdict!=='rejected'){const order=tx.find('venture-order',run.orderId);if(order)refuseYoutubeDraft(tx.state,tx.venture!,order,tx.now,run.harness?.toolCalls);}
    // An agent draft is a practice draft unless the business is at approve each now: moving down is the owner's
    // safety lever, so a draft approved earlier can't be accepted, and an edit made now can't be copied.
    const practice = run.practice || (run.servedBy === 'model' && tx.venture!.launchStage !== 'approve-each');
    check(!(practice && verdict === 'accepted'), 'PRACTICE_DRAFT', PRACTICE_REASON);
    if (verdict === 'accepted') {
      // One-shot A3 (S2): the owner's own edit in force is held to the word checks; the agent's draft to all of its own.
      acceptableAsIs(checksInForce(tx.state, run), run.playbookChecks);
      check(!judgeReading(run, Date.parse(tx.now)), 'INVALID_VENTURE_REQUEST', JUDGE_READING);
      // Regulated papers (the CA firm's, and every sign-off desk output, W6 6E5) are accepted only once the professional of
      // record signed this exact draft (playbooks/kit/signoff-gate.ts).
      const unsigned = regulatedSignoff(tx.state, tx.venture!, run);
      if (unsigned) throw new ChausarError(unsigned.code, unsigned.line);
      // 5A4: a file it hands over with no known licence, stale, held, made with withdrawn consent, or not made yet.
      const media = mediaAcceptBlock(tx.state, tx.venture!, run, tx.now);
      if (media) throw new ChausarError(media.code, media.line);
    }
    // 4J1 (J2): Accept or an edit binds the files the draft hands over, by the sha256 of their bytes, to whoever decided.
    const manifest = verdict !== 'rejected' ? acceptManifest(tx.state, run, tx.now, ctx.memberId) : null;
    const orderBefore = verdict === 'rejected' ? JSON.stringify(tx.find('venture-order', run.orderId) ?? null) : '';
    const next: DeliveryRunRecord = {
      // C4 task 15: what a reject changes, for its Undo.
      ...(verdict === 'rejected' ? { rejectedFrom: { verdict: run.verdict ?? null, editedText: run.editedText ?? null, practice: run.practice } } : {}),
      // 4J1: Accept of a draft the owner edited and that came back for review keeps the owner's words (draft-text.ts).
      ...run, status: verdict, practice, verdict: { choice: verdict, reason, at: tx.now }, editedText: verdict === 'accepted' ? run.editedText ?? null : editedText,
      // The owner's edit is the owner's own words: the judge never reads it, and its line says so (judge-run.ts).
      ...(verdict === 'edited' && run.judge ? { judge: { ...run.judge, line: JUDGE_EDIT_LINE } } : {}),
      ...(manifest ? { manifest } : {}),
    };
    tx.replace(next);
    keepSocialPostPlan(tx,next);
    // 4J1 (O17): who decided and when, wherever the owner reviewed it (Today, Work or the run sheet).
    // A3 review 2 (M-c): an amount the editor wrote themself is theirs, and the decision says so.
    const ownWordsAmount = verdict === 'accepted' && ownAmounts(checksInForce(tx.state, run));
    recordDecision(tx, { subject: `run:${runId}`, action: verdict, who: ctx.role === 'owner' ? 'owner' : 'cofounder', ruleId: null, reason: ownWordsAmount ? `${REVIEW_DECISION_WORDS[verdict]} ${OWN_WORDS_AMOUNT}` : REVIEW_DECISION_WORDS[verdict], rowId: null });
    if (verdict !== 'accepted') {
      const signal: SignalRecord = { ...tx.base('venture-signal'), source: verdict === 'edited' ? 'owner-edited' : 'owner-rejected', runId, reason, scenarioId: null };
      tx.put(signal);
      tx.emit('signal-recorded', { signalId: signal.id, runId, source: signal.source, reason });
    }
    tx.emit('delivery-reviewed', { runId, verdict, practice });
    tx.emit('run.done', { runId });
    // Ink v2 wave 5 (5A1): a kit chain order moves on only after Accept, or goes back or stops after a rejection.
    chainNext = chainOnReview(tx, next, verdict);
    // C4 task 15: a reject that moved the order too (a chain's stage goes back or stops) can't be taken back on its own.
    if (verdict === 'rejected' && JSON.stringify(tx.find('venture-order', run.orderId) ?? null) !== orderBefore) tx.replace<DeliveryRunRecord>({ ...next, rejectedFrom: null });
    return runView(next, tx.venture!, Date.parse(tx.now), tx.state);
  });
  // The next stage's run starts through the order path, so its gates, posture and floor hold; if it can't start now
  // (no AI, a pause, a quarantine), the order stays at its new stage and the owner starts it from Work.
  if (chainNext) await deliveryRunHandler(deps, ctx, { orderId: chainNext }).catch(() => null);
  // AI-native CA firm: the owner's edit of regulated papers is new papers, so it goes in front of the CA of record too.
  if (reviewed.status === 'edited') {
    await import('../playbooks/ca-firm/delivery-signoff.ts').then(module => module.requestSignoffForRun(deps, ctx, reviewed)).catch(() => null);
    // C7: the writing agent may offer a way of working learnt from the edit; it runs on its own and never holds this up.
    await import('../agents/way-of-working.ts').then(module => module.launchWayOfWorking(deps, ctx, reviewed.id)).catch(() => null);
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
  // One-shot A3 review 2 (M-b): a check about the run itself no edit can fix, so the words say to reject it.
  const job = jobLevelFailure(failed);
  if (job) return `This draft failed a check: ${job.detail} An edit can't fix this, so reject it.`;
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
 * One-shot A3 (S2, after two reviews): the checks a draft is held to now. With an edit in force (owner-edit.ts), its own
 * words are checked again, whoever made it; the owner's own edit also lifts the agent's authorship and figure checks.
 */
function checksInForce(state: State | undefined, run: DeliveryRunRecord): readonly CheckResult[] {
  const edit = state ? editInForce(state, run) : null;
  return edit && state ? checksWithEdit(state, run, edit, editContext(state, run)) : run.checks;
}

/** How the run's own checks were set: the sections its draft had to have, and the business's service type. */
function editContext(state: State, run: DeliveryRunRecord): EditContext {
  try {
    const venture = listRecords(state, 'venture-record').find(row => row.id === run.ventureId)!;
    const context = orderContext(state, venture, run.orderId);
    const playbook = playbookForRun(state, run);
    const draft = playbook ? flagshipDraft(playbook as PlaybookRecord, context.offerKey, context.order.intake ?? null, context.order.chainStage ?? null) : null;
    // A3 review 3 (M1): as the harness loop sets them (harness/loop.ts writeTask): a loop that proved work writes a report.
    const sections = draft?.sections ?? (run.harness?.sections === 'report' ? REPORT_SECTIONS : REQUIRED_SECTIONS[context.blueprint.serviceType]);
    return { sections, serviceType: context.blueprint.serviceType };
  } catch {
    return { sections: null, serviceType: 'consulting' as EditContext['serviceType'] };
  }
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
  const practiceNow = ready ? run.practice || (run.servedBy === 'model' && stage !== 'approve-each')
    : waiting ? run.practice || stage !== 'approve-each'
      : run.practice;
  // Read with the vault's state, a run whose order was cancelled is not live: nothing more of it is sent or started.
  const cancelled = !!state && findRecord(state, 'venture-order', run.orderId)?.status === 'cancelled';
  const canApprove = false;
  // Practice, or AI work that has not handed over: neither Accept nor an edit.
  const before = ready ? (practiceNow ? PRACTICE_REASON : run.agentJob && !run.agentJob.reviewReady ? 'AI work must finish before you can approve this draft.' : null) : null;
  // One-shot A3 (S2): the owner's own edit in force is not held to the agent's failed checks.
  const failed = ready && !before ? failedCheckReason(checksInForce(state, run), run.playbookChecks) : null;
  // The quality check still reading it, a CA's sign-off, or its files' consent and asset records (5A4).
  const held = ready && !before
    ? (judgeReading(run, nowMs) ? JUDGE_READING : null) ?? (state ? regulatedSignoffBlock(state, venture, run) : null)
      ?? (state ? mediaAcceptBlock(state, venture, run, new Date(nowMs).toISOString())?.line ?? null : null)
    : null;
  const blocked = ready ? before ?? failed ?? held : null;
  const canAccept = ready && blocked === null;
  // One-shot A3 (S2): a draft whose only block is a failed check can be edited, as one with none can.
  // A3 review (M1): a desk whose drafts are exact approved evidence (testing, monitored, triage, receptionist, developer,
  // data-entry and career reports) takes no owner edit, so Today offers none.
  const deskBound = !!(run.appTestingBinding || run.watchReportBinding || run.triageReportBinding || run.phoneReportBinding || run.devReportBinding || run.formsSourceBinding)
    || (!!state && playbookForRun(state, run)?.flagship === 'job-search-desk');
  // A3 review 2 (M-b): nor a draft whose failed check is about the run itself, which no edit can fix.
  const canEdit = ready && !cancelled && before === null && held === null && !deskBound && !jobLevelFailure(run.checks);
  // One-shot A1 (row 9, after review): a draft the AI handed over while its job still runs (reviewReady not set, nothing
  // pending the owner's approval) is the AI's work in progress: nothing says it waits on the owner, and Today holds no
  // row for it until the job hands over.
  const finishing = ready && !!run.agentJob && !run.agentJob.reviewReady && !run.agentJob.pendingApproval;
  const awaitingYou = !cancelled && (!!run.agentJob?.pendingApproval || (run.status === 'needs-answer' && !!run.agentJob?.pendingFacts)) || (ready && !finishing && (!practiceNow || isPracticeStage(stage)));
  // 4H1 (U17): which engine wrote the draft, read from its own call record; only with the vault's state.
  return { ...run, practiceNow, awaitingYou, canApprove, canAccept, acceptBlocked: blocked, canEdit, ...(state ? { writtenBy: writtenByLine(state, run) } : {}) };
}

/** venture.delivery.list: every run, newest first, each with what the engine would allow now (see runView). */
export async function deliveryListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunView[]> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  const nowMs = deps.clock().getTime();
  return newestFirst(listRecords(state, 'venture-delivery-run', venture.id)).map(run => runView(run, venture, nowMs, state));
}
