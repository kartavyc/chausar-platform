// Chausar venture launcher: the customer engine's lead rules (package P2-connectors).
// - A lead needs the page it was seen on (its source URL). No source, no lead.
// - An email counts as verified only after an MX lookup finds a mail server. A failure, a null MX or a timeout is
//   "not verified", never "probably fine". The resolver is injectable; the real one is node:dns.
// - The blocklist is checked before any draft, ahead of every other rule. Opt-outs go on it for good.
// - Agents only draft. Nothing here sends: the owner sends from their own mailbox and records each real send in the app.
// - Every outreach draft ends with an unsubscribe line and the business postal address; without an address there is no
//   draft (LEADS_ADDRESS_MISSING). Cold email rules in many places ask for both.
// - A lead's stage moves forward only: new (found), drafted, contacted, replied, then won or lost. Won and lost are
//   terminal; blocked (an opt-out) can follow any stage and is never left. Every move keeps the evidence it rests on.
// The evidence-or-refuse, MX and blocklist rules follow naidx0/revenue-squad (MIT, Copyright (c) 2026 naidx0); rewritten here.
import { resolveMx } from 'node:dns/promises';
import { check, newId, type Context } from '../../contracts.ts';
import type { IsoTime } from '../contracts.ts';
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
export type Blocklist = { emails: ReadonlySet<string>; domains: ReadonlySet<string> };

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
  const failed = (line: string): Lead => ({ ...lead, emailCheck: { status: 'failed', at: options.now, line } });
  if (!lead.email || !lead.emailDomain) return failed('No email to check.');
  const resolver = options.resolver ?? resolveMx;
  const domain = lead.emailDomain;
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
  return { ...lead, emailCheck: { status: 'verified', at: options.now, line: `Mail servers found for ${domain}.` } };
}

/** One entry per line: a whole email or a bare domain. # starts a comment. */
export function parseBlocklist(text: string): Blocklist {
  const emails = new Set<string>(), domains = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const entry = raw.split('#', 1)[0].trim().toLowerCase();
    if (!entry) continue;
    (entry.includes('@') ? emails : domains).add(entry);
  }
  return { emails, domains };
}

export function isBlocked(blocklist: Blocklist, value: string | null): boolean {
  const entry = (value ?? '').trim().toLowerCase();
  if (!entry) return false;
  if (entry.includes('@')) return blocklist.emails.has(entry) || blocklist.domains.has(entry.split('@')[1]);
  return blocklist.domains.has(entry);
}

export function addToBlocklist(blocklist: Blocklist, value: string): Blocklist {
  const entry = value.trim().toLowerCase();
  if (!entry) return blocklist;
  const emails = new Set(blocklist.emails), domains = new Set(blocklist.domains);
  (entry.includes('@') ? emails : domains).add(entry);
  return { emails, domains };
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

/** Drafts one outreach email. Order: blocklist, source, verified email, postal address. Nothing is sent. */
export function draftOutreach(lead: Lead, input: DraftInput): { lead: Lead; draft: OutreachDraft } {
  check(!blocked(lead, input.blocklist), 'LEADS_BLOCKED', 'This person or their company asked not to be contacted, or is on your blocklist.');
  sourceUrlOf(lead.sourceUrl);
  check(lead.email && lead.emailCheck.status === 'verified', 'LEADS_EMAIL_UNVERIFIED', 'Check the email first. Only an email with a working mail server gets a draft.');
  const postalAddress = typeof input.business?.postalAddress === 'string' ? input.business.postalAddress.trim() : '';
  check(postalAddress.length >= 5, 'LEADS_ADDRESS_MISSING', 'Add your business postal address. Every outreach email carries it.');
  const businessName = oneLine(input.business.name, 'business name', 120, true)!;
  const subject = oneLine(input.subject, 'subject', 160, true)!;
  check(typeof input.body === 'string' && input.body.trim().length > 0 && input.body.length <= 5000, 'INVALID_VENTURE_REQUEST', 'Write the email body.');
  const unsubscribe = input.business.unsubscribeLine?.trim() || DEFAULT_UNSUBSCRIBE_LINE;
  const text = `${input.body.trim()}\n\n--\n${businessName}\n${postalAddress}\n${unsubscribe}`;
  const id = newId('outreach');
  const draft: OutreachDraft = {
    id, leadId: lead.id, to: lead.email, subject, text, footer: { businessName, postalAddress, unsubscribe }, sourceUrl: lead.sourceUrl,
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
