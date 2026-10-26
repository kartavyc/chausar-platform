// Chausar venture launcher, agents (Ink v2 wave 4, package 4J18, catalogue A10): what a run reads from what the AI
// knows. Each act turn and each writing turn of a real order carries, in its input and never in its instructions, the
// sources that share words with the turn's own work (the order's request, the offer's name and that turn's steps'
// titles and guidance; by code, no model): at most three, each cut to its share of a fixed budget, as background the
// agent can't take as instructions (delivery/harness/loop.ts puts them in the input and its KNOWLEDGE_BACKGROUND,
// Chausar's own words, in the instructions). Each carried item names its source's version. What is carried is read
// through the untrusted screen again (enforce), and a source the screen holds (by the whole of it, once per version)
// is never sent; the page names why. The turn keeps the ids its approved text carried (sourcesCarried), and a turn
// whose text carries a source removed, changed (its version) or held since is made again before it can go
// (staleSources, read again just before the send). Words are indexed once per source version. The words rules here
// are the ones the page's own search uses (agents/knowledge.ts). Reads only, so the delivery harness can load it
// without the agents package.
import { hash, type State } from '../../contracts.ts';
import type { KnowledgeRecord, PlaybookStep, ScreenNote, VentureRecord } from '../contracts.ts';
import { listRecords } from '../records.ts';
import { screenUntrusted, type ScreenResult, type UntrustedSource } from '../policy/untrusted.ts';
import { short } from '../views/shared.ts';
import { topicWords } from './recall.ts';

/** The most sources one turn carries, and the most characters it carries from one. */
export const TURN_SOURCES = 3;
export const SOURCE_TURN_CHARS = 800;
/** The owner's words when a turn waiting for approval carried a source removed, changed or held since. */
export const SOURCES_CHANGED = 'A source this step carried was removed or changed, so Chausar made the step again with what the AI knows now. Read it again.';
/** Words that carry no topic in a question or a request, beyond the note recall's own list (recall.ts topicWords). */
const QUESTION_WORDS: ReadonlySet<string> = new Set([
  'much', 'many', 'long', 'where', 'shall', 'may', 'might', 'must', 'okay', 'yes', 'sure', 'tell', 'know', 'think', 'use', 'used', 'using', 'take', 'takes',
  'give', 'gives', 'gets', 'goes', 'come', 'comes', 'kind', 'thing', 'things', 'something', 'anything', 'able', 'doing', 'client', 'clients', 'order', 'orders',
  'question', 'questions', 'answer', 'answers', 'send', 'sent', 'right', 'best', 'good', 'well',
]);
/** How the screen names where each kind of source came from. */
export const SCREEN_SOURCE: Readonly<Record<KnowledgeRecord['sourceKind'], UntrustedSource>> = Object.freeze({
  link: 'web-page', file: 'client-file', text: 'tool-output', 'past-work': 'tool-output',
});
/** What the screen holds a source for, in the owner's words. */
const HELD_WORDS: Readonly<Record<string, string>> = Object.freeze({
  injection: 'words aimed at an agent', checker: 'words aimed at a checker', hidden: 'hidden characters that can hide words from you', error: 'something the screen could not check',
});
const ACT_KINDS: ReadonlySet<PlaybookStep['kind']> = new Set(['gather', 'question', 'work']);
/** The most characters of words the recall cache keeps in memory, in all. */
export const INDEX_CHAR_LIMIT = 8 * 1024 * 1024;

