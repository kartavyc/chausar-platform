// Chausar venture launcher: the customer engine's lead rules as engine methods. venture.leads.add, venture.leads.list,
// venture.leads.draft, venture.leads.recordSend and venture.leads.block. leads.ts keeps the rules; this file keeps the records.
// - A lead needs the page it was found on, and its email is checked for a mail server when it is added.
// - Drafting checks the blocklist first, then the source, the verified email and the business postal address.
// - The postal address is the business's: only the owner sets it, inside the app. Agents draft with the stored one.
// - Agents only draft. Chausar never sends: the owner sends from their own mailbox and records the send in the app.
import { authorize, check, type Context } from '../../contracts.ts';
import type { LeadRecord, LeadSettingsRecord, LeadView, OutreachDraftView, VentureDeps } from '../contracts.ts';
import {
  exactPayload, identifier, isAppChannel, listRecords, readVenture, requireAppChannel, singleLine, ventureAction, type VentureTx,
} from '../records.ts';
import { addToBlocklist, createLead, draftOutreach, moveLead, onBlocklist, recordSend, verifyLeadEmail, type Blocklist, type Lead } from './leads.ts';
import { CLOSED_STAGES, cardsOf, ensureLeadCard } from '../network/pipeline.ts';
import { localDayAt } from '../local-day.ts';
import { normalLinkedIn, normalPhone } from '../network/text.ts';
import { refuseNeverContact } from '../network/outreach-checks.ts';

/** A stored lead as the screens and the rules read it. A lead stored before stages kept their moves reads with none. */
function leadOf(record: LeadRecord): LeadView {
  const { kind: _kind, ventureId: _venture, memberId: _member, epoch: _epoch, at: _at, ...rest } = record;
  return { ...rest, moves: (rest as Partial<LeadView>).moves ?? [], id: record.id };
}

function recordOf(tx: VentureTx, lead: Lead, existing?: LeadRecord): LeadRecord {
  const { id: _id, ...fields } = lead;
  return existing ? { ...existing, ...fields } : { ...tx.base('venture-lead'), ...fields };
}

function settingsOf(tx: VentureTx): LeadSettingsRecord | undefined {
  return tx.list('venture-lead-settings')[0];
}

function blocklistOf(settings: LeadSettingsRecord | undefined): Blocklist {
  return { emails: new Set(settings?.blockedEmails ?? []), domains: new Set(settings?.blockedDomains ?? []), handles: new Set(settings?.blockedHandles ?? []) };
}

function findLead(tx: VentureTx, leadId: string): LeadRecord {
  const lead = tx.find('venture-lead', leadId);
  check(lead, 'LEADS_NOT_FOUND', 'This lead is not in this business.');
  return lead;
}

/** venture.leads.add { name, company?, email?, sourceUrl } (prepare): a new lead, its email checked for a mail server. */
export async function leadsAdd(deps: VentureDeps, ctx: Context, payload: unknown): Promise<LeadView> {
  const body = exactPayload(payload, ['name', 'company', 'email', 'sourceUrl'], ['name', 'sourceUrl']);
  const now = deps.clock().toISOString();
  let lead = createLead({ id: 'pending', name: body.name, company: body.company, email: body.email, sourceUrl: body.sourceUrl }, { by: ctx.memberId, at: now });
  authorize(deps.store, ctx, 'prepare');
  if (lead.email) lead = await verifyLeadEmail(lead, { ...(deps.mx ? { resolver: deps.mx } : {}), now: deps.clock().toISOString() });
  const checked = lead;
  return ventureAction(deps, ctx, 'prepare', 'leads.add', tx => leadOf(tx.put(recordOf(tx, checked))));
}

/** venture.leads.list {} (read): every lead of this business, newest first. */
export async function leadsList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ leads: LeadView[] }> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readVenture(deps, ctx);
  return { leads: listRecords(state, 'venture-lead', venture.id).reverse().map(leadOf) };
}

/**
 * venture.leads.draft { leadId, subject, body, postalAddress? } (prepare): one outreach draft for the owner to send.
 * A postal address in the request is the owner's, from inside the app, and is kept for later drafts.
 */
