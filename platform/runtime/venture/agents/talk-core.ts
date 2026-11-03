// Chausar venture launcher, agents (wave 6, package 6I1, D45): push-to-talk, the parts that are the same in the engine
// and in the fake engine. A browser-safe leaf: only portable.ts. The engine's handlers are in talk.ts.
//
// The chain: speech to text (the owner's whisper.cpp on this computer, or Sarvam on the owner's key), the words go into
// the normal chat box unsent, as if typed; text to speech of a chief answer through build/speech-out.ts. Only what code
// checked is spoken: a figure part is read by its receipt's display, a number the AI wrote (an estimate part, or a
// number left in its words) is never read aloud. A spoken "yes" is text in the box and nothing more: every approval is
// still a tap on its card. Written for Chausar; nothing here is learned from an outside source.
import { check, digest } from '../../portable.ts';

/** The notice shown before the microphone first turns on; agreeing sends its digest, so a changed notice asks again. */
export const TALK_CONSENT_TEXT = 'Push-to-talk records your voice only while you hold the button. Chausar turns it into words with the service you chose, then deletes the recording unless you choose to keep it. The words go into the chat box for you to check. Saying yes never approves anything: you tap the card.';
export const TALK_CONSENT_DIGEST = digest(TALK_CONSENT_TEXT);

// ---------------------------------------------------------------------------
// Shapes (re-exported by venture/contracts.ts; the app's engine/types.ts reads them from here)
// ---------------------------------------------------------------------------

/** W6 6I1: venture.talk.get's answer. */
export type TalkView = {
  desktop: boolean;
  consent: { given: boolean; stale: boolean; text: string; digest: string; at: string | null; keepAudio: boolean };
  listen: 'whisper-local' | 'sarvam';
  whisper: { ready: boolean; line: string };
  sarvam: {
    label: 'fixture-tested'; connected: boolean; price: { paisePerMinute: string; checkedOn: string; source: string }; rateDigest: string;
    capMinor: string; cap: string; spentMinor: string; spent: string; line: string;
  };
  speak: { label: 'write' | 'planned: write'; line: string };
  session: { id: string; expiresAt: string } | null;
  recordings: number;
  line: string;
};
export type TalkStarted = { sessionId: string; expiresAt: string; seconds: number; provider: 'whisper-local' | 'sarvam' };
export type TalkHeard = { text: string; provider: 'whisper-local' | 'sarvam'; kept: boolean; cost: { minor: string; figure: string } | null; line: string };
export type TalkSaid = {
  spoken: string; quote: { chars: number; figure: string; checkedOn: string; textDigest: string; rateDigest: string } | null; audioBase64: string | null; line: string;
};
export type TalkConsentInput = { digest: string; keepAudio: boolean } | { withdraw: true };
export type TalkSetupInput = { listen: 'whisper-local' } | { listen: 'sarvam'; key?: string; capMinor: string; rateDigest: string } | { clearSarvam: true };

/** Words for the screens and refusals, the same in both engines. */
export const TALK_WORDS = Object.freeze({
  hosted: 'Push-to-talk works only in the desktop app.',
  consent: 'Read the push-to-talk notice and agree before the microphone turns on.',
  stale: 'The push-to-talk notice changed. Read it again before agreeing.',
  noWhisper: 'Set up whisper.cpp in Connections, or add a Sarvam key, before talking.',
  noSarvam: 'Add your Sarvam key first, or choose whisper.cpp.',
  session: 'That recording session ended. Hold the button again.',
  busy: 'Wait for the last recording to finish.',
  nothing: 'Nothing was heard. Hold the button and speak.',
  cap: 'This recording would pass your monthly Sarvam limit. Raise the limit or use whisper.cpp.',
  notFound: 'Choose an answer from Chausar in this chat.',
  checkWords: 'Check the words, then send. Saying yes never approves anything; you tap the card.',
  deleted: 'The recording was deleted after it was turned into words.',
  kept: 'The recording is kept, as you chose. Withdraw to delete it.',
  readOnScreen: 'Reading aloud needs your Google Cloud key in the narration desk. Until then, read it on screen.',
});