/** "a", "a and b", "a, b and c". */
export const listWords = (items: readonly string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** Why the screen held something, in words, in its findings' order; empty when it held nothing. */
export function heldReasons(result: Pick<ScreenResult, 'status' | 'findings'>): string[] {
  if (result.status !== 'quarantined') return [];
  const reasons = [...new Set(result.findings.map(finding => HELD_WORDS[finding.kind]).filter((words): words is string => !!words))];
  return reasons.length ? reasons : [HELD_WORDS.error];
}

/** A word compared with others: an English plural taken back to its one (refunds, deliveries), other words as they are. */
function stem(word: string): string {
  if (!/^[a-z]+$/.test(word)) return word;
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** capital: written with a capital letter where no sentence starts, as a name is. */
export type Token = { surface: string; stem: string; at: number; capital: boolean };

/** The words of a text that can name a topic, in order, each with its place among all the text's words. */
export function contentTokens(text: string): Token[] {
  const source = text.normalize('NFC');
  const topics = topicWords(source);
  const tokens: Token[] = [];
  let at = -1;
  for (const match of source.matchAll(/[\p{L}\p{M}\p{Nd}]+/gu)) {
    at += 1;
    const word = match[0].toLowerCase();
    if (!topics.has(word) || QUESTION_WORDS.has(word) || /^\p{Nd}+$/u.test(word)) continue;
    const start = /(?:^|[.!?।]|\n)[\s"'(]*$/u.test(source.slice(0, match.index));
    tokens.push({ surface: word, stem: stem(word), at, capital: /^\p{Lu}/u.test(match[0]) && !start });
  }
  return tokens;
}

export const stemsOf = (text: string): Set<string> => new Set(contentTokens(text).map(token => token.stem));
export const sharedCount = (a: ReadonlySet<string>, b: ReadonlySet<string>) => [...a].filter(word => b.has(word)).length;
/** A text's sentences: its lines, split at a full stop, a question or exclamation mark or a danda followed by a space. */
export const sentencesOf = (text: string) => text.split(/\n+/).flatMap(line => line.split(/(?<=[.!?।])\s+/u)).map(item => item.trim()).filter(Boolean);

/** A source's version: its id, title and words, so a changed source is a new version. */
export const versionOf = (record: Pick<KnowledgeRecord, 'id' | 'title' | 'text'>): string => hash(`${record.id}\n${record.title}\n${record.text}`).slice(0, 16);

/** Where each of a text's sentences sits in it (sentencesOf's split, as offsets), so the cache keeps no copy of the words. */
function sentenceSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const line of text.matchAll(/[^\n]+/g)) {
    let from = line.index;
    for (const piece of line[0].split(/(?<=[.!?।])(\s+)/u)) {
      if (/^\s+$/u.test(piece) || !piece) { from += piece.length; continue; }
      const lead = piece.length - piece.trimStart().length, trimmed = piece.trim();
      if (trimmed) spans.push({ start: from + lead, end: from + lead + trimmed.length });
      from += piece.length;
    }
  }
  return spans;
}

/** One source version's index: its stems, its sentences by offset with their stems, why the screen holds it, and its size. */
type Indexed = { id: string; stems: Set<string>; sentences: { start: number; end: number; stems: Set<string> }[]; held: string[]; chars: number };
const INDEX = new Map<string, Indexed>();
let indexChars = 0;

const sizeOf = (stems: Iterable<string>) => { let chars = 0; for (const word of stems) chars += word.length; return chars; };

/**
 * A source's words, indexed once per version: its stems, its sentences (offsets into its text) with theirs, and why
 * the screen holds it, if it does. The cache holds at most INDEX_CHAR_LIMIT characters of stems; the oldest go first.
 */
function indexed(record: KnowledgeRecord): Indexed {
  const key = `${record.id}:${versionOf(record)}`;
  const found = INDEX.get(key);
  if (found) return found;
  const sentences = sentenceSpans(record.text).map(span => ({ ...span, stems: stemsOf(record.text.slice(span.start, span.end)) }));
  const stems = stemsOf(`${record.title}\n${record.text}`);
  const made: Indexed = {
    id: record.id, stems, sentences,
    held: heldReasons(screenUntrusted({ source: SCREEN_SOURCE[record.sourceKind] ?? 'tool-output', text: `${record.title}\n${record.text}` }, { mode: 'enforce' })),
    chars: sizeOf(stems) + sentences.reduce((sum, sentence) => sum + sizeOf(sentence.stems), 0),
  };
  INDEX.set(key, made);
  indexChars += made.chars;
  for (const [oldest, entry] of INDEX) {
    if (indexChars <= INDEX_CHAR_LIMIT || oldest === key) break;
    INDEX.delete(oldest);
    indexChars -= entry.chars;
  }
  return made;
}

/** Drops every cached version of a source, so a removed or forgotten source leaves no copy of its words in memory. */
export function forgetCached(sourceId: string): void {
  for (const [key, entry] of INDEX) {
    if (entry.id !== sourceId) continue;
    INDEX.delete(key);
    indexChars -= entry.chars;
  }
}

/** The ids of the sources the cache holds now (for tests). */
export const cachedSourceIds = (): string[] => [...new Set([...INDEX.values()].map(entry => entry.id))];

/** A sentence's words, read from the source itself. */
const sentenceText = (record: KnowledgeRecord, sentence: { start: number; end: number }) => record.text.slice(sentence.start, sentence.end);

/** Why the screen holds a source as a run would read it, or an empty list when it does not. */
export const sourceHeld = (record: KnowledgeRecord): string[] => indexed(record).held;

/** The sources in use (not removed), in the order they were added. */
export function liveSources(state: State, venture: VentureRecord): KnowledgeRecord[] {
  return listRecords(state, 'venture-knowledge', venture.id).filter(record => record.removedAt === null);
}

export type Scored = { record: KnowledgeRecord; shared: number; line: string; index: number };

/** The sources that share words with a text, the most shared first and then the newest, each with its best sentence. */
export function scoreSources(records: readonly KnowledgeRecord[], text: string): Scored[] {
  const asked = stemsOf(text);
  if (!asked.size) return [];
  return records.flatMap((record, index) => {
    const words = indexed(record);
    const shared = sharedCount(words.stems, asked);
    if (!shared) return [];
    let line = '', best = 0;
    for (const sentence of words.sentences) {
      const count = sharedCount(sentence.stems, asked);
      if (count > best) { best = count; line = sentenceText(record, sentence); }
    }
    const first = words.sentences[0] ? sentenceText(record, words.sentences[0]) : '';
    return [{ record, shared, line: short(line || first || record.title, 200), index }];
  }).sort((a, b) => b.shared - a.shared || b.index - a.index);
}

/**
 * What one turn's work is, as the words its sources are matched on: the order's request, the offer's name, and the
 * titles and guidance of the steps the turn works on (the act steps, or the writing steps and the drafting guidance).
 */
export function turnQuery(phase: 'act' | 'write', steps: readonly PlaybookStep[], request: string, offerName: string, draftGuidance?: readonly string[] | null): string {
  const own = steps.filter(step => (phase === 'act' ? ACT_KINDS.has(step.kind) : step.kind === 'write'));
  const guidance = phase === 'write' && draftGuidance ? [...draftGuidance] : own.flatMap(step => step.guidance ?? []);
  return [request, offerName, ...own.map(step => step.title), ...guidance].join('\n');
}

/**
 * The part of one source a turn carries for these words: its sentences that share a word with them, in order (or,
 * when only its title does, its opening sentences), within SOURCE_TURN_CHARS; null when nothing shares a word.
 */
function excerptOf(record: KnowledgeRecord, asked: ReadonlySet<string>): string | null {
  const words = indexed(record);
  let picked = words.sentences.filter(sentence => sharedCount(sentence.stems, asked) > 0).map(sentence => sentenceText(record, sentence));
  if (!picked.length && sharedCount(stemsOf(record.title), asked) > 0) picked = words.sentences.map(sentence => sentenceText(record, sentence));
  const parts: string[] = [];
  for (const sentence of picked) {
    if ([...parts, sentence].join(' ').length <= SOURCE_TURN_CHARS) { parts.push(sentence); continue; }
    if (!parts.length) parts.push(short(sentence, SOURCE_TURN_CHARS));
    break;
  }
  return parts.length ? parts.join(' ') : null;
}

/** One source as a turn carries it: its id (so the turn can say what it read), title, excerpt and source version. */
export type CarriedSource = { id: string; title: string; text: string; version: string };

/**
 * The sources a turn carries for its work (turnQuery), the best first: at most TURN_SOURCES that share words with it,
 * none the screen holds, each cut to its share and read through the screen again as carried. By code; no model.
 */
export function knowledgeForTurn(state: State, venture: VentureRecord, query: string): CarriedSource[] {
  const asked = stemsOf(query);
  if (!asked.size) return [];
  const carried: CarriedSource[] = [];
  for (const { record } of scoreSources(liveSources(state, venture), query)) {
    if (carried.length >= TURN_SOURCES) break;
    if (indexed(record).held.length) continue;
    const excerpt = excerptOf(record, asked);
    if (!excerpt) continue;
    const title = short(record.title, 120);
    const read = screenUntrusted({ source: SCREEN_SOURCE[record.sourceKind] ?? 'tool-output', text: `${title}\n${excerpt}` }, { mode: 'enforce' }).text;
    if (read === null) continue;
    const [first, ...rest] = read.split('\n');
    carried.push({ id: record.id, title: first, text: rest.join(' '), version: versionOf(record) });
  }
  return carried;
}

/** The sources an approved turn's text carried, by id, in the order they were added: each id is random, so the text holds one only when the turn carried it. */
export function sourcesCarried(state: State, venture: VentureRecord, approvedText: string): string[] {
  if (!approvedText) return [];
  return listRecords(state, 'venture-knowledge', venture.id).filter(record => approvedText.includes(record.id)).map(record => record.id);
}

/**
 * The sources a turn's text carried that must not go now: removed since, changed since (by Forget, say: the version
 * its text names is not the source's now), or held by the screen now. The turn is made again without them.
 */
export function staleSources(state: State, venture: VentureRecord, approvedText: string): string[] {
  if (!approvedText) return [];
  return listRecords(state, 'venture-knowledge', venture.id).filter(record => approvedText.includes(record.id)).flatMap(record =>
    (record.removedAt !== null || !approvedText.includes(versionOf(record)) || indexed(record).held.length ? [record.id] : []));
}

/** The screen's note kept for a source: what it hid and found, from every part screened; null when it found nothing. */
export function mergedNote(results: readonly Pick<ScreenResult, 'digest' | 'findings'>[]): ScreenNote | null {
  const findings = results.flatMap(result => result.findings.map(finding => ({ ...finding })));
  if (!findings.length) return null;
  return { mode: 'enforce', status: 'clean', digest: results.map(result => result.digest).join(':').slice(0, 200), findings };
}
