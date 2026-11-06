// Chausar daily prospect research. revenue-squad (MIT) and 10xconnect (no-licence, ideas only); no source copied.
import { check } from '../../../contracts.ts';
import { outreachFooter, withFooter } from '../../customers/leads.ts';
import { sequenceFor } from '../../network/followups.ts';
import type { FollowupSequence } from '../../contracts.ts';
import { dedupeProspects } from './dedupe.ts';
import type { Prospect } from './osm.ts';
export type OptIn = { kind: 'they-wrote-first' | 'opted-in'; at: string; source: string };
export type LeadNoteInput = { name: string; body: string; channel: 'email' | 'linkedin' | 'whatsapp' | 'sms' | 'phone'; warm: boolean; blocked: boolean; business: string; postalAddress: string; optIn: OptIn | null };
/** Creates a draft only. Cold SMS/calls and WhatsApp without a recorded permission are refused. */
export function draftLeadNote(input: LeadNoteInput): { text: string; mode: 'handoff' | 'copy-and-open' } {
  check(!input.blocked, 'OUTREACH_BLOCKED', 'This person asked not to be contacted.');
  check(['email', 'linkedin', 'whatsapp'].includes(input.channel), 'COLD_CHANNEL_REFUSED', 'Chausar never drafts promotional calls or SMS for cold leads.');
  if (input.channel === 'whatsapp') check(input.optIn && ['they-wrote-first', 'opted-in'].includes(input.optIn.kind) && typeof input.optIn.source === 'string' && input.optIn.source.trim() && Number.isFinite(Date.parse(input.optIn.at)), 'WHATSAPP_CONSENT_REQUIRED', 'Record that they wrote first or opted in before a WhatsApp draft.');
  check(typeof input.body === 'string' && input.body.trim() && input.body.length <= 5000, 'INVALID_VENTURE_REQUEST', 'Write a short outreach draft.');
  const channel = input.channel as 'email' | 'linkedin' | 'whatsapp';
  const footer = outreachFooter({ channel, kind: input.warm ? 'follow-up' : 'cold-email', band: input.warm ? 'know' : 'cold', business: { name: input.business, postalAddress: input.postalAddress } });
  return { text: withFooter(input.body, footer), mode: channel === 'linkedin' ? 'copy-and-open' : 'handoff' };
}
export type FollowupRow = { id: string; name: string; due: string };
export type DailyInput = { city: string; vertical: string; count?: number; ownOffer: string; postalAddress: string; existing: Prospect[]; followups: FollowupRow[] };
export type DailyPorts = { source(count: number): Promise<Prospect[]>; enrich(url: string): Promise<{ emails: string[]; pages: string[] }>; allowed(row: Prospect): Promise<boolean>; verify(email: string): Promise<boolean> };
export type DailyReport = { prospects: Prospect[]; drafts: { sourceUrl: string; email: string; text: string; mode: 'handoff' | 'copy-and-open' }[]; foundRate: string; followups: FollowupRow[]; outsideWrites: never[] };
/** One bounded, explicitly started run. Produces data and drafts; it has no sending or scheduling port. */
export async function buildDailyRun(input: DailyInput, ports: DailyPorts): Promise<DailyReport> {
  const count = input.count ?? 10;
  check(Number.isInteger(count) && count >= 1 && count <= 50, 'INVALID_VENTURE_REQUEST', 'Choose a daily count from one to fifty.');
  check(typeof input.city === 'string' && input.city.trim() && typeof input.vertical === 'string' && input.vertical.trim() && typeof input.ownOffer === 'string' && input.ownOffer.trim(), 'INVALID_VENTURE_REQUEST', 'Name the city, business kind and your own offer.');
  const known = dedupeProspects(input.existing);
  const source = await ports.source(count);
  const all = dedupeProspects([...known, ...source]);
  const prospects: Prospect[] = [], drafts: DailyReport['drafts'] = [];
  let found = 0;
  for (const row of all.slice(known.length)) {
    if (prospects.length >= count) break;
    if (!(await ports.allowed(row))) continue;
    let enriched: { emails: string[]; pages: string[] } = { emails: [], pages: [] };
    if (row.website) {
      try { enriched = await ports.enrich(row.website); } catch { /* unavailable or forbidden pages are never guessed */ }
    }
    const prospect = { ...row, emails: enriched.emails };
    prospects.push(prospect);
    if (enriched.emails.length) found += 1;
    for (const email of enriched.emails.slice(0, 1)) {
      if (!(await ports.verify(email)) || !(await ports.allowed({ ...prospect, emails: [email] }))) continue;
      const note = draftLeadNote({ name: row.name, body: `Hello ${row.name}, I found your business through its public listing. I offer ${input.ownOffer}. Would it be useful to hear more?`, channel: 'email', warm: false, blocked: false, business: 'Your business', postalAddress: input.postalAddress, optIn: null });
      drafts.push({ sourceUrl: row.sourceUrl, email, ...note });
    }
  }
  return { prospects, drafts, foundRate: `emails found for ${found} of ${prospects.length}`, followups: structuredClone(input.followups), outsideWrites: [] };
}
/** Cold-email offer configuration seam. */
export function coldEmailMonthPlan(settings: { weekdays: number[]; sendTime: string }, at: string): { prospectLimit: number; sequence: FollowupSequence } { return { prospectLimit: 50, sequence: sequenceFor('cold-email', 'own-mailbox', settings, at) }; }