export async function leadsDraft(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ lead: LeadView; draft: OutreachDraftView }> {
  const body = exactPayload(payload, ['leadId', 'subject', 'body', 'postalAddress'], ['leadId', 'subject', 'body']);
  const leadId = identifier(body.leadId, 'leadId');
  const owner = isAppChannel(ctx);
  const address = body.postalAddress === undefined ? undefined : singleLine(body.postalAddress, 'The postal address', { min: 5, max: 300 });
  check(address === undefined || owner, 'APP_APPROVAL_REQUIRED', 'Set your business postal address inside the Chausar app.');
  // 4J6 (C10): an address the never-contact list of the businesses on this computer holds gets no draft.
  const listed = listRecords(deps.store.read(), 'venture-lead').find(item => item.id === leadId);
  if (listed) await refuseNeverContact(deps, [listed.email], listed.name);
  return ventureAction(deps, ctx, 'prepare', 'leads.draft', tx => {
    const stored = findLead(tx, leadId);
    let settings = settingsOf(tx);
    const postalAddress = address ?? settings?.postalAddress ?? '';
    const made = draftOutreach(leadOf(stored), {
      subject: body.subject as string, body: body.body as string, by: owner ? 'owner' : 'agent',
      business: { name: tx.venture!.workingName, postalAddress }, blocklist: blocklistOf(settings), at: tx.now,
    });
    if (address !== undefined && address !== settings?.postalAddress) {
      settings = settings
        ? tx.replace<LeadSettingsRecord>({ ...settings, postalAddress: address })
        : tx.put<LeadSettingsRecord>({ ...tx.base('venture-lead-settings'), postalAddress: address, blockedEmails: [], blockedDomains: [] });
    }
    const lead = leadOf(tx.replace(recordOf(tx, made.lead, stored)));
    return { lead, draft: made.draft };
  });
}

/** venture.leads.recordSend { leadId, draftId, sentAt } (approve, inside the app): the owner says they sent one draft themselves. */
export async function leadsRecordSend(deps: VentureDeps, ctx: Context, payload: unknown): Promise<LeadView> {
  requireAppChannel(ctx, 'venture.leads.recordSend');
  const body = exactPayload(payload, ['leadId', 'draftId', 'sentAt'], ['leadId', 'draftId', 'sentAt']);
  const leadId = identifier(body.leadId, 'leadId');
  const draftId = identifier(body.draftId, 'draftId');
  check(typeof body.sentAt === 'string' && body.sentAt.length <= 40, 'INVALID_VENTURE_REQUEST', 'Send the time you sent it.');
  const sentAt = body.sentAt;
  return ventureAction(deps, ctx, 'approve', 'leads.recordSend', tx => {
    const stored = findLead(tx, leadId);
    const lead = recordSend(leadOf(stored), { draftId, sentAt }, ctx, tx.now);
    const view = leadOf(tx.replace(recordOf(tx, lead, stored)));
    ensureLeadCard(tx, leadId); // Ink v2 wave 4 (4E1): the lead's pipeline card is stored with this day's follow-up sequence
    return view;
  });
}

