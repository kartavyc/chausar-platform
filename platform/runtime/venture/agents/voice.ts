// Chausar venture launcher, agents (Ink v2 wave 4, package 4J17, catalogue A8): the business voice. The owner writes it
// in plain words in six typed sections (who I talk to, how I talk, never-use words, words I use, what I will not
// claim, format), on or off, per language (English, Hindi) and per channel (every channel, or one of mail, WhatsApp
// and the posting channels). venture.voice.set is the owner's approval inside the app: each set is a new version for
// its language and channel, every version is kept, and the view gives the voice to set to go back one version, so a
// change is never silent and always undoable. venture.voice.learn bootstraps a voice from three to ten of the owner's
// own texts by code alone: word counts, the opening and closing lines they repeat (kept verbatim) and the length of
// their sentences; the last text is held out, and the voice is marked validated only when that text passes. What it
// learned waits as a draft, unused and unchecked, until the owner sets it. Keys and card, bank, Aadhaar and one-time
// code numbers are refused in a voice and taken out of learned texts before anything is counted or kept. The voice
// check (playbooks/draft-checks.ts voiceDraftCheck) reads every draft against the voices in use; the writing turn
// carries the voice as background (voiceForWriter, wired in delivery/harness/loop.ts).
import { check, type Context, type State } from '../../contracts.ts';
import type { Json, VentureDeps, VentureRecord, VoiceInput, VoiceRecord, VoiceSections, VoiceView } from '../contracts.ts';
import { exactPayload, listRecords, plainText, requireAppChannel, singleLine, ventureAction } from '../records.ts';
import { readAs } from '../delivery/shared.ts';
import { screenReadback, secretFindings } from '../core/secrets.ts';
import { plainHindi } from '../delivery/harness/patches.ts';
import { SOCIAL_CHANNELS } from '../playbooks/social/channels.ts';
import { voiceChannelsOf, VOICE_STOP_WORDS, type VoiceRule } from '../playbooks/draft-checks.ts';

/** The owner's words never keep a key, nor a card, bank account, Aadhaar or one-time code number (agents/threads.ts says the same in chat). */
export const KEY_REFUSED = 'That looks like a key. Keys go in Connections, never in your voice or an agent\'s persona.';
export const ID_REFUSED = 'That looks like a card, bank account, Aadhaar or one-time code number. Chausar never keeps those here, so nothing was saved.';
/** A card, bank account, Aadhaar or one-time code number by the shared screen (a leaf check, so delivery/runs.ts can load this file). */
export function holdsIdNumber(text: string): boolean {
  return screenReadback(text).found.some(kind => kind === 'card' || kind === 'bank-account' || kind === 'aadhaar' || kind === 'otp');
}

/** The channels a voice can be for, besides every channel (null): mail, WhatsApp and the posting channels. */
export const VOICE_CHANNELS: readonly string[] = Object.freeze(['email', 'whatsapp', ...SOCIAL_CHANNELS, 'youtube']);
export const VOICE_SECTIONS = ['audience', 'howITalk', 'neverUse', 'wordsIUse', 'willNotClaim', 'format'] as const;
type SectionId = typeof VOICE_SECTIONS[number];
/** The most lines each section keeps, and the most characters a line keeps (words and phrases are shorter). */
const SECTION_LINES: Readonly<Record<SectionId, number>> = Object.freeze({ audience: 6, howITalk: 12, neverUse: 60, wordsIUse: 30, willNotClaim: 20, format: 8 });
const SECTION_CHARS: Readonly<Record<SectionId, number>> = Object.freeze({ audience: 200, howITalk: 200, neverUse: 60, wordsIUse: 60, willNotClaim: 200, format: 200 });
/** How many of the owner's texts learn takes, and how long one may be. */
export const MIN_SAMPLES = 3;
export const MAX_SAMPLES = 10;
const SAMPLE_CHARS = { min: 20, max: 5000 };
/** How many words learn keeps as words I use, how many counts it keeps, and how many verbatim lines. */
const WORDS_KEPT = 8;
const COUNTS_KEPT = 20;
const LINES_KEPT = 6;
const LINE_CHARS = 160;

const NONE_LINE = 'You have no voice yet. Write one in your own words, or learn one from three to ten of your own texts.';
const LANGUAGE_WORDS = { en: 'English', hi: 'Hindi' } as const;

// ---------------------------------------------------------------------------
// The owner's input
// ---------------------------------------------------------------------------

