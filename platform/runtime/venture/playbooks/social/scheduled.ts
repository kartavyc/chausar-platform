// Chausar S12 scheduled execution. Original implementation over the existing exact post journal.
import { ChausarError, type Context } from '../../../contracts.ts';
import type { VentureDeps, SocialScheduledRecord } from '../../contracts.ts';
import { currentVenture, digest, findRecord, listRecords, ventureAction } from '../../records.ts';
import { applyApprovedPost, draftDigestOf, validateScheduledPost } from '../../build/posting.ts';
import { scheduledFilesDigest } from './scheduled-source.ts';
import { slotApprovalPart, SCHEDULED_WORDS, type SocialScheduledItem } from './scheduled-core.ts';
const approvals = new WeakMap<object, Map<string, {
    token: string;
    ctx: Context;
}>>();
const busy = new WeakSet<object>();
const closingHooks = new WeakMap<object, AbortSignal>();
export function rememberScheduledApproval(store: object, id: string, token: string, ctx: Context, signal?: AbortSignal): void { if (signal?.aborted)
    return; if (signal && closingHooks.get(store) !== signal) {
    closingHooks.set(store, signal);
    signal.addEventListener('abort', () => forgetScheduledApprovals(store), { once: true });
} const entries = approvals.get(store) ?? new Map(); entries.set(id, { token, ctx: { ...ctx } }); approvals.set(store, entries); }
/** The host naturally loses these on close/restart. Also used by lifecycle tests. Tokens never enter records. */
export function forgetScheduledApprovals(store: object): void { approvals.delete(store); }
export function discardScheduledApproval(store: object, id: string): void { approvals.get(store)?.delete(id); }
export function scheduledItem(row: SocialScheduledRecord): SocialScheduledItem { const { id, postId, connectorId, text, account, mode, dueAt, deadlineAt, postDigest, filesDigest, approvedDigest, approvedAt, approvedBy, nothingReadyAt, state, reason } = row; return { id, postId, connectorId, text, account, mode, dueAt, deadlineAt, postDigest, filesDigest, approvedDigest, approvedAt, approvedBy, nothingReadyAt, state, reason }; }
async function mark(deps: VentureDeps, ctx: Context, id: string, state: SocialScheduledRecord['state'], reason: string, nothingReady = false) { await ventureAction(deps, ctx, 'prepare', 'social.scheduled.status', tx => { const row = tx.find('venture-social-scheduled', id); if (!row || !['scheduled', 'waiting'].includes(row.state))
    return; if (row.state === state && row.reason === reason)
    return; if (['blocked', 'missed'].includes(state) && row.postId) {
    const post = tx.find('venture-connector-post', row.postId);
    if (post?.state === 'approved' && !post.claimedAt)
        tx.replace({ ...post, state: 'rejected', outcome: { by: 'engine', line: reason, url: null }, journal: [...post.journal, { state: 'rejected', at: tx.now, by: 'engine', line: reason }] });
} tx.replace({ ...row, state, reason, nothingReadyAt: nothingReady ? row.nothingReadyAt ?? tx.now : row.nothingReadyAt }); tx.emit('desk.changed', { playbook: 'social-agency', id }); }); }
/** Each due slot is retried while busy only within its approved sixty-minute window. Never reapproves or retries an uncertain post. */
export async function runSocialScheduledDue(deps: VentureDeps, ctx: Context): Promise<void> {
    if (deps.host === 'hosted-web' || deps.closing?.signal.aborted || busy.has(deps.store))
        return;
    busy.add(deps.store);
    const release = deps.closing?.hold();
    try {
        const venture = currentVenture(deps.store.read());
        if (!venture)
            return;
        const due = listRecords(deps.store.read(), 'venture-social-scheduled', venture.id).filter(row => ['scheduled', 'waiting'].includes(row.state) && row.dueAt <= deps.clock().toISOString()).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
        for (const slot of due) {
            if (deps.closing?.signal.aborted)
                break;
            const post = slot.postId ? findRecord(deps.store.read(), 'venture-connector-post', slot.postId) : undefined;
            if (post?.state === 'applied') {
                await mark(deps, ctx, slot.id, 'posted', post.outcome?.line ?? 'The post went out.');
                discardScheduledApproval(deps.store, slot.id);
                continue;
            }
            if (post?.state === 'outcome_unknown' || (post?.state === 'approved' && post.claimedAt)) {
                await mark(deps, ctx, slot.id, 'unknown', 'The post may have gone out. Check the platform before doing anything else.');
                discardScheduledApproval(deps.store, slot.id);
                continue;
            }
            if (Date.parse(deps.clock().toISOString()) >= Date.parse(slot.deadlineAt)) {
                await mark(deps, ctx, slot.id, 'missed', SCHEDULED_WORDS.missed);
                discardScheduledApproval(deps.store, slot.id);
                continue;
            }
            if (slot.approvedDigest !== digest(slotApprovalPart(scheduledItem(slot)))) {
                await mark(deps, ctx, slot.id, 'blocked', SCHEDULED_WORDS.changed);
                discardScheduledApproval(deps.store, slot.id);
                continue;
            }
            if (!slot.postId) {
                await mark(deps, ctx, slot.id, 'waiting', SCHEDULED_WORDS.empty, true);
                continue;
            }
            const approval = approvals.get(deps.store)?.get(slot.id);
            if (!approval) {
                await mark(deps, ctx, slot.id, 'blocked', SCHEDULED_WORDS.restart);
                continue;
            }
            const draft = post?.draftId ? findRecord(deps.store.read(), 'venture-delivery-run', post.draftId) : undefined;
            if (!post || post.state !== 'approved' || post.scheduled?.slotId !== slot.id || !draft || draftDigestOf(draft) !== post.draftDigest || scheduledFilesDigest(deps.store.read(), draft.id) !== slot.filesDigest) {
                await mark(deps, ctx, slot.id, 'blocked', SCHEDULED_WORDS.changed);
                discardScheduledApproval(deps.store, slot.id);
                continue;
            }
            const sending = listRecords(deps.store.read(), 'venture-connector-post', venture.id).some(row => row.id !== post.id && row.state === 'approved' && row.claimedAt !== null);
            if (sending) {
                await mark(deps, ctx, slot.id, 'waiting', SCHEDULED_WORDS.busy);
                continue;
            }
            try {
                await validateScheduledPost(deps, post);
                if (deps.closing?.signal.aborted)
                    break;
                const result = await applyApprovedPost(deps, approval.ctx, post.id, approval.token);
                await mark(deps, ctx, slot.id, result.post.state === 'applied' ? 'posted' : result.post.state === 'outcome_unknown' ? 'unknown' : 'blocked', result.line);
            }
            catch (error) {
                if (error instanceof ChausarError && error.code === 'POST_RISK_BLOCKED') {
                    await mark(deps, ctx, slot.id, 'waiting', error.message);
                    continue;
                }
                await mark(deps, ctx, slot.id, 'blocked', error instanceof ChausarError ? error.message : 'This post could not start. Review its status before trying again.');
            }
            discardScheduledApproval(deps.store, slot.id);
        }
    }
    finally {
        release?.();
        busy.delete(deps.store);
    }
}
