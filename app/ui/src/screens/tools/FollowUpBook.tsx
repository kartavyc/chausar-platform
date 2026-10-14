/**
 * TL-03 The follow-up book (tools/smallapps?sheet=follow-up-book), over models-ext's
 * `smallapps.records.*`: who to follow up, the day it was written, what was said and the next
 * date, as a table; "Add an entry"; "Mark done" (one change, against the version read); and each
 * entry's history. What was typed is data, sent as typed and shown as text. Simple keeps the
 * table and Add; Books adds versions.
 */
import { useState, type FormEvent } from 'react';
import { withoutSheet } from '../../app/routes.ts';
import { count } from '../../format/index.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { screenState } from '../trust/kit/Screen';
import { SMALLAPPS, book, entryChanged, history, type Entry } from './adapters/smallapps.ts';
import { SentLine, day, toolsWords, type Words } from './shared';
import { fill } from './words.ts';
import s from './FollowUpBook.module.css';

const BLANK = { who: '', said: '', when: '' };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function AddEntry({ props, w, onAdded }: { props: PlaceRenderProps; w: Words; onAdded: () => void }) {
  const [entry, setEntry] = useState(BLANK);
  const [problem, setProblem] = useState(false);
  const add = useSend(props.rpc, entryChanged);
  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) => { setEntry({ ...entry, [k]: e.target.value }); setProblem(false); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (entry.who.trim() === '' || !DAY.test(entry.when)) { setProblem(true); return; }
    const done = await add.send(SMALLAPPS.add, { who: entry.who, when: entry.when, said: entry.said });
    if (done !== null && props.live(props.address)) { setEntry(BLANK); onAdded(); }
  };
  return (
    <form className={s.form} onSubmit={(e) => void submit(e)} aria-label={w.addEntry}>
      <h3 className={s.small}>{w.addEntry}</h3>
      <Field label={w.customer} value={entry.who} maxLength={120} onChange={set('who')} />
      <Field label={w.said} value={entry.said} maxLength={2000} onChange={set('said')} />
      <Field label={w.next} type="date" value={entry.when} onChange={set('when')} problem={problem ? w.bookFill : undefined} />
      <div><Button submit disabled={add.sent.kind === 'sending'}>{w.add}</Button></div>
      <SentLine sent={add.sent} done={w.added} w={w} />
    </form>
  );
}

function History({ id, props, w }: { id: string; props: PlaceRenderProps; w: Words }) {
  const { state } = useEngine(props.rpc, SMALLAPPS.history, { id }, history, id);
  if (state.kind !== 'ready') return <State state={screenState(state)} />;
  return (
    <ul className={s.history} aria-label={w.history}>
      {state.value.versions.map((v) => (
        <li key={v.version}>{fill(w.versionLine, { version: count(String(v.version)), date: day(v.at, props.language), status: w[`entry.${v.status}`], next: day(v.when, props.language) })} {v.said}</li>
      ))}
      {state.value.withheld > 0 && <li className={s.note}>{fill(w.withheld, { n: count(String(state.value.withheld)) })}</li>}
    </ul>
  );
}

function Row({ r, props, w, onChanged }: { r: Entry; props: PlaceRenderProps; w: Words; onChanged: () => void }) {
  const simple = props.view === 'simple', books = props.view === 'books';
  const [open, setOpen] = useState(false);
  const done = useSend(props.rpc, entryChanged);
  return (
    <>
      <tr>
        <td>{r.who}</td>
        <td className="fig">{day(r.at, props.language)}</td>
        <td>{r.said}</td>
        <td className="fig">{day(r.when, props.language)}</td>
        {!simple && <td>{w[`entry.${r.status}`]}{books && <span className={[s.note, 'fig'].join(' ')}> {fill(w.versionShort, { version: count(String(r.version)) })}</span>}</td>}
        {!simple && (
          <td className={s.controls}>
            {!props.viewer && r.status === 'open' && (
              <Button disabled={done.sent.kind === 'sending'} onClick={async () => {
                if (await done.send(SMALLAPPS.update, { id: r.id, expectedVersion: r.version, status: 'done' }) !== null && props.live(props.address)) onChanged();
              }}>{w.markDone}</Button>
            )}
            <Button variant="link" onClick={() => setOpen((o) => !o)}>{open ? w.hideHistory : w.history}</Button>
            <SentLine sent={done.sent} w={w} />
          </td>
        )}
      </tr>
      {open && <tr><td colSpan={6}><History id={r.id} props={props} w={w} /></td></tr>}
    </>
  );
}

function Table({ rows, props, w, onChanged }: { rows: readonly Entry[]; props: PlaceRenderProps; w: Words; onChanged: () => void }) {
  if (rows.length === 0) return <p className={s.note}>{w.bookEmpty}</p>;
  const simple = props.view === 'simple';
  return (
    <table className={s.table}>
      <thead><tr>
        <th scope="col">{w.customer}</th><th scope="col">{w.date}</th><th scope="col">{w.said}</th><th scope="col">{w.next}</th>
        {!simple && <th scope="col">{w.entryState}</th>}{!simple && <th scope="col"><span className="sr">{w.entryControls}</span></th>}
      </tr></thead>
      <tbody>{rows.map((r) => <Row key={r.id} r={r} props={props} w={w} onChanged={onChanged} />)}</tbody>
    </table>
  );
}

export function FollowUpBookSheet({ props }: { props: PlaceRenderProps }) {
  const w = toolsWords(props.language);
  const { state, reload } = useEngine(props.rpc, SMALLAPPS.records, {}, book);
  return (
    <Sheet kind={w.appKind} title={w.bookTitle} origin={null} onClose={() => props.navigate(withoutSheet(props.address))}>
      <div className={s.body}>
        {state.kind === 'ready' ? <Table rows={state.value} props={props} w={w} onChanged={reload} /> : <State state={screenState(state)} />}
        <p className={s.note}>{w.bookNote}</p>
        {state.kind === 'ready' && !props.viewer && <AddEntry props={props} w={w} onAdded={reload} />}
      </div>
    </Sheet>
  );
}
