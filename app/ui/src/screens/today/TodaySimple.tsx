/**
 * Today, Simple view (TD-02): the same rows, taller and in larger type, one action each.
 * "Today's cash sales" with one field and Enter; the week's cash as seven bars, today's
 * bar open until it is entered. The cash figure is stored as something the owner said,
 * labelled told by owner; the text typed is data and goes to the callback unchanged.
 * The field and Enter appear only when the adapter can save what is typed. The typed text stays
 * until the save is confirmed; a text that is not a plain amount, or a save that was refused or
 * failed, says so in its own words.
 */

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import type { CashSaveResult } from './TodayData.ts';
import { ClosingRow, RowExpansion, attentionRows, opensInPlace, useInPlaceRows, useSystemRows, useWorth, WorthSection, TodayReviewLink, TodayProducerSections, type TodayScreenProps, TodayState } from './shared';
import { CashVoice } from './CashVoice';
import { cashWeek } from './cash.ts';
import { ClosingSwitch } from './ClosingSwitch';
import s from './Today.module.css';

export function TodaySimple({ data, intents: offeredIntents, onNavigate }: TodayScreenProps) {
  const intents = todayIntentsForState(data.state, offeredIntents);
  const t = useT();
  const titleId = useId();
  const cashId = useId();
  const worthId = useId();
  const [cash, setCash] = useState('');
  const [cashProblem, setCashProblem] = useState<'invalid' | 'failed' | null>(null);
  const [saving, setSaving] = useState(false);
  const system = useSystemRows(data, intents);
  const worthSource = useWorth(data, intents, 'simple', onNavigate);
  const { review, worth, hidden, offered } = attentionRows(data, system, worthSource.rows, worthSource.showAll);
  const inPlace = useInPlaceRows();
  const onSaveClosing = intents.onSaveClosing;
  const cashField = useRef<HTMLDivElement>(null);

  const expansion = (row: RowItem): ReactNode => <RowExpansion row={row} intents={intents} origin={inPlace.originOf(row.id)} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = cash.trim();
    if (v.length === 0 || !onSaveClosing || saving) return;
    setSaving(true); setCashProblem(null);
    let result: CashSaveResult;
    try { result = await onSaveClosing(v); } catch { result = 'failed'; }
    setSaving(false);
    // Only a confirmed save clears what was typed.
    if (result === 'saved') setCash('');
    else setCashProblem(result === 'invalid' ? 'invalid' : 'failed');
  };

  const rows = review;
  const week = data.cash ? cashWeek(data.cash) : null;

  return (
    <div className={s.today}>
      <div className={s.lead}>
      <PageHeader where={data.date} title={t('TD-01.title')} titleId={titleId} count={data.review.count} aside={<TodayReviewLink data={data} intents={intents} />} />
      <TodayState state={data.state} />

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
      </div>

      <ClosingRow data={data} />
      <ClosingSwitch data={data} intents={intents} />

      <WorthSection rows={worth} hidden={hidden} offered={offered} missing={worthSource.missing} showAll={worthSource.showAll} onToggle={worthSource.toggle}
        onOpen={worthSource.onOpen} opens={worthSource.opens} onReceipt={intents.onReceipt} labelId={worthId} />

      {data.cash && week && (
        <section className={s.cash} aria-labelledby={cashId}>
          <form className={s.cashForm} onSubmit={(e) => void submit(e)}>
            <h2 id={cashId} className={s.cashLabel}>
              {t('TD-02.cash')}
            </h2>
            {data.cash.entered ? (
              <span className={s.cashEntered}>
                <Figure value={data.cash.entered} size="tile" onReceipt={intents.onReceipt} statement="told-by-owner" />
              </span>
            ) : onSaveClosing ? (
              <>
                <Field label={t('TD-02.cash')} prefix={t('TD-02.cash.rupee')} inputMode="numeric" value={cash} onChange={(e) => { setCash(e.target.value); setCashProblem(null); }} className={s.cashField} />
                <Button variant="quiet" submit>
                  {t('BTN.enter')}
                </Button>
                {cashProblem !== null && <p role="alert" data-cash-problem={cashProblem}>{t(`FT4.cash.${cashProblem}`)}</p>}
              </>
            ) : (
              <MissingWords missing="cash-not-captured" />
            )}
          </form>
          <Columns chart={week} onReceipt={intents.onReceipt} className={s.cashChart} />
          {!data.cash.entered && onSaveClosing && intents.cashVoice && (
            <div ref={cashField} className={s.cashVoice}>
              <CashVoice voice={intents.cashVoice} onSave={onSaveClosing} onChange={() => cashField.current?.closest('section')?.querySelector('input')?.focus()} />
            </div>
          )}
        </section>
      )}
      {data.cashMissing !== undefined && <p className={s.missing}>{t('TODAY_ENGINE.cashMissing')}</p>}
      <TodayProducerSections data={data} intents={intents} />
    </div>
  );
}
