/**
 * Cash by voice in the Simple view (TD-02, SH-05): the adapter to the models-ext lane's
 * `modelsx.speechInterpret`, which is absent in this base. Assumed contract (see
 * `isSpeechInterpretReply`): { text, intent: 'cash-amount', language } →
 * { amount: { paise } | null, heard, confirm: true }.
 *
 * Only words cross: the host's own listener turns one hold into text, and no audio reaches
 * the screen, the engine or any store. The amount comes back in whole paise and is shown back
 * for a yes; nothing is saved here. A method that does not exist yet is `not-built`.
 */
import type { Language } from '../../app/presentation.ts';
import type { PlaceRpc } from '../../places/types.ts';
import { isSpeechInterpretReply, notBuilt } from '../../bridge/todayx-contract.ts';

export const SPEECH_INTERPRET_METHOD = 'modelsx.speechInterpret';

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
  | { readonly kind: 'amount'; readonly paise: string; readonly heard: string }
  | { readonly kind: 'unsure'; readonly heard: string }
  | { readonly kind: 'not-built' }
  | { readonly kind: 'failed'; readonly code: string };

function codeOf(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'REQUEST_FAILED';
}

/** Ask the models-ext lane what amount the words name. The words are data, sent unchanged. */
export async function interpretCash(rpc: PlaceRpc, text: string, language: Language): Promise<CashHeard> {
  const words = text.trim();
  if (words.length === 0) return { kind: 'unsure', heard: '' };
  let reply: unknown;
  try {
    reply = await rpc.request(SPEECH_INTERPRET_METHOD, { text: words.slice(0, 2000), intent: 'cash-amount', language });
  } catch (error) {
    return notBuilt(error) ? { kind: 'not-built' } : { kind: 'failed', code: codeOf(error) };
  }
  if (!isSpeechInterpretReply(reply)) return { kind: 'failed', code: 'INVALID_REPLY' };
  return reply.amount === null ? { kind: 'unsure', heard: reply.heard } : { kind: 'amount', paise: reply.amount.paise, heard: reply.heard };
}

/** Whole paise as the rupee text the cash field takes ("200000", "1234.50"). Exact: BigInt only. */
export function rupeesText(paise: string): string {
  if (!/^(0|[1-9][0-9]{0,30})$/.test(paise)) throw new TypeError('INVALID_PAISE');
  const value = BigInt(paise), whole = value / 100n, fraction = value % 100n;
  return fraction === 0n ? whole.toString() : `${whole}.${fraction.toString().padStart(2, '0')}`;
}
