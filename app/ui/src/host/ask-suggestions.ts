/**
 * Suggestions while typing on the ask line (SH-04): up to five, each with its kind.
 *
 * - calculation: the ask lane's `askx.suggest` {} (read once, matched here against what is typed);
 * - customer: work-books' `records.search` { kind: 'customer', text };
 * - saved answer: the ask lane's `askx.search` { query }, saved group only;
 * - place: the frame's own place and sub-place names, matched here.
 *
 * These are local engine reads and the frame's own names. What is typed never goes to a model.
 * Every reply is checked; a family that is absent or refuses simply adds nothing.
 */
import type { Address } from '../app/presentation.ts';
import type { AskSuggestion } from '../app/AskLine';
import { railPlaces } from '../app/places.ts';
import type { PlaceRpc } from '../places/types.ts';
import { readAskSearch, readAskSuggest, readRecordsSearch, type CalculationSuggestion } from '../bridge/voice-contract.ts';

export type SuggestionTarget =
  | { readonly kind: 'place'; readonly address: Address }
  | { readonly kind: 'calculation'; readonly operationId: string; readonly periodId: string; readonly text: string }
  | { readonly kind: 'customer'; readonly id: string; readonly name: string }
  | { readonly kind: 'saved'; readonly id: string; readonly text: string };
export interface HostSuggestion extends AskSuggestion { readonly target: SuggestionTarget }

export const SUGGESTION_MAX = 5;
export const SUGGESTION_DEBOUNCE_MS = 180;
const fold = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const matches = (label: string, needle: string) => fold(label).includes(needle);

/** Every desktop place and sub-place, named in the current language. */
export function placeNames(t: (key: string) => string): readonly { readonly text: string; readonly address: Address }[] {
  const out: { text: string; address: Address }[] = [];
  for (const place of railPlaces({ kind: 'desktop', view: 'guided' })) {
    out.push({ text: t(place.nameKey), address: { place: place.id } });
    for (const sub of place.subs) out.push({ text: `${t(place.nameKey)} › ${t(sub.nameKey)}`, address: { place: place.id, sub: sub.id } });
  }
  return out;
}

/** Up to five, taking turns across the kinds so one kind never fills the list. */
export function mergeSuggestions(groups: readonly (readonly HostSuggestion[])[]): HostSuggestion[] {
  const out: HostSuggestion[] = [], seen = new Set<string>();
  for (let i = 0; out.length < SUGGESTION_MAX && groups.some(g => i < g.length); i++) {
    for (const group of groups) {
      const item = group[i];
      if (item && !seen.has(item.id) && out.length < SUGGESTION_MAX) { seen.add(item.id); out.push(item); }
    }
  }
  return out;
}

export interface SuggestionSource {
  /** The suggestions for what is typed now; resolves after the engine reads. */
  suggest(text: string): Promise<HostSuggestion[]>;
}

export function createSuggestionSource(rpc: PlaceRpc, names: () => readonly { readonly text: string; readonly address: Address }[]): SuggestionSource {
  let calculations: Promise<readonly CalculationSuggestion[]> | null = null;
  const read = async <T>(method: string, payload: Record<string, unknown>, check: (v: unknown) => T | null): Promise<T | null> => {
    try { return check(await rpc.request(method, payload)); } catch { return null; }
  };
  return {
    async suggest(text) {
      const needle = fold(text);
      if (needle.length === 0) return [];
      calculations ??= read('askx.suggest', {}, readAskSuggest).then(list => list ?? []);
      const query = text.trim().slice(0, 200);
      const [calcs, customers, saved] = await Promise.all([
        calculations,
        needle.length >= 2 ? read('records.search', { kind: 'customer', text: query }, readRecordsSearch) : Promise.resolve(null),
        needle.length >= 2 ? read('askx.search', { query }, readAskSearch) : Promise.resolve(null),
      ]);
      const calculation: HostSuggestion[] = calcs.filter(c => matches(c.label, needle))
        .map(c => ({ id: `calculation:${c.operationId}:${c.periodId}`, text: c.label, kind: 'calculation', target: { kind: 'calculation', operationId: c.operationId, periodId: c.periodId, text: c.label } }));
      const customer: HostSuggestion[] = (customers ?? []).map(c => ({ id: `customer:${c.id}`, text: c.name, kind: 'customer', target: { kind: 'customer', id: c.id, name: c.name } }));
      const place: HostSuggestion[] = names().filter(p => matches(p.text, needle))
        .map(p => ({ id: `place:${p.address.place}:${p.address.sub ?? ''}`, text: p.text, kind: 'place', target: { kind: 'place', address: p.address } }));
      const savedAnswers: HostSuggestion[] = (saved ?? []).map(s => ({ id: `saved:${s.id}`, text: s.text, kind: 'saved', target: { kind: 'saved', id: s.id, text: s.text } }));
      return mergeSuggestions([calculation, customer, place, savedAnswers]);
    },
  };
}

/* ------------------------------------------------------------- telling, not asking */

const QUESTION_START = new Set(['what', 'whats', "what's", 'how', 'which', 'when', 'who', 'whom', 'whose', 'why', 'where', 'is', 'are', 'was', 'were', 'do', 'does', 'did',
  'can', 'could', 'should', 'will', 'would', 'show', 'tell', 'give', 'list', 'compare', 'find', 'send', 'remind', 'pay', 'file', 'make', 'prepare', 'open', 'kitna', 'kitni', 'kitne',
  'kya', 'kab', 'kaun', 'kaise', 'kyon', 'kyun', 'dikhao', 'batao', 'क्या', 'कितना', 'कितनी', 'कितने', 'कब', 'कौन', 'कैसे', 'क्यों', 'कहाँ', 'दिखाओ', 'बताओ', 'बताएँ']);
const TELLING_START = new Set(['our', 'we', "we're", 'we’re', 'my', 'i', "i'm", 'i’m', 'us', 'hamara', 'hamari', 'hamare', 'mera', 'meri', 'mere', 'हमारा', 'हमारी', 'हमारे', 'हम', 'मेरा', 'मेरी', 'मेरे', 'मैं']);

/**
 * "Our year starts in April" is telling, not asking: a first-person statement with no question
 * mark and no question or task word at the start. Decided by fixed words only, never a model.
 */
export function isTelling(text: string): boolean {
  const t = text.trim();
  if (t.length < 8 || t.length > 2000 || /[?？]/.test(t)) return false;
  const words = fold(t).split(/[\s,.;:!]+/u).filter(Boolean);
  const first = words[0] ?? '';
  if (QUESTION_START.has(first) || words.some(w => QUESTION_START.has(w) && ['kya', 'क्या', 'kitna', 'कितना', 'kitni', 'कितनी'].includes(w))) return false;
  return TELLING_START.has(first) && words.length >= 3;
}