/** One section: its lines, tidied, each checked for keys and id numbers, the same line given twice kept once. */
function sectionLines(value: unknown, id: SectionId): string[] {
  check(Array.isArray(value), 'INVALID_VENTURE_REQUEST', 'Each part of your voice is a list of lines.');
  check(value.length <= SECTION_LINES[id], 'INVALID_VENTURE_REQUEST', `Keep that part of your voice to ${SECTION_LINES[id]} lines or fewer.`);
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of value) {
    check(typeof item !== 'string' || item.trim().length <= SECTION_CHARS[id], 'INVALID_VENTURE_REQUEST', `A line of your voice is too long: keep each to ${SECTION_CHARS[id]} characters.`);
    const line = singleLine(item, 'A line of your voice', { min: 1, max: SECTION_CHARS[id] }).replace(/\s+/g, ' ');
    check(secretFindings(line).length === 0, 'CHAT_KEY_REFUSED', KEY_REFUSED);
    check(!holdsIdNumber(line), 'CHAT_KEY_REFUSED', ID_REFUSED);
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines;
}

/** The six sections, each required. */
export function voiceSections(value: unknown): VoiceSections {
  const body = exactPayload(value, VOICE_SECTIONS, VOICE_SECTIONS);
  return Object.fromEntries(VOICE_SECTIONS.map(id => [id, sectionLines(body[id], id)])) as VoiceSections;
}

