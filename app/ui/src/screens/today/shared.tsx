/**
 * Shared pieces of the three forms of Today: the system rows the screen adds, the at-rest
 * cut of attention rows, the in-place expansion with Review, and the open-row state.
 */

import { useId, useMemo, useRef, useState } from 'react';
import type { Address, Missing, RowItem, View, StatTile } from '../../app/presentation.ts';
import { useLanguage, useT } from '../../app/text';
import { Button } from '../../parts/Button';
import { RowList } from '../../parts/RowList';
import { Stat } from '../../parts/Stat';
import { DayLine } from '../../parts/DayLine';
import { MissingWords } from '../../parts/Figure';
import { Square } from '../../parts/Square';
import type { Mark } from '../../app/presentation.ts';
import { CLOSING_PARTS, type ClosingPart, type ClosingPartState } from '../../bridge/todayx-contract.ts';
import s from './Today.module.css';
import { TODAY_ATTENTION_MAX, TODAY_REVIEW_MAX, type TodayData, type TodayIntents } from './TodayData.ts';
import { projectWorth, worthAddress, WORTH_MAX } from './worth.ts';

export interface TodayScreenProps {
  data: TodayData;
  intents: TodayIntents;
  view: View;
  sheetId?: string | undefined;
  onNavigate: (a: Address) => void;
}

const SETUP_ROW = 'system:setup';
const UPDATE_ROW = 'system:update';

/** The rows the screen adds for setup and updates. Their words are UI text. A row offers
 *  its action only when the engine offered it and the adapter supplied the callback; with
 *  either one missing the row still says what is true and shows no button. */
export function useSystemRows(data: TodayData, intents: TodayIntents): ReadonlyArray<RowItem> {
  const t = useT();
  const rows: RowItem[] = [];
  if (data.setup) {
    const offered = data.setup.can?.includes('continue') === true && intents.onResumeSetup !== undefined;
    rows.push({ id: SETUP_ROW, mark: 'wait', what: t('TD-01.setup', { step: data.setup.step, of: data.setup.of }), can: offered ? ['open'] : [] });
  }
  if (data.update) {
    const offered = data.update.can?.includes('update') === true && intents.onUpdate !== undefined;
    rows.push({ id: UPDATE_ROW, mark: 'wait', what: t('TD-01.update'), can: offered ? ['open'] : [] });
  }
  return rows;
}

/** Review and worth-a-look rows cut to the at-rest limits: four, and five together. The
 *  worth-a-look rows past the cut wait behind "See all"; `showAll` is that opened state.
 *  `hidden` is how many rows the cut left out at rest. */
export function attentionRows(data: TodayData, system: ReadonlyArray<RowItem>, worthRows: ReadonlyArray<RowItem> = data.worthALook ?? [], showAll = false) {
  const review = [...system, ...data.review.rows].slice(0, TODAY_REVIEW_MAX);
  const offered = worthRows.slice(0, WORTH_MAX);
  const atRest = offered.slice(0, Math.max(0, TODAY_ATTENTION_MAX - review.length));
  const worth = showAll ? offered : atRest;
  return { review, worth, hidden: offered.length - atRest.length, offered: offered.length };
}

/** The worth-a-look section's rows and how each one opens. With a checked `todayx.worthALook`
 *  reply the rows come from worth.ts and open their page through `onNavigate`; otherwise the
 *  supplied `worthALook` rows open through `onOpenRow`, as before. */
export function useWorth(data: TodayData, intents: TodayIntents, view: View, onNavigate: (a: Address) => void) {
  const language = useLanguage();
  const [showAll, setShowAll] = useState(false);
  const projection = useMemo(() => (data.worth ? projectWorth(data.worth, { language, view }) : null), [data.worth, language, view]);
  const rows: ReadonlyArray<RowItem> = projection ? projection.rows : data.worthALook ?? [];
  const missing: Missing | undefined = projection?.missing;
  const onOpenRow = intents.onOpenRow;
  const opens = (row: RowItem) => (projection ? worthAddress(projection, row.id) !== null : row.can?.includes('open') === true && onOpenRow !== undefined);
  const onOpen = (id: string, origin: HTMLElement | null) => {
    if (projection) {
      const address = worthAddress(projection, id);
      if (address !== null) onNavigate(address);
    } else onOpenRow?.(id, origin);
  };
  return { rows, missing, opens, onOpen, showAll, toggle: () => setShowAll((v) => !v) };
}

