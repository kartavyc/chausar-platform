/**
 * AS-15: decisions. One sentence and a review date become a draft in the inbox; confirming it
 * records a journal decision through the engine's decision journal, with the receipts it cites
 * as they stood that day. Text forwarded from the phone lands in the inbox as a draft only
 * (experimental) and is recorded like any other only after a person confirms it in the app.
 */
import { check, newId, now, type Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { CalculationReceipt } from '../calculator.ts';
import type { JournalContent, JournalDecision } from '../decision-journal.ts';
import { validDate } from '../memory.ts';
import type { DecisionReply, DecisionsReply, InboxReply } from './contracts.ts';
import { askState, businessToday, core, headlineKey, identifier, input, peekAsk, requireId, text } from './shared.ts';

function receiptIds(value: unknown): string[] {
  check(value === undefined || Array.isArray(value) && value.length <= 10 && value.every(identifier) && new Set(value).size === value.length, 'ASK_INVALID', 'Cite at most ten receipts.');
  return [...(value as string[] | undefined ?? [])];
}

export async function draft(ctx: Context, payload: unknown, host: ModuleHost, origin: 'typed' | 'forwarded' = 'typed') {
  const request = input(payload, origin === 'typed' ? ['sentence', 'reviewDate', 'receiptIds', 'decidedOn'] : ['text', 'reviewDate'], origin === 'typed' ? ['sentence', 'reviewDate'] : ['text']);
  const sentence = text(origin === 'typed' ? request.sentence : request.text, 1000).trim();
  const today = businessToday(host);
  const reviewDate = request.reviewDate ?? defaultReview(today);
  check(validDate(reviewDate) && reviewDate >= today, 'ASK_INVALID', 'Choose a review date from today on.');
  const cited = origin === 'typed' ? receiptIds(request.receiptIds) : [];
  // A decision made earlier and written down now is labelled "recorded later".
  if (request.decidedOn !== undefined) check(validDate(request.decidedOn) && request.decidedOn <= today, 'ASK_INVALID', 'The day it was decided cannot be after today.');
  for (const id of cited) await core(host, 'receipts.get', { id });
  return host.store.update(state => {
    const own = askState(state);
    check(own.drafts.filter(d => d.memberId === ctx.memberId).length < 100, 'ASK_INVALID', 'Confirm or drop some drafts first.');
    const item = { id: newId('draft'), memberId: ctx.memberId, sentence, reviewDate, receiptIds: cited, createdAt: now(), origin, ...(request.decidedOn === undefined ? {} : { decidedOn: request.decidedOn as string }) };
    own.drafts.push(item); return { id: item.id };
  });
}
function defaultReview(today: string) { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0, 10); }

function content(ctx: Context, item: { sentence: string; reviewDate: string; receiptIds: string[]; createdAt: string }): JournalContent {
  return {
    text: item.sentence, selectedOptionId: 'as-written', ownerId: ctx.memberId, reviewDate: item.reviewDate, hypotheses: [], assumptions: [],
    options: [{ id: 'as-written', label: item.sentence.slice(0, 200), reason: 'Recorded as written by the person deciding.', evidence: item.receiptIds.map(receiptId => ({ receiptId })) }],
    expectedOutcome: { description: 'Asked again on the review date how it went.', measure: 'The person’s own review', population: 'This workspace',
      window: { from: item.createdAt.slice(0, 10), to: item.reviewDate }, maturityDate: item.reviewDate, lagRule: 'Review on the review date.', uncertainty: [] },
  };
}

export async function confirm(ctx: Context, payload: unknown, host: ModuleHost) {
  const request = input(payload, ['draftId'], ['draftId']), id = requireId(request.draftId);
  const item = peekAsk(host.store.read()).drafts.find(d => d.id === id && d.memberId === ctx.memberId);
  check(item, 'ASK_NOT_FOUND', 'This draft is no longer in the inbox.');
  const prepared = await core<{ digest: string }>(host, 'decisions.journal.draft', { content: content(ctx, item) });
  const decision = await core<JournalDecision>(host, 'decisions.journal.confirm', { draft: prepared, reviewedDigest: prepared.digest });
  await host.store.update(state => {
    const own = askState(state); own.drafts = own.drafts.filter(d => d.id !== id);
    if (item.decidedOn && item.decidedOn < item.createdAt.slice(0, 10)) (own.decided ??= []).push({ decisionId: decision.id, decidedOn: item.decidedOn });
  });
  return { decisionId: decision.id };
}

export async function discard(ctx: Context, payload: unknown, host: ModuleHost) {
  const request = input(payload, ['draftId'], ['draftId']), id = requireId(request.draftId);
  return host.store.update(state => {
    const own = askState(state), before = own.drafts.length;
    own.drafts = own.drafts.filter(d => !(d.id === id && d.memberId === ctx.memberId));
    check(own.drafts.length < before, 'ASK_NOT_FOUND', 'This draft is no longer in the inbox.');
    return { removed: true as const };
  });
}

async function decisions(host: ModuleHost): Promise<any[]> { return core<any[]>(host, 'decisions.list', {}); }
const later = (host: ModuleHost, id: string) => (peekAsk(host.store.read()).decided ?? []).some(d => d.decisionId === id);
const cancelled = (d: any) => d.status === 'closed' && Array.isArray(d.reviews) && d.reviews.at(-1)?.outcome === 'rejected';
const journal = (d: any) => Array.isArray(d.options) && typeof d.revision === 'number';