/** The owner's voice for one language and channel, checked: English or Hindi, every channel or a known one, on or off. */
export function voiceInput(value: unknown): Required<VoiceInput> {
  const body = exactPayload(value, ['language', 'channel', 'on', 'sections'], ['language', 'on', 'sections']);
  check(body.language === 'en' || body.language === 'hi', 'INVALID_VENTURE_REQUEST', 'Choose English or Hindi.');
  const channel = body.channel ?? null;
  check(channel === null || (typeof channel === 'string' && VOICE_CHANNELS.includes(channel)), 'INVALID_VENTURE_REQUEST', `Choose every channel or one of: ${VOICE_CHANNELS.join(', ')}.`);
  check(typeof body.on === 'boolean', 'INVALID_VENTURE_REQUEST', 'Say whether this voice is on or off.');
  return { language: body.language, channel: channel as string | null, on: body.on, sections: voiceSections(body.sections) };
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

const keyOf = (record: Pick<VoiceRecord, 'language' | 'channel'>) => `${record.language}|${record.channel ?? ''}`;
const sameSections = (a: VoiceSections, b: VoiceSections) => VOICE_SECTIONS.every(id => a[id].length === b[id].length && a[id].every((line, index) => line === b[id][index]));

/** The voice in use for each language and channel: its newest version (drafts are never in use). */
export function voicesInUse(state: State, venture: VentureRecord): VoiceRecord[] {
  const newest = new Map<string, VoiceRecord>();
  for (const record of listRecords(state, 'venture-voice', venture.id)) {
    if (record.draft) continue;
    const held = newest.get(keyOf(record));
    if (!held || record.version >= held.version) newest.set(keyOf(record), record);
  }
  return [...newest.values()].sort((a, b) => (a.language === b.language ? (a.channel ?? '').localeCompare(b.channel ?? '') : a.language === 'en' ? -1 : 1));
}

/** The version before the one in use, as the voice to set to go back to it; null at the first version. */
function undoOf(state: State, venture: VentureRecord, record: VoiceRecord): VoiceInput | null {
  const before = listRecords(state, 'venture-voice', venture.id).filter(item => !item.draft && keyOf(item) === keyOf(record) && item.version < record.version)
    .sort((a, b) => b.version - a.version)[0];
  return before ? { language: before.language, channel: before.channel, on: before.on, sections: structuredClone(before.sections) } : null;
}

/** The newest learned draft, while nothing was set for its language and channel after it. */
function openDraft(state: State, venture: VentureRecord): VoiceRecord | null {
  const records = listRecords(state, 'venture-voice', venture.id);
  const index = records.findLastIndex(record => record.draft);
  if (index < 0) return null;
  const draft = records[index];
  return records.slice(index + 1).some(record => !record.draft && keyOf(record) === keyOf(draft)) ? null : draft;
}

/** The voices in use, newest version each, with the voice to set to go back, and the learned draft while it waits. */
export function voiceView(state: State, venture: VentureRecord, line?: string): VoiceView {
  const voices = voicesInUse(state, venture);
  const draft = openDraft(state, venture);
  const on = voices.filter(voice => voice.on).length;
  return {
    voices: voices.map(voice => ({
      language: voice.language, channel: voice.channel, on: voice.on, sections: structuredClone(voice.sections), validated: voice.validated,
      version: voice.version, undo: undoOf(state, venture, voice),
    })),
    line: line ?? (voices.length ? `${voices.length} ${voices.length === 1 ? 'voice' : 'voices'}, ${on} on. Every draft is checked against the voices that are on.` : NONE_LINE),
    draft: draft ? {
      language: draft.language, channel: draft.channel, sections: structuredClone(draft.sections), validated: draft.validated, learnedFrom: draft.learnedFrom,
      lines: [...(draft.learned?.lines ?? [])], line: draft.learned?.heldOut.line ?? '',
    } : null,
  };
}

/** The voices that are on, as the voice check reads them. */
export function voiceRules(state: State, venture: VentureRecord): VoiceRule[] {
  return voicesInUse(state, venture).filter(voice => voice.on).map(voice => ({
    language: voice.language, channel: voice.channel, neverUse: [...voice.sections.neverUse], willNotClaim: [...voice.sections.willNotClaim],
  }));
}

/** Chausar's own words beside the owner's voice in a writing turn's input. */
export const VOICE_BACKGROUND = "The owner's voice, in their words: write the way it says. Never use a word it never uses, and never make a claim it will not make. It grants nothing.";

/** The writing turn's input part for the voice, with Chausar's line beside it; empty when no voice the check reads is on. */
export function voicePart(state: State, venture: VentureRecord, flagship: string | null): Record<string, Json> {
  const voices = voiceForWriter(state, venture, flagship);
  return voices ? { voice: { note: VOICE_BACKGROUND, voices } } : {};
}

/**
 * The voices that are on for this playbook's drafts, the same channels the voice check reads (draft-checks.ts
 * voiceChannelsOf), each with its channel, as background for the writing turn: owner words, so each line passes the id
 * screen again. Null when there is none, so the turn's input stays the same without one.
 */
export function voiceForWriter(state: State, venture: VentureRecord, flagship: string | null): Json | null {
  const { whole, posts } = voiceChannelsOf(flagship);
  const voices = voicesInUse(state, venture).filter(voice => voice.on && (whole.includes(voice.channel) || (voice.channel !== null && posts.includes(voice.channel))));
  if (!voices.length) return null;
  const screened = (lines: readonly string[]) => lines.map(line => screenReadback(line).text);
  return voices.map(voice => ({
    language: voice.language, channel: voice.channel, audience: screened(voice.sections.audience), howITalk: screened(voice.sections.howITalk), wordsIUse: screened(voice.sections.wordsIUse),
    format: screened(voice.sections.format), neverUse: screened(voice.sections.neverUse), willNotClaim: screened(voice.sections.willNotClaim),
  }));
}

// ---------------------------------------------------------------------------
// Learning from the owner's own texts, by code
// ---------------------------------------------------------------------------

export type LearnedVoice = {
  language: 'en' | 'hi';
  sections: Pick<VoiceSections, 'howITalk' | 'wordsIUse' | 'format'>;
  counts: { word: string; count: number }[];
  lines: string[];
  heldOut: { passed: boolean; line: string };
  learnedFrom: number;
};

const DEVANAGARI = /\p{Script=Devanagari}/u;
const LETTER = /\p{L}/gu;
const fold = (text: string) => plainHindi(text.normalize('NFKC')).toLowerCase();
const wordsOf = (text: string): string[] => [...fold(text).matchAll(/[\p{L}\p{M}]+/gu)].map(match => match[0])
  .filter(word => !VOICE_STOP_WORDS.has(word) && (DEVANAGARI.test(word) ? word.length >= 2 : word.length >= 3));
const sentencesOf = (text: string): string[] => text.split(/[.!?।]+/u).map(item => item.trim()).filter(item => /\p{L}/u.test(item));
const averageLength = (texts: readonly string[]): number => {
  const sentences = texts.flatMap(sentencesOf);
  return sentences.length ? sentences.reduce((sum, sentence) => sum + sentence.split(/\s+/).length, 0) / sentences.length : 0;
};

type Shape = { opener: string | null; closer: string | null; body: string };
/** A text's opening line, closing line and the words between, when it has them. */
function shapeOf(text: string): Shape {
  const lines = text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length >= 3) return { opener: lines[0], closer: lines.at(-1)!, body: lines.slice(1, -1).join('\n') };
  if (lines.length === 2) return { opener: lines[0], closer: null, body: lines[1] };
  return { opener: null, closer: null, body: lines.join('\n') };
}

