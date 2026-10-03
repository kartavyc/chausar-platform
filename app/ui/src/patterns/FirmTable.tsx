/**
 * FirmTable (CA-01): the clients of a CA firm, status only. The client, when its books
 * were last read, the month's close as a strip of four squares, how many things await
 * the firm, and what is due next. No figure, no customer name, no document: each client's
 * books stay in that client's own vault. Entering a client is a callback; the console
 * holds no client data. Three words filter it. Arrow keys move, Enter opens.
 *
 * The row's keys act only when the row itself has focus. A key pressed on the button
 * inside a row is that button's own: Enter there opens the client once, through the
 * button, and the row's handler ignores it.
 */

import { useRef, useState, type KeyboardEvent } from 'react';
import type { Count } from '../app/presentation.ts';
import { useT } from '../app/text';
import { Button } from '../parts/Button';
import { Choice } from '../parts/Choice';
import { Strip, type StripCell } from '../parts/Strip';
import s from './FirmTable.module.css';

export type FirmFilter = 'needs-you' | 'close-not-done' | 'all';

export interface FirmClientRow {
  clientId: string;
  name: string;
  /** "today 06:05", "3 days ago", already localised. */
  booksRead?: string | undefined;
  invited?: boolean | undefined;
  close?: ReadonlyArray<StripCell> | undefined;
  awaiting?: Count | undefined;
  dueNext?: { what: string; date: string } | undefined;
}

export interface FirmTableProps {
  month: string;
  clients: ReadonlyArray<FirmClientRow>;
  /** The engine cut the list; how many more there are. */
  more?: Count | undefined;
  filter: FirmFilter;
  onFilter: (f: FirmFilter) => void;
  onOpenClient: (clientId: string) => void;
  onSendGuide?: ((clientId: string) => void) | undefined;
  labelledBy?: string | undefined;
}

export function FirmTable({ month, clients, more, filter, onFilter, onOpenClient, onSendGuide, labelledBy }: FirmTableProps) {
  const t = useT();
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const focusRow = (i: number) => {
    const rows = bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[tabindex]');
    const el = rows?.[i];
    if (el) {
      setFocusIndex(i);
      el.focus();
    }
  };

  const onKey = (i: number, c: FirmClientRow) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusRow(Math.min(i + 1, clients.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusRow(Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && !c.invited) {
      e.preventDefault();
      onOpenClient(c.clientId);
    }
  };

  return (
    <div className={s.wrap}>
      <div className={s.filters}>
        <Choice<FirmFilter>
          label={t('CA-01.filter')}
          labelHidden
          options={[
            { value: 'needs-you', label: t('CA-01.filter.needs') },
            { value: 'close-not-done', label: t('CA-01.filter.notDone') },
            { value: 'all', label: t('CA-01.filter.all') },
          ]}
          value={filter}
          onChange={onFilter}
        />
      </div>
      <table className={s.table} aria-labelledby={labelledBy}>
        <thead>
          <tr>
            <th scope="col">{t('CA-01.col.client')}</th>
            <th scope="col">{t('CA-01.col.read')}</th>
            <th scope="col">{t('CA-01.col.close', { month })}</th>
            <th scope="col" className={s.num}>
              {t('CA-01.col.awaiting')}
            </th>
            <th scope="col">{t('CA-01.col.due')}</th>
            <th scope="col" className="sr">
              {t('CA-01.col.open')}
            </th>
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {clients.map((c, i) => (
            <tr key={c.clientId} tabIndex={i === Math.min(focusIndex, clients.length - 1) ? 0 : -1} onKeyDown={onKey(i, c)} className={c.invited ? s.invited : ''}>
              <th scope="row">{c.name}</th>
              <td>{c.invited ? t('CA-01.invited') : c.booksRead}</td>
              <td>{c.close && <Strip cells={c.close} />}</td>
              <td className={[s.num, 'fig'].join(' ')}>{c.awaiting?.display}</td>
              <td>
                {c.dueNext && (
                  <>
                    <span>{c.dueNext.what}</span>
                    <span className={[s.due, 'fig'].join(' ')}>{c.dueNext.date}</span>
                  </>
                )}
              </td>
              <td className={s.action}>
                {c.invited ? (
                  onSendGuide && (
                    <Button variant="link" onClick={() => onSendGuide(c.clientId)}>
                      {t('CA-01.guide')}
                    </Button>
                  )
                ) : (
                  <Button variant="link" onClick={() => onOpenClient(c.clientId)}>
                    {t('BTN.open')}
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {more && (
            <tr className={s.more}>
              <td colSpan={6}>{t('CA-01.more', { count: more.display })}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className={s.legend}>
        <span>{t('CA-01.legend', { month })}</span>
        <span className={s.legendItems}>
          <Strip bare cells={[{ state: 'done', label: '' }]} /> {t('STRIP.done')}
          <Strip bare cells={[{ state: 'not-done', label: '' }]} /> {t('STRIP.not-done')}
          <Strip bare cells={[{ state: 'refused', label: '' }]} /> {t('STRIP.refused')}
        </span>
        <span className={s.vault}>{t('CA-01.vault')}</span>
      </p>
    </div>
  );
}
