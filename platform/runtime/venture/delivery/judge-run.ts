import {testingJudgeCurrent} from '../playbooks/app-testing/run-source.ts';
import {formsRunCurrent} from '../playbooks/data-entry-desk/run-source.ts';
import {careerRunCurrent} from '../playbooks/job-search-desk/run-source.ts';
import {vaRunCurrent} from '../playbooks/virtual-assistant/run-source.ts';
// Chausar venture launcher, delivery package (Ink v2 wave 2, 2C1, catalogue Q1): the rules judge on real orders.
// The judge reads a ready agent draft once its code checks and its playbook's own checks pass, votes on the playbook's
// rules (or the draft rules) citing the run's trace, and code counts the votes (judge/rules.ts). Its call carries the
// client's words to the owner's own AI, so it is an outside effect: it goes through the action journal like every
// send ('delivery.send'), once, with the exact payload the owner could read.
// Two ways it goes:
// - On its own (judgeAuto, the founder's decision of 23 Oct): every ready draft that goes to a client or the public is
//   judged once, right after it is ready, under the business's standing consent. That consent is given where the
//   owner reads it: the write turn's approval says the judge will read the draft on the owner's AI and what it could
//   cost (judgeNotice), and approving it records the consent against that approved entry; turning the setting on
//   records it too. With no consent yet, the first judge call waits for the owner with the setting's words, and
//   sending it records the consent. Papers gathered for the CA of record are an internal note and never trigger it,
//   nor do practice drafts. A call past an agent run's spend cap, or one refused before it went, waits for the owner.
// - "Ask the judge" (venture.delivery.judge) previews the call and "Send to the judge" (judgeSend) sends it with the
//   digest the owner read, for any ready draft when judgeAuto is off or the automatic call could not go.
// A run's draft never changes once it is ready, so each run is judged at most once. The owner's own edit is the
// owner's words and is never judged; the run's judge line says so.
// A checked no blocks Accept with the judge's reason (runs.ts failedCheckReason) and records the first failed rule as
// a signal for the improvement loop; a vote code could not check settles nothing and blocks nothing; a refused answer
// leaves every rule unsettled, never a pass.
import { playbookForRun } from './workflow.ts';
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { currentVenture, digest, exactPayload, findRecord, identifier, listRecords, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import type {
  CheckResult, DeliveryJudgePreview, DeliveryRunRecord, DeliveryRunView, JudgeAutoView, JudgeSettingRecord, ModelPreview, ModelPresetId,
  SignalRecord, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { draftRulesInput, judgeAnswerRefused, MAX_DRAFT_CHARS, refusedVerdict, rulesJudgeResult } from './checks.ts';
import { renderForJudge } from './deliverable.ts';
import { madeSoFar } from './harness/env.ts';
import { capShortfall } from './harness/loop.ts';
import { recheckBeforeApply, type Denial } from './harness/recheck.ts';
import { decideRules, rulesTask, validateBallot, type RulesInput, type RulesVerdict } from './judge/rules.ts';
import { failedCheckReason, JUDGE_EDIT_LINE, JUDGE_PENDING_MS, judgeReading, PRACTICE_REASON, runView } from './runs.ts';

export { JUDGE_EDIT_LINE };
import { acceptedBlueprintOrNull, errorCode, previewShownWhole, quote, readAs, ventureReceipts } from './shared.ts';
import { journalled } from '../journal/journal.ts';
import { backgroundGateNow, backgroundWaits } from './report-back.ts';
import { costDisplay, estimateMaxCostMicros } from '../models/cost.ts';
import { presetSpec } from '../models/presets.ts';
import { budgetPressure, listRateOfTable, modelTableOf, monthSpendNow, resolveRate, spendRatesOf } from '../money/spend.ts';
import { flagshipJudgeRules } from '../playbooks/draft-checks.ts';
import { caOfferFor } from '../playbooks/ca-firm/signoff-gate.ts';
import { SOCIAL_AGENCY_ID } from '../playbooks/social/registration.ts';
import { boundSocialSource } from '../playbooks/social/bound-source.ts';
import { YOUTUBE_ID } from '../playbooks/youtube/registration.ts';
import { kitDefinition } from '../playbooks/kit/installed.ts';
import { scanRun } from './trace-scan.ts';

/** Why the judge did not run on its own near the month's limit (Ink v2 wave 4, 4F2, M5). */
export const JUDGE_PRESSURE_LINE = "Not checked: this month's limit is nearly used.";
export const JUDGE_FAILED_CHECK = 'Fix the failed check first; the judge reads only drafts that pass the code checks.';
const NOT_READY = 'The judge reads a draft once it is ready for your review.';
const TEMPLATE_OUTLINE = 'The judge reads drafts an agent wrote; this is a template outline.';
const NO_JUDGE_AI = 'Connect an AI for quick work first; the judge runs on your own AI.';
const ALREADY = 'The judge already read this draft.';
const NOT_WAITING = 'Ask the judge first, then send it.';
const CHANGED = 'The draft changed since you asked the judge. Ask again.';
const EXPIRED = 'Ask the judge again; the call you read is no longer available.';
const RECHECK_FAILED = 'The check before the judge ran could not finish, so it was stopped. Nothing was sent.';
const CAP_LINE = 'The judge did not run on its own: this run is at its spend cap. Send it yourself with the cost shown.';
const STANDING_OFF = 'The judge setting is off, or its standing consent is not recorded, so the judge did not run on its own.';
/** The journal's approval line for a judge call that went on its own: no person approved it. */
const STANDING_LINE = 'Sent under your standing judge setting.';
const DECIDED = 'The draft was decided while the judge read it, so its answer is not kept.';
const NOT_READ = 'The judge has not read this draft.';
const NEVER_READ = 'The judge never read this draft before you accepted it.';
/** A judge call whose cost was not shown before the write turn was approved, or came out dearer than shown. */
export const JUDGE_UNSHOWN_LINE = 'The judge did not run on its own: its cost was not shown before you approved this draft. Send it yourself with the cost shown.';
export const JUDGE_AUTO_ON_LINE = "The judge reads every draft that goes to a client or the public once it passes the code checks. It runs on your own AI, so your client's words go to your AI with the draft, and each check costs a little.";
export const JUDGE_AUTO_OFF_LINE = 'The judge reads a draft only when you ask it to, from the draft in Work.';
const DIGEST = /^[a-f0-9]{64}$/;
/** Room for what wraps a judge call's text on the way to the provider (model, limits, the answer's schema). */
const ENVELOPE_CHARS = 4000;
/** Room for the write turn's own line in the trace and the placeholders the judge's copy of the draft holds. */
const DRAFT_ROOM_CHARS = 2000;

/** Who a draft goes to: the client, the public (posts and videos, once the client approves), or the firm itself. */
export type JudgeAudience = 'client' | 'public' | 'internal';

/**
 * Where a run's draft goes. Papers a CA firm gathers for its CA of record (a tax audit, a notice) are an internal note:
 * the CA decides and signs, nothing goes out as it is. A YouTube package and social posts go out in public, apart from
 * the monthly report, which goes to the client. Every other draft is a reply to the client.
 */
export function judgeAudience(state: State, venture: VentureRecord, run: Pick<DeliveryRunRecord, 'orderId' | 'playbookId'>): JudgeAudience {
  if (caOfferFor(state, venture, run.orderId)?.caOnly) return 'internal';
  const flagship = findRecord(state, 'venture-playbook', run.playbookId)?.flagship ?? null;
  // Ink v2 wave 5 (5A1): a kit playbook's offer says who its work is for; internal work gets no automatic judge.
  const kit = kitDefinition(flagship);
  if (kit) {
    const order = findRecord(state, 'venture-order', run.orderId);
    const key = order ? acceptedBlueprintOrNull(state, venture)?.offers.find(offer => offer.id === order.offerId)?.playbookOffer ?? null : null;
    return kit.offers.find(offer => offer.id === key)?.audience ?? 'client';
  }
  if (flagship !== YOUTUBE_ID && flagship !== SOCIAL_AGENCY_ID) return 'client';
  const order = findRecord(state, 'venture-order', run.orderId);
  const offerKey = order ? acceptedBlueprintOrNull(state, venture)?.offers.find(offer => offer.id === order.offerId)?.playbookOffer ?? null : null;
  return offerKey === 'monthly-report' ? 'client' : 'public';
}

/** The business's judge setting as a run reads it: the newest record, else on with no consent recorded yet. */
export function judgeAutoOf(state: State, ventureId: string): Pick<JudgeSettingRecord, 'auto' | 'consent'> {
  const newest = listRecords(state, 'venture-judge-setting', ventureId).at(-1);
  return newest ? { auto: newest.auto, consent: newest.consent } : { auto: true, consent: null };
}

function autoView(setting: Pick<JudgeSettingRecord, 'auto' | 'consent'>): JudgeAutoView {
  return { auto: setting.auto, consentAt: setting.auto ? setting.consent?.at ?? null : null, line: setting.auto ? JUDGE_AUTO_ON_LINE : JUDGE_AUTO_OFF_LINE };
}

/** The draft the judge reads, as a digest: a send is refused when the run's draft is not the one it was asked about. */
export function draftDigestOf(run: Pick<DeliveryRunRecord, 'id' | 'renderedText'>): string {
  return digest({ runId: run.id, text: run.renderedText ?? '' });
}

function findRun(state: State, venture: VentureRecord, runId: string): DeliveryRunRecord {
  const run = findRecord(state, 'venture-delivery-run', runId);
  check(run && run.ventureId === venture.id, 'DELIVERY_NOT_FOUND', 'That draft reply was not found.');
  return run;
}

/**
 * Why the judge can't read this draft now, or null. It reads a ready draft an agent wrote, not a practice draft, once
 * every code check and every playbook check passed; an earlier verdict of its own is left out of that.
 */
function notJudgeable(state: State, venture: VentureRecord, run: DeliveryRunRecord, nowMs: number): ChausarError | null {
  testingJudgeCurrent(state,venture.id,run,new Date(nowMs).toISOString());
  if (run.status !== 'ready-for-review') return new ChausarError('JUDGE_NOT_READY', NOT_READY);
  if (run.servedBy !== 'model' && !run.careerPackBinding&&!run.formsSourceBinding&&!run.appTestingBinding || !run.deliverable) return new ChausarError('JUDGE_NOT_READY', TEMPLATE_OUTLINE);
  if (runView(run, venture, nowMs, state).practiceNow) return new ChausarError('PRACTICE_DRAFT', PRACTICE_REASON);
  if (failedCheckReason(run.checks.filter(result => result.check !== 'rules-judge'), run.playbookChecks) !== null) return new ChausarError('JUDGE_NOT_READY', JUDGE_FAILED_CHECK);
  // Ink v2 wave 4 (4J15, Q14): code scans the run's trace before any judge reads it (delivery/trace-scan.ts).
  const scan = scanRun(state, run);
  if (!scan.clean) return new ChausarError('JUDGE_NOT_READY', scan.line!);
  return null;
}

/**
 * What the judge reads on a run: the playbook's own rules (or the draft rules), the run's trace with the client's
 * message and the draft (prices and dates as placeholders), and who the client is. It holds the client's words.
 * draft: the text in the draft's place; the run's own when absent.
 */
function judgeInput(state: State, venture: VentureRecord, run: DeliveryRunRecord, draft?: string): { asked: RulesInput; client: string } {
  careerRunCurrent(state,venture.id,run);
  vaRunCurrent(state,venture.id,run);formsRunCurrent(state,venture.id,run);
  const order = findRecord(state, 'venture-order', run.orderId);
  check(order && order.ventureId === venture.id, 'ORDER_NOT_FOUND', 'That order was not found.');
  const playbook = playbookForRun(state, run);
  check(playbook, 'PLAYBOOK_NOT_FOUND', 'The playbook for this draft was not found.');
  const made = run.harness ? madeSoFar(state, run.harness) : { tables: [], receipts: [] };
  const receipts = [...ventureReceipts(state, venture.id), ...made.receipts];
  const client = findRecord(state, 'venture-client', order.clientId);
  const offer = acceptedBlueprintOrNull(state, venture)?.offers.find(item => item.id === order.offerId)?.name.value ?? 'a service';
  const goesTo = judgeAudience(state, venture, run) === 'public' ? 'It goes to the client, then out in public.' : 'It goes to the client.';
  const offerKey = acceptedBlueprintOrNull(state, venture)?.offers.find(item => item.id === order.offerId)?.playbookOffer;
  const socialEvidence = offerKey === 'repurpose-pack' ? '\nOnly this bound source can establish repurposed facts, including facts said in other words:\n' + boundSocialSource(state, venture, order) : offerKey === 'community-replies' ? '\nCommunity rules pasted by the owner:\n' + String(order.intake?.fields?.communityRules ?? '') : '';
  const asked = draftRulesInput({
    draft: draft ?? renderForJudge(run.deliverable!, receipts), clientRequest: order.request, harness: run.harness ?? null, receipts: made.receipts,
    context: `A draft for a real client's order of ${quote(offer, 120)} from this business. ${goesTo}${socialEvidence}`,
    containsClientData: true, rules: flagshipJudgeRules(playbook.flagship),
  });
  return { asked, client: client && client.ventureId === venture.id ? client.name : 'your client' };
}

/**
 * The most the judge's call on this run could cost, worked out by code before the draft exists: the judge's own task
 * with the run's trace as it stands, a draft at the longest a draft may be with every character escaped, and room for
 * the request's wrapping, priced with the quick-work AI's price table (models/cost.ts). Formatted as the port formats it.
 */
function judgeCostBound(state: State, venture: VentureRecord, run: DeliveryRunRecord, presetId: ModelPresetId, replay: boolean): { micros: string | null; display: string } {
  const spec = presetSpec(presetId);
  const { asked } = judgeInput(state, venture, run, '"'.repeat(MAX_DRAFT_CHARS + DRAFT_ROOM_CHARS));
  const task = rulesTask(asked);
  const chars = task.instructions.length + JSON.stringify(task.input).length + JSON.stringify(task.schema).length + ENVELOPE_CHARS;
  // The table the model port prices a keyed call with (models/port.ts meteredRate): the owner's rate card line for the
  // preset, else its list price. A command-line tool and a replay are not metered, so they keep the preset's table.
  let table = spec.priceTable;
  if (spec.needsKey && !replay) {
    try {
      const item = `model:${spec.id}`;
      table = modelTableOf(resolveRate({ item, list: listRateOfTable(item, spec.priceTable), owner: spendRatesOf(state, venture.id) }));
    } catch {
      return { micros: null, display: 'an amount your rate card does not price yet' };
    }
  }
  const micros = estimateMaxCostMicros(chars, task.maxOutputTokens, table);
  return { micros, display: costDisplay(micros, table?.confirmed ?? true, spec.kind) };
}

/**
 * What the owner reads on a waiting write turn before approving it, when the judge would then read the draft on its
 * own: what that check could cost, and, while no standing consent is recorded, the setting's words too. line for the
 * run's view and Today, short for the approval's journal line; consented: the consent already exists. Null otherwise:
 * not the write turn, a practice draft, internal papers, the setting off, or no AI for quick work. Approving the turn
 * with the setting's words shown records the consent (recordDefaultConsent).
 */
export function judgeNotice(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, run: DeliveryRunRecord): { line: string; short: string; consented: boolean; cost: string; boundMicros: string | null } | null {
  try {
    if (run.status !== 'waiting-for-you' || !run.preview || run.servedBy !== 'model') return null;
    if (run.harness && run.harness.phase !== 'write') return null;
    if (run.practice || venture.launchStage !== 'approve-each') return null;
    if (judgeAudience(state, venture, run) === 'internal') return null;
    const setting = judgeAutoOf(state, venture.id);
    if (!setting.auto) return null;
    const status = deps.models.status(ctx);
    const fast = status.tiers.fast.presetId;
    if (fast === 'built-in-templates') return null;
    const bound = judgeCostBound(state, venture, run, fast, status.replay.active);
    const cost = bound.display;
    if (setting.consent) {
      return {
        line: `Once this draft is ready, the judge reads it on your AI; that check could cost up to ${cost}.`,
        short: `Then the judge reads the ready draft on your AI, for up to ${cost}.`, consented: true, cost, boundMicros: bound.micros,
      };
    }
    return {
      line: `${JUDGE_AUTO_ON_LINE} Once this draft is ready, the judge's check could cost up to ${cost}.`,
      short: `Then the judge reads the ready draft on your AI, with your client's words, for up to ${cost}.`, consented: false, cost, boundMicros: bound.micros,
    };
  } catch {
    return null;
  }
}

/**
 * Runs as the screens read them (venture.delivery.*), each with the judge's notice when its write turn waits
 * (judgeNotice), read from one state.
 */
export function withJudgeNotices<V extends DeliveryRunView>(deps: VentureDeps, ctx: Context, views: readonly V[]): V[] {
  try {
    const { state, venture } = readAs(deps, ctx, 'read');
    return views.map(view => {
      const run = view.status === 'waiting-for-you' ? findRecord(state, 'venture-delivery-run', view.id) : undefined;
      return { ...view, judgeNotice: run && run.ventureId === venture.id ? judgeNotice(deps, ctx, state, venture, run)?.line ?? null : null };
    });
  } catch {
    return views.map(view => ({ ...view, judgeNotice: null }));
  }
}

/**
 * Where the judge stands on a ready draft, for Today's row and the draft's checks, so a missing verdict never reads
 * like a pass: 'Not checked by the judge.' when it settled nothing; 'The judge has not read this draft.' (with the
 * run's judge line when there is one) when no verdict is in while it ran or should have run on its own; 'The judge is
 * reading this draft.' while the automatic call is out. Null when it passed (a failure blocks Accept in its own words)
 * or when it was never due: judgeAuto off and never asked, a practice draft, internal papers, a failed code check.
 */
export function judgeStateLine(state: State, venture: VentureRecord, run: DeliveryRunRecord, nowMs: number): string | null {
  const result = run.checks.find(item => item.check === 'rules-judge');
  if (result) return result.notChecked ? 'Not checked by the judge.' : null;
  if (judgeReading(run, nowMs)) return 'The judge is reading this draft.';
  const judge = run.judge;
  if (run.status === 'accepted') return judge || run.judgePending ? NEVER_READ : null;
  if (judge) return judge.line ? `${NOT_READ} ${judge.line}` : NOT_READ;
  if (run.judgePending) return NOT_READ;
  if (!judgeAutoOf(state, venture.id).auto || notJudgeable(state, venture, run, nowMs) || judgeAudience(state, venture, run) === 'internal') return null;
  return NOT_READ;
}

/**
 * The owner approved a write turn whose approval showed the judge's notice: the standing consent, recorded once,
 * against that approved journal entry. Never while the setting is off, and never turns it on.
 */
export async function recordDefaultConsent(deps: VentureDeps, ctx: Context, entryId: string): Promise<void> {
  await ventureAction(deps, ctx, 'approve', 'judge.consent', tx => { recordConsent(tx, ctx, 'default', entryId); });
}

function recordConsent(tx: VentureTx, ctx: Context, how: 'default' | 'send', entryId: string): void {
  const setting = judgeAutoOf(tx.state, tx.venture!.id);
  if (!setting.auto || setting.consent) return;
  tx.put<JudgeSettingRecord>({ ...tx.base('venture-judge-setting'), auto: true, consent: { at: tx.now, by: ctx.memberId, how, entryId } });
}

const previewOf = (runId: string, preview: ModelPreview): DeliveryJudgePreview => ({
  runId, digest: preview.digest, estimatedMaxCostDisplay: preview.estimatedMaxCostDisplay, expiresAt: preview.expiresAt, containsClientData: true,
});

/**
 * venture.delivery.judge { runId }: previews the judge's call on a ready draft and keeps it waiting on the run for
 * "Send to the judge". Asking again while it waits gives the same call; nothing is sent here.
 */
export async function deliveryJudgeHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryJudgePreview> {
  const body = exactPayload(payload, ['runId'], ['runId']);
  const runId = identifier(body.runId, 'Draft reply');
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const run = findRun(state, venture, runId);
  const nowMs = deps.clock().getTime();
  const refused = notJudgeable(state, venture, run, nowMs);
  if (refused) throw refused;
  const draftDigest = draftDigestOf(run);
  const held = run.judge;
  if (held?.status === 'done' && held.draftDigest === draftDigest) throw new ChausarError('JUDGE_ALREADY_SENT', ALREADY);
  if (held?.status === 'waiting' && held.preview && held.draftDigest === draftDigest && Date.parse(held.preview.expiresAt) > nowMs) return previewOf(runId, held.preview);
  const { asked } = judgeInput(state, venture, run);
  const preview = await deps.models.preview(ctx, rulesTask(asked));
  check(preview, 'NO_MODEL_CONNECTED', NO_JUDGE_AI);
  await ventureAction(deps, ctx, 'prepare', 'delivery.judge', tx => {
    const current = tx.find('venture-delivery-run', runId);
    check(current && current.status === 'ready-for-review' && draftDigestOf(current) === draftDigest, 'JUDGE_NOT_READY', NOT_READY);
    testingJudgeCurrent(tx.state,venture.id,current,tx.now);
    careerRunCurrent(tx.state,venture.id,current,tx.now);
    vaRunCurrent(tx.state,venture.id,current);formsRunCurrent(tx.state,venture.id,current);
    tx.replace({ ...current, judge: waitingJudge(preview, tx.now, draftDigest, false, null) });
    tx.emit('run.step', { runId });
  });
  return previewOf(runId, preview);
}

function waitingJudge(preview: ModelPreview, at: string, draftDigest: string, auto: boolean, line: string | null): NonNullable<DeliveryRunRecord['judge']> {
  return { status: 'waiting', callId: preview.callId, preview, at, draftDigest, auto, estimatedMaxCostDisplay: preview.estimatedMaxCostDisplay, line };
}

/**
 * venture.delivery.judgeSend { runId, digest } (app only): sends the judge's waiting call once, with the digest the
 * owner read. With judgeAuto on and no standing consent yet, this send records it.
 */
export async function deliveryJudgeSendHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunView> {
  requireAppChannel(ctx, 'venture.delivery.judgeSend');
  const body = exactPayload(payload, ['runId', 'digest'], ['runId', 'digest']);
  const runId = identifier(body.runId, 'Draft reply');
  check(typeof body.digest === 'string' && DIGEST.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the judge call you read.');
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = findRun(state, venture, runId);
  const held = run.judge;
  if (held?.status === 'done') throw new ChausarError('JUDGE_ALREADY_SENT', ALREADY);
  check(held?.status === 'waiting' && held.preview && held.callId, 'JUDGE_NOT_WAITING', NOT_WAITING);
  const preview = held.preview;
  check(preview.digest === body.digest, 'APPROVAL_STALE', 'This changed since you read it. Read it again.');
  const nowMs = deps.clock().getTime();
  const refused = notJudgeable(state, venture, run, nowMs);
  if (refused) throw refused;
  check(held.draftDigest === draftDigestOf(run), 'APPROVAL_STALE', CHANGED);
  if (Date.parse(preview.expiresAt) <= nowMs) {
    const stale = new ChausarError('APPROVAL_STALE', EXPIRED);
    await markJudgeFailed(deps, ctx, runId, preview.callId, stale, true);
    throw stale;
  }
  return sendJudge(deps, ctx, { venture, run, preview, standing: false });
}

/**
 * The gate again just before the judge's call goes, on what the vault says now: the call still waits on a ready draft
 * with the payload approved, the order and the client are still there, the stage still lets an agent draft, and the
 * month's limit has room. standing: a send on its own goes only while the setting is on with its consent. A denial
 * cancels the send with its reason in the journal; nothing is sent.
 */
export function recheckJudgeSend(deps: VentureDeps, ventureId: string, runId: string, preview: ModelPreview, standing: boolean): void {
  let denial: Denial | null;
  try {
    const state = deps.store.read();
    const setting = judgeAutoOf(state, ventureId);
    if (standing && (!setting.auto || !setting.consent)) throw new ChausarError('POLICY_DENIED', STANDING_OFF);
    const run = findRecord(state, 'venture-delivery-run', runId);
    const waiting = run && run.ventureId === ventureId && run.status === 'ready-for-review' && run.judge?.status === 'waiting' && run.judge.callId === preview.callId ? run.judge.preview : null;
    const order = run ? findRecord(state, 'venture-order', run.orderId) : undefined;
    const live = order && order.ventureId === ventureId ? order : undefined;
    const client = live ? findRecord(state, 'venture-client', live.clientId) : undefined;
    denial = recheckBeforeApply({
      approvedDigest: preview.digest, currentDigest: waiting?.digest ?? null, order: live ? { status: live.status } : null,
      clientOnFile: !!client && client.ventureId === ventureId, stage: findRecord(state, 'venture-record', ventureId)?.launchStage ?? 'rehearsal',
      run: null, month: monthSpendNow(state, ventureId, deps.clock().toISOString()), callMicros: preview.estimatedMaxCostMicros,
    });
  } catch (error) {
    if (errorCode(error) === 'POLICY_DENIED') throw error;
    denial = { code: 'RECHECK_FAILED', reason: RECHECK_FAILED };
  }
  if (denial) throw new ChausarError(denial.code, denial.reason);
}

/**
 * Sends the judge's waiting call through the action journal, once: the gate again, the call, then code counts the
 * votes and the verdict joins the run's checks. standing: sent on its own under the business's standing consent, so the
 * model call is recorded as such (never as the owner's approval of that call) and its cost counts against an agent
 * run's spend. An owner's send with judgeAuto on and no consent yet records the consent against its journal entry. A
 * failed verdict records its first failed rule as a signal. A call that failed after it was claimed marks the judge failed.
 */
async function sendJudge(deps: VentureDeps, ctx: Context, a: { venture: VentureRecord; run: DeliveryRunRecord; preview: ModelPreview; standing: boolean }): Promise<DeliveryRunView> {
  const { asked, client } = judgeInput(deps.store.read(), a.venture, a.run);
  const runId = a.run.id, callId = a.preview.callId;
  const careerDispatch=()=>{if(!a.run.careerPackBinding&&!a.run.vaBriefBinding&&!a.run.formsSourceBinding&&!a.run.appTestingBinding)return;recheckJudgeSend(deps,a.venture.id,runId,a.preview,a.standing);const state=deps.store.read(),current=findRecord(state,'venture-delivery-run',runId);check(current&&draftDigestOf(current)===draftDigestOf(a.run),'APPROVAL_STALE','The approved draft changed before the judge could read it.');testingJudgeCurrent(state,a.venture.id,current,deps.clock().toISOString());careerRunCurrent(state,a.venture.id,current,deps.clock().toISOString());vaRunCurrent(state,a.venture.id,current);formsRunCurrent(state,a.venture.id,current);};
  const send = async (entryId: string): Promise<DeliveryRunView> => {
    recheckJudgeSend(deps, a.venture.id, runId, a.preview, a.standing);
    let verdict: RulesVerdict;
    let costMicros: string | null = null;
    try {
      const outcome = await deps.models.runPreview(ctx, callId, a.preview.digest, raw => validateBallot(raw, asked.rules), {...(a.standing?{consent:'standing-judge' as const}:{}),beforeDispatch:careerDispatch});
      verdict = decideRules(asked.rules, [outcome.value], asked.trace);
      costMicros = outcome.costMicros;
    } catch (error) {
      if (!judgeAnswerRefused(error)) throw error;
      verdict = refusedVerdict(asked.rules, error);
      // The port billed the refused answer all the same (models/port.ts): its cost is on the call record.
      costMicros = billedMicros(deps, callId);
    }
    const result = rulesJudgeResult(verdict);
    return ventureAction(deps, ctx, 'approve', 'delivery.judgeSend', tx => {
      const current = tx.find('venture-delivery-run', runId);
      check(current && current.judge?.status === 'waiting' && current.judge.callId === callId, 'JUDGE_NOT_WAITING', NOT_WAITING);
      // A draft decided while the judge read it (rejected, edited) keeps no verdict: nothing lands on a decided draft.
      check(current.status === 'ready-for-review', 'JUDGE_NOT_READY', DECIDED);
      if(a.run.appTestingBinding){check(draftDigestOf(current)===draftDigestOf(a.run),'APPROVAL_STALE','The reviewed report changed while the judge read it.');testingJudgeCurrent(tx.state,a.venture.id,current,tx.now);}
      if(a.run.careerPackBinding){check(draftDigestOf(current)===draftDigestOf(a.run),'APPROVAL_STALE','The career draft changed while the judge read it.');careerRunCurrent(tx.state,a.venture.id,current,tx.now);}
      if(a.run.formsSourceBinding){check(draftDigestOf(current)===draftDigestOf(a.run),'APPROVAL_STALE','The source artifact changed while the judge read it.');formsRunCurrent(tx.state,a.venture.id,current);}
      if(a.run.vaBriefBinding){check(draftDigestOf(current)===draftDigestOf(a.run),'APPROVAL_STALE','The approved draft changed while the judge read it.');vaRunCurrent(tx.state,a.venture.id,current);formsRunCurrent(tx.state,a.venture.id,current);}
      const harness = a.standing && costMicros !== null && current.harness ? withCost(current.harness, costMicros) : current.harness;
      const next: DeliveryRunRecord = {
        ...current, checks: [...current.checks.filter(item => item.check !== 'rules-judge'), result],
        // 4J14 (Q7): each rule's result as code counted it, so the report words it (strong, fair, weak, no) and its keep line.
        judge: { ...current.judge, status: 'done', preview: null, at: tx.now, line: null, rules: verdict.rules.map(rule => ({ rule: rule.rule, outcome: rule.outcome, yes: rule.yes, votes: rule.votes.length })) },
        ...(harness ? { harness } : {}),
      };
      tx.replace(next);
      // Only the automatic call shown with the setting's words carries the standing consent; one the owner asked for does not.
      if (!a.standing && a.run.judge?.auto && a.run.judge.line === JUDGE_AUTO_ON_LINE) recordConsent(tx, ctx, 'send', entryId);
      recordJudgeSignal(tx, runId, verdict, result);
      tx.emit('run.step', { runId });
      tx.emit('queue.changed', {});
      return runView(next, tx.venture!, Date.parse(tx.now), tx.state);
    });
  };
  try {
    const sent = await journalled(deps, ctx, {
      action: 'delivery.send', subject: `${runId}:judge:${callId}`, target: client, actionDigest: a.preview.digest,
      line: a.standing ? `Send the draft for ${client} to the judge on your AI, under your standing consent.` : `Send the draft for ${client} to the judge on your AI.`,
      notAfter: a.preview.expiresAt, quote: { figure: a.preview.estimatedMaxCostMicros, payer: a.preview.presetId },
      descriptionComplete: previewShownWhole(a.preview),
    }, async handle => ({ outcome: 'applied', line: 'Sent to your AI. The judge answered.', value: await send(handle.entry.id) }),
    a.standing ? { standing: { line: STANDING_LINE } } : {});
    return sent.value!;
  } catch (error) {
    await markJudgeFailed(deps, ctx, runId, callId, error, false, a.standing);
    throw error;
  }
}

/** What a sent call cost, from its record (models/port.ts keeps it, a refused answer included); null when unknown. */
function billedMicros(deps: VentureDeps, callId: string): string | null {
  const call: { costMicros?: unknown } | undefined = deps.store.read().conversations.find((record: { id?: unknown } | null) => record?.id === callId);
  return typeof call?.costMicros === 'string' && /^\d+$/.test(call.costMicros) ? call.costMicros : null;
}

function withCost(harness: NonNullable<DeliveryRunRecord['harness']>, micros: string): NonNullable<DeliveryRunRecord['harness']> {
  return { ...harness, used: { ...harness.used, costMicros: String(BigInt(harness.used.costMicros) + BigInt(micros)) } };
}

/** A checked no on a real draft: a signal for the improvement loop, its reason the first rule that failed. */
function recordJudgeSignal(tx: VentureTx, runId: string, verdict: RulesVerdict, result: CheckResult) {
  if (result.passed || result.notChecked) return;
  const reason = verdict.rules.find(rule => rule.outcome === 'fail')?.rule ?? 'rules-judge';
  const signal: SignalRecord = { ...tx.base('venture-signal'), source: 'check-failed', runId, reason, scenarioId: null };
  tx.put(signal);
  tx.emit('signal-recorded', { signalId: signal.id, runId, source: signal.source, reason });
}

/**
 * When a send shows the judge's call can never go, the judge is marked failed with why, so "Ask the judge" makes a new
 * call. That is the case once the call was claimed and then failed, or when its time is up. A refusal while the call
 * is still a live preview (the phone, a wrong digest, the gate) leaves it waiting.
 */
async function markJudgeFailed(deps: VentureDeps, ctx: Context, runId: string, callId: string, error: unknown, expired = false, standing = false): Promise<void> {
  const code = errorCode(error);
  if (code === 'APP_APPROVAL_REQUIRED') return;
  const call: { status?: unknown } | undefined = deps.store.read().conversations.find((record: { id?: unknown } | null) => record?.id === callId);
  if (!expired && (!call || call.status === 'preview')) return;
  const said = error instanceof Error ? error.message : 'no reason given';
  // A call that went out on its own and whose verdict was never stored: what the port billed counts against the run
  // here, once (the verdict's commit, which would have counted it, did not happen).
  const billed = standing && call && call.status !== 'preview' ? billedMicros(deps, callId) : null;
  try {
    await ventureAction(deps, ctx, 'approve', 'delivery.judgeFailed', tx => {
      const current = tx.find('venture-delivery-run', runId);
      if (!current?.judge || current.judge.status !== 'waiting' || current.judge.callId !== callId) return;
      const harness = billed !== null && current.harness ? withCost(current.harness, billed) : current.harness;
      // On a draft decided while the judge read it, asking again makes no sense: an edit keeps its own line.
      const decided = current.status !== 'ready-for-review';
      const line = decided ? (current.judge.line === JUDGE_EDIT_LINE ? JUDGE_EDIT_LINE : DECIDED) : `The judge did not finish: ${quote(said, 200)} Ask the judge again.`;
      tx.replace({ ...current, ...(harness ? { harness } : {}), judge: { ...current.judge, status: 'failed', preview: null, at: tx.now, line } });
      tx.emit('run.step', { runId });
    });
  } catch {
    // The original error is what the owner needs to see.
  }
}

/**
 * The judge on its own (judgeAuto), right after a draft is ready (runs.ts deliveryApproveHandler). It runs once per
 * run, on a ready draft for a client or the public whose checks passed, while the setting is on and an AI serves quick
 * work. It sends only under a recorded standing consent; with none yet the call waits for the owner with the setting's
 * words. The setting is read again in the same commit that keeps the call, so turning it off meanwhile stops it. A
 * preview that cannot be made leaves the judge failed with why; a call past the run's spend cap, or one refused before
 * it went, waits for the owner with why. It never fails or undoes the run: any error leaves the run as the vault has it.
 */
export async function autoJudge(deps: VentureDeps, ctx: Context, view: Pick<DeliveryRunView, 'id'>): Promise<DeliveryRunView> {
  try {
    await askOnItsOwn(deps, ctx, view.id);
  } finally {
    // However it went, the draft is no longer due: the judge was asked, waits for the owner, or was never due.
    await clearPending(deps, ctx, view.id);
  }
  const fresh = readAs(deps, ctx, 'read');
  return runView(findRun(fresh.state, fresh.venture, view.id), fresh.venture, deps.clock().getTime(), fresh.state);
}

/**
 * The work of autoJudge. The call goes on its own only under the standing consent and within the cost bound the write
 * turn's approval showed (judgePending.boundMicros); otherwise it waits for the owner with why.
 */
async function askOnItsOwn(deps: VentureDeps, ctx: Context, runId: string): Promise<void> {
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = findRun(state, venture, runId);
  const nowMs = deps.clock().getTime();
  if (run.judge || notJudgeable(state, venture, run, nowMs) || judgeAudience(state, venture, run) === 'internal' || !judgeAutoOf(state, venture.id).auto) return;
  if (deps.models.status(ctx).tiers.fast.presetId === 'built-in-templates') return;
  const draftDigest = draftDigestOf(run);
  // Ink v2 wave 4 (4F2, M5): past the month's alert share the judge does not run on its own and says so; the owner
  // can still ask it, and the code checks have run already.
  if (budgetPressure(state, venture, new Date(nowMs).toISOString()).month) {
    await noteNotRun(deps, ctx, run.id, draftDigest, JUDGE_PRESSURE_LINE);
    return;
  }
  // 4J13 (H30): on the desktop, background model work waits while the owner works and the AI is local or busy. The
  // judge waits (never failed), keeping the cost bound shown, and the sweep asks again once it may go (retryWaitingJudges).
  const waits = backgroundWaits(backgroundGateNow(deps, ctx, state));
  if (waits) {
    await noteWaiting(deps, ctx, run.id, draftDigest, waits);
    return;
  }
  let preview: ModelPreview | null;
  try {
    preview = await deps.models.preview(ctx, rulesTask(judgeInput(state, venture, run).asked));
  } catch (error) {
    await noteNotRun(deps, ctx, run.id, draftDigest, `The judge did not run: ${quote(error instanceof Error ? error.message : 'no reason given', 200)} Ask the judge to try again.`);
    return;
  }
  if (!preview) return;
  const capped = !!run.harness && capShortfall(run.harness, preview.estimatedMaxCostMicros) !== null;
  const stored = await ventureAction(deps, ctx, 'approve', 'delivery.judgeAuto', tx => {
    const current = tx.find('venture-delivery-run', run.id);
    if (!current || current.status !== 'ready-for-review' || current.judge || draftDigestOf(current) !== draftDigest) return null;
    // Read again here: the owner may have turned it off while the call was being prepared.
    const setting = judgeAutoOf(tx.state, tx.venture!.id);
    if (!setting.auto) return null;
    // The cost the owner saw before approving the write turn; a call that may cost more was never shown.
    const bound = current.judgePending?.boundMicros ?? null;
    const shown = bound !== null && BigInt(preview.estimatedMaxCostMicros) <= BigInt(bound);
    const goes = !capped && !!setting.consent && shown;
    const line = capped ? CAP_LINE : !setting.consent ? JUDGE_AUTO_ON_LINE : !shown ? JUDGE_UNSHOWN_LINE : null;
    const next: DeliveryRunRecord = { ...current, judgePending: null, judge: waitingJudge(preview, tx.now, draftDigest, true, line) };
    tx.replace(next);
    tx.emit('run.step', { runId: run.id });
    return { run: next, venture: tx.venture!, goes };
  }).catch(() => null);
  if (!stored || !stored.goes) return;
  try {
    await sendJudge(deps, ctx, { venture: stored.venture, run: stored.run, preview, standing: true });
  } catch (error) {
    await noteRefused(deps, ctx, run.id, preview.callId, error);
  }
}

/** The draft is no longer due for the judge (judgePending), so Accept stops waiting for it. */
async function clearPending(deps: VentureDeps, ctx: Context, runId: string): Promise<void> {
  try {
    await ventureAction(deps, ctx, 'approve', 'delivery.judgeAuto', tx => {
      const current = tx.find('venture-delivery-run', runId);
      if (!current?.judgePending) return;
      tx.replace({ ...current, judgePending: null });
      tx.emit('queue.changed', {});
    });
  } catch {
    // It runs out on its own (judgePending.until).
  }
}

/**
 * An automatic send refused before it went (the gate again, the month's limit, the send setting): the call still waits
 * for the owner, and the run says why.
 */
async function noteRefused(deps: VentureDeps, ctx: Context, runId: string, callId: string, error: unknown): Promise<void> {
  const said = error instanceof Error ? error.message : 'no reason given';
  try {
    await ventureAction(deps, ctx, 'approve', 'delivery.judgeAuto', tx => {
      const current = tx.find('venture-delivery-run', runId);
      if (!current?.judge || current.judge.status !== 'waiting' || current.judge.callId !== callId) return;
      tx.replace({ ...current, judge: { ...current.judge, line: `The judge did not run on its own: ${quote(said, 200)} Send it yourself when you are ready.` } });
      tx.emit('run.step', { runId });
    });
  } catch {
    // The run stands as it is.
  }
}

/**
 * 4J13 (H30): the judge waits to be asked on its own: status waiting with no call, "Waiting: {why}", and the cost bound
 * the write turn's approval showed, so the retry goes within it. "Ask the judge" stays open meanwhile.
 */
async function noteWaiting(deps: VentureDeps, ctx: Context, runId: string, draftDigest: string, why: string): Promise<void> {
  try {
    await ventureAction(deps, ctx, 'approve', 'delivery.judgeAuto', tx => {
      const current = tx.find('venture-delivery-run', runId);
      if (!current || current.status !== 'ready-for-review' || current.judge || draftDigestOf(current) !== draftDigest) return;
      const deferred = { boundMicros: current.judgePending?.boundMicros ?? null, bound: current.judgePending?.bound ?? '' };
      tx.replace({ ...current, judge: { status: 'waiting', callId: null, preview: null, at: tx.now, draftDigest, auto: true, estimatedMaxCostDisplay: null, line: `Waiting: ${why}`, deferred } });
      tx.emit('run.step', { runId });
    });
  } catch {
    // The run stands as it is.
  }
}

/**
 * 4J13 (H30): at the sweep (agents/routine-runner.ts), once background model work may go, each judge that waited to be
 * asked on its own is asked again: the run is due again within the bound kept, and autoJudge runs as after the write
 * turn (consent, setting, audience and cap read again). While the gate still says wait, nothing changes. Never throws.
 */
export async function retryWaitingJudges(deps: VentureDeps, ctx: Context): Promise<number> {
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture || backgroundWaits(backgroundGateNow(deps, ctx, state))) return 0;
  const waiting = listRecords(state, 'venture-delivery-run', venture.id).filter(run => run.status === 'ready-for-review' && run.judge?.status === 'waiting' && run.judge.deferred && !run.judge.preview);
  let asked = 0;
  for (const run of waiting) {
    const due = await ventureAction(deps, ctx, 'approve', 'delivery.judgeAuto', tx => {
      const current = tx.find('venture-delivery-run', run.id);
      const deferred = current?.judge?.status === 'waiting' && !current.judge.preview ? current.judge.deferred : undefined;
      if (!current || current.status !== 'ready-for-review' || !deferred || current.judge!.draftDigest !== draftDigestOf(current)) return false;
      const next: DeliveryRunRecord = { ...current, judgePending: { boundMicros: deferred.boundMicros, bound: deferred.bound, until: new Date(Date.parse(tx.now) + JUDGE_PENDING_MS).toISOString() } };
      delete next.judge;
      tx.replace(next);
      return true;
    }).catch(() => false);
    if (!due) continue;
    await autoJudge(deps, ctx, { id: run.id }).catch(() => null);
    asked += 1;
  }
  return asked;
}

/** The judge could not be asked on its own: the run says why, and "Ask the judge" stays open. */
async function noteNotRun(deps: VentureDeps, ctx: Context, runId: string, draftDigest: string, line: string): Promise<void> {
  try {
    await ventureAction(deps, ctx, 'approve', 'delivery.judgeAuto', tx => {
      const current = tx.find('venture-delivery-run', runId);
      if (!current || current.status !== 'ready-for-review' || current.judge || draftDigestOf(current) !== draftDigest) return;
      tx.replace({ ...current, judge: { status: 'failed', callId: null, preview: null, at: tx.now, draftDigest, auto: true, estimatedMaxCostDisplay: null, line } });
      tx.emit('run.step', { runId });
    });
  } catch {
    // The run stands as it is.
  }
}

/** venture.judge.auto.get {}: whether the judge runs on its own, when its consent was recorded, and the sheet's line. */
export async function judgeAutoGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<JudgeAutoView> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  return autoView(judgeAutoOf(state, venture.id));
}

/**
 * venture.judge.auto.set { auto } (app only, the owner's): turns the judge on its own on or off for this business.
 * Turning it on records the standing consent for its calls, which carry the client's words to the owner's own AI.
 */
export async function judgeAutoSetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<JudgeAutoView> {
  requireAppChannel(ctx, 'venture.judge.auto.set');
  check(ctx.role === 'owner' || ctx.role === 'cofounder', 'APP_APPROVAL_REQUIRED', 'Only you change when the judge runs, inside the Chausar app.');
  const body = exactPayload(payload, ['auto'], ['auto']);
  check(typeof body.auto === 'boolean', 'INVALID_VENTURE_REQUEST', 'auto must be true or false.');
  const auto = body.auto;
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'judge.auto', tx => {
    const now = judgeAutoOf(tx.state, tx.venture!.id);
    if (now.auto === auto && (!auto || now.consent)) return autoView(now);
    const record = tx.put<JudgeSettingRecord>({ ...tx.base('venture-judge-setting'), auto, consent: auto ? { at: tx.now, by: ctx.memberId, how: 'set', entryId: null } : null });
    return autoView(record);
  });
}
