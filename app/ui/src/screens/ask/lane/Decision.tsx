/**
 * One decision: what was decided, what was known then (each receipt as it stood on the day,
 * every figure opening its receipt), and what happened after, in order. A review records
 * how it went and, if it goes on, the next review date.
 */
import { useState } from 'react';
import type { RowItem, TimeEvent } from '../../../app/presentation.ts';
import { Button } from '../../../parts/Button';
import { Choice } from '../../../parts/Choice';
import { Field } from '../../../parts/Field';
import { Label } from '../../../parts/Label';
import { RowList } from '../../../parts/RowList';
import { TimeLine } from '../../../parts/TimeLine';
import { bool, call, date, id, int, list, obj, oneOf, optMinor, optStr, str } from './client.ts';
import { AskPage, dayText, fill, missingFigure, moneyFigure, useAsk, useRead, useWords, type AskView } from './kit';
import { catalogue, Part, Problem, useRefusal, useSend } from './analysis';
import s from './analysis.module.css';

const OUTCOMES = ['accepted', 'rejected', 'continue', 'completed'] as const;
type Outcome = (typeof OUTCOMES)[number];
export interface DecisionValue {
  readonly id: string; readonly text: string; readonly createdAt: string; readonly reviewDate: string; readonly status: 'open' | 'closed'; readonly recordedLater: boolean; readonly revision: number | null;
  readonly known: readonly { receiptId: string; label: string; minor: string | null; asOf: string }[];
  readonly reviews: readonly { at: string; outcome: Outcome; notes: string | null; nextReviewDate: string | null }[];
}
export function decisionReply(value: unknown): DecisionValue {
  const v = obj(value);
  bool(v.journal);
  return {
    id: id(v.id), text: str(v.text, 2000), createdAt: date(v.createdAt), reviewDate: date(v.reviewDate), status: oneOf(v.status, ['open', 'closed'] as const),
    recordedLater: bool(v.recordedLater), revision: v.revision === null ? null : int(v.revision),
    known: list(v.known, k => { const x = obj(k); return { receiptId: id(x.receiptId), label: str(x.label, 300), minor: optMinor(x.minor), asOf: date(x.asOf) }; }, 50),
    reviews: list(v.reviews, r => { const x = obj(r); return { at: date(x.at), outcome: oneOf(x.outcome, OUTCOMES), notes: optStr(x.notes, 2000), nextReviewDate: x.nextReviewDate === null || x.nextReviewDate === undefined ? null : date(x.nextReviewDate) }; }, 500),
  };
}

const WORDS = catalogue({
  en: {
    title: 'A decision', decided: 'What was decided', madeOn: 'Decided on {date}. Review on {date2}.', closed: 'This decision is closed.',
    known: 'What was known then', knownNone: 'No receipt was attached.', asOf: 'as known on {date}', after: 'What happened after', afterNone: 'No review yet.',
    accepted: 'Accepted', rejected: 'Rejected', continue: 'Carry on', completed: 'Completed',
    reviewLine: '{outcome}.', reviewNotes: '{outcome}: {notes}', reviewNext: '{outcome}. Next review on {date}.', reviewNotesNext: '{outcome}: {notes} Next review on {date}.',
    review: 'Review it', outcome: 'How did it go', notes: 'Notes', next: 'Next review date', record: 'Record the review', needNext: 'Pick the next review date to carry on.',
  },
  hi: {
    title: 'एक निर्णय', decided: 'क्या तय हुआ', madeOn: '{date} को तय हुआ। {date2} को समीक्षा।', closed: 'यह निर्णय बंद है।',
    known: 'तब क्या पता था', knownNone: 'कोई रसीद नहीं जुड़ी थी।', asOf: '{date} को जैसा पता था', after: 'उसके बाद क्या हुआ', afterNone: 'अभी कोई समीक्षा नहीं।',
    accepted: 'स्वीकार', rejected: 'अस्वीकार', continue: 'जारी रखें', completed: 'पूरा हुआ',
    reviewLine: '{outcome}।', reviewNotes: '{outcome}: {notes}', reviewNext: '{outcome}। अगली समीक्षा {date} को।', reviewNotesNext: '{outcome}: {notes} अगली समीक्षा {date} को।',
    review: 'समीक्षा करें', outcome: 'कैसा रहा', notes: 'टिप्पणी', next: 'अगली समीक्षा की तारीख़', record: 'समीक्षा दर्ज करें', needNext: 'जारी रखने के लिए अगली समीक्षा की तारीख़ चुनें।',
  },
});

