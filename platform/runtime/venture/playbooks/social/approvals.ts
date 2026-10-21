// Chausar flagship playbook, social media agency: approvals, the client share link record and draft-before-schedule.
// - The owner approves a draft first. Only drafts that passed the checks and that the owner approved go on a share link.
// - The client decides each draft once, on the exact text (its digest), before the link ends. The record keeps a hash
//   of the link's token, never the token, and the token never enters a model's context.
// - No page serves the link in this build (SHARE_LINK_SERVING is planned): until one does, the owner sends the drafts
//   and records the client's answer, marked 'owner-recorded'.
// - A draft is scheduled, posted or exported only when it passed the checks, the owner approved it, the client approved
//   it when the offer asks for it, and its text is still the text that was approved. Each refusal says why.
//
// Idea taken, code written here: postmill-ai/postmill-app (AGPL-3.0, so ideas only), whose promote step refuses any
// draft that is not approved and returns a reason per post.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { check, newId } from '../../../contracts.ts';
import type { IsoDate, IsoTime } from '../../contracts.ts';
import { digest } from '../../records.ts';
import type { SocialChannel } from './channels.ts';
import type { SocialMedia } from './checks.ts';

export type DraftLike = { id: string; channel: SocialChannel; text: string; media?: SocialMedia[]; thread?: string[] };
export type DraftApproval = {
  draftId: string;
  /** The digest of the draft the decisions are for. */
  digest: string;
  checks: 'passed' | 'failed' | 'not-run';
  owner: { decision: 'approved' | 'changes' | null; by: string | null; at: IsoTime | null };
  client: { decision: 'approved' | 'changes' | null; via: 'share-link' | 'owner-recorded' | null; at: IsoTime | null; comment: string | null };
};
export type ClientDecision = {
  draftId: string; decision: 'approved' | 'changes'; comment: string | null; at: IsoTime; digest: string;
  via: 'share-link' | 'owner-recorded'; recordedBy: string | null;
};
export type ShareLinkRecord = {
  id: string;
  /** sha256 of the token, hex. The token itself is shown to the owner once and never stored. */
  tokenHash: string;
  clientId: string;
  drafts: { draftId: string; digest: string }[];
  createdBy: string;
  createdAt: IsoTime;
  expiresAt: IsoTime;
  state: 'open' | 'closed';
  decisions: ClientDecision[];
};

export const SHARE_LINK_SERVING = Object.freeze({
  status: 'planned' as const,
  line: 'No page serves the share link yet. Until one does, send your client the drafts yourself and record their answer here.',
});
const DEFAULT_TTL_HOURS = 168;
const MAX_DRAFTS = 60;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const timeOf = (value: string, field: string) => {
  const time = Date.parse(value);
  check(typeof value === 'string' && Number.isFinite(time), 'INVALID_VENTURE_REQUEST', `The ${field} is not a time.`);
  return time;
};

/** What an approval is for: the draft's id, channel, text, thread parts and media. Any change gives a new digest. */
export function draftDigest(draft: DraftLike): string {
  return digest({
    id: draft.id, channel: draft.channel, text: draft.text, thread: draft.thread ? [...draft.thread] : null,
    media: (draft.media ?? []).map(item => ({
      kind: item.kind, width: item.width, height: item.height, seconds: item.seconds ?? null, altText: item.altText ?? null, fileId: item.fileId ?? null,
    })),
  });
}

/** A share link for drafts the owner approved. Returns the record to store and the token to show the owner once. */
export function createShareLink(input: { drafts: DraftApproval[]; clientId: string; by: string; now: IsoTime; ttlHours?: number }): { record: ShareLinkRecord; token: string } {
  check(Array.isArray(input.drafts) && input.drafts.length >= 1 && input.drafts.length <= MAX_DRAFTS, 'INVALID_VENTURE_REQUEST', `A share link holds between one and ${MAX_DRAFTS} drafts.`);
  check(new Set(input.drafts.map(item => item.draftId)).size === input.drafts.length, 'INVALID_VENTURE_REQUEST', 'A draft is on the link twice.');
  check(typeof input.clientId === 'string' && input.clientId.length > 0 && typeof input.by === 'string' && input.by.length > 0, 'INVALID_VENTURE_REQUEST', 'Say which client and who made the link.');
  const ttl = input.ttlHours ?? DEFAULT_TTL_HOURS;
  check(Number.isInteger(ttl) && ttl >= 1 && ttl <= 720, 'INVALID_VENTURE_REQUEST', 'A share link lasts between one hour and thirty days.');
  for (const item of input.drafts) {
    check(item.checks === 'passed', 'CHECKS_NOT_PASSED', `The draft ${item.draftId} has not passed the checks, so it cannot go to the client.`);
    check(item.owner.decision === 'approved', 'OWNER_APPROVAL_FIRST', `You approve the draft ${item.draftId} before your client sees it.`);
  }
  const token = randomBytes(24).toString('base64url');
  const created = timeOf(input.now, 'time');
  const record: ShareLinkRecord = {
    id: newId('sharelink'), tokenHash: sha256(token), clientId: input.clientId,
    drafts: input.drafts.map(item => ({ draftId: item.draftId, digest: item.digest })),
    createdBy: input.by, createdAt: new Date(created).toISOString(), expiresAt: new Date(created + ttl * 3600000).toISOString(),
    state: 'open', decisions: [],
  };
  return { record, token };
}

function tokenMatches(record: ShareLinkRecord, token: unknown): boolean {
  if (typeof token !== 'string' || token.length < 16 || token.length > 200) return false;
  const given = Buffer.from(sha256(token), 'hex');
  const kept = Buffer.from(record.tokenHash, 'hex');
  return given.length === kept.length && timingSafeEqual(given, kept);
}

