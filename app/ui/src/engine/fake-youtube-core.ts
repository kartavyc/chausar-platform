// Chausar 5B1 fake-only algorithms. Mirrors engine word edit and caption checks; no server or filesystem imports.
// Original Chausar code from Tomada (AGPL, ideas only), Kimo (MIT) and FilmCraft (MIT/Apache-2.0).
import { EngineError as ChausarError } from './types';
function check(value: unknown, code: string, message: string): asserts value { if (!value) throw new ChausarError(code, message); }
type DatedRule = { id: string; value?: string; [key: string]: unknown };
type Cue = { id: string; startMs: number; endMs: number; text: string };
export type YoutubeWordSource = Omit<CleanupInput, 'document'> & { label: string; document: EditDocument; vadMeasured: boolean };
// Chausar 5B1: typed transcript edits. Tomada (AGPL), ideas only; no source copied.

export type EditWord = { id: string; text: string; startMs: number; endMs: number };
export type WordRange = { from: string; to: string };
export type EditOp =
  | ({ kind: 'cut' | 'restore' | 'clip' | 'hook' } & WordRange)
  | ({ kind: 'zoom'; scale: number } & WordRange)
  | { kind: 'layout'; value: 'wide' | 'vertical' | 'square' }
  | { kind: 'captions'; profile: 'web' | 'broadcast' | 'vertical' }
  | { kind: 'title'; text: string };
export type EditDocument = {
  durationMs: number;
  words: EditWord[];
  cuts: (WordRange & { startMs: number; endMs: number; manual?: boolean })[];
  settings: { title?: string; layout?: string; captions?: string; hook?: WordRange; clips?: WordRange[]; zooms?: (WordRange & { scale: number })[] };
};
export type EditResult = {
  document: EditDocument; undo: EditDocument; digest: string;
  applied: { index: number; op: EditOp }[];
  refused: { index: number; code: string }[];
  removedMs: number; removedShare: number; removedPercent: number; addedMs: number; addedShare: number; addedPercent: number; summary: string;
};
/** The exact document fingerprint bound to the owner's second ask. */
export function editDigest(document: EditDocument): string {
  const text = JSON.stringify(document); let hash = 0x811c9dc5; for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; } return hash.toString(16).padStart(8, '0');
}
/** Refuses corrupt timings and duplicate ids instead of guessing a range. */
export function validateEditDocument(document: EditDocument): void {
  check(document && Number.isSafeInteger(document.durationMs) && document.durationMs > 0 && document.durationMs <= 86400000
    && Array.isArray(document.words) && document.words.length <= 50000 && Array.isArray(document.cuts) && document.cuts.length <= 10000
    && document.settings && typeof document.settings === 'object', 'EDIT_INVALID', 'Give a timed transcript and its current edits.');
  const ids = new Set<string>();
  let previous = 0;
  for (const word of document.words) {
    check(word && typeof word.id === 'string' && /^[\w-]{1,80}$/.test(word.id) && !ids.has(word.id) && typeof word.text === 'string' && word.text.length > 0 && word.text.length <= 200
      && Number.isSafeInteger(word.startMs) && Number.isSafeInteger(word.endMs) && word.startMs >= previous && word.endMs > word.startMs && word.endMs <= document.durationMs,
    'EDIT_INVALID', 'Every word needs a distinct id and measured times inside the footage.');
    ids.add(word.id); previous = word.endMs;
  }
  let end = 0;
  for (const cut of [...document.cuts].sort((a, b) => a.startMs - b.startMs)) {
    check(Number.isSafeInteger(cut.startMs) && Number.isSafeInteger(cut.endMs) && cut.startMs >= end && cut.endMs > cut.startMs && cut.endMs <= document.durationMs,
      'EDIT_INVALID', 'The saved cuts overlap or have invalid times.');
    end = cut.endMs;
  }
}
const invalid = (code: string): never => { throw new ChausarError(code, 'This operation cannot be applied to these words.'); };
/** Apply each whole operation to a copy. One request is one undo item; no footage is overwritten. */
export function applyEditOps(document: EditDocument, ops: readonly EditOp[], options: { confirmedDigest?: string } = {}): EditResult {
  validateEditDocument(document);
  check(Array.isArray(ops) && ops.length <= 40, 'EDIT_TOO_MANY', 'Use at most forty operations in one request.');
  const digest = editDigest(document);
  if (options.confirmedDigest !== undefined) check(options.confirmedDigest === digest, 'EDIT_STALE', 'The edit changed. Read it and confirm the new request.');
  const next = structuredClone(document);
  const applied: EditResult['applied'] = [], refused: EditResult['refused'] = [];
  for (const [index, op] of ops.entries()) {
    try {
      if (!op || typeof op !== 'object' || Array.isArray(op)) invalid('EDIT_INVALID');
      const fields: Record<string, string[]> = { cut: ['kind', 'from', 'to'], restore: ['kind', 'from', 'to'], clip: ['kind', 'from', 'to'], hook: ['kind', 'from', 'to'], zoom: ['kind', 'from', 'to', 'scale'], layout: ['kind', 'value'], captions: ['kind', 'profile'], title: ['kind', 'text'] };
      const allowed = fields[op.kind];
      if (!allowed || Object.keys(op).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(op, key))) invalid('EDIT_INVALID');
      let range: { startMs: number; endMs: number } | null = null;
      if ('from' in op) {
        const from = next.words.findIndex(word => word.id === op.from), to = next.words.findIndex(word => word.id === op.to);
        if (from < 0 || to < 0) invalid('EDIT_WORD_UNKNOWN');
        if (from > to) invalid('EDIT_INVALID');
        range = { startMs: next.words[from]!.startMs, endMs: next.words[to]!.endMs };
      }
      switch (op.kind) {
        case 'cut':
          if (!range) invalid('EDIT_INVALID');
          if (next.cuts.some(cut => cut.startMs < range!.endMs && cut.endMs > range!.startMs)) invalid('EDIT_CUT_OVERLAP');
          next.cuts.push({ from: op.from, to: op.to, ...range!, manual: true });
          next.cuts.sort((a, b) => a.startMs - b.startMs);
          break;
        case 'restore': {
          if (!range) invalid('EDIT_INVALID');
          const at = next.cuts.findIndex(cut => cut.startMs <= range!.startMs && cut.endMs >= range!.endMs);
          if (at < 0) invalid('EDIT_NOT_CUT');
          const prior = next.cuts[at]!;
          next.cuts.splice(at, 1);
          const fromIndex = next.words.findIndex(word => word.id === op.from), toIndex = next.words.findIndex(word => word.id === op.to);
          if (prior.startMs < range!.startMs) next.cuts.push({ ...prior, to: next.words[fromIndex - 1]?.id ?? op.from, endMs: range!.startMs });
          if (prior.endMs > range!.endMs) next.cuts.push({ ...prior, from: next.words[toIndex + 1]?.id ?? op.to, startMs: range!.endMs });
          next.cuts.sort((a, b) => a.startMs - b.startMs); break;
        }
        case 'zoom':
          if (!range || !Number.isFinite(op.scale) || op.scale < 1 || op.scale > 3) invalid('EDIT_INVALID');
          (next.settings.zooms ??= []).push({ from: op.from, to: op.to, scale: op.scale }); break;
        case 'clip':
          if (!range) invalid('EDIT_INVALID');
          (next.settings.clips ??= []).push({ from: op.from, to: op.to }); break;
        case 'hook':
          if (!range) invalid('EDIT_INVALID');
          next.settings.hook = { from: op.from, to: op.to }; break;
        case 'layout':
          if (!['wide', 'vertical', 'square'].includes(op.value)) invalid('EDIT_INVALID');
          next.settings.layout = op.value; break;
        case 'captions':
          if (!['web', 'broadcast', 'vertical'].includes(op.profile)) invalid('EDIT_INVALID');
          next.settings.captions = op.profile; break;
        case 'title':
          if (typeof op.text !== 'string' || !op.text.trim() || op.text.length > 100 || /[\u0000-\u001f]/.test(op.text)) invalid('EDIT_INVALID');
          next.settings.title = op.text.trim(); break;
        default: invalid('EDIT_INVALID');
      }
      applied.push({ index, op: structuredClone(op) });
    } catch (error) {
      if (!(error instanceof ChausarError)) throw error;
      refused.push({ index, code: error.code });
    }
  }
  const removedMs = next.cuts.reduce((sum, cut) => sum + cut.endMs - cut.startMs, 0);
  const priorMs = document.cuts.reduce((sum, cut) => sum + cut.endMs - cut.startMs, 0);
  const addedMs = Math.max(0, removedMs - priorMs);
  check(addedMs * 5 <= document.durationMs || options.confirmedDigest === digest, 'EDIT_ASK_AGAIN', `This removes ${Math.round(addedMs * 10000 / document.durationMs) / 100}% of the footage. Confirm this exact edit first.`);
  const count = applied.filter(item => item.op.kind === 'cut').length;
  const seconds = Math.round(addedMs / 100) / 10;
  return { document: next, undo: structuredClone(document), digest: editDigest(next), applied, refused, removedMs, removedShare: removedMs / document.durationMs, removedPercent: Math.round(removedMs * 10000 / document.durationMs) / 100, addedMs, addedShare: addedMs / document.durationMs, addedPercent: Math.round(addedMs * 10000 / document.durationMs) / 100,
    summary: `Cut ${count} ${count === 1 ? 'passage' : 'passages'}, ${seconds} s shorter.` };
}
/** Restore the complete pre-request snapshot as one undo step. */
export function undoEdit(result: EditResult): EditDocument { return structuredClone(result.undo); }


