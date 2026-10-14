/**
 * Today (TD-01, Guided): the date, "Awaiting your review" with its count and up to four
 * rows, worth a look, "This month" as three small charts, "Earlier today" on one line.
 * A row opens in place: one more line of detail and the Review button. Every figure and
 * every chart mark opens its receipt. Nothing awaits: the words, and the charts move up.
 * This file also chooses the Simple and Books forms by view; they share the data.
 * In the enterprise version the lens sits at the top, "The group this month" takes the
 * tiles, and "Changed since" replaces the day line.
 *
 * A row is a button only when it opens something: a review row with a detail or an
 * offered action, a worth-a-look row the engine offered to open with `onOpenRow` supplied.
 * A stat with no chart says why in words.
 */

import { useId, type ReactNode } from 'react';
import type { RowItem } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import { PageHeader } from '../../app/PageHeader';
import { RowList } from '../../parts/RowList';
import { DayLine } from '../../parts/DayLine';
import { Button } from '../../parts/Button';
import { MissingWords } from '../../parts/Figure';
import { State } from '../../patterns/States';
import { LensRow } from '../../patterns/Lens';
import { TodaySimple } from './TodaySimple';
import { TodayBooks } from './TodayBooks';
import { todayIntentsForState } from './permissions.ts';
import { ClosingRow, RowExpansion, attentionRows, opensInPlace, useInPlaceRows, useSystemRows, useWorth, WorthSection, TodayPrepare, TodayReviewLink, TodayStat, type TodayScreenProps } from './shared';
import s from './Today.module.css';

export type { TodayScreenProps } from './shared';

export function TodayScreen(p: TodayScreenProps) {
  if (p.view === 'simple') return <TodaySimple {...p} />;
  if (p.view === 'books') return <TodayBooks {...p} />;
  return <TodayGuided {...p} />;
}

function TodayGuided({ data, intents: offeredIntents, onNavigate }: TodayScreenProps) {
  const intents = todayIntentsForState(data.state, offeredIntents);
  const t = useT();
  const titleId = useId();
  const worthId = useId();
  const monthId = useId();
  const changedId = useId();
  const earlierId = useId();
  const system = useSystemRows(data, intents);
  const worthSource = useWorth(data, intents, 'guided', onNavigate);
  const { review, worth, hidden, offered } = attentionRows(data, system, worthSource.rows, worthSource.showAll);
  const inPlace = useInPlaceRows();
  const enterprise = data.enterprise;
  const onOpenRow = intents.onOpenRow;
  const nothingAwaits = review.length === 0 && data.state.kind === 'ready';
  const onLens = intents.onLens;

  const expansion = (row: RowItem): ReactNode => <RowExpansion row={row} intents={intents} origin={inPlace.originOf(row.id)} />;
  const opensRow = (row: RowItem) => row.can?.includes('open') === true;

  const seeAll = data.review.total && intents.onSeeAll ? { count: data.review.total.display, onPress: intents.onSeeAll } : undefined;
  /* Nothing awaits: the words, and the charts move up above worth a look. */
  const worthSection = (
    <WorthSection rows={worth} hidden={hidden} offered={offered} missing={worthSource.missing} showAll={worthSource.showAll} onToggle={worthSource.toggle}
      onOpen={worthSource.onOpen} opens={worthSource.opens} onReceipt={intents.onReceipt} labelId={worthId} />
  );

  return (
    <div className={s.today}>
      <div className={s.lead}>
      <PageHeader
        where={data.date}
        title={t('TD-01.title')}
        titleId={titleId}
        count={data.review.count}
        top={enterprise && onLens ? <LensRow value={enterprise.lens} onChange={onLens} /> : undefined}
        aside={
          enterprise && seeAll ? (
            <Button variant="link" onClick={seeAll.onPress}>
              {t('BTN.seeAll', { count: seeAll.count })}
            </Button>
          ) : <TodayReviewLink data={data} intents={intents} />
        }
      />

      <State state={data.state} />

      {nothingAwaits ? (
        <State state={{ kind: 'empty' }} emptyKey="ST.empty.review" />
      ) : (
        <RowList
          rows={review}
          labelledBy={titleId}
          openId={inPlace.openId}
          onOpen={(id) => inPlace.toggle(id)}
          opens={opensInPlace}
          onReceipt={intents.onReceipt}
          expansion={expansion}
          registerOrigin={inPlace.registerOrigin}
          seeAll={enterprise ? undefined : seeAll}
        />
      )}
      </div>

      <ClosingRow data={data} />

      {!nothingAwaits && worthSection}

      <section className={s.section} aria-labelledby={monthId}>
        <h2 id={monthId} className={s.label}>
          {data.review.scoped ? t('TODAY_ENGINE.figures') : enterprise ? t('EN.month') : t('TD-01.month')}
        </h2>
        {data.thisMonth && data.thisMonth.length > 0 ? (
          <div className={[s.tiles, data.thisMonth.length > 3 ? s.tilesFour : ''].join(' ')}>
            {data.thisMonth.map((tile) => (
              <TodayStat key={tile.id} tile={tile} intents={intents} />
            ))}
          </div>
        ) : (
          <p className={s.missing}>
            <MissingWords missing={data.thisMonthMissing ?? 'not-loaded-yet'} />
          </p>
        )}
        <TodayPrepare data={data} intents={intents} />
      </section>

      {nothingAwaits && worthSection}

      {enterprise?.changedSince && (
        <section className={s.section} aria-labelledby={changedId}>
          <h2 id={changedId} className={s.label}>
            {t('EN.changed', { since: enterprise.changedSince.since })}
          </h2>
          <RowList rows={enterprise.changedSince.rows} labelledBy={changedId} onOpen={onOpenRow} opens={opensRow} onReceipt={intents.onReceipt} />
          {enterprise.quietLines && enterprise.quietLines.length > 0 && (
            <p className={s.quiet}>
              {enterprise.quietLines.map((line, i) => (
                <span key={i}>{line}</span>
              ))}
            </p>
          )}
        </section>
      )}

      {!enterprise && (
        <section className={s.section} aria-labelledby={earlierId}>
          <h2 id={earlierId} className={s.label}>
            {t('TD-01.earlier')}
          </h2>
          {data.earlierToday && data.earlierToday.length > 0 ? (
            <DayLine events={data.earlierToday} onReceipt={intents.onReceipt} onOpenEvent={intents.onOpenEvent} onOpenAll={intents.onOpenActivity} labelledBy={earlierId} />
          ) : (
            <p className={s.missing}>{data.earlierTodayMissing !== undefined
              ? <MissingWords missing={data.earlierTodayMissing} />
              : t('TD-01.earlier.none')}</p>
          )}
        </section>
      )}
    </div>
  );
}
