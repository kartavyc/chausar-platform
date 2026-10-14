/**
 * Shared pieces for the Books screens: the page frame over the kit, sheet ids, money,
 * dense tables per view, a confirm-once button and the twelve month squares.
 * Display only: every number arrives from the engine and is formatted, never computed.
 */
import { useState, type ReactNode } from 'react';
import type { Language, ScreenState, View } from '../../app/presentation.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { words } from '../../places/types.ts';
import { Figure } from '../../parts/Figure';
import { Sheet } from '../../parts/Sheet';
import { Page, Button } from '../work/kit/Page';
import type { Loaded } from '../work/kit/reply.ts';
import type { Amount } from '../work/kit/validate.ts';
import { fill, missingWord } from '../work/kit/words.ts';
import { paise } from '../work/kit/format.ts';
import { BOOKS, type BooksKey } from './words.ts';
import type { MonthState } from './contract.ts';
import s from './Books.module.css';

export type BooksProps = PlaceRenderProps;
export type W = Readonly<Record<BooksKey, string>>;
export function useWords(language: Language): W { return words(BOOKS, language); }
export { fill };

export const SUBS = ['sources', 'unmapped', 'meanings', 'packs', 'accounts', 'customers', 'matches', 'conflicts', 'history', 'stale', 'memory'] as const;
/** Round 2: recipes is listed; add a source and a change tried on a copy are reached from Sources and Meanings. */
export const MORE_SUBS = ['recipes', 'add', 'trial'] as const;
export type Sub = typeof SUBS[number] | typeof MORE_SUBS[number];
const LISTED: readonly Sub[] = [...SUBS, 'recipes'];
const SIMPLE_SUBS: readonly Sub[] = ['sources', 'meanings', 'accounts', 'customers', 'history', 'memory'];

/** Seats that may approve: the accountant prepares but cannot approve. */
export const approves = (props: BooksProps) => !props.viewer && (props.member.role === 'owner' || props.member.role === 'cofounder');
export const isOwner = (props: BooksProps) => !props.viewer && props.member.role === 'owner';
/** Seats that may prepare (read a source, map a field, make a copy): anyone but a viewer. */
export const prepares = (props: BooksProps) => !props.viewer && props.member.role !== 'viewer';

/**
 * Engine ids may hold characters a sheet address cannot (`:` `@`). Each such character is
 * written as `.` and four hex digits; the result always starts with `s`.
 */
