// Chausar lead sources, shared by every business: one possible customer as a source returned it, and the two pure
// steps every source's rows pass through, collecting (collect.ts) and ranking. A prospect always carries the page it
// was found on and that source's licence. An email is only ever one a page showed; none is guessed or built.
// Pure: no store, no network.

/** The attribution and licence every OpenStreetMap listing carries. Here, with no engine import, so the app's fake engine says the same. */
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors, ODbL';

/** One possible customer. osmId and placeId are the source's own stable ids, when it has them. */
export type Prospect = { osmId: string | null; placeId?: string | null; name: string; address: string; website: string | null; sourceUrl: string; licence: string; emails?: string[] };

const hostOf = (url: string | null): string => {
  try { return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, '') : ''; } catch { return ''; }
};
/** Whether an email is at the business's own site (hello@lotus.example for lotus.example), not a shared mailbox. */
export function ownSiteEmail(prospect: Pick<Prospect, 'website'>, email: string): boolean {
  const host = hostOf(prospect.website), domain = email.split('@')[1]?.toLowerCase() ?? '';
  return host !== '' && (domain === host || domain.endsWith(`.${host}`));
}

/**
 * How checkable a prospect is, highest first: an email at its own site, any email a page showed, a website alone,
 * then a listing with an address, then the bare listing. Nothing here judges the business itself.
 */
export function prospectRank(prospect: Prospect): number {
  const emails = prospect.emails ?? [];
  if (emails.some(email => ownSiteEmail(prospect, email))) return 4;
  if (emails.length) return 3;
  if (prospect.website) return 2;
  return prospect.address.trim() ? 1 : 0;
}

/** The most checkable first; rows of the same rank keep the order the source gave them. The input is left as it was. */
export function rankProspects(rows: readonly Prospect[]): Prospect[] {
  return rows.map((row, index) => ({ row, index, rank: prospectRank(row) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index).map(item => structuredClone(item.row));
}
