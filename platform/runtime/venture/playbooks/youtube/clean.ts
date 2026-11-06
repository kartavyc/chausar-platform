// Chausar 5B1 cleanup. Tomada (AGPL), FilmCraft (MIT/Apache-2.0), ideas only; original code.
import { check } from '../../../contracts.ts';
import { platformRule } from './platform-rules.ts';
import { validateEditDocument, type EditDocument, type EditWord } from './edit-ops.ts';
export type QuietSpan = { startMs: number; endMs: number };
export type CleanupCut = QuietSpan & { from: string; to: string; reason: 'silence' | 'hesitation' };
export type CleanupInput = {
  document: EditDocument; micQuiet: readonly QuietSpan[]; systemQuiet: readonly QuietSpan[]; vadQuiet: readonly QuietSpan[];
  loudness: readonly (QuietSpan & { db: number })[]; vertical?: boolean; sources?: readonly { fps: string; colour: string }[];
};
const cleanupLimits = () => platformRule('cleanup-thresholds').limits;
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
  const first = words[0], lastWord = words.at(-1);
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
