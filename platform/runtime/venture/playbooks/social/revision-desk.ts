import {revisionReceiptId} from './revision-receipt.ts';
import type { RevisionQuote, SocialRevisionRow } from './revision-types.ts';
export type { RevisionQuote, SocialRevisionRow } from './revision-types.ts';
// Owner-approved per-post revisions. An extra round has an exact quote before a model preview.
import { check, type State } from '../../../contracts.ts';
import { formatMinor } from '../../../currency.ts';
import { digest, findRecord, listRecords, requireAppChannel, exactPayload, ventureAction } from '../../records.ts';
import { readAs } from '../../delivery/shared.ts';
import { startRevision, revisionWords } from '../../delivery/revise.ts';
import type { DeskHandlers } from '../desk-types.ts';
import { draftPostsOf, parsePostId, draftApprovalsOfRun } from './run-approvals.ts';
import { emptyGhostwriting, draftDigest } from './approvals.ts';
import { ghostwritingOffer, socialRevisionOffer } from './ghostwriting.ts';


export type SocialRevisionDeskTypes = {
    revision: {
        filter: {
            runId?: string;
        };
        row: SocialRevisionRow;
        item: SocialRevisionRow;
        actions: {
            quote: {
                payload: {
                    runId: string;
                    postId: string;
                    words: string;
                };
                result: RevisionQuote | null;
            };
            revise: {
                payload: {
                    runId: string;
                    postId: string;
                    words: string;
                    quoteDigest?: string;
                };
                result: {
                    runId: string;
                };
            };
            'client-answer': {
                payload: {
                    runId: string;
                    postId: string;
                    decision: 'approved' | 'changes';
                    comment?: string;
                };
                result: {
                    postId: string;
                };
            };
        };
    };
};
function key(postId: string) { const parsed = parsePostId(postId); check(parsed, 'INVALID_VENTURE_REQUEST', 'Choose a post.'); return 'post-' + parsed.n; }
function context(state: State, ventureId: string, runId: string, postId: string) {
    const run = findRecord(state, 'venture-delivery-run', runId);
    check(run && run.ventureId === ventureId && socialRevisionOffer(state, run), 'DELIVERY_NOT_FOUND', 'Choose a social draft.');
    const order = findRecord(state, 'venture-order', run.orderId)!;
    const post = draftPostsOf(run).find(p => p.draftId === postId);
    check(post, 'INVALID_VENTURE_REQUEST', 'Choose a post from this draft.');
    return { run, order, post };
}
function row(state: State, ventureId: string, runId: string, postId: string, words = ''): SocialRevisionRow {
    const { run, order, post } = context(state, ventureId, runId, postId);
    const stored = order.socialGhostwriting ?? emptyGhostwriting();
    const used = stored.rounds[key(postId)] ?? 0;
    const venture = findRecord(state, 'venture-record', ventureId)!;
    const currency = venture.country.currency;
    const raw = order.intake?.fields?.extraRoundPrice;
    const amount = typeof raw === 'string' && /^\d{1,30}$/.test(raw) ? raw : null;
    const exact = digest({ runId, postId, text: post.text, pack: run.editedText ?? run.renderedText, used, price: amount, currency, status: run.status });
    const receiptId=amount===null?'':revisionReceiptId(order.id,post.n,used+1,amount,currency);
    const quote = !ghostwritingOffer(state, run) || used < 2 || amount === null ? null : { round: used + 1, amountMinor: amount, currency, display: formatMinor(amount, currency), receiptId, digest: digest({ item: exact, words, amount, currency, round: used + 1, receiptId }) };
    const answer = stored.decisions[key(postId)];
    return { id: postId, runId, postId, text: post.text, roundsUsed: used, clientDecision: draftApprovalsOfRun(state,runId).find(item=>item.post.draftId===postId)?.approval.client.decision??null, quote, digest: exact };
}
export const SOCIAL_REVISION_DESK: DeskHandlers = { revision: {
        async list(deps, ctx, p) { const { state, venture } = readAs(deps, ctx, 'read'); const filter = exactPayload(p.filter ?? {}, ['runId'], []); const rows = listRecords(state, 'venture-delivery-run', venture.id).filter(r => socialRevisionOffer(state, r) && (!filter.runId || r.id === filter.runId)).flatMap(r => draftPostsOf(r).map(post => row(state, venture.id, r.id, post.draftId))); return { playbook: 'social-agency', kind: 'revision', rows, line: 'Choose one post to refine. Extra rounds show their exact quote.' }; },
        async get(deps, ctx, p) { const { state, venture } = readAs(deps, ctx, 'read'); const parsed = parsePostId(p.id); check(parsed, 'INVALID_VENTURE_REQUEST', 'Choose a post.'); const item = row(state, venture.id, parsed.runId, p.id); return { playbook: 'social-agency', kind: 'revision', item, digest: item.digest }; },
        async act(deps, ctx, p) {
            requireAppChannel(ctx, 'venture.desk.act');
            const { state, venture } = readAs(deps, ctx, 'approve');
            const b = exactPayload(p.payload, p.action === 'client-answer' ? ['runId', 'postId', 'decision', 'comment'] : ['runId', 'postId', 'words', ...(p.action === 'revise' ? ['quoteDigest'] : [])], p.action === 'client-answer' ? ['runId', 'postId', 'decision'] : ['runId', 'postId', 'words']);
            check(typeof b.runId === 'string' && typeof b.postId === 'string' && p.id === b.postId, 'INVALID_VENTURE_REQUEST', 'Choose this post.');
            const runId = b.runId, postId = b.postId;
            const words = p.action === 'client-answer' ? '' : b.words;
            check(typeof words === 'string' && (p.action === 'client-answer' || words.trim().length > 0 && words.length <= 300), 'INVALID_VENTURE_REQUEST', 'Describe the revision in at most 300 characters.');
            const shown = row(state, venture.id, runId, postId, words);
            check(p.digest === shown.digest, 'APPROVAL_STALE', 'This post or its price changed. Read it again.');
            if (p.action === 'quote')
                return { playbook: 'social-agency', kind: 'revision', id: postId, result: shown.quote, line: shown.quote ? 'Approve the exact extra-round quote before revising.' : 'This round is included.' };
            if (p.action === 'client-answer') {
                check(b.decision === 'approved' || b.decision === 'changes', 'INVALID_VENTURE_REQUEST', 'Record the client answer.');
                check(b.comment === undefined || typeof b.comment === 'string' && b.comment.length <= 1000, 'INVALID_VENTURE_REQUEST', 'Keep the client comment short.');
                await ventureAction(deps, ctx, 'approve', 'social.post.client-answer', tx => { const latest = row(tx.state, venture.id, runId, postId); check(latest.digest === p.digest, 'APPROVAL_STALE', 'Read the changed post again.'); const { run, order } = context(tx.state, venture.id, runId, postId); check(['accepted', 'edited'].includes(run.status), 'OWNER_APPROVAL_FIRST', 'Approve the draft before recording the client answer.'); const own = order.socialGhostwriting ?? emptyGhostwriting(); tx.replace({ ...order, socialGhostwriting: { ...own, decisions: { ...own.decisions, [key(postId)]: { digest: digest({ postId, channel: draftPostsOf(run).find(p=>p.draftId===postId)!.channel, text: latest.text }), decision: b.decision as 'approved' | 'changes', comment: typeof b.comment === 'string' ? b.comment : null, at: tx.now, by: ctx.memberId } } } }); tx.emit('desk.changed', { playbook: 'social-agency', kind: 'revision', id: postId }); });
                return { playbook: 'social-agency', kind: 'revision', id: postId, result: { postId }, line: 'Client answer recorded for this exact post.' };
            }
            check(p.action === 'revise', 'INVALID_VENTURE_REQUEST', 'Choose a revision action.');
            if (ghostwritingOffer(state, context(state, venture.id, runId, postId).run) && shown.roundsUsed >= 2)
                check(shown.quote && b.quoteDigest === shown.quote.digest, 'OFFER_EXTRA_ROUND', shown.quote ? 'This extra round costs ' + shown.quote.display + '. Approve its exact quote first.' : 'Set your extra-round price before a third revision.');
            const { run, order, post } = context(state, venture.id, runId, postId);
            const prior = structuredClone(order.socialGhostwriting ?? emptyGhostwriting());
            await startRevision(deps, ctx, { runId, words: revisionWords('Refine only post ' + post.n + ': ' + words), by: 'send-back', rowId: null, socialPost: { postId, n: post.n, posts: draftPostsOf(run).map(p => ({ channel: p.channel, text: p.text })), prior } }, (tx, stored) => {
                const current = tx.find('venture-order', order.id)!;
                check(digest(current.socialGhostwriting ?? emptyGhostwriting()) === digest(prior) && current.intake?.fields?.extraRoundPrice === order.intake?.fields?.extraRoundPrice, 'APPROVAL_STALE', 'The revision count or price changed.');
                const decisions = { ...prior.decisions };
                for (const entry of draftApprovalsOfRun(state, runId))
                    if (entry.approval.client.decision === 'approved' && entry.approval.digest === draftDigest(entry.draft))
                        decisions[key(entry.post.draftId)] = { digest: digest({ postId: entry.post.draftId, channel: entry.post.channel, text: entry.post.text }), decision: 'approved', comment: entry.approval.client.comment, at: entry.approval.client.at ?? tx.now, by: entry.approval.client.via === 'share-link' ? 'client' : 'owner', via: entry.approval.client.via ?? 'owner-recorded' };
                decisions[key(postId)] = { digest: '', decision: null, comment: null, at: tx.now, by: ctx.memberId };
                const next = { ...prior, rounds: { ...prior.rounds, [key(postId)]: shown.roundsUsed + 1 }, decisions, charges: shown.quote ? [...prior.charges, { postId, round: shown.quote.round, amountMinor: shown.quote.amountMinor, currency: shown.quote.currency, quoteDigest: shown.quote.digest, receiptId: shown.quote.receiptId, by: ctx.memberId, at: tx.now }] : prior.charges };
                tx.replace({ ...current, socialGhostwriting: next });
                tx.replace({ ...stored, socialGhostwriting: next });
            });
            return { playbook: 'social-agency', kind: 'revision', id: postId, result: { runId }, line: 'This post revision waits for your approval before the model runs.' };
        }
    } };
