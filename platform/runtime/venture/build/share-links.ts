import {careerLinkCurrent} from '../playbooks/job-search-desk/share-current.ts';
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
// - Ink v2 wave 4 (4J7, O20, M17, U11): the token page records 'viewed' once (the owner's own preview never counts);
//   only the draft's client link may answer (the order's client now is the one the link was made for), and every answer
//   is recorded under that client (recordedFor); the client comments per item (per post, or the whole draft) without an
//   account, screened as untrusted words. Three more kinds, read only and revocable like every link: 'order-status' (a
//   live order's steps, page only), 'statement' ("What you owe us", money/statement.ts, its receipts sealed when the link
//   is made, its view the invoices' Viewed line) and 'books' (one month's invoices and payments for the accountant).
import { createHash } from 'node:crypto';
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import {
  currentVenture, exactPayload, formatVentureDate, identifier, listRecords, readVenture, requireAppChannel, ventureAction, type VentureTx,
} from '../records.ts';
import type {
  DeliveryRunRecord, Display, DraftPostView, OrderStageState, ShareAnswerView, ShareComment, ShareKind, ShareLinkStoredRecord, ShareLinkView,
  VentureDeps, VentureRecord,
} from '../contracts.ts';
import { HELD_WORDS, screenUntrusted } from '../policy/untrusted.ts';
import { clientStatement, type ClientStatement } from '../money/statement.ts';
import { invoicedPlan } from '../money/goal-plans.ts';
import { receivedPlan, sumReceiptIn, type SumPlan } from '../money/sums.ts';
import { calendarMonth } from '../money/dates.ts';
import { orderIndex, orderSteps } from '../money/order-steps.ts';
import { todayIso } from '../delivery/shared.ts';
import { runView } from '../delivery/runs.ts';
import { caSignoffBlock } from '../playbooks/ca-firm/signoff-gate.ts';
import { createShareLink, recordClientDecision, type DraftApproval, type ShareLinkRecord } from '../playbooks/social/approvals.ts';
import { draftApprovalsOfRun, draftPostViews, needsClientApproval, scheduleReasons } from '../playbooks/social/run-approvals.ts';
import { clientDraft } from './draft-text.ts';
import { checkManifest, refuseChangedFiles } from '../delivery/file-manifest.ts';
import { translationLinkCurrent } from '../playbooks/translation-studio/share-current.ts';

export const SHARE_DEFAULT_HOURS = 168;
export const SHARE_WORDS = Object.freeze({
  notServed: 'Share links open only on the hosted Chausar with a public address. Send your client the draft yourself and record their answer.',
  shownOnce: 'The link was shown once, when it was made.',
  revoked: 'You took this link back. It no longer opens.',
  ended: 'This link has ended.',
  approved: 'Your client approved it.',
  changes: 'Your client asked for changes.',
  notReady: 'Only a draft that is ready, or that you accepted, can go to your client.',
  notTheClient: "This link can't answer for the draft: it was made for another client. Ask whoever sent it for a new one.",
  pageOnly: 'This link is to read only. Nothing can be answered or changed through it.',
});
/** The kinds of link, and what each takes besides expiresInHours. */
const KIND_FIELDS: Readonly<Record<ShareKind, 'deliveryId' | 'orderId' | 'clientId' | 'month'>> = Object.freeze({
  draft: 'deliveryId', 'order-status': 'orderId', statement: 'clientId', books: 'month',
});
/** How many comments one link keeps, and how long one may be. */
export const SHARE_MAX_COMMENTS = 50;
export const SHARE_COMMENT_CHARS = 1000;
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

/** The decisions after one was added, the new ones recorded under the client the link was made for (4J7, O20). */
function underClient(decisions: readonly ShareLinkRecord['decisions'][number][], link: ShareLinkStoredRecord): ShareLinkStoredRecord['decisions'] {
  return decisions.map((item, index) => index < link.decisions.length ? { ...item } : { ...item, recordedFor: link.clientId });
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
  const kind = record.shareKind ?? 'draft';
  return {
    id: record.id, url, ...(reason ? { reason } : {}), expiresAt: record.expiresAt, ...(answer ? { answer } : {}), ...(revoked ? { revoked: true as const } : {}),
    // 4J7 (O20): the kind when it is not a draft, the first view through the token, and the client's comments.
    ...(kind !== 'draft' ? { shareKind: kind } : {}), ...(record.viewedAt ? { viewedAt: record.viewedAt } : {}),
    ...(record.comments?.length ? { comments: record.comments.map(item => ({ ...item })) } : {}),
  };
}