// Chausar 5B1 dictionary corrections. Tomada (AGPL), ideas only; no source copied.
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
    for (let j = 1; j <= b.length; j += 1) row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + (a[i - 1]! === b[j - 1]! ? 0 : 1));
    prev = row;
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
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

// Chausar 5B1 script coverage. Kimo (MIT), alignment ideas; original implementation.
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
    table[i * width + j] = matches(i - 1, j - 1) ? table[(i - 1) * width + j - 1]! + 1 : Math.max(table[(i - 1) * width + j]!, table[i * width + j - 1]!);
  }
  const aligned = new Map<number, number>(), used = new Set<number>();
  let i = a.length, j = b.length;
  while (i && j) {
    if (matches(i - 1, j - 1)) { aligned.set(i - 1, j - 1); used.add(j - 1); i -= 1; j -= 1; }
    else if (table[(i - 1) * width + j]! >= table[i * width + j - 1]!) i -= 1;
    else j -= 1;
  }
  const missing: { words: string[]; nearestWordIds: string[] }[] = [];
  for (let index = 0; index < tokens.length;) {
    if (aligned.has(index)) { index += 1; continue; }
    const start = index;
    while (index < tokens.length && !aligned.has(index)) index += 1;
    const near = [aligned.get(start - 1), aligned.get(index)].filter((item): item is number => item !== undefined);
    missing.push({ words: tokens.slice(start, index), nearestWordIds: [...new Set(near.map(at => spoken[at]!.id))] });
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

// Chausar 5B1 cleanup. Tomada (AGPL), FilmCraft (MIT/Apache-2.0), ideas only; original code.
export type QuietSpan = { startMs: number; endMs: number };
export type CleanupCut = QuietSpan & { from: string; to: string; reason: 'silence' | 'hesitation' };
export type CleanupInput = {
  document: EditDocument; micQuiet: readonly QuietSpan[]; systemQuiet: readonly QuietSpan[]; vadQuiet: readonly QuietSpan[];
  loudness: readonly (QuietSpan & { db: number })[]; vertical?: boolean; sources?: readonly { fps: string; colour: string }[];
};
const cleanupLimits = () => ({ minAirMs: 30, maxAirMs: 200, sliverMs: 400, minSpeechMs: 1200, seamsPerMinute: 6, verticalSeamsPerMinute: 12, minQuietMs: 600, loudnessDbMagnitude: 35 });
const HESITATION = /^(?:um|uh|erm|umm|hmm|अम्|उम्)$/iu;
const MEANINGFUL = /^(?:like|you|know|मतलब|यानी)$/iu;
/** Three independent quiet signals and a measured low loudness trace must all cover the edge. */
function quietSpans(input: CleanupInput): QuietSpan[] {
  const normalise = (spans: readonly QuietSpan[]): QuietSpan[] => {
    const sorted = spans.map(span => ({ startMs: span.startMs, endMs: span.endMs })).sort((a, b) => a.startMs - b.startMs);
    const merged: QuietSpan[] = [];
    for (const span of sorted) {
      const last = merged.at(-1);
      if (last && span.startMs <= last.endMs) last.endMs = Math.max(last.endMs, span.endMs);
      else merged.push(span);
    }
    return merged;
  };
  const intersect = (left: readonly QuietSpan[], right: readonly QuietSpan[]): QuietSpan[] => {
    const result: QuietSpan[] = [];
    let a = 0, b = 0;
    while (a < left.length && b < right.length) {
      const startMs = Math.max(left[a]!.startMs, right[b]!.startMs), endMs = Math.min(left[a]!.endMs, right[b]!.endMs);
      if (endMs > startMs) result.push({ startMs, endMs });
      if (left[a]!.endMs <= right[b]!.endMs) a++; else b++;
    }
    return result;
  };
  return intersect(intersect(intersect(normalise(input.micQuiet), normalise(input.systemQuiet)), normalise(input.vadQuiet)), normalise(input.loudness.filter(span => Number.isFinite(span.db) && span.db <= -cleanupLimits().loudnessDbMagnitude)));
}
/** The same trim application supplies both the preview and the stored edit; manual cuts are never removed. */
export function applyCleanupCuts(document: EditDocument, cuts: readonly CleanupCut[]): EditDocument {
  const next = structuredClone(document);
  for (const cut of cuts) if (!next.cuts.some(old => old.startMs < cut.endMs && old.endMs > cut.startMs)) next.cuts.push({ from: cut.from, to: cut.to, startMs: cut.startMs, endMs: cut.endMs, manual: false });
  next.cuts.sort((a, b) => a.startMs - b.startMs);
  return next;
}
/** Move surviving words onto the new timeline without paying to transcribe again. Original media times stay in the document. */
export function wordsAfterTrim(document: EditDocument): EditWord[] {
  return document.words.filter(word => !document.cuts.some(cut => word.startMs < cut.endMs && word.endMs > cut.startMs)).map(word => {
    const shift = document.cuts.filter(cut => cut.endMs <= word.startMs).reduce((sum, cut) => sum + cut.endMs - cut.startMs, 0);
    return { ...word, startMs: word.startMs - shift, endMs: word.endMs - shift };
  });
}
/** Conservative measured cleanup. Missing channels or air produce no guessed cut. */
export function cleanTranscript(input: CleanupInput) {
  validateEditDocument(input.document);
  for (const spans of [input.micQuiet, input.systemQuiet, input.vadQuiet, input.loudness]) check(Array.isArray(spans) && spans.length <= 10000 && spans.every(span =>
    Number.isSafeInteger(span.startMs) && Number.isSafeInteger(span.endMs) && span.startMs >= 0 && span.endMs > span.startMs && span.endMs <= input.document.durationMs),
  'EDIT_INVALID', 'Audio measurements need valid times inside this footage.');
  const sources = input.sources ?? [];
  check(sources.every(source => source.fps === sources[0]?.fps && source.colour === sources[0]?.colour), 'SOURCE_MISMATCH', 'Match the source frame rates and colour spaces before cleanup.');
  const words = input.document.words, quiet = quietSpans(input);
  const suggestions = words.filter(word => MEANINGFUL.test(word.text.replace(/[.,!?]/g, ''))).map(word => ({ wordIds: [word.id], reason: 'meaningful-filler' as const }));
  const candidates: CleanupCut[] = [];
  for (const word of words) if (HESITATION.test(word.text.replace(/[.,!?]/g, ''))) {
    const before = quiet.find(span => span.endMs >= word.startMs && span.startMs <= word.startMs - cleanupLimits().minAirMs);
    const after = quiet.find(span => span.startMs <= word.endMs && span.endMs >= word.endMs + cleanupLimits().minAirMs);
    if (before && after) candidates.push({ from: word.id, to: word.id, startMs: word.startMs - Math.min(100, word.startMs - before.startMs), endMs: word.endMs + Math.min(100, after.endMs - word.endMs), reason: 'hesitation' });
  }
  for (const span of quiet) {
    if (span.endMs - span.startMs < cleanupLimits().minQuietMs || words.some(word => word.startMs < span.endMs && word.endMs > span.startMs)) continue;
    const before = [...words].reverse().find(word => word.endMs <= span.startMs), after = words.find(word => word.startMs >= span.endMs);
    if (!before || !after || candidates.some(cut => cut.startMs < span.endMs && cut.endMs > span.startMs)) continue; // Keep hesitation edges measured; no invented programme bounds.
    candidates.push({ from: before.id, to: after.id, startMs: span.startMs + 200, endMs: span.endMs - 200, reason: 'silence' });
  }
  const first = words[0]!, lastWord = words.at(-1);
  if (first && first.startMs > 100 && quiet.some(span => span.startMs === 0 && span.endMs >= first.startMs)) candidates.push({ from: first.id, to: first.id, startMs: 0, endMs: first.startMs - 100, reason: 'silence' });
  if (lastWord && lastWord.endMs + 800 < input.document.durationMs && quiet.some(span => span.startMs <= lastWord.endMs && span.endMs === input.document.durationMs)) candidates.push({ from: lastWord.id, to: lastWord.id, startMs: lastWord.endMs + 800, endMs: input.document.durationMs, reason: 'silence' });
  candidates.sort((a, b) => a.startMs - b.startMs);
  const merged: CleanupCut[] = [];
  for (const cut of candidates) {
    const last = merged.at(-1);
    if (last && cut.startMs - last.endMs < cleanupLimits().sliverMs) { last.endMs = Math.max(last.endMs, cut.endMs); last.to = cut.to; }
    else merged.push({ ...cut });
  }
  const cuts: CleanupCut[] = [];
  const budget = input.vertical ? cleanupLimits().verticalSeamsPerMinute : cleanupLimits().seamsPerMinute;
  for (const cut of merged) {
    if (input.document.cuts.some(manual => manual.startMs < cut.endMs && manual.endMs > cut.startMs)) continue;
    const saved = [...input.document.cuts, ...cuts].sort((a, b) => a.startMs - b.startMs);
    const before = saved.filter(prior => prior.endMs <= cut.startMs).at(-1);
    const after = saved.find(prior => prior.startMs >= cut.endMs);
    const speechBetween = (start: number, end: number) => words.filter(word => word.startMs >= start && word.endMs <= end && !saved.some(old => word.startMs < old.endMs && word.endMs > old.startMs)).reduce((sum, word) => sum + word.endMs - word.startMs, 0);
    if ((before && speechBetween(before.endMs, cut.startMs) < cleanupLimits().minSpeechMs) || (after && speechBetween(cut.endMs, after.startMs) < cleanupLimits().minSpeechMs)) continue;
    const all = [...saved, cut];
    if (all.some(anchor => anchor.startMs <= cut.startMs && cut.startMs < anchor.startMs + 60000 && all.filter(other => other.startMs >= anchor.startMs && other.startMs < anchor.startMs + 60000).length > budget)) continue;
    cuts.push(cut);
  }
  const document = applyCleanupCuts(input.document, cuts);
  const removedMs = document.cuts.reduce((sum, cut) => sum + cut.endMs - cut.startMs, 0) - input.document.cuts.reduce((sum, cut) => sum + cut.endMs - cut.startMs, 0);
  return { document, cuts, suggestions, removedMs, timelineWords: wordsAfterTrim(document), summary: `Cut ${cuts.length} ${cuts.length === 1 ? 'passage' : 'passages'}, ${Math.round(removedMs / 100) / 10} s shorter.` };
}




// Chausar 5B1 source import. FilmCraft (MIT/Apache-2.0), measured word-time concept; original code.
/** An owner-imported measured word document, never timings guessed from SRT cue boundaries. */
export function wordSource(value: unknown): YoutubeWordSource {
  check(value && typeof value === 'object' && !Array.isArray(value), 'WORD_TIMES_REQUIRED', 'Import the measured word-time JSON exported by your transcription tool. SRT cue times are not word times.');
  const raw = value as Record<string, unknown>;
  check(Object.keys(raw).every(key => ['label', 'durationMs', 'words', 'micQuiet', 'systemQuiet', 'vadQuiet', 'loudness', 'vertical', 'sources'].includes(key))
    && typeof raw.label === 'string' && raw.label.length > 0 && raw.label.length <= 120 && Array.isArray(raw.words) && raw.words.length <= 5000,
  'WORD_TIMES_REQUIRED', 'Import a named word-time JSON document of at most five thousand measured words.');
  const document: EditDocument = { durationMs: raw.durationMs as number, words: structuredClone(raw.words) as EditDocument['words'], cuts: [], settings: {} };
  validateEditDocument(document);
  for (const key of ['micQuiet', 'systemQuiet', 'vadQuiet', 'loudness', 'sources']) check(raw[key] === undefined || (Array.isArray(raw[key]) && raw[key].length <= 10000), 'EDIT_INVALID', 'Audio measurements must be lists.');
  check(raw.vertical === undefined || typeof raw.vertical === 'boolean', 'EDIT_INVALID', 'The vertical setting is a yes or no.');
  return { label: raw.label, document, vadMeasured: Object.hasOwn(raw, 'vadQuiet'), micQuiet: structuredClone(raw.micQuiet ?? []) as YoutubeWordSource['micQuiet'], systemQuiet: structuredClone(raw.systemQuiet ?? []) as YoutubeWordSource['systemQuiet'],
    vadQuiet: structuredClone(raw.vadQuiet ?? []) as YoutubeWordSource['vadQuiet'], loudness: structuredClone(raw.loudness ?? []) as YoutubeWordSource['loudness'],
    vertical: raw.vertical === true, sources: structuredClone(raw.sources ?? []) as NonNullable<YoutubeWordSource['sources']> };
}


// Chausar 5B1 transcription tiers. FilmCraft (MIT/Apache-2.0), model provenance ideas; no source copied.
// Pins read 27 Oct 2026 from the publisher's immutable LFS pointers:
// https://huggingface.co/ggerganov/whisper.cpp/commit/80da2d8bfee42b0e836fc3a9890373e5defc00a6
export type TranscriptTier = 'draft' | 'final' | 'refined';
const REVISION = '80da2d8bfee42b0e836fc3a9890373e5defc00a6';
export const TRANSCRIPT_MODELS = Object.freeze({
  draft: { id: 'base', revision: REVISION, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', bytes: 147951465, licence: 'MIT' },
  final: { id: 'small', revision: REVISION, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', bytes: 487601967, licence: 'MIT' },
  refined: { id: 'medium', revision: REVISION, sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208', bytes: 1533763059, licence: 'MIT' },
});
/** Metadata is accepted only for the pinned bytes; never infer the model from a filename. */
export function tierTranscript(input: { tier: TranscriptTier; whisperVersion: string; modelSha256: string; segments: readonly Cue[]; voiceActivity: readonly { startMs: number; endMs: number }[] }) {
  check(Object.hasOwn(TRANSCRIPT_MODELS, input.tier), 'INVALID_VENTURE_REQUEST', 'Choose draft, final or refined transcription.');
  const model = TRANSCRIPT_MODELS[input.tier];
  check(input.modelSha256 === model.sha256, 'MODEL_HASH_MISMATCH', 'The model file differs from the pinned table. Choose the verified model before transcribing.');
  check(typeof input.whisperVersion === 'string' && input.whisperVersion.trim().length > 0 && input.whisperVersion.length <= 200
    && Array.isArray(input.segments) && input.segments.length <= 20000 && Array.isArray(input.voiceActivity) && input.voiceActivity.length <= 20000
    && input.voiceActivity.every(region => Number.isSafeInteger(region.startMs) && Number.isSafeInteger(region.endMs) && region.startMs >= 0 && region.endMs > region.startMs),
  'TRANSCRIPT_MEASUREMENTS_REQUIRED', 'Keep the whisper version and measured voice-activity regions with the transcript.');
  const segments = input.segments.filter(segment => input.voiceActivity.some(region => segment.startMs < region.endMs && segment.endMs > region.startMs)).map(segment => ({ ...segment }));
  return { tier: input.tier, whisperVersion: input.whisperVersion, modelSha256: model.sha256, revision: model.revision, model: model.id, segments, dropped: input.segments.length - segments.length };
}
/** The owner downloads the named bytes in their browser; Chausar never downloads without this exact confirmation. */
export function modelDownloadHandoff(tier: TranscriptTier, confirmed: boolean, hosted: boolean) {
  check(!hosted, 'TIER_UNAVAILABLE', 'Model downloads are a desktop handoff. Upload an SRT or VTT transcript here.');
  check(confirmed === true, 'APP_APPROVAL_REQUIRED', 'Confirm this model, its source, size and licence before opening the download.');
  check(Object.hasOwn(TRANSCRIPT_MODELS, tier), 'INVALID_VENTURE_REQUEST', 'Choose draft, final or refined transcription.');
  const model = TRANSCRIPT_MODELS[tier];
  return { ...model, url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${model.revision}/ggml-${model.id}.bin`, mode: 'handoff' as const };
}

// Chausar playbook kit: the captions core (Ink v2 wave 5, package 5A4; catalogue Y4's core). Cues are grouped by code
// from word times: a cue closes at a sentence end, at a pause, at a clause once it is half full, and before it would
// run past its characters or its longest time; one stray word joins its neighbour; lines are balanced and never end on
// a one-word line. Each profile (web, broadcast, 9:16) caps the reading speed, the shortest and longest time on screen
// and keeps a two-frame gap; its values are dated house rules (CAPTION_RULES), so a change is a dated change. The
// validator answers with codes, cue ids and a fix hint, never the words, and lists the checks it could not run.
// Editing a word changes text only, never timing. The SRT and VTT writers escape &, < and arrow lines.
//
// Learned from kimo crates/kimo-core/src/transcript_captions.rs, caption_validate.rs and editorial.rs (MIT and Apache
// 2.0) and reels-af src/reel_af/planning/cards.py (MIT): the grouping order, the finding codes and the escaping. The
// code is written here for Chausar; no source text is copied.

/** One spoken word with its time, in whole milliseconds. */
export type TimedWord = { text: string; startMs: number; endMs: number };
/** One cue: its id (c1, c2, ...), its time, its lines, and the words it holds when it was grouped from word times. */
export type CaptionCue = { id: string; startMs: number; endMs: number; lines: string[]; words: TimedWord[] | null };
export type CaptionProfileId = 'web' | 'broadcast' | 'vertical';
export type CaptionProfile = {
  id: CaptionProfileId;
  maxLineChars: number;
  maxLines: number;
  /** Characters a second, spaces included. */
  maxCps: number;
  minDurationMs: number;
  maxDurationMs: number;
  gapFrames: number;
  fps: number;
  /** A silence this long between two words closes the cue. */
  pauseMs: number;
};
export type CaptionFindingCode =
  | 'empty-cue' | 'out-of-order' | 'overlap' | 'gap-too-small' | 'too-short' | 'too-long' | 'too-fast'
  | 'line-too-long' | 'too-many-lines' | 'single-word-line';
/** A finding: what is wrong, on which cue, and how to fix it. Never the cue's words. */
export type CaptionFinding = { code: CaptionFindingCode; cueId: string; fix: string };
export type CaptionCheck = 'pause-breaks';
export type CaptionValidation = { findings: CaptionFinding[]; notRun: { check: CaptionCheck; why: string }[] };

const CHECKED_ON = '2026-10-27';
const HOW = "Chausar's own house rule, set from common subtitle practice. Change it here, with a new date, when a platform asks for other values.";
const LIMITS = 'A house rule, not a platform requirement: a channel or a broadcaster may ask for other values.';
const PROFILE_WORDS: Readonly<Record<CaptionProfileId, string>> = Object.freeze({ web: 'web video', broadcast: 'broadcast', vertical: '9:16 video' });
type ProfileKey = Exclude<keyof CaptionProfile, 'id' | 'pauseMs'>;
const KEY_WORDS: Readonly<Record<ProfileKey, { rule: string; unit: string }>> = Object.freeze({
  maxLineChars: { rule: 'The most characters on one line', unit: 'characters' },
  maxLines: { rule: 'The most lines in one cue', unit: 'lines' },
  maxCps: { rule: 'The fastest reading speed, spaces included', unit: 'characters a second' },
  minDurationMs: { rule: 'The shortest time a cue stays on screen', unit: 'milliseconds' },
  maxDurationMs: { rule: 'The longest time a cue stays on screen', unit: 'milliseconds' },
  gapFrames: { rule: 'The gap between two cues', unit: 'frames' },
  fps: { rule: 'The frame rate the gap is counted in', unit: 'frames a second' },
});
const VALUES: Readonly<Record<CaptionProfileId, Readonly<Record<ProfileKey, number>>>> = Object.freeze({
  web: { maxLineChars: 42, maxLines: 2, maxCps: 20, minDurationMs: 833, maxDurationMs: 7000, gapFrames: 2, fps: 25 },
  broadcast: { maxLineChars: 37, maxLines: 2, maxCps: 15, minDurationMs: 1200, maxDurationMs: 6000, gapFrames: 2, fps: 25 },
  vertical: { maxLineChars: 26, maxLines: 2, maxCps: 17, minDurationMs: 600, maxDurationMs: 4000, gapFrames: 2, fps: 30 },
});
const PAUSE_MS = 600;
const USED_BY = Object.freeze(['captions.group', 'captions.validate']);

/** The captions' values as dated house rules: one per profile and value, and the pause that closes a cue. */
export const CAPTION_RULES: readonly DatedRule[] = Object.freeze([
  ...(Object.keys(VALUES) as CaptionProfileId[]).flatMap(profile => (Object.keys(KEY_WORDS) as ProfileKey[]).map(key => Object.freeze({
    id: `captions.${profile}.${key}`, scope: 'captions', topic: `Captions for ${PROFILE_WORDS[profile]}`, rule: `${KEY_WORDS[key].rule}, for ${PROFILE_WORDS[profile]}.`,
    value: String(VALUES[profile][key]), unit: KEY_WORDS[key].unit, sources: [], checkedOn: CHECKED_ON, read: 'house' as const, how: HOW, usedBy: USED_BY, limitations: LIMITS, needs: null,
  }))),
  Object.freeze({
    id: 'captions.pauseMs', scope: 'captions', topic: 'Captions for every profile', rule: 'A silence this long between two words starts a new cue.',
    value: String(PAUSE_MS), unit: 'milliseconds', sources: [], checkedOn: CHECKED_ON, read: 'house' as const, how: HOW, usedBy: USED_BY, limitations: LIMITS, needs: null,
  }),
]);

/** A rule's value as a whole number, read from the register. */
function ruleValue(id: string): number {
  const rule = CAPTION_RULES.find(item => item.id === id);
  const value = Number(rule?.value);
  check(rule && Number.isInteger(value) && value > 0, 'INVALID_VENTURE_REQUEST', `The caption rule ${id} has no value.`);
  return value;
}

/** The three profiles, each read from CAPTION_RULES. */
export const CAPTION_PROFILES: Readonly<Record<CaptionProfileId, CaptionProfile>> = Object.freeze(Object.fromEntries(
  (Object.keys(VALUES) as CaptionProfileId[]).map(id => [id, Object.freeze({
    id, pauseMs: ruleValue('captions.pauseMs'),
    ...Object.fromEntries((Object.keys(KEY_WORDS) as ProfileKey[]).map(key => [key, ruleValue(`captions.${id}.${key}`)])),
  } as CaptionProfile)]),
) as Record<CaptionProfileId, CaptionProfile>);

const profileOf = (profile: CaptionProfileId | CaptionProfile): CaptionProfile => (typeof profile === 'string' ? CAPTION_PROFILES[profile] : profile);
const gapOf = (profile: CaptionProfile) => Math.ceil(profile.gapFrames * 1000 / profile.fps);
const textOf = (words: readonly TimedWord[]) => words.map(word => word.text).join(' ');
const SENTENCE_END = /[.?!।]["'”’)]*$/u;
const CLAUSE_END = /[,;:]["'”’)]*$/u;

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** The words, tidied: trimmed, empty ones left out, in time order; a word that ends before it starts is refused. */
function tidyWords(words: readonly TimedWord[]): TimedWord[] {
  const kept = words.map(word => ({ text: String(word.text).replace(/\s+/g, ' ').trim(), startMs: word.startMs, endMs: word.endMs }))
    .filter(word => word.text.length > 0);
  for (const word of kept) {
    check(Number.isInteger(word.startMs) && Number.isInteger(word.endMs) && word.startMs >= 0 && word.endMs >= word.startMs,
      'INVALID_VENTURE_REQUEST', 'Each word needs a start and an end in whole milliseconds, the end not before the start.');
  }
  return kept.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Whether the words can be shown in the profile's lines, none past its characters: greedy filling uses the fewest
 * lines, so it fits exactly when such a split exists.
 */
function fitsLines(words: readonly TimedWord[], profile: CaptionProfile): boolean {
  let lines = 1, width = 0;
  for (const word of words) {
    if (word.text.length > profile.maxLineChars) return false;
    if (width === 0) width = word.text.length;
    else if (width + 1 + word.text.length <= profile.maxLineChars) width += 1 + word.text.length;
    else { lines += 1; width = word.text.length; }
  }
  return lines <= profile.maxLines;
}

/**
 * Groups the words into runs, closing one at a sentence end, a pause, a half-full clause, or before it would be too long:
 * past its time, or past what its lines can show.
 */
function runsOf(words: readonly TimedWord[], profile: CaptionProfile): TimedWord[][] {
  const capacity = profile.maxLineChars * profile.maxLines;
  const runs: TimedWord[][] = [];
  let current: TimedWord[] = [];
  for (const word of words) {
    const last = current.at(-1);
    if (last) {
      const closes = SENTENCE_END.test(last.text)
        || word.startMs - last.endMs >= profile.pauseMs
        || (CLAUSE_END.test(last.text) && textOf(current).length * 2 >= capacity)
        || textOf([...current, word]).length > capacity
        || !fitsLines([...current, word], profile)
        || word.endMs - current[0]!.startMs > profile.maxDurationMs;
      if (closes) { runs.push(current); current = []; }
    }
    current.push(word);
  }
  if (current.length) runs.push(current);
  return joinStrays(runs, profile);
}

/** A run of one word joins the next run (or else the one before) when the two fit together and no pause parts them. */
function joinStrays(runs: TimedWord[][], profile: CaptionProfile): TimedWord[][] {
  const capacity = profile.maxLineChars * profile.maxLines;
  const fits = (a: readonly TimedWord[], b: readonly TimedWord[]) => textOf([...a, ...b]).length <= capacity && fitsLines([...a, ...b], profile)
    && b.at(-1)!.endMs - a[0]!.startMs <= profile.maxDurationMs && b[0]!.startMs - a.at(-1)!.endMs < profile.pauseMs;
  const out = runs.map(run => [...run]);
  for (let index = 0; index < out.length; index += 1) {
    if (out.length < 2 || out[index]!.length !== 1) continue;
    if (index + 1 < out.length && fits(out[index]!, out[index + 1]!)) {
      out[index + 1] = [...out[index]!, ...out[index + 1]!];
      out.splice(index, 1);
      index -= 1;
    } else if (index > 0 && fits(out[index - 1]!, out[index]!)) {
      out[index - 1] = [...out[index - 1]!, ...out[index]!];
      out.splice(index, 1);
      index -= 1;
    }
  }
  return out;
}

/**
 * A cue's words as lines: one line when it fits; else the split that keeps every line within the limit, never leaves a
 * one-word line when the cue has more words, and makes the lines most even (a split after a clause wins a tie).
 */
export function linesOf(words: readonly string[], profile: CaptionProfileId | CaptionProfile, counts?: readonly number[]): string[] {
  const p = profileOf(profile);
  if (counts && counts.reduce((sum, count) => sum + count, 0) === words.length && counts.every(count => count > 0)) {
    let at = 0;
    return counts.map(count => { const line = words.slice(at, at + count).join(' '); at += count; return line; });
  }
  const whole = words.join(' ');
  if (whole.length <= p.maxLineChars || p.maxLines < 2 || words.length < 2) return [whole];
  let best: { lines: string[]; score: number } | null = null;
  for (let split = 1; split < words.length; split += 1) {
    const lines = [words.slice(0, split).join(' '), words.slice(split).join(' ')];
    const over = Math.max(0, ...lines.map(line => line.length - p.maxLineChars));
    const single = (split === 1 || split === words.length - 1) && words.length > 2 ? 1 : 0;
    const clause = CLAUSE_END.test(words[split - 1]!) || SENTENCE_END.test(words[split - 1]!) ? 0 : 1;
    // Fit first, then no one-word line, then even lines, then a split after a clause.
    const score = over * 1_000_000 + single * 10_000 + Math.abs(lines[0]!.length - lines[1]!.length) * 10 + clause;
    if (!best || score < best.score) best = { lines, score };
  }
  return best!.lines;
}

/** Each run's time on screen: long enough to read and at least the shortest time, at most the longest, two frames before the next. */
function timed(runs: readonly TimedWord[][], profile: CaptionProfile): CaptionCue[] {
  const gap = gapOf(profile);
  return runs.map((run, index) => {
    const startMs = run[0]!.startMs;
    const lines = linesOf(run.map(word => word.text), profile);
    const chars = lines.join(' ').length;
    const nextStart = index + 1 < runs.length ? runs[index + 1]![0]!.startMs : null;
    let endMs = Math.max(run.at(-1)!.endMs, startMs + profile.minDurationMs, startMs + Math.ceil(chars * 1000 / profile.maxCps));
    endMs = Math.min(endMs, startMs + profile.maxDurationMs);
    if (nextStart !== null) endMs = Math.min(endMs, nextStart - gap);
    return { id: `c${index + 1}`, startMs, endMs: Math.max(endMs, startMs), lines, words: run.map(word => ({ ...word })) };
  });
}

/** Cues for a profile from word times, by code. */
export function groupCues(words: readonly TimedWord[], profile: CaptionProfileId | CaptionProfile): CaptionCue[] {
  const p = profileOf(profile);
  return timed(runsOf(tidyWords(words), p), p);
}

// ---------------------------------------------------------------------------
// Editing and validating
// ---------------------------------------------------------------------------

/** One word of one cue changed: the text only. Every cue keeps its time, and its lines keep their word counts. */
export function editCueWord(cues: readonly CaptionCue[], cueId: string, wordIndex: number, text: string): CaptionCue[] {
  const cue = cues.find(item => item.id === cueId);
  check(cue && cue.words && Number.isInteger(wordIndex) && wordIndex >= 0 && wordIndex < cue.words.length, 'INVALID_VENTURE_REQUEST', 'That word is not in that cue.');
  const word = String(text).replace(/\s+/g, ' ').trim();
  check(word.length > 0 && word.length <= 60, 'INVALID_VENTURE_REQUEST', 'A word is 1 to 60 characters.');
  return cues.map(item => {
    if (item.id !== cueId) return { ...item, lines: [...item.lines], words: item.words ? item.words.map(entry => ({ ...entry })) : null };
    const words = item.words!.map((entry, index) => ({ ...entry, text: index === wordIndex ? word : entry.text }));
    const counts = item.lines.map(line => line.split(' ').filter(Boolean).length);
    return { ...item, words, lines: linesOf(words.map(entry => entry.text), 'web', counts) };
  });
}

const FIXES: Readonly<Record<CaptionFindingCode, string>> = Object.freeze({
  'empty-cue': 'Remove this cue, or give it words.',
  'out-of-order': 'Put this cue after the one before it.',
  overlap: 'Start this cue after the one before it ends.',
  'gap-too-small': 'Leave two frames between this cue and the one before.',
  'too-short': 'Keep this cue on screen longer, or join it to its neighbour.',
  'too-long': 'Split this cue in two.',
  'too-fast': 'Show this cue longer, or say it in fewer words.',
  'line-too-long': 'Break this line earlier, or split the cue.',
  'too-many-lines': 'Split this cue in two.',
  'single-word-line': 'Move a word onto the short line.',
});

/**
 * Every finding on the cues for a profile, as codes with cue ids and a fix hint (never the words), and the checks that
 * could not run: breaks at pauses need word times, which cues read from an SRT or VTT file do not have.
 */
export function validateCues(cues: readonly CaptionCue[], profile: CaptionProfileId | CaptionProfile): CaptionValidation {
  const p = profileOf(profile);
  const gap = gapOf(p);
  const findings: CaptionFinding[] = [];
  const add = (code: CaptionFindingCode, cueId: string) => findings.push({ code, cueId, fix: FIXES[code] });
  cues.forEach((cue, index) => {
    const lines = cue.lines.filter(line => line.trim().length > 0);
    if (!lines.length) { add('empty-cue', cue.id); return; }
    const before = index > 0 ? cues[index - 1] : null;
    if (before) {
      if (cue.startMs < before.startMs) add('out-of-order', cue.id);
      else if (cue.startMs < before.endMs) add('overlap', cue.id);
      else if (cue.startMs - before.endMs < gap) add('gap-too-small', cue.id);
    }
    const duration = cue.endMs - cue.startMs;
    if (duration < p.minDurationMs) add('too-short', cue.id);
    if (duration > p.maxDurationMs) add('too-long', cue.id);
    const chars = lines.join(' ').length;
    if (duration <= 0 || chars * 1000 > p.maxCps * duration) add('too-fast', cue.id);
    if (lines.some(line => line.length > p.maxLineChars)) add('line-too-long', cue.id);
    if (lines.length > p.maxLines) add('too-many-lines', cue.id);
    const words = lines.join(' ').split(' ').filter(Boolean).length;
    if (lines.length > 1 && words > lines.length && lines.some(line => !line.trim().includes(' '))) add('single-word-line', cue.id);
  });
  const timedWords = cues.length > 0 && cues.every(cue => Array.isArray(cue.words) && cue.words.length > 0);
  return { findings, notRun: timedWords || !cues.length ? [] : [{ check: 'pause-breaks', why: 'These cues have no word times, so breaks at pauses were not checked.' }] };
}

// ---------------------------------------------------------------------------
// SRT and VTT
// ---------------------------------------------------------------------------

const two = (value: number) => String(value).padStart(2, '0');
function stamp(ms: number, separator: ',' | '.'): string {
  const whole = Math.max(0, Math.round(ms));
  const hours = Math.floor(whole / 3_600_000), minutes = Math.floor(whole / 60_000) % 60, seconds = Math.floor(whole / 1000) % 60;
  return `${two(hours)}:${two(minutes)}:${two(seconds)}${separator}${String(whole % 1000).padStart(3, '0')}`;
}

/** A line of text made safe: & and < escaped so no player reads a tag, and an arrow escaped so no line reads as timing. */
export function escapeCueLine(line: string): string {
  return line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/-->/g, '--&gt;');
}
/** The cue's lines, escaped, with blank lines left out (a blank line would end the cue early). */
const cueText = (cue: CaptionCue) => cue.lines.map(line => line.replace(/[\r\n]+/g, ' ').trim()).filter(Boolean).map(escapeCueLine).join('\n');

/** The cues as an SRT file, numbered from 1. */
export function toSrt(cues: readonly CaptionCue[]): string {
  return cues.map((cue, index) => `${index + 1}\n${stamp(cue.startMs, ',')} --> ${stamp(cue.endMs, ',')}\n${cueText(cue)}\n`).join('\n');
}

/** The cues as a WebVTT file. */
export function toVtt(cues: readonly CaptionCue[]): string {
  return `WEBVTT\n\n${cues.map(cue => `${stamp(cue.startMs, '.')} --> ${stamp(cue.endMs, '.')}\n${cueText(cue)}\n`).join('\n')}`;
}

// Chausar 5B1 caption wiring. Kimo (MIT), original adapter over 5A4's caption core.
export { editCueWord as reviewCaptionWord };
/** Group only measured words from the current source, never stale derived timings. */
export function youtubeCaptions(input: { words: readonly TimedWord[]; profile: CaptionProfileId; sourceDigest: string; currentDigest: string }) {
  check(typeof input.sourceDigest === 'string' && input.sourceDigest.length > 0 && input.sourceDigest === input.currentDigest, 'DERIVED_STALE', 'The transcript changed. Make the captions again.');
  check(['web', 'broadcast', 'vertical'].includes(input.profile), 'INVALID_VENTURE_REQUEST', 'Choose web, broadcast or vertical captions.');
  const cues = groupCues(input.words, input.profile), validation = captionCoverage(cues, input.profile);
  return { cues, ...validation, srt: toSrt(cues), vtt: toVtt(cues), sourceDigest: input.sourceDigest };
}



/** Timed text checks never imply inspected caption positions or face boxes. */
export function captionCoverage(cues: readonly CaptionCue[], profile: CaptionProfileId) {
  const result = validateCues(cues, profile);
  return { findings: result.findings, notRun: [...result.notRun,
    { check: 'safe-area', why: 'Caption positions were not measured.' },
    { check: 'face-overlap', why: 'Face boxes were not supplied.' },
  ] };
}
