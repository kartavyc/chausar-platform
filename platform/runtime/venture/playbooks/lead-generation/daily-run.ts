// Chausar daily prospect research. revenue-squad (MIT) and 10xconnect (no-licence, ideas only); no source copied.
import { check } from '../../../contracts.ts';
import { outreachFooter, withFooter } from '../../customers/leads.ts';
import { sequenceFor } from '../../network/followups.ts';
import type { FollowupSequence } from '../../contracts.ts';
import { collectProspects } from '../../customers/sources/collect.ts';
import type { Prospect } from '../../customers/sources/prospect.ts';
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
  // The shared pass every business's lead finding runs (customers/sources/collect.ts): new, allowed, read politely.
  const { prospects, withEmail: found } = await collectProspects({ count, existing: input.existing }, ports);
  const drafts: DailyReport['drafts'] = [];
  for (const prospect of prospects) {
    for (const email of (prospect.emails ?? []).slice(0, 1)) {
      if (!(await ports.verify(email))) continue;
      const note = draftLeadNote({ name: prospect.name, body: `Hello ${prospect.name}, I found your business through its public listing. I offer ${input.ownOffer}. Would it be useful to hear more?`, channel: 'email', warm: false, blocked: false, business: 'Your business', postalAddress: input.postalAddress, optIn: null });
      drafts.push({ sourceUrl: prospect.sourceUrl, email, ...note });
    }
  }
  return { prospects, drafts, foundRate: `emails found for ${found} of ${prospects.length}`, followups: structuredClone(input.followups), outsideWrites: [] };
}
/** Cold-email offer configuration seam. */
export function coldEmailMonthPlan(settings: { weekdays: number[]; sendTime: string }, at: string): { prospectLimit: number; sequence: FollowupSequence } { return { prospectLimit: 50, sequence: sequenceFor('cold-email', 'own-mailbox', settings, at) }; }
