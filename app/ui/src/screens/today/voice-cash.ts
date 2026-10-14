/**
 * Cash by voice in the Simple view (TD-02, SH-05): the adapter to the models-ext lane's speech
 * reading. `modelsx.speechInterpret` { text } returns "what it understood" (a deterministic
 * reading: Indian number words, negations, unclear parts; see `isSpeechInterpretReply`), and
 * `modelsx.speechConfirm` { text, digest } records the person's yes to that exact reading.
 *
 * Only words cross: the host's own listener turns one hold into text, and no audio reaches the
 * screen, the engine or any store. A reading counts as a cash amount only when it holds exactly
 * one number, nothing unclear, no negation and no ambiguity; a number with no unit is rupees (the
 * question was "today's cash sales"). Nothing is saved here. A missing method is `not-built`.
 */
import type { PlaceRpc } from '../../places/types.ts';
import { isSpeechConfirmReply, isSpeechInterpretReply, notBuilt } from '../../bridge/todayx-contract.ts';

export const SPEECH_INTERPRET_METHOD = 'modelsx.speechInterpret';
export const SPEECH_CONFIRM_METHOD = 'modelsx.speechConfirm';

/** What the host gives the Simple view for cash by voice. Absent or `on: false`: voice is off. */
export interface CashVoiceCapability {
  /** Off by default: true only when the person switched voice on. */
  readonly on: boolean;
  readonly rpc: PlaceRpc;
  /** One hold: start listening, then the words heard as text (null when nothing was caught).
   *  Absent: speech is not built on this computer yet. */
  readonly listen?: { start(): void; stop(): Promise<string | null> } | undefined;
  /** Voice is off: the button opens Trust, Rules, Send. */
  readonly onOpenSettings?: (() => void) | undefined;
}

export type CashHeard =
  | { readonly kind: 'amount'; readonly paise: string; readonly heard: string; readonly text: string; readonly digest: string }
  | { readonly kind: 'unsure'; readonly heard: string }
  | { readonly kind: 'not-built' }
  | { readonly kind: 'failed'; readonly code: string };

function codeOf(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'REQUEST_FAILED';
}

/** Ask the models-ext lane what the words say. The words are data, sent unchanged. */
export async function interpretCash(rpc: PlaceRpc, text: string): Promise<CashHeard> {
  const words = text.trim();
  if (words.length === 0) return { kind: 'unsure', heard: '' };
  let reply: unknown;
  try {
    reply = await rpc.request(SPEECH_INTERPRET_METHOD, { text: words.slice(0, 10000) });
  } catch (error) {
    return notBuilt(error) ? { kind: 'not-built' } : { kind: 'failed', code: codeOf(error) };
  }
  if (!isSpeechInterpretReply(reply)) return { kind: 'failed', code: 'INVALID_REPLY' };
  const heard = reply.understood;
  const only = reply.numbers.length === 1 ? reply.numbers[0]! : null;
  if (only === null || reply.unclear.length > 0 || reply.negations.length > 0 || reply.ambiguities.length > 0) return { kind: 'unsure', heard };
  const paise = only.paise ?? (only.unit === null && only.integer !== null ? (BigInt(only.integer) * 100n).toString() : null);
  if (paise === null || paise === '0') return { kind: 'unsure', heard };
  return { kind: 'amount', paise, heard, text: words.slice(0, 10000), digest: reply.digest };
}

/** The person's yes to the exact reading they were shown, recorded by the models-ext lane. */
export async function confirmCash(rpc: PlaceRpc, heard: Extract<CashHeard, { kind: 'amount' }>): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: string }> {
  try {
    const reply = await rpc.request(SPEECH_CONFIRM_METHOD, { text: heard.text, digest: heard.digest });
    return isSpeechConfirmReply(reply) && reply.digest === heard.digest ? { ok: true } : { ok: false, code: 'INVALID_REPLY' };
  } catch (error) {
    return { ok: false, code: codeOf(error) };
  }
}

/** Whole paise as the rupee text the cash field takes ("200000", "1234.50"). Exact: BigInt only. */
export function rupeesText(paise: string): string {
  if (!/^(0|[1-9][0-9]{0,30})$/.test(paise)) throw new TypeError('INVALID_PAISE');
  const value = BigInt(paise), whole = value / 100n, fraction = value % 100n;
  return fraction === 0n ? whole.toString() : `${whole}.${fraction.toString().padStart(2, '0')}`;
}
