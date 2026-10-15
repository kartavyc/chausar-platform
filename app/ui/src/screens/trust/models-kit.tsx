/**
 * TR-08 Models: the words, the refusal sentences and the string-only money helpers that the
 * route order, comparison, prices, voice and allowance screens share. The words live in the
 * lane's words file (text/lanes/reports-tools-trust.ts) under `RTT.models.*`.
 */
import type { Language } from '../../app/presentation.ts';
import { words as pick } from '../../places/types.ts';
import { TR08_MODELS } from '../../text/lanes/reports-tools-trust.ts';
import type { Sent } from './kit/engine.ts';
import { Refusal } from './common';
import { fill } from './words.ts';
import s from './Trust.module.css';

type Strip<K> = K extends `RTT.models.${infer R}` ? R : never;
export type MK = Strip<keyof typeof TR08_MODELS.en>;

/** The TR-08 words for a language: `m('key')`, with `{name}` values filled in. */
export function modelWords(language: Language): (key: MK, values?: Readonly<Record<string, string>>) => string {
  const w = pick(TR08_MODELS, language) as Readonly<Record<string, string>>;
  return (key, values) => {
    const sentence = w[`RTT.models.${key}`] ?? key;
    return values === undefined ? sentence : fill(sentence, values);
  };
}

/** Codes these screens are refused with, each with its own plain sentence. */
const REFUSALS: Readonly<Record<string, MK>> = {
  DEMO_PROVIDER_DISABLED: 'refuse.demoSpeech', ALLOWANCE_NOT_AVAILABLE: 'refuse.allowance', HOSTED_NOT_CONFIGURED: 'refuse.hostedNotSetUp',
  HOSTED_NOT_PAIRED: 'refuse.hostedNotPaired', INVALID_FX: 'refuse.fx', INVALID_PRICE: 'refuse.price', PRICE_UNKNOWN: 'refuse.priceUnknown',
  FX_NOT_SET: 'refuse.fxNotSet', PRICING_NOT_APPLICABLE: 'refuse.notPerToken', ROUTE_NOT_FOUND: 'refuse.routeGone',
  INVALID_SPEECH_PROVIDER: 'refuse.speechSettings', INVALID_CREDENTIAL: 'refuse.key', RATE_REQUIRED: 'refuse.rate', SPEECH_UNAVAILABLE: 'refuse.speechOff',
  LIVE_VOICE_NOT_VERIFIED: 'refuse.speechSettings', INVALID_BUDGET: 'refuse.budget', BENCH_BARS_REQUIRED: 'refuse.bars', BENCH_BARS_CHANGED: 'refuse.barsChanged',
  INVALID_USAGE: 'refuse.tokens', MANAGED_UNAVAILABLE: 'refuse.allowance', INVALID_ROUTE: 'refuse.route', INVALID_LADDER: 'refuse.ladder',
};

export function refusalWord(code: string): MK | null { return REFUSALS[code] ?? null; }

/** What happened to the last change on these screens. A known code is a plain sentence; others use the lane's common refusal. */
export function ModelsOutcome<T>({ sent, language, done }: { sent: Sent<T>; language: Language; done: (value: T) => string }) {
  const m = modelWords(language);
  if (sent.kind === 'idle') return null;
  if (sent.kind === 'sending') return <p className={s.quiet} role="status">{m('saving')}</p>;
  if (sent.kind === 'refused') {
    const known = refusalWord(sent.code);
    return known === null ? <Refusal code={sent.code} language={language} /> : <p className={s.problem} role="status">{m(known)}</p>;
  }
  return <p className={s.status} role="status">{done(sent.value)}</p>;
}

/** Whole micro-dollars as dollars, by moving the decimal point in the text: no arithmetic. */
export function dollarsText(micro: string): string {
  const padded = micro.padStart(7, '0');
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/, '');
  const fraction = padded.slice(-6).replace(/0+$/, '').padEnd(2, '0');
  return `$${whole}.${fraction}`;
}

/** Typed dollars ("2.50") to whole micro-dollars, by string handling only; null when it is not a plain amount. */
export function dollarsToMicro(text: string): string | null {
  const typed = text.trim().replace(/^\$\s*/, '');
  const match = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(typed);
  if (match === null) return null;
  return `${match[1]}${(match[2] ?? '').padEnd(6, '0')}`.replace(/^0+(?=\d)/, '');
}
