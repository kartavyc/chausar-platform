// Chausar venture launcher: the customer engine's lead rules as engine methods. venture.leads.add, venture.leads.list,
// venture.leads.draft and venture.leads.recordSend. leads.ts keeps the rules; this file keeps the records.
// - A lead needs the page it was found on, and its email is checked for a mail server when it is added.
// - Drafting checks the blocklist first, then the source, the verified email and the business postal address.
// - The postal address is the business's: only the owner sets it, inside the app. Agents draft with the stored one.
// - Agents only draft. Chausar never sends: the owner sends from their own mailbox and records the send in the app.
import { authorize, check, type Context } from '../../contracts.ts';
import type { LeadRecord, LeadSettingsRecord, LeadView, OutreachDraftView, VentureDeps } from '../contracts.ts';
import {
  exactPayload, identifier, isAppChannel, listRecords, readVenture, requireAppChannel, singleLine, ventureAction, type VentureTx,
} from '../records.ts';
import { createLead, draftOutreach, recordSend, verifyLeadEmail, type Blocklist, type Lead } from './leads.ts';

function leadOf(record: LeadRecord): LeadView {
  const { kind: _kind, ventureId: _venture, memberId: _member, epoch: _epoch, at: _at, ...rest } = record;
  return { ...rest, id: record.id };
}

function recordOf(tx: VentureTx, lead: Lead, existing?: LeadRecord): LeadRecord {
  const { id: _id, ...fields } = lead;
  return existing ? { ...existing, ...fields } : { ...tx.base('venture-lead'), ...fields };
}

function settingsOf(tx: VentureTx): LeadSettingsRecord | undefined {
  return tx.list('venture-lead-settings')[0];
}

function blocklistOf(settings: LeadSettingsRecord | undefined): Blocklist {
  return { emails: new Set(settings?.blockedEmails ?? []), domains: new Set(settings?.blockedDomains ?? []) };
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
    return leadOf(tx.replace(recordOf(tx, lead, stored)));
  });
}
