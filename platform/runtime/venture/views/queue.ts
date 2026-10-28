// Chausar venture launcher, views (P1-A): Today's queue. venture.queue.list and venture.queue.decide.
//
// Why scope 'all' shows the other businesses as locked rows, not their own rows: each business is its own encrypted
// vault and the engine keeps exactly one open. Vault.open takes that vault's exclusive writer lock and unwraps its key
// with a slow key derivation from the passphrase or this computer's secret; there is no read-only open, and the
// venture host serves one store. Reading another business would need a new read-only path in vault.ts and the
// engine's custody code, a key derivation per business on every read, and lock contention with that business when it
// is open elsewhere. So 'all' returns the open business's rows plus one locked row per other business on this
// computer, whatever its lock, and opening one is a business switch (workspace.open) from the business menu.
//
// Rows come only from real pending things: a plan or price change to accept, setup the owner has not done, a builder
// opened with no repo followed, delivery runs waiting on the owner, and invoice drafts. The AI-native CA firm playbook
// (venture/playbooks/ca-firm/signoff.ts) makes 'signoff' rows: regulated papers and rate-table versions are sent to the
// CA of record, then signed or confirmed with the CA's ICAI membership number. Each row's digest is sha256 over its
// canonical JSON. A decision runs the engine method that does the real thing, once per row id, and records who decided.
// A tool call the policy held (venture/policy) is a question with Let it run once and Keep on hold; a run a spot check
// picked at auto with spot checks waits as a draft row until the owner says it looks right or needs work. A paid call
// above the ask-first figure is a 'quote' row (money/spend.ts), a proposed post a 'connector' row decided through
// build/posting.ts, and the evidence ledger's suggestions and asks are 'question' rows (evidence/ledger.ts). A run
// whose next call would cross its spend cap is a 'quote' row asking for one more window (delivery/harness/loop.ts).
// A bank statement row that looks like an invoice's payment, and what a statement's alert rules found, are 'bank' rows
// (build/bank-methods.ts); away from the app an alert row carries its count only.
// Ink v2 wave 4 (package 4-0): five more row sources (proposals, follow-ups, replies, notices, run controls) whose
// decisions go to views/queue-w4.ts, and three hooks that run after the digests: meta (row-meta.ts), previews
// (previews.ts) and the owner's triage order (triage.ts). Each package fills its own file; none edits this one.
import { authorize, ChausarError, check, type Context, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import {
  currentVenture, digest, exactPayload, formatMicros, formatVentureDate, listRecords, plainText, requireAppChannel, ventureAction,
} from '../records.ts';
import { DELIVERY_REASONS, QUEUE_ACTION_IDS } from '../contracts.ts';
import type {
  DeliveryReason, DeliveryRunRecord, Display, EvidenceRecord, HarnessState, InvoiceRecord, MicroString, Offer, QueueAction, QueueActionId,
  QueueDecision, QueueDecisionRecord, QueueKind, QueueList, QueueRow, VentureBusinessRef, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { blueprintAccept } from '../core/blueprint.ts';
import { issueInvoice } from '../money/invoices.ts';
import { latestBlueprint } from '../money/shared.ts';
import {
  approveDelivery, deliveryAnswerHandler, deliveryDelegateHandler, deliveryReviewHandler, deliveryRunHandler, runView,
} from '../delivery/runs.ts';
import { judgeNotice, judgeStateLine } from '../delivery/judge-run.ts';
import { DELEGATE_LABELS } from '../delivery/harness/delegate.ts';
import { allowCapWindow, capWindow, openDelegation } from '../delivery/harness/loop.ts';
import { acceptedBlueprintOrNull, previewShownWhole } from '../delivery/shared.ts';
import { HOLD_APPROVE_ANSWER, HOLD_DECLINE_ANSWER, holdOfHandoff } from '../policy/holds.ts';
import { pendingSpotChecks, reviewSpotCheck } from '../policy/spot-check.ts';
import { caFirmQueueItems } from '../playbooks/ca-firm/signoff.ts';
import { sendRunToCa, waitsToGoToCa } from '../playbooks/ca-firm/delivery-signoff.ts';
import { approveSpendQuote, openSpendQuotes, quoteLive, rupeeFigure, rupeesBeside, rupeesOf, spendAgentOf, type Rupees } from '../money/spend.ts';
import { connectorQueueRows, decideConnectorRow } from '../build/posting.ts';
import { evidenceApply, evidenceQuestions, recordEvidence } from '../evidence/ledger.ts';
import { bankQueueItems } from '../build/bank-methods.ts';
import { AGENT_ID, agentName, businessOf, clientNameFor, lastEventAt, plain, short } from './shared.ts';
import { agentWordsLabeller } from './agent-words.ts';
import { decideW4Row, type W4RowSource, type W4RowSourceFn } from './queue-w4.ts';
import { withMeta } from './row-meta.ts';
import { withPreviews } from './previews.ts';
import { withTriage } from './triage.ts';
import { noticeRows } from './probes.ts';
import { proposalRows } from '../chief/rows.ts';
import { followupRows } from '../network/followup-rows.ts';
import { replyRows } from '../network/inbound-rows.ts';
import { runControlRows } from '../delivery/run-control-rows.ts';
import { moneyRows } from '../money/credits.ts';
import { routineRows } from '../agents/routine-runner.ts';
import { shareWords } from '../money/share-price.ts';

export const STALE_LINE = 'This click did not run anything. Here is the new version.';
export const GONE_LINE = 'This was resolved elsewhere.';
const NOT_A_DECISION: Partial<Record<QueueActionId, string>> = {
  watch: 'Open it to watch it.', read: 'Open it to read it.', connect: 'Connect it under Connections.',
  'set-prices': 'Set your prices in the business menu.', keep: 'Keep this business safe in the business menu.', open: 'Open it from the business menu.',
};
const BUILDERS: Readonly<Record<string, string>> = { lovable: 'Lovable', replit: 'Replit', bolt: 'Bolt', v0: 'v0' };
/** The plan and setup rows lead Today, in this order; other rows made at the same moment keep it too. */
const LEAD: readonly QueueKind[] = ['plan', 'price', 'setup'];
const RANK: Readonly<Record<QueueKind, number>> ={
  plan: 0, price: 0, setup: 1, connector: 2, quote: 3, question: 3, draft: 3, signoff: 3, bank: 3, invoice: 4, locked: 9,
  proposal: 3, followup: 3, reply: 3, notice: 5,
};

type Input = { answer: string | null };
type Outcome = { line: Display; receiptId?: string };
type Perform = (deps: VentureDeps, ctx: Context, input: Input) => Promise<Outcome>;
/** A row before its digest, with what each decision on it does. Navigation actions have no performer. */
type Pending = { row: Omit<QueueRow, 'digest'>; subject: string; perform: Partial<Record<QueueActionId, Perform>>; navigate?: string };

const action = (id: QueueActionId, label: string, primary: boolean, extra: { secondAsk?: boolean; requiresView?: boolean } = {}): QueueAction =>
  ({ id, label, primary, ...(extra.secondAsk ? { secondAsk: true } : {}), ...(extra.requiresView ? { requiresView: true } : {}) });
/** Id parts keep to the identifier alphabet, so a row id always passes the payload check. */
const part = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
/** A row's id: its subject, then its version in the identifier alphabet (4G2's probes read it to tell decided rows). */
export const rowId = (subject: string, version: string) => `${subject}:${part(version)}`;
const subjectOf = (id: string) => id.slice(0, Math.max(0, id.lastIndexOf(':')));

/** The id of the Today row that answers a run's open question; the run sheet uses it as the question id. */
export function questionRowId(runId: string, harness: HarnessState): string {
  return rowId(`run:${part(runId)}`, `q${harness.handoffs.length}`);
}

type Business = { id: string; name: string };
const base = (business: Business, kind: QueueKind, subject: string, version: string, createdAt: string) =>
  ({ id: rowId(subject, version), businessId: business.id, businessName: business.name, kind, createdAt });

// ---------------------------------------------------------------------------
// Plan and price rows
// ---------------------------------------------------------------------------

function priceText(offer: Offer | undefined, currency: string): string {
  // Ink v2 wave 5 (5A2): an offer priced as a share of an amount the client confirms later (money/share-price.ts).
  if (offer?.pricing.share) return shareWords(offer.pricing.share.bps);
  const minor = offer?.pricing.unitPriceMinor ?? null;
  return minor === null ? 'Not set' : `${formatMinor(minor, currency)} per ${offer!.pricing.quantityUnit}`;
}

function planRows(state: State, venture: VentureRecord, business: Business): Pending[] {
  const latest = latestBlueprint(listRecords(state, 'venture-blueprint', venture.id));
  if (!latest || latest.status !== 'draft') return [];
  const accepted = acceptedBlueprintOrNull(state, venture);
  const subject = `plan:${part(venture.id)}`;
  const accept: Perform = async (deps, ctx) => { await blueprintAccept(deps, ctx, { digest: latest.digest }); return { line: 'Plan accepted.' }; };
  const viewRef = { kind: 'plan' as const, id: latest.id };
  if (!accepted) {
    return [{
      subject, perform: { approve: accept },
      row: { ...base(business, 'plan', subject, latest.id, latest.at), title: 'Your plan is ready. Read it.', line: short(latest.oneLiner.value), viewRef,
        actions: [action('read', 'Read', false), action('approve', 'Accept', true, { requiresView: true })] },
    }];
  }
  const currency = latest.backOffice.currency;
  const changes = latest.offers.filter(offer => {
    const before = accepted.offers.find(item => item.id === offer.id);
    // 5A2: setting or changing a share is a price change too, so it asks twice like any other.
    return (before?.pricing.unitPriceMinor ?? null) !== offer.pricing.unitPriceMinor || (before?.pricing.share?.bps ?? null) !== (offer.pricing.share?.bps ?? null);
  });
  if (!changes.length) {
    return [{
      subject, perform: { approve: accept },
      row: { ...base(business, 'plan', subject, latest.id, latest.at), title: 'Your plan changed. Read it, then accept it.', line: short(latest.oneLiner.value), viewRef,
        actions: [action('read', 'Read', false), action('approve', 'Accept', true, { requiresView: true })] },
    }];
  }
  const [first, ...rest] = changes;
  const name = first.name.value;
  // Changing prices always asks twice; the change is on the row itself, so it needs no separate read.
  return [{
    subject, perform: { approve: accept },
    row: {
      ...base(business, 'price', subject, latest.id, latest.at), title: changes.length === 1 ? `New price for ${name}` : 'New prices in your plan',
      line: rest.length ? `Also changes ${rest.map(offer => offer.name.value).join(', ')}.` : 'Accept the plan to use it on new orders and invoices.',
      change: { label: name, before: priceText(accepted.offers.find(item => item.id === first.id), currency), after: priceText(first, currency) },
      viewRef, actions: [action('read', 'Read', false), action('approve', 'Accept', true, { secondAsk: true })],
    },
  }];
}

// ---------------------------------------------------------------------------
// Setup and connector rows
// ---------------------------------------------------------------------------

/** 'none': templates serve every job. A reason: an AI is connected but cannot be used now. null: nothing to do. */
export function aiState(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord): { kind: 'none' } | { kind: 'attention'; reason: string } | null {
  try {
    const { tiers } = deps.models.status(ctx);
    if (tiers.main.presetId === 'built-in-templates' && tiers.fast.presetId === 'built-in-templates') return { kind: 'none' };
    const broken = [tiers.main, tiers.fast].find(tier => tier.presetId !== 'built-in-templates' && !tier.usable);
    return broken ? { kind: 'attention', reason: broken.reason } : null;
  } catch {
    // The models package could not answer: fall back to the stored connections.
    const connected = listRecords(state, 'venture-model-connection', venture.id).some(item => item.status === 'connected' && item.presetId !== 'built-in-templates');
    return connected ? null : { kind: 'none' };
  }
}

async function setupRows(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, business: Business): Promise<Pending[]> {
  const rows: Pending[] = [];
  const ai = aiState(deps, ctx, state, venture);
  if (ai) {
    rows.push({
      subject: 'setup:ai', perform: {}, navigate: 'Connect your AI under Connections.',
      row: ai.kind === 'none'
        ? { ...base(business, 'setup', 'setup:ai', 'none', venture.at), title: 'Connect your AI', line: 'Templates work without one. Your agents draft with your AI once it is connected.', actions: [action('connect', 'Connect', true)] }
        : { ...base(business, 'setup', 'setup:ai', 'attention', venture.at), title: 'Your AI needs attention', line: short(ai.reason), actions: [action('connect', 'Open', true)] },
    });
  }
  const latest = latestBlueprint(listRecords(state, 'venture-blueprint', venture.id));
  const unpriced = latest ? latest.offers.filter(offer => offer.pricing.unitPriceMinor === null && !offer.pricing.share).map(offer => offer.name.value) : [];
  // Tax counts as set only when the owner said yes or no; a default a screen filled in is Chausar's assumption.
  const tax = latest && latest.backOffice.taxRegistered.label !== 'told-by-you' ? latest.backOffice : null;
  if (latest && (unpriced.length || tax)) {
    const names = unpriced.length === 1 ? unpriced[0] : `${unpriced.slice(0, -1).join(', ')} and ${unpriced[unpriced.length - 1]}`;
    const noPrice = `${names} ${unpriced.length === 1 ? 'has' : 'have'} no price yet`;
    const assumed = tax ? `Chausar assumed you ${tax.taxRegistered.value ? 'charge' : 'do not charge'} ${tax.taxLabel}` : '';
    const words = !tax
      ? { title: 'Set your prices', line: `${noPrice}.`, label: 'Set prices', navigate: 'Set your prices in the business menu.' }
      : !unpriced.length
        ? { title: 'Confirm your tax', line: `${assumed}. Say whether you do.`, label: 'Confirm tax', navigate: 'Confirm your tax in the business menu.' }
        : { title: 'Confirm your prices and tax', line: `${noPrice}, and ${assumed}.`, label: 'Confirm', navigate: 'Set your prices and tax in the business menu.' };
    rows.push({
      subject: 'setup:prices', perform: {}, navigate: words.navigate,
      row: { ...base(business, 'setup', 'setup:prices', latest.id, venture.at), title: words.title, line: words.line, actions: [action('set-prices', words.label, true)] },
    });
  }
  let recovery: Awaited<ReturnType<NonNullable<VentureDeps['workspace']>['recovery']>> = null;
  try { recovery = await deps.workspace?.recovery() ?? null; } catch { recovery = null; }
  if (recovery === 'not-made') {
    rows.push({
      subject: 'setup:keep', perform: {}, navigate: 'Keep this business safe in the business menu.',
      row: { ...base(business, 'setup', 'setup:keep', 'not-made', venture.at), title: 'Keep this business', line: 'Make a recovery code so you can open it if this computer is lost.', actions: [action('keep', 'Keep it', true)] },
    });
  }
  return rows;
}

function connectorRows(state: State, venture: VentureRecord, business: Business): Pending[] {
  const follows = listRecords(state, 'venture-build-follow', venture.id);
  const opened = listRecords(state, 'venture-handoff', venture.id).filter(handoff => handoff.openedAt !== null);
  const navigate = 'Follow your build under Connections.';
  if (!follows.length && opened.length) {
    const handoff = opened[opened.length - 1];
    const builder = BUILDERS[handoff.builder] ?? 'your builder';
    return [{
      subject: 'connector:github', perform: {}, navigate,
      row: { ...base(business, 'connector', 'connector:github', `unlinked-${handoff.id}`, handoff.openedAt ?? handoff.at), title: `Link the repo ${builder} made`,
        line: `Follow the build on GitHub so Chausar can read what ${builder} changed.`, actions: [action('connect', 'Link repo', true)] },
    }];
  }
  const follow = follows[follows.length - 1];
  if (follow?.lastStatus?.word === 'repo-not-readable') {
    return [{
      subject: 'connector:github', perform: {}, navigate,
      row: { ...base(business, 'connector', 'connector:github', `unreadable-${follow.id}`, follow.lastStatus.asOf), title: 'GitHub cannot read your repo',
        line: 'Check the repo name, or give a token that can read it.', actions: [action('connect', 'Fix it', true)] },
    }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Delivery runs and invoices
// ---------------------------------------------------------------------------

function callError(state: State, callId: string | null): string | null {
  if (!callId) return null;
  const call = state.conversations.find((record: { id?: unknown } | null) => record?.id === callId) as { error?: { message?: unknown } | null } | undefined;
  return typeof call?.error?.message === 'string' ? call.error.message : null;
}

/** Why a run stopped, in the engine's own words; plain words when it kept none. */
export function runError(state: State, run: DeliveryRunRecord): string {
  return callError(state, run.callId) ?? run.harness?.stopReason ?? 'This run stopped before it finished. Nothing was sent to the client.';
}

const reviewReason = (answer: string | null): DeliveryReason =>
  answer !== null && (DELIVERY_REASONS as readonly string[]).includes(answer) ? answer as DeliveryReason : 'other';

function runRows(deps: VentureDeps, state: State, venture: VentureRecord, business: Business, ctx: Context): Pending[] {
  const nowMs = deps.clock().getTime();
  const agent = agentName(state, venture);
  const rupees = rupeesOf(state, venture);
  const times = lastEventAt(state, venture.id);
  const runs = listRecords(state, 'venture-delivery-run', venture.id);
  const orders = new Map(listRecords(state, 'venture-order', venture.id).map(order => [order.id, order]));
  const newestPerOrder = new Map<string, DeliveryRunRecord>();
  for (const run of runs) { const known = newestPerOrder.get(run.orderId); if (!known || run.at >= known.at) newestPerOrder.set(run.orderId, run); }
  const rows: Pending[] = [];
  for (const record of runs) {
    const run = runView(record, venture, nowMs, state);
    const client = clientNameFor(state, venture.id, run.orderId);
    const subject = `run:${part(run.id)}`;
    const at = times.get(run.id) ?? run.at;
    const viewRun = { kind: 'run' as const, id: run.id };
    const newest = newestPerOrder.get(run.orderId)?.id === run.id && orders.get(run.orderId)?.status === 'open';
    if (run.status === 'waiting-for-you' && run.canApprove && run.preview) {
      const preview = run.preview;
      const notice = judgeNotice(deps, ctx, state, venture, record)?.line;
      rows.push({
        // This row's digest binds its line, the judge's notice included, so approving it here gives the judge's consent.
        subject, perform: { approve: async (d, ctx) => { await approveDelivery(d, ctx, { runId: run.id, digest: preview.digest }, { judgeNoticeShown: notice ?? null }); return { line: 'Sent to your AI.' }; } },
        row: { ...base(business, 'quote', subject, `send-${run.callId ?? preview.callId}`, at), agent, title: `Send the next step for ${client} to your AI`,
          // The most it can cost is worked out by code from the price table, so it is not a model estimate; the display
          // itself says 'estimate, price unconfirmed' when the table is unconfirmed.
          // A write turn the judge then reads on its own, before its standing consent exists, says so (judge-run.ts).
          line: `Read the exact text first. Nothing goes to the client.${notice ? ` ${notice}` : ''}`,
          change: { label: 'Most it can cost', after: preview.estimatedMaxCostDisplay },
          viewRef: viewRun, actions: [action('read', 'Read', false), action('approve', 'Approve', true, { requiresView: true })],
          // A send to the owner's AI (W1 H21): complete only when the run's view shows the whole text.
          descriptionComplete: previewShownWhole(preview) },
      });
    } else if (run.status === 'waiting-for-you' && run.awaitingYou && run.harness && run.preview && run.callId && capWindow(run.harness, run.preview.estimatedMaxCostMicros)) {
      // The next call would cross the run's spend cap, so it was held back: more room, on the second ask.
      const callId = run.callId;
      rows.push({
        subject, perform: { approve: async (d, ctx) => { await allowRunWindow(d, ctx, run.id, callId); return { line: 'More room allowed. Approve the next step when you are ready.' }; } },
        row: { ...base(business, 'quote', subject, `cap-${callId}`, at), agent, title: `${agent} reached its spend cap for this run`,
          ...roomWords(run.harness, capWindow(run.harness, run.preview.estimatedMaxCostMicros)!, rupees),
          viewRef: viewRun, actions: [action('later', 'Not now', false), action('approve', 'Allow', true, { secondAsk: true })] },
      });
    } else if (run.status === 'waiting-for-you' && newest && run.preview && Date.parse(run.preview.expiresAt) <= nowMs) {
      rows.push({
        subject, perform: { 'run-again': async (d, ctx) => { await deliveryRunHandler(d, ctx, { orderId: run.orderId }); return { line: 'Started again.' }; } },
        row: { ...base(business, 'draft', subject, `expired-${run.callId ?? 'none'}`, run.preview.expiresAt), agent, title: `The draft for ${client} needs to start again`,
          line: 'The text waiting for your approval expired before it was sent.', viewRef: viewRun, actions: [action('later', 'Later', false), action('run-again', 'Run again', true)] },
      });
    } else if (run.status === 'needs-answer' && run.awaitingYou && run.harness) {
      const open = [...run.harness.handoffs].reverse().find(handoff => handoff.answer === null);
      const hold = open ? holdOfHandoff(run.harness, run.harness.handoffs.indexOf(open)) : null;
      if (hold) {
        const reply = (answer: string, line: string): Perform => async (d, ctx) => { await deliveryAnswerHandler(d, ctx, { runId: run.id, answer }); return { line }; };
        rows.push({
          subject, perform: { approve: reply(HOLD_APPROVE_ANSWER, 'It runs once, in the next step.'), deny: reply(HOLD_DECLINE_ANSWER, 'Kept on hold. The agent goes on without it.') },
          row: { id: questionRowId(run.id, run.harness), businessId: business.id, businessName: business.name, kind: 'question', createdAt: at, agent,
            title: `${agent} wants to run a step on hold for ${client}`, line: short(agentWordsLabeller(state, venture, run)(open!.question), 300),
            viewRef: viewRun, actions: [action('deny', 'Keep on hold', false), action('approve', 'Let it run once', true)],
            // The view names the held tool and why, not its exact input (W1 H21).
            descriptionComplete: false },
        });
        continue;
      }
      rows.push({
        subject, perform: { answer: async (d, ctx, input) => { await deliveryAnswerHandler(d, ctx, { runId: run.id, answer: input.answer }); return { line: 'Your answer went to the agent.' }; } },
        row: { id: questionRowId(run.id, run.harness), businessId: business.id, businessName: business.name, kind: 'question', createdAt: at, agent,
          // The agent's own words show a number with no receipt as a model estimate (agent-words.ts).
          title: `${agent} has a question about ${client}'s order`, line: short(open ? agentWordsLabeller(state, venture, run)(open.question) : 'The agent needs your answer to carry on.', 300),
          viewRef: viewRun, actions: [action('answer', 'Answer', true)] },
      });
    } else if (run.status === 'brief-waiting' && run.awaitingYou && run.harness) {
      const open = openDelegation(run.harness);
      if (!open) continue;
      const decision = (choice: 'approve' | 'decline'): Perform => async (d, ctx) => {
        await deliveryDelegateHandler(d, ctx, { runId: run.id, digest: open.digest, decision: choice });
        return { line: choice === 'approve' ? `${DELEGATE_LABELS[open.cli]} ran the brief.` : 'Brief declined. Nothing was started.' };
      };
      rows.push({
        subject, perform: { approve: decision('approve'), deny: decision('decline') },
        row: { ...base(business, 'draft', subject, `brief-${open.toolCallId}`, at), agent, title: `${agent} wants ${DELEGATE_LABELS[open.cli]} to work on ${client}'s order`,
          line: "Read the brief. It runs on this computer with only this order's files.", viewRef: viewRun,
          actions: [action('deny', 'Decline', false), action('approve', 'Approve', true, { requiresView: true })] },
      });
    } else if (run.status === 'ready-for-review' && run.awaitingYou) {
      const review = (verdict: 'accepted' | 'rejected'): Perform => async (d, ctx, input) => {
        await deliveryReviewHandler(d, ctx, verdict === 'accepted' ? { runId: run.id, verdict } : { runId: run.id, verdict, reason: reviewReason(input.answer) });
        return { line: verdict === 'accepted' ? 'Draft accepted. You send it to the client.' : 'Draft rejected. The agent learns from it.' };
      };
      const viewDraft = { kind: 'draft' as const, id: run.id };
      // AI-native CA firm: papers held only for the CA's sign-off, not yet with the CA, go to the CA from this row.
      const toCa = !run.canAccept && waitsToGoToCa(state, venture, record, nowMs);
      const sendToCaPerform: Perform = async (d, ctx) => sendRunToCa(d, ctx, run.id);
      const blocked = toCa ? { deny: review('rejected'), 'send-to-ca': sendToCaPerform } : { deny: review('rejected') };
      rows.push({
        subject, perform: run.canAccept ? { approve: review('accepted'), deny: review('rejected') } : blocked,
        row: run.canAccept
          ? { ...base(business, 'draft', subject, run.reopened ? `review-${run.reopened.count + 1}` : 'review', at), agent, title: `Draft reply for ${client}`, viewRef: viewDraft,
            // Where the judge stands, so a verdict that is not in never reads like a pass (judge-run.ts).
            line: [`Read it, then approve it. You send it yourself.`, judgeStateLine(state, venture, record, nowMs)].filter(Boolean).join(' '),
            actions: [action('read', 'Read', false), action('approve', 'Approve', true, { requiresView: true })] }
          : { ...base(business, 'draft', subject, toCa ? 'review-to-ca' : 'review-blocked', at), agent, title: `Draft reply for ${client}`, line: short(run.acceptBlocked ?? 'Read it and tell the agent what to change.'), viewRef: viewDraft,
            actions: toCa
              ? [action('deny', 'Reject', false), action('read', 'Read', false), action('send-to-ca', 'Send to CA', true, { requiresView: true })]
              : [action('deny', 'Reject', false), action('read', 'Read', true)] },
      });
    } else if (run.status === 'failed' && newest) {
      rows.push({
        subject, perform: { 'run-again': async (d, ctx) => { await deliveryRunHandler(d, ctx, { orderId: run.orderId }); return { line: 'Started again.' }; } },
        row: { ...base(business, 'draft', subject, 'failed', at), agent, title: `The draft for ${client} failed`, line: short(runError(state, run), 300), viewRef: viewRun,
          actions: [action('later', 'Later', false), action('run-again', 'Run again', true)] },
      });
    }
  }
  return rows;
}

/**
 * The owner allowed one more window for a run whose next call would cross its spend cap: the cap rises once, by the
 * figure the row showed, worked out again here. The run must still wait on that same call; otherwise it is stale.
 */
async function allowRunWindow(deps: VentureDeps, ctx: Context, runId: string, callId: string): Promise<void> {
  await ventureAction(deps, ctx, 'approve', 'delivery.cap', tx => {
    const current = tx.find('venture-delivery-run', runId);
    check(current && current.status === 'waiting-for-you' && current.callId === callId && current.harness && current.preview, 'APPROVAL_STALE', STALE_LINE);
    tx.replace({ ...current, harness: allowCapWindow(current.harness, current.preview.estimatedMaxCostMicros, tx.now, ctx.memberId) });
    tx.emit('run.step', { runId });
  });
}

/**
 * Today's words for more room on a run: one window of its own cap, or more spend for the run when it takes several.
 * With the owner's rupee rate, the room is said in rupees too, beside the dollars, with that rate.
 */
function roomWords(harness: HarnessState, window: MicroString, rupees: Rupees | null): Pick<QueueRow, 'line' | 'change'> {
  const figure = formatMicros(window);
  const said = rupees ? `${figure}, ${rupeesBeside(window, rupees)}` : figure;
  const after = rupees ? `${figure} · ${rupeeFigure(window, rupees)}` : figure;
  return BigInt(window) <= BigInt(harness.limits.maxCostMicros)
    ? { line: `Allow one more window of ${said}?`, change: { label: 'One more window', after } }
    : { line: `Allow more spend for this run: ${said}`, change: { label: 'More spend for this run', after } };
}

/** Runs a spot check picked at auto with spot checks: each waits until the owner says it looks right or needs work. */
function spotRows(state: State, venture: VentureRecord, business: Business): Pending[] {
  const runs = new Map(listRecords(state, 'venture-delivery-run', venture.id).map(run => [run.id, run]));
  return pendingSpotChecks(state, venture).map((spot): Pending => {
    const run = runs.get(spot.runId);
    const subject = `spot:${part(spot.id)}`;
    const review = (verdict: 'looks-right' | 'needs-work', line: string): Perform => async (d, ctx) => { await reviewSpotCheck(d, ctx, spot.id, verdict); return { line }; };
    return {
      subject, perform: { approve: review('looks-right', 'Spot check recorded: it looks right.'), deny: review('needs-work', 'Spot check recorded: it needs work.') },
      row: { ...base(business, 'draft', subject, 'review', spot.at), agent: agentName(state, venture),
        title: `Spot check: the draft for ${run ? clientNameFor(state, venture.id, run.orderId) : 'a client'}`, line: short(spot.line, 300),
        viewRef: { kind: 'run', id: spot.runId }, actions: [action('deny', 'Needs work', false), action('approve', 'Looks right', true, { requiresView: true })] },
    };
  });
}

function invoiceRows(state: State, venture: VentureRecord, business: Business): Pending[] {
  const orders = new Map(listRecords(state, 'venture-order', venture.id).map(order => [order.id, order]));
  return listRecords(state, 'venture-invoice', venture.id)
    .filter((invoice: InvoiceRecord) => invoice.status === 'draft' && orders.get(invoice.orderId)?.status !== 'cancelled')
    .map((invoice: InvoiceRecord): Pending => {
      const client = listRecords(state, 'venture-client', venture.id).find(item => item.id === invoice.clientId)?.name ?? 'a client';
      const subject = `invoice:${part(invoice.id)}`;
      const due = invoice.dueDate ? `, due ${formatVentureDate(invoice.dueDate, venture.country.dateOrder)}` : '';
      return {
        subject,
        perform: {
          issue: async (deps, ctx) => {
            const view = await issueInvoice(deps, ctx, { invoiceId: invoice.id, digest: invoice.digest });
            return { line: `Issued ${view.invoice.number}.`, ...(view.invoice.booksReceiptId ? { receiptId: view.invoice.booksReceiptId } : {}) };
          },
        },
        row: {
          ...base(business, 'invoice', subject, invoice.digest.slice(0, 16), invoice.at), title: `Invoice for ${client}`, line: `${invoice.documentTitle}${due}`,
          change: { label: 'Total', after: formatMinor(invoice.totalMinor, invoice.currency), receiptId: invoice.priceReceiptId },
          viewRef: { kind: 'file', id: invoice.id }, actions: [action('read', 'Read', false), action('issue', 'Issue', true, { secondAsk: true })],
        },
      };
    });
}

/** Regulated papers and rate tables waiting for the CA of record (P3-ca-firm): Send to CA, then the CA signs or confirms. */
function signoffRows(state: State, venture: VentureRecord, business: Business): Pending[] {
  return caFirmQueueItems(state, venture).map((item): Pending => ({
    subject: item.subject, perform: item.perform,
    row: {
      ...base(business, 'signoff', item.subject, item.version, item.createdAt), title: item.title, line: item.line, actions: item.actions,
      ...(item.viewRef ? { viewRef: item.viewRef } : {}),
    },
  }));
}

// ---------------------------------------------------------------------------
// Spend quotes, posts and evidence questions
// ---------------------------------------------------------------------------

/**
 * A paid call above the owner's ask-first figure waits as a quote (money/spend.ts). Approve sends back exactly the
 * draft digest, figure and payer the row showed, so a changed quote is refused. A quote lives for one hour; after
 * that it leaves Today, and the next try of the call makes a fresh one.
 */
function quoteRows(deps: VentureDeps, state: State, venture: VentureRecord, business: Business): Pending[] {
  const now = deps.clock().toISOString();
  const agent = agentName(state, venture);
  return openSpendQuotes(state).filter(quote => quoteLive(quote, now)).map((quote): Pending => {
    const subject = `spend-quote:${part(quote.id)}`;
    const approve: Perform = async (d, ctx) => {
      await approveSpendQuote(d, ctx, { quoteId: quote.id, draftDigest: quote.draftDigest, figureMicros: quote.figureMicros, payer: quote.payer });
      return { line: 'Cost approved. It can run once in the next hour.' };
    };
    return {
      subject, perform: { approve },
      row: {
        ...base(business, 'quote', subject, 'open', quote.at), ...(spendAgentOf(state, quote) === AGENT_ID ? { agent } : {}),
        title: `Approve the cost of ${quote.label}`, line: 'It may cost more than the amount you asked to see first. One approval pays for this one call.',
        change: { label: 'It may cost', after: quote.figure },
        actions: [action('later', 'Not now', false), action('approve', 'Approve', true, { secondAsk: true })],
      },
    };
  });
}

/** Posts an agent or the owner proposed (build/posting.ts). A decision goes to decideConnectorRow, which posts at most once. */
function postRows(state: State, business: Business): Pending[] {
  return connectorQueueRows(state).map((post): Pending => {
    const subject = `post:${part(post.id)}`;
    const decide = (choice: 'approve' | 'deny'): Perform => async (d, ctx) => {
      const decision = await decideConnectorRow(d, ctx, { id: post.id, digest: post.digest, action: choice });
      if (decision.outcome === 'stale') throw new ChausarError('APPROVAL_STALE', decision.line);
      if (decision.outcome === 'refused') throw new ChausarError(decision.reason ?? 'POST_ALREADY_DECIDED', decision.line);
      return { line: decision.line };
    };
    const approve = post.actions.find(item => item.id === 'approve');
    const deny = post.actions.find(item => item.id === 'deny');
    return {
      subject, perform: { approve: decide('approve'), deny: decide('deny') },
      row: {
        ...base(business, 'connector', subject, post.digest.slice(0, 16), post.createdAt), ...(post.agent ? { agent: post.agent } : {}),
        title: post.title, ...(post.line ? { line: post.line } : {}), ...(post.viewRef ? { viewRef: post.viewRef } : {}),
        actions: [
          action('deny', deny?.label ?? 'Do not post', false),
          action('approve', approve?.label ?? 'Approve and post', true, { secondAsk: approve?.secondAsk ?? true, requiresView: approve?.requiresView ?? true }),
        ],
        // A post is an outside action: Today says when part of what it sends is not shown (W1 H21).
        descriptionComplete: post.descriptionComplete === true,
      },
    };
  });
}

const FIELD_WORDS: Readonly<Record<string, string>> = {
  name: 'name', email: 'email', note: 'note', oneLiner: 'one-line description', customer: 'customer', description: 'description',
  postalAddress: 'postal address', taxId: 'tax number',
};
/** A ledger field in plain words: 'email', 'postal address', 'offer name'. */
function fieldWords(field: string): string {
  const [head, ...rest] = field.split('.');
  const last = rest.length ? rest[rest.length - 1] : head;
  // An own entry only: a name every object has (toString, constructor) is spelled out like any other field.
  const words = Object.hasOwn(FIELD_WORDS, last) ? FIELD_WORDS[last] : last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return rest.length && /^offer/i.test(head) ? `offer ${words}` : words;
}
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * What the evidence ledger asks the owner (evidence/ledger.ts): a weaker value than the one stored, to use or correct,
 * and a field Chausar cannot see, to fill in. Use it runs venture.evidence.apply; an answer is kept as the owner's
 * own entry, which is verified and becomes the stored value.
 */
function evidenceRows(state: State, venture: VentureRecord, business: Business): Pending[] {
  const records = listRecords(state, 'venture-evidence', venture.id);
  const clients = new Map(listRecords(state, 'venture-client', venture.id).map(item => [item.id, item]));
  const agent = agentName(state, venture);
  return evidenceQuestions(state, venture.id).map((record: EvidenceRecord): Pending => {
    const subject = `evidence:${part(record.id)}`;
    const words = fieldWords(record.field);
    const client = record.subject.startsWith('client:') ? clients.get(record.subject.slice('client:'.length)) : undefined;
    const who = record.subject === 'business' ? 'your business' : client?.name ?? 'a client';
    const answer: Perform = async (d, ctx, input) => {
      await ventureAction(d, ctx, 'prepare', 'evidence.answer', tx => {
        recordEvidence(tx, { subject: record.subject, field: record.field, value: input.answer ?? '', type: 'owner-entered', by: 'owner', source: 'you answered on Today' });
      });
      return { line: `Kept your ${words}.` };
    };
    const head = { ...base(business, 'question', subject, record.id, record.at), ...(record.by === 'agent' ? { agent } : {}) };
    if (record.claim === 'needs-your-data') {
      return {
        subject, perform: { answer },
        row: { ...head, title: record.subject === 'business' ? `Your business needs its ${words}` : `Add the ${words} for ${who}`,
          line: 'Chausar cannot see this. Type it and it is kept as your own entry.', actions: [action('answer', 'Answer', true)] },
      };
    }
    const current = records.find(item => item.applied && item.subject === record.subject && item.field === record.field);
    const stored = current?.value
      ?? (client && (record.field === 'name' || record.field === 'email' || record.field === 'note') ? client[record.field] ?? undefined : undefined);
    // Weaker evidence cannot replace a checked value on its own. Over a checked value, the owner choosing the
    // suggestion they read is their own entry; otherwise it is applied as the ledger's suggestion.
    const use: Perform = current?.strength === 'verified'
      ? async (d, ctx) => {
        await ventureAction(d, ctx, 'prepare', 'evidence.answer', tx => {
          recordEvidence(tx, { subject: record.subject, field: record.field, value: record.value, type: 'owner-entered', by: 'owner', source: 'you chose the suggestion on Today' });
        });
        return { line: `Using the new ${words}.` };
      }
      : async (d, ctx) => { await evidenceApply(d, ctx, { id: record.id }); return { line: `Using the new ${words}.` }; };
    return {
      subject, perform: { approve: use, answer },
      row: {
        ...head, title: `A new ${words} for ${who}`, line: short(record.source),
        change: { label: capital(words), ...(stored ? { before: stored } : {}), after: record.value, ...(record.type === 'model-inferred' ? { estimate: true } : {}) },
        actions: [action('answer', 'Correct it', false), action('approve', 'Use it', true)],
      },
    };
  });
}

/**
 * Bank rows (build/bank-methods.ts, Ink v2 wave 2): a statement row that looks like an invoice's payment, to record
 * through venture.bank.apply, and the alerts an import raised. Off the app channel an alert row is its count only.
 */
function bankRows(state: State, venture: VentureRecord, business: Business, ctx: Context): Pending[] {
  return bankQueueItems(state, venture, ctx).map((item): Pending => ({
    subject: item.subject, perform: item.perform,
    row: { ...base(business, 'bank', item.subject, item.version, item.createdAt), title: item.title, ...(item.line ? { line: short(item.line, 300) } : {}), actions: item.actions },
  }));
}

// ---------------------------------------------------------------------------
// Ink v2 wave 4 rows (views/queue-w4.ts)
// ---------------------------------------------------------------------------

const W4_SOURCES: readonly (readonly [W4RowSource, W4RowSourceFn])[] = [
  ['notice', async (deps, ctx, state, venture) => (await import('../playbooks/social/revision-due.ts')).revisionDueRows(deps, ctx, state, venture)],
  ['proposal', proposalRows], ['followup', followupRows], ['reply', replyRows], ['notice', noticeRows], ['run-control', runControlRows],
  ['money', moneyRows], // 4J5: credit notes waiting to be issued
  ['routine', routineRows], // 4J13: routine runs waiting for the owner's go-ahead
  // Ink v2 wave 5 (5A1): kit chains that stopped or wait on the client past a stage's waitDays, as notices, loaded on use
  ['notice', async (deps, ctx, state, venture) => (await import('../playbooks/kit/chain.ts')).chainRows(deps, ctx, state, venture)],
  // Ink v2 wave 5 (5A3): published ideas waiting for their grade, loaded on use
  ['idea', async (deps, ctx, state, venture) => (await import('../playbooks/kit/ideas.ts')).ideaGradeRows(deps, ctx, state, venture)],
  // Ink v2 wave 5 (5A2): sales proposals waiting for the owner to read and approve, loaded on use
  ['sales-proposal', async (deps, ctx, state, venture) => (await import('../playbooks/kit/proposal.ts')).salesProposalRows(deps, ctx, state, venture)],
];

/**
 * The wave 4 sources' rows: proposals raised from Chats, follow-ups and replies from the pipeline, needs-you notices and
 * run controls. Every decision on them goes to decideW4Row, except Later, which is recorded here like any row's, and the
 * navigation actions, which answer with the row's navigate line. Each source is told the subjects already on Today
 * (earlier rows, then the sources before it), so 4G2's probes never say again what another row says.
 */
async function w4Rows(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, business: Business, earlier: readonly Pending[] = []): Promise<Pending[]> {
  const pending: Pending[] = [];
  const shownSubjects = new Set(earlier.map(item => item.subject));
  for (const [source, rowsOf] of W4_SOURCES) {
    for (const item of await rowsOf(deps, ctx, state, venture, shownSubjects)) {
      shownSubjects.add(item.subject);
      const { subject, version, createdAt, navigate, ...shown } = item;
      const row: Omit<QueueRow, 'digest'> = { ...base(business, item.kind, subject, version, createdAt), ...shown };
      const perform: Pending['perform'] = {};
      for (const { id } of item.actions) {
        if (id === 'later' || Object.hasOwn(NOT_A_DECISION, id)) continue;
        perform[id] = (d, c, input) => decideW4Row(d, c, { source, row, subject, action: id, answer: input.answer });
      }
      pending.push({ subject, perform, row, ...(navigate ? { navigate } : {}) });
    }
  }
  return pending;
}

/**
 * The wave 4 hooks, after the digests and the engine's order: meta (4J1) and previews (4J3) add fields, the owner's
 * triage rule (4J2) orders the rows. A hook never changes a row's id or digest, and never drops or adds a row: a row it
 * leaves out keeps its place at the end, one it makes up is ignored.
 */
function withW4Hooks(state: State, rows: Built[], now: string): Built[] {
  const original = new Map(rows.map(built => [built.row.id, built]));
  const shown = withTriage(state, withPreviews(state, withMeta(state, rows.map(built => built.row), now)));
  const result: Built[] = [];
  const seen = new Set<string>();
  for (const row of shown) {
    const built = original.get(row.id);
    if (!built || seen.has(row.id)) continue;
    seen.add(row.id);
    result.push({ pending: built.pending, row: { ...row, id: built.row.id, digest: built.row.digest } });
  }
  for (const built of rows) if (!seen.has(built.row.id)) result.push(built);
  return result;
}

// ---------------------------------------------------------------------------
// Other businesses
// ---------------------------------------------------------------------------

const LOCKED_LINE: Readonly<Record<VentureBusinessRef['opens'], string>> = {
  'with-this-computer': 'Open it to see what needs you.',
  'needs-passphrase': 'Open it with its passphrase to see what needs you.',
  'key-missing': 'This computer lost its key. Open it with your recovery code.',
};

function lockedRows(others: VentureBusinessRef[], fallbackAt: string): Pending[] {
  return others.map(business => {
    const name = business.name ?? business.id;
    const subject = `locked:${part(business.id)}`;
    return {
      subject, perform: {}, navigate: `Open ${name} from the business menu.`,
      row: { ...base({ id: business.id, name }, 'locked', subject, business.opens, business.openedAt ?? fallbackAt), title: `${name} is locked.`, line: LOCKED_LINE[business.opens], actions: [action('open', 'Open', true)] },
    };
  });
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

type Built = { pending: Pending; row: QueueRow };

function sealed(pending: Pending): Built {
  const row = plain(pending.row) as Omit<QueueRow, 'digest'>;
  return { pending, row: { ...row, digest: digest(row) } };
}

function decidedIds(state: State, ventureId: string | null): Set<string> {
  // 4J2: a decision the owner undid no longer counts, so its row comes back to decide anew.
  return new Set(ventureId ? listRecords(state, 'venture-queue-decision', ventureId).filter(record => !record.undoneAt).map((record: QueueDecisionRecord) => record.rowId) : []);
}

/** Every row the owner can see now, decided rows left out, oldest first; locked rows last. */
async function buildRows(deps: VentureDeps, ctx: Context, scope: 'current' | 'all'): Promise<{ rows: Built[]; state: State; venture: VentureRecord | null }> {
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = currentVenture(state);
  const business = businessOf(deps, state);
  const pending: Pending[] = [];
  if (venture) {
    pending.push(...planRows(state, venture, business), ...await setupRows(deps, ctx, state, venture, business), ...connectorRows(state, venture, business));
    pending.push(...runRows(deps, state, venture, business, ctx), ...spotRows(state, venture, business), ...invoiceRows(state, venture, business));
    pending.push(...signoffRows(state, venture, business));
    pending.push(...quoteRows(deps, state, venture, business), ...postRows(state, business), ...evidenceRows(state, venture, business));
    pending.push(...bankRows(state, venture, business, ctx));
    pending.push(...await w4Rows(deps, ctx, state, venture, business, pending));
  }
  if (scope === 'all' && deps.workspace) {
    let others: VentureBusinessRef[] = [];
    try { others = (await deps.workspace.businesses()).filter(item => item.id !== business.id); } catch { others = []; }
    pending.push(...lockedRows(others, state.workspace.createdAt));
  }
  const decided = decidedIds(state, venture?.id ?? null);
  const rows = pending.map(sealed).filter(built => !decided.has(built.row.id));
  // The plan and the setup rows lead, plan first, whatever their times: the plan is written after the business is
  // made, and onboarding asks for it first. Then every other row oldest first; locked businesses last.
  const group = (row: QueueRow) => (row.kind === 'locked' ? 2 : LEAD.includes(row.kind) ? 0 : 1);
  rows.sort((a, b) => group(a.row) - group(b.row)
    || (group(a.row) === 0 ? RANK[a.row.kind] - RANK[b.row.kind] : 0)
    || (a.row.kind === 'locked' ? 0 : a.row.createdAt.localeCompare(b.row.createdAt))
    || RANK[a.row.kind] - RANK[b.row.kind]);
  return { rows: withW4Hooks(state, rows, deps.clock().toISOString()), state, venture };
}

function summaryOf(rows: QueueRow[]): Pick<QueueList, 'summary' | 'needsYou' | 'businesses'> {
  const open = rows.filter(row => row.kind !== 'locked');
  const locked = rows.filter(row => row.kind === 'locked');
  const businesses = new Set(open.map(row => row.businessId)).size;
  const lockedText = locked.length === 1 ? `${locked[0].businessName} is locked` : `${locked.length} more businesses are locked`;
  if (!open.length) return { summary: locked.length ? `Nothing needs you here. ${lockedText}.` : 'Nothing needs you.', needsYou: 0, businesses: 0 };
  const count = open.length === 1 ? '1 needs you' : `${open.length} need you`;
  const across = businesses > 1 ? `, across ${businesses} businesses` : '';
  return { summary: `${count}${across}${locked.length ? `. ${lockedText}` : ''}`, needsYou: open.length, businesses };
}

/** Every open row with the subject it stands for, for venture.queue.view (queue-view.ts). Reads only. */
export async function queueRowsWithSubjects(deps: VentureDeps, ctx: Context): Promise<{ row: QueueRow; subject: string }[]> {
  const { rows } = await buildRows(deps, ctx, 'all');
  return rows.map(built => ({ row: built.row, subject: built.pending.subject }));
}

/** venture.queue.list { scope? } (read): the rows that need the owner, oldest first. 'all' adds the other businesses. */
export async function queueListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<QueueList> {
  const body = exactPayload(payload, ['scope']);
  check(body.scope === undefined || body.scope === 'current' || body.scope === 'all', 'INVALID_VENTURE_REQUEST', 'Choose the current business or all of them.');
  const { rows } = await buildRows(deps, ctx, (body.scope as 'current' | 'all' | undefined) ?? 'current');
  const list = rows.map(built => built.row);
  return { rows: list, ...summaryOf(list) };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const refused = (reason: string, line: string): QueueDecision => ({ outcome: 'refused', reason, line });

function errorParts(error: unknown): { code: string; message: string } | null {
  const value = error as { code?: unknown; message?: unknown } | null;
  return value && typeof value.code === 'string' && /^[A-Z_]{1,64}$/.test(value.code)
    ? { code: value.code, message: typeof value.message === 'string' ? value.message : 'This was refused.' } : null;
}

async function staleOrGone(deps: VentureDeps, ctx: Context, subject: string): Promise<QueueDecision> {
  const { rows } = await buildRows(deps, ctx, 'all');
  const latest = rows.find(built => built.pending.subject === subject)?.row;
  return latest ? { outcome: 'stale', line: STALE_LINE, latest } : refused('RESOLVED_ELSEWHERE', GONE_LINE);
}

/** Records the decision once. A second record for the same row id is never written. */
async function record(deps: VentureDeps, ctx: Context, row: QueueRow, subject: string, chosen: QueueActionId, outcome: Outcome): Promise<boolean> {
  return ventureAction(deps, ctx, 'approve', 'queue.decide', tx => {
    if (tx.list('venture-queue-decision').some(item => item.rowId === row.id && !item.undoneAt)) return false;
    tx.put<QueueDecisionRecord>({ ...tx.base('venture-queue-decision'), rowId: row.id, subject, digest: row.digest, action: chosen, line: outcome.line, receiptId: outcome.receiptId ?? null, decidedBy: ctx.memberId });
    tx.emit('queue.changed', { rowId: row.id });
    return true;
  });
}

/**
 * venture.queue.decide { id, digest, action, answer?, viewed? } (approve, app only). Decide-once per row id; a digest that
 * no longer matches is stale and returns the latest row; Approve on a row that needs a view first is refused unless
 * viewed is true. Navigation actions (read, watch, open, connect, set prices, keep) are not decisions.
 */
export async function queueDecideHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<QueueDecision> {
  requireAppChannel(ctx, 'venture.queue.decide');
  const body = exactPayload(payload, ['id', 'digest', 'action', 'answer', 'viewed'], ['id', 'digest', 'action']);
  check(typeof body.id === 'string' && /^[A-Za-z0-9_.:-]{3,400}$/.test(body.id) && body.id.includes(':'), 'INVALID_VENTURE_REQUEST', 'Send the id of the row you decided on.');
  check(typeof body.digest === 'string' && /^[a-f0-9]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the row you saw.');
  check(typeof body.action === 'string' && (QUEUE_ACTION_IDS as readonly string[]).includes(body.action), 'INVALID_VENTURE_REQUEST', 'Choose one of the row\'s actions.');
  check(body.viewed === undefined || typeof body.viewed === 'boolean', 'INVALID_VENTURE_REQUEST', 'viewed must be true or false.');
  const answer = body.answer === undefined ? null : plainText(body.answer, 'Answer', { min: 0, max: 2000 });
  const id = body.id, chosen = body.action as QueueActionId;
  authorize(deps.store, ctx, 'approve');

  const before = deps.store.read();
  const venture = currentVenture(before);
  if (decidedIds(before, venture?.id ?? null).has(id)) return refused('ALREADY_DECIDED', 'You decided this already.');
  const { rows } = await buildRows(deps, ctx, 'all');
  const found = rows.find(built => built.row.id === id);
  if (!found || found.row.digest !== body.digest) return staleOrGone(deps, ctx, subjectOf(id));
  const { pending, row } = found;
  const offered = row.actions.find(item => item.id === chosen);
  const perform = pending.perform[chosen];
  if (!offered && !perform && chosen !== 'later') return refused('NOT_OFFERED', 'This row does not offer that.');
  if (!perform && chosen !== 'later') return refused('NOT_A_DECISION', pending.navigate ?? NOT_A_DECISION[chosen] ?? 'Open it to do this.');
  if (row.kind === 'locked') return refused('NOT_A_DECISION', pending.navigate ?? NOT_A_DECISION.open!);
  if (offered?.requiresView && body.viewed !== true) return refused('VIEW_FIRST', 'Open it and read it first.');
  if (chosen === 'answer' && !answer) return refused('ANSWER_REQUIRED', 'Type your answer first.');

  if (chosen === 'later') {
    const outcome = { line: 'Moved to later.' };
    return await record(deps, ctx, row, pending.subject, chosen, outcome) ? { outcome: 'done', ...outcome } : refused('ALREADY_DECIDED', 'You decided this already.');
  }
  let outcome: Outcome;
  try {
    outcome = await perform!(deps, ctx, { answer });
  } catch (error) {
    const parts = errorParts(error);
    if (!parts) throw error;
    if (parts.code === 'APPROVAL_STALE') return staleOrGone(deps, ctx, pending.subject);
    return refused(parts.code, parts.message);
  }
  await record(deps, ctx, row, pending.subject, chosen, outcome);
  return { outcome: 'done', line: outcome.line, ...(outcome.receiptId ? { receiptId: outcome.receiptId } : {}) };
}
