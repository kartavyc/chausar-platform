/**
 * Round-4 Tools words (TL tools): every new sentence lives in the lane's words file under
 * `RTT.tools.<key>`, in English and Hindi. `say(key, values)` fills `{name}` slots with text only.
 * A refusal reads as this lane's own sentence for its code, then the Tools sentence, then the code.
 */
import type { Language } from '../../app/presentation.ts';
import type { Sent } from '../trust/kit/engine.ts';
import { words as LANE } from '../../text/lanes/reports-tools-trust.ts';
import { refusalSentence, type Words } from './shared';
import { fill } from './words.ts';
import s from './shared.module.css';

export type Say = (key: string, values?: Readonly<Record<string, string | number>>) => string;

export function laneSay(language: Language): Say {
  const table = LANE[language] ?? LANE.en;
  return (key, values) => {
    const template = table[`RTT.tools.${key}`] ?? LANE.en[`RTT.tools.${key}`] ?? key;
    return values === undefined ? template : fill(template, values);
  };
}
export function hasSay(key: string): boolean { return `RTT.tools.${key}` in LANE.en; }

export function laneRefusal(code: string, say: Say, w: Words): string {
  return hasSay(`refusal.${code}`) ? say(`refusal.${code}`) : refusalSentence(code, w);
}

/** The outcome of one change, in this lane's words. */
export function LaneSent<T>({ sent, done, say, w, map }: { sent: Sent<T>; done?: string | undefined; say: Say; w: Words; map?: ((code: string) => string) | undefined }) {
  if (sent.kind === 'sending') return <p className={s.status} role="status">{w.sending}</p>;
  if (sent.kind === 'refused') return <p className={s.refused} role="status">{laneRefusal(map ? map(sent.code) : sent.code, say, w)}</p>;
  if (sent.kind === 'done' && done !== undefined) return <p className={s.status} role="status">{done}</p>;
  return null;
}