export function DecisionScreen({ view }: { view: Extract<AskView, { kind: 'decision' }> }) {
  const ask = useAsk(), w = useWords(WORDS), explain = useRefusal();
  const [load, retry] = useRead(`decision|${view.decisionId}`, () => call(ask.rpc, 'askx.decisions.get', { decisionId: view.decisionId }, decisionReply));
  const [shown, setShown] = useState<DecisionValue | null>(null);
  return (
    <AskPage title={w.title} load={load} retry={retry} explain={explain}>
      {d => <Body d={shown ?? d} onReviewed={setShown} />}
    </AskPage>
  );
}

function Body({ d, onReviewed }: { d: DecisionValue; onReviewed: (d: DecisionValue) => void }) {
  const ask = useAsk(), w = useWords(WORDS), lang = ask.language;
  const open = (receiptId: string) => ask.go({ kind: 'receipt', receiptId });
  const review = useSend();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState('');
  const [next, setNext] = useState('');
  const knownRows: RowItem[] = d.known.map((k, i) => ({
    id: `known-${i}`, mark: 'off', what: k.label, note: fill(w.asOf, { date: dayText(k.asOf, lang) }),
    figure: k.minor === null ? missingFigure('null') : moneyFigure(k.minor, k.receiptId),
  }));
  const events: TimeEvent[] = d.reviews.map((r, i) => {
    const outcomeWord = w[r.outcome], date = r.nextReviewDate === null ? '' : dayText(r.nextReviewDate, lang);
    const template = r.notes === null ? (r.nextReviewDate === null ? w.reviewLine : w.reviewNext) : (r.nextReviewDate === null ? w.reviewNotes : w.reviewNotesNext);
    return { id: `review-${i}`, mark: r.outcome === 'continue' ? 'you' : 'off', date: dayText(r.at, lang), sentence: fill(template, { outcome: outcomeWord, notes: r.notes ?? '', date }) };
  });
  const nextOk = /^\d{4}-\d{2}-\d{2}$/.test(next);
  const ready = outcome !== null && (outcome !== 'continue' || nextOk);
  return (
    <>
      <Part title={w.decided} aside={d.recordedLater ? <Label kind="recorded-later" /> : undefined}>
        <p className={s.lead} data-decision-text="">{d.text}</p>
        <p className={s.note}>{fill(w.madeOn, { date: dayText(d.createdAt, lang), date2: dayText(d.reviewDate, lang) })}</p>
        {d.status === 'closed' && <p className={s.note}>{w.closed}</p>}
      </Part>
      <Part title={w.known}>
        {knownRows.length === 0 ? <p className={s.note}>{w.knownNone}</p> : <RowList rows={knownRows} onReceipt={open} />}
      </Part>
      <Part title={w.after}>
        {events.length === 0 ? <p className={s.note}>{w.afterNone}</p> : <TimeLine events={events} onReceipt={open} />}
      </Part>
      {!ask.viewer && d.status === 'open' && (
        <Part title={w.review}>
          <form className={s.form} onSubmit={e => {
            e.preventDefault();
            if (!ready) return;
            void review.send('askx.decisions.review', { decisionId: d.id, outcome, ...(notes.trim() ? { notes: notes.trim() } : {}), ...(nextOk ? { nextReviewDate: next } : {}) }, decisionReply, value => { setOutcome(null); setNotes(''); setNext(''); onReviewed(value); });
          }}>
            <Choice<Outcome> label={w.outcome} options={OUTCOMES.map(o => ({ value: o, label: w[o] }))} value={outcome} onChange={setOutcome} />
            <Field label={w.notes} value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} />
            <Field label={w.next} type="date" value={next} onChange={e => setNext(e.target.value)} problem={outcome === 'continue' && !nextOk ? w.needNext : undefined} />
            <div><Button variant="filled" submit disabled={review.busy || !ready}>{w.record}</Button></div>
            <Problem code={review.problem} />
          </form>
        </Part>
      )}
    </>
  );
}