/** What is said in place of a number the AI wrote: the screen shows it with its "model estimate" label. */
export const ESTIMATE_SAID = 'a model estimate, shown on screen';
/** What is said in place of words that still hold a number: never read aloud as fact. */
export const NUMBER_SAID = 'a number, shown on screen';
/** What is said when the answer carries the calculator's worked table. */
export const WORKED_SAID = 'The worked figures are on screen.';

/** The longest push-to-talk recording: twenty seconds of mono 16 kHz PCM (caption-audio.ts takes no more). */
export const TALK_SECONDS = 20;
/** How long a started recording session waits for its audio. */
export const TALK_SESSION_MS = 60_000;
/** The longest transcript taken into the chat box. */
export const TALK_TEXT_CHARS = 2000;

/** A chat part as the engine stores it (venture/contracts.ts ChatPart). */
export type TalkPart = { kind: 'text'; text: string } | { kind: 'figure'; receiptId: string; key: string; display: string } | { kind: 'estimate'; text: string };

/**
 * What is read aloud from one answer: words as written, unless the number guard finds a number in them; each figure by
 * its receipt's own display; each estimate replaced by ESTIMATE_SAID. guard is the engine's number guard (records.ts
 * modelNumbers with the Hindi number words, the same test the chief uses to label estimates); the fake passes its
 * mirror of it.
 */
export function spokenFrom(parts: readonly TalkPart[], worked: number, guard: (text: string) => boolean): string {
  const said = parts.map(part => {
    if (part.kind === 'figure') return part.display;
    if (part.kind === 'estimate') return ESTIMATE_SAID;
    return guard(part.text) ? NUMBER_SAID : part.text;
  }).map(text => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (worked > 0) said.push(WORKED_SAID);
  return said.join(' ');
}

/** Sarvam's speech to text price, read on its own page on a build day (paise per minute of audio, pay as you go). */
export const SARVAM_STT_PRICE = Object.freeze({ paisePerMinute: '49', checkedOn: '2026-11-01', source: 'https://www.sarvam.ai/api-pricing' });
/** The rate the owner approves when adding the key; a changed price asks again. */
export const SARVAM_RATE_DIGEST = digest(SARVAM_STT_PRICE);
/** The monthly limit shown first, in paise (rupees 100). An owner setting: any whole number of paise. */
export const SARVAM_DEFAULT_CAP_MINOR = '10000';

/** Paise as rupees for the screen: 49 is "₹0.49", 10000 is "₹100.00". Code-computed, BigInt only. */
export function rupees(minor: string): string {
  check(/^\d{1,15}$/.test(minor), 'INVALID_AMOUNT', 'Give an amount in whole paise.');
  const value = BigInt(minor);
  return `₹${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

/** What one recording of this length costs at Sarvam's price, rounded up to the next paisa. */
export function sarvamCostMinor(durationMs: number): string {
  check(Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= TALK_SECONDS * 1000, 'INVALID_AUDIO', 'Use a recording of up to twenty seconds.');
  return String((BigInt(durationMs) * BigInt(SARVAM_STT_PRICE.paisePerMinute) + 59_999n) / 60_000n);
}

/** A canonical push-to-talk WAV's length in milliseconds (44 header bytes, 32 bytes a millisecond). */
export const wavMs = (bytes: number) => Math.floor((bytes - 44) / 32);

/** The month a time falls in, as Sarvam's limit counts it (UTC, the same as the engine's records). */
export const monthOf = (at: string) => at.slice(0, 7);

/** The transcript as it goes into the chat box: one line of plain words, bounded, no control characters. */
export function boxWords(text: string): string {
  return text.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TALK_TEXT_CHARS);
}
