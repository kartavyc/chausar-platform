// Chausar venture launcher: the customer engine's lead rules (package P2-connectors).
// - A lead needs the page it was seen on (its source URL). No source, no lead.
// - An email counts as verified only after an MX lookup finds a mail server. A failure, a null MX or a timeout is
//   "not verified", never "probably fine". The resolver is injectable; the real one is node:dns.
// - The blocklist is checked before any draft, ahead of every other rule. Opt-outs go on it for good.
// - Agents only draft. Nothing here sends: the owner sends from their own mailbox and records each real send in the app.
// - The footer rule (Ink v2 wave 4, 4E2, catalogue C20, the founder's decision): a cold email (kind cold-email, no tie,
//   or a tie below Know) ends with the business postal address and an unsubscribe line, and without an address there
//   is no draft (LEADS_ADDRESS_MISSING); cold email rules in many places ask for both. A warm note to a tie of Know or
//   better carries no footer on any channel, nor does a LinkedIn or WhatsApp note. The lead list drafts cold email only
//   (a lead is someone found on a web page), so every draft here carries the footer.
// - A lead's stage moves forward only: new (found), drafted, contacted, replied, then won or lost. Won and lost are
//   terminal; blocked (an opt-out) can follow any stage and is never left. Every move keeps the evidence it rests on.
// The evidence-or-refuse, MX and blocklist rules follow naidx0/revenue-squad (MIT, Copyright (c) 2026 naidx0); rewritten here.
import { resolveMx } from 'node:dns/promises';
import { check, newId, type Context } from '../../contracts.ts';
import type { IsoTime, OutreachChannel, OutreachKind, PipelineStage, StageMove, TieBand } from '../contracts.ts';
import { digest, isAppChannel } from '../records.ts';
import { redactUrl } from '../core/secrets.ts';

export type MxRecord = { exchange: string; priority: number };
export type MxResolver = (domain: string) => Promise<MxRecord[]>;
export const DEFAULT_MX_TIMEOUT_MS = 5000;
export const DEFAULT_UNSUBSCRIBE_LINE = 'To stop these emails, reply with the word unsubscribe and we will not write to you again.';

export type EmailCheck = { status: 'unverified' | 'verified' | 'failed'; at: IsoTime | null; line: string };
export type OutreachDraft = {
  id: string;
  leadId: string;
  to: string;
  subject: string;
  text: string; // the body, then the footer with the business name, postal address and unsubscribe line
  footer: { businessName: string; postalAddress: string; unsubscribe: string };
  sourceUrl: string;
  by: 'agent' | 'owner';
  at: IsoTime;
  digest: string;
};
export type SendRecord = { draftId: string; sentAt: IsoTime; recordedBy: string; recordedAt: IsoTime; channel: 'own-mailbox' };
export type LeadStage = 'new' | 'drafted' | 'contacted' | 'replied' | 'won' | 'lost' | 'blocked';
/** What a move rests on: the draft, the owner's send, the reply, the outcome (an invoice, a note) or the opt-out. */
export type StageEvidence = { kind: 'draft' | 'send' | 'reply' | 'outcome' | 'opt-out'; id: string };
export type LeadMove = { from: LeadStage; to: LeadStage; at: IsoTime; by: string; evidence: StageEvidence };
export type Lead = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  emailDomain: string | null;
  sourceUrl: string;
  emailCheck: EmailCheck;
  status: LeadStage;
  drafts: OutreachDraft[];
  sends: SendRecord[];
  moves: LeadMove[];
  addedBy: string;
  addedAt: IsoTime;
};
/** handles (4E2): phones in E.164 and LinkedIn profile addresses; absent is none. */
export type Blocklist = { emails: ReadonlySet<string>; domains: ReadonlySet<string>; handles?: ReadonlySet<string> };

const EMAIL = /^[^\s@<>()",;:]{1,64}@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/;
const oneLine = (value: unknown, field: string, max: number, required: boolean): string | null => {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '' && !required)) return null;
  check(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\r\n\t\u0000-\u001F\u007F]/.test(value.trim()), 'INVALID_VENTURE_REQUEST', `${field} must be one line of text.`);
  return value.trim();
};

