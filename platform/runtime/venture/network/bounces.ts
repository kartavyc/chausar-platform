// Chausar venture launcher, network (Ink v2 wave 4, package 4E3, catalogue C10): delivery reports read in code. A
// report (multipart/report; report-type=delivery-status, RFC 3464) names each address it is about with an action and a
// status: a 5.x.x failure means the address bounced, and it goes on the blocklist for good; 5.1.2 (no such domain) and
// 5.4.4 (no route to it) mean the domain may be gone, so the address is blocked and the owner is asked about the whole
// domain; a 4.x.x delay holds the address for 90 days, so no follow-up goes to it before then. A report counts only for
// an address Chausar wrote to in the last 30 days (inbound.ts); any other may be forged, and nothing happens.
import type { State } from '../../contracts.ts';
import type { InboundRecord, IsoDate, VentureRecord } from '../contracts.ts';
import { listRecords } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { addDays } from './followups.ts';
import { decodeBytes, readHeaders, headerOf, type ContentType, type MimePart } from './mail-text.ts';
import { normalEmail } from './text.ts';

/** How long a 4.x.x delay holds an address. Chausar's own choice, stated. */
export const SUPPRESS_DAYS = 90;
/** Days an automatic reply pushes the next follow-up out, from its own day. Chausar's own choice, stated. */
export const AUTO_REPLY_PUSH_DAYS = 7;
/** The statuses that mean the domain itself cannot take mail. */
const DOMAIN_FAILURES: ReadonlySet<string> = new Set(['5.1.2', '5.4.4']);

export type BounceScope = 'address' | 'domain' | 'suppress';
export type ReportedRecipient = { address: string; status: string; action: string };

/** Whether a message is a delivery report, by its top Content-Type. */
export function isDeliveryReport(type: ContentType): boolean {
  return type.type === 'multipart/report' && (type.params['report-type'] ?? '').toLowerCase() === 'delivery-status';
}

/**
 * The addresses a delivery report is about, each with its action and status, from its message/delivery-status part.
 * A report with no such part, or none that reads, answers an empty list.
 */
export function reportedRecipients(parts: MimePart[]): ReportedRecipient[] {
  const part = parts.find(item => item.type === 'message/delivery-status' || item.type === 'message/global-delivery-status');
  if (!part) return [];
  const text = decodeBytes(part.body, part.params.charset ?? 'utf-8').replace(/\r\n?/g, '\n');
  const out: ReportedRecipient[] = [];
  for (const block of text.split(/\n\s*\n/).slice(1)) {
    const fields = readHeaders(`${block.trim()}\n\n`);
    const recipient = headerOf(fields, 'final-recipient') ?? headerOf(fields, 'original-recipient');
    const address = normalEmail(recipient?.replace(/^[^;]*;\s*/, '') ?? null);
    const status = /^([245])\.(\d{1,3})\.(\d{1,3})/.exec((headerOf(fields, 'status') ?? '').trim());
    if (!address || !status) continue;
    out.push({ address, status: `${status[1]}.${Number(status[2])}.${Number(status[3])}`, action: (headerOf(fields, 'action') ?? '').trim().toLowerCase() });
  }
  return out;
}

/** What a status means for the address: bounced, the domain gone, held for a while, or nothing (delivered). */
export function bounceScope(status: string): BounceScope | null {
  if (DOMAIN_FAILURES.has(status)) return 'domain';
  if (status.startsWith('5.')) return 'address';
  if (status.startsWith('4.')) return 'suppress';
  return null;
}

/** The day a held address may be written to again: SUPPRESS_DAYS after the report. */
export const suppressUntil = (day: IsoDate): IsoDate => addDays(day, SUPPRESS_DAYS);

/**
 * The day an address is held until by a 4.x.x report, or null when none holds it on that day. 4E2's send governor and
 * the follow-ups read it, so nothing goes to a held address before then.
 */
export function suppressedUntil(state: State, ventureId: string, address: string, today: IsoDate): IsoDate | null {
  const email = address.trim().toLowerCase();
  let until: IsoDate | null = null;
  for (const record of listRecords(state, 'venture-inbound', ventureId) as InboundRecord[]) {
    for (const bounce of record.bounces ?? []) {
      if (bounce.scope !== 'suppress' || bounce.address !== email || !bounce.until || bounce.until <= today) continue;
      if (!until || bounce.until > until) until = bounce.until;
    }
  }
  return until;
}

// ---------------------------------------------------------------------------
// The holds an automatic reply or a delivery delay put on a card's follow-ups (read by pipeline.ts)
// ---------------------------------------------------------------------------

/**
 * The day before which no follow-up goes to each card: a week after an automatic reply matched to it, and the end of a
 * 4.x.x delay on one of its addresses. By card id (a lead's id for a lead's card).
 */
export function followupHolds(records: readonly InboundRecord[], venture: Pick<VentureRecord, 'country'>): { byCard: Map<string, IsoDate>; byAddress: Map<string, IsoDate> } {
  const byCard = new Map<string, IsoDate>(), byAddress = new Map<string, IsoDate>();
  const later = (map: Map<string, IsoDate>, key: string, day: IsoDate) => { const old = map.get(key); if (!old || day > old) map.set(key, day); };
  for (const record of records) {
    if (record.triage === 'auto-reply' && record.matched) later(byCard, record.matched.opportunityId, addDays(localDayAt(record.date, venture.country), AUTO_REPLY_PUSH_DAYS));
    for (const bounce of record.bounces ?? []) if (bounce.scope === 'suppress' && bounce.until) later(byAddress, bounce.address, bounce.until);
  }
  return { byCard, byAddress };
}

