// Chausar venture launcher: read-only preview links for a client. venture.share.create, venture.share.list and
// venture.share.revoke, plus the two trusted entry points the hosted web server's /share/<token> page uses
// (sharePage and shareDecide), which no RPC reaches.
// - Only a delivery draft the owner could accept now (ready, not practice, every check passed), or one the owner
//   accepted or edited, can be shared. Making the link is the owner's approval to show it; it happens inside the app.
//   A CA firm's regulated papers are shared only as the CA of record signed them off (playbooks/ca-firm/signoff-gate.ts).
// - The record keeps a sha256 of a random token, never the token, and a copy of the exact text the link shows with its
//   digest. The token is in create's address once; nothing returns it again.
// - The address is real only on the hosted web server with a public address (CHAUSAR_PUBLIC_URL). Anywhere else the
//   link is kept but not served, and says so: the owner sends the draft and records the answer.
// - The client's answer goes through the social playbook's approvals (playbooks/social/approvals.ts): once per draft,
//   on the digest shown, before the link ends.
// - On this computer the owner records the client's answer (venture.share.recordAnswer, Ink v2 wave 2): inside the app,
//   once per draft, on the text the link was made with, marked 'owner-recorded'. The list shows each link's answer and,
//   for one draft, the posts it holds with the ids posting takes (playbooks/social/run-approvals.ts) and the answer the
//   engine counts for it, which the screens read so they never offer what the engine would refuse.
import { createHash } from 'node:crypto';
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import {
  currentVenture, exactPayload, formatVentureDate, identifier, listRecords, readVenture, requireAppChannel, ventureAction,
} from '../records.ts';
import type { DeliveryRunRecord, Display, DraftPostView, ShareAnswerView, ShareLinkStoredRecord, ShareLinkView, VentureDeps, VentureRecord } from '../contracts.ts';
import { runView } from '../delivery/runs.ts';
import { caSignoffBlock } from '../playbooks/ca-firm/signoff-gate.ts';
import { createShareLink, recordClientDecision, type DraftApproval, type ShareLinkRecord } from '../playbooks/social/approvals.ts';
import { draftApprovalsOfRun, draftPostViews, needsClientApproval, scheduleReasons } from '../playbooks/social/run-approvals.ts';
import { clientDraft } from './draft-text.ts';

export const SHARE_DEFAULT_HOURS = 168;
export const SHARE_WORDS = Object.freeze({
  notServed: 'Share links open only on the hosted Chausar with a public address. Send your client the draft yourself and record their answer.',
  shownOnce: 'The link was shown once, when it was made.',
  revoked: 'You took this link back. It no longer opens.',
  ended: 'This link has ended.',
  approved: 'Your client approved it.',
  changes: 'Your client asked for changes.',
  notReady: 'Only a draft that is ready, or that you accepted, can go to your client.',
});
const SHARABLE = new Set(['ready-for-review', 'accepted', 'edited']);
const NO_CLIENT = 'no-client';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
/** The address part of a share link: 24 random bytes, base64url. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{32}$/;
export const shareTokenHash = (token: string) => sha256(token);

/** The stored record in the approvals module's shape, so its decide-once, digest and end-date rules apply. */
function asApprovalLink(record: ShareLinkStoredRecord): ShareLinkRecord {
  return {
    id: record.id, tokenHash: record.tokenHash, clientId: record.clientId ?? NO_CLIENT, drafts: [{ draftId: record.deliveryId, digest: record.draftDigest }],
    createdBy: record.memberId, createdAt: record.at, expiresAt: record.expiresAt, state: record.state === 'revoked' ? 'closed' : record.state,
    decisions: record.decisions.map(item => ({ ...item })),
  };
}

function decisionWords(record: ShareLinkStoredRecord): Display | null {
  const made = record.decisions.at(-1);
  if (!made) return null;
  return made.decision === 'approved' ? SHARE_WORDS.approved : made.comment ? `${SHARE_WORDS.changes} ${made.comment}` : SHARE_WORDS.changes;
}

/** The client's newest answer on a link, as the screens read it; null before one. */
function answerOf(record: ShareLinkStoredRecord): ShareAnswerView | null {
  const made = record.decisions.at(-1);
  return made ? { draftId: made.draftId, decision: made.decision, comment: made.comment, at: made.at, via: made.via } : null;
}

/**
 * A link as the screens show it. url is never rebuilt: the token is not kept. answer: the client's answer, given
 * through the link or recorded by the owner; absent before one and on a link the owner took back, which says revoked.
 */