export interface WorthSectionProps {
  rows: ReadonlyArray<RowItem>;
  /** How many rows the at-rest cut left out, and how many the engine offered. */
  hidden: number;
  offered: number;
  missing?: Missing | undefined;
  showAll: boolean;
  onToggle: () => void;
  onOpen: (id: string, origin: HTMLElement | null) => void;
  opens: (row: RowItem) => boolean;
  onReceipt: (receiptId: string) => void;
  /** The id the section's heading carries. */
  labelId: string;
}

/** Worth a look, below the review rows (TD-01). Each row opens its page; each figure its
 *  receipt. Not loaded yet is its words. "See all" opens the rows past the at-rest cut. */
export function WorthSection({ rows, hidden, offered, missing, showAll, onToggle, onOpen, opens, onReceipt, labelId }: WorthSectionProps) {
  const t = useT();
  if (missing === undefined && rows.length === 0 && hidden === 0) return null;
  return (
    <section className={s.section} aria-labelledby={labelId}>
      <h2 id={labelId} className={s.label}>
        {t('TD-01.worth')}
      </h2>
      {missing !== undefined ? (
        <p className={s.missing}>
          <MissingWords missing={missing} />
        </p>
      ) : (
        rows.length > 0 && <RowList rows={rows} labelledBy={labelId} onOpen={onOpen} opens={opens} onReceipt={onReceipt} />
      )}
      {(hidden > 0 || showAll) && missing === undefined && (
        <Button variant="link" onClick={onToggle}>
          {showAll ? t('TD-01.worth.fewer') : t('TD-01.worth.seeAll', { count: String(offered) })}
        </Button>
      )}
    </section>
  );
}

/** Whether a row opens in place: it has a line of detail to show or an action to offer. */
export function opensInPlace(row: RowItem): boolean {
  return (row.detail !== undefined && row.detail.length > 0) || (row.can !== undefined && row.can.length > 0);
}

/** The in-place expansion of a row: one line of detail and Review (or Prepare, or Open).
 *  A button appears only when the engine offered the action in `can` and its callback
 *  was supplied. There is never an enabled button with nothing behind it. */
export function RowExpansion({ row, intents, origin }: { row: RowItem; intents: TodayIntents; origin: HTMLElement | null }) {
  const t = useT();
  const can = row.can ?? [];
  const onResumeSetup = intents.onResumeSetup;
  const onUpdate = intents.onUpdate;
  const onPrepare = intents.onPrepare;
  const onOpenRow = intents.onOpenRow;

  if (row.id === SETUP_ROW) {
    return (
      <>
        <span />
        {can.includes('open') && onResumeSetup && (
          <Button variant="filled" onClick={() => onResumeSetup()}>
            {t('BTN.continue')}
          </Button>
        )}
      </>
    );
  }
  if (row.id === UPDATE_ROW) {
    return (
      <>
        <span />
        {can.includes('open') && onUpdate && (
          <Button variant="filled" onClick={() => onUpdate()}>
            {t('BTN.update')}
          </Button>
        )}
      </>
    );
  }
  return (
    <>
      <span>{row.detail}</span>
      {can.includes('review') ? (
        <Button variant="filled" onClick={() => intents.onReview(row.id, origin)}>
          {t('BTN.review')}
        </Button>
      ) : can.includes('prepare') && onPrepare ? (
        <Button variant="quiet" onClick={() => onPrepare(row.id)}>
          {t('BTN.prepare')}
        </Button>
      ) : can.includes('open') && onOpenRow ? (
        <Button variant="quiet" onClick={() => onOpenRow(row.id, origin)}>
          {t('BTN.open')}
        </Button>
      ) : null}
    </>
  );
}

/** Which row is open in place, and where each row's control is for focus return. */
export function useInPlaceRows() {
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const origins = useRef(new Map<string, HTMLElement>());
  const registerOrigin = (id: string, el: HTMLButtonElement | null) => {
    if (el) origins.current.set(id, el);
    else origins.current.delete(id);
  };
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? undefined : id));
  const originOf = (id: string) => origins.current.get(id) ?? null;
  return { openId, toggle, registerOrigin, originOf };
}

