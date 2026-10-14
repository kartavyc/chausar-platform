/**
 * Small pieces every Tools screen shares: its words, who may change things, a day shown from
 * an engine date, the sentence for a refused change, and a plain list of lines.
 */
import type { ReactNode } from 'react';
import type { Language } from '../../app/presentation.ts';
import { date } from '../../format/index.ts';
import { words, type PlaceRenderProps } from '../../places/types.ts';
import type { Sent } from '../trust/kit/engine.ts';
import type { Uses } from './adapters/smallapps.ts';
import { TOOLS_WORDS, fill, type ToolsWord } from './words.ts';
import s from './shared.module.css';

export type Words = Readonly<Record<ToolsWord, string>>;
export function toolsWords(language: Language): Words { return words(TOOLS_WORDS, language); }

/** Owner or cofounder, and not a viewer seat: the `admin` permission in the lane contract. */
export function isAdmin(props: Pick<PlaceRenderProps, 'viewer' | 'member'>): boolean {
  return !props.viewer && (props.member.role === 'owner' || props.member.role === 'cofounder');
}

/** The day of an engine date or instant, from the shared format module. */
export function day(iso: string, language: Language): string { return date(iso.slice(0, 10), 'short', language); }

export function refusalSentence(code: string, w: Words): string {
  const key = `refusal.${code}` as ToolsWord;
  return key in w ? w[key] : fill(w.refusedCode, { code });
}

/** What happened to the last change: sending, done (with its sentence) or refused. */
export function SentLine<T>({ sent, done, w }: { sent: Sent<T>; done?: string | undefined; w: Words }) {
  if (sent.kind === 'sending') return <p className={s.status} role="status">{w.sending}</p>;
  if (sent.kind === 'refused') return <p className={s.refused} role="status">{refusalSentence(sent.code, w)}</p>;
  if (sent.kind === 'done' && done !== undefined) return <p className={s.status} role="status">{done}</p>;
  return null;
}

/** Lines between hairlines: one item per line, with controls at the right. */
export function Lines({ children, label }: { children: ReactNode; label?: string | undefined }) {
  return <ul className={s.lines} aria-label={label}>{children}</ul>;
}
export function Line({ title, notes, after, children }: { title: ReactNode; notes?: readonly ReactNode[] | undefined; after?: ReactNode; children?: ReactNode }) {
  return (
    <li className={s.line}>
      <div className={s.lineMain}>
        <span className={s.lineTitle}>{title}</span>
        {notes?.map((n, i) => n === null || n === false ? null : <span key={i} className={s.lineNote}>{n}</span>)}
        {children}
      </div>
      {after !== undefined && <div className={s.lineAfter}>{after}</div>}
    </li>
  );
}

/** Outside or engine-written text, shown as data in a quiet box. Never markup. */
export function Quoted({ children, label }: { children: string; label?: string | undefined }) {
  return <blockquote className={s.quoted} aria-label={label}>{children}</blockquote>;
}

/** A plain list of names, or the word for none. */
export function Names({ names, w }: { names: readonly string[]; w: Words }) {
  return names.length === 0 ? <span className={s.lineNote}>{w.none}</span> : <ul className={s.names}>{names.map((n, i) => <li key={`${i}-${n}`}>{n}</li>)}</ul>;
}

export function Warn({ children }: { children: ReactNode }) { return <p className={s.warn} role="note">{children}</p>; }
export function Row2({ children }: { children: ReactNode }) { return <div className={s.row2}>{children}</div>; }

/** The permission list, by name, shown before a small app is made and under one that was. */
export function UsesList({ uses, w }: { uses: Uses; w: Words }) {
  return (
    <div className={s.uses}>
      <div><h3 className={s.small}>{w.reads}</h3><Names names={uses.calculations} w={w} /></div>
      <div><h3 className={s.small}>{w.proposes}</h3><Names names={uses.actions} w={w} /></div>
    </div>
  );
}
