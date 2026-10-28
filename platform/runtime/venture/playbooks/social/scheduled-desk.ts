// Chausar S12 owner-approved single-slot scheduling. Original code, no standing auto-post permission.
import { check } from '../../../contracts.ts';
import type { SocialScheduledRecord } from '../../contracts.ts';
import { digest, exactPayload, findRecord, listRecords, readVenture, requireAppChannel, ventureAction } from '../../records.ts';
import { approveScheduledPostIn, scheduledPostProposalIn, scheduledPostingAccount, validateScheduledPost, LINKEDIN_HANDOFF_ONLY } from '../../build/posting.ts';
import { scheduledFilesDigest } from './scheduled-source.ts';
import { discardScheduledApproval, rememberScheduledApproval, scheduledItem } from './scheduled.ts';
import { SLOT_GRACE_MS, SCHEDULED_WORDS, slotApprovalPart, type SocialScheduledItem } from './scheduled-core.ts';
import type { DeskHandlers } from '../desk-types.ts';
export type ScheduledDeskTypes = {
    scheduled: {
        filter: null;
        row: SocialScheduledItem;
        item: SocialScheduledItem;
        actions: {
            create: {
                payload: {
                    postId: string | null;
                    connectorId: string;
                    dueAt: string;
                };
                result: SocialScheduledItem;
            };
            approve: {
                payload: Record<string, never>;
                result: SocialScheduledItem;
            };
            cancel: {
                payload: Record<string, never>;
                result: SocialScheduledItem;
            };
        };
    };
};
export const SCHEDULED_DESK: DeskHandlers = { scheduled: {
        async list(deps, ctx, payload) { const p = exactPayload(payload, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); check(p.filter === undefined || p.filter === null, 'INVALID_VENTURE_REQUEST', 'This slot list has no filters.'); const { state, venture } = readVenture(deps, ctx); return { playbook: 'social-agency', kind: 'scheduled', rows: listRecords(state, 'venture-social-scheduled', venture.id).map(scheduledItem), line: 'Each slot needs approval of its exact post and time.' }; },
        async get(deps, ctx, payload) { exactPayload(payload, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']); const { state, venture } = readVenture(deps, ctx); const row = listRecords(state, 'venture-social-scheduled', venture.id).find(row => row.id === payload.id); check(row, 'SLOT_NOT_FOUND', 'That scheduled slot was not found.'); const item = scheduledItem(row); return { playbook: 'social-agency', kind: 'scheduled', item, digest: digest(item) }; },
        async act(deps, ctx, payload) {
            requireAppChannel(ctx, 'venture.desk.act');
            exactPayload(payload, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
            check(deps.host !== 'hosted-web', 'SLOT_DESKTOP_ONLY', 'Scheduled posts run only in this desktop business.');
            let scheduledAccount:string|null=null;
            if(payload.action==='create'){
              const input=exactPayload(payload.payload,['postId','connectorId','dueAt'],['postId','connectorId','dueAt']);
              if(typeof input.postId==='string') { const {state,venture}=readVenture(deps,ctx); const post=findRecord(state,'venture-connector-post',input.postId); check(post&&post.ventureId===venture.id,'POST_NOT_FOUND','That post is not in this business.'); scheduledAccount=await scheduledPostingAccount(deps,post); }
            }
            if (payload.action === 'approve') {
                const { state, venture } = readVenture(deps, ctx);
                const slot = listRecords(state, 'venture-social-scheduled', venture.id).find(row => row.id === payload.id);
                check(slot, 'SLOT_NOT_FOUND', 'That scheduled slot was not found.');
                check(payload.digest === digest(scheduledItem(slot)), 'SLOT_STALE', 'This slot changed. Review it again.');
                if (slot.postId) {
                    const post = findRecord(state, 'venture-connector-post', slot.postId);
                    check(post && post.ventureId === venture.id, 'POST_NOT_FOUND', 'That post is not in this business.');
                    await validateScheduledPost(deps, post);
                }
            }
            let token: string | null = null;
            const result = await ventureAction(deps, ctx, 'approve', 'social.scheduled.' + payload.action, tx => {
                let row: SocialScheduledRecord;
                if (payload.action === 'create') {
                    check(payload.id === 'new' && payload.digest === undefined, 'INVALID_VENTURE_REQUEST', 'A new slot has no prior digest.');
                    const p = exactPayload(payload.payload, ['postId', 'connectorId', 'dueAt'], ['postId', 'connectorId', 'dueAt']);
                    check(typeof p.connectorId === 'string' && ['x', 'instagram', 'youtube', 'linkedin'].includes(p.connectorId), 'INVALID_VENTURE_REQUEST', 'Choose a posting channel.');
                    check(p.connectorId !== 'linkedin', 'NOT_BUILT_YET', LINKEDIN_HANDOFF_ONLY);
                    check(typeof p.dueAt === 'string' && Number.isFinite(Date.parse(p.dueAt)) && new Date(p.dueAt).toISOString() === p.dueAt && Date.parse(p.dueAt) >= Date.parse(tx.now) && Date.parse(p.dueAt) <= Date.parse(tx.now) + 366 * 86400000, 'SLOT_TIME_INVALID', 'Choose a future time within one year.');
                    check(p.postId === null || typeof p.postId === 'string', 'INVALID_VENTURE_REQUEST', 'Choose a waiting post or leave this slot empty.');
                    const post = p.postId === null ? null : tx.find('venture-connector-post', p.postId as string);
                    check(p.postId === null || (post && post.ventureId === tx.venture!.id && post.state === 'described' && post.connectorId === p.connectorId && !post.scheduled), 'POST_NOT_FOUND', 'Choose a waiting post in this business and channel.');
                    const files = post?.draftId ? scheduledFilesDigest(tx.state, post.draftId) : null;
                    check(!post || files !== null, 'SLOT_STALE', SCHEDULED_WORDS.changed);
                    const base = tx.base('venture-social-scheduled');
                    const deadlineAt = new Date(Date.parse(p.dueAt) + SLOT_GRACE_MS).toISOString();
                    const scheduled = post ? scheduledPostProposalIn(tx, post.id, post.digest, { slotId: base.id, dueAt: p.dueAt, deadlineAt, filesDigest: files! }, scheduledAccount!) : null;
                    row = tx.put({ ...base, postId: scheduled?.id ?? null, connectorId: p.connectorId, text: post?.text ?? '', account: scheduled?.account ?? null, mode: post?.mode ?? null, dueAt: p.dueAt, deadlineAt: new Date(Date.parse(p.dueAt) + SLOT_GRACE_MS).toISOString(), postDigest: scheduled?.digest ?? null, filesDigest: files, approvedDigest: null, approvedAt: null, approvedBy: null, nothingReadyAt: null, state: 'draft', reason: SCHEDULED_WORDS.draft });
                }
                else {
                    exactPayload(payload.payload, []);
                    const found = tx.list('venture-social-scheduled').find(row => row.id === payload.id);
                    check(found, 'SLOT_NOT_FOUND', 'That scheduled slot was not found.');
                    check(payload.digest === digest(scheduledItem(found)), 'SLOT_STALE', 'This slot changed. Review it again.');
                    row = found;
                    if (payload.action === 'approve') {
                        check(row.state === 'draft', 'SLOT_FROZEN', 'This slot is already decided. Create a new slot for a change.');
                        check(Date.parse(tx.now) <= Date.parse(row.deadlineAt), 'SLOT_TIME_INVALID', 'This slot is too late. Choose a new time.');
                        if (row.postId) {
                            const post = tx.find('venture-connector-post', row.postId);
                            check(post && post.draftId && post.digest === row.postDigest && scheduledFilesDigest(tx.state, post.draftId) === row.filesDigest, 'SLOT_STALE', SCHEDULED_WORDS.changed);
                            const approved = approveScheduledPostIn(tx, ctx, deps.store, post.id, row.postDigest!, { slotId: row.id, dueAt: row.dueAt, deadlineAt: row.deadlineAt, filesDigest: row.filesDigest! });
                            token = approved.token;
                        }
                        row = tx.replace({ ...row, state: 'scheduled', approvedAt: tx.now, approvedBy: ctx.memberId, approvedDigest: digest(slotApprovalPart(scheduledItem(row))), reason: SCHEDULED_WORDS.scheduled });
                    }
                    else if (payload.action === 'cancel') {
                        check(['draft', 'scheduled', 'waiting'].includes(row.state), 'SLOT_FROZEN', 'This slot is already decided. Create a new slot for a change.');
                        const post = row.postId ? tx.find('venture-connector-post', row.postId) : null;
                        check(!post?.claimedAt, 'POST_ALREADY_DECIDED', 'This post has already started. Check its outcome.');
                        if (post && (post.state === 'approved' || post.state === 'described'))
                            tx.replace({ ...post, state: 'rejected', outcome: { by: 'owner', line: SCHEDULED_WORDS.cancelled, url: null }, journal: [...post.journal, { state: 'rejected', at: tx.now, by: ctx.memberId, line: SCHEDULED_WORDS.cancelled }] });
                        row = tx.replace({ ...row, state: 'cancelled', reason: SCHEDULED_WORDS.cancelled });
                    }
                    else
                        check(false, 'INVALID_VENTURE_REQUEST', 'Choose a slot action shown in this desk.');
                }
                tx.emit('desk.changed', { playbook: 'social-agency', id: row.id });
                return { playbook: 'social-agency' as const, kind: 'scheduled', id: row.id, result: scheduledItem(row), line: row.reason };
            });
            if (token)
                rememberScheduledApproval(deps.store, result.id, token, ctx, deps.closing?.signal);
            if (payload.action === 'cancel')
                discardScheduledApproval(deps.store, result.id);
            return result;
        }
    } };