export function sheetOf(raw: string): string {
  let out = 's';
  for (const ch of raw) {
    if (/^[A-Za-z0-9_-]$/.test(ch)) out += ch;
    else for (const unit of ch.split('')) out += `.${unit.charCodeAt(0).toString(16).padStart(4, '0')}`;
  }
  return out;
}
export function idOf(sheet: string | undefined): string | null {
  if (sheet === undefined || !/^s(?:[A-Za-z0-9_-]|\.[0-9a-f]{4})*$/.test(sheet)) return null;
  return sheet.slice(1).replace(/\.([0-9a-f]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

export function valueOf<T>(loaded: Loaded<T>): T | undefined {
  return loaded.phase === 'ready' ? loaded.value : loaded.phase === 'loading' ? loaded.last : undefined;
}
export function stateOf<T>(loaded: Loaded<T>): ScreenState | undefined {
  if (loaded.phase === 'refused') return loaded.state;
  if (loaded.phase === 'loading' && loaded.last === undefined) return { kind: 'loading' };
  return undefined;
}

export function BooksPage({ props, sub, title, count, loaded, reload, aside, children }: {
  props: BooksProps; sub: Sub; title: string; count?: string | undefined; loaded?: Loaded<unknown> | undefined;
  reload?: (() => void) | undefined; aside?: ReactNode; children?: ReactNode;
}) {
  const w = useWords(props.language);
  return (
    <div className={[s.books, s[props.view]].join(' ')} data-view={props.view}>
      <Page place="books" sub={sub} subs={props.view === 'simple' ? SIMPLE_SUBS : LISTED} title={title} count={count} language={props.language}
        navigate={props.navigate} state={loaded ? stateOf(loaded) : undefined} onRetry={reload} aside={aside}>
        {props.viewer && <p className={s.note}>{w.readOnly}</p>}
        {children}
      </Page>
    </div>
  );
}

/** The detail sheet beside the page. Closing returns to the sub-place. */
export function BooksSheet({ props, sub, kind, title, actions, children }: { props: BooksProps; sub: Sub; kind: string; title: string; actions?: ReactNode; children: ReactNode }) {
  return <Sheet kind={kind} title={title} origin={null} onClose={() => props.navigate({ place: 'books', sub })} actions={actions}>{children}</Sheet>;
}

/** A calculated amount: opens its receipt when it has one; missing is words, never zero. */
export function Money({ value, receiptId, language, onReceipt }: { value: Amount; receiptId: string | null; language: Language; onReceipt: (id: string) => void }) {
  if ('missing' in value) return <span className={s.missing}>{missingWord(value.missing, language)}</span>;
  if (receiptId === null) return <span className={s.missing}>{missingWord('unknown', language)}</span>;
  return <Figure value={{ kind: 'money', exact: value.minor, display: paise(value.minor), receiptId, labels: [] }} onReceipt={onReceipt} />;
}
/** An amount as a source recorded it (a fact, a read's own total): text, not a calculation. */
export function Recorded({ value, language }: { value: Amount; language: Language }) {
  return 'missing' in value ? <span className={s.missing}>{missingWord(value.missing, language)}</span> : <span className="fig">{paise(value.minor)}</span>;
}

export interface Column { head: string; num?: boolean; simple?: boolean }
/** A table that is denser in Books and drops the columns not marked `simple` in Simple. */
export function Table({ view, caption, columns, rows }: { view: View; caption: string; columns: readonly Column[]; rows: readonly { key: string; cells: readonly ReactNode[] }[] }) {
  const keep = columns.map(c => view !== 'simple' || c.simple === true);
  return (
    <table className={[s.table, s[`t-${view}`]].join(' ')}>
      <caption className="sr">{caption}</caption>
      <thead><tr>{columns.map((c, i) => keep[i] && <th key={c.head} scope="col" className={c.num ? s.num : undefined}>{c.head}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.key}>{r.cells.map((cell, i) => keep[i] && <td key={i} className={columns[i]?.num ? s.num : undefined}>{cell}</td>)}</tr>)}</tbody>
    </table>
  );
}

/** A destructive action asks once more, by name. */
export function ConfirmButton({ label, confirm, keep, onConfirm, disabled }: { label: string; confirm: string; keep: string; onConfirm: () => void; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button danger onClick={() => setAsking(true)} disabled={disabled}>{label}</Button>;
  return <span className={s.inline}><Button danger onClick={() => { setAsking(false); onConfirm(); }} disabled={disabled}>{confirm}</Button><Button variant="link" onClick={() => setAsking(false)}>{keep}</Button></span>;
}

export function Link({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return <Button variant="link" onClick={onPress}>{children}</Button>;
}

const MONTH_WORD: Readonly<Record<MonthState, BooksKey>> = {
  loaded: 'month.loaded', loading: 'month.loading', 'not-loaded-yet': 'month.not-loaded-yet', refused: 'month.refused', failed: 'month.failed',
};
/** Twelve small squares, oldest first. Each has its month and state in words. */
export function MonthSquares({ months, language }: { months: readonly { month: string; state: MonthState }[]; language: Language }) {
  const w = useWords(language);
  return (
    <ul className={s.months} aria-label={w.twelveMonths}>
      {months.map(m => {
        const name = fill(w.monthSquare, { month: monthName(m.month, language), state: w[MONTH_WORD[m.state]] });
        return (
          <li key={m.month} className={s.month} role="img" aria-label={name} title={name} data-state={m.state}>
            <span className={[s.square, s[`m-${m.state}`]].join(' ')} aria-hidden="true" />
            {m.state === 'failed' && <span className={s.failedWord} aria-hidden="true">{w['month.failed']}</span>}
          </li>
        );
      })}
    </ul>
  );
}

const MONTHS: Record<Language, readonly string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
};
export function monthName(ym: string, language: Language): string {
  const index = parseInt(ym.slice(5, 7), 10);
  return `${MONTHS[language][index - 1] ?? ym.slice(5, 7)} ${ym.slice(0, 4)}`;
}

export function Notice({ children, tone }: { children: ReactNode; tone?: 'amber' }) {
  return <p className={tone === 'amber' ? s.amber : s.note} role={tone === 'amber' ? 'alert' : undefined}>{children}</p>;
}
export const styles = s;