/** The public origin share links use: only on the hosted web server, and only when the host set one. */
function publicOrigin(deps: VentureDeps): string | null {
  return deps.host === 'hosted-web' && typeof deps.publicUrl === 'string' && deps.publicUrl ? deps.publicUrl.replace(/\/+$/, '') : null;
}

/**
 * venture.share.create { deliveryId | kind, orderId | clientId | month, expiresInHours? } (approve, inside the app): one
 * read-only link. kind 'draft' (the default) shares a delivery draft; 'order-status' a live order's steps; 'statement'
 * a client's "What you owe us"; 'books' one month's figures for the owner's accountant. Each kind takes its one field.
 */
export async function shareCreate(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ShareLinkView> {
  requireAppChannel(ctx, 'venture.share.create');
  const body = exactPayload(payload, ['deliveryId', 'kind', 'orderId', 'clientId', 'month', 'expiresInHours']);
  const kind = body.kind === undefined ? 'draft' : body.kind;
  check(typeof kind === 'string' && Object.hasOwn(KIND_FIELDS, kind), 'INVALID_VENTURE_REQUEST', 'Choose a draft, an order status, a statement or a month of books to share.');
  const field = KIND_FIELDS[kind as ShareKind];
  for (const other of Object.values(KIND_FIELDS)) {
    check(other === field ? body[other] !== undefined : body[other] === undefined, 'INVALID_VENTURE_REQUEST', `A ${kind === 'draft' ? 'draft' : kind.replace('-', ' ')} link takes ${field} only.`);
  }
  const hours = body.expiresInHours === undefined ? SHARE_DEFAULT_HOURS : body.expiresInHours;
  check(typeof hours === 'number' && Number.isInteger(hours) && hours >= 1 && hours <= 720, 'INVALID_VENTURE_REQUEST', 'A share link lasts between one hour and thirty days.');
  if (kind !== 'draft') return shareCreateOther(deps, ctx, kind as Exclude<ShareKind, 'draft'>, body[field], hours);
  const deliveryId = identifier(body.deliveryId, 'Draft');
  const origin = publicOrigin(deps);
  // 4J1 (J2): a file the owner accepted that changed since clears the acceptance and refuses the link (file-manifest.ts).
  await refuseChangedFiles(deps, ctx, deliveryId);
  return ventureAction(deps, ctx, 'approve', 'share.create', tx => {
    const venture = tx.venture!;
    const record = tx.find('venture-delivery-run', deliveryId);
    check(record, 'DELIVERY_NOT_FOUND', 'That draft was not found.');
    check(!tx.find('venture-order', record.orderId)?.internal, 'INTERNAL_ORDER', 'Your own shop work has no client share link.');
    checkManifest(tx.state, record);
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

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "What you owe us" as the page shows it, in the engine's words and figures (money/statement.ts). */
export function statementText(statement: ClientStatement, venture: VentureRecord): string {
  const date = (iso: string | null) => (iso ? formatVentureDate(iso, venture.country.dateOrder) : 'no date');
  const lines = [`For ${statement.client.name}, as of ${date(statement.asOf)}.`, ''];
  lines.push(statement.open.length ? 'Open invoices:' : 'No invoice is open.');
  for (const open of statement.open) {
    lines.push(`${open.number}, issued ${date(open.issueDate)}, due ${date(open.dueDate)}: total ${open.total}, paid ${open.paid}, credited ${open.credited}, left to pay ${open.balance}${open.late ? `, ${open.late}` : ''}.`);
  }
  if (statement.waiting.length) {
    lines.push('', 'Waiting to clear:');
    for (const cheque of statement.waiting) lines.push(`${cheque.number}: ${cheque.amount}${cheque.tds ? `, ${cheque.tds}` : ''}. ${cheque.line}`);
  }
  lines.push('', `Paid so far: ${statement.paidTotal.display}.`);
  for (const paid of statement.paid) lines.push(`${paid.number}: ${paid.amount} by ${paid.method} on ${date(paid.receivedOn)}${paid.tds ? `, ${paid.tds}` : ''}.`);
  lines.push('', `Credit notes: ${statement.creditedTotal.display}.`);
  for (const note of statement.credits) lines.push(`${note.number} on ${note.invoiceNumber}, ${date(note.issuedOn)}: ${note.amount}.`);
  lines.push('', `Left to pay: ${statement.owed.display}.`);
  return lines.join('\n');
}

/** One month's invoices issued and payments received, for the owner's accountant, from the two sum plans. */
export function booksText(plans: { invoiced: SumPlan; received: SumPlan }, display: string, currency: string): string {
  const total = (plan: SumPlan) => formatMinor(plan.addends.reduce((sum, addend) => sum + BigInt(addend.amount), 0n), currency);
  const lines = [`Invoices issued in ${display}, before tax: ${total(plans.invoiced)}.`];
  for (const addend of plans.invoiced.addends) lines.push(`${addend.label}: ${addend.display}.`);
  lines.push('', `Payments received in ${display}: ${total(plans.received)}.`);
  for (const addend of plans.received.addends) lines.push(`${addend.label}: ${addend.display}.`);
  lines.push('', 'Every figure comes from the back office, added up by code. Read only.');
  return lines.join('\n');
}

/** What a non-draft link shows, worked out from records: title, text, its digest, and what the statement or month sealed. */
type OtherContent = { deliveryId: string; clientId: string | null; title: string; text: string; invoiceIds?: string[]; receiptIds?: string[] };

function orderContent(state: State, venture: VentureRecord, orderId: string): OtherContent {
  const order = listRecords(state, 'venture-order', venture.id).find(item => item.id === orderId);
  check(order && order.status !== 'cancelled', 'ORDER_NOT_FOUND', 'That order was not found, or it was cancelled.');
  check(!order.internal, 'INTERNAL_ORDER', 'Your own shop work has no client share link.');
  // The page works the steps out each time it opens; the record keeps no copy, so it never goes stale.
  return { deliveryId: order.id, clientId: order.clientId, title: `Your order with ${venture.workingName}`, text: '' };
}

/**
 * A link of kind order-status, statement or books, after the same checks a draft link has. Everything happens in one
 * transaction: the figures are read, their sum receipts sealed (money/sums.ts sumReceiptIn) and the link stored
 * together, so the receipts are always the ones of the text the link shows, and a refusal leaves none behind.
 */
async function shareCreateOther(deps: VentureDeps, ctx: Context, kind: Exclude<ShareKind, 'draft'>, subject: unknown, hours: number): Promise<ShareLinkView> {
  const origin = publicOrigin(deps);
  const { venture } = readVenture(deps, ctx);
  check(kind === 'order-status' || venture.country, 'INVALID_VENTURE_REQUEST', 'Finish the interview first, so Chausar knows your country and currency.');
  let content: (tx: VentureTx) => OtherContent;
  if (kind === 'order-status') {
    const orderId = identifier(subject, 'Order');
    content = tx => orderContent(tx.state, venture, orderId);
  } else if (kind === 'statement') {
    const clientId = identifier(subject, 'Client');
    const today = todayIso(deps, venture);
    content = tx => {
      check(!tx.find('venture-client', clientId)?.self, 'INTERNAL_ORDER', 'Your own shop has no client statement link.');
      const now = clientStatement(tx.state, clientId, today);
      // The receipts behind the three totals: the owner's proof of what the client was shown.
      const receiptIds = [now.plans.owed, now.plans.paid, now.plans.credited].map(plan => sumReceiptIn(tx, plan).id);
      return {
        deliveryId: clientId, clientId, title: `What you owe ${venture.workingName}`, text: statementText(now, venture),
        invoiceIds: now.open.map(open => open.invoiceId), receiptIds,
      };
    };
  } else {
    check(typeof subject === 'string' && MONTH.test(subject), 'INVALID_VENTURE_REQUEST', 'Choose a month like 2026-10.');
    const month = calendarMonth(subject);
    content = tx => {
      const plans = {
        invoiced: invoicedPlan(tx.state, venture, { type: 'invoiced', month: month.month, which: 'issued' }),
        received: receivedPlan(tx.state, venture, month.from, month.to),
      };
      return {
        deliveryId: `books:${month.month}`, clientId: null, title: `${venture.workingName}: books for ${month.display}`,
        text: booksText(plans, month.display, venture.country.currency), receiptIds: [sumReceiptIn(tx, plans.invoiced).id, sumReceiptIn(tx, plans.received).id],
      };
    };
  }
  return ventureAction(deps, ctx, 'approve', 'share.create', tx => {
    const made = content(tx);
    const link = createShareLink({ drafts: [{ draftId: made.deliveryId, digest: sha256(`${kind}:${made.text}`), checks: 'passed',
      owner: { decision: 'approved', by: ctx.memberId, at: tx.now }, client: { decision: null, via: null, at: null, comment: null } }],
    clientId: made.clientId ?? NO_CLIENT, by: ctx.memberId, now: tx.now, ttlHours: hours });
    const stored = tx.put<ShareLinkStoredRecord>({
      ...tx.base('venture-share-link'), deliveryId: made.deliveryId, clientId: made.clientId, tokenHash: link.record.tokenHash, title: made.title, text: made.text,
      draftDigest: sha256(`${kind}:${made.text}`), expiresAt: link.record.expiresAt, state: 'open', revokedAt: null, served: origin !== null, decisions: [],
      shareKind: kind, viewedAt: null, ...(made.invoiceIds ? { invoiceIds: made.invoiceIds } : {}), ...(made.receiptIds ? { receiptIds: made.receiptIds } : {}),
    });
    return shareView(stored, tx.now, origin ? `${origin}/share/${link.token}` : null);
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
 * now. Either way the same answer that makes venture.share.recordAnswer refuse with ALREADY_DECIDED. Defence in depth
 * (4J3): an answer given through the link itself counts only when it came before the link ended and before it was taken
 * back; an answer the owner recorded counts as it is. Exported for an order's Client OK step (money/order-steps.ts).
 */
export function countedAnswer(state: State, run: DeliveryRunRecord): ShareAnswerView | null {
  const links = listRecords(state, 'venture-share-link', run.ventureId).filter(link => link.deliveryId === run.id);
  const standing = links.flatMap(link => link.decisions.filter(made => made.via !== 'share-link'
    || (Date.parse(made.at) <= Date.parse(link.expiresAt) && (link.revokedAt === null || Date.parse(made.at) <= Date.parse(link.revokedAt)))));
  const [first] = draftApprovalsOfRun(state, run.id);
  if (first) {
    const { client } = first.approval;
    if (!client.decision || !client.at || !client.via) return null;
    if (scheduleReasons(first, { clientApproval: true }).some(reason => reason.code === 'POST_DRAFT_CHANGED')) return null;
    if (!standing.some(made => made.at === client.at && made.decision === client.decision && made.via === client.via)) return null;
    return { draftId: run.id, decision: client.decision, comment: client.comment, at: client.at, via: client.via };
  }
  const current = clientDraft(run).digest;
  const made = standing.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).at(-1);
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
    const next = tx.replace<ShareLinkStoredRecord>({ ...link, decisions: underClient(decided.decisions, link), state: decided.state === 'closed' ? 'closed' : 'open' });
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

/**
 * What the client's page shows. Everything is text; the page escapes it. kind: what the link shares. canAnswer: whether
 * this link may answer now (a draft link, made for the order's client, not yet answered). items: the posts a draft
 * holds, each a comment can name ('draft' names the whole). steps: an order status link's steps in the client's words.
 */
export type SharePage = {
  businessName: string; title: string; text: string; expires: Display; digest: string;
  decision: { decision: 'approved' | 'changes'; comment: string | null } | null;
  kind: ShareKind; canAnswer: boolean;
  items: { id: string; name: string; text: string }[];
  comments: { item: string; text: string }[];
  steps?: { label: string; state: string }[];
};

/** An order step's state in the client's words: nothing about what waits on the owner, or why. */
const STEP_WORDS: Readonly<Record<OrderStageState, string>> = Object.freeze({
  done: 'Done', waits: 'In progress', 'always-asks': 'In progress', 'not-yet': 'Not started yet', unknown: 'Not known yet',
});

/** The open, served, unexpired link a token belongs to, or null. A wrong, ended or revoked token gets null alike. */
function linkOf(state: State, venture: VentureRecord, token: unknown, nowIso: string): ShareLinkStoredRecord | null {
  if (typeof token !== 'string' || !SHARE_TOKEN.test(token)) return null;
  const hash = sha256(token);
  const record = listRecords(state, 'venture-share-link', venture.id).find(item => item.tokenHash === hash);
  if (!record || !record.served || record.state === 'revoked' || Date.parse(record.expiresAt) <= Date.parse(nowIso) || !translationLinkCurrent(state,record,nowIso) || !careerLinkCurrent(state,record,nowIso)) return null;
  return record;
}

/** The draft a draft link shows, when it still exists. */
function runOfLink(state: State, record: ShareLinkStoredRecord): DeliveryRunRecord | undefined {
  if ((record.shareKind ?? 'draft') !== 'draft') return undefined;
  return listRecords(state, 'venture-delivery-run', record.ventureId).find(run => run.id === record.deliveryId);
}

/**
 * Why this link may not speak for the draft's client, or null when it may: only a draft link, while the client it was
 * made for is still the client of the draft's order. A link made for another client (the order moved since) answers
 * nothing and leaves the draft pending. A draft with no order record (made before orders, or in tests) keeps the
 * client the link was made with, none.
 */
function speakRefusal(state: State, record: ShareLinkStoredRecord, nowIso:string): string | null {
  if(record.career)return careerLinkCurrent(state,record,nowIso)?null:SHARE_WORDS.notTheClient;
  if (record.translation) return translationLinkCurrent(state,record,nowIso) ? null : SHARE_WORDS.notTheClient;
  if ((record.shareKind ?? 'draft') !== 'draft') return SHARE_WORDS.pageOnly;
  const run = runOfLink(state, record);
  const order = run ? listRecords(state, 'venture-order', record.ventureId).find(item => item.id === run.orderId) : undefined;
  const client = order ? order.clientId : null;
  return client === (record.clientId ?? null) ? null : SHARE_WORDS.notTheClient;
}

/** An order status link's steps, worked out from the order's records now. */
function orderStepsOf(state: State, venture: VentureRecord, record: ShareLinkStoredRecord, nowMs: number): { label: string; state: string }[] {
  const order = listRecords(state, 'venture-order', venture.id).find(item => item.id === record.deliveryId);
  if (!order) return [];
  return orderSteps(orderIndex(state, venture, nowMs), order).stages.map(stage => ({ label: stage.label, state: STEP_WORDS[stage.state] }));
}

function pageOf(state: State, record: ShareLinkStoredRecord, venture: VentureRecord, nowMs: number): SharePage {
  const made = record.decisions.at(-1);
  const kind = record.shareKind ?? 'draft';
  const run = runOfLink(state, record);
  const steps = kind === 'order-status' ? orderStepsOf(state, venture, record, nowMs) : undefined;
  return {
    businessName: venture.workingName, title: record.title, digest: record.draftDigest,
    text: steps ? steps.map(step => `${step.label}: ${step.state}`).join('\n') : record.text,
    expires: formatVentureDate(record.expiresAt.slice(0, 10), venture.country.dateOrder),
    decision: made ? { decision: made.decision, comment: made.comment } : null,
    kind, canAnswer: !made && speakRefusal(state, record, new Date(nowMs).toISOString()) === null,
    items: run ? draftPostViews(run).map(post => ({ id: post.draftId, name: post.name, text: post.text })) : [],
    comments: (record.comments ?? []).map(item => ({ item: item.item, text: item.text })),
    ...(steps ? { steps } : {}),
  };
}

/**
 * The page for a token, or null when it does not open. The first open through the token records the link as viewed
 * (once, and never on the owner's own preview: options.preview). Writes nothing else.
 */
export async function sharePage(deps: VentureDeps, ctx: Context, token: unknown, options: { preview?: boolean } = {}): Promise<SharePage | null> {
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture) return null;
  const record = linkOf(state, venture, token, deps.clock().toISOString());
  if (!record) return null;
  if (options.preview === true || record.viewedAt) return pageOf(state, record, venture, deps.clock().getTime());
  return ventureAction(deps, ctx, 'prepare', 'share.viewed', tx => {
    const current = linkOf(tx.state, tx.venture!, token, tx.now);
    if (!current) return null;
    const next = current.viewedAt ? current : tx.replace<ShareLinkStoredRecord>({ ...current, viewedAt: tx.now });
    return pageOf(tx.state, next, tx.venture!, Date.parse(tx.now));
  });
}

/**
 * The client's answer through the link: approve or ask for changes, with an optional comment, on the digest the page
 * showed. Only the draft's client link answers (SHARE_LINK_REFUSED otherwise, and the draft stays pending), recorded
 * under that client. Decide-once (ALREADY_DECIDED); a changed digest is APPROVAL_STALE; a link that ended or was taken
 * back answers null. Recorded through the approvals module. The comment is a client's words, so it goes through the
 * untrusted screen first, like a per-item comment (4J7), and Forget erases it (file-requests.ts).
 */
export async function shareDecide(deps: VentureDeps, ctx: Context, token: unknown, input: { decision: unknown; comment?: unknown; digest: unknown }): Promise<SharePage | null> {
  check(input.decision === 'approved' || input.decision === 'changes', 'INVALID_VENTURE_REQUEST', 'Choose approve or ask for changes.');
  check(typeof input.digest === 'string' && /^[a-f0-9]{64}$/.test(input.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the draft you read.');
  check(input.comment === undefined || input.comment === null || (typeof input.comment === 'string' && input.comment.length <= SHARE_COMMENT_CHARS), 'INVALID_VENTURE_REQUEST', `Write a comment of at most ${SHARE_COMMENT_CHARS} characters.`);
  const said = typeof input.comment === 'string' && input.comment.trim() ? screenedClientWords(input.comment) : null;
  return ventureAction(deps, ctx, 'prepare', 'share.decide', tx => {
    const record = linkOf(tx.state, tx.venture!, token, tx.now);
    if (!record) return null;
    const refused = speakRefusal(tx.state, record, tx.now);
    if (refused) throw new ChausarError('SHARE_LINK_REFUSED', refused);
    const decided = recordClientDecision(asApprovalLink(record), { via: 'share-link', token: token as string }, {
      draftId: record.deliveryId, digest: input.digest as string, decision: input.decision as 'approved' | 'changes',
      comment: said, now: tx.now,
    });
    const next = tx.replace<ShareLinkStoredRecord>({
      ...record, decisions: underClient(decided.decisions, record), state: decided.state === 'closed' ? 'closed' : 'open',
    });
    return pageOf(tx.state, next, tx.venture!, Date.parse(tx.now));
  });
}

/** Control characters a comment never keeps (a line break and a tab stay). */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** A client's words as they are kept: control characters out, and through the untrusted screen; held words say so. */
function screenedClientWords(text: string): string {
  const screened = screenUntrusted({ source: 'client-answer', text: text.replace(CONTROL, '').trim() }, { mode: 'enforce' });
  return screened.status === 'quarantined' || screened.text === null ? HELD_WORDS : screened.text;
}

/**
 * The client's comment on one item of a shared draft (a post's id, or 'draft' for the whole), without an account:
 * only through the draft's client link while it opens (null when it does not), at most SHARE_COMMENT_CHARS of text and
 * SHARE_MAX_COMMENTS a link. The words are a client's, so the untrusted screen runs before they are kept: words aimed
 * at an agent are held, and the comment says so. Recorded under the client.
 */
export async function shareComment(deps: VentureDeps, ctx: Context, token: unknown, input: { item: unknown; text: unknown }): Promise<SharePage | null> {
  check(typeof input.item === 'string' && input.item.length <= 120, 'INVALID_VENTURE_REQUEST', 'Choose the post the comment is about.');
  check(typeof input.text === 'string' && input.text.trim().length > 0 && input.text.length <= SHARE_COMMENT_CHARS, 'INVALID_VENTURE_REQUEST', `Write a comment of at most ${SHARE_COMMENT_CHARS} characters.`);
  const kept = screenedClientWords(input.text as string);
  return ventureAction(deps, ctx, 'prepare', 'share.comment', tx => {
    const record = linkOf(tx.state, tx.venture!, token, tx.now);
    if (!record) return null;
    const refused = speakRefusal(tx.state, record, tx.now);
    if (refused) throw new ChausarError('SHARE_LINK_REFUSED', refused);
    const run = runOfLink(tx.state, record)!;
    const items = new Set(['draft', ...(run ? draftPostViews(run).map(post => post.draftId) : [])]);
    check(items.has(input.item as string), 'INVALID_VENTURE_REQUEST', 'Choose one of the posts on this page, or the whole draft.');
    check((record.comments ?? []).length < SHARE_MAX_COMMENTS, 'INVALID_VENTURE_REQUEST', 'This link has taken as many comments as it can. Send the rest to whoever shared it.');
    const comment: ShareComment = { item: input.item as string, text: kept, at: tx.now, recordedFor: record.clientId };
    const next = tx.replace<ShareLinkStoredRecord>({ ...record, comments: [...(record.comments ?? []), comment] });
    return pageOf(tx.state, next, tx.venture!, Date.parse(tx.now));
  });
}
