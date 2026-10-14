/**
 * RP-03 The week ahead and RP-04 the Friday review, as two parts of one page chosen by
 * "Monday" and "Friday". The Monday part has three short sections (what changed, what
 * needs a decision, what is due), a small chart where a number moved, the decision inbox
 * and what was missed while the computer slept. The Friday part has the decisions due
 * for review and, when available, up to five proposed lessons. Rhythm and delivery
 * (RP-05) opens as the sheet `rhythm`.
 */
import { useRef, useState, type ReactNode } from 'react';
import type { ColumnsChart, Language } from '../../app/presentation.ts';
import { withSheet, withoutSheet } from '../../app/routes.ts';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { Figure } from '../../parts/Figure';
import { Label } from '../../parts/Label';
import { Columns } from '../../parts/charts/Columns';
import { Sheet } from '../../parts/Sheet';
import type { PlaceRenderProps } from '../../places/types.ts';
import { words } from '../../places/types.ts';
import { count } from '../../format/index.ts';
import { useEngine } from '../trust/kit/engine.ts';
import { Group, Note, Screen } from '../trust/kit/Screen';
import { RhythmSheet } from './Rhythm';
import { day, when } from './shared';
import { validateFriday, validateWeekAhead, type BriefItem, type FridayReview, type WeekAhead as Week } from './validate.ts';
import { WORDS, fill, type Words } from './words.ts';
import s from './Reports.module.css';

type Part = 'monday' | 'friday';

export function WeekAhead(props: PlaceRenderProps) {
  const { address, language, navigate } = props;
  const w = words(WORDS, language);
  const [part, setPart] = useState<Part>('monday');
  const origin = useRef<HTMLElement | null>(null);
  const close = () => navigate(withoutSheet(address));
  const title = address.sub === 'briefs' ? w.briefs : w.weekahead;
  const choice = (
    <div className={s.actions}>
      <Choice<Part> label={w.review} labelHidden options={[{ value: 'monday', label: w.monday }, { value: 'friday', label: w.friday }]} value={part} onChange={setPart} />
      <Button variant="link" onClick={(e) => { origin.current = e.currentTarget; navigate(withSheet(address, 'rhythm')); }}>{w.rhythmLink}</Button>
    </div>
  );
  return (
    <>
      {part === 'monday' ? <Monday {...props} w={w} title={title} aside={choice} /> : <Friday {...props} w={w} title={title} aside={choice} />}
      {address.sheet === 'rhythm' && <RhythmSheet {...props} origin={origin.current} onClose={close} />}
      {address.sheet !== undefined && address.sheet !== 'rhythm' && (
        <Sheet kind={w.rhythm} title={w.rhythm} onClose={close} origin={origin.current}><Note>{w.unknownSheet}</Note></Sheet>
      )}
    </>
  );
}

interface PartProps extends PlaceRenderProps { w: Words; title: string; aside: ReactNode }

function Monday({ rpc, w, title, aside, language, view, openReceipt }: PartProps) {
  const { state } = useEngine(rpc, 'reportsx.weekAhead', {}, validateWeekAhead);
  return (
    <Screen where={w.where} title={title} loaded={state} aside={aside}>
      {(week) => (
        <>
          <Timing week={week} w={w} language={language} />
          <Items title={w.changed} items={week.changed} w={w} openReceipt={openReceipt} />
          <Items title={w.decide} items={week.decide} w={w} openReceipt={openReceipt} />
          <Items title={w.due} items={week.due} w={w} openReceipt={openReceipt} />
          <Group title={w.inbox}>
            {week.inbox.length === 0 ? <Note>{w.inboxEmpty}</Note> : (
              <ul className={s.items}>
                {week.inbox.map((x) => (
                  <li key={x.id} className={s.item}><span className={s.itemText}>{x.text}</span><span className={s.quiet}>{fill(w.reviewOn, { date: day(x.reviewDate, language) })}</span></li>
                ))}
              </ul>
            )}
          </Group>
          <Group title={w.missed}>
            {week.missed.length === 0 ? <Note>{w.missedNone}</Note> : (
              <ul className={s.items}>
                {week.missed.map((x) => (
                  <li key={x.id} className={s.item}><span className={s.itemText}>{x.what}</span><span className={s.quiet}>{when(x.at, w, language)}</span></li>
                ))}
              </ul>
            )}
          </Group>
          <Note>{w.explanation}</Note>
          {view === 'books' && <p className={[s.quiet, s.code].join(' ')}>{fill(w.briefId, { id: week.id })}</p>}
        </>
      )}
    </Screen>
  );
}

