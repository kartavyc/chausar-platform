/**
 * Small pieces every Tools screen shares: its words, who may change things, a day shown from
 * an engine date, the sentence for a refused change, and a plain list of lines.
 */
import type { ReactNode } from 'react';
import type { Language } from '../../app/presentation.ts';
import { date } from '../../format/index.ts';
import { words, type PlaceRenderProps } from '../../places/types.ts';
import { State } from '../../patterns/States';
import type { Loaded, Sent } from '../trust/kit/engine.ts';
import { screenState } from '../trust/kit/Screen';
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

/**
 * A part of a page that loads on its own. A refusal with a plain sentence of its own (such as
 * the relay not being set up) reads as that sentence; any other state is the common one.
 */
export function Part<T>({ loaded, w, children }: { loaded: Loaded<T>; w: Words; children: (value: T) => ReactNode }) {
  if (loaded.kind === 'ready') return <>{children(loaded.value)}</>;
  if (loaded.kind === 'failed' && `refusal.${loaded.code}` in w) return <p className={s.status}>{refusalSentence(loaded.code, w)}</p>;
  return <State state={screenState(loaded)} />;
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
export function UsesList({ calculations, actions, book, w }: { calculations: readonly string[]; actions: readonly string[]; book: boolean; w: Words }) {
  return (
    <div className={s.uses}>
      <div><h3 className={s.small}>{w.reads}</h3><Names names={calculations} w={w} /></div>
      <div><h3 className={s.small}>{w.proposes}</h3><Names names={actions} w={w} /></div>
      {book && <div><h3 className={s.small}>{w.keepsIn}</h3><Names names={[w.bookTitle]} w={w} /></div>}
    </div>
  );
}
