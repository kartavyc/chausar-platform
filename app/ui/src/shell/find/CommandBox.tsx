/**
 * The command bar (C2 task 6; the founder's answer: "Ctrl K anywhere, finds things first, and still chats"). One box,
 * "Find or ask": typing lists the open business's clients, invoices, orders, runs and chats that match (venture.find),
 * the pages and actions that match (catalogue.ts), and last an Ask row that takes the words to Chats. Choosing a row
 * only navigates: a record's sheet or place, a page or an action's href, or Chats. The bar writes nothing.
 *
 * Keys: Arrow Up and Down move through the rows (wrapping), Home and End go to the first and last, Enter chooses, Tab
 * leaves and closes the list. Esc closes the list and keeps an open sheet open; a second Esc leaves the box.
 *
 * Privacy: the words live only in this box's own state. They never go in the address, the history's state or browser
 * storage, and Forget's remount of the frame drops them with the rows shown.
 *
 * The list and its rows carry stable hooks (`data-find-list`, `data-row-id`) for C3's motion; nothing moves here.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { useT } from '../../text';
import { cx } from '../../parts/cx';
import { Icon } from '../../parts/Icon';
import { Figure } from '../../parts/Figure';
import { LineWithAmounts } from '../../parts/LineWithAmounts';
import { formatCount } from '../../../../../platform/runtime/owner-format';
import type { FindHit, FindItem } from '../../engine/types';
import { askChausar } from '../ask';
import { navigate, rememberOpener } from '../navigation';
import { parseHash } from '../routes';
import { useFind, type FindRow } from './useFind';
import s from './CommandBox.module.css';

/** The header's box, drawn again in each page header. */
const HEADER_BOX = '[data-find-header] input[role="combobox"]';

/** The keys, the same at every width and shown at rest (F2). */
export const FIND_KEYS = 'Ctrl K';

/** Words with the matched part marked, when the hit falls inside them. */
function marked(text: string, hit: FindHit | null | undefined): ReactNode {
  if (!hit || hit.start < 0 || hit.start + hit.length > text.length) return text;
  return <>{text.slice(0, hit.start)}<mark className={s.mark}>{text.slice(hit.start, hit.start + hit.length)}</mark>{text.slice(hit.start + hit.length)}</>;
}

function RecordRow({ item }: { item: FindItem }) {
  const t = useT();
  switch (item.kind) {
    case 'client':
      return <span className={s.main} data-content="">{marked(item.name, item.hit)}</span>;
    case 'invoice':
      return (
        <>
          <span className={s.main}>{marked(item.number || t('state.invoice.draft'), item.hit)}</span>
          {item.clientName && <span className={s.side} data-content="">{item.clientName}</span>}
          <span className={s.side}>{t(`state.invoice.${item.status}`)}</span>
        </>
      );
    case 'order':
      return (
        <>
          <span className={s.main} data-content="">{marked(item.request, item.hit)}</span>
          {item.clientName && <span className={s.side} data-content="">{item.clientName}</span>}
        </>
      );
    case 'run':
      return (
        <>
          <span className={s.main}>{marked(item.purpose, item.hit)}</span>
          {item.agentName && <span className={s.side}>{item.agentName}</span>}
        </>
      );
    case 'chat':
      return (
        <span className={s.stack}>
          <span className={s.main} data-content="">{marked(item.title, item.hit)}</span>
          {item.snippet && <span className={s.snippet} data-content=""><LineWithAmounts line={item.snippet.line} amounts={item.snippet.amounts} /></span>}
        </span>
      );
  }
}

export interface CommandBoxProps {
  /** `dialog`: inside CommandDialog (the phone, and Chats on the desktop); the list sits under the box in the dialog. */
  variant?: 'header' | 'dialog';
  /** After a row is chosen (chosen true), or Esc leaves the box (the dialog closes). */
  onDone?: (chosen: boolean) => void;
  /** The control a sheet opened from here gives focus back to; left out, the box itself (the dialog gives its opener). */
  opener?: () => HTMLElement | null;
}

