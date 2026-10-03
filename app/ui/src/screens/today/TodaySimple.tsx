/**
 * Today, Simple view (TD-02): the same rows, taller and in larger type, one action each.
 * "Today's cash sales" with one field and Enter; the week's cash as seven bars, today's
 * bar open until it is entered. The cash figure is stored as something the owner said,
 * labelled told by owner; the text typed is data and goes to the callback unchanged.
 * The field and Enter appear only when the adapter can save what is typed.
 */

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { RowItem } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import { PageHeader } from '../../app/PageHeader';
import { RowList } from '../../parts/RowList';
import { Field } from '../../parts/Field';
import { Button } from '../../parts/Button';
import { Figure, MissingWords } from '../../parts/Figure';
import { Columns } from '../../parts/charts/Columns';
import { State } from '../../patterns/States';
import { todayIntentsForState } from './permissions.ts';
import { RowExpansion, attentionRows, opensInPlace, useInPlaceRows, useSystemRows, type TodayScreenProps } from './shared';
import s from './Today.module.css';

export function TodaySimple({ data, intents: offeredIntents }: TodayScreenProps) {
  const intents = todayIntentsForState(data.state, offeredIntents);
  const t = useT();
  const titleId = useId();
  const cashId = useId();
  const [cash, setCash] = useState('');
  const system = useSystemRows(data, intents);
  const { review, worth } = attentionRows(data, system);
  const inPlace = useInPlaceRows();
  const onSaveClosing = intents.onSaveClosing;

  const expansion = (row: RowItem): ReactNode => <RowExpansion row={row} intents={intents} origin={inPlace.originOf(row.id)} />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = cash.trim();
    if (v.length === 0 || !onSaveClosing) return;
    onSaveClosing(v);
    setCash('');
  };

  const rows = [...review, ...worth];

  return (
    <div className={s.today}>
      <PageHeader where={data.date} title={t('TD-01.title')} titleId={titleId} count={data.review.count} />
      <State state={data.state} />

      {rows.length === 0 && data.state.kind === 'ready' ? (
        <State state={{ kind: 'empty' }} emptyKey="ST.empty.review" />
      ) : (
        <RowList
          rows={rows}
          labelledBy={titleId}
          openId={inPlace.openId}
          onOpen={(id) => inPlace.toggle(id)}
          opens={opensInPlace}
          onReceipt={intents.onReceipt}
          expansion={expansion}
          registerOrigin={inPlace.registerOrigin}
          seeAll={data.review.total && intents.onSeeAll ? { count: data.review.total.display, onPress: intents.onSeeAll } : undefined}
        />
      )}

      {data.cash && (
        <section className={s.cash} aria-labelledby={cashId}>
          <form className={s.cashForm} onSubmit={submit}>
            <h2 id={cashId} className={s.cashLabel}>
              {t('TD-02.cash')}
            </h2>
            {data.cash.entered ? (
              <span className={s.cashEntered}>
                <Figure value={data.cash.entered} size="tile" onReceipt={intents.onReceipt} statement="told-by-owner" />
              </span>
            ) : onSaveClosing ? (
              <>
                <Field label={t('TD-02.cash')} prefix={t('TD-02.cash.rupee')} inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} className={s.cashField} />
                <Button variant="quiet" submit>
                  {t('BTN.enter')}
                </Button>
              </>
            ) : (
              <MissingWords missing="cash-not-captured" />
            )}
          </form>
          <Columns chart={data.cash.week} onReceipt={intents.onReceipt} className={s.cashChart} />
        </section>
      )}
    </div>
  );
}
