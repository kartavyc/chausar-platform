// Chausar 5B1 dictionary corrections. Tomada (AGPL), ideas only; no source copied.
import { check } from '../../../contracts.ts';
export type DictionaryFix = { index: number; before: string; after: string };
export type DictionaryResult = { words: string[]; undo: string[]; applied: DictionaryFix[]; refused: { index: number; code: string }[] };
/** Unicode-normalised edit similarity, case insensitive, measured by code. */
export function normalisedSimilarity(left: string, right: string): number {
  const a = [...left.normalize('NFKC').toLocaleLowerCase('en-IN')], b = [...right.normalize('NFKC').toLocaleLowerCase('en-IN')];
  if (!a.length && !b.length) return 1;
  if (a.length > 200 || b.length > 200) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
/** The owner's names list is the product context; fixes never substitute another unknown word. */
export function applyDictionaryFixes(words: readonly string[], dictionary: readonly string[], fixes: readonly DictionaryFix[]): DictionaryResult {
  check(Array.isArray(words) && words.length <= 50000 && Array.isArray(dictionary) && dictionary.length <= 500 && dictionary.every(term => typeof term === 'string' && term.length > 0 && term.length <= 200)
    && Array.isArray(fixes) && fixes.length <= 100, 'INVALID_VENTURE_REQUEST', 'Use a names list of at most five hundred terms and at most one hundred corrections.');
  const next = [...words], applied: DictionaryFix[] = [], refused: DictionaryResult['refused'] = [];
  for (const fix of fixes) {
    const code = !fix || !Number.isSafeInteger(fix.index) || typeof fix.before !== 'string' || typeof fix.after !== 'string' || next[fix.index] !== fix.before ? 'DICTIONARY_BEFORE_CHANGED'
      : !dictionary.includes(fix.after) ? 'DICTIONARY_TERM_UNKNOWN'
      : normalisedSimilarity(fix.before, fix.after) < .90 ? 'DICTIONARY_NOT_SIMILAR' : null;
    if (code) refused.push({ index: fix?.index ?? -1, code });
    else { next[fix.index] = fix.after; applied.push({ ...fix }); }
  }
  return { words: next, undo: [...words], applied, refused };
}
/** One correction request restores as one item. */
export function undoDictionary(result: DictionaryResult): string[] { return [...result.undo]; }
