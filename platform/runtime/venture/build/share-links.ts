// Chausar venture launcher: read-only preview links for a client. venture.share.create, venture.share.list and
// venture.share.revoke, plus the two trusted entry points the hosted web server's /share/<token> page uses
// (sharePage and shareDecide), which no RPC reaches.
// - Only a delivery draft the owner could accept now (ready, not practice, every check passed), or one the owner
//   accepted or edited, can be shared. Making the link is the owner's approval to show it; it happens inside the app.
// - The record keeps a sha256 of a random token, never the token, and a copy of the exact text the link shows with its
//   digest. The token is in create's address once; nothing returns it again.
// - The address is real only on the hosted web server with a public address (CHAUSAR_PUBLIC_URL). Anywhere else the
//   link is kept but not served, and says so: the owner sends the draft and records the answer.
// - The client's answer goes through the social playbook's approvals (playbooks/social/approvals.ts): once per draft,
//   on the digest shown, before the link ends.
import { createHash } from 'node:crypto';
import { check, type Context, type State } from '../../contracts.ts';
import {
  currentVenture, digest, exactPayload, formatVentureDate, identifier, listRecords, readVenture, requireAppChannel, ventureAction,
} from '../records.ts';
import type { Display, ShareLinkStoredRecord, ShareLinkView, VentureDeps, VentureRecord } from '../contracts.ts';
import { runView } from '../delivery/runs.ts';
import { createShareLink, recordClientDecision, type DraftApproval, type ShareLinkRecord } from '../playbooks/social/approvals.ts';

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

/** A link as the screens show it. url is never rebuilt: the token is not kept. */
export function shareView(record: ShareLinkStoredRecord, nowIso: string, url: string | null = null): ShareLinkView {
  const decided = decisionWords(record);
  const reason = url ? undefined
    : record.state === 'revoked' ? SHARE_WORDS.revoked
      : !record.served ? SHARE_WORDS.notServed
        : decided ?? (Date.parse(record.expiresAt) <= Date.parse(nowIso) ? SHARE_WORDS.ended : SHARE_WORDS.shownOnce);
  return { id: record.id, url, ...(reason ? { reason } : {}), expiresAt: record.expiresAt };
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
    const text = run.status === 'edited' && run.editedText ? run.editedText : run.renderedText;
    check(typeof text === 'string' && text.trim().length > 0, 'DELIVERY_NOT_READY', SHARE_WORDS.notReady);
    const title = run.deliverable?.title ?? 'Draft';
    const draftDigest = digest({ deliveryId, title, text });
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

/** venture.share.list { deliveryId? } (read): every link of this business, newest first. No address comes back. */
export async function shareList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ links: ShareLinkView[]; shares: ShareLinkView[] }> {
  const body = exactPayload(payload ?? {}, ['deliveryId']);
  const deliveryId = body.deliveryId === undefined ? undefined : identifier(body.deliveryId, 'Draft');
  const { state, venture } = readVenture(deps, ctx);
  const now = deps.clock().toISOString();
  const links = listRecords(state, 'venture-share-link', venture.id)
    .filter(record => deliveryId === undefined || record.deliveryId === deliveryId)
    .reverse().map(record => shareView(record, now));
  return { links, shares: links };
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