export function shareView(record: ShareLinkStoredRecord, nowIso: string, url: string | null = null): ShareLinkView {
  const decided = decisionWords(record);
  const revoked = record.state === 'revoked';
  const reason = url ? undefined
    : revoked ? SHARE_WORDS.revoked
      : !record.served ? SHARE_WORDS.notServed
        : decided ?? (Date.parse(record.expiresAt) <= Date.parse(nowIso) ? SHARE_WORDS.ended : SHARE_WORDS.shownOnce);
  const answer = revoked ? null : answerOf(record);
  return { id: record.id, url, ...(reason ? { reason } : {}), expiresAt: record.expiresAt, ...(answer ? { answer } : {}), ...(revoked ? { revoked: true as const } : {}) };
}

/** The public origin share links use: only on the hosted web server, and only when the host set one. */
function publicOrigin(deps: VentureDeps): string | null {
  return deps.host === 'hosted-web' && typeof deps.publicUrl === 'string' && deps.publicUrl ? deps.publicUrl.replace(/\/+$/, '') : null;
}

/** venture.share.create { deliveryId, expiresInHours? } (approve, inside the app): one read-only preview link. */
export async function shareCreate(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ShareLinkView> {
  requireAppChannel(ctx, 'venture.share.create');
  const body = exactPayload(payload, ['deliveryId', 'expiresInHours'], ['deliveryId']);
  const deliveryId = identifier(body.deliveryId, 'Draft');
  const hours = body.expiresInHours === undefined ? SHARE_DEFAULT_HOURS : body.expiresInHours;
  check(typeof hours === 'number' && Number.isInteger(hours) && hours >= 1 && hours <= 720, 'INVALID_VENTURE_REQUEST', 'A share link lasts between one hour and thirty days.');
  const origin = publicOrigin(deps);
  return ventureAction(deps, ctx, 'approve', 'share.create', tx => {
    const venture = tx.venture!;
    const record = tx.find('venture-delivery-run', deliveryId);
    check(record, 'DELIVERY_NOT_FOUND', 'That draft was not found.');
    const run = runView(record, venture, Date.parse(tx.now));
    check(SHARABLE.has(run.status), 'DELIVERY_NOT_READY', SHARE_WORDS.notReady);
    check(!run.practiceNow, 'PRACTICE_DRAFT', 'A practice draft never goes to a client.');
    check(run.status !== 'ready-for-review' || run.canAccept, 'DELIVERY_NOT_READY', run.acceptBlocked ?? SHARE_WORDS.notReady);
    // AI-native CA firm: regulated papers reach a client only as the CA of record signed them; an edit needs its own sign-off.
    const unsigned = caSignoffBlock(tx.state, venture, record);
    if (unsigned) throw new ChausarError('CA_SIGNOFF_REQUIRED', unsigned);
    // The secret screen (W1 H17): the client sees, and the digest covers, the text with any key or token taken out.
    // build/draft-text.ts makes both, so a post from this draft (build/posting.ts) means the same words and digest.
    const { title, text, digest: draftDigest } = clientDraft(run);
    check(typeof text === 'string' && text.trim().length > 0, 'DELIVERY_NOT_READY', SHARE_WORDS.notReady);
    const clientId = tx.find('venture-order', run.orderId)?.clientId ?? null;
    // Making the link is the owner's approval to show this exact text: the approvals module checks it like any other.
    const approval: DraftApproval = {
      draftId: deliveryId, digest: draftDigest, checks: 'passed',
      owner: { decision: 'approved', by: ctx.memberId, at: tx.now }, client: { decision: null, via: null, at: null, comment: null },
    };
    const made = createShareLink({ drafts: [approval], clientId: clientId ?? NO_CLIENT, by: ctx.memberId, now: tx.now, ttlHours: hours });
    const stored = tx.put<ShareLinkStoredRecord>({
      ...tx.base('venture-share-link'), deliveryId, clientId, tokenHash: made.record.tokenHash, title, text, draftDigest,
      expiresAt: made.record.expiresAt, state: 'open', revokedAt: null, served: origin !== null, decisions: [],
    });
    return shareView(stored, tx.now, origin ? `${origin}/share/${made.token}` : null);
  });
}

/**
 * venture.share.list { deliveryId? } (read): every link of this business, newest first. No address comes back. With a
 * deliveryId of a draft that exists, posts lists the posts it holds now, each with the id venture.posting.propose takes,
 * clientApproval says whether they go out only after the client approved the draft (the social agency's rule), and
 * answer is the client's answer the engine counts for the draft as it is now (countedAnswer), or null.
 */
export async function shareList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{
  links: ShareLinkView[]; shares: ShareLinkView[]; posts?: DraftPostView[]; clientApproval?: boolean; answer?: ShareAnswerView | null;
}> {
  const body = exactPayload(payload ?? {}, ['deliveryId']);
  const deliveryId = body.deliveryId === undefined ? undefined : identifier(body.deliveryId, 'Draft');
  const { state, venture } = readVenture(deps, ctx);
  const now = deps.clock().toISOString();
  const links = listRecords(state, 'venture-share-link', venture.id)
    .filter(record => deliveryId === undefined || record.deliveryId === deliveryId)
    .reverse().map(record => shareView(record, now));
  const run = deliveryId === undefined ? undefined : listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === deliveryId);
  return { links, shares: links, ...(run ? { posts: draftPostViews(run), clientApproval: needsClientApproval(state, run), answer: countedAnswer(state, run) } : {}) };
}

