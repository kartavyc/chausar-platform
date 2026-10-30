// Chausar playbook kit (Ink v2 wave 5, package 5A5, P11): a client report's share link, on wave 4's share link rules
// (build/share-links.ts). venture.report.share makes one for a date range and channels; .shareRotate gives it a new
// token and ends the old; .shareDisable stops it. Each is the owner's approval inside the app.
// - The vault keeps a sha256 of a random token, never the token; the address carries it once, in the answer that made
//   or rotated it. The address is real only on the hosted Chausar with a public address (CHAUSAR_PUBLIC_URL); anywhere
//   else the link is kept, not served, and says so. The hosted /share/<token> page reads it through reportSharePage, a
//   trusted entry no RPC reaches.
// - Only an accepted draft (or one the owner could accept now) is shared, as it was when the report was made: a draft
//   changed since is REPORT_STALE, and a CA firm's papers need the CA's sign-off, as a draft link does.
// - The page shows only the blocks inside the link's days and channels. Opening it counts a view, on the server, never
//   with a pixel; the owner's own look and a HEAD request do not count. A chat app's link preview that fetches the page
//   with GET does count: the page cannot tell it from a person without guessing from its user agent, so it does not.
// - The page is served only while the report could be shared now: a draft changed since, or a sign-off withdrawn,
//   stops it.
// The idea of a report link scoped to dates and channels, with rotate and disable, comes from postmill's analytics
// share modal (AGPL, learn-only: no code read or copied), catalogue row P11. Written for Chausar.
import { createHash, randomBytes } from 'node:crypto';
import { ChausarError, check, type Context, type State } from '../../../../contracts.ts';
import type { Display, IsoDate, ReportRecord, ReportShareRecord, VentureDeps, VentureRecord } from '../../../contracts.ts';
import {
  currentVenture, exactPayload, formatVentureDate, identifier, isoDate, listRecords, requireAppChannel, ventureAction,
} from '../../../records.ts';
import { runView } from '../../../delivery/runs.ts';
import { clientDraft } from '../../../build/draft-text.ts';
import { caSignoffBlock } from '../../ca-firm/signoff-gate.ts';
import { blocksInScope } from './blocks.ts';
import type { ReportBlock, ReportShareView } from '../records-report.ts';

/** How long a report link lasts: thirty days from when it was made or last rotated. */
export const REPORT_SHARE_HOURS = 720;
export const REPORT_SHARE_WORDS = Object.freeze({
  notServed: 'Report links open only on the hosted Chausar with a public address. Send your client the report file yourself.',
  shownOnce: 'The link was shown once, when it was made.',
  disabled: 'You turned this link off. It no longer opens.',
  ended: 'This link has ended. Rotate it to share the report again.',
  stale: 'The draft changed after this report was made. Make the report again, then share it.',
  notReady: 'Only a draft you accepted, or one ready for you to accept, can go to your client.',
  shared: 'shared a report with you. Read only.',
});
const SHARABLE = new Set(['ready-for-review', 'accepted', 'edited']);
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function publicOrigin(deps: VentureDeps): string | null {
  return deps.host === 'hosted-web' && typeof deps.publicUrl === 'string' && deps.publicUrl ? deps.publicUrl.replace(/\/+$/, '') : null;
}

function stateOf(record: ReportShareRecord, nowIso: string): ReportShareView['state'] {
  return record.state === 'disabled' ? 'disabled' : Date.parse(record.expiresAt) <= Date.parse(nowIso) ? 'ended' : 'open';
}

/** A link as the screens show it. url only in the answer that made or rotated it; never rebuilt, the token is not kept. */
export function reportShareView(record: ReportShareRecord, nowIso: string, url: string | null = null): ReportShareView {
  const state = stateOf(record, nowIso);
  const reason = url ? undefined
    : state === 'disabled' ? REPORT_SHARE_WORDS.disabled
      : !record.served ? REPORT_SHARE_WORDS.notServed
        : state === 'ended' ? REPORT_SHARE_WORDS.ended : REPORT_SHARE_WORDS.shownOnce;
  return {
    id: record.id, reportId: record.reportId, url, ...(reason ? { reason } : {}), from: record.from, to: record.to, channels: [...record.channels],
    state, expiresAt: record.expiresAt, views: record.views, viewedAt: record.viewedAt,
  };
}

/** A new token and the time it ends. */
function newToken(nowIso: string): { token: string; tokenHash: string; expiresAt: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, tokenHash: sha256(token), expiresAt: new Date(Date.parse(nowIso) + REPORT_SHARE_HOURS * 3_600_000).toISOString() };
}

