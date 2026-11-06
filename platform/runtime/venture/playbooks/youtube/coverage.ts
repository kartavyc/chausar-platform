// Chausar 5B1 script coverage. Kimo (MIT), alignment ideas; original implementation.
import { check } from '../../../contracts.ts';
import type { EditWord } from './edit-ops.ts';
const normal = (word: string) => word.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** Align a bounded script to actual spoken words. Missing script text never becomes speech. */
export function scriptCoverage(script: string, spoken: readonly EditWord[]) {
  check(typeof script === 'string' && script.length <= 100000 && Array.isArray(spoken) && spoken.length <= 10000,
    'COVERAGE_TOO_LARGE', 'Check a script of up to one hundred thousand characters against at most ten thousand words.');
  const tokens = script.trim().split(/\s+/).filter(Boolean);
  check(tokens.length <= 2000 && tokens.length * spoken.length <= 10000000, 'COVERAGE_TOO_LARGE', 'Split this script into shorter parts for the coverage check.');
  const a = tokens.map(normal), b = spoken.map(word => normal(word.text));
  const width = b.length + 1, table = new Uint16Array((a.length + 1) * width);
  const uniqueA = [...new Set(a)], uniqueB = [...new Set(b)];
  const indexA = new Map(uniqueA.map((word, index) => [word, index])), indexB = new Map(uniqueB.map((word, index) => [word, index]));
  const idsA = a.map(word => indexA.get(word)!), idsB = b.map(word => indexB.get(word)!);
  const lettersA = uniqueA.map(word => [...word]), lettersB = uniqueB.map(word => [...word]);
  const cache = new Uint8Array(uniqueA.length * uniqueB.length);
  let comparedCharacters = 0;
  const matches = (i: number, j: number): boolean => {
    const left = idsA[i]!, right = idsB[j]!, key = left * uniqueB.length + right;
    if (cache[key]) return cache[key] === 1;
    const x = lettersA[left]!, y = lettersB[right]!;
    comparedCharacters += Math.max(x.length, y.length);
    check(comparedCharacters <= 20000000, 'COVERAGE_TOO_LARGE', 'Split this script into shorter parts for the coverage check.');
    let same = uniqueA[left] === uniqueB[right];
    if (!same && x.length >= 4 && y.length >= 4 && x.length <= 200 && y.length <= 200 && Math.abs(x.length - y.length) <= 1) {
      let p = 0, q = 0, edits = 0;
      while (p < x.length && q < y.length) {
        if (x[p] === y[q]) { p++; q++; continue; }
        if (++edits > 1) break;
        if (x.length >= y.length) p++;
        if (y.length >= x.length) q++;
      }
      same = edits + (p < x.length || q < y.length ? 1 : 0) <= 1;
    }
    cache[key] = same ? 1 : 2; return same;
  };
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) {
    table[i * width + j] = matches(i - 1, j - 1) ? table[(i - 1) * width + j - 1] + 1 : Math.max(table[(i - 1) * width + j], table[i * width + j - 1]);
  }
  const aligned = new Map<number, number>(), used = new Set<number>();
  let i = a.length, j = b.length;
  while (i && j) {
    if (matches(i - 1, j - 1)) { aligned.set(i - 1, j - 1); used.add(j - 1); i -= 1; j -= 1; }
    else if (table[(i - 1) * width + j] >= table[i * width + j - 1]) i -= 1;
    else j -= 1;
  }
  const missing: { words: string[]; nearestWordIds: string[] }[] = [];
  for (let index = 0; index < tokens.length;) {
    if (aligned.has(index)) { index += 1; continue; }
    const start = index;
    while (index < tokens.length && !aligned.has(index)) index += 1;
    const near = [aligned.get(start - 1), aligned.get(index)].filter((item): item is number => item !== undefined);
    missing.push({ words: tokens.slice(start, index), nearestWordIds: [...new Set(near.map(at => spoken[at].id))] });
  }
  const seen = new Map<string, number>();
  const retakes: { wordIds: string[]; firstWordIds: string[] }[] = [];
  for (let index = 0; index + 2 < b.length; index += 1) {
    const key = b.slice(index, index + 3).join(' ');
    const first = seen.get(key);
    if (first !== undefined && index >= first + 3) retakes.push({ wordIds: spoken.slice(index, index + 3).map(word => word.id), firstWordIds: spoken.slice(first, first + 3).map(word => word.id) });
    else if (first === undefined) seen.set(key, index);
  }
  return { coveredPercent: tokens.length ? Math.round(aligned.size * 10000 / tokens.length) / 100 : 100,
    coveredWords: aligned.size, scriptWords: tokens.length, missing, retakes,
    extras: spoken.filter((_, at) => !used.has(at)).map(word => ({ id: word.id, text: word.text })) };
}