/** Lines said the same way in at least two texts, as first written. */
function repeated(lines: readonly (string | null)[]): string[] {
  const seen = new Map<string, { text: string; count: number }>();
  for (const line of lines) {
    if (!line || line.length > LINE_CHARS) continue;
    const key = fold(line);
    const held = seen.get(key);
    seen.set(key, { text: held?.text ?? line, count: (held?.count ?? 0) + 1 });
  }
  return [...seen.values()].filter(item => item.count >= 2).map(item => item.text);
}

/** The words of how long the sentences are, in the voice's language. HINDI_REVIEW: machine-drafted Hindi. */
function lengthWords(average: number, language: 'en' | 'hi'): string {
  const size = average <= 12 ? 0 : average <= 20 ? 1 : 2;
  return language === 'hi' ? ['छोटे वाक्य', 'मध्यम लंबाई के वाक्य', 'लंबे वाक्य'][size] : ['Short sentences', 'Sentences of medium length', 'Long sentences'][size];
}

/**
 * What code learns from the owner's own texts, no model: the last text is held out; from the rest it counts the words
 * (common words left out), keeps as words I use those in at least two texts, keeps verbatim the opening and closing
 * lines said the same way in at least two, and reads how long the sentences run. The held-out text passes when it uses
 * at least half of those words and its sentences run between half and twice as long. Ids and keys are taken out of
 * every text before anything is read.
 */
export function learnVoice(samples: readonly string[]): LearnedVoice {
  const texts = samples.map(sample => screenReadback(sample.replace(/\r\n?/g, '\n')).text);
  const letters = texts.join(' ').match(LETTER) ?? [];
  const language: 'en' | 'hi' = letters.filter(letter => DEVANAGARI.test(letter)).length * 2 > letters.length ? 'hi' : 'en';
  const train = texts.slice(0, -1).map(shapeOf);
  const held = shapeOf(texts.at(-1)!);
  const counts = new Map<string, number>();
  const spread = new Map<string, number>();
  for (const shape of train) {
    const words = wordsOf(shape.body);
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
    for (const word of new Set(words)) spread.set(word, (spread.get(word) ?? 0) + 1);
  }
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const wordsIUse = byCount.filter(([word]) => (spread.get(word) ?? 0) >= 2).slice(0, WORDS_KEPT).map(([word]) => word);
  const openers = repeated(train.map(shape => shape.opener));
  const closers = repeated(train.map(shape => shape.closer));
  const lines = [...openers, ...closers, ...repeated(train.flatMap(shape => shape.body.split('\n')))].filter((line, index, all) => all.indexOf(line) === index).slice(0, LINES_KEPT);
  const hi = language === 'hi';
  const howITalk = [
    ...openers.slice(0, 2).map(line => (hi ? `शुरुआत: "${line}"` : `Opens with: "${line}"`)),
    ...closers.slice(0, 2).map(line => (hi ? `अंत: "${line}"` : `Signs off with: "${line}"`)),
  ];
  const average = averageLength(train.map(shape => shape.body));
  const questions = train.filter(shape => /[?？]/u.test(shape.body)).length * 2 > train.length;
  const format = [lengthWords(average, language), ...(questions ? [hi ? 'पाठक से सवाल पूछते हैं' : 'Asks the reader questions'] : [])];
  // The held-out text, which nothing above read.
  const heldWords = new Set(wordsOf(held.body));
  const shared = wordsIUse.filter(word => heldWords.has(word)).length;
  const heldAverage = averageLength([held.body]);
  const wordsOk = wordsIUse.length > 0 && shared * 2 >= wordsIUse.length;
  const lengthOk = average > 0 && heldAverage >= average / 2 && heldAverage <= average * 2;
  const passed = wordsOk && lengthOk;
  const line = passed
    ? `Checked on your last text, which it did not learn from: it uses ${shared} of your ${wordsIUse.length} words, with sentences like yours.`
    : `Checked on your last text, which it did not learn from: it did not sound like the others (${!wordsOk ? `it uses ${shared} of your ${wordsIUse.length} words` : 'its sentences run another length'}). Add texts that sound like you, then learn again.`;
  return {
    language, sections: { howITalk, wordsIUse, format }, counts: byCount.slice(0, COUNTS_KEPT).map(([word, count]) => ({ word, count })),
    lines, heldOut: { passed, line }, learnedFrom: train.length,
  };
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/** venture.voice.get {} (read): the voices in use, each with the voice to set to go back, and a learned draft while it waits. */
export async function voiceGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VoiceView> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  return voiceView(state, venture);
}