/** Refuses a report whose draft is not one the owner may share now, or changed after the report was made. */
function checkSharable(state: State, venture: VentureRecord, report: ReportRecord, nowIso: string) {
  const run = listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === report.runId);
  check(run, 'DELIVERY_NOT_FOUND', 'That draft was not found.');
  check(!listRecords(state, 'venture-order', venture.id).find(order => order.id === run.orderId)?.internal, 'INTERNAL_ORDER', 'Your own shop work has no client share link.');
  const view = runView(run, venture, Date.parse(nowIso), state);
  check(SHARABLE.has(view.status), 'DELIVERY_NOT_READY', REPORT_SHARE_WORDS.notReady);
  check(!view.practiceNow && !run.practice, 'PRACTICE_DRAFT', 'A practice draft never goes to a client.');
  check(view.status !== 'ready-for-review' || view.canAccept, 'DELIVERY_NOT_READY', view.acceptBlocked ?? REPORT_SHARE_WORDS.notReady);
  check(clientDraft(run).digest === report.draftDigest, 'REPORT_STALE', REPORT_SHARE_WORDS.stale);
  const unsigned = caSignoffBlock(state, venture, run);
  if (unsigned) throw new ChausarError('CA_SIGNOFF_REQUIRED', unsigned);
}

/**
 * venture.report.share { reportId, from, to, channels? } (approve, inside the app): one link to a report for the days
 * from to to and the channels named (all of the report's when none are). A channel the report does not cover refuses,
 * so a typo never makes an empty page.
 */