const EMAIL_ENTRY = /^[^\s@]{1,64}@[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/;
const DOMAIN_ENTRY = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/;

const BLOCK_ENTRY_LINE = 'Type one email address, a domain, a phone number or a LinkedIn profile address, like name@example.com, example.com, +91 98765 43210 or linkedin.com/in/name.';

/**
 * The entry as the blocklist keeps it: an email or a domain in lower case; a phone in E.164 (Ink v2 wave 4, 4E2: a
 * "stop" on WhatsApp), read in the business's country when it has no plus; or a LinkedIn profile address in the
 * network's one spelling (a "stop" on LinkedIn). Null for anything else.
 */
function blockEntry(value: string, countryCode: string | null): string | null {
  const text = value.trim();
  const lower = text.toLowerCase().replace(/^@/, '');
  if (EMAIL_ENTRY.test(lower) || DOMAIN_ENTRY.test(lower)) return lower;
  if (/linkedin\.com/i.test(text)) return normalLinkedIn(text);
  return /^\+?[\d\s().-]{7,24}$/.test(text) ? normalPhone(text, countryCode ?? '') : null;
}

/**
 * venture.leads.block { value } (approve, inside the app): puts an email, a whole domain, a phone or a LinkedIn profile
 * address on the blocklist for good. Drafting checks it first, so no agent drafts to anyone on it again. Every lead it
 * covers moves to blocked, with the entry as the move's evidence. Answers with every blocked entry, emails first.
 */
export async function leadsBlock(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ blocked: string[] }> {
  requireAppChannel(ctx, 'venture.leads.block');
  const body = exactPayload(payload, ['value'], ['value']);
  check(typeof body.value === 'string' && body.value.length <= 254, 'INVALID_VENTURE_REQUEST', BLOCK_ENTRY_LINE);
  const value = body.value;
  return ventureAction(deps, ctx, 'approve', 'leads.block', tx => {
    const entry = blockEntry(value, tx.venture?.country?.code ?? null);
    check(entry, 'INVALID_VENTURE_REQUEST', BLOCK_ENTRY_LINE);
    return { blocked: blockEntries(tx, [entry], ctx.memberId).blocked };
  });
}

/**
 * The one way an entry goes on the blocklist (venture.leads.block, and 4E3's opt-outs and bounces): each entry (an
 * email, a domain, a phone or a LinkedIn profile address, read as blockEntry reads it; anything else is skipped) is
 * added for good, every lead it covers moves to blocked with the entry as the move's evidence, and every open pipeline
 * card it now blocks is announced (pipeline.changed with its id, then queue.changed), as a blocked phone or LinkedIn
 * page always is (4E2). Answers the entries that were new and every blocked entry, emails first.
 */
export function blockEntries(tx: VentureTx, values: readonly string[], by: string): { added: string[]; blocked: string[] } {
  const countryCode = tx.venture?.country?.code ?? null;
  const entries = [...new Set(values.map(value => blockEntry(value, countryCode)).filter((entry): entry is string => !!entry))];
  const settings = settingsOf(tx);
  const before = blocklistOf(settings);
  const known = (entry: string) => before.emails.has(entry) || before.domains.has(entry) || (before.handles?.has(entry) ?? false);
  const added = entries.filter(entry => !known(entry));
  let next: Blocklist = before;
  for (const entry of added) next = addToBlocklist(next, entry);
  const blockedEmails = [...next.emails].sort(), blockedDomains = [...next.domains].sort(), blockedHandles = [...(next.handles ?? [])].sort();
  if (!added.length) return { added, blocked: [...blockedEmails, ...blockedDomains, ...blockedHandles] };
  const venture = tx.venture?.country ? tx.venture : null;
  const today = venture ? localDayAt(tx.now, venture.country) : null;
  const wasBlocked = new Set(venture ? cardsOf(tx.state, venture, today!).filter(card => card.blocked).map(card => card.id) : []);
  const handles = blockedHandles.length ? { blockedHandles } : {};
  if (settings) tx.replace<LeadSettingsRecord>({ ...settings, blockedEmails, blockedDomains, ...handles });
  else tx.put<LeadSettingsRecord>({ ...tx.base('venture-lead-settings'), postalAddress: null, blockedEmails, blockedDomains, ...handles });
  for (const stored of tx.list('venture-lead')) {
    const lead = leadOf(stored);
    if (lead.status === 'blocked' || !onBlocklist(lead, next)) continue;
    const entry = added.find(item => onBlocklist(lead, addToBlocklist(before, item))) ?? added[0];
    tx.replace(recordOf(tx, moveLead(lead, 'blocked', { evidence: { kind: 'opt-out', id: entry }, by, at: tx.now }), stored));
  }
  const nowBlocked = venture ? cardsOf(tx.state, venture, today!).filter(card => card.blocked && !CLOSED_STAGES.has(card.stage) && !wasBlocked.has(card.id)) : [];
  for (const card of nowBlocked) tx.emit('pipeline.changed', { id: card.id });
  const handle = added.some(entry => blockedHandles.includes(entry));
  if (handle) tx.emit('pipeline.changed', {});
  if (nowBlocked.length || handle) tx.emit('queue.changed', {});
  return { added, blocked: [...blockedEmails, ...blockedDomains, ...blockedHandles] };
}
