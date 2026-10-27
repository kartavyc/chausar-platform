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
import { check } from '../../../contracts.ts';
import type { DatedRule } from './define.ts';

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
        || word.endMs - current[0].startMs > profile.maxDurationMs;
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
    && b.at(-1)!.endMs - a[0].startMs <= profile.maxDurationMs && b[0].startMs - a.at(-1)!.endMs < profile.pauseMs;
  const out = runs.map(run => [...run]);
  for (let index = 0; index < out.length; index += 1) {
    if (out.length < 2 || out[index].length !== 1) continue;
    if (index + 1 < out.length && fits(out[index], out[index + 1])) {
      out[index + 1] = [...out[index], ...out[index + 1]];
      out.splice(index, 1);
      index -= 1;
    } else if (index > 0 && fits(out[index - 1], out[index])) {
      out[index - 1] = [...out[index - 1], ...out[index]];
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
    const clause = CLAUSE_END.test(words[split - 1]) || SENTENCE_END.test(words[split - 1]) ? 0 : 1;
    // Fit first, then no one-word line, then even lines, then a split after a clause.
    const score = over * 1_000_000 + single * 10_000 + Math.abs(lines[0].length - lines[1].length) * 10 + clause;
    if (!best || score < best.score) best = { lines, score };
  }
  return best!.lines;
}

/** Each run's time on screen: long enough to read and at least the shortest time, at most the longest, two frames before the next. */
function timed(runs: readonly TimedWord[][], profile: CaptionProfile): CaptionCue[] {
  const gap = gapOf(profile);
  return runs.map((run, index) => {
    const startMs = run[0].startMs;
    const lines = linesOf(run.map(word => word.text), profile);
    const chars = lines.join(' ').length;
    const nextStart = index + 1 < runs.length ? runs[index + 1][0].startMs : null;
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
