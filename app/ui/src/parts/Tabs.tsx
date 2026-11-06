import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useT, type T } from '../text';
import { DeptDot } from './Chip';
import { cx } from './cx';
import { Count } from './Figure';
import { DEPT_IDS, type DeptId } from './icons';
import { fitTabs, type Fit } from './tabs-fit';
import s from './Tabs.module.css';

/**
 * Tabs (C1 task 1): the one row of tabs in the app. Three modes:
 *   `links`    sub-pages held in the address (Money, Clients); a nav, the page marked `aria-current="page"`.
 *   `buttons`  a one-of-many switch inside a page or form (the department row, a draft's kind); a group of
 *              `aria-pressed` buttons.
 *   `tabs`     tabs over panels inside a sheet (the agent sheet); a tablist with a roving tab stop, arrow keys, Home
 *              and End. The caller draws the panel, `${idOf(id)}-panel`, labelled by the tab.
 * The row never scrolls sideways and never cuts a word: the items that do not fit go under a More button at the end
 * of the row, a disclosure holding the same links or buttons. `primary` keeps only those ids in the row at every
 * width. The current item is always in the row. The row is measured on mount, when its items change, when the fonts
 * load and whenever its own width changes (a sheet opening beside the page); nothing measured (jsdom) keeps every
 * primary item in the row. No icons and no frame: one quiet look. The row carries `data-tabs` and the current item
 * `data-current`, for the motion layer to find; there is no motion here.
 */

export interface TabItem {
  id: string;
  label: string;
  /** How many there are (a Count, never money); zero is not drawn. */
  count?: number | string | undefined;
  /** A department's dot before the words (the department row). */
  dept?: DeptId | undefined;
  /** Quiet words after the label (the agent sheet's instructions version). */
  after?: ReactNode;
}

export interface TabLink extends TabItem {
  href: string;
}

interface Common {
  /** The row's name ("Show departments", "Money pages"). */
  label: string;
  /** The id of the current item. */
  value: string;
  /** Only these ids sit in the row; the rest are under More at every width. */
  primary?: readonly string[] | undefined;
  className?: string | undefined;
}

export type TabsProps =
  | (Common & { mode: 'links'; items: readonly TabLink[]; onChange?: never; idOf?: never })
  | (Common & { mode: 'buttons'; items: readonly TabItem[]; onChange: (id: string) => void; idOf?: never })
  | (Common & { mode: 'tabs'; items: readonly TabItem[]; onChange: (id: string) => void; idOf?: ((id: string) => string) | undefined });

const drawn = (count: TabItem['count']) => count !== undefined && count !== '' && count !== 0 && count !== '0';

function Inside({ item }: { item: TabItem }) {
  return (
    <>
      {item.dept && <DeptDot dept={item.dept} />}
      <span>{item.label}</span>
      {item.after !== undefined && item.after !== null && <>{' '}{item.after}</>}
      {drawn(item.count) && (
        <>
          {' '}
          <Count value={item.count!} className={s.count} />
        </>
      )}
    </>
  );
}

/** What is measured once per set of items: each item's width and More's. Layout pixels only. */
interface Sizes { key: string; widths: number[]; more: number; gap: number }

