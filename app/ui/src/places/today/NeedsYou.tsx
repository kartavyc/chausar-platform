import { Fragment, useId, type ReactNode } from 'react';
import { useT } from '../../text';
import type { QueueKind, QueueRow } from '../../engine/types';
import { Avatar, ChausarAvatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { FilterChips, type FilterOption } from '../../parts/FilterChips';
import { Icon } from '../../parts/Icon';
import { SectionHead } from '../../parts/Tile';
import type { DecidedLine } from './session';
import s from './NeedsYou.module.css';

/** A row of the list: waiting on the owner, or decided here and shrunk to its receipt line. */
export interface NeedsItem { row: QueueRow; done?: DecidedLine | undefined }

export type CardLayout = 'card' | 'compact';

/** The first rows are big cards, the next ones compact; the rest wait behind "Show N more". */
export const BIG_CARDS = 6;
export const COMPACT_CARDS = 4;
/** The fold names at most this many of the rows behind it, then says how many more. */
const FOLD_TITLES = 3;

/** What each kind counts as in the filter chips. Everything that is not a question or setup is a decision. */
type KindGroup = 'approve' | 'questions' | 'setup';
const GROUP_OF: Readonly<Record<QueueKind, KindGroup>> = {
  draft: 'approve', price: 'approve', quote: 'approve', plan: 'approve', invoice: 'approve', signoff: 'approve', connector: 'approve', bank: 'approve',
  question: 'questions',
  setup: 'setup', locked: 'setup',
};
const GROUPS: readonly KindGroup[] = ['approve', 'questions', 'setup'];
const BUSINESS = 'business:';

/** Whether a row shows under a filter: all, a kind group, or one business (`business:<id>`). */
export function matchesFilter(row: Pick<QueueRow, 'kind' | 'businessId'>, filter: string): boolean {
  if (filter.startsWith(BUSINESS)) return row.businessId === filter.slice(BUSINESS.length);
  if ((GROUPS as readonly string[]).includes(filter)) return (GROUP_OF[row.kind] ?? 'approve') === filter;
  return true;
}

/** A filter the chips can show; anything else in the address reads as All. */
export function knownFilter(filter: string | undefined, rows: readonly Pick<QueueRow, 'businessId'>[]): string {
  if (!filter) return 'all';
  if ((GROUPS as readonly string[]).includes(filter)) return filter;
  if (filter.startsWith(BUSINESS) && rows.some((row) => `${BUSINESS}${row.businessId}` === filter)) return filter;
  return 'all';
}

export interface NeedsYouProps {
  /** Every row, waiting or decided here, in the order the page keeps. */
  items: readonly NeedsItem[];
  /** The engine answered: an empty list means nothing needs you, not "still loading". */
  loaded: boolean;
  /** Why the list could not be read, in the engine's words. */
  failed?: string | undefined;
  /** The filter in the address (`show`). */
  filter: string;
  onFilter: (filter: string) => void;
  /** The rest past the compact cards is shown. */
  expanded: boolean;
  /** Show the rest. The page then puts focus on the first of them. */
  onExpand: (firstId: string | undefined) => void;
  /** Draw one row as a big or a compact card, or as its decided line. */
  card: (item: NeedsItem, layout: CardLayout) => ReactNode;
  /** A phone: the filter chips are one row that scrolls sideways (D-Phone-Today). */
  phone?: boolean | undefined;
  /** Under the chips, before the cards: the phone's swipe tip, while there is something to swipe. */
  tip?: ReactNode;
}

/**
 * Needs you (D-Today `.needs`): the heading with how many things wait, filter chips by kind and, when rows come from
 * more than one business, by business (a locked one with its lock), then the rows as cards: six big cards in two
 * columns, four compact ones in a row, and the rest folded behind "Show N more", which counts and names only the rows
 * still waiting there. A filter is kept in the address. Every card sits in one grid, keyed by its row, so a card that
 * moves (a filter, a decision above it) stays the same card: an answer being typed and a decision on its way survive.
 * The cards keep every rule of a row (the second ask, view before approve, the digest); this part only lays them out.
 */
export function NeedsYou({ items, loaded, failed, filter, onFilter, expanded, onExpand, card, phone = false, tip }: NeedsYouProps) {
  const t = useT();
  const headingId = useId();
  const waiting = items.filter((item) => !item.done).map((item) => item.row);
  const visible = items.filter((item) => matchesFilter(item.row, filter));
  const shown = expanded ? visible : visible.slice(0, BIG_CARDS + COMPACT_CARDS);
  // Behind the fold, only what still waits counts: a row decided here or resolved elsewhere is not something more.
  const folded = expanded ? [] : visible.slice(BIG_CARDS + COMPACT_CARDS).filter((item) => !item.done);

  return (
    <section className={s.needs} aria-labelledby={headingId}>
      <SectionHead
        id={headingId}
        title={t('queue.title')}
        count={waiting.length > 0 ? waiting.length : undefined}
        countLabel={t('today.needs.count', { count: waiting.length })}
      />
      {failed && !loaded && <p className={s.failed}>{t('today.failed', { message: failed })}</p>}
      {waiting.length > 0 && (
        <FilterChips label={t('today.filter.label')} options={options(t, waiting, filter)} value={filter} onChange={onFilter} scroll={phone} className={s.chips} />
      )}
      {waiting.length > 0 && tip}

      {shown.length > 0 && (
        <div className={s.cards}>
          {shown.map((item, index) => <Fragment key={item.row.id}>{card(item, index < BIG_CARDS ? 'card' : 'compact')}</Fragment>)}
        </div>
      )}
      {folded.length > 0 && <More rest={folded} onShow={() => onExpand(folded[0]?.row.id)} />}

      {loaded && waiting.length === 0 && <EmptyState title={t('queue.empty')} />}
      {loaded && waiting.length > 0 && visible.length === 0 && (
        <EmptyState title={t('today.filter.none')} actions={[{ label: t('today.filter.showAll'), onSelect: () => onFilter('all') }]} />
      )}
    </section>
  );
}

/** The chips: All, the three kinds with something in them (or the one pressed), then each business when there are two
 *  or more. Counts are of the rows that wait, never money. */
function options(t: ReturnType<typeof useT>, waiting: readonly QueueRow[], filter: string): FilterOption[] {
  const kinds = GROUPS
    .map((group) => ({ id: group, label: t(`today.filter.${group}`), count: waiting.filter((row) => GROUP_OF[row.kind] === group).length }))
    .filter((option) => option.count > 0 || option.id === filter);
  // Businesses with the most waiting first, a locked one last (its rows are only "open it").
  const businesses = [...new Map(waiting.map((row) => [row.businessId, row.businessName])).entries()].map(([id, name]) => {
    const own = waiting.filter((row) => row.businessId === id);
    return { id, name, count: own.length, locked: own.some((row) => row.kind === 'locked') };
  }).sort((a, b) => Number(a.locked) - Number(b.locked) || b.count - a.count);
  const byBusiness: FilterOption[] = businesses.length < 2 ? [] : businesses.map(({ id, name, count, locked }, index) => (
    { id: `${BUSINESS}${id}`, label: name, count, business: !locked, locked, separatorBefore: index === 0 }
  ));
  return [{ id: 'all', label: t('today.filter.all'), count: waiting.length }, ...kinds, ...byBusiness];
}

/** The fold (D-Today `.stackbar`): how many more need you, the first few of them, and the button that shows them. */
function More({ rest, onShow }: { rest: readonly NeedsItem[]; onShow: () => void }) {
  const t = useT();
  const agents = [...new Set(rest.map((item) => item.row.agent ?? ''))].slice(0, 3);
  const titles = rest.slice(0, FOLD_TITLES).map((item) => item.row.title).join(' · ');
  const others = rest.length - FOLD_TITLES;
  return (
    <div className={s.more} data-more="">
      <span className={s.sheet} aria-hidden="true" />
      <span className={s.sheet} aria-hidden="true" />
      <div className={s.front}>
        <span className={s.stack} aria-hidden="true">
          {agents.map((agent) => (agent ? <Avatar key={agent} name={agent} size={32} /> : <ChausarAvatar key="chausar" size={32} />))}
        </span>
        <div className={s.moreText}>
          <p className={s.moreTitle}>{t('today.more.title', { count: rest.length })}</p>
          <p className={s.moreLine} data-more-line="">{others > 0 ? t('today.more.andMore', { titles, count: others }) : titles}</p>
        </div>
        <Button onClick={onShow}>
          {t('today.more.show', { count: rest.length })}
          <Icon name="chevron-down" size={16} />
        </Button>
      </div>
    </div>
  );
}

/**
 * The phone's swipe tip (D-Phone-Today `.tip`): how swiping works, and that big steps still ask twice. "Hide this tip"
 * hides it for the rest of the session; the page keeps that in memory (session.ts), never in browser storage.
 */
export function SwipeTip({ onHide }: { onHide: () => void }) {
  const t = useT();
  return (
    <div className={s.tip} data-tip="" role="note">
      <span className={s.tipIcon}><Icon name="arrow-left-right" size={16} /></span>
      <p className={s.tipText}>{t('today.swipe.tip')}</p>
      <button type="button" className={s.tipHide} aria-label={t('today.swipe.hideTip')} onClick={onHide}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
