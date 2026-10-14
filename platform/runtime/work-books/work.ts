/**
 * Work: the `approvals.*` family (WK-01..WK-11, WK-15). One queue over prepared actions, jobs
 * waiting for a yes or for acceptance, dictionary release drafts and lessons awaiting review.
 * Every mutation goes through the owning service or engine method; this file keeps only its
 * private notes (snoozes, pace, owner attestations, approval channels, the wanted list).
 */
import { audit, check, ChausarError, newId } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { PreparedAction } from '../actions.ts';
import type { Job } from '../jobs.ts';
import type { MethodSpec, EngineModule, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { workJobMethods, jobMeters } from './work-jobs.ts';
import { jobSheetExtras, jobsxList, laneRow } from './work-jobs-sheet.ts';
import { approveBill, dropBill } from './books-bill.ts';
import { section, peekSection } from './state.ts';
import {
  initWork, normalizeWork, env, queue, order, rowOf, snoozed, expired, detail, drafts, lessons, visibleActions, visibleJobs, jobNeedsApproval, jobCard,
  actionView, actionDetail, findAction, catalogue, catalogueRow, catalogueEntry, catalogueKey, parseId, steps, isoAt, nowMs, isReadOnly,
  actionTier, boundLogs, withProposals, acceptanceReference, acceptanceDigest,
} from './work-queue.ts';
import { acceptResult, approveProposal, dismissProposal, sendBack, SENT_BACK } from './work-jobs-lane.ts';
import type { ApprovalDetail, Env, WorkState, Amount, ActionView } from './work-queue.ts';
import { findView, wbDetail, wbActionView, reminderOf, practiceReply, changedPayload, parseView, SYSTEM_TITLES, REMINDER_BLOCKS } from './work-writeback.ts';
import { exportPrepared } from './work-writeback-export.ts';

const FAST_MS = 2000, PACE_KEEP = 20, WANTED_MAX = 500, GROUP_MAX = 10, RESERVATION_MS = 15 * 60000;
const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function exact(payload: Record<string, any>, required: string[], optional: string[] = []) {
  check(record(payload) && required.every(k => Object.hasOwn(payload, k)) && Object.keys(payload).every(k => required.includes(k) || optional.includes(k)), 'INVALID_APPROVAL', 'Use only the declared request fields.');
}
const idOf = (payload: Record<string, any>) => { exact(payload, ['id']); parseId(payload.id); return payload.id as string; };
const digestOf = (value: unknown) => { check(typeof value === 'string' && value.length >= 8 && value.length <= 200, 'INVALID_APPROVAL', 'Send the digest of the preview you read.'); return value; };
const update = <T>(host: ModuleHost, change: (work: WorkState, state: State) => T) =>
  host.store.update(state => change(normalizeWork(section(state, 'work', initWork)), state));

/** Records an approval for the pace warning: the time from opening the sheet (or the previous approval) to this yes. */
async function recordPace(host: ModuleHost, ctx: Context, id: string, actionId: string | null) {
  const at = nowMs(host);
  await update(host, work => {
    const previous = work.pace.filter(p => p.memberId === ctx.memberId).at(-1)?.at; const opened = work.opened[`${ctx.memberId} ${id}`];
    const since = Math.max(opened ?? -Infinity, previous ?? -Infinity);
    work.pace.push({ memberId: ctx.memberId, at, ms: Number.isFinite(since) ? at - since : null });
    work.pace = work.pace.filter(p => p.memberId !== ctx.memberId).concat(work.pace.filter(p => p.memberId === ctx.memberId).slice(-PACE_KEEP));
    delete work.opened[`${ctx.memberId} ${id}`]; if (work.snoozes[ctx.memberId]) delete work.snoozes[ctx.memberId][id];
    if (actionId) work.channels[actionId] = ctx.channel ?? 'desktop';
    boundLogs(work);
  });
}

/** The sheet for one item; a write-back reminder also carries its agreement, limits and notes (WK-12). */
async function fullDetail(e: Env, id: string): Promise<ApprovalDetail> {
  const { source, raw } = parseId(id);
  if (source !== 'writeback') return detail(e, id);
  const view = findView(e, raw); return wbDetail(e, view, await reminderOf(e, view));
}
/** A write-back yes: exactly this digest, with re-authentication only when write-back asks for it. */
async function approveWriteback(host: ModuleHost, raw: string, item: ApprovalDetail, payload: { digest: string; reauth?: string }) {
  const asks = item.secondAsk?.by === 'passphrase';
  check(!asks || typeof payload.reauth === 'string', 'REAUTH_REQUIRED', 'Type your passphrase to approve this.');
  check(asks || payload.reauth === undefined, 'INVALID_APPROVAL', 'No passphrase is asked for here.');
  const reply = parseView(await host.call('writeback.approve', { id: raw, digest: payload.digest, ...(asks ? { reauth: payload.reauth } : {}) }));
  check(reply, 'INVALID_WRITEBACK_REPLY', 'The approval could not be read back.');
  check(reply.status !== 'prepared' && reply.status !== 'cancelled', 'APPROVAL_EXPIRED', 'This approval expired. Nothing was sent.');
}

/** One approval of one exact item. Group approvals call this once per item. */
async function approveOne(ctx: Context, host: ModuleHost, payload: { id: string; digest: string; secondAsk?: true; reauth?: string }, group = false): Promise<ApprovalDetail> {
  const e = await withProposals(ctx, host, payload.id); const item = await fullDetail(e, payload.id); const { source, raw } = parseId(payload.id);
  check(!isReadOnly(e), 'OWNER_APPROVES', 'The owner approves this.');
  check(source !== 'proposal' || item.blocked?.kind !== 'owner-approves', 'JOB_OWNER_REQUIRED', 'Only the job’s owner approves its card.');
  check(!group || (item.tier === 'tier-1' && item.source !== 'job'), 'GROUP_NOT_ALLOWED', 'Items on the always-waits list are approved one at a time.');
  check(item.state === 'prepared', 'INVALID_APPROVAL_STATE', 'Only an item that is waiting can be approved.');
  check(!expired(e, item), 'APPROVAL_EXPIRED', 'This approval expired. Nothing was sent.');
  check(!item.prepareOnly, 'PREPARE_ONLY', 'This is prepare only. Download the file; you or your accountant files it.');
  check(payload.digest === item.digest, 'PREVIEW_CHANGED', 'The exact change is different from the preview you read. Review it again.');
  check(!item.needsSecondAsk || payload.secondAsk === true, 'SECOND_ASK_REQUIRED', 'Money needs a second confirmation before approval.');
  check(item.can.includes('approve'), 'INVALID_APPROVAL_STATE', 'This item cannot be approved here.');
  if (source !== 'writeback') check(payload.reauth === undefined, 'INVALID_APPROVAL', 'No passphrase is asked for here.');
  if (source === 'action') await host.services.actions.approve(ctx, raw, payload.digest);
  else if (source === 'writeback') await approveWriteback(host, raw, item, payload);
  else if (source === 'job') await host.call('jobs.approve', { id: raw, digest: payload.digest });
  else if (source === 'acceptance') {
    // The full reference from the same snapshot the digest was checked against: core refuses PREVIEW_CHANGED if the objective or deliverable moved since.
    // A lane job is accepted through jobs-ext (it writes its own time line and catches up a missed run), a core job through the core.
    await acceptResult(e, visibleJobs(e).find(j => j.id === raw)!);
  }
  else if (source === 'proposal') {
    // jobs-ext's own approval of this exact card; the item leaves the queue and the new job runs.
    const jobId = await approveProposal(host, raw, payload.digest);
    await recordPace(host, ctx, payload.id, null);
    return { ...item, state: 'verified', can: [], steps: steps(item.steps[0] ? ['done', item.steps[0].at] : ['done', null], ['done', isoAt(nowMs(host))]), ...(jobId ? { approvedJobId: `job:${jobId}` } : {}) };
  }
  else if (source === 'release') await host.call('books.publish', { draftId: raw, digest: payload.digest });
  else if (source === 'bill') await approveBill(ctx, host, raw, payload.digest);
  else await host.call('memory.decideLesson', lessonDecision(e, raw, 'approve'));
  await recordPace(host, ctx, payload.id, source === 'action' || source === 'writeback' ? raw : null);
  try { return await fullDetail(await env(ctx, host), payload.id); }
  catch (error) { if ((error as ChausarError)?.code !== 'NOT_FOUND') throw error; return { ...item, state: 'verified', can: [] }; }
}
function lessonDecision(e: Env, raw: string, decision: 'approve' | 'reject') {
  const lesson = lessons(e).find(l => l.candidate.id === raw); check(lesson?.review, 'LESSON_REVIEW_PENDING', 'This lesson has no completed review yet.');
  const c = lesson.candidate;
  return { candidate: { id: c.id, revision: c.revision, digest: c.digest }, reviewId: lesson.review.id, reviewDigest: lesson.review.digest, decision, reason: decision === 'approve' ? 'Approved in the approvals queue.' : 'Dropped in the approvals queue.' };
}
function approvePayload(payload: Record<string, any>) {
  exact(payload, ['id', 'digest'], ['secondAsk', 'reauth']); parseId(payload.id);
  check(payload.secondAsk === undefined || payload.secondAsk === true, 'INVALID_APPROVAL', 'secondAsk is true when present.');
  check(payload.reauth === undefined || (typeof payload.reauth === 'string' && payload.reauth.length >= 1 && payload.reauth.length <= 1024), 'INVALID_APPROVAL', 'The passphrase is 1 to 1024 characters.');
  return { id: payload.id as string, digest: digestOf(payload.digest), ...(payload.secondAsk ? { secondAsk: true as const } : {}), ...(payload.reauth !== undefined ? { reauth: payload.reauth as string } : {}) };
}
/**
 * WK-15: sending stays closed while any attempted action anywhere in the workspace is unsure or
 * still running, or while another execution started here holds its reservation. Checked inside the
 * store transaction that records this action's own reservation, so two concurrent executes cannot
 * both pass. (Core `actions.execute` called directly does not go through this gate.)
 */
function sendingOpen(state: State, work: WorkState, except: string, now: number) {
  return !state.actions.some((a: PreparedAction) => a.id !== except && ['unknown', 'executing'].includes(a.status))
    && !Object.entries(work.executing).some(([id, r]) => id !== except && now - r.at < RESERVATION_MS);
}

/** The record view of a core action or a write-back action, by its typed id. */
function anyActionView(e: Env, id: unknown): ActionView {
  const { source, raw } = parseId(id);
  return source === 'writeback' ? wbActionView(e, findView(e, raw)) : actionView(e, findAction(e, id));
}

const JOB_STATE: Partial<Record<Job['status'], string>> = {
  running: 'running', paused: 'paused', revoked: 'stopped-by-rule', 'budget-blocked': 'stopped-by-rule', 'runner-blocked': 'set-aside', 'network-wait': 'waiting',
  'outcome-unknown': 'waiting', cancelled: 'cancelled', stopped: 'stopped', 'awaiting-acceptance': 'awaiting-acceptance', accepted: 'accepted',
};
const TERMINAL: Job['status'][] = ['cancelled', 'stopped', 'accepted', 'revoked'];
function jobRow(e: Env, job: Job) {
  const last = job.ledger.at(-1); const needs = jobNeedsApproval(job);
  const state = needs ? (job.approval ? 'waiting' : 'proposed') : job.status === 'scheduled' ? (last?.event === 'catchup-skipped' ? 'missed' : 'scheduled') : JOB_STATE[job.status] ?? 'waiting';
  const owner = !isReadOnly(e);
  return {
    id: job.id, goal: job.goal, state, reason: ['scheduled', 'running', 'accepted'].includes(job.status) && !needs ? null : last?.reason ?? (last && last.event !== 'created' ? last.event : null),
    nextRunAt: TERMINAL.includes(job.status) || job.status === 'awaiting-acceptance' ? null : job.nextRunAt, resumesAt: job.status === 'network-wait' ? job.nextRunAt : null,
    spent: { minor: job.spentMinor } as Amount, budget: { minor: job.budgetMinor } as Amount,
    can: !owner ? [] : [
      ...(!TERMINAL.includes(job.status) && job.status !== 'awaiting-acceptance' ? ['pause' as const] : []),
      ...(['paused', 'approval-blocked', 'budget-blocked', 'runner-blocked', 'network-wait'].includes(job.status) && !job.deliverable ? ['resume' as const] : []),
      ...(!TERMINAL.includes(job.status) ? ['cancel' as const] : []),
      ...(job.status === 'awaiting-acceptance' ? ['accept' as const, 'reject' as const] : []),
      ...(needs ? ['approve' as const] : []),
    ],
    createdAt: job.createdAt,
  };
}

export const workMethods: Readonly<Record<string, MethodSpec>> = {
  'approvals.list': { permission: 'read', phone: true, async handler(ctx, payload, host) {
    exact(payload, []); const e = await withProposals(ctx, host); const all = queue(e).sort(order);
    const live = all.filter(item => !expired(e, item)); const shown = live.filter(item => !snoozed(e, item.id));
    return {
      items: shown.map(rowOf), expired: all.filter(item => expired(e, item)).map(rowOf), snoozed: live.length - shown.length,
      counts: { tier2: shown.filter(i => i.tier === 'tier-2').length, tier1: shown.filter(i => i.tier === 'tier-1').length, prepareOnly: shown.filter(i => i.tier === 'prepare-only').length },
    };
  } },
  'approvals.get': { permission: 'read', phone: true, async handler(ctx, payload, host) {
    const id = idOf(payload); const item = await fullDetail(await withProposals(ctx, host, id), id);
    if (item.state === 'prepared' && !item.readOnly) await update(host, work => { work.opened[`${ctx.memberId} ${id}`] = nowMs(host); boundLogs(work); });
    return item;
  } },
  'approvals.approve': { permission: 'approve', async handler(ctx, payload, host) { return approveOne(ctx, host, approvePayload(payload)); } },
  'approvals.notNow': { permission: 'read', phone: true, async handler(ctx, payload, host) {
    exact(payload, ['id'], ['hours']);
    check(payload.hours === undefined || (Number.isInteger(payload.hours) && payload.hours >= 1 && payload.hours <= 168), 'INVALID_APPROVAL', 'Snooze for 1 to 168 hours.');
    const e = await withProposals(ctx, host, payload.id); const item = detail(e, payload.id); check(item.state === 'prepared', 'INVALID_APPROVAL_STATE', 'Only a waiting item can wait longer.');
    const snoozedUntil = isoAt(e.now + (payload.hours ?? 24) * 3600000);
    await update(host, work => { (work.snoozes[ctx.memberId] ??= {})[item.id] = snoozedUntil; });
    return { id: item.id, snoozedUntil };
  } },
  'approvals.change': { permission: 'prepare', async handler(ctx, payload, host) {
    exact(payload, ['id', 'payload']); const e = await withProposals(ctx, host, payload.id); const item = detail(e, payload.id); const { source, raw } = parseId(payload.id);
    check(item.state === 'prepared', 'INVALID_APPROVAL_STATE', 'Only a waiting item can be changed.');
    if (source === 'action') {
      check(record(payload.payload), 'INVALID_APPROVAL', 'Send the changed request as an object.');
      await host.services.actions.revise(ctx, raw, payload.payload);
      await update(host, work => { work.revisedAt[raw] = isoAt(nowMs(host)); for (const s of Object.values(work.snoozes)) delete s[item.id]; });
      return detail(await env(ctx, host), item.id);
    }
    if (source === 'writeback') {
      check(record(payload.payload), 'INVALID_APPROVAL', 'Send the changed request as an object.');
      await host.call('writeback.change', { id: raw, payload: changedPayload(e, findView(e, raw), payload.payload) });
      await update(host, work => { for (const s of Object.values(work.snoozes)) delete s[item.id]; });
      return fullDetail(await env(ctx, host), item.id);
    }
    if (source === 'job') { check(record(payload.payload), 'INVALID_APPROVAL', 'Send the changed job as an object.'); await host.call('jobs.amend', { id: raw, config: payload.payload }); return detail(await env(ctx, host), item.id); }
    if (source === 'release') {
      check(payload.payload === null || record(payload.payload), 'INVALID_APPROVAL', 'Send the changed meaning as an object, or null to remove it.');
      const name = drafts(e.state).find(d => d.id === raw)!.name;
      const draft = await host.call('books.draft', { name, definition: payload.payload, replaces: raw }) as { id?: unknown };
      check(record(draft) && typeof draft.id === 'string', 'INVALID_DRAFT_REPLY', 'The dictionary draft could not be read back.');
      return detail(await env(ctx, host), `release:${draft.id}`);
    }
    throw new ChausarError('CHANGE_NOT_AVAILABLE', 'This item cannot be changed here.');
  } },
  'approvals.drop': { permission: 'approve', async handler(ctx, payload, host) {
    const id = idOf(payload); const e = await withProposals(ctx, host, id); const item = detail(e, id); const { source, raw } = parseId(id);
    check(item.can.includes('drop'), 'INVALID_APPROVAL_STATE', 'This item can no longer be dropped.');
    if (source === 'action') await host.services.actions.cancel(ctx, raw);
    else if (source === 'writeback') await host.call('writeback.drop', { id: raw });
    else if (source === 'job') await host.call('jobs.cancel', { id: raw });
    else if (source === 'acceptance') await sendBack(host, visibleJobs(e).find(j => j.id === raw)!, SENT_BACK); // sends the result back; the job stays, paused
    else if (source === 'proposal') await dismissProposal(host, raw);
    else if (source === 'release') await host.call('books.discard', { draftId: raw });
    else if (source === 'bill') await dropBill(ctx, host, raw);
    else await host.call('memory.decideLesson', lessonDecision(e, raw, 'reject'));
    await update(host, work => { for (const s of Object.values(work.snoozes)) delete s[id]; });
    return { id, state: source === 'acceptance' ? 'rejected' as const : 'cancelled' as const };
  } },
  'approvals.group': { permission: 'read', async handler(ctx, payload, host) {
    exact(payload, ['ids']);
    check(Array.isArray(payload.ids) && payload.ids.length >= 2 && payload.ids.length <= GROUP_MAX && new Set(payload.ids).size === payload.ids.length, 'INVALID_APPROVAL', 'A group holds 2 to 10 different items.');
    const e = await withProposals(ctx, host, payload.ids.some((id: unknown) => typeof id === 'string' && id.startsWith('proposal:')) ? undefined : null); const items = payload.ids.map((id: unknown) => { parseId(id); return detail(e, id as string); });
    check(items.every((i: ApprovalDetail) => i.tier === 'tier-1' && i.source !== 'job'), 'GROUP_NOT_ALLOWED', 'Items on the always-waits list are approved one at a time.');
    return { title: `${items.length} changes that can be undone`, undoable: true as const, items };
  } },
  'approvals.approveGroup': { permission: 'approve', async handler(ctx, payload, host) {
    exact(payload, ['items']);
    check(Array.isArray(payload.items) && payload.items.length >= 1 && payload.items.length <= GROUP_MAX && payload.items.every((i: unknown) => record(i)), 'INVALID_APPROVAL', 'Send 1 to 10 items, each with its id and digest.');
    const parsed = payload.items.map((i: Record<string, any>) => { exact(i, ['id', 'digest']); return approvePayload(i); });
    check(new Set(parsed.map((p: { id: string }) => p.id)).size === parsed.length, 'INVALID_APPROVAL', 'Each item appears once.');
    const results: { id: string; ok: boolean; code?: string; state?: string }[] = [];
    for (const item of parsed) {
      try { const done = await approveOne(ctx, host, item, true); results.push({ id: item.id, ok: true, state: done.state }); }
      catch (error) { results.push({ id: item.id, ok: false, code: error instanceof ChausarError ? error.code : 'APPROVAL_FAILED' }); }
    }
    return { results };
  } },
  'approvals.pace': { permission: 'read', phone: true, async handler(ctx, payload, host) {
    exact(payload, []); const e = await env(ctx, host); const mine = e.work.pace.filter(p => p.memberId === ctx.memberId);
    let fastStreak = 0; for (const p of [...mine].reverse()) { if (p.ms === null || p.ms >= FAST_MS) break; fastStreak += 1; }
    return { fastStreak, warn: fastStreak >= 3 };
  } },
  'approvals.practice': { permission: 'prepare', async handler(ctx, payload, host) {
    const id = idOf(payload); const e = await withProposals(ctx, host, id); const item = detail(e, id); const { source, raw } = parseId(id);
    const none = (code: string) => ({ practice: true as const, available: false, steps: steps(), wouldSend: null, code });
    // Write-back practises its own prepared actions against fresh practice systems; core actions have none.
    if (source === 'writeback') { void item; return practiceReply(await host.call('writeback.practice', { actionId: raw })); }
    return none(source === 'action' && !e.catalogue.writeback ? 'WRITEBACK_NOT_BUILT' : 'PRACTICE_NOT_AVAILABLE');
  } },
  'approvals.execute': { permission: 'prepare', async handler(ctx, payload, host) {
    exact(payload, ['id']); const e = await env(ctx, host); const { source, raw } = parseId(payload.id);
    const view = source === 'writeback' ? findView(e, raw) : null; const action = view ? null : findAction(e, payload.id);
    const id = view ? view.id : action!.id;
    const gated = view ? view.tier !== 1 : actionTier(e, action!) === 'tier-2'; const token = newId('exec');
    await update(host, (work, state) => {
      const at = nowMs(host); const held = work.executing[id];
      check(!held || at - held.at >= RESERVATION_MS, 'ACTION_ALREADY_ATTEMPTED', 'This action is already being done.');
      check(!gated || sendingOpen(state, work, id, at), 'SENDING_CLOSED', 'Sending stays closed until every unsure action is checked.');
      work.executing[id] = { at, token };
    });
    let done: PreparedAction | null = null; let notice: ActionView['notice'];
    try {
      if (view) { const reply = await host.call('writeback.execute', { id }) as Record<string, any>; if (record(reply?.notice) && typeof reply.notice.kind === 'string' && typeof reply.notice.message === 'string') notice = { kind: reply.notice.kind, message: reply.notice.message }; }
      else done = await host.services.actions.execute(ctx, id) as PreparedAction;
    }
    finally { await update(host, work => { if (work.executing[id]?.token === token) delete work.executing[id]; }); }
    const after = await env(ctx, host);
    if (!view) return actionView(after, done!);
    const out = wbActionView(after, findView(after, id)); return notice ? { ...out, notice } : out;
  } },
  'approvals.action': { permission: 'read', phone: true, async handler(ctx, payload, host) {
    exact(payload, ['id']); const e = await env(ctx, host); return anyActionView(e, payload.id);
  } },
  'approvals.resolveUnknown': { permission: 'approve', async handler(ctx, payload, host) {
    exact(payload, ['id', 'result']); check(['check', 'was-sent', 'was-not-sent'].includes(payload.result), 'INVALID_APPROVAL', 'Answer check, was-sent or was-not-sent.');
    const e = await env(ctx, host); const { source, raw } = parseId(payload.id);
    if (source === 'writeback') {
      check(findView(e, raw).status === 'unknown', 'INVALID_ACTION_STATE', 'Only an unsure action needs this.');
      // The system is read first; a person's word settles only what the system cannot show (write-back decides).
      if (payload.result === 'check') await host.call('writeback.readBack', { id: raw });
      else await host.call('writeback.settle', { id: raw, said: payload.result === 'was-sent' ? 'sent' : 'not-sent' });
      return anyActionView(await env(ctx, host), payload.id);
    }
    const action = findAction(e, payload.id);
    check(action.status === 'unknown', 'INVALID_ACTION_STATE', 'Only an unsure action needs this.');
    if (payload.result === 'check') { await host.services.actions.reconcile(ctx, action.id); return actionView(await env(ctx, host), findAction(await env(ctx, host), payload.id)); }
    const by = e.state.members.find(m => m.id === ctx.memberId)?.name ?? ctx.memberId;
    await update(host, (work, state) => { work.attestations[action.id] = { by, said: payload.result, at: isoAt(nowMs(host)) }; audit(state, 'action.attested', { actionId: action.id, said: payload.result, memberId: ctx.memberId }); });
    const after = await env(ctx, host); return actionView(after, findAction(after, payload.id));
  } },
  'approvals.ledger': { permission: 'read', phone: true, async handler(ctx, payload, host) {
    exact(payload, []); const e = await env(ctx, host);
    const items = [...visibleActions(e).map(a => actionView(e, a)), ...e.wb.views.map(v => wbActionView(e, v))];
    return { items: items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1)) };
  } },
  'approvals.reverse': { permission: 'approve', async handler(ctx, payload, host) {
    exact(payload, ['id']); const e = await env(ctx, host);
    // A write-back row states its reversal in words; it is prepared as a new action by a person, never here.
    if (parseId(payload.id).source === 'writeback') { findView(e, parseId(payload.id).raw); check(false, 'REVERSAL_NOT_AVAILABLE', 'This action cannot be reversed here.'); }
    const action = findAction(e, payload.id);
    const reversal = e.catalogue.entries.get(catalogueKey(action.connector, action.operation))?.reversal;
    check(action.status === 'verified' && reversal && e.catalogue.entries.has(catalogueKey(action.connector, reversal)), 'REVERSAL_NOT_AVAILABLE', 'This action cannot be reversed here.');
    const prepared = await host.services.actions.prepare(ctx, {
      connector: action.connector, operation: reversal, idempotencyKey: `reverse-${action.id}-${action.revision}`, sourceIds: action.sourceIds,
      payload: { reverses: action.id, externalId: action.result?.externalId ?? null, original: action.payload },
    }) as PreparedAction;
    return actionDetail(await env(ctx, host), prepared);
  } },
  'approvals.catalogue': { permission: 'read', async handler(ctx, payload, host) {
    exact(payload, []); const c = await catalogue(ctx, host);
    return { rows: [...c.entries.values()].map(catalogueRow).sort((a, b) => a.system.localeCompare(b.system) || a.action.localeCompare(b.action)), writeback: { available: c.writeback } };
  } },
  'approvals.catalogueEntry': { permission: 'read', async handler(ctx, payload, host) {
    exact(payload, ['system', 'action']); check(typeof payload.system === 'string' && typeof payload.action === 'string' && payload.system.length <= 80 && payload.action.length <= 80, 'INVALID_APPROVAL', 'Name a system and an action.');
    const entry = (await catalogue(ctx, host)).entries.get(catalogueKey(payload.system, payload.action)); check(entry, 'NOT_FOUND', 'Not in the list yet.');
    return catalogueEntry(entry);
  } },
  'approvals.wanted': { permission: 'prepare', async handler(ctx, payload, host) {
    exact(payload, ['system', 'text']);
    check(typeof payload.system === 'string' && payload.system.trim().length >= 1 && payload.system.length <= 80 && typeof payload.text === 'string' && payload.text.trim().length >= 3 && payload.text.length <= 500, 'INVALID_APPROVAL', 'Name the system and describe the action in up to 500 characters.');
    const by = host.store.read().members.find(m => m.id === ctx.memberId)?.name ?? ctx.memberId;
    const entry = { id: newId('wanted'), system: payload.system.trim(), text: payload.text.trim(), at: isoAt(nowMs(host)), by };
    await update(host, work => { check(work.wanted.length < WANTED_MAX, 'WANTED_LIST_FULL', 'The wanted list is full.'); work.wanted.push(entry); });
    // A system write-back knows is also counted on write-back's own wanted list (it answers "Not in the list yet").
    const name = entry.system.toLowerCase();
    const system = Object.entries(SYSTEM_TITLES).find(([id, title]) => id === name || title.toLowerCase() === name)?.[0];
    let writeback: 'listed' | 'counted' | null = null;
    if (system) {
      try { const reply = await optionalCall(host, 'writeback.request', { system, action: entry.text.slice(0, 60) }); writeback = reply.available ? 'listed' : null; }
      catch (error) { if ((error as ChausarError)?.code !== 'NOT_IN_CATALOGUE') throw error; writeback = 'counted'; }
    }
    return { id: entry.id, at: entry.at, writeback };
  } },
  'approvals.wantedList': { permission: 'read', async handler(ctx, payload, host) {
    exact(payload, []); const e = await env(ctx, host); return { items: [...e.work.wanted].reverse() };
  } },
  'approvals.afterRestore': { permission: 'read', async handler(ctx, payload, host) {
    exact(payload, []); const e = await env(ctx, host);
    // Write-back's send journal (outside the vault) names approved actions that may already have gone out.
    const restored = await optionalCall<unknown>(host, 'writeback.afterRestore', {});
    const journalled = new Set(restored.available && Array.isArray(restored.value) ? restored.value.filter(record).map((r: any) => r.id).filter((id: unknown) => typeof id === 'string') : []);
    const items = [
      ...visibleActions(e).filter(a => ['unknown', 'executing'].includes(a.status)).map(a => actionView(e, a)),
      ...e.wb.views.filter(v => ['unknown', 'executing'].includes(v.status) || journalled.has(v.id)).map(v => wbActionView(e, v)),
    ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const open = e.state.actions.filter((a: PreparedAction) => ['unknown', 'executing'].includes(a.status) || journalled.has(a.id));
    const canSee = (a: PreparedAction) => { try { host.services.actions.access(e.state, ctx, a); return true; } catch { return false; } };
    // Sending is closed by every unsure action, but only those the caller may see are listed or counted.
    const hidden = open.some(a => !canSee(a));
    // Each note is a fixed line of this lane; `noteKeys` names them in order so a screen says them in its own language.
    const keyed = [...(items.length ? [['closed-until-checked', 'Sending stays closed until every action below is checked.']] : []), ...(journalled.size ? [['may-have-gone-out', 'Some of these may already have gone out after the backup was made. Chausar will look before doing anything.']] : []), ...(hidden ? [['hidden-being-checked', 'Some actions you cannot see are still being checked.']] : [])] as [string, string][];
    return { sendingClosed: open.length > 0, items, notes: keyed.map(([, line]) => line), noteKeys: keyed.map(([k]) => k) };
  } },
  'approvals.exportPrepared': { permission: 'prepare', async handler(ctx, payload, host) {
    const id = idOf(payload);
    check(ctx.channel === undefined || ctx.channel === 'desktop', 'OPEN_DESKTOP', 'Download the file in the desktop app.');
    const e = await env(ctx, host); return exportPrepared(e, await fullDetail(e, id));
  } },
  'approvals.prepareReminder': { permission: 'prepare', async handler(ctx, payload, host) {
    exact(payload, ['connectionId', 'customerId', 'invoiceId'], ['language']);
    check([payload.connectionId, payload.customerId, payload.invoiceId].every(v => typeof v === 'string' && v.length >= 1 && v.length <= 200) && (payload.language === undefined || ['en', 'hi'].includes(payload.language)), 'INVALID_APPROVAL', 'Name the connection, the customer and the invoice.');
    let reply;
    try { reply = await optionalCall<unknown>(host, 'writeback.followUp.prepare', { connectionId: payload.connectionId, customerId: payload.customerId, invoiceId: payload.invoiceId, ...(payload.language ? { language: payload.language } : {}) }); }
    catch (error) {
      const code = (error as ChausarError)?.code;
      if (typeof code === 'string' && Object.hasOwn(REMINDER_BLOCKS, code)) return { id: null, blocked: { code, reason: REMINDER_BLOCKS[code] } };
      throw error;
    }
    check(reply.available, 'WRITEBACK_NOT_BUILT', 'Reminders arrive with write-back.');
    const view = parseView(reply.value);
    return view ? { id: `writeback:${view.id}`, blocked: null } : { id: null, blocked: null };
  } },
  'approvals.jobs': { permission: 'read', async handler(ctx, payload, host) {
    exact(payload, []); const e = await env(ctx, host);
    // jobs-ext (when installed) labels its own lane jobs and lists proposals, edits among them.
    const lane = await jobsxList(host);
    const rows = visibleJobs(e).map(job => laneRow(jobRow(e, job), lane.labels.get(job.id))).sort((a, b) => Number(b.state === 'proposed') - Number(a.state === 'proposed') || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return { items: rows.map(({ createdAt, ...row }) => row), active: rows.filter(r => !['cancelled', 'stopped', 'accepted', 'stopped-by-rule'].includes(r.state)).length, limit: 10 as const,
      proposals: lane.available ? { available: true, items: lane.proposals } : { available: false } };
  } },
  'approvals.job': { permission: 'read', async handler(ctx, payload, host) {
    exact(payload, ['id']); check(typeof payload.id === 'string', 'INVALID_APPROVAL', 'Use a job id.');
    const raw = /^(job|acceptance):/.test(payload.id) ? parseId(payload.id).raw : payload.id;
    const e = await env(ctx, host); const job = visibleJobs(e).find(j => j.id === raw); check(job, 'NOT_FOUND', 'Job not found.');
    const strings = (v: unknown) => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
    const d = job.deliverable as Record<string, unknown> | undefined;
    const timeline = job.ledger.map(l => ({ at: l.at, event: l.event, amount: l.amountMinor ? { minor: l.amountMinor } as Amount : null, needsModel: null, reason: l.reason ?? null }));
    return {
      ...jobCard(e.state, job),
      result: record(d) ? { done: strings(d.done), open: strings(d.open), recommends: strings(d.recommendations), receiptIds: strings(d.receiptIds) } : null,
      meters: jobMeters(e, job),
      // WK-10: the exact result to accept, as the queue item `acceptance:<id>` (approvals.approve with this digest).
      acceptance: job.status === 'awaiting-acceptance' ? { id: `acceptance:${job.id}`, digest: acceptanceDigest(acceptanceReference(e, job)) } : null,
      // WK-08 measure, WK-11 schedule, WK-16 person steps; for a lane job, jobs-ext's time line, measured meters and result (work-jobs-sheet.ts)
      ...(await jobSheetExtras(e, job, timeline, ctx.role !== 'viewer')),
    };
  } },
  ...workJobMethods,
};

/** Removes private notes tied to removed actions or jobs (and to ones that no longer exist). */
export const workPurge: NonNullable<EngineModule['purge']> = (state, reason) => {
  const ns = state.extensions?.['work-books'] as Record<string, unknown> | undefined;
  if (!ns || !Object.hasOwn(ns, 'work')) return 0;
  const work = normalizeWork(ns.work as WorkState); let removed = 0;
  const actions = new Set(state.actions.map((a: PreparedAction) => a.id)); const jobs = new Set(state.jobs.map((j: Job) => j.id));
  // Drafts and lessons are read from their owners' state; when that state cannot be read their entries are kept.
  const books = peekSection<{ drafts?: unknown }>(state, 'books');
  const draftIds = books === undefined ? null : new Set((Array.isArray(books.drafts) ? books.drafts : []).map((d: any) => d?.id).filter((id: unknown) => typeof id === 'string'));
  const ls = state.lessonState as { lessons?: unknown } | undefined;
  const lessonIds = ls && Array.isArray(ls.lessons) ? new Set(ls.lessons.flatMap((l: any) => [l?.id, ...(Array.isArray(l?.revisions) ? l.revisions.map((r: any) => r?.id) : [])]).filter((id: unknown) => typeof id === 'string')) : null;
  const gone = (typed: string) => {
    const m = /^(action|job|acceptance|release|lesson|writeback|proposal):(.+)$/.exec(typed); if (!m) return false;
    if (reason.removedIds.has(m[2])) return true;
    if (m[1] === 'proposal') return false;   // jobs-ext keeps its proposals; a snooze on one ends with its time
    if (m[1] === 'release') return draftIds !== null && !draftIds.has(m[2]);
    if (m[1] === 'lesson') return lessonIds !== null && !lessonIds.has(m[2]);
    return !(m[1] === 'action' || m[1] === 'writeback' ? actions : jobs).has(m[2]);
  };
  const goneAction = (id: string) => reason.removedIds.has(id) || !actions.has(id);
  for (const map of [work.attestations, work.channels, work.revisedAt, work.executing] as Record<string, unknown>[]) for (const id of Object.keys(map)) if (goneAction(id)) { delete map[id]; removed += 1; }
  for (const member of Object.values(work.snoozes)) for (const id of Object.keys(member)) if (gone(id)) { delete member[id]; removed += 1; }
  for (const key of Object.keys(work.opened)) if (gone(key.slice(key.indexOf(' ') + 1))) { delete work.opened[key]; removed += 1; }
  return removed + boundLogs(work);
};