export function Tabs(props: TabsProps) {
  const t = useT();
  const { label, value, primary, className, items } = props;
  const base = useId();
  const menuId = `${base}-more`;
  const row = useRef<HTMLDivElement & HTMLElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [sizes, setSizes] = useState<Sizes | null>(null);
  const [room, setRoom] = useState(0);
  const [fonts, setFonts] = useState(0);

  const key = `${fonts}\u0002${items.map((item) => `${item.id}\u0001${item.label}\u0001${drawn(item.count) ? String(item.count) : ''}`).join('\u0002')}`;
  const measuring = sizes?.key !== key;
  const current = items.findIndex((item) => item.id === value);
  const primaryIndexes = primary ? items.flatMap((item, index) => (primary.includes(item.id) ? [index] : [])) : undefined;
  const fit: Fit = measuring
    ? { row: items.map((_, index) => index), more: [] }
    : fitTabs({ widths: sizes.widths, room, moreWidth: sizes.more, current, primary: primaryIndexes, gap: sizes.gap });
  // While measuring every item is in the row and More is drawn, so both have a width.
  const inRow = fit.row;
  const underMore = fit.more;
  const showMore = measuring || underMore.length > 0;

  // Measure before paint: each item's width and More's, then the room. CSSOM reads only; nothing is written.
  useLayoutEffect(() => {
    if (!measuring || !row.current) return;
    const widths = items.map((item) => row.current?.querySelector<HTMLElement>(`[data-tab-item="${CSS.escape(item.id)}"]`)?.offsetWidth ?? 0);
    const holder = row.current.querySelector<HTMLElement>('[data-tabs-more]');
    const gap = Number(getComputedStyle(row.current).columnGap.replace('px', '')) || 0;
    setSizes({ key, widths, more: holder?.offsetWidth ?? 0, gap });
    setRoom(row.current.clientWidth);
  });

  useEffect(() => {
    const element = row.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setRoom(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A font that loads late changes the widths: measure again then.
  useEffect(() => {
    let live = true;
    void document.fonts?.ready?.then(() => { if (live) setFonts((n) => n + 1); });
    return () => { live = false; };
  }, []);

  // The tab the keys moved to may have been under More: focus it once it is drawn in the row.
  useEffect(() => {
    const id = focusNext.current;
    if (id === null) return;
    focusNext.current = null;
    row.current?.querySelector<HTMLElement>(`[data-tab-item="${CSS.escape(id)}"]`)?.focus();
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !moreButton.current?.contains(target)) setOpen(false);
    };
    const at = window.location.hash;
    const moved = () => { if (window.location.hash !== at) setOpen(false); };
    document.addEventListener('mousedown', away);
    window.addEventListener('hashchange', moved);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('hashchange', moved); };
  }, [open]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    moreButton.current?.focus();
  }, []);

  const choose = (id: string) => {
    setOpen(false);
    if (props.mode !== 'links') props.onChange(id);
  };

  const tabIdOf = (id: string) => (props.mode === 'tabs' && props.idOf ? props.idOf(id) : `${base}-tab-${id}`);

  function onTabKey(event: KeyboardEvent<HTMLElement>) {
    if (props.mode !== 'tabs' || items.length === 0) return;
    const at = Math.max(0, current);
    const next = event.key === 'ArrowRight' ? items[(at + 1) % items.length]
      : event.key === 'ArrowLeft' ? items[(at + items.length - 1) % items.length]
        : event.key === 'Home' ? items[0]
          : event.key === 'End' ? items[items.length - 1] : undefined;
    if (!next) return;
    event.preventDefault();
    focusNext.current = next.id;
    if (next.id === value) row.current?.querySelector<HTMLElement>(`[data-tab-item="${CSS.escape(next.id)}"]`)?.focus();
    else props.onChange(next.id);
  }

  const rowItem = (index: number) => {
    const item = items[index]!;
    const on = item.id === value;
    const common = { className: s.item, 'data-tab-item': item.id, 'data-current': on ? '' : undefined };
    if (props.mode === 'links') {
      const link = item as TabLink;
      return (
        <li key={item.id}>
          <a {...common} href={link.href} aria-current={on ? 'page' : undefined}><Inside item={item} /></a>
        </li>
      );
    }
    if (props.mode === 'buttons') {
      return <button key={item.id} type="button" {...common} aria-pressed={on} onClick={() => choose(item.id)}><Inside item={item} /></button>;
    }
    const id = tabIdOf(item.id);
    return (
      <button
        key={item.id} type="button" role="tab" id={id} {...common}
        aria-selected={on} aria-controls={on ? `${id}-panel` : undefined} tabIndex={on ? 0 : -1}
        onClick={() => choose(item.id)}
      >
        <Inside item={item} />
      </button>
    );
  };

  const moreItem = (index: number) => {
    const item = items[index]!;
    if (props.mode === 'links') {
      return <li key={item.id}><a className={s.menuItem} href={(item as TabLink).href} onClick={() => setOpen(false)}><Inside item={item} /></a></li>;
    }
    const pick = () => {
      if (props.mode === 'tabs') focusNext.current = item.id;
      choose(item.id);
    };
    return <li key={item.id}><button type="button" className={s.menuItem} aria-pressed={props.mode === 'buttons' ? false : undefined} onClick={pick}><Inside item={item} /></button></li>;
  };

  const more = showMore && (
    <div className={s.moreHolder} data-tabs-more="" onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); closeMenu(); } }}>
      <button
        ref={moreButton} type="button" className={cx(s.item, s.moreButton)} aria-expanded={open} aria-controls={menuId}
        tabIndex={measuring && underMore.length === 0 ? -1 : undefined} aria-hidden={measuring && underMore.length === 0 ? true : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        {t('tabs.more')}
      </button>
      {open && underMore.length > 0 && (
        <div ref={menu} id={menuId} className={s.menu}>
          <ul className={s.menuList}>{underMore.map(moreItem)}</ul>
        </div>
      )}
    </div>
  );

  if (props.mode === 'links') {
    return (
      <nav ref={row} className={cx(s.tabs, className)} aria-label={label} data-tabs="" data-measuring={measuring ? '' : undefined}>
        <ul className={s.list}>{inRow.map(rowItem)}</ul>
        {more}
      </nav>
    );
  }
  if (props.mode === 'buttons') {
    return (
      <div ref={row} className={cx(s.tabs, className)} role="group" aria-label={label} data-tabs="" data-measuring={measuring ? '' : undefined}>
        {inRow.map(rowItem)}
        {more}
      </div>
    );
  }
  return (
    <div ref={row} className={cx(s.tabs, className)} data-tabs="" data-measuring={measuring ? '' : undefined}>
      <div role="tablist" aria-label={label} className={s.list} onKeyDown={onTabKey}>{inRow.map(rowItem)}</div>
      {more}
    </div>
  );
}

/**
 * The department row's choices (founder decision 23 Oct, spec section 3 "Team"): "All departments", then the five
 * departments in their fixed order, each with its dot. The ids are `all` and the department ids.
 */
export function departmentChoices(t: T): (TabItem & { id: 'all' | DeptId })[] {
  return [
    { id: 'all', label: t('dept.all') },
    ...DEPT_IDS.map((dept) => ({ id: dept, label: t(`dept.${dept}`), dept })),
  ];
}