function cleanComment(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  check(typeof value === 'string' && value.length <= 1000, 'INVALID_VENTURE_REQUEST', 'A comment is text of at most a thousand characters.');
  const text = value.replace(/[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, '').trim();
  return text.length ? text : null;
}

/**
 * The client's decision on one draft: through the share link with its token, or recorded by the owner when the
 * client answered another way. Decide-once per draft; a decision on a changed draft is refused as stale; the link's
 * end date binds the share link, not the owner's record. Returns the new record; the old one is unchanged.
 */
export function recordClientDecision(
  link: ShareLinkRecord,
  who: { via: 'share-link'; token: string } | { via: 'owner-recorded'; by: string },
  input: { draftId: string; digest: string; decision: 'approved' | 'changes'; comment?: string | null; now: IsoTime },
): ShareLinkRecord {
  if (who.via === 'share-link') check(tokenMatches(link, who.token), 'SHARE_LINK_REFUSED', 'This link is not valid.');
  else check(typeof who.by === 'string' && who.by.length > 0, 'INVALID_VENTURE_REQUEST', 'Say who recorded the answer.');
  const entry = link.drafts.find(item => item.draftId === input.draftId);
  check(entry, 'SHARE_LINK_REFUSED', 'This draft is not on the link.');
  check(!link.decisions.some(item => item.draftId === input.draftId), 'ALREADY_DECIDED', 'Your client already answered on this draft.');
  check(input.decision === 'approved' || input.decision === 'changes', 'INVALID_VENTURE_REQUEST', 'Choose approve or ask for changes.');
  const at = timeOf(input.now, 'time');
  if (who.via === 'share-link') check(at <= Date.parse(link.expiresAt), 'SHARE_LINK_EXPIRED', 'This link has ended. Ask for a new one.');
  check(input.digest === entry.digest, 'APPROVAL_STALE', 'This draft changed since the link was made.');
  const decision: ClientDecision = {
    draftId: input.draftId, decision: input.decision, comment: cleanComment(input.comment), at: new Date(at).toISOString(), digest: entry.digest,
    via: who.via, recordedBy: who.via === 'owner-recorded' ? who.by : null,
  };
  const decisions = [...link.decisions, decision];
  return { ...link, decisions, state: link.drafts.every(item => decisions.some(made => made.draftId === item.draftId)) ? 'closed' : 'open' };
}

/** The approvals with the client's answers from a link folded in, for drafts whose digest still matches. */
export function withClientDecisions(approvals: DraftApproval[], link: ShareLinkRecord): DraftApproval[] {
  return approvals.map(item => {
    const made = link.decisions.find(decision => decision.draftId === item.draftId && decision.digest === item.digest);
    return made ? { ...item, client: { decision: made.decision, via: made.via, at: made.at, comment: made.comment } } : item;
  });
}

export type GateOptions = { clientApproval: boolean };

/** Draft before schedule: may this draft be scheduled, posted or exported now? Every reason it may not, in order. */
export function scheduleGate(approval: DraftApproval, draft: DraftLike, options: GateOptions): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (approval.draftId !== draft.id) reasons.push('The approval is for another draft.');
  else if (approval.digest !== draftDigest(draft)) reasons.push('The draft changed after it was approved. It needs a new approval.');
  if (approval.checks !== 'passed') reasons.push(approval.checks === 'failed' ? 'The draft failed the checks.' : 'The checks have not run on this draft.');
  if (approval.owner.decision !== 'approved') reasons.push('You have not approved this draft.');
  if (options.clientApproval && approval.client.decision !== 'approved') {
    reasons.push(approval.client.decision === 'changes' ? 'Your client asked for changes.' : 'Your client has not approved this draft.');
  }
  return { allowed: reasons.length === 0, reasons };
}

/** Schedules what may go and blocks the rest, with a reason per draft. */
export function promoteDrafts(items: { approval: DraftApproval; draft: DraftLike }[], options: GateOptions): {
  scheduled: string[]; blocked: { draftId: string; reasons: string[] }[];
} {
  const scheduled: string[] = [];
  const blocked: { draftId: string; reasons: string[] }[] = [];
  for (const item of items) {
    const gate = scheduleGate(item.approval, item.draft, options);
    if (gate.allowed) scheduled.push(item.draft.id);
    else blocked.push({ draftId: item.draft.id, reasons: gate.reasons });
  }
  return { scheduled, blocked };
}

/** A CSV cell: quoted when it holds a comma, quote or new line; a leading formula character is defused. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The calendar file: one row per draft that passes the draft-before-schedule gate, in date order. The owner imports it
 * into their own scheduler or copies from it; nothing here posts.
 */
export function calendarExport(items: { approval: DraftApproval; draft: DraftLike; date: IsoDate }[], options: GateOptions): string {
  const header = 'date,channel,text,alt_text,owner_approved_at,client_approved_at';
  const rows = items
    .filter(item => {
      check(/^\d{4}-\d{2}-\d{2}$/.test(item.date), 'INVALID_VENTURE_REQUEST', 'Give each date like 2026-11-02.');
      return scheduleGate(item.approval, item.draft, options).allowed;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map(item => [
      item.date, item.draft.channel, item.draft.thread?.length ? item.draft.thread.join('\n\n') : item.draft.text,
      (item.draft.media ?? []).map(media => media.altText ?? '').filter(Boolean).join(' | '),
      item.approval.owner.at ?? '', item.approval.client.at ?? '',
    ].map(value => cell(String(value))).join(','));
  return `${[header, ...rows].join('\n')}\n`;
}
