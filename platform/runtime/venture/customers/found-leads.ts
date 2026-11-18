// Chausar lead sources, shared by every business: the three steps between a source's prospects and the business's own
// lead list, the same for finding customers (find-run.ts) and the lead generation playbook's desk.
// - knownProspects: what the business already has from a source, so a search never adds it twice.
// - contactAllowed: the blocklist first, then the never-contact list of the businesses on this computer (4J6, C10).
// - landProspect: the prospect becomes a lead through the lead rules (leads.ts: a source page is required, an email
//   counts only once a mail server answered) with its source record beside it: the page, the licence, the search.
// Nothing here sends anything, and a lead never gets an email its source did not show.
import type { Context, State } from '../../contracts.ts';
import type { LeadSourceRecord, LeadView, VentureDeps } from '../contracts.ts';
import { listRecords, ventureAction } from '../records.ts';
import { refuseNeverContact } from '../network/outreach-checks.ts';
import { leadsAdd } from './lead-methods.ts';
import { createLead, isBlocked, onBlocklist, type Blocklist } from './leads.ts';
import type { Prospect } from './sources/prospect.ts';
import type { LeadSourceKind } from './sources/records.ts';

/** The prospects the business already holds as leads, by each one's source id and own site. Names are not kept here. */
export function knownProspects(state: State, ventureId: string): Prospect[] {
  return listRecords(state, 'venture-lead-source', ventureId).filter(source => source.leadId)
    .map(source => ({ osmId: source.source === 'osm' ? source.sourceId : null, ...(source.source === 'connected' && source.sourceId ? { placeId: source.sourceId } : {}),
      name: '', address: '', website: source.domain ? `https://${source.domain}` : null, sourceUrl: source.url ?? '', licence: source.licence }));
}

/** Whether the owner may write to this business: not on the blocklist, and not on this computer's never-contact list. */
export async function contactAllowed(deps: VentureDeps, ctx: Context, blocklist: Blocklist, row: Prospect): Promise<boolean> {
  try {
    const candidate = createLead({ name: row.name || 'Business', sourceUrl: row.sourceUrl, email: row.emails?.[0] ?? undefined }, { by: ctx.memberId, at: deps.clock().toISOString() });
    if (onBlocklist(candidate, blocklist)) return false;
    // The business's own site, with or without www: a blocked domain keeps out everyone at it.
    let site = '';
    try { site = row.website ? new URL(row.website).hostname.toLowerCase().replace(/^www\./, '') : ''; } catch { site = ''; }
    if (site && isBlocked(blocklist, site)) return false;
    await refuseNeverContact(deps, [candidate.email], row.name);
    return true;
  } catch {
    return false; // a row the lead rules would refuse (no usable source page, a broken address) is never added
  }
}

export type LandInput = { prospect: Prospect; source: Extract<LeadSourceKind, 'osm' | 'connected'>; searchId?: string; server?: string; emit?: 'desk.changed' | 'pipeline.changed' };

/** One prospect into the lead list, with where it came from. Returns the lead as the lead rules made it. */
export async function landProspect(deps: VentureDeps, ctx: Context, input: LandInput): Promise<LeadView> {
  const { prospect } = input;
  const lead = await leadsAdd(deps, ctx, { name: prospect.name, company: prospect.name, sourceUrl: prospect.sourceUrl, email: prospect.emails?.[0] ?? null });
  let domain: string | null = null;
  try { domain = prospect.website ? new URL(prospect.website).hostname : null; } catch { domain = null; }
  await ventureAction(deps, ctx, 'prepare', 'leads.source', tx => {
    tx.put<LeadSourceRecord>({
      ...tx.base('venture-lead-source'), source: input.source, url: prospect.sourceUrl, licence: prospect.licence, fetchedAt: tx.now, leadId: lead.id, personId: null, importId: null,
      sourceId: input.source === 'osm' ? prospect.osmId : prospect.placeId ?? null, domain,
      ...(input.searchId ? { searchId: input.searchId } : {}), ...(input.server ? { server: input.server } : {}),
    });
    if (input.emit === 'desk.changed') tx.emit('desk.changed', { playbook: 'lead-generation' });
    else if (input.emit === 'pipeline.changed') tx.emit('pipeline.changed', {});
  });
  return lead;
}