export async function reportShare(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ReportShareView> {
  requireAppChannel(ctx, 'venture.report.share');
  const body = exactPayload(payload, ['reportId', 'from', 'to', 'channels'], ['reportId', 'from', 'to']);
  const reportId = identifier(body.reportId, 'Report');
  const from = isoDate(body.from, 'From') as IsoDate, to = isoDate(body.to, 'To') as IsoDate;
  check(from <= to, 'INVALID_VENTURE_REQUEST', 'The link ends on or after the day it starts.');
  check(body.channels === undefined || (Array.isArray(body.channels) && body.channels.length <= 20 && body.channels.every(item => typeof item === 'string' && item.length >= 1 && item.length <= 40)),
    'INVALID_VENTURE_REQUEST', 'Choose up to 20 channels by name.');
  const origin = publicOrigin(deps);
  return ventureAction(deps, ctx, 'approve', 'report.share', tx => {
    const report = tx.find('venture-report', reportId);
    check(report, 'REPORT_NOT_FOUND', 'That report was not found. Make it again.');
    const channels = body.channels === undefined ? [...report.channels] : [...new Set(body.channels as string[])].sort();
    const unknown = channels.filter(channel => !report.channels.includes(channel));
    check(!unknown.length, 'INVALID_VENTURE_REQUEST', `This report has nothing from ${unknown.join(', ')}. Choose from ${report.channels.join(', ') || 'none'}.`);
    checkSharable(tx.state, tx.venture!, report, tx.now);
    const made = newToken(tx.now);
    const stored = tx.put<ReportShareRecord>({
      ...tx.base('venture-report-share'), reportId, tokenHash: made.tokenHash, from, to, channels, state: 'open', served: origin !== null,
      expiresAt: made.expiresAt, views: 0, viewedAt: null, rotatedAt: null, disabledAt: null,
    });
    return reportShareView(stored, tx.now, origin ? `${origin}/share/${made.token}` : null);
  });
}

/**
 * venture.report.shareRotate { shareId } (approve, inside the app): a new token for the same scope, thirty days from
 * now; the old token opens nothing from this moment. A link that was turned off is not turned back on this way.
 */
export async function reportShareRotate(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ReportShareView> {
  requireAppChannel(ctx, 'venture.report.shareRotate');
  const body = exactPayload(payload, ['shareId'], ['shareId']);
  const shareId = identifier(body.shareId, 'Link');
  const origin = publicOrigin(deps);
  return ventureAction(deps, ctx, 'approve', 'report.shareRotate', tx => {
    const record = tx.find('venture-report-share', shareId);
    check(record, 'REPORT_SHARE_NOT_FOUND', 'That report link was not found.');
    check(record.state !== 'disabled', 'REPORT_SHARE_DISABLED', 'This link is turned off. Share the report again for a new one.');
    const report = tx.find('venture-report', record.reportId);
    check(report, 'REPORT_NOT_FOUND', 'That report was not found. Make it again.');
    checkSharable(tx.state, tx.venture!, report, tx.now);
    const made = newToken(tx.now);
    const next = tx.replace<ReportShareRecord>({ ...record, tokenHash: made.tokenHash, expiresAt: made.expiresAt, served: origin !== null, rotatedAt: tx.now });
    return reportShareView(next, tx.now, origin ? `${origin}/share/${made.token}` : null);
  });
}

/** venture.report.shareDisable { shareId } (approve, inside the app): the link stops opening at once. Twice changes nothing. */
export async function reportShareDisable(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ReportShareView> {
  requireAppChannel(ctx, 'venture.report.shareDisable');
  const body = exactPayload(payload, ['shareId'], ['shareId']);
  const shareId = identifier(body.shareId, 'Link');
  return ventureAction(deps, ctx, 'approve', 'report.shareDisable', tx => {
    const record = tx.find('venture-report-share', shareId);
    check(record, 'REPORT_SHARE_NOT_FOUND', 'That report link was not found.');
    if (record.state === 'disabled') return reportShareView(record, tx.now);
    return reportShareView(tx.replace<ReportShareRecord>({ ...record, state: 'disabled', disabledAt: tx.now }), tx.now);
  });
}

// ---------------------------------------------------------------------------
// The hosted page (trusted host only: VentureHost.shareLink, never an RPC method)
// ---------------------------------------------------------------------------

/** What the hosted /share/<token> page shows for a report: text only, read only, in the share page's own shape. */
export type ReportSharePage = {
  businessName: string; title: string; text: string; expires: Display; digest: string;
  decision: null; kind: 'report'; canAnswer: false; items: []; comments: [];
};

/** The blocks as the page's text: headings, words (a model estimate says so), each figure with its receipt, quotes as written. */
export function reportPageText(blocks: readonly ReportBlock[], scope: { from: IsoDate; to: IsoDate; channels: readonly string[] }, dates: (iso: string) => string): string {
  const lines = [`Covers ${dates(scope.from)} to ${dates(scope.to)}${scope.channels.length ? `, for ${scope.channels.join(', ')}` : ''}.`];
  for (const block of blocksInScope(blocks, scope)) {
    switch (block.kind) {
      case 'heading': lines.push('', block.estimate ? `${block.text} (model estimate)` : block.text); break;
      case 'prose': lines.push(block.estimate ? `${block.text} (model estimate)` : block.text); break;
      case 'metric': lines.push(`${block.label}: ${block.display}. Receipt ${block.receiptId}.`); break;
      case 'bars': lines.push(`${block.label}:`, ...block.bars.map(bar => `${bar.label}: ${bar.display}. Receipt ${bar.receiptId}.`)); break;
      case 'quote': lines.push(`"${block.text}"${block.by ? `, ${block.by}` : ''} (shown as written)`); break;
    }
  }
  lines.push('', 'Every figure comes from a receipt the business keeps. Read only.');
  return lines.join('\n');
}

/** The open, served, unexpired report link a token belongs to, or null; a wrong, ended or disabled token alike. */
function linkOf(state: State, venture: VentureRecord, token: unknown, nowIso: string): ReportShareRecord | null {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  const hash = sha256(token);
  const record = listRecords(state, 'venture-report-share', venture.id).find(item => item.tokenHash === hash);
  if (!record || !record.served || stateOf(record, nowIso) !== 'open') return null;
  // Served only while the owner could share it now: a draft changed since the report, or a CA sign-off withdrawn,
  // stops the page at once (the same checks as share and rotate).
  const report = listRecords(state, 'venture-report', venture.id).find(item => item.id === record.reportId);
  if (!report) return null;
  try { checkSharable(state, venture, report, nowIso); } catch { return null; }
  return record;
}

function pageOf(state: State, venture: VentureRecord, record: ReportShareRecord): ReportSharePage | null {
  const report = listRecords(state, 'venture-report', venture.id).find(item => item.id === record.reportId);
  if (!report) return null;
  const order = venture.country?.dateOrder;
  const dates = (iso: string) => (order ? formatVentureDate(iso.slice(0, 10), order) : iso.slice(0, 10));
  const text = reportPageText(report.blocks, record, dates);
  return {
    businessName: venture.workingName, title: report.titleEstimate ? `${report.title} (model estimate)` : report.title, text, expires: dates(record.expiresAt), digest: sha256(text),
    decision: null, kind: 'report', canAnswer: false, items: [], comments: [],
  };
}

/**
 * The page for a token, or null when it opens nothing. Each open through the token counts one view and keeps when it
 * was last viewed; options.preview (the owner's own look, or a HEAD) counts none. Writes nothing else.
 */
export async function reportSharePage(deps: VentureDeps, ctx: Context, token: unknown, options: { preview?: boolean } = {}): Promise<ReportSharePage | null> {
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture) return null;
  const record = linkOf(state, venture, token, deps.clock().toISOString());
  if (!record) return null;
  if (options.preview === true) return pageOf(state, venture, record);
  return ventureAction(deps, ctx, 'prepare', 'report.viewed', tx => {
    const current = linkOf(tx.state, tx.venture!, token, tx.now);
    if (!current) return null;
    const next = tx.replace<ReportShareRecord>({ ...current, views: current.views + 1, viewedAt: tx.now });
    return pageOf(tx.state, tx.venture!, next);
  });
}
