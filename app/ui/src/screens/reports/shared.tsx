/**
 * Small helpers shared by the Reports screens: dates and instants through the format
 * module, the sentence for a refusal code, and who may change what.
 */
import type { FigureOrMissing, Language, View } from '../../app/presentation.ts';
import type { PlaceMember } from '../../places/types.ts';
import { date, moneyShort, time } from '../../format/index.ts';
import { NOT_BUILT_CODES } from '../trust/kit/engine.ts';
import { fill, type Words } from './words.ts';

export function day(iso: string, language: Language): string { return date(iso, 'short', language); }

/** An instant, written with its UTC time: the workspace zone is not assumed. */
export function when(iso: string, w: Words, language: Language): string {
  return fill(w.at, { date: date(iso.slice(0, 10), 'short', language), time: time(iso, 'UTC') });
}

const KNOWN = ['PDF_USES_PRINT', 'TALLY_PAGE_EXPORT_NOT_AVAILABLE', 'RELAY_NOT_AVAILABLE', 'ACCESS_DENIED'] as const;

/** A plain sentence for a known refusal code, the short code otherwise. */
export function refusal(code: string, w: Words): string {
  const known = KNOWN.find((k) => k === code);
  if (known !== undefined) return w[`refused.${known}`];
  if (NOT_BUILT_CODES.has(code)) return w['refused.notBuilt'];
  return fill(w['refused.other'], { code });
}

/**
 * Money as the view shows it (part 8): Simple reads the short form ("₹3.1 lakh"), Guided and Books the full one. The exact
 * value stays in the figure, in its title and in the receipt it opens; only the display string changes.
 */
export function shown(value: FigureOrMissing, view: View, w: Words): FigureOrMissing {
  return view === 'simple' && value.kind === 'money' ? { ...value, display: moneyShort(value.exact, { lakh: w.lakh, crore: w.crore }) } : value;
}

/** `admin` in the contract: the owner or a cofounder, never a viewer seat. */
export function isAdmin(member: PlaceMember, viewer: boolean): boolean {
  return !viewer && (member.role === 'owner' || member.role === 'cofounder');
}
