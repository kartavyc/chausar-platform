// An owner-requested revision uses the current client consent and scoped native agent.
// The exact owner words and previous draft are read through Chausar's MCP boundary.
// Undo restores the draft only before the new job opens. Completed revisions merge
// against the owner's edits and return for exact review before any outside action.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { exactPayload, findRecord, identifier, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import type {
  CheckResult, DeliveryRunRecord, DeliveryRunView, DraftFix, DraftRevision, PlaybookCheckResult, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { ghostwritingOffer, preserveOtherPosts } from '../playbooks/social/ghostwriting.ts';
import { emptyGhostwriting } from '../playbooks/social/approvals.ts';
import { draftPostsOf } from '../playbooks/social/run-approvals.ts';
import { screenReadback } from '../core/secrets.ts';
import { recordDecision } from '../journal/decisions.ts';
import { refuseUnsignedRun } from '../money/order-contracts.ts';
import { readAs } from './shared.ts';
import { refuseNewWork } from './run-guards.ts';
import { loadQuarantineCheck, refuseQuarantined } from './quarantine-gate.ts';
import { agentStage, restartNativeDelivery, runView, STAGE_BLOCKED_REASON } from './runs.ts';
import { waitForAgentWork } from '../agent-runtime/runner.ts';
import { requireClientAiConsent } from '../clients/ai-consent.ts';
import { joinParagraphs, mergeParagraphs, mergedText, paragraphs } from './merge.ts';
import { fixStatus, outcomeOfCheck, outcomeOfPlaybookCheck, type CheckOutcome } from './verdicts.ts';

/** How every revision turn's words begin. */
export const REVISE_PREFIX = 'Revise this to: ';
/** The most characters the owner's words may have. */
export const SEND_BACK_MAX = 300;
const NO_AI = 'Connect your AI to send a draft back. You can edit it yourself instead.';
const NOT_READY = 'This draft is not waiting for your review.';

/** The revision's words: the owner's text after the shared screen (keys, cards, bank accounts, Aadhaar, OTPs), after the prefix. */
export function revisionWords(text: string): string {
  return `${REVISE_PREFIX}${screenReadback(text).text}`;
}

/**
 * The run's own times the review row comes back: each one gives Today's review row a new version (views/queue.ts). The
 * files an earlier reopen named (4J1, a changed file) are kept.
 */
export function reopenMark(run: DeliveryRunRecord, at: string): NonNullable<DeliveryRunRecord['reopened']> {
  return { count: (run.reopened?.count ?? 0) + 1, at, files: [...(run.reopened?.files ?? [])] };
}

type RevisionInput = { socialPost?: DraftRevision['socialPost']; runId: string; words: string; by: DraftRevision['by']; rowId: string | null; checks?: string[] };

/**
 * Starts a scoped AI revision with the owner's words under the client's current AI consent.
 * within: more writes in the same commit (Today's decision on the row).
 */