export function CommandBox({ variant = 'header', onDone, opener }: CommandBoxProps) {
  const t = useT();
  const inputId = useId();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const answer = useFind(text);

  const groups = answer.groups.map((group) => ({ ...group, label: group.id === 'page' ? t('find.group.page') : group.id === 'action' ? t('find.group.action') : t(`find.group.${group.id}`) }));
  const flat: FindRow[] = [
    ...(answer.ask && answer.askFirst ? [answer.ask] : []),
    ...groups.flatMap((group) => group.rows),
    ...(answer.ask && !answer.askFirst ? [answer.ask] : []),
  ];
  const showing = open && flat.length > 0;
  const at = flat.length ? Math.min(active, flat.length - 1) : 0;
  const optionId = (row: FindRow) => `${listId}-${row.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

  // A new answer starts at the top again.
  const firstId = flat[0]?.id;
  useEffect(() => { setActive(0); }, [firstId, text]);

  function choose(row: FindRow) {
    setText('');
    setOpen(false);
    if (row.kind === 'ask') askChausar(row.words, { send: true });
    else if (row.href === null) askChausar('');
    else go(row.href);
    onDone?.(true);
  }

  /** Goes to the href; a sheet named there remembers its opener (as openSheet does), so closing it puts focus back. */
  function go(href: string) {
    const route = parseHash(href);
    if (route.sheet) {
      const from = opener?.();
      rememberOpener(from ?? input.current, from ? undefined : HEADER_BOX);
    }
    navigate(route);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!flat.length) return;
        if (!open) { setOpen(true); return; }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((at + step + flat.length) % flat.length);
        return;
      }
      case 'Home':
      case 'End':
        if (!showing) return;
        event.preventDefault();
        setActive(event.key === 'Home' ? 0 : flat.length - 1);
        return;
      case 'Enter':
        if (!flat.length) return;
        event.preventDefault();
        choose(flat[at]!);
        return;
      case 'Escape':
        // The list closes and an open sheet stays open; a second Esc leaves the box.
        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        if (showing) { setOpen(false); return; }
        input.current?.blur();
        onDone?.(false);
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
    }
  }

  const pressRow = (row: FindRow) => (event: MouseEvent) => { event.preventDefault(); choose(row); };
  const keep = (event: MouseEvent) => event.preventDefault();

  function renderRow(row: FindRow) {
    const index = flat.indexOf(row);
    const on = index === at;
    let body: ReactNode;
    let proof: ReactNode = null;
    if (row.kind === 'record') {
      body = <RecordRow item={row.item} />;
      if (row.item.kind === 'invoice' && row.item.total && row.item.receiptId) proof = <Figure value={row.item.total} receiptId={row.item.receiptId} />;
    } else if (row.kind === 'entry') {
      body = <span className={s.main}>{marked(row.label, row.hit)}</span>;
    } else if (row.kind === 'more') {
      body = <span className={s.quiet}>{t('find.more', { count: formatCount(row.count, answer.country) })}</span>;
    } else {
      body = <span className={s.main}>{t('find.ask.lead')} <q data-content="">{row.words}</q></span>;
    }
    return (
      <div key={row.id} className={cx(s.row, on && s.on)} data-row-id={row.id} onMouseDown={keep}>
        <div role="option" id={optionId(row)} aria-selected={on} className={s.option} onClick={pressRow(row)} onMouseEnter={() => setActive(index)}>
          {body}
        </div>
        {proof && <span className={s.proof}>{proof}</span>}
        {on && <kbd className={cx(s.enter, 'mono')} aria-hidden="true">{t('find.enter')}</kbd>}
      </div>
    );
  }

  const askRow = answer.ask ? <div role="group" aria-label={t('find.group.ask')} className={s.group}>{renderRow(answer.ask)}</div> : null;

  return (
    <div className={cx(s.box, variant === 'dialog' && s.inDialog)} data-find-box="" data-find-header={variant === 'header' ? '' : undefined}>
      <div className={s.field}>
        <Icon name="search" size={16} className={s.icon} />
        <label className="sr-only" htmlFor={inputId}>{t('find.label')}</label>
        <input
          ref={input}
          id={inputId}
          className={s.input}
          type="text"
          role="combobox"
          value={text}
          placeholder={t('find.label')}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-keyshortcuts="Control+K"
          aria-autocomplete="list"
          aria-expanded={showing}
          aria-controls={listId}
          aria-activedescendant={showing && flat[at] ? optionId(flat[at]!) : undefined}
          onChange={(event) => { setText(event.target.value); setOpen(true); }}
          onFocus={() => { if (text) setOpen(true); }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {text && (
          <button type="button" className={s.clear} aria-label={t('find.clear')} onMouseDown={keep} onClick={() => { setText(''); input.current?.focus(); }}>
            <Icon name="x" size={16} />
          </button>
        )}
        <kbd data-code="" className={cx(s.keys, 'mono')} aria-hidden="true">{FIND_KEYS}</kbd>
      </div>
      {showing && answer.failed && <p className={s.failed} role="status" data-find-failed="">{t('find.failed')}</p>}
      <div id={listId} role="listbox" aria-label={t('find.label')} className={s.list} data-find-list="" hidden={!showing}>
        {showing && (
          <>
            {answer.askFirst && askRow}
            {groups.map((group) => (
              <div key={group.id} role="group" aria-label={group.label} className={s.group}>
                <div className={s.groupTitle} aria-hidden="true">{group.label}</div>
                {group.rows.map(renderRow)}
              </div>
            ))}
            {!answer.askFirst && askRow}
          </>
        )}
      </div>
    </div>
  );
}