/**
 * The client's answer the engine counts for a draft as it is now. With posts, it is the one posting reads
 * (draftApprovalsOfRun), unless the draft changed since that answer (the gate's POST_DRAFT_CHANGED). With none, the
 * newest answer on any of the draft's links, a link the owner took back included, when it is on the words as they are
 * now. Either way the same answer that makes venture.share.recordAnswer refuse with ALREADY_DECIDED.
 */
function countedAnswer(state: State, run: DeliveryRunRecord): ShareAnswerView | null {
  const [first] = draftApprovalsOfRun(state, run.id);
  if (first) {
    const { client } = first.approval;
    if (!client.decision || !client.at || !client.via) return null;
    if (scheduleReasons(first, { clientApproval: true }).some(reason => reason.code === 'POST_DRAFT_CHANGED')) return null;
    return { draftId: run.id, decision: client.decision, comment: client.comment, at: client.at, via: client.via };
  }
  const current = clientDraft(run).digest;
  const made = listRecords(state, 'venture-share-link', run.ventureId).filter(link => link.deliveryId === run.id).flatMap(link => link.decisions)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).at(-1);
  return made && made.digest === current ? { draftId: run.id, decision: made.decision, comment: made.comment, at: made.at, via: made.via } : null;
}

export const NO_SHARE_LINE = 'Share the draft first, so Chausar knows which text your client saw.';

/**
 * venture.share.recordAnswer { draftId, answer, comment? } (approve, inside the app): the owner records what the
 * client answered on a draft they were sent, through the approvals module, marked 'owner-recorded'. On the newest link
 * the owner has not taken back, and only while no page serves it (SHARE_LINK_REFUSED while it is served and open:
 * the client answers there); once per draft and text over every link, revoked ones too (ALREADY_DECIDED); a draft
 * changed since the link was made is APPROVAL_STALE; a draft with no such link is SHARE_NOT_FOUND.
 */
export async function shareRecordAnswer(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ answer: ShareAnswerView }> {
  requireAppChannel(ctx, 'venture.share.recordAnswer');
  const body = exactPayload(payload, ['draftId', 'answer', 'comment'], ['draftId', 'answer']);
  const draftId = identifier(body.draftId, 'Draft');
  check(body.answer === 'approved' || body.answer === 'changes', 'INVALID_VENTURE_REQUEST', "Choose approved or asked for changes.");
  check(body.comment === undefined || typeof body.comment === 'string', 'INVALID_VENTURE_REQUEST', 'A comment is text.');
  const decision = body.answer;
  return ventureAction(deps, ctx, 'approve', 'share.recordAnswer', tx => {
    const run = tx.find('venture-delivery-run', draftId);
    check(run, 'DELIVERY_NOT_FOUND', 'That draft was not found.');
    const all = tx.list('venture-share-link').filter(link => link.deliveryId === draftId);
    const link = all.filter(item => item.state !== 'revoked').at(-1);
    check(link, 'SHARE_NOT_FOUND', NO_SHARE_LINE);
    const current = clientDraft(run).digest;
    // Once per draft and text, whichever link it was given on, a link the owner later took back included.
    check(!all.some(item => item.decisions.some(made => made.digest === current)), 'ALREADY_DECIDED', 'Your client already answered on this draft.');
    // A link the client can open now is where the client answers; the owner records only for a link kept, not served.
    check(!(link.served && Date.parse(link.expiresAt) > Date.parse(tx.now)), 'SHARE_LINK_REFUSED', 'Your client answers on the link itself while it is open. Record an answer only once it has ended.');
    const decided = recordClientDecision(asApprovalLink(link), { via: 'owner-recorded', by: ctx.memberId }, {
      draftId, digest: current, decision, comment: body.comment === '' ? null : body.comment as string | undefined, now: tx.now,
    });
    const next = tx.replace<ShareLinkStoredRecord>({ ...link, decisions: decided.decisions.map(item => ({ ...item })), state: decided.state === 'closed' ? 'closed' : 'open' });
    return { answer: answerOf(next)! };
  });
}