/** The independent producer's scoped controls are absent from legacy callers. */
export function TodayConsumerControls({ data, intents }: { data: TodayData; intents: TodayIntents }) {
  const t = useT(); if (data.review.scoped === undefined) return null;
  return <>
    {intents.onSeeAll && <Button variant="link" onClick={intents.onSeeAll}>{t('TODAY_ENGINE.seeAll')}</Button>}
    {intents.onPrepareTiles && <>
      <p>{t('TODAY_ENGINE.prepareNote')}</p>
      <Button variant="quiet" disabled={intents.preparingTiles} onClick={event => intents.onPrepareTiles?.(event.currentTarget)}>{t(intents.preparingTiles ? 'TODAY_ENGINE.preparing' : 'TODAY_ENGINE.prepare')}</Button>
    </>}
  </>;
}
/** Books keeps the genuine review ledger while accounting-specific fields are missing. */
export function TodayConsumerLedger({ data, intents }: { data: TodayData; intents: TodayIntents }) {
  const inPlace = useInPlaceRows();
  if (data.review.scoped === undefined) return null;
  const { review, worth } = attentionRows(data, []);
  return <RowList rows={[...review, ...worth]} openId={inPlace.openId} onOpen={inPlace.toggle} opens={opensInPlace} onReceipt={intents.onReceipt} registerOrigin={inPlace.registerOrigin}
    expansion={row => <RowExpansion row={row} intents={intents} origin={inPlace.originOf(row.id)} />} />;
}
/** Capture the exact chart mark or figure before its receipt callback is dispatched. */
export function TodayStat({ tile, intents }: { tile: StatTile; intents: TodayIntents }) {
  const t = useT(), origin = useRef<HTMLElement | SVGElement | null>(null);
  if (intents.onOpenTile === undefined) return <Stat tile={tile} onReceipt={intents.onReceipt} />;
  const capture = (target: EventTarget | null) => {
    const control = target instanceof Element ? target.closest('button,[role="button"]') : null;
    origin.current = control instanceof HTMLElement || control instanceof SVGElement ? control : null;
  };
  return <div onClickCapture={event => capture(event.target)} onKeyDownCapture={event => capture(event.target)}>
    <Stat tile={tile} onReceipt={id => intents.onReceipt(id, origin.current)} />
    <Button variant="link" onClick={event => intents.onOpenTile?.(tile.id, event.currentTarget)}>{t('TODAY_ENGINE.definition')}</Button>
  </div>;
}
/** Every view can read the same supplied figures, individual bucket receipts and six events. */
export function TodayProducerSections({ data, intents }: { data: TodayData; intents: TodayIntents }) {
  const t = useT(); if (data.review.scoped === undefined) return null;
  return <>
    <section className={s.section}><h2 className={s.label}>{t('TODAY_ENGINE.figures')}</h2>
      {data.thisMonth?.length ? <div className={s.tiles}>{data.thisMonth.map(tile => <TodayStat key={tile.id} tile={tile} intents={intents} />)}</div>
        : <p className={s.missing}><MissingWords missing={data.thisMonthMissing ?? 'unknown'} /></p>}
    </section>
    <section className={s.section}><h2 className={s.label}>{t('TD-01.earlier')}</h2>
      {data.earlierToday?.length ? <DayLine events={data.earlierToday} onReceipt={intents.onReceipt} onOpenEvent={intents.onOpenEvent} onOpenAll={intents.onOpenActivity} />
        : <p className={s.missing}><MissingWords missing={data.earlierTodayMissing ?? 'unknown'} /></p>}
    </section>
  </>;
}

const CLOSING_MARK: Readonly<Record<ClosingPartState, Mark>> = { done: 'cha', 'not-done': 'wait', 'not-loaded-yet': 'off' };

/** TD-01 "Daily closing on": the closing row, in every view, only while daily closing is on.
 *  Cash counts as done when the owner told today's cash here, whatever the engine holds. */
export function ClosingRow({ data }: { data: TodayData }) {
  const t = useT();
  const id = useId();
  const closing = data.closing;
  if (closing === undefined || !closing.on) return null;
  const state = (part: ClosingPart): ClosingPartState => (part === 'cash' && data.cash?.entered !== undefined ? 'done' : closing.parts[part]);
  return (
    <section className={s.section} aria-labelledby={id} data-closing="">
      <h2 id={id} className={s.label}>{t('TD-01.closing')}</h2>
      <p className={s.quiet}>
        {CLOSING_PARTS.map((part) => (
          <span key={part} data-closing-part={part} data-state={state(part)}>
            {t(`TD-01.closing.${part}`)} <Square mark={CLOSING_MARK[state(part)]} wordsKey={`TD-01.closing.${state(part)}`} showWords />
          </span>
        ))}
      </p>
    </section>
  );
}
