// Chausar flagship playbook, YouTube channel: the deterministic checks. Code only, no model, run before any judge.
// Each returns a plain sentence the owner can read. A scorer here is lint, not a forecast: the hook scorer's own author
// measured that it separates plainly bad hooks from real ones and barely separates hits from misses, so the gate only
// stops the plainly bad and lists the rest as notes.
//
// Ported, with changes, from Jakeschincariol/youtube-agent-skill (MIT, Copyright (c) 2026 Jake Schincariol):
// skills/yt-script/hookscore.py (hook properties and the 60/40 verdict), skills/yt-package/title.py (title and
// thumbnail pairing), skills/yt-chapters/chapters.py (chapter rules and drafting), skills/yt-retention/retention.py
// (hook leak, cliffs, slide) and skills/yt-edit/deadair.py (filler and restarts). Edit list snapping follows
// veedstudio/open-edit (Apache-2.0) cli/src/edl.ts: both edges move up to the next frame. Limits come from the dated
// register (platform-rules.ts), never from memory.
import { ChausarError } from '../../../contracts.ts';
import type { IsoDate, WorkTableRecord } from '../../contracts.ts';
import { requireRights, type FootageRights, type PlaybookIntake } from '../../delivery/rights.ts';
import { platformRule } from './platform-rules.ts';
import { offerAcceptsRights, YOUTUBE_STEPS, youtubeOffer, type YoutubeCheckId, type YoutubeOfferId } from './playbook.ts';
import { saidNear, type Cue } from './transcript.ts';

// ---------------------------------------------------------------------------
// Inputs and results
// ---------------------------------------------------------------------------

/** What the order is, from intake: set by code and the owner, never by an agent. */
export type YoutubeOrder = {
  offer: YoutubeOfferId;
  format: 'long' | 'short';
  rights: FootageRights | null;
  aiVoice: boolean;
  aiPresenter: boolean;
  paidPromotion: boolean;
};
/** The package an agent drafted. uploadSettings is the owner's publishing checklist. */
export type YoutubePackage = {
  title: string;
  thumbnailText: string | null;
  description: string;
  tags: string[];
  /** Candidate opening lines; the first is the one chosen, unless the scorer kept hooks in this run (keptHooks). */
  hooks: string[];
  /**
   * The hooks the scorer kept in this run (youtube.hooks, keptHooksOf), or absent or null when none were scored. With
   * them, every package hook must be a kept one, and the better scoring one is judged, not the first written.
   */
  keptHooks?: readonly string[] | null;
  pinnedComment: string | null;
  durationMs: number | null;
  uploadSettings: { aiUse: boolean; paidPromotion: boolean };
};
export type YoutubeCheckOutcome = 'pass' | 'fail' | 'not-run';
export type YoutubeCheckResult = { check: YoutubeCheckId; outcome: YoutubeCheckOutcome; detail: string; notes: string[] };

const result = (check: YoutubeCheckId, outcome: YoutubeCheckOutcome, detail: string, notes: string[] = []): YoutubeCheckResult => ({ check, outcome, detail, notes });

// ---------------------------------------------------------------------------
// Hook score (hookscore.py)
// ---------------------------------------------------------------------------