/**
 * venture.voice.set { voice } (approve, app only): the owner's voice for one language and channel, as a new version.
 * Every version is kept; the view's undo is the voice to set to go back one. A voice is validated only when its
 * sections are the ones a learned draft (or the version in use) was validated with; a voice written or changed by hand
 * is not.
 */
export async function voiceSetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VoiceView> {
  requireAppChannel(ctx, 'venture.voice.set');
  const body = exactPayload(payload, ['voice'], ['voice']);
  const input = voiceInput(body.voice);
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'agents.voice.set', tx => {
    const venture = tx.venture!;
    const same = listRecords(tx.state, 'venture-voice', venture.id).filter(record => keyOf(record) === keyOf(input));
    const version = Math.max(0, ...same.filter(record => !record.draft).map(record => record.version)) + 1;
    // Validation rides only with the exact sections it was given for: the open draft's, else the version in use's.
    const draft = openDraft(tx.state, venture);
    const current = voicesInUse(tx.state, venture).find(record => keyOf(record) === keyOf(input));
    const source = [draft && keyOf(draft) === keyOf(input) ? draft : null, current ?? null].find(record => record && record.validated && sameSections(record.sections, input.sections)) ?? null;
    tx.put<VoiceRecord>({
      ...tx.base('venture-voice'), language: input.language, channel: input.channel, on: input.on, sections: input.sections,
      validated: !!source, learnedFrom: source?.learnedFrom ?? 0, version, draft: false, learned: source?.learned ? structuredClone(source.learned) : null,
    });
    const where = input.channel === null ? 'every channel' : input.channel;
    const back = version > 1 ? ` Version ${version - 1} is kept; undo sets it again.` : '';
    return voiceView(tx.state, venture, `Your ${LANGUAGE_WORDS[input.language]} voice for ${where} is version ${version}, ${input.on ? 'on' : 'off'}.${back}`);
  });
}

/**
 * venture.voice.learn { samples } (prepare, app only): three to ten of the owner's own texts. Code learns a voice from
 * them (learnVoice) and keeps it as a draft for every channel, with the owner's never-use words, claims and audience
 * from the voice in use for that language: nothing in use changes until the owner sets it.
 */
export async function voiceLearnHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VoiceView> {
  requireAppChannel(ctx, 'venture.voice.learn');
  const body = exactPayload(payload, ['samples'], ['samples']);
  check(Array.isArray(body.samples) && body.samples.length >= MIN_SAMPLES && body.samples.length <= MAX_SAMPLES, 'INVALID_VENTURE_REQUEST',
    `Add ${MIN_SAMPLES} to ${MAX_SAMPLES} of your own texts: mails, posts or what you said in a video.`);
  const samples = (body.samples as unknown[]).map(sample => plainText(sample, 'Each text', SAMPLE_CHARS));
  const learned = learnVoice(samples);
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'agents.voice.learn', tx => {
    const venture = tx.venture!;
    const current = voicesInUse(tx.state, venture).find(record => record.language === learned.language && record.channel === null);
    const sections: VoiceSections = {
      audience: [...(current?.sections.audience ?? [])], howITalk: learned.sections.howITalk, neverUse: [...(current?.sections.neverUse ?? [])],
      wordsIUse: learned.sections.wordsIUse, willNotClaim: [...(current?.sections.willNotClaim ?? [])], format: learned.sections.format,
    };
    // A new learning replaces the draft still waiting, so drafts never pile up; a draft already set stays as it was.
    const open = openDraft(tx.state, venture);
    const record: VoiceRecord = {
      ...(open ? { ...open, at: tx.now } : tx.base('venture-voice')), language: learned.language, channel: null, on: true, sections, validated: learned.heldOut.passed,
      learnedFrom: learned.learnedFrom, version: 0, draft: true, learned: { counts: learned.counts, lines: learned.lines, heldOut: learned.heldOut },
    };
    if (open) tx.replace(record); else tx.put(record);
    return voiceView(tx.state, venture, `Learned from ${learned.learnedFrom} of your texts. ${learned.heldOut.line} Nothing changes until you set it.`);
  });
}