export async function inbox(ctx: Context, payload: unknown, host: ModuleHost): Promise<InboxReply> {
  input(payload, []);
  const today = businessToday(host), all = await decisions(host);
  return {
    drafts: peekAsk(host.store.read()).drafts.filter(d => d.memberId === ctx.memberId).map(({ memberId: _m, ...d }) => d),
    due: all.filter(d => d.status === 'open' && typeof d.reviewDate === 'string' && d.reviewDate <= today).map(d => ({ id: d.id, text: String(d.text), reviewDate: d.reviewDate })),
    waiting: await waiting(ctx, host),
  };
}

/**
 * Questions Chausar is waiting on: this member's model clarifications that no reply has resolved
 * yet. Each is opened through the engine's own continuation check, so only one that is still
 * retained, intact and inside current access is listed. The clarification is model text: data only.
 */
async function waiting(ctx: Context, host: ModuleHost): Promise<InboxReply['waiting']> {
  const state = host.store.read();
  const resolved = new Set(state.conversations.filter(r => r?.kind === 'conversation-continuation-resolved').map(r => r.continuationId));
  const pending = state.conversations.filter(r => r?.kind === 'conversation-clarification-answer' && r.memberId === ctx.memberId && r.epoch === ctx.epoch && !resolved.has(r.id))
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20);
  const out: InboxReply['waiting'] = [];
  for (const record of pending) {
    try {
      const continuation = await host.call('conversation.continuation', { id: record.id }) as { clarification?: unknown };
      if (typeof continuation?.clarification === 'string') out.push({ id: record.id, text: continuation.clarification.slice(0, 1000), at: String(record.at) });
    } catch { /* Unavailable under current access or retention: not listed. */ }
  }
  return out;
}

export async function listDecisions(_ctx: Context, payload: unknown, host: ModuleHost): Promise<DecisionsReply> {
  input(payload, []);
  const all = await decisions(host);
  return { items: all.map(d => ({ id: d.id, text: String(d.text), createdAt: d.createdAt, reviewDate: d.reviewDate, status: d.status === 'closed' ? 'closed' as const : 'open' as const,
    recordedLater: later(host, d.id), replaced: journal(d) && d.revisions.length > 0, cancelled: cancelled(d), reviews: Array.isArray(d.reviews) ? d.reviews.length : 0,
    receiptIds: Array.isArray(d.receiptIds) ? d.receiptIds : [] })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}

export async function getDecision(_ctx: Context, payload: unknown, host: ModuleHost): Promise<DecisionReply> {
  const request = input(payload, ['decisionId'], ['decisionId']), id = requireId(request.decisionId);
  const found = (await decisions(host)).find(d => d.id === id);
  check(found, 'ASK_NOT_FOUND', 'This decision is unavailable under your current access.');
  // What was known then: the receipt snapshots the journal kept, else the receipts as they stand.
  const snapshots: CalculationReceipt[] = journal(found) ? found.receipts : [];
  const known = [];
  for (const receiptId of (found.receiptIds ?? []) as string[]) {
    const receipt = snapshots.find(r => r.id === receiptId) ?? await core<CalculationReceipt>(host, 'receipts.get', { id: receiptId });
    const figure = receipt.figures.find(f => f.key === headlineKey(receipt));
    known.push({ receiptId, label: receipt.operation, minor: figure?.minor ?? null, asOf: receipt.asOf });
  }
  return { id: found.id, text: String(found.text), createdAt: found.createdAt, reviewDate: found.reviewDate, status: found.status === 'closed' ? 'closed' : 'open',
    recordedLater: later(host, found.id), replaced: journal(found) && found.revisions.length > 0, cancelled: cancelled(found), revision: journal(found) ? found.revision : null, known, journal: journal(found),
    reviews: (found.reviews ?? []).map((r: any) => ({ at: r.at, outcome: r.outcome, notes: typeof r.notes === 'string' ? r.notes : null, nextReviewDate: typeof r.nextReviewDate === 'string' ? r.nextReviewDate : null })) };
}

export async function review(ctx: Context, payload: unknown, host: ModuleHost): Promise<DecisionReply> {
  const request = input(payload, ['decisionId', 'outcome', 'notes', 'nextReviewDate'], ['decisionId', 'outcome']), id = requireId(request.decisionId);
  check(['accepted', 'rejected', 'continue', 'completed'].includes(request.outcome), 'ASK_INVALID', 'Choose how it went.');
  const notes = request.notes === undefined ? undefined : text(request.notes, 2000);
  if (request.nextReviewDate !== undefined) check(validDate(request.nextReviewDate), 'ASK_INVALID', 'Give the next review date as YYYY-MM-DD.');
  const found = (await decisions(host)).find(d => d.id === id);
  check(found, 'ASK_NOT_FOUND', 'This decision is unavailable under your current access.');
  if (journal(found)) {
    const state = request.outcome === 'completed' || request.outcome === 'accepted' ? 'achieved' : request.outcome === 'rejected' ? 'not-achieved' : 'pending';
    await core(host, 'decisions.journal.review', { id, expectedRevision: found.revision, review: {
      outcome: request.outcome, ...(notes === undefined ? {} : { notes }), ...(request.nextReviewDate === undefined ? {} : { nextReviewDate: request.nextReviewDate }),
      observation: { state, measurements: [], notes: notes ?? '', uncertainty: [], concurrentInterventions: [], executionReceiptIds: [] } } });
  } else await core(host, 'decisions.review', { id, outcome: request.outcome, ...(notes === undefined ? {} : { notes }) });
  void ctx;
  return getDecision(ctx, { decisionId: id }, host);
}
