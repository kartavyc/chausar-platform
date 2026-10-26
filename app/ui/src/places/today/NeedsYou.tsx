import { Fragment, useId, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { QueueKind, QueueRow } from '../../engine/types';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { FilterChips, type FilterOption } from '../../parts/FilterChips';
import { Icon } from '../../parts/Icon';
import { SectionHead } from '../../parts/Tile';
import type { DecidedLine } from './session';
// W4 4J19: approve several (O9) and sort Today (O18).
import { SetPicker, setCandidates } from './SetPicker';
import { TriageBox } from './TriageBox';
import { useOpenBusiness } from '../../shell/openBusiness';
import s from './NeedsYou.module.css';

/** A row of the list: waiting on the owner, or decided here and shrunk to its receipt line. */
export interface NeedsItem { row: QueueRow; done?: DecidedLine | undefined }

export type CardLayout = 'card' | 'compact';

/** The first rows are full cards (4Z3: the founder's five most urgent, in the engine's queue order); the rest wait
 *  behind "Show N more", which names them. No compact cards sit between them (a probe's notice is still compact). */
export const BIG_CARDS = 5;
export const COMPACT_CARDS = 0;
/** The fold names at most this many of the rows behind it, then says how many more. */
const FOLD_TITLES = 3;

/** What each kind counts as in the filter chips. Everything that is not a question or setup is a decision. */
type KindGroup = 'approve' | 'questions' | 'setup';
const GROUP_OF: Readonly<Record<QueueKind, KindGroup>> = {
  draft: 'approve', price: 'approve', quote: 'approve', plan: 'approve', invoice: 'approve', signoff: 'approve', connector: 'approve', bank: 'approve', proposal: 'approve',
  // W4 4E4: a follow-up and a reply are yours to act on; a notice (notes after a call) asks a question.
  followup: 'approve', reply: 'approve', notice: 'questions',
  question: 'questions',
  setup: 'setup', locked: 'setup',
};
const GROUPS: readonly KindGroup[] = ['approve', 'questions', 'setup'];
const BUSINESS = 'business:';
/** W4 4J19: the rows made while the owner was away (venture.away.get `since`, 4F1), after they come back. */
export const SINCE = 'since';

/** Whether a row shows under a filter: all, a kind group, one business (`business:<id>`), or since you left (with
 *  the engine's row ids; without them the filter shows every row). */
export function matchesFilter(row: Pick<QueueRow, 'kind' | 'businessId'> & { id?: string }, filter: string, since?: ReadonlySet<string>): boolean {
  if (filter === SINCE) return since === undefined || (row.id !== undefined && since.has(row.id));
  if (filter.startsWith(BUSINESS)) return row.businessId === filter.slice(BUSINESS.length);
  if ((GROUPS as readonly string[]).includes(filter)) return (GROUP_OF[row.kind] ?? 'approve') === filter;
  return true;
}

/** A filter the chips can show; anything else in the address reads as All. */
export function knownFilter(filter: string | undefined, rows: readonly Pick<QueueRow, 'businessId'>[]): string {
  if (!filter) return 'all';
  if ((GROUPS as readonly string[]).includes(filter) || filter === SINCE) return filter;
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
 * more than one business, by business (a locked one with its lock), then the rows as cards: the five most urgent as
 * full cards (BIG_CARDS), and the rest folded behind "Show N more", which counts and names only the rows still waiting
 * there. A filter is kept in the address. Every card sits in one grid, keyed by its row, so a card that
 * moves (a filter, a decision above it) stays the same card: an answer being typed and a decision on its way survive.
 * The cards keep every rule of a row (the second ask, view before approve, the digest); this part only lays them out.
 */
export function NeedsYou({ items, loaded, failed, filter, onFilter, expanded, onExpand, card, phone = false, tip }: NeedsYouProps) {
  const t = useT();
  const headingId = useId();
  const waiting = items.filter((item) => !item.done).map((item) => item.row);
  // W4 4J19: "Since you left", once the owner is back from time away (the engine's own list of rows made meanwhile).
  const away = useResource('venture.away.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const sinceIds = away.data?.since ? new Set(away.data.since.rowIds) : undefined;
  const visible = items.filter((item) => matchesFilter(item.row, filter, sinceIds));
  const [tool, setTool] = useState<'set' | 'sort' | null>(null);
  // W4 4J19: a set takes the open business's rows only, as the engine lists them for it (never venture.get's id).
  const open = useOpenBusiness();
  const candidates = setCandidates(waiting, open.rowIds);
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
        <FilterChips label={t('today.filter.label')} options={options(t, waiting, filter, sinceIds)} value={filter} onChange={onFilter} scroll={phone} className={s.chips} />
      )}
      {waiting.length > 0 && tip}
      {waiting.length > 0 && tool === null && (
        <div className={s.tools}>
          {candidates.length > 1 && <Button variant="quiet" size="sm" onClick={() => setTool('set')}>{t('today.set.open')}</Button>}
          {waiting.length > 1 && <Button variant="quiet" size="sm" onClick={() => setTool('sort')}>{t('today.triage.open')}</Button>}
        </div>
      )}
      {tool === 'set' && <SetPicker rows={candidates} onClose={() => setTool(null)} />}
      {tool === 'sort' && <TriageBox onClose={() => setTool(null)} />}

      {shown.length > 0 && (
        <div className={s.cards}>
          {/* W4 4J19: a needs-you probe's notice (4G2) is always a compact card. */}
          {shown.map((item, index) => <Fragment key={item.row.id}>{card(item, index < BIG_CARDS && !item.row.notice ? 'card' : 'compact')}</Fragment>)}
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
function options(t: ReturnType<typeof useT>, waiting: readonly QueueRow[], filter: string, since?: ReadonlySet<string>): FilterOption[] {
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
  const sinceCount = since ? waiting.filter((row) => since.has(row.id)).length : 0;
  const sinceOption: FilterOption[] = since && (sinceCount > 0 || filter === SINCE) ? [{ id: SINCE, label: t('today.filter.since'), count: sinceCount }] : [];
  return [{ id: 'all', label: t('today.filter.all'), count: waiting.length }, ...sinceOption, ...kinds, ...byBusiness];
}

/**
 * The fold (D-Today `.stackbar`): how many more need you, the first few of them, and the button that shows them. 4Z2:
 * one plain tile, without the sheets peeking under it (they read as a stray sliver) or the faces of who they are from
 * (an agent's initials with no department colour read as an odd avatar); the titles name them.
 */
function More({ rest, onShow }: { rest: readonly NeedsItem[]; onShow: () => void }) {
  const t = useT();
  const titles = rest.slice(0, FOLD_TITLES).map((item) => item.row.title).join(' · ');
  const others = rest.length - FOLD_TITLES;
  return (
    <div className={s.more} data-more="">
      <div className={s.front}>
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
