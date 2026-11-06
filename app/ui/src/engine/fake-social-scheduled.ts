// Chausar fake S12 scheduled desk, matching exact slot fields and approval checks. No outside post is made by the fake.
import { EngineError } from './types';
import type { W4DeskHost } from './fake-w4';
import type { FakeForgottenPerson, FakeDeskKind } from './fake-playbooks';
import { POSTING_WORDS } from './fake-posting';
import { SLOT_GRACE_MS, SCHEDULED_WORDS, slotApprovalPart, type SocialScheduledItem } from '../../../../platform/runtime/venture/playbooks/social/scheduled-core';
const need = (ok: unknown, code: string, line: string): void => {
    if (!ok)
        throw new EngineError(code, line);
};
const exact = (raw: unknown, keys: string[], required = keys) => { need(raw && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_VENTURE_REQUEST', 'Send one request object.'); const p = raw as Record<string, unknown>; need(Object.keys(p).every(key => keys.includes(key)) && required.every(key => Object.hasOwn(p, key)), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.'); return p; };
export function fakeSocialScheduledKind(host: W4DeskHost): FakeDeskKind & {
    forgetPeople(people: readonly FakeForgottenPerson[], erase: boolean): void;
} {
    const all = new Map<string, Map<string, SocialScheduledItem>>();
    let seq = 0;
    const authority = new Map<string, number>();
    const current = () => {
        if (!all.has(host.current()))
            all.set(host.current(), new Map());
        return all.get(host.current())!;
    };
    const item = (id: unknown) => { const row = current().get(String(id)); need(row, 'SLOT_NOT_FOUND', 'That scheduled slot was not found.'); return structuredClone(row!); };
    const save = (value: SocialScheduledItem) => { current().set(value.id, structuredClone(value)); host.emit({ type: 'desk.changed', businessId: host.current(), id: value.id } as never); };
    const account = (post: NonNullable<ReturnType<NonNullable<W4DeskHost['scheduledPost']>>>, bound = post.account) => {
        const running = post.liveAccount === undefined ? post.account : post.liveAccount;
        need(bound, 'ACCOUNT_FENCE', 'Chausar cannot identify the signed-in account. Sign in and review this slot again.');
        need(running, 'ACCOUNT_FENCE', `This was approved for ${bound}, and Chausar cannot tell which account it would run under. Nothing was sent.`);
        need(bound!.trim().toLowerCase() === running!.trim().toLowerCase(), 'ACCOUNT_FENCE', `This was approved for ${bound}, not ${running}. Nothing was sent; approve it again for this account.`);
    };
    const tick = () => {
        if (host.hosted())
            return;
        for (const row of [...current().values()].sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
            if (!['scheduled', 'waiting'].includes(row.state) || row.dueAt > host.now())
                continue;
            const post = row.postId ? host.scheduledPost?.(row.postId) : null;
            let state: SocialScheduledItem['state'] = 'waiting', reason: string = SCHEDULED_WORDS.empty;
            if (post?.state === 'applied') {
                state = 'posted';
                reason = 'The post went out.';
            }
            else if (post?.state === 'outcome_unknown' || post?.state === 'approved' && post.claimedAt) {
                state = 'unknown';
                reason = 'The post may have gone out. Check the platform before doing anything else.';
            }
            else if (Date.parse(host.now()) >= Date.parse(row.deadlineAt)) {
                state = 'missed';
                reason = SCHEDULED_WORDS.missed;
            }
            else if (row.approvedDigest !== host.digest(slotApprovalPart(row))) {
                state = 'blocked';
                reason = SCHEDULED_WORDS.changed;
            }
            else if (row.postId && authority.get(row.id) !== (host.scheduledSession?.() ?? 0)) {
                state = 'blocked';
                reason = SCHEDULED_WORDS.restart;
            }
            else if (row.postId) {
                try {
                    need(post && post.state === 'approved' && post.digest === row.postDigest && post.filesDigest === row.filesDigest, 'SLOT_STALE', SCHEDULED_WORDS.changed);
                    account(post!, row.account);
                    if (post!.blocked)
                        throw new EngineError(post!.blocked.code, post!.blocked.line);
                    if (host.scheduledBusy?.(row.postId)) {
                        reason = SCHEDULED_WORDS.busy;
                    }
                    else {
                        need(host.decideScheduledPost, 'POST_NOT_FOUND', 'That post is no longer available.');
                        host.decideScheduledPost!(row.postId, 'applied');
                        state = 'posted';
                        reason = 'The post went out.';
                    }
                }
                catch (error) {
                    state = error instanceof EngineError && error.code === 'POST_RISK_BLOCKED' ? 'waiting' : 'blocked';
                    reason = error instanceof Error ? error.message : 'This post could not run. Review a new slot.';
                }
            }
            if ((state === 'blocked' || state === 'missed') && post?.state === 'approved' && !post.claimedAt)
                host.decideScheduledPost?.(post.id, 'rejected');
            const nothingReadyAt = !row.postId && state === 'waiting' ? row.nothingReadyAt ?? host.now() : row.nothingReadyAt;
            if (row.state !== state || row.reason !== reason || row.nothingReadyAt !== nothingReadyAt)
                save({ ...row, state, reason, nothingReadyAt });
        }
    };
    return {
        forgetPeople(people, erase) {
            if (!erase)
                return;
            const parts = new Set<string>();
            for (const person of people)
                for (const raw of person.names) {
                    const name = raw.trim();
                    if (!name || name.includes('@') || name.startsWith('+') || name.startsWith('http'))
                        continue;
                    parts.add(name);
                    for (const word of name.split(/[\s,.]+/))
                        if ([...word].length >= 3)
                            parts.add(word);
                }
            const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const sorted = [...parts].sort((a, b) => b.length - a.length);
            const patterns = [...sorted.filter(part => !/\s/.test(part)).map(part => escape(part) + '\\s+\\p{L}\\.'), ...sorted.map(escape)];
            const names = patterns.length ? new RegExp('(?<![\\p{L}\\p{N}])(?:' + patterns.join('|') + ')(?![\\p{L}\\p{N}])', 'iu') : null;
            const handles = people.flatMap(p => [...p.emails, ...p.phones, ...(p.urls??[])]).map(s => s.toLowerCase()).filter(Boolean);
            for (const row of current().values()) {
                const text = row.text + ' ' + (row.account ?? '');
                if (!names?.test(text) && !handles.some(handle => text.toLowerCase().includes(handle)))
                    continue;
                if (row.postId)
                    host.eraseScheduledPost?.(row.postId);
                save({ ...row, text: '', account: null, postId: null, postDigest: null, filesDigest: null, approvedDigest: null, approvedAt: null, approvedBy: null, state: 'cancelled', reason: SCHEDULED_WORDS.forgotten });
            }
        },
        list(raw) { tick(); const p = exact(raw, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); need(p.filter === undefined || p.filter === null, 'INVALID_VENTURE_REQUEST', 'This slot list has no filters.'); return { playbook: 'social-agency', kind: 'scheduled', rows: [...current().values()].map(row => structuredClone(row)), line: 'Each slot needs approval of its exact post and time.' }; },
        get(raw) { tick(); const p = exact(raw, ['playbook', 'kind', 'id']); const value = item(p.id); return { playbook: 'social-agency', kind: 'scheduled', item: value, digest: host.digest(value) }; },
        act(raw) {
            const p = exact(raw, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
            need(!host.hosted(), 'SLOT_DESKTOP_ONLY', 'Scheduled posts run only in this desktop business.');
            let value: SocialScheduledItem;
            if (p.action === 'create') {
                need(p.id === 'new' && p.digest === undefined, 'INVALID_VENTURE_REQUEST', 'A new slot has no prior digest.');
                const input = exact(p.payload, ['postId', 'connectorId', 'dueAt']);
                need(typeof input.connectorId === 'string' && ['x', 'instagram', 'youtube', 'linkedin', 'bluesky', 'mastodon', 'telegram', 'discord'].includes(input.connectorId), 'INVALID_VENTURE_REQUEST', 'Choose a posting channel.');
                need(input.connectorId !== 'linkedin', 'NOT_BUILT_YET', POSTING_WORDS.linkedin);
                need(typeof input.dueAt === 'string' && Number.isFinite(Date.parse(input.dueAt)) && new Date(input.dueAt).toISOString() === input.dueAt && Date.parse(input.dueAt) >= Date.parse(host.now()) && Date.parse(input.dueAt) <= Date.parse(host.now()) + 366 * 86400000, 'SLOT_TIME_INVALID', 'Choose a future time within one year.');
                need(input.postId === null || typeof input.postId === 'string', 'INVALID_VENTURE_REQUEST', 'Choose a waiting post or leave this slot empty.');
                const post = input.postId === null ? null : host.scheduledPost?.(String(input.postId));
                need(input.postId === null || (post && post.state === 'described' && post.connectorId === input.connectorId && !post.scheduled), 'POST_NOT_FOUND', 'Choose a waiting post in this business and channel.');
                if (post)
                    account(post);
                const id = 'socialslot_fake_' + (++seq), dueAt = input.dueAt as string, deadlineAt = new Date(Date.parse(dueAt) + SLOT_GRACE_MS).toISOString();
                const moved = post ? host.moveScheduledPost?.(post.id, { slotId: id, dueAt, deadlineAt, filesDigest: post.filesDigest }) : null;
                need(!post || moved, 'POST_NOT_FOUND', 'Choose a waiting post in this business and channel.');
                value = { id, postId: moved?.id ?? null, connectorId: input.connectorId as string, text: post?.text ?? '', account: post?.account ?? null, mode: post?.mode ?? null, dueAt, deadlineAt, postDigest: moved?.digest ?? null, filesDigest: post?.filesDigest ?? null, approvedDigest: null, approvedAt: null, approvedBy: null, nothingReadyAt: null, state: 'draft', reason: SCHEDULED_WORDS.draft };
            }
            else {
                exact(p.payload, []);
                value = item(p.id);
                need(p.digest === host.digest(value), 'SLOT_STALE', 'This slot changed. Review it again.');
                if (p.action === 'approve') {
                    need(value.state === 'draft', 'SLOT_FROZEN', 'This slot is already decided. Create a new slot for a change.');
                    need(Date.parse(host.now()) <= Date.parse(value.deadlineAt), 'SLOT_TIME_INVALID', 'This slot is too late. Choose a new time.');
                    if (value.postId) {
                        const post = host.scheduledPost?.(value.postId);
                        need(post && post.state === 'described' && post.digest === value.postDigest && post.filesDigest === value.filesDigest, 'SLOT_STALE', SCHEDULED_WORDS.changed);
                        account(post!, value.account);
                        if (post!.blocked)
                            throw new EngineError(post!.blocked.code, post!.blocked.line);
                        host.decideScheduledPost?.(value.postId, 'approved');
                    }
                    authority.set(value.id, host.scheduledSession?.() ?? 0);
                    value = { ...value, state: 'scheduled', approvedAt: host.now(), approvedBy: 'owner', approvedDigest: host.digest(slotApprovalPart(value)), reason: SCHEDULED_WORDS.scheduled };
                }
                else if (p.action === 'cancel') {
                    need(['draft', 'scheduled', 'waiting'].includes(value.state), 'SLOT_FROZEN', 'This slot is already decided. Create a new slot for a change.');
                    if (value.postId) {
                        need(!host.scheduledPost?.(value.postId)?.claimedAt, 'POST_ALREADY_DECIDED', 'This post has already started. Check its outcome.');
                        host.decideScheduledPost?.(value.postId, 'rejected');
                    }
                    value = { ...value, state: 'cancelled', reason: SCHEDULED_WORDS.cancelled };
                }
                else
                    throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose a slot action shown in this desk.');
            }
            current().set(value.id, structuredClone(value));
            host.emit({ type: 'desk.changed', businessId: host.current(), id: value.id } as never);
            return { playbook: 'social-agency', kind: 'scheduled', id: value.id, result: structuredClone(value), line: value.reason };
        }
    };
}
