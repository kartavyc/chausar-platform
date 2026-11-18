// Chausar venture launcher: where a lead came from, the one place that rule and its words are written. The engine
// (customers/leads.ts) and the app's fake engine both read a new lead's source with leadSourceOf, so the two cannot
// drift.
// - Anything found on the web, by an agent, a search or a connected tool, needs the page it was seen on. No page, no
//   lead: that is what lets the owner check a lead before writing to it, and it is not loosened here.
// - A lead the owner adds themselves, inside the app, may instead say where it came from in the owner's own words
//   ("referred by Asha", "met at the trade fair"). Found on Windows, 16 Nov 2026: the field asks "Where you found
//   them" and took only a web address, so a referral could not be added at all. The words are kept as the owner's
//   statement and shown as theirs ("You said: ..."), never as something Chausar found.
// - Exactly one of the two, never neither, and a web address is never passed off as words.
// Pure: no store, no network and no Node imports.
import { check } from '../../portable.ts';

/** Every refusal about where a lead came from (LEADS_SOURCE_REQUIRED). */
export const LEAD_SOURCE_WORDS = Object.freeze({
  /** To anyone but the owner inside the app: the page rule for leads found on the web. */
  page: 'Add the web page where this lead was found.',
  /** To the owner inside the app, who may give either. */
  either: 'Say where you found them: a web page, like https://example.in/team, or your own words, like "referred by Asha".',
  pageAsWords: 'That is a web address. Give it as the web page, so the lead keeps its link.',
  both: 'Give the web page or your own words for where this lead came from, not both.',
});

/** The longest statement of a source in words. */
export const SOURCE_NOTE_MAX = 200;

/** A web page address, or null for anything else. */
function pageOf(value: unknown): URL | null {
  let url: URL | null = null;
  try { url = typeof value === 'string' && value.trim() ? new URL(value.trim()) : null; } catch { url = null; }
  return url && (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0 ? url : null;
}

/** Whether typed words are a web address rather than a statement: what the Add a lead form sends as the page. */
export function looksLikePage(value: string): boolean {
  return /^(?:https?:\/\/|www\.)\S+$/i.test(value.trim());
}

/**
 * Where a new lead came from: its page, or the owner's own words. ownerSays: the caller is the owner inside the app,
 * the only one who may give words; every other caller needs the page. Throws LEADS_SOURCE_REQUIRED in the words that
 * fit the caller, and INVALID_VENTURE_REQUEST when both are given.
 */
export function leadSourceOf(input: { sourceUrl?: unknown; sourceNote?: unknown }, ownerSays: boolean): { page: URL; note: null } | { page: null; note: string } {
  const given = (value: unknown) => value !== undefined && value !== null;
  check(!(given(input.sourceUrl) && given(input.sourceNote)), 'INVALID_VENTURE_REQUEST', LEAD_SOURCE_WORDS.both);
  if (!given(input.sourceNote)) {
    const page = pageOf(input.sourceUrl);
    check(page, 'LEADS_SOURCE_REQUIRED', ownerSays ? LEAD_SOURCE_WORDS.either : LEAD_SOURCE_WORDS.page);
    return { page, note: null };
  }
  check(ownerSays, 'LEADS_SOURCE_REQUIRED', LEAD_SOURCE_WORDS.page);
  const note = typeof input.sourceNote === 'string' ? input.sourceNote.trim() : '';
  check(!looksLikePage(note), 'LEADS_SOURCE_REQUIRED', LEAD_SOURCE_WORDS.pageAsWords);
  // One line that says something: at least two letters together, in any script.
  check(note.length >= 3 && note.length <= SOURCE_NOTE_MAX && /\p{L}{2}/u.test(note) && !/[\r\n\t\u0000-\u001F\u007F]/.test(note), 'LEADS_SOURCE_REQUIRED', LEAD_SOURCE_WORDS.either);
  return { page: null, note };
}

/** Where a lead was found, for a card: the page's host and path ('directory.example/pune/cafes'). */
export function leadWhere(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    return `${url.hostname}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return 'a web page';
  }
}

/**
 * Where a lead came from, as its card says it: "Found on directory.example/pune/cafes" for a page, or the owner's own
 * statement, said as theirs ("You said: referred by Asha").
 */
export function leadFound(lead: { sourceUrl: string | null; sourceNote?: string | null }): string {
  return lead.sourceUrl ? `Found on ${leadWhere(lead.sourceUrl)}` : lead.sourceNote ? `You said: ${lead.sourceNote}` : 'Found on a web page';
}