function Timing({ week, w, language }: { week: Week; w: Words; language: Language }) {
  const period = fill(w.periodLine, { from: day(week.period.from, language), to: day(week.period.to, language) });
  return (
    <div className={s.stack}>
      <p className={s.say}>{period}</p>
      {week.late
        ? <p className={s.quiet}><Label kind="late" /> {fill(w.late, { scheduled: when(week.scheduledFor, w, language), built: when(week.builtAt, w, language) })}</p>
        : <p className={s.quiet}>{fill(w.builtOnTime, { built: when(week.builtAt, w, language) })}</p>}
    </div>
  );
}

function Items({ title, items, w, openReceipt }: { title: string; items: BriefItem[]; w: Words; openReceipt: (id: string) => void }) {
  return (
    <Group title={title}>
      {items.length === 0 ? <Note>{w.nothingHere}</Note> : (
        <ul className={s.items}>
          {items.map((item) => {
            const chart: ColumnsChart | null = item.chart.length > 0
              ? { form: 'columns', sentence: fill(w.chartSentence, { what: item.text }), values: item.chart.map((c) => ({ id: c.id, label: c.label, value: c.figure })) }
              : null;
            return (
              <li key={item.id} className={s.item}>
                <span className={s.itemText}>{item.text}</span>
                {item.figure !== null && <Figure value={item.figure} onReceipt={openReceipt} />}
                {chart !== null && <Columns chart={chart} onReceipt={openReceipt} className={s.chart} />}
              </li>
            );
          })}
        </ul>
      )}
    </Group>
  );
}

function Friday({ rpc, w, title, aside, language, view, openReceipt }: PartProps) {
  const { state } = useEngine(rpc, 'reportsx.friday', {}, validateFriday);
  return (
    <Screen where={w.where} title={title} loaded={state} aside={aside}>
      {(review: FridayReview) => (
        <>
          <p className={s.say}>{fill(w.periodLine, { from: day(review.period.from, language), to: day(review.period.to, language) })}</p>
          <Group title={w.decisions}>
            {review.decisions.length === 0 ? <Note>{w.decisionsNone}</Note> : (
              <ul className={s.items}>
                {review.decisions.map((d) => (
                  <li key={d.id} className={s.item}>
                    <span className={s.stack}>
                      <span className={s.itemText}>{d.text}</span>
                      <span className={s.quiet}>{d.observed !== null ? fill(w.observed, { what: d.observed }) : w.notObserved}</span>
                    </span>
                    <span className={s.actions}>
                      <span className={s.quiet}>{fill(w.reviewOn, { date: day(d.reviewDate, language) })}</span>
                      {view !== 'simple' && d.receiptIds.map((id) => (
                        <Button key={id} variant="link" onClick={() => openReceipt(id)}>{view === 'books' ? id : w.receipt}</Button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Group>
          <Group title={w.lessons} note={w.lessonsWhere}>
            {!review.lessons.available ? <Note>{w.lessonsUnavailable}</Note> : review.lessons.items.length === 0 ? <Note>{w.lessonsNone}</Note> : (
              <ul className={s.items}>
                {review.lessons.items.slice(0, 5).map((l) => (
                  <li key={l.id} className={s.item}>
                    <span className={s.stack}>
                      <span className={s.itemText}>{l.title}</span>
                      <span className={s.quiet}>{fill(w.lessonChange, { change: l.change })}</span>
                    </span>
                    <span className={s.quiet}>{fill(w.lessonEvidence, { count: count(String(l.evidence)) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Group>
        </>
      )}
    </Screen>
  );
}