export async function startRevision(deps: VentureDeps, ctx: Context, input: RevisionInput, within?: (tx: VentureTx, run: DeliveryRunRecord) => void): Promise<DeliveryRunView> {
  readAs(deps, ctx, 'approve');
  await waitForAgentWork(deps.store, input.runId);
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = findRecord(state, 'venture-delivery-run', input.runId);
  check(run && run.ventureId === venture.id, 'DELIVERY_NOT_FOUND', 'That draft reply was not found.');
  check(run.status === 'ready-for-review' || input.socialPost && ['accepted','edited'].includes(run.status), 'DELIVERY_NOT_READY', NOT_READY);
  check(!ghostwritingOffer(state,run)||draftPostsOf(run).length===0||input.socialPost,'SOCIAL_POST_REQUIRED','Choose one LinkedIn post to revise from the canvas.');
  check(agentStage(venture.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  refuseNewWork(state, venture, ctx, deps.clock().toISOString());
  await loadQuarantineCheck();
  refuseQuarantined(state, venture, deps.clock().toISOString());
  // 4J12: a revision is new work on the order, so an order whose contract waits for the owner's signature starts none.
  refuseUnsignedRun(state, venture, run);
  if(input.socialPost && run.deliverable)preserveOtherPosts({...run,revision:{socialPost:input.socialPost} as DraftRevision},run.deliverable);
  const main = deps.models.status(ctx).tiers.main;
  check(main.presetId !== 'built-in-templates' && main.usable !== false, 'NO_MODEL_CONNECTED', NO_AI);
  // The agent revises the text the owner saw; its own draft stays the base the owner's words are merged against.
  const base = run.renderedText ?? '';
  const draft: DraftRevision = {
    by: input.by, words: input.words, rowId: input.rowId, at: deps.clock().toISOString(), callId: '', base, previous: run.editedText ?? base,
    ...(input.socialPost ? {socialPost:input.socialPost} : {}),
    prior: { callId: run.callId, phase: run.harness?.phase ?? null, status:run.status }, ...(input.checks ? { checks: input.checks } : {}),
  };
  const order = findRecord(state, 'venture-order', run.orderId);
  check(order, 'ORDER_NOT_FOUND', 'This order was not found.');
  requireClientAiConsent(state, venture.id, order.clientId);
  await ventureAction(deps, ctx, 'approve', 'delivery.revise', tx => {
    const current = tx.find('venture-delivery-run', run.id);
    check(current && current.status === run.status, 'DELIVERY_NOT_READY', NOT_READY);
    // The draft the owner saw: a newer draft, an edit or a merge since makes this click stale.
    check(current.renderedText === run.renderedText && current.editedText === run.editedText, 'APPROVAL_STALE', 'This draft changed since you read it. Read it again.');
    check(agentStage(tx.venture!.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
    refuseNewWork(tx.state, tx.venture!, ctx, tx.now);
    refuseQuarantined(tx.state, tx.venture!, tx.now);
    refuseUnsignedRun(tx.state, tx.venture!, current);
    requireClientAiConsent(tx.state, tx.venture!.id, order.clientId);
    const stored: DeliveryRunRecord = {
      ...current, status: 'waiting-for-you', verdict: null, callId: null, preview: null, harness: null,
      revision: { ...draft, at: tx.now, callId: '' }, reopened: reopenMark(current, tx.now), judgePending: null,
    };
    tx.replace(stored);
    within?.(tx, stored);
    tx.emit('delivery-waiting', { runId: stored.id, orderId: stored.orderId, practice: stored.practice });
    tx.emit('run.step', { runId: stored.id });
    tx.emit('run.waiting', { runId: stored.id });
    return runView(stored, tx.venture!, Date.parse(tx.now), tx.state);
  });
  return restartNativeDelivery(deps, ctx, run.id);
}

/** A revision starts when its native job opens, marked atomically before the driver sees any data. */
export function revisionStarted(run: DeliveryRunRecord): boolean {
  return !run.revision || run.status !== 'waiting-for-you' || run.revision.callId !== '';
}

/** The words Undo promises: only until the owner edits it again. */
export const RESTORED_LINE = 'Restored until you edit this again.';
export const TOO_LATE_LINE = 'Too late to undo: the revision already started.';

/**
 * Undo of a send-back or fix before its native job opens restores the draft for review.
 * A pending launch then fails its current-state check before opening the driver.
 */
export async function undoRevision(deps: VentureDeps, ctx: Context, runId: string, rowId: string | null): Promise<DeliveryRunRecord> {
  return ventureAction(deps, ctx, 'approve', 'delivery.revise.undo', tx => {
    const current = tx.find('venture-delivery-run', runId);
    check(current, 'DELIVERY_NOT_FOUND', 'That draft reply was not found.');
    check(current.revision && (rowId === null || current.revision.rowId === rowId) && !revisionStarted(current), 'UNDO_TOO_LATE', TOO_LATE_LINE);
    const revision = current.revision;
      const restored: DeliveryRunRecord = {
      ...current, status: revision.prior.status ?? 'ready-for-review', callId: revision.prior.callId, preview: null, harness: null, revision: null,
      reopened: reopenMark(current, tx.now),
    };
    if(revision.socialPost){
      const order=tx.find('venture-order',current.orderId)!;const state=order.socialGhostwriting??emptyGhostwriting();const key='post-'+revision.socialPost.n;const before=revision.socialPost.prior;
      check(state.rounds[key]===(before.rounds[key]??0)+1,'UNDO_TOO_LATE','A later revision of this post already started.');
      const decisions={...state.decisions};if(before.decisions[key])decisions[key]=before.decisions[key]!;else delete decisions[key];
      const next={...state,rounds:{...state.rounds,[key]:before.rounds[key]??0},decisions,charges:state.charges.filter(c=>!(c.postId===revision.socialPost!.postId&&c.round===state.rounds[key]))};
      tx.replace({...order,socialGhostwriting:next});restored.socialGhostwriting=next;
    }
    tx.replace(restored);
    // Today's decision on the row that sent it back is undone too.
    const live = rowId ? tx.list('venture-queue-decision').find(item => item.rowId === rowId && !item.undoneAt) : undefined;
    if (live) tx.replace({ ...live, undoneAt: tx.now });
    recordDecision(tx, { subject: `run:${runId}`, action: 'undo', who: 'owner', ruleId: null, reason: 'You took back sending this draft back.', rowId });
    tx.emit('run.step', { runId });
    tx.emit('queue.changed', { runId });
    return restored;
  });
}

// ---------------------------------------------------------------------------
// When the revision lands
// ---------------------------------------------------------------------------

/** A check's outcome on the revised draft: a harness check by id, a flagship check as playbook:check; not there is not run. */
function outcomeOn(id: string, checks: readonly CheckResult[], playbookChecks: readonly PlaybookCheckResult[] | undefined): CheckOutcome | 'unknown' {
  if (id.includes(':')) {
    const found = (playbookChecks ?? []).find(result => `${result.playbook}:${result.check}` === id);
    return found ? outcomeOfPlaybookCheck(found) : 'not-run';
  }
  const found = checks.find(result => result.check === id);
  return found ? outcomeOfCheck(found) : 'not-run';
}

/**
 * The fields a landing revision sets on the run, in the commit that stores the new draft (delivery/runs.ts): the
 * revision is done, the agent's new version is merged by paragraph with the owner's (the owner's own words stay; the
 * merged text is editedText when it differs from the agent's), and a fix's checks give it its status. Nothing for a
 * draft that was not a revision.
 */
export function landRevision(
  current: DeliveryRunRecord, landed: { renderedText: string; checks: readonly CheckResult[]; playbookChecks?: readonly PlaybookCheckResult[] }, at: string,
): Partial<Pick<DeliveryRunRecord, 'revision' | 'merge' | 'editedText' | 'fix'>> {
  const revision = current.revision;
  if (!revision) return {};
  if(revision.socialPost)return {revision:null,editedText:null,merge:null};
  const base = revision.base;
  const owner = current.editedText ?? base;
  const parts = mergeParagraphs(base, owner, landed.renderedText);
  const text = mergedText(parts);
  // Compared paragraph by paragraph: blank lines and spaces at line ends are not an edit of the owner's.
  const same = (a: string, b: string) => joinParagraphs(paragraphs(a)) === joinParagraphs(paragraphs(b));
  const edited = !same(owner, base);
  const fix: DraftFix | null = revision.by === 'fix' && revision.checks?.length
    ? { checks: [...revision.checks], status: fixStatus(revision.checks.map(id => outcomeOn(id, landed.checks, landed.playbookChecks))), at }
    : current.fix ?? null;
  return {
    revision: null, editedText: same(text, landed.renderedText) ? null : text, fix,
    merge: { at, edited, owner, parts, replacement: null },
  };
}

// ---------------------------------------------------------------------------
// venture.delivery.fix
// ---------------------------------------------------------------------------

/** The checks that failed on a draft: harness checks by id, flagship checks as playbook:check, each with its detail. */
export function failedChecks(run: Pick<DeliveryRunRecord, 'checks' | 'playbookChecks'>): { id: string; detail: string }[] {
  const harness = run.checks.filter(result => !result.passed && !result.notChecked).map(result => ({ id: result.check as string, detail: result.detail }));
  const playbook = (run.playbookChecks ?? []).filter(result => result.outcome === 'fail').map(result => ({ id: `${result.playbook}:${result.check}`, detail: result.detail }));
  return [...harness, ...playbook];
}

/**
 * venture.delivery.fix { runId, checks: 'all' | ids } (approve, app only): after checks failed on a draft, the run gets a
 * scoped native revision that names those checks and what each found. The checks run again
 * before the revised draft returns for review, and the fix reads Fixed, Partially fixed, Not fixed or Unverified.
 */
export async function deliveryFixHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DeliveryRunView> {
  requireAppChannel(ctx, 'venture.delivery.fix');
  const body = exactPayload(payload, ['runId', 'checks'], ['runId', 'checks']);
  const runId = identifier(body.runId, 'Draft reply');
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = findRecord(state, 'venture-delivery-run', runId);
  check(run && run.ventureId === venture.id, 'DELIVERY_NOT_FOUND', 'That draft reply was not found.');
  check(run.status === 'ready-for-review', 'DELIVERY_NOT_READY', NOT_READY);
  const failed = failedChecks(run);
  check(failed.length > 0, 'INVALID_VENTURE_REQUEST', 'Nothing failed on this draft, so there is nothing to fix.');
  let picked: { id: string; detail: string }[];
  if (body.checks === 'all') picked = failed;
  else {
    check(Array.isArray(body.checks) && body.checks.length > 0 && body.checks.every(id => typeof id === 'string'), 'INVALID_VENTURE_REQUEST', "Choose all, or the checks to fix.");
    const ids = body.checks as string[];
    check(new Set(ids).size === ids.length, 'INVALID_VENTURE_REQUEST', 'Name each check once.');
    picked = ids.map(id => {
      const found = failed.find(item => item.id === id);
      if (!found) throw new ChausarError('INVALID_VENTURE_REQUEST', 'That check did not fail on this draft.');
      return found;
    });
  }
  const words = revisionWords(`fix what these checks found. ${picked.map(item => `${item.id}: ${item.detail}`).join(' ')}`.slice(0, 2000));
  return startRevision(deps, ctx, { runId, words, by: 'fix', rowId: null, checks: picked.map(item => item.id) }, tx => {
    recordDecision(tx, { subject: `run:${runId}`, action: 'fix', who: 'owner', ruleId: null, reason: `You asked the agent to fix: ${picked.map(item => item.id).join(', ')}.`, rowId: null });
  });
}

/** The open business's run by id, for the other 4J2 methods. */
export function revisableRun(state: State, venture: VentureRecord, runId: string): DeliveryRunRecord {
  const run = findRecord(state, 'venture-delivery-run', runId);
  check(run && run.ventureId === venture.id, 'DELIVERY_NOT_FOUND', 'That draft reply was not found.');
  return run;
}