function sourceUrlOf(value: unknown): string {
  let url: URL | null = null;
  try { url = typeof value === 'string' && value.trim() ? new URL(value.trim()) : null; } catch { url = null; }
  check(url && (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0, 'LEADS_SOURCE_REQUIRED', 'Add the web page where this lead was found.');
  // Stored without user info or secret-looking query, fragment and path parts (core/secrets.ts, W1 H17).
  return redactUrl(url.href);
}

/** A new lead. The email is optional, but no outreach is drafted without a verified one. */
export function createLead(input: { id?: string; name: unknown; company?: unknown; email?: unknown; sourceUrl?: unknown }, meta: { by: string; at: IsoTime }): Lead {
  const sourceUrl = sourceUrlOf(input.sourceUrl);
  const name = oneLine(input.name, 'name', 120, true)!;
  const company = oneLine(input.company, 'company', 120, false);
  let email: string | null = null, emailDomain: string | null = null;
  if (input.email !== undefined && input.email !== null && input.email !== '') {
    const lowered = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const match = EMAIL.exec(lowered);
    check(match, 'INVALID_VENTURE_REQUEST', 'That does not look like an email address.');
    email = lowered;
    emailDomain = match[1];
  }
  return {
    id: input.id ?? newId('lead'), name, company, email, emailDomain, sourceUrl,
    emailCheck: { status: 'unverified', at: null, line: email ? 'Not checked yet.' : 'No email yet.' },
    status: 'new', drafts: [], sends: [], moves: [], addedBy: meta.by, addedAt: meta.at,
  };
}

/** The stage table. Open stages move up the ranks only; won and lost close a lead; blocked comes from anywhere. */
const STAGE_RANK: Readonly<Record<Exclude<LeadStage, 'blocked'>, number>> = { new: 0, drafted: 1, contacted: 2, replied: 3, won: 4, lost: 4 };
const CLOSED: ReadonlySet<LeadStage> = new Set(['won', 'lost']);
const EVIDENCE_KINDS: ReadonlySet<string> = new Set(['draft', 'send', 'reply', 'outcome', 'opt-out']);
type MoveMeta = { evidence: StageEvidence; by: string; at: IsoTime };

/**
 * Moves a lead to a later stage and keeps the move with its evidence. Refuses a move back or to the same stage
 * (LEADS_STAGE_BACKWARD), any move out of won or lost except an opt-out (LEADS_STAGE_CLOSED), and any move out of
 * blocked (LEADS_BLOCKED). Returns a new lead; the one passed in is left as it was.
 */
export function moveLead(lead: Lead, to: LeadStage, meta: MoveMeta): Lead {
  check(to === 'blocked' || Object.hasOwn(STAGE_RANK, to), 'INVALID_VENTURE_REQUEST', 'Choose one of the lead stages.');
  const evidence = meta.evidence as Partial<StageEvidence> | null | undefined;
  check(evidence && typeof evidence.kind === 'string' && EVIDENCE_KINDS.has(evidence.kind) && typeof evidence.id === 'string' && evidence.id.length > 0 && evidence.id.length <= 200,
    'INVALID_VENTURE_REQUEST', 'A stage change needs its evidence: the draft, the send, the reply, the outcome or the opt-out.');
  const from = lead.status;
  check(from !== 'blocked', 'LEADS_BLOCKED', 'This person asked not to be contacted.');
  if (to !== 'blocked') {
    check(!CLOSED.has(from), 'LEADS_STAGE_CLOSED', `This lead is ${from === 'won' ? 'won' : 'lost'}, so its stage stays as it is.`);
    check(STAGE_RANK[to] > STAGE_RANK[from], 'LEADS_STAGE_BACKWARD', 'A lead only moves forward through its stages.');
  }
  const move: LeadMove = { from, to, at: meta.at, by: meta.by, evidence: { kind: evidence.kind, id: evidence.id } };
  return { ...lead, status: to, moves: [...(lead.moves ?? []), move] };
}

/** An event that implies a stage (a draft, a send): moves forward when it is one, else leaves the stage as it is. */
function advance(lead: Lead, to: Exclude<LeadStage, 'blocked'>, meta: MoveMeta): Lead {
  const from = lead.status;
  if (from === 'blocked' || CLOSED.has(from) || STAGE_RANK[to] <= STAGE_RANK[from]) return lead;
  return moveLead(lead, to, meta);
}

/** Looks up the email domain's mail servers. Verified only when at least one real server comes back in time. */
export async function verifyLeadEmail(lead: Lead, options: { resolver?: MxResolver; now: IsoTime; timeoutMs?: number }): Promise<Lead> {
  return { ...lead, emailCheck: await checkEmail(lead.email, options) };
}

/**
 * The mail server check of one address (a lead's, or a person's for a cold email, 4E2): verified only when at least
 * one real server comes back in time; a failure, a null MX or a timeout is "failed", never "probably fine".
 */
export async function checkEmail(email: string | null, options: { resolver?: MxResolver; now: IsoTime; timeoutMs?: number }): Promise<EmailCheck> {
  const failed = (line: string): EmailCheck => ({ status: 'failed', at: options.now, line });
  const domain = email && email.includes('@') ? email.split('@').pop()!.toLowerCase() : null;
  if (!email || !domain) return failed('No email to check.');
  const resolver = options.resolver ?? resolveMx;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let records: MxRecord[] | 'timeout';
  try {
    records = await Promise.race([
      resolver(domain),
      new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), options.timeoutMs ?? DEFAULT_MX_TIMEOUT_MS); }),
    ]);
  } catch (error) {
    const reason = typeof (error as { code?: unknown })?.code === 'string' ? ` (${(error as { code: string }).code})` : '';
    return failed(`No mail server found for ${domain}${reason}. Not verified.`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (records === 'timeout') return failed(`The mail server check for ${domain} timed out, so the email is not verified.`);
  const real = (Array.isArray(records) ? records : []).filter(r => typeof r?.exchange === 'string' && r.exchange.trim() !== '' && r.exchange.trim() !== '.');
  if (real.length === 0) return failed(`${domain} accepts no email. Not verified.`);
  return { status: 'verified', at: options.now, line: `Mail servers found for ${domain}.` };
}

/**
 * A phone (E.164, '+919900122334') or a LinkedIn profile address ('https://www.linkedin.com/in/<slug>'), in the one
 * spelling the network keeps them in (4E2): a "stop" on WhatsApp or LinkedIn puts the handle on the blocklist.
 */
const isHandle = (entry: string): boolean => /^\+[1-9]\d{6,14}$/.test(entry) || entry.startsWith('https://www.linkedin.com/in/');

/** One entry per line: a whole email, a bare domain, a phone in E.164 or a LinkedIn profile address. # starts a comment. */
export function parseBlocklist(text: string): Blocklist {
  let blocklist: Blocklist = { emails: new Set<string>(), domains: new Set<string>(), handles: new Set<string>() };
  for (const raw of text.split(/\r?\n/)) {
    const entry = raw.split('#', 1)[0].trim();
    if (entry) blocklist = addToBlocklist(blocklist, entry);
  }
  return blocklist;
}

export function isBlocked(blocklist: Blocklist, value: string | null): boolean {
  const entry = (value ?? '').trim().toLowerCase();
  if (!entry) return false;
  if (isHandle(entry)) return blocklist.handles?.has(entry) ?? false;
  if (entry.includes('@')) return blocklist.emails.has(entry) || blocklist.domains.has(entry.split('@')[1]);
  return blocklist.domains.has(entry);
}

export function addToBlocklist(blocklist: Blocklist, value: string): Blocklist {
  const entry = value.trim().toLowerCase();
  if (!entry) return blocklist;
  const emails = new Set(blocklist.emails), domains = new Set(blocklist.domains), handles = new Set(blocklist.handles ?? []);
  (isHandle(entry) ? handles : entry.includes('@') ? emails : domains).add(entry);
  return { emails, domains, handles };
}

/** Whether the blocklist covers a person: any of their emails (or its domain), phones or their LinkedIn page (4E2). */
export function personOnBlocklist(blocklist: Blocklist, handles: { emails: readonly string[]; phones: readonly string[]; linkedinUrl: string | null }): boolean {
  return [...handles.emails, ...handles.phones, ...(handles.linkedinUrl ? [handles.linkedinUrl] : [])].some(value => isBlocked(blocklist, value));
}

/** Whether the blocklist covers this lead: its email, its email's domain or the site it was found on. */
export function onBlocklist(lead: Pick<Lead, 'email' | 'emailDomain' | 'sourceUrl'>, blocklist: Blocklist): boolean {
  let sourceHost: string | null = null;
  try { sourceHost = new URL(lead.sourceUrl).hostname.toLowerCase(); } catch { sourceHost = null; }
  return isBlocked(blocklist, lead.email) || isBlocked(blocklist, lead.emailDomain) || isBlocked(blocklist, sourceHost);
}

function blocked(lead: Lead, blocklist: Blocklist): boolean {
  return lead.status === 'blocked' || onBlocklist(lead, blocklist);
}

export type DraftInput = {
  subject: string;
  body: string;
  by: 'agent' | 'owner';
  business: { name: string; postalAddress: string; unsubscribeLine?: string };
  blocklist: Blocklist;
  at: IsoTime;
};

/** The ties the owner knows well enough that a note to them is warm, not cold: Know or better (4D2's bands). */
export const WARM_BANDS: ReadonlySet<TieBand> = new Set<TieBand>(['close', 'know-well', 'know']);
export type OutreachFooter = { businessName: string; postalAddress: string; unsubscribe: string };

/**
 * The footer rule (C20): true for a cold email, which carries the unsubscribe line and the postal address. An email is
 * cold when its kind is cold-email, or the person has no tie, or a tie below Know. A warm note to a tie of Know or
 * better is not, and neither is any LinkedIn or WhatsApp note (they never carry the footer).
 */
export function coldOutreach(input: { kind: OutreachKind; channel: OutreachChannel; band: TieBand | null }): boolean {
  return input.channel === 'email' && (input.kind === 'cold-email' || input.band === null || !WARM_BANDS.has(input.band));
}

/**
 * The footer a message carries under the footer rule: for a cold email the business name, its postal address (without
 * one, no draft: LEADS_ADDRESS_MISSING) and the unsubscribe line; for anything else, none.
 */
export function outreachFooter(input: { kind: OutreachKind; channel: OutreachChannel; band: TieBand | null; business: DraftInput['business'] }): OutreachFooter | null {
  if (!coldOutreach(input)) return null;
  const postalAddress = typeof input.business?.postalAddress === 'string' ? input.business.postalAddress.trim() : '';
  check(postalAddress.length >= 5, 'LEADS_ADDRESS_MISSING', 'Add your business postal address. Every cold email carries it.');
  const businessName = oneLine(input.business.name, 'business name', 120, true)!;
  return { businessName, postalAddress, unsubscribe: input.business.unsubscribeLine?.trim() || DEFAULT_UNSUBSCRIBE_LINE };
}

/** The body, then the footer below a separator line when there is one. */
export function withFooter(body: string, footer: OutreachFooter | null): string {
  return footer ? `${body.trim()}\n\n--\n${footer.businessName}\n${footer.postalAddress}\n${footer.unsubscribe}` : body.trim();
}

/**
 * Drafts one outreach email for the lead list: a cold email (kind cold-email), so the footer rule always gives it the
 * footer. Order: blocklist, source, verified email, postal address. Nothing is sent.
 */
export function draftOutreach(lead: Lead, input: DraftInput): { lead: Lead; draft: OutreachDraft } {
  check(!blocked(lead, input.blocklist), 'LEADS_BLOCKED', 'This person or their company asked not to be contacted, or is on your blocklist.');
  sourceUrlOf(lead.sourceUrl);
  check(lead.email && lead.emailCheck.status === 'verified', 'LEADS_EMAIL_UNVERIFIED', 'Check the email first. Only an email with a working mail server gets a draft.');
  const footer = outreachFooter({ kind: 'cold-email', channel: 'email', band: null, business: input.business })!;
  const subject = oneLine(input.subject, 'subject', 160, true)!;
  check(typeof input.body === 'string' && input.body.trim().length > 0 && input.body.length <= 5000, 'INVALID_VENTURE_REQUEST', 'Write the email body.');
  const text = withFooter(input.body, footer);
  const id = newId('outreach');
  const draft: OutreachDraft = {
    id, leadId: lead.id, to: lead.email, subject, text, footer, sourceUrl: lead.sourceUrl,
    by: input.by, at: input.at, digest: digest({ id, to: lead.email, subject, text }),
  };
  const withDraft = { ...lead, drafts: [...lead.drafts, draft] };
  return { lead: advance(withDraft, 'drafted', { evidence: { kind: 'draft', id }, by: input.by, at: input.at }), draft };
}

/**
 * The owner says, inside the app, that they sent one draft from their own mailbox. Chausar never sends it. The lead
 * moves to contacted only from an earlier stage: a lead that replied, won or lost keeps its stage.
 */
export function recordSend(lead: Lead, input: { draftId: string; sentAt: IsoTime }, ctx: Context, now: IsoTime): Lead {
  check(isAppChannel(ctx) && (ctx.role === 'owner' || ctx.role === 'cofounder'), 'APP_APPROVAL_REQUIRED', 'Only you record a send, inside the Chausar app.');
  check(lead.status !== 'blocked', 'LEADS_BLOCKED', 'This person asked not to be contacted.');
  const draft = lead.drafts.find(item => item.id === input.draftId);
  check(draft, 'INVALID_VENTURE_REQUEST', 'Choose one of the drafts for this lead.');
  const sentAt = Date.parse(input.sentAt);
  check(Number.isFinite(sentAt) && sentAt <= Date.parse(now) && sentAt >= Date.parse(draft.at), 'INVALID_VENTURE_REQUEST', 'The send time must be after the draft and not in the future.');
  const send: SendRecord = { draftId: draft.id, sentAt: new Date(sentAt).toISOString(), recordedBy: ctx.memberId, recordedAt: now, channel: 'own-mailbox' };
  const withSend = { ...lead, sends: [...lead.sends, send] };
  return advance(withSend, 'contacted', { evidence: { kind: 'send', id: draft.id }, by: ctx.memberId, at: now });
}

/** An opt-out or a hard bounce: the email goes on the blocklist for good and the lead is blocked, from any stage. */
export function optOut(lead: Lead, blocklist: Blocklist, meta: { by: string; at: IsoTime }): { lead: Lead; blocklist: Blocklist } {
  const blocked = lead.status === 'blocked' ? lead
    : moveLead(lead, 'blocked', { evidence: { kind: 'opt-out', id: lead.email ?? lead.emailDomain ?? lead.id }, by: meta.by, at: meta.at });
  return { lead: blocked, blocklist: lead.email ? addToBlocklist(blocklist, lead.email) : blocklist };
}

// ---------------------------------------------------------------------------
// Leads on the pipeline (Ink v2 wave 4, package 4E1)
// ---------------------------------------------------------------------------

/** A lead as a pipeline card reads it: its stage, whether it is blocked (a flag, never a stage), its moves and sends. */
export type LeadAsCard = { stage: PipelineStage; blocked: boolean; history: StageMove[]; sends: SendRecord[]; unsentDrafts: number };
const CARD_STAGE: Readonly<Record<Exclude<LeadStage, 'blocked'>, PipelineStage>> = Object.freeze({
  new: 'found', drafted: 'asked', contacted: 'asked', replied: 'talking', won: 'won', lost: 'lost',
});
const MAPPED_EVIDENCE: Readonly<Record<Exclude<StageEvidence['kind'], 'opt-out'>, Pick<StageMove['evidence'], 'kind' | 'line'>>> = Object.freeze({
  draft: { kind: 'lead', line: 'An email was drafted in your lead list.' },
  send: { kind: 'send', line: 'You sent the email from your own mailbox.' },
  reply: { kind: 'reply', line: 'They replied, as your lead list records.' },
  outcome: { kind: 'owner', line: 'Closed in your lead list.' },
});

/** Where a lead was found, for a card: the page's host and path ('directory.example/pune/cafes'). */
export function leadWhere(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    return `${url.hostname}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return 'a web page';
  }
}

/**
 * Maps a lead onto the pipeline, honestly: new is Found; drafted and contacted are Asked; replied is Talking; won and
 * lost stay as they are. Blocked stays a flag on the stage the lead had reached. Every lead move that changes the
 * card's stage keeps its time, its author and what it rested on; a draft followed by its send stays one move to Asked,
 * with the send kept as a send. A lead stored before moves were kept reads its stage with a line that says so.
 */
export function leadToOpportunity(lead: Lead): LeadAsCard {
  const moves = lead.moves ?? [];
  const blockMove = moves.find(move => move.to === 'blocked');
  const reached: LeadStage = lead.status !== 'blocked' ? lead.status : blockMove ? blockMove.from : 'new';
  const stage = CARD_STAGE[reached === 'blocked' ? 'new' : reached];
  const history: StageMove[] = [{ from: null, to: 'found', at: lead.addedAt, by: lead.addedBy, evidence: { kind: 'lead', id: lead.id, line: `Found on ${leadWhere(lead.sourceUrl)}` } }];
  let current: PipelineStage = 'found';
  for (const move of moves) {
    if (move.to === 'blocked' || move.from === 'blocked' || move.evidence.kind === 'opt-out') continue;
    const to = CARD_STAGE[move.to];
    if (to === current) continue;
    history.push({ from: current, to, at: move.at, by: move.by, evidence: { ...MAPPED_EVIDENCE[move.evidence.kind], id: move.evidence.id } });
    current = to;
  }
  if (current !== stage) {
    const at = lead.sends.length ? lead.sends[lead.sends.length - 1].sentAt : lead.addedAt;
    history.push({ from: current, to: stage, at, by: lead.addedBy, evidence: { kind: 'lead', id: lead.id, line: 'Stage from your lead list; when it changed was not kept.' } });
  }
  const sentIds = new Set(lead.sends.map(send => send.draftId));
  return { stage, blocked: lead.status === 'blocked', history, sends: [...lead.sends], unsentDrafts: lead.drafts.filter(draft => !sentIds.has(draft.id)).length };
}
