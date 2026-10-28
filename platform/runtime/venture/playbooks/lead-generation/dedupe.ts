// Chausar deterministic prospect identity. Inspired by revenue-squad (MIT); no code copied.
import type { Prospect } from './osm.ts';
const norm = (text: string) => text.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Merges stable source identities, then business domains, then exact normalised name and address. */
export function dedupeProspects(rows: readonly Prospect[]): Prospect[] {
  const seen = new Set<string>(), kept: Prospect[] = [];
  for (const row of rows) {
    let domain = '';
    try { domain = row.website ? new URL(row.website).hostname.toLowerCase().replace(/^www\./, '') : ''; } catch { /* no domain evidence */ }
    const keys = [row.placeId ? `place:${row.placeId}` : '', row.osmId ? `osm:${row.osmId}` : '', domain ? `domain:${domain}` : '', norm(row.name) && norm(row.address) ? `name:${norm(row.name)}:${norm(row.address)}` : ''].filter(Boolean);
    const duplicate = keys.some(key => seen.has(key));
    keys.forEach(key => seen.add(key));
    if (!duplicate) kept.push(structuredClone(row));
  }
  return kept;
}
