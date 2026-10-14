/**
 * TL-03 The follow-up book (tools/smallapps?sheet=follow-up-book): customer, date, what was
 * said and the next date, as a table, and "Add an entry". What was typed is data.
 */
import { useState, type FormEvent } from 'react';
import { withoutSheet } from '../../app/routes.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { screenState } from '../trust/kit/Screen';
import { FOLLOW_UP_BOOK, SMALLAPPS, entries, type Entry } from './adapters/smallapps.ts';
import { SentLine, day, toolsWords, type Words } from './shared';
import { anyObject } from './validate.ts';
import s from './FollowUpBook.module.css';

const BLANK = { customer: '', date: '', said: '', next: '' };

function AddEntry({ props, w, onAdded }: { props: PlaceRenderProps; w: Words; onAdded: () => void }) {
  const [entry, setEntry] = useState(BLANK);
  const [problem, setProblem] = useState(false);
  const add = useSend(props.rpc, anyObject);
  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) => { setEntry({ ...entry, [k]: e.target.value }); setProblem(false); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (entry.customer.trim() === '' || entry.date === '' || entry.said.trim() === '') { setProblem(true); return; }
    const done = await add.send(SMALLAPPS.act, { id: FOLLOW_UP_BOOK, act: 'add', entry: { customer: entry.customer, date: entry.date, said: entry.said, next: entry.next === '' ? null : entry.next } });
    if (done !== null) { setEntry(BLANK); onAdded(); }
  };
  return (
    <form className={s.form} onSubmit={submit} aria-label={w.addEntry}>
      <h3 className={s.small}>{w.addEntry}</h3>
      <Field label={w.customer} value={entry.customer} maxLength={200} onChange={set('customer')} />
      <Field label={w.date} type="date" value={entry.date} onChange={set('date')} />
      <Field label={w.said} value={entry.said} maxLength={2000} onChange={set('said')} problem={problem ? w.bookFill : undefined} />
      <Field label={w.next} type="date" value={entry.next} onChange={set('next')} />
      <div><Button submit disabled={add.sent.kind === 'sending'}>{w.add}</Button></div>
      <SentLine sent={add.sent} done={w.added} w={w} />
    </form>
  );
}

function Table({ rows, props, w }: { rows: readonly Entry[]; props: PlaceRenderProps; w: Words }) {
  if (rows.length === 0) return <p className={s.note}>{w.bookEmpty}</p>;
  return (
    <table className={s.table}>
      <thead><tr><th scope="col">{w.customer}</th><th scope="col">{w.date}</th><th scope="col">{w.said}</th><th scope="col">{w.next}</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.customer}</td>
            <td className="fig">{day(r.date, props.language)}</td>
            <td>{r.said}</td>
            <td className="fig">{r.next === null ? <span className={s.note}>{w.noNext}</span> : day(r.next, props.language)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FollowUpBookSheet({ props }: { props: PlaceRenderProps }) {
  const w = toolsWords(props.language);
  const { state, reload } = useEngine(props.rpc, SMALLAPPS.view, { id: FOLLOW_UP_BOOK }, entries);
  return (
    <Sheet kind={w.appKind} title={w.bookTitle} origin={null} onClose={() => props.navigate(withoutSheet(props.address))}>
      <div className={s.body}>
        {state.kind === 'ready' ? <Table rows={state.value} props={props} w={w} /> : <State state={screenState(state)} />}
        <p className={s.note}>{w.bookNote}</p>
        {state.kind === 'ready' && !props.viewer && <AddEntry props={props} w={w} onAdded={reload} />}
      </div>
    </Sheet>
  );
}