const HOOK_FILLER = new Set(['basically', 'actually', 'literally', 'just', 'really', 'very', 'so', 'kind', 'sort', 'like', 'guys', 'hey', 'welcome', 'today', 'video', 'subscribe', 'channel']);
const HOOK_VAGUE = new Set(['amazing', 'incredible', 'insane', 'crazy', 'huge', 'massive', 'game', 'changer', 'secret', 'powerful', 'ultimate', 'best', 'revolutionary', 'mind', 'blowing', 'unbelievable']);
const CONCRETE = /\b(\d[\d,.]*\s?(%|k|m|x|s|m|h)?|\$\d|\d+\s?(second|minute|hour|day|week|month|year)s?)\b/gi;
const YOU = /\b(you|your|you're|youre|yourself)\b/gi;
const STAKE = /\b(lose|lost|wasting|waste|quit|fail|broke|cost|risk|before|stop|never|die|dying|dead)\b/gi;
const CURIOSITY = /\b(why|how|what|which|until|before|but|nobody|almost|except|reason|actually)\b/gi;
const CLOSED = /\b(because|so that|which means)\b/i;

export type HookProperty = 'specificity' | 'address' | 'stakes' | 'curiosity' | 'brevity';
export type HookBand = 'strong' | 'workable' | 'weak';
export type HookScore = { hook: string; properties: Record<HookProperty, number>; verdict: number; band: HookBand; weakest: HookProperty; fix: string };

const HOOK_FIX: Readonly<Record<HookProperty, string>> = Object.freeze({
  specificity: 'Swap one adjective for a number, a name or a date.',
  address: "Say 'you' in the first six words.",
  stakes: 'Name what it costs them to keep doing it the current way.',
  curiosity: 'Cut the half of the sentence that answers itself.',
  brevity: 'Keep it between nine and twenty four words.',
});
/** Below this the hook reads as a greeting or a summary; the check fails. */
export const HOOK_FLOOR = 40;
const clamp = (value: number) => Math.max(0, Math.min(100, value));
const count = (pattern: RegExp, text: string) => (text.match(pattern) ?? []).length;
const hookWords = (text: string) => text.toLowerCase().match(/[a-z0-9'%$.]+/g) ?? [];
const spaced = (text: string) => text.split(/\s+/).filter(Boolean);
const startsUpper = (word: string) => { const first = word.slice(0, 1); return first !== first.toLowerCase() && first === first.toUpperCase(); };

function specificity(text: string): number {
  const words = hookWords(text);
  if (!words.length) return 0;
  const named = spaced(text).slice(1).filter(startsUpper).length;
  const score = 34 + count(CONCRETE, text) * 22 - words.filter(w => HOOK_VAGUE.has(w)).length * 16 - words.filter(w => HOOK_FILLER.has(w)).length * 5 + Math.min(18, 6 * named);
  return clamp(score);
}
const address = (text: string) => clamp(26 + count(YOU, text) * 20 + (count(YOU, spaced(text).slice(0, 6).join(' ')) ? 30 : 0));
const stakes = (text: string) => clamp(22 + count(STAKE, text) * 26 + (count(CONCRETE, text) ? 14 : 0));
const curiosity = (text: string) => clamp(24 + count(CURIOSITY, text) * 17 + (text.trim().endsWith('?') ? 18 : 0) - (CLOSED.test(text) ? 18 : 0));
function brevity(text: string): number {
  const n = hookWords(text).length;
  if (n === 0) return 0;
  if (n >= 9 && n <= 24) return 100;
  return n < 9 ? Math.max(30, 100 - (9 - n) * 11) : Math.max(10, 100 - (n - 24) * 7);
}

/**
 * Five properties from 0 to 100, and a verdict that is 60% their mean and 40% the weakest, so one dead property cannot
 * hide behind an average. In whole numbers: (3 x sum + 10 x weakest) / 25, rounded to the nearest (never a tie).
 */
export function hookScore(hook: string): HookScore {
  const properties: Record<HookProperty, number> = { specificity: specificity(hook), address: address(hook), stakes: stakes(hook), curiosity: curiosity(hook), brevity: brevity(hook) };
  const values = Object.values(properties);
  const sum = values.reduce((total, value) => total + value, 0);
  const low = Math.min(...values);
  const verdict = Math.floor((2 * (3 * sum + 10 * low) + 25) / 50);
  const weakest = (Object.keys(properties) as HookProperty[]).find(key => properties[key] === low)!;
  return { hook: hook.trim(), properties, verdict, band: verdict >= 72 ? 'strong' : verdict >= 55 ? 'workable' : 'weak', weakest, fix: HOOK_FIX[weakest] };
}

/** Hooks best first; equal verdicts keep the order they were written in. */
export function rankHooks(hooks: readonly string[], keep = hooks.length): HookScore[] {
  return hooks.map((hook, index) => ({ score: hookScore(hook), index })).sort((a, b) => b.score.verdict - a.score.verdict || a.index - b.index).slice(0, keep).map(item => item.score);
}

/** Two hooks are the same when only spacing and case differ: the scorer's duplicate rule and the kept-hook check. */
export function sameHook(a: string, b: string): boolean {
  return a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * With hooks the scorer kept: each package hook must be one of them, and the higher scoring of the package's hooks is
 * the one judged (ties keep the order written). The detail names the hook Chausar kept and the other's score.
 */
function keptHookCheck(hooks: readonly string[], kept: readonly string[]): YoutubeCheckResult {
  const written = hooks.filter(hook => hook.trim());
  if (!written.length) return result('hook-score', 'fail', 'The package has no opening hook.');
  const stray = written.find(hook => !kept.some(item => sameHook(item, hook)));
  if (stray) return result('hook-score', 'fail', `"${stray.trim().slice(0, 120)}": This hook is not one the scorer kept. Use the kept hooks word for word.`);
  const [best, ...others] = rankHooks(written);
  const notes = others.map(other => `"${other.hook.slice(0, 120)}" scores ${other.verdict} (${other.band}).`);
  if (best.verdict < HOOK_FLOOR) return result('hook-score', 'fail', `The better kept hook scores ${best.verdict}, which reads like a greeting or a summary. ${best.fix}`, notes);
  const over = others.length ? `, over "${others[0].hook.slice(0, 120)}", which scores ${others[0].verdict} (${others[0].band})` : '';
  const look = best.band === 'weak' ? ` It is weak on ${best.weakest}: ${best.fix}` : '';
  return result('hook-score', 'pass', `Chausar kept "${best.hook.slice(0, 120)}", which scores ${best.verdict} (${best.band})${over}.${look} A score is lint, not a forecast.`, notes);
}

function hookCheck(pkg: YoutubePackage): YoutubeCheckResult {
  if (pkg.keptHooks?.length) return keptHookCheck(pkg.hooks, pkg.keptHooks);
  const chosen = pkg.hooks[0];
  if (!chosen?.trim()) return result('hook-score', 'fail', 'The package has no opening hook.');
  const score = hookScore(chosen);
  const notes = pkg.hooks.slice(1).map(hook => { const other = hookScore(hook); return `Another hook scores ${other.verdict} (${other.band}).`; });
  if (score.verdict < HOOK_FLOOR) return result('hook-score', 'fail', `The opening hook scores ${score.verdict}, which reads like a greeting or a summary. ${score.fix}`, notes);
  const look = score.band === 'weak' ? ` It is weak on ${score.weakest}: ${score.fix}` : '';
  return result('hook-score', 'pass', `The opening hook scores ${score.verdict} (${score.band}).${look} A score is lint, not a forecast.`, notes);
}

// ---------------------------------------------------------------------------
// Title and thumbnail (title.py), metadata limits
// ---------------------------------------------------------------------------

const TITLE_DESKTOP = 60;
const TITLE_MOBILE = 40;
const TITLE_VAGUE = new Set(['amazing', 'incredible', 'insane', 'crazy', 'huge', 'massive', 'ultimate', 'best', 'powerful', 'secret', 'revolutionary', 'mindblowing', 'epic', 'perfect', 'complete', 'everything']);
const TITLE_STOP = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'and', 'or', 'is', 'are', 'with', 'your', 'you', 'my', 'i', 'this', 'that', 'it', 'how', 'what', 'why']);
const titleWords = (text: string) => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
const allCaps = (word: string) => word !== word.toLowerCase() && word === word.toUpperCase();
const chars = (text: string) => [...text].length;

export type TitleIssue = { kind: string; detail: string; blocks: boolean };
export type TitleReport = { title: string; chars: number; score: number; issues: TitleIssue[]; good: string[]; blocked: boolean };

/**
 * The pairing is the unit, not the title. Blocks: a title over YouTube's hard limit or with < or >, more than two
 * all-caps words, and a thumbnail that repeats the title's words. Notes: the desktop and mobile cuts, vague words,
 * no number, filler up front, a long thumbnail. The score (for ranking only) is the original's.
 */
export function titleThumbnail(title: string, thumbnail: string | null): TitleReport {
  const hard = platformRule('metadata-limits').limits.titleChars;
  const text = title.trim();
  const n = chars(text);
  const issues: TitleIssue[] = [];
  const good: string[] = [];
  const issue = (kind: string, detail: string, blocks = false) => issues.push({ kind, detail, blocks });
  if (n > hard) issue('length', `${n} characters. YouTube's limit is ${hard}.`, true);
  else if (n > TITLE_DESKTOP) issue('length', `${n} characters. Desktop search cuts near ${TITLE_DESKTOP}.`);
  else good.push(`${n} characters, inside the ${TITLE_DESKTOP} character desktop cut.`);
  if (n > TITLE_MOBILE) {
    const head = [...text].slice(0, TITLE_MOBILE).join('');
    const cut = head.includes(' ') ? head.slice(0, head.lastIndexOf(' ')) : head;
    issue('mobile', `A phone feed shows about "${cut}...". Check the subject survives.`);
  }
  const caps = spaced(text).filter(word => word.length > 2 && allCaps(word));
  if (caps.length > 2) issue('shouting', `${caps.length} all-caps words. Two is the ceiling before it reads as spam.`, true);
  else if (caps.length) good.push(`${caps.length} all-caps word for emphasis.`);
  const vague = [...new Set(titleWords(text).filter(word => TITLE_VAGUE.has(word)))].sort();
  if (vague.length) issue('vague', `${vague.join(', ')}. Swap for a number, a name or a date.`);
  const numbers = text.match(/\d[\d,.]*%?/g) ?? [];
  if (numbers.length) good.push(`Carries a concrete figure (${numbers.slice(0, 3).join(', ')}).`);
  else issue('no-number', 'No number, date or name. That is the most reliable single fix.');
  if (text.endsWith('?')) good.push('An open question in the title.');
  if (!titleWords(text).slice(0, 3).some(word => !TITLE_STOP.has(word))) issue('front-load', 'The first three words are all filler. Move the subject forward.');
  if (thumbnail && thumbnail.trim()) {
    const inTitle = new Set(titleWords(text).filter(word => !TITLE_STOP.has(word)));
    const shared = [...new Set(titleWords(thumbnail).filter(word => !TITLE_STOP.has(word) && inTitle.has(word)))].sort();
    if (shared.length) issue('duplicate', `The thumbnail repeats the title on ${shared.join(', ')}. The thumbnail should say what the title does not.`, true);
    else good.push('Thumbnail and title carry different words.');
    const thumbCount = titleWords(thumbnail).length;
    if (thumbCount > 4) issue('thumb-length', `${thumbCount} words on the thumbnail. Three is the ceiling at feed size.`);
  }
  if (/[<>]/.test(text)) issue('angle-brackets', 'YouTube refuses a title with < or >.', true);
  const score = clamp(100 - 14 * issues.length + 4 * good.length);
  return { title: text, chars: n, score, issues, good, blocked: issues.some(item => item.blocks) };
}

function titleCheck(pkg: YoutubePackage): YoutubeCheckResult {
  const report = titleThumbnail(pkg.title, pkg.thumbnailText);
  const notes = report.issues.filter(item => !item.blocks).map(item => item.detail);
  const blocking = report.issues.filter(item => item.blocks);
  return blocking.length
    ? result('title-thumbnail', 'fail', blocking.map(item => item.detail).join(' '), notes)
    : result('title-thumbnail', 'pass', `The title and thumbnail work as a pair (lint score ${report.score}).`, notes);
}

/** Tags count as YouTube counts them: commas between tags, and quotes around a tag with a space. */
export function tagsLength(tags: readonly string[]): number {
  return tags.reduce((total, tag, index) => total + chars(tag) + (/\s/.test(tag) ? 2 : 0) + (index ? 1 : 0), 0);
}

function metadataCheck(pkg: YoutubePackage): YoutubeCheckResult {
  const limits = platformRule('metadata-limits').limits;
  const problems: string[] = [];
  if (chars(pkg.title.trim()) > limits.titleChars) problems.push(`The title is longer than ${limits.titleChars} characters.`);
  const bytes = Buffer.byteLength(pkg.description, 'utf8');
  if (bytes > limits.descriptionBytes) problems.push(`The description is ${bytes} bytes; YouTube takes ${limits.descriptionBytes}.`);
  if (/[<>]/.test(pkg.title) || /[<>]/.test(pkg.description)) problems.push('YouTube refuses < and > in a title or description.');
  const tags = tagsLength(pkg.tags);
  if (tags > limits.tagsChars) problems.push(`The tags come to ${tags} characters; YouTube takes ${limits.tagsChars}.`);
  return problems.length ? result('metadata-limits', 'fail', problems.join(' ')) : result('metadata-limits', 'pass', 'The title, description and tags are inside YouTube\'s limits.');
}

// ---------------------------------------------------------------------------
// Chapters (chapters.py)
// ---------------------------------------------------------------------------

export type Chapter = { atMs: number; label: string; line: string };
const CHAPTER_LINE = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*(?:[-|:]\s*)?(.+?)\s*$/;

/** Every description line that starts with a timestamp, in the order written. */
export function parseChapters(description: string): Chapter[] {
  const chapters: Chapter[] = [];
  for (const line of description.split(/\r?\n/)) {
    const match = CHAPTER_LINE.exec(line);
    if (!match) continue;
    const [, hours, minutes, seconds, label] = match;
    if (Number(seconds) > 59 || (hours !== undefined && Number(minutes) > 59)) continue;
    chapters.push({ atMs: ((Number(hours ?? 0) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000, label, line: line.trim() });
  }
  return chapters;
}

export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** The platform's rules for chapters: the first at 0:00, at least three, in order, each at least ten seconds. */
export function chapterProblems(chapters: readonly Chapter[], durationMs: number | null): string[] {
  const rule = platformRule('chapters').limits;
  const minMs = rule.minimumSeconds * 1000;
  const problems: string[] = [];
  if (!chapters.length) return ['The description has no chapters.'];
  if (chapters[0].atMs !== rule.firstAtSeconds * 1000) problems.push(`The first chapter must start at 0:00, not ${clock(chapters[0].atMs)}.`);
  if (chapters.length < rule.minimumCount) problems.push(`YouTube needs at least three chapters; there are ${chapters.length}.`);
  for (let index = 1; index < chapters.length; index += 1) {
    const gap = chapters[index].atMs - chapters[index - 1].atMs;
    if (gap <= 0) { problems.push(`The chapter at ${clock(chapters[index].atMs)} is out of order.`); break; }
    if (gap < minMs) { problems.push(`The chapter at ${clock(chapters[index - 1].atMs)} is shorter than ten seconds.`); break; }
  }
  const last = chapters.at(-1)!;
  if (durationMs !== null && durationMs - last.atMs < minMs && !problems.some(line => /order/.test(line))) problems.push(`The last chapter, at ${clock(last.atMs)}, is shorter than ten seconds.`);
  return problems;
}

function chapterCheck(order: YoutubeOrder, pkg: YoutubePackage): YoutubeCheckResult {
  const chapters = parseChapters(pkg.description);
  const needed = order.format === 'long' && order.offer === 'episode-package';
  if (!chapters.length && !needed) return result('chapters', 'pass', 'This order needs no chapters.');
  const problems = chapterProblems(chapters, pkg.durationMs);
  return problems.length
    ? result('chapters', 'fail', `${problems.join(' ')} A list that breaks a rule does not show as chapters.`)
    : result('chapters', 'pass', `${chapters.length} chapters that YouTube will show.`);
}

const CHAPTER_STOP = new Set(('the a an of for to in on and or is are was were be been with this that it as at by from you your i my we our they them he she but so if then than there here what which who how when where why not no yes do does did just really very like about into over out up down can could will would should have has had get got make made go going went one two').split(' '));
const keywords = (text: string) => new Set((text.toLowerCase().match(/[a-z']{4,}/g) ?? []).filter(word => !CHAPTER_STOP.has(word)));

/**
 * First-draft chapters from the pauses actually taken: each gap is scored by its length and by how much the words change
 * across it, and the best are kept at least ten seconds apart. Titles are topic words to retitle, not the owner's words.
 */
export function draftChapters(cues: readonly Cue[], target = 7): { valid: boolean; chapters: (Chapter & { lengthMs: number })[] } {
  if (cues.length < 6) return { valid: false, chapters: [] };
  const minMs = platformRule('chapters').limits.minimumSeconds * 1000;
  const duration = cues.at(-1)!.endMs;
  const candidates: { score: number; at: number }[] = [];
  for (let i = 1; i < cues.length; i += 1) {
    const gap = cues[i].startMs - cues[i - 1].endMs;
    const before = keywords(cues.slice(Math.max(0, i - 12), i).map(cue => cue.text).join(' '));
    const after = keywords(cues.slice(i, i + 12).map(cue => cue.text).join(' '));
    const union = new Set([...before, ...after]);
    const shared = [...before].filter(word => after.has(word)).length;
    const shiftPermille = union.size ? 1000 - Math.floor((1000 * shared) / union.size) : 0;
    // The original weighs a second of gap at 1.6 and a full change of words at 3.2: in milliseconds, gap + 2 x shift.
    candidates.push({ score: gap + 2 * shiftPermille, at: cues[i].startMs });
  }
  candidates.sort((a, b) => b.score - a.score || b.at - a.at);
  const picked = [0];
  for (const candidate of candidates) {
    if (picked.length >= target) break;
    if (picked.every(at => Math.abs(candidate.at - at) >= minMs) && duration - candidate.at >= minMs) picked.push(candidate.at);
  }
  picked.sort((a, b) => a - b);
  const chapters = picked.map((at, index) => {
    const end = picked[index + 1] ?? duration;
    const text = cues.filter(cue => cue.startMs >= at && cue.endMs <= end).map(cue => cue.text).join(' ').toLowerCase();
    const words = [...keywords(text)].sort((a, b) => text.split(b).length - text.split(a).length);
    const label = words.slice(0, 3).map(word => word[0].toUpperCase() + word.slice(1)).join(' ') || 'Section';
    return { atMs: at, label, line: `${clock(at)} ${label}`, lengthMs: end - at };
  });
  return { valid: chapterProblems(chapters, duration).length === 0, chapters };
}

// ---------------------------------------------------------------------------
// Retention risks from a transcript (deadair.py), and the Studio export (retention.py)
// ---------------------------------------------------------------------------

/** A silence this long is where viewers leave. It matches the finishing check's silence length. */
export const DEAD_AIR_MS = 2000;
/** The opening, where a greeting or a channel plug leaks the hook. */
export const OPENING_MS = 30000;
const FILLER_ONLY = /^[\s,.-]*((um+|uh+|er+|ah+|so|okay|ok|right|yeah|like|anyway|basically|actually|you know|i mean|let me see|hold on)[\s,.-]*)+$/i;
const INTRO_FILLER = /\b(welcome back|welcome to (my|the|our) channel|hey guys|hi guys|hello everyone|before we (get )?start(ed)?|like and subscribe|smash that like|don't forget to subscribe|subscribe to (my|the|our) channel)\b/i;
const norm = (text: string) => text.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean);

export type RetentionFinding = { kind: 'late-start' | 'intro-filler' | 'dead-air' | 'filler' | 'restart'; severity: 'cliff' | 'trim'; atMs: number; endMs: number; detail: string };

/**
 * Likely drop points before publishing. Cliffs: speech that starts late, a greeting or channel plug in the opening,
 * and a silence of two seconds or more. Trims: a line that is only filler, and a restarted sentence (the first take).
 */
export function retentionRisks(cues: readonly Cue[]): RetentionFinding[] {
  const findings: RetentionFinding[] = [];
  if (!cues.length) return findings;
  if (cues[0].startMs >= DEAD_AIR_MS) findings.push({ kind: 'late-start', severity: 'cliff', atMs: 0, endMs: cues[0].startMs, detail: `Nothing is said until ${clock(cues[0].startMs)}.` });
  cues.forEach((cue, index) => {
    if (cue.startMs < OPENING_MS && INTRO_FILLER.test(cue.text)) {
      findings.push({ kind: 'intro-filler', severity: 'cliff', atMs: cue.startMs, endMs: cue.endMs, detail: `The opening spends time on "${cue.text.slice(0, 60)}" before the hook.` });
    }
    if (FILLER_ONLY.test(cue.text)) findings.push({ kind: 'filler', severity: 'trim', atMs: cue.startMs, endMs: cue.endMs, detail: `Only filler at ${clock(cue.startMs)}: "${cue.text.slice(0, 48)}".` });
    if (index) {
      const gap = cue.startMs - cues[index - 1].endMs;
      if (gap >= DEAD_AIR_MS) findings.push({ kind: 'dead-air', severity: 'cliff', atMs: cues[index - 1].endMs, endMs: cue.startMs, detail: `${clock(gap)} of silence at ${clock(cues[index - 1].endMs)}.` });
    }
    if (cue.text.trim() && !FILLER_ONLY.test(cue.text)) {
      // A restart is compared with the last line that was speech, so a retake with an "um" between still counts.
      let previous = index - 1;
      while (previous >= 0 && (FILLER_ONLY.test(cues[previous].text) || !cues[previous].text.trim())) previous -= 1;
      if (previous >= 0) {
        const a = norm(cues[previous].text).slice(0, 5), b = norm(cue.text).slice(0, 5);
        if (a.length >= 3 && a.join(' ') === b.join(' ')) {
          findings.push({ kind: 'restart', severity: 'trim', atMs: cues[previous].startMs, endMs: cues[previous].endMs, detail: `A restart of "${a.join(' ')}" at ${clock(cues[previous].startMs)}; cut the first take.` });
        }
      }
    }
  });
  return findings.sort((x, y) => x.atMs - y.atMs);
}

function retentionCheck(cues: readonly Cue[] | null): YoutubeCheckResult {
  if (!cues) return result('retention-risk', 'not-run', 'not run: no transcript for this order.');
  if (!cues.length) return result('retention-risk', 'not-run', 'not run: the transcript had no readable lines.');
  const findings = retentionRisks(cues);
  const cliffs = findings.filter(item => item.severity === 'cliff');
  const notes = findings.filter(item => item.severity === 'trim').map(item => item.detail);
  return cliffs.length
    ? result('retention-risk', 'fail', `${cliffs.length === 1 ? 'One likely drop point' : `${cliffs.length} likely drop points`}. ${cliffs[0].detail}`, [...cliffs.slice(1).map(item => item.detail), ...notes])
    : result('retention-risk', 'pass', 'No long silence and no greeting before the hook.', notes);
}

export type RetentionCliff = { from: string; to: string; lost: string; atSeconds: number | null; said: string | null };
export type RetentionReport = { points: number; start: string; end: string; hookLeak: string; verdict: 'healthy' | 'leaking' | 'severe'; cliffs: RetentionCliff[]; slidePerUnit: string };

/** A decimal cell in hundredths, for example "92.5%" is 9250. Null when the cell is not a number. */
function hundredths(cell: string): number | null {
  const text = cell.trim().replace(/%/g, '').replace(/,/g, '');
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const value = Number(whole) * 100 + Number((fraction + '00').slice(0, 2)) + (Number(fraction.slice(2, 3) || '0') >= 5 ? 1 : 0);
  return sign ? -value : value;
}
const decimal = (value: number, places = 2) => {
  const scale = 10 ** places;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / scale)}.${String(abs % scale).padStart(places, '0')}`;
};

/**
 * Reads a YouTube Studio audience retention export (a position, as a percent of the video or in seconds, and the
 * percent still watching). Reports the hook leak (lost in the first thirty seconds), the five steepest drops over
 * 0.8 points with what was said there when a transcript is given, and the steady slide across the middle. Figures are
 * code-worked in hundredths and shown as text; a model only explains them.
 */
export function readRetentionExport(csv: string, options: { durationMs?: number | null; cues?: readonly Cue[] } = {}): RetentionReport {
  const rows: [number, number][] = [];
  for (const line of csv.replace(/^﻿/, '').split(/\r?\n/)) {
    const numbers = line.split(',').map(hundredths).filter((value): value is number => value !== null);
    if (numbers.length >= 2) rows.push([numbers[0], numbers[1]]);
  }
  if (rows.length < 8) throw new ChausarError('INVALID_VENTURE_REQUEST', 'The retention export needs at least eight data points.');
  const duration = options.durationMs ?? null;
  const percentAxis = Math.max(...rows.map(row => row[0])) <= 10050;
  // In hundredths of the axis unit: thirty seconds, or a tenth of the video when only percent is known.
  const cutoff = !percentAxis ? 3000 : duration ? Math.floor((30000 * 10000) / duration) : 1000;
  const start = rows[0][1] || 10000;
  const hookEnd = Math.min(start, ...rows.filter(row => row[0] <= cutoff).map(row => row[1]));
  const hookLeak = start - hookEnd;
  const drops = rows.slice(1).map((row, index) => {
    const before = rows[index];
    return { lost: before[1] - row[1], span: row[0] - before[0] || 1, from: before[0], to: row[0] };
  });
  // Steepest first, compared exactly by cross-multiplying, ties to the later position as the original sorts.
  const steep = [...drops].sort((a, b) => (b.lost * a.span - a.lost * b.span) || b.from - a.from);
  const atSeconds = (x: number) => !percentAxis ? Math.floor(x / 100) : duration ? Math.floor((x * duration) / 10000 / 1000) : null;
  const cliffs = steep.slice(0, 5).filter(drop => drop.lost > 80).map(drop => {
    const at = atSeconds(drop.from);
    return { from: decimal(drop.from), to: decimal(drop.to), lost: decimal(drop.lost), atSeconds: at, said: at !== null && options.cues ? saidNear(options.cues, at * 1000) : null };
  });
  const middle = drops.filter(drop => drop.from > cutoff);
  // The mean drop per axis unit across the middle, in thousandths.
  const slide = middle.length ? Math.floor(middle.reduce((total, drop) => total + Math.floor((drop.lost * 1000) / drop.span), 0) / middle.length) : 0;
  return {
    points: rows.length, start: decimal(start), end: decimal(rows.at(-1)![1]), hookLeak: decimal(hookLeak),
    verdict: hookLeak < 2500 ? 'healthy' : hookLeak < 4000 ? 'leaking' : 'severe', cliffs, slidePerUnit: decimal(slide, 3),
  };
}

// ---------------------------------------------------------------------------
// Disclosure, paid promotion, rights and source credit
// ---------------------------------------------------------------------------

function disclosureCheck(order: YoutubeOrder, pkg: YoutubePackage): YoutubeCheckResult {
  const needed = [order.aiVoice ? 'AI voice' : null, order.aiPresenter ? 'AI presenter' : null].filter((item): item is string => item !== null);
  if (!needed.length) return result('ai-disclosure', 'pass', 'This order uses no AI voice or presenter.');
  const text = pkg.description.toLowerCase();
  const missing = needed.filter(phrase => !text.includes(phrase.toLowerCase()));
  const problems: string[] = [];
  if (missing.length) problems.push(`The description must say the video uses an ${missing.join(' and an ')}.`);
  if (!pkg.uploadSettings.aiUse) problems.push('The AI use setting must be ticked at upload.');
  return problems.length ? result('ai-disclosure', 'fail', problems.join(' ')) : result('ai-disclosure', 'pass', `The ${needed.join(' and ')} is disclosed in the description and at upload.`);
}

function paidPromotionCheck(order: YoutubeOrder, pkg: YoutubePackage): YoutubeCheckResult {
  if (!order.paidPromotion) return result('paid-promotion', 'pass', 'This order has no paid promotion.');
  return pkg.uploadSettings.paidPromotion
    ? result('paid-promotion', 'pass', 'The paid promotion setting is ticked for upload.')
    : result('paid-promotion', 'fail', 'This video has paid promotion: tick the paid promotion setting at upload.');
}

const CLIPPING_STEP = YOUTUBE_STEPS.find(step => step.clipping)!;

function rightsCheck(order: YoutubeOrder, today: IsoDate): YoutubeCheckResult {
  const offer = youtubeOffer(order.offer);
  try {
    const rights = requireRights(CLIPPING_STEP, { rights: order.rights } as PlaybookIntake, today)!;
    if (!offerAcceptsRights(order.offer, rights.basis)) {
      const wanted = order.offer === 'licensed-clips' ? 'a licence or the creator\'s clip programme' : 'the client\'s own footage';
      return result('rights-recorded', 'fail', `${offer.name} needs ${wanted}, recorded at intake.`);
    }
    return result('rights-recorded', 'pass', 'The rights to the footage are recorded at intake.');
  } catch (error) {
    if (error instanceof ChausarError && error.code === 'RIGHTS_REQUIRED') return result('rights-recorded', 'fail', error.message);
    throw error;
  }
}

function sourceCreditCheck(order: YoutubeOrder, pkg: YoutubePackage): YoutubeCheckResult {
  if (order.offer !== 'licensed-clips') return result('source-credit', 'pass', 'Not a clip order; no source credit is needed.');
  const rights = order.rights;
  if (!rights) return result('source-credit', 'fail', 'There are no rights recorded to credit.');
  const text = pkg.description.toLowerCase();
  const missing = [rights.holder, rights.reference].filter((item): item is string => !!item && !text.includes(item.toLowerCase()));
  return missing.length
    ? result('source-credit', 'fail', `The description must credit ${rights.holder} and name the licence or programme (${rights.reference}).`)
    : result('source-credit', 'pass', `The description credits ${rights.holder} under ${rights.reference}.`);
}

// ---------------------------------------------------------------------------
// The edit list
// ---------------------------------------------------------------------------

export type EditRange = { from: string; to: string; startFrame: number; endFrame: number };
export type EditList = { fps: number; ranges: EditRange[]; runtimeFrames: number };

/**
 * The assemble step: ranges named only by transcript segment ids, checked (known ids, in order, no overlap), with both
 * edges moved up to the next frame. Cutting footage is clipping, so the rights recorded at intake are required first.
 */
export function buildEditList(cues: readonly Cue[], picks: readonly { from: string; to: string }[], options: { fps: number; intake: Partial<PlaybookIntake> | null; today: IsoDate }): EditList {
  requireRights(CLIPPING_STEP, options.intake, options.today);
  const bad = (message: string): never => { throw new ChausarError('INVALID_VENTURE_REQUEST', message); };
  if (!Number.isInteger(options.fps) || options.fps < 1 || options.fps > 240) bad('Give the frame rate as a whole number of frames a second.');
  if (!picks.length) bad('The edit list has no ranges.');
  const at = new Map(cues.map((cue, index) => [cue.id, index]));
  const up = (ms: number) => Math.floor((ms * options.fps + 999) / 1000);
  const ranges: EditRange[] = [];
  const used: [number, number][] = [];
  for (const pick of picks) {
    const first = at.get(pick.from), last = at.get(pick.to);
    if (first === undefined) bad(`There is no transcript segment ${pick.from}.`);
    if (last === undefined) bad(`There is no transcript segment ${pick.to}.`);
    if (last! < first!) bad(`The range ends at ${pick.to}, before it starts at ${pick.from}.`);
    if (used.some(([a, b]) => first! <= b && last! >= a)) bad(`The range ${pick.from} to ${pick.to} overlaps another range.`);
    used.push([first!, last!]);
    const startFrame = up(cues[first!].startMs), endFrame = up(cues[last!].endMs);
    if (endFrame <= startFrame) bad(`The range ${pick.from} to ${pick.to} is shorter than one frame.`);
    ranges.push({ from: pick.from, to: pick.to, startFrame, endFrame });
  }
  return { fps: options.fps, ranges, runtimeFrames: ranges.reduce((total, range) => total + range.endFrame - range.startFrame, 0) };
}

// ---------------------------------------------------------------------------
// The tables the YouTube tools make in a run (delivery/harness/tools-youtube.ts)
// ---------------------------------------------------------------------------

/** Each YouTube tool's table: its name and columns. The checks and the write step read them by the tool that made them. */
export const YOUTUBE_TABLES = Object.freeze({
  hooks: Object.freeze({ tool: 'youtube.hooks', name: 'Hooks the scorer kept', columns: Object.freeze(['Hook', 'Score', 'Band', 'Weakest', 'Fix']) }),
  editList: Object.freeze({ tool: 'youtube.editList', name: 'Edit list', columns: Object.freeze(['From', 'To', 'Start frame', 'End frame']) }),
  chapters: Object.freeze({ tool: 'youtube.chapters', name: 'Chapters drafted from the pauses', columns: Object.freeze(['At', 'Label', 'Length']) }),
  retention: Object.freeze({ tool: 'youtube.retention', name: 'Where viewers left', columns: Object.freeze(['From', 'To', 'Lost', 'At', 'Said']) }),
} as const);

type MadeTable = Pick<WorkTableRecord, 'source' | 'rows'>;
/** The newest table a tool made in the run, or undefined. */
function newestBy(tables: readonly MadeTable[], tool: string): MadeTable | undefined {
  return [...tables].reverse().find(table => table.source.kind === 'computed' && table.source.tool === tool);
}

/** The hooks the scorer kept in a run: the Hook column of the newest hooks table, or null when no hooks were scored. */
export function keptHooksOf(tables: readonly MadeTable[]): string[] | null {
  const table = newestBy(tables, YOUTUBE_TABLES.hooks.tool);
  return table ? table.rows.map(row => row.cells.Hook ?? '').filter(hook => hook.trim()) : null;
}

/** The chapter start times code drafted in a run (the At column of the newest chapters table), such as 0:00 and 1:35. */
export function chapterTimesOf(tables: readonly MadeTable[]): string[] {
  const table = newestBy(tables, YOUTUBE_TABLES.chapters.tool);
  return table ? table.rows.map(row => row.cells.At ?? '').filter(at => /^\d{1,2}(?::\d{2}){1,2}$/.test(at)) : [];
}

// ---------------------------------------------------------------------------
// The package as text, and running the checks
// ---------------------------------------------------------------------------

const LABELS: Readonly<Record<string, 'title' | 'thumbnailText' | 'pinnedComment' | 'tags' | 'description'>> = Object.freeze({
  title: 'title', thumbnail: 'thumbnailText', 'thumbnail text': 'thumbnailText', 'pinned comment': 'pinnedComment', tags: 'tags', description: 'description',
});

/** A package written as labelled lines: Title, Thumbnail, Pinned comment and Tags on one line; Description runs on. */
export function parsePackageText(text: string): Pick<YoutubePackage, 'title' | 'thumbnailText' | 'description' | 'pinnedComment' | 'tags'> {
  const out = { title: '', thumbnailText: null as string | null, description: '', pinnedComment: null as string | null, tags: [] as string[] };
  let inDescription = false;
  const description: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z ]{4,16}):\s*(.*)$/.exec(line);
    const field = match ? LABELS[match[1].trim().toLowerCase()] : undefined;
    if (field) {
      inDescription = field === 'description';
      const value = match![2].trim();
      if (field === 'description') { if (value) description.push(value); }
      else if (field === 'tags') out.tags = value.split(',').map(tag => tag.trim()).filter(Boolean);
      else if (field === 'title') out.title = value;
      else out[field] = value || null;
      continue;
    }
    if (inDescription) description.push(line);
  }
  out.description = description.join('\n').trim();
  return out;
}

export type YoutubeCheckInput = {
  checks: readonly YoutubeCheckId[];
  order: YoutubeOrder;
  pkg: YoutubePackage;
  transcript: readonly Cue[] | null;
  today: IsoDate;
  /** The finishing check's result for the cut, when one ran (finishing.ts). */
  finishing?: YoutubeCheckResult | null;
};

/** One result per requested check, in the order asked. */
export function runYoutubeChecks(input: YoutubeCheckInput): YoutubeCheckResult[] {
  return input.checks.map(id => {
    switch (id) {
      case 'hook-score': return hookCheck(input.pkg);
      case 'title-thumbnail': return titleCheck(input.pkg);
      case 'metadata-limits': return metadataCheck(input.pkg);
      case 'chapters': return chapterCheck(input.order, input.pkg);
      case 'retention-risk': return retentionCheck(input.transcript);
      case 'ai-disclosure': return disclosureCheck(input.order, input.pkg);
      case 'paid-promotion': return paidPromotionCheck(input.order, input.pkg);
      case 'rights-recorded': return rightsCheck(input.order, input.today);
      case 'source-credit': return sourceCreditCheck(input.order, input.pkg);
      case 'finishing': return input.finishing ?? result('finishing', 'not-run', 'not run: no finishing check for this cut.');
      case 'caption-file': case 'script-coverage': case 'cleanup': return result(id, 'not-run', 'not run: the measured word-edit tool has not completed.');
    }
  });
}

/** Any failure fails; then any check that did not run leaves the package incomplete, never passed. */
export function youtubeChecksOutcome(results: readonly YoutubeCheckResult[]): 'pass' | 'fail' | 'incomplete' {
  if (results.some(item => item.outcome === 'fail')) return 'fail';
  return results.some(item => item.outcome === 'not-run') ? 'incomplete' : 'pass';
}
