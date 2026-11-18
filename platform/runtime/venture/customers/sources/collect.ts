// Chausar lead sources, shared by every business: one bounded pass from a source's rows to the prospects worth
// keeping. New ones only (dedupe.ts against what the business already has), only those the owner may write to (the
// caller's `allowed` holds the blocklist and the never-contact list), each read for a contact email on its own site
// (enrich.ts, which obeys robots). A site that cannot be read gives no email; none is ever guessed. It has no port
// that sends, posts or schedules. Finding customers (customers/find-run.ts) and the lead generation playbook's daily
// research (playbooks/lead-generation/daily-run.ts) both run this.
import { check } from '../../../contracts.ts';
import { dedupeProspects } from './dedupe.ts';
import type { Prospect } from './prospect.ts';

export type CollectPorts = {
  /** The source's rows for this many wanted prospects. It may return more; only `count` are kept. */
  source(count: number): Promise<Prospect[]>;
  /** The business's own site, read politely for contact emails. A throw means no email, never a guess. */
  enrich(url: string): Promise<{ emails: string[]; pages: string[] }>;
  /** Whether the owner may write to this business, or to this one address of it (row.emails holds just that one). */
  allowed(row: Prospect): Promise<boolean>;
};
export type Collected = { prospects: Prospect[]; withEmail: number; skipped: { known: number; blocked: number } };

/** Collects up to `count` new prospects. Rows the business already has, and rows it may not write to, are counted and left out. */
export async function collectProspects(input: { count: number; existing: readonly Prospect[] }, ports: CollectPorts): Promise<Collected> {
  check(Number.isInteger(input.count) && input.count >= 1 && input.count <= 50, 'INVALID_VENTURE_REQUEST', 'Choose a count from one to fifty.');
  const known = dedupeProspects(input.existing);
  const found = await ports.source(input.count);
  const fresh = dedupeProspects([...known, ...found]).slice(known.length);
  const prospects: Prospect[] = [];
  let withEmail = 0, blocked = 0;
  for (const row of fresh) {
    if (prospects.length >= input.count) break;
    if (!(await ports.allowed(row))) { blocked += 1; continue; }
    let emails: string[] = row.emails ?? [];
    if (row.website) {
      try { emails = [...new Set([...emails, ...(await ports.enrich(row.website)).emails])]; } catch { /* unavailable or forbidden pages are never guessed */ }
    }
    const kept: string[] = [];
    for (const email of emails) if (await ports.allowed({ ...row, emails: [email] })) kept.push(email);
    prospects.push({ ...row, emails: kept });
    if (kept.length) withEmail += 1;
  }
  return { prospects, withEmail, skipped: { known: found.length - fresh.length, blocked } };
}
