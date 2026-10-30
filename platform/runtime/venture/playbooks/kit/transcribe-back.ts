// Chausar playbook kit: transcribe-back (Ink v2 wave 5, package 5A4). A synthesized sentence (a narration line, a dub)
// is transcribed again and scored against the text it was made from, by code: word-level similarity in whole points,
// 0 to 100, from the edit distance between the two lists of words. 92 and up is approved, 85 to 91 goes to the owner
// for review, below that is made again; both thresholds are dated house rules (BACK_RULES). No model scores it.
// Written for Chausar; nothing here is learned from an outside source.
export {}; // Keep this scoring leaf browser-safe; the definition validates these inferred rule records.

export type BackVerdict = 'approved' | 'review' | 'retry';

const HOW = "Chausar's own house rule. Change it here, with a new date, when the owner asks for a stricter or looser check.";
/** The two thresholds, as dated house rules. */
export const BACK_RULES = Object.freeze([
  Object.freeze({
    id: 'transcribe-back.approve', scope: 'voice', topic: 'Checking a synthesized sentence', rule: 'A sentence heard back this close to its text is approved.',
    value: '92', unit: 'points of 100', sources: [], checkedOn: '2026-10-27', read: 'house' as const, how: HOW, usedBy: ['transcribe-back'], needs: null,
    limitations: 'Word-level only: a word said with the wrong stress or tone still counts as the same word.',
  }),
  Object.freeze({
    id: 'transcribe-back.review', scope: 'voice', topic: 'Checking a synthesized sentence', rule: 'Below approval but this close, the owner listens and decides; lower is made again.',
    value: '85', unit: 'points of 100', sources: [], checkedOn: '2026-10-27', read: 'house' as const, how: HOW, usedBy: ['transcribe-back'], needs: null,
    limitations: 'Word-level only: a word said with the wrong stress or tone still counts as the same word.',
  }),
]);
const APPROVE = Number(BACK_RULES[0]!.value);
const REVIEW = Number(BACK_RULES[1]!.value);

/** The words of a sentence, compared without case, punctuation or extra space (Hindi danda included). */
function wordsOf(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean);
}

/** The fewest words added, dropped or changed to turn one list into the other. */
function distance(a: readonly string[], b: readonly string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length]!;
}

/**
 * How close what was heard is to what was meant, in whole points (rounded down): the share of the expected words that
 * need no change, by edit distance. An empty expectation scores 100 only when nothing was heard.
 */
export function scoreBack(expected: string, heard: string): { score: number; verdict: BackVerdict } {
  const want = wordsOf(expected), got = wordsOf(heard);
  const score = want.length === 0 ? (got.length === 0 ? 100 : 0) : Math.max(0, Math.floor(((want.length - distance(want, got)) * 100) / want.length));
  return { score, verdict: score >= APPROVE ? 'approved' : score >= REVIEW ? 'review' : 'retry' };
}
