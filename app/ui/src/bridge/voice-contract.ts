/**
 * Round 4 contracts for the ask line (SH-04) and talking to it (SH-05). Every reply is untrusted
 * data: a screen checks it with the functions below before drawing it.
 *
 * - `voice.*` is the models-ext lane's family (docs/lanes/models-ext.md, "Round 4 contracts").
 *   Voice is off by default; off, every method but status, usage and providers refuses `VOICE_OFF`.
 *   With Send at nothing or shape a cloud provider refuses `VOICE_LOCAL_ONLY`. Only text and the
 *   short-lived audio of one hold cross; the UI keeps no audio.
 * - `askx.suggest` {} and `askx.search` { query } are the ask lane's; `records.search` { kind, text }
 *   and `books.memoryPropose` / `books.memoryConfirm` are work-books'. Suggestions are built from
 *   these engine reads and the frame's own place names; nothing typed goes to a model.
 */
import { isSpeechInterpretReply, type SpeechInterpretReply } from './todayx-contract.ts';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isDigits = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,30})$/.test(v);
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const isInstant = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const plainText = (max: number) => (v: unknown): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b-\u001f]/.test(v);
const shortText = plainText(500);
const oneOf = <T extends string>(list: readonly T[]) => (v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/* ----------------------------------------------------------------------- voice.* */

export const VOICE_METHODS = {
  status: 'voice.status', start: 'voice.start', stop: 'voice.stop', confirm: 'voice.confirm', dropNote: 'voice.dropNote',
  speak: 'voice.speak', stopSpeaking: 'voice.stopSpeaking', usage: 'voice.usage',
} as const;
/** The voice refusals a screen tells apart. Any other code is "could not". */
export const VOICE_REFUSALS = ['VOICE_OFF', 'VOICE_LOCAL_ONLY', 'UNDERSTOOD_CHANGED'] as const;

export type VoiceMode = 'off' | 'browser' | 'local' | 'paid';
/** models-ext's `publicProvider`: the label is null when the provider was configured without one. */
export interface VoiceProvider { readonly id: string; readonly kind: string; readonly label: string | null; readonly local: boolean; readonly ratePerMinuteMinor: string | null }
/** models-ext's `voice-usage.ts`: whole minutes as words of digits, and "not counted" for browser text (no length is known). */
export interface VoiceUsageRow { readonly providerId: string; readonly kind: string; readonly minutes: string | 'not counted'; readonly minutesMs: number | 'not counted'; readonly costMinor: string | 'not counted'; readonly basis: string }
/** `voice.usage` { month? } → minutes of speech this month and their cost. */
export interface VoiceUsage { readonly month: string; readonly providers: readonly VoiceUsageRow[]; readonly totals: { readonly minutesMs: number; readonly costMinor: string | 'not counted' } }
/** `voice.status` {} → whether voice is on, the provider and its cost per minute, and this month's use. */
export interface VoiceStatus {
  readonly enabled: boolean;
  readonly mode: VoiceMode;
  readonly send: string;
  readonly localOnly: boolean;
  readonly provider: VoiceProvider | null;
  readonly live: { readonly sessionId: string; readonly startedAt: string; readonly capMs: number; readonly endsAt: string } | null;
  readonly speaking: { readonly utteranceId: string } | null;
  readonly usage: VoiceUsage;
}
export type VoiceCapture = 'browser-transcript' | 'record-audio' | 'live-session';
/** `voice.start` { providerId?, live?, capMs? } → one listening session. A paid provider asks for approval first. */
export interface VoiceStart {
  readonly sessionId: string;
  readonly capture: VoiceCapture;
  /** The longest hold; null for the browser transcript, which the engine does not cap. */
  readonly capMs: number | null;
  readonly approval: { readonly previewId: string; readonly digest: string; readonly costCapMinor: string } | null;
  /** Live (WebRTC) voice, after approval. The ask line never asks for it; see `LIVE_VOICE_NOT_BUILT`. */
  readonly live: boolean;
}
/** `voice.stop` { sessionId, transcript? | audioBase64?, mimeType?, durationMs } and `voice.dropNote` → the words heard. */
export interface VoiceHeard {
  readonly sessionId: string;
  readonly heard: string | null;
  readonly understood: SpeechInterpretReply | null;
  readonly needsConfirmation: true;
  /** The engine's own sentence; the screen draws its own words instead. */
  readonly words: string;
  /** A recording that would leave this computer waits for an owner's approval first (nothing heard yet). */
  readonly approval?: { readonly previewId: string; readonly digest: string; readonly costCapMinor: string } | undefined;
}
/**
 * `voice.confirm` { sessionId, digest } → the confirmed words: `text` is the transcript as heard, `understood` the reading
 * the digest pins (models-ext adds `edited` and `receiptId`). Sending `text` would make it an edit that must be read again.
 */
export interface VoiceConfirm { readonly confirmationId: string; readonly text: string; readonly digest: string; readonly understood?: string | undefined }
/** `voice.speak` { receiptId, language? } → what to say, every number read from the receipt's own figures. */
export interface VoiceSpeak { readonly utteranceId: string; readonly language: 'en' | 'hi'; readonly segments: readonly { readonly text: string; readonly figureKey: string | null }[] }

const money = (v: unknown): v is string | 'not counted' => isDigits(v) || v === 'not counted';
function isProvider(v: unknown): v is VoiceProvider {
  return isRec(v) && isId(v['id']) && shortText(v['kind']) && (v['label'] === null || shortText(v['label'])) && typeof v['local'] === 'boolean'
    && (v['ratePerMinuteMinor'] === null || isDigits(v['ratePerMinuteMinor']));
}
export function isVoiceUsage(v: unknown): v is VoiceUsage {
  if (!isRec(v) || !isMonth(v['month']) || !Array.isArray(v['providers']) || !isRec(v['totals'])) return false;
  const totals = v['totals'];
  return v['providers'].length <= 50 && v['providers'].every(p => isRec(p) && isId(p['providerId']) && shortText(p['kind'])
    && (isDigits(p['minutes']) || p['minutes'] === 'not counted') && (isCount(p['minutesMs']) || p['minutesMs'] === 'not counted')
    && money(p['costMinor']) && shortText(p['basis'])) && isCount(totals['minutesMs']) && money(totals['costMinor']);
}
export function isVoiceStatus(v: unknown): v is VoiceStatus {
  if (!isRec(v) || typeof v['enabled'] !== 'boolean' || !oneOf(['off', 'browser', 'local', 'paid'] as const)(v['mode']) || !shortText(v['send']) || typeof v['localOnly'] !== 'boolean') return false;
  if (!(v['provider'] === null || isProvider(v['provider']))) return false;
  const live = v['live'], speaking = v['speaking'];
  if (!(live === null || isRec(live) && isId(live['sessionId']) && isInstant(live['startedAt']) && isCount(live['capMs']) && isInstant(live['endsAt']))) return false;
  if (!(speaking === null || isRec(speaking) && isId(speaking['utteranceId']))) return false;
  return isVoiceUsage(v['usage']);
}
const isApproval = (a: unknown): a is { previewId: string; digest: string; costCapMinor: string } =>
  isRec(a) && isId(a['previewId']) && isStr(a['digest']) && /^[a-f0-9]{64}$/.test(a['digest']) && isDigits(a['costCapMinor']);
/** Checks a `voice.start` reply and returns the fields the ask line uses, or null. */
export function readVoiceStart(v: unknown): VoiceStart | null {
  if (!isRec(v) || !isId(v['sessionId']) || !oneOf(['browser-transcript', 'record-audio', 'live-session'] as const)(v['capture']) || !(v['capMs'] === null || isCount(v['capMs']))) return null;
  const a = v['approval'];
  if (!(a === undefined || a === null || isApproval(a))) return null;
  return {
    sessionId: v['sessionId'], capture: v['capture'], capMs: v['capMs'] as number | null,
    approval: isRec(a) ? { previewId: a['previewId'] as string, digest: a['digest'] as string, costCapMinor: a['costCapMinor'] as string } : null,
    // `live: false` is not live; `live: true` or the live details object (models-ext contract) is.
    live: v['capture'] === 'live-session' || v['live'] === true || isRec(v['live']),
  };
}
export function isVoiceHeard(v: unknown, sessionId?: string): v is VoiceHeard {
  if (!isRec(v) || !isId(v['sessionId']) || (sessionId !== undefined && v['sessionId'] !== sessionId) || v['needsConfirmation'] !== true || !shortText(v['words'])) return false;
  if (!(v['heard'] === null || plainText(10000)(v['heard']))) return false;
  if (!(v['approval'] === undefined || (v['heard'] === null && isApproval(v['approval'])))) return false;
  if (v['understood'] === null) return v['heard'] === null;
  return v['heard'] !== null && isSpeechInterpretReply(v['understood']);
}
export function isVoiceConfirm(v: unknown, digest?: string): v is VoiceConfirm {
  return isRec(v) && isId(v['confirmationId']) && plainText(10000)(v['text']) && (v['text'] as string).trim().length > 0
    && isStr(v['digest']) && /^[a-f0-9]{64}$/.test(v['digest']) && (digest === undefined || v['digest'] === digest)
    && (v['understood'] === undefined || plainText(10000)(v['understood']));
}
export function readVoiceSpeak(v: unknown): VoiceSpeak | null {
  if (!isRec(v) || !isId(v['utteranceId']) || !oneOf(['en', 'hi'] as const)(v['language']) || !Array.isArray(v['segments']) || v['segments'].length > 200) return null;
  const segments: { text: string; figureKey: string | null }[] = [];
  for (const s of v['segments']) {
    if (!isRec(s) || !plainText(2000)(s['text']) || !(s['figureKey'] === undefined || s['figureKey'] === null || isId(s['figureKey']))) return null;
    segments.push({ text: s['text'], figureKey: isId(s['figureKey']) ? s['figureKey'] : null });
  }
  return { utteranceId: v['utteranceId'], language: v['language'], segments };
}

/* -------------------------------------------------------------- the ask line's reads */

export type AskSuggestionKind = 'calculation' | 'customer' | 'place' | 'saved';
/** `askx.suggest` {} → the questions asked before and the starter questions (ask lane). */
export interface CalculationSuggestion { readonly operationId: string; readonly label: string; readonly periodId: string }
export function readAskSuggest(v: unknown): readonly CalculationSuggestion[] | null {
  if (!isRec(v) || !Array.isArray(v['suggestions']) || v['suggestions'].length > 50) return null;
  const out: CalculationSuggestion[] = [];
  for (const s of v['suggestions']) {
    if (!isRec(s) || !isId(s['operationId']) || !shortText(s['label']) || !isId(s['periodId'])) return null;
    out.push({ operationId: s['operationId'], label: s['label'], periodId: s['periodId'] });
  }
  return out;
}
/** `records.search` { kind: 'customer', text } → customers whose name or id holds the text (work-books). */
export interface CustomerHit { readonly id: string; readonly name: string }
export function readRecordsSearch(v: unknown): readonly CustomerHit[] | null {
  if (!isRec(v) || !Array.isArray(v['records'])) return null;
  const out: CustomerHit[] = [];
  for (const r of v['records'].slice(0, 200)) {
    if (!isRec(r) || !isId(r['id']) || !(r['name'] === null || shortText(r['name']))) return null;
    if (r['kind'] === 'customer') out.push({ id: r['id'], name: (r['name'] as string | null) ?? r['id'] });
  }
  return out;
}
/** `askx.search` { query } → saved answers among other kinds; only the saved group is used here. */
export interface SavedHit { readonly id: string; readonly text: string }
export function readAskSearch(v: unknown): readonly SavedHit[] | null {
  if (!isRec(v) || !Array.isArray(v['groups'])) return null;
  const out: SavedHit[] = [];
  for (const g of v['groups']) {
    if (!isRec(g) || !shortText(g['kind']) || !Array.isArray(g['hits'])) return null;
    if (g['kind'] !== 'saved') continue;
    for (const h of g['hits'].slice(0, 50)) {
      if (!isRec(h) || !isId(h['id']) || !shortText(h['text'])) return null;
      out.push({ id: h['id'], text: h['text'] });
    }
  }
  return out;
}

/* ------------------------------------------------------------- telling, not asking */

/** `books.memoryPropose` { text, kind } and `books.memoryConfirm` { id } → one memory line (work-books, BK-17). */
export type MemoryKind = 'preference' | 'claim' | 'conversation' | 'working-context';
export interface MemoryLineReply { readonly id: string; readonly text: string; readonly kind: MemoryKind; readonly status: string; readonly source: string }
export function readMemoryLine(v: unknown): MemoryLineReply | null {
  if (!isRec(v) || !isId(v['id']) || !plainText(2000)(v['text']) || !oneOf(['preference', 'claim', 'conversation', 'working-context'] as const)(v['kind'])
    || !shortText(v['status']) || !shortText(v['source'])) return null;
  return { id: v['id'], text: v['text'], kind: v['kind'], status: v['status'], source: v['source'] };
}

/* ----------------------------------------------------------- the "About:" context */

/** What a place says the ask line is about (BK-12 "ask about this record"). The ref is data. */
export interface AskAbout { readonly label: string; readonly ref: { readonly kind: string; readonly id: string } }
export function readAskAbout(v: unknown): AskAbout | null {
  if (!isRec(v) || !plainText(120)(v['label']) || (v['label'] as string).trim() === '' || !isRec(v['ref'])) return null;
  const ref = v['ref'];
  if (!(isStr(ref['kind']) && /^[a-z][a-z0-9-]{0,31}$/.test(ref['kind']) && isId(ref['id']))) return null;
  return { label: (v['label'] as string).trim(), ref: { kind: ref['kind'], id: ref['id'] } };
}
/** The question as it leaves the ask line for Ask: the text the person typed or confirmed, and the reference as data. */
export interface AskQuestion { readonly text: string; readonly about: { readonly kind: string; readonly id: string } | null; readonly by: 'typed' | 'voice' }