/** venture.share.revoke { id } (approve, inside the app): the link stops opening at once. Revoking twice changes nothing. */
export async function shareRevoke(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ShareLinkView> {
  requireAppChannel(ctx, 'venture.share.revoke');
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'Link');
  return ventureAction(deps, ctx, 'approve', 'share.revoke', tx => {
    const record = tx.find('venture-share-link', id);
    check(record, 'SHARE_NOT_FOUND', 'That share link was not found.');
    if (record.state === 'revoked') return shareView(record, tx.now);
    return shareView(tx.replace<ShareLinkStoredRecord>({ ...record, state: 'revoked', revokedAt: tx.now }), tx.now);
  });
}

// ---------------------------------------------------------------------------
// The hosted page (trusted host only: VentureHost.shareLink, never an RPC method)
// ---------------------------------------------------------------------------

/** What the client's page shows. Everything is text; the page escapes it. */
export type SharePage = {
  businessName: string; title: string; text: string; expires: Display; digest: string;
  decision: { decision: 'approved' | 'changes'; comment: string | null } | null;
};

/** The open, served, unexpired link a token belongs to, or null. A wrong, ended or revoked token gets null alike. */
function linkOf(state: State, venture: VentureRecord, token: unknown, nowIso: string): ShareLinkStoredRecord | null {
  if (typeof token !== 'string' || !SHARE_TOKEN.test(token)) return null;
  const hash = sha256(token);
  const record = listRecords(state, 'venture-share-link', venture.id).find(item => item.tokenHash === hash);
  if (!record || !record.served || record.state === 'revoked' || Date.parse(record.expiresAt) <= Date.parse(nowIso)) return null;
  return record;
}

function pageOf(record: ShareLinkStoredRecord, venture: VentureRecord): SharePage {
  const made = record.decisions.at(-1);
  return {
    businessName: venture.workingName, title: record.title, text: record.text, digest: record.draftDigest,
    expires: formatVentureDate(record.expiresAt.slice(0, 10), venture.country.dateOrder),
    decision: made ? { decision: made.decision, comment: made.comment } : null,
  };
}

/** The page for a token, or null when it does not open. Reads only. */
export async function sharePage(deps: VentureDeps, _ctx: Context, token: unknown): Promise<SharePage | null> {
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture) return null;
  const record = linkOf(state, venture, token, deps.clock().toISOString());
  return record ? pageOf(record, venture) : null;
}

/**
 * The client's answer through the link: approve or ask for changes, with an optional comment, on the digest the page
 * showed. Decide-once (ALREADY_DECIDED); a changed digest is APPROVAL_STALE; a link that ended or was taken back
 * answers null. Recorded through the approvals module.
 */
export async function shareDecide(deps: VentureDeps, ctx: Context, token: unknown, input: { decision: unknown; comment?: unknown; digest: unknown }): Promise<SharePage | null> {
  check(input.decision === 'approved' || input.decision === 'changes', 'INVALID_VENTURE_REQUEST', 'Choose approve or ask for changes.');
  check(typeof input.digest === 'string' && /^[a-f0-9]{64}$/.test(input.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the draft you read.');
  return ventureAction(deps, ctx, 'prepare', 'share.decide', tx => {
    const record = linkOf(tx.state, tx.venture!, token, tx.now);
    if (!record) return null;
    const decided = recordClientDecision(asApprovalLink(record), { via: 'share-link', token: token as string }, {
      draftId: record.deliveryId, digest: input.digest as string, decision: input.decision as 'approved' | 'changes',
      comment: input.comment === undefined || input.comment === '' ? null : input.comment as string | null, now: tx.now,
    });
    const next = tx.replace<ShareLinkStoredRecord>({
      ...record, decisions: decided.decisions.map(item => ({ ...item })), state: decided.state === 'closed' ? 'closed' : 'open',
    });
    return pageOf(next, tx.venture!);
  });
}
