import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../text';
import { Avatar, type DeptId } from './Avatar';
import { Button } from './Button';
import { cx } from './cx';
import { Count } from './Figure';
import { Icon } from './Icon';
import s from './Board.module.css';

export interface BoardColumn {
  id: string;
  /** The stage in the engine's words ("Contacted"). */
  title: string;
  /** One short line under the title ("Not written to yet"). */
  hint?: string | undefined;
  cards: readonly { id: string; node: ReactNode }[];
  /** The engine's own count, when it counts more than it sent; left out, the cards given. */
  count?: number | undefined;
  /** Start folded to a narrow strip that says what it holds (Lost, Not now). */
  folded?: boolean | undefined;
}

export interface BoardProps {
  /** The board's name ("Pipeline board"). */
  label: string;
  /** In the engine's stage order. */
  columns: readonly BoardColumn[];
  /** Show at most this many cards in a column, and the rest behind "Show N more". */
  limit?: number | undefined;
  className?: string | undefined;
}

/**
 * Columns of cards (D's `.board`, `.col`, `.colh`, `.colx`): the pipeline in 3E2 and W4 4E. Each column is a
 * section with its heading and count; a folded column is a narrow button that names what it holds and opens it.
 * Focus never drops to the page: opening a column moves it to that column's Hide button, hiding moves it back to the
 * folded strip, and "Show N more" moves it to the first card it revealed. The board scrolls sideways on a phone, so
 * it takes focus itself and arrow keys scroll it. Cards do not move by drag or key until W4 4E gives the engine a
 * forward-only move.
 */
export function Board({ label, columns, limit, className }: BoardProps) {
  const t = useT();
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocus] = useState<{ id: string; on: 'hide' | 'show' } | null>(null);
  const strips = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (focus?.on === 'show') strips.current.get(focus.id)?.focus();
  }, [focus]);
  const toggle = (id: string) => {
    const opening = !opened.has(id);
    setOpened((now) => {
      const next = new Set(now);
      if (opening) next.add(id);
      else next.delete(id);
      return next;
    });
    setFocus({ id, on: opening ? 'hide' : 'show' });
  };
  return (
    <div className={cx(s.board, className)} role="group" aria-label={label} tabIndex={0}>
      {columns.map((column) => {
        const count = column.count ?? column.cards.length;
        if (column.folded && !opened.has(column.id)) {
          return (
            <button
              key={column.id}
              ref={(strip) => {
                if (strip) strips.current.set(column.id, strip);
                else strips.current.delete(column.id);
              }}
              type="button"
              className={s.folded}
              aria-expanded="false"
              aria-label={t('board.show', { name: column.title, count })}
              onClick={() => toggle(column.id)}
            >
              <Icon name="arrow-left-right" size={16} />
              <Count value={count} className={s.foldedCount} />
              <span className={s.foldedName}>{column.title}</span>
            </button>
          );
        }
        return (
          <Column
            key={column.id}
            column={column}
            count={count}
            limit={limit}
            onHide={column.folded ? () => toggle(column.id) : undefined}
            focusHide={focus?.on === 'hide' && focus.id === column.id}
          />
        );
      })}
    </div>
  );
}

interface ColumnProps {
  column: BoardColumn;
  count: number;
  limit: number | undefined;
  onHide: (() => void) | undefined;
  /** It was just opened from its folded strip: take focus on its Hide button. */
  focusHide: boolean;
}

function Column({ column, count, limit, onHide, focusHide }: ColumnProps) {
  const t = useT();
  const id = useId();
  const hide = useRef<HTMLButtonElement>(null);
  const revealed = useRef<HTMLLIElement>(null);
  const [revealFrom, setRevealFrom] = useState<number | null>(null);
  const shown = revealFrom !== null || limit === undefined ? column.cards : column.cards.slice(0, limit);
  const rest = column.cards.length - shown.length;
  useEffect(() => {
    if (focusHide) hide.current?.focus();
  }, [focusHide]);
  useEffect(() => {
    if (revealFrom !== null) revealed.current?.focus();
  }, [revealFrom]);
  return (
    <section className={s.column} aria-labelledby={id} data-column={column.id}>
      <div className={s.head}>
        <h2 id={id} className={s.title}>{column.title}</h2>
        <Count value={count} className={s.count} />
        {onHide && (
          <button ref={hide} type="button" className={s.hide} aria-expanded="true" aria-label={t('board.hide', { name: column.title })} onClick={onHide}>
            <Icon name="arrow-left-right" size={16} />
          </button>
        )}
      </div>
      {column.hint && <p className={s.hint}>{column.hint}</p>}
      {column.cards.length === 0 ? (
        <p className={s.empty}>{t('board.empty')}</p>
      ) : (
        <ul className={s.cards}>
          {shown.map((card, index) => (
            <li
              key={card.id}
              ref={index === revealFrom ? revealed : undefined}
              tabIndex={index === revealFrom ? -1 : undefined}
              className={s.cardItem}
            >
              {card.node}
            </li>
          ))}
          {rest > 0 && (
            <li>
              <Button size="sm" className={s.more} onClick={() => setRevealFrom(shown.length)}>
                {t('board.more', { count: rest })}
                <Icon name="chevron-down" size={14} />
              </Button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

export interface BoardCardProps {
  /** The person or client, in their own words. */
  name: string;
  /** Their company, or nothing. */
  sub?: string | null | undefined;
  dept?: DeptId | undefined;
  /** Opens their sheet; the name becomes the button. */
  onOpen?: (() => void) | undefined;
  /** Make the card a row for the shell keys (shell/keys.ts): J and K reach it, Enter opens it through its name. */
  rowId?: string | undefined;
  /** The card's other lines: strength, path, the next step, the latest draft. */
  children?: ReactNode;
  className?: string | undefined;
}

/** One card on a board (D's `.lift.pc`): initials, the name as the card's heading, the company, then its lines. */
export function BoardCard({ name, sub, dept, onOpen, rowId, children, className }: BoardCardProps) {
  const id = useId();
  const row = rowId !== undefined;
  return (
    <article
      className={cx(s.card, className)}
      aria-labelledby={id}
      data-card=""
      data-row={row ? '' : undefined}
      data-row-id={rowId}
      tabIndex={row ? -1 : undefined}
    >
      <div className={s.cardTop}>
        <Avatar name={name} dept={dept} size={28} />
        <div className={s.cardId}>
          <h3 id={id} className={s.cardName}>
            {onOpen ? <button type="button" className={s.cardOpen} data-open={row ? '' : undefined} onClick={onOpen}>{name}</button> : name}
          </h3>
          {sub && <p className={s.cardSub}>{sub}</p>}
        </div>
      </div>
      {children !== undefined && children !== null && <div className={s.cardBody}>{children}</div>}
    </article>
  );
}
