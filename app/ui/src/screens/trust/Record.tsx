/**
 * TR-10 Record: who did what, the rule in plain words, when and on which computer;
 * filters by person and day; Verify; the head's short check code; the limit sentence.
 */
import { useState, type FormEvent } from 'react';
import type { RowItem } from '../../app/presentation.ts';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { RowList } from '../../parts/RowList';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note, Screen } from './kit/Screen';
import { Refusal, countText, dayText, type P } from './common';
import { validateRecord, validateSeats, validateVerify, type RecordView } from './validate.ts';
import { COMMON, RECORD, fill } from './words.ts';
import s from './Trust.module.css';

export function RecordScreen(p: P) {
  const c = words(COMMON, p.language), w = words(RECORD, p.language);
  const [memberId, setMemberId] = useState('all');
  const [day, setDay] = useState<string | null>(null);
  const payload: Record<string, unknown> = {};
  if (memberId !== 'all') payload['memberId'] = memberId;
  if (day !== null) payload['day'] = day;
  const { state } = useEngine(p.rpc, 'trustx.record', payload, validateRecord);
  const seats = useEngine(p.rpc, 'trustx.seats', {}, validateSeats);
  const people = seats.state.kind === 'ready' ? seats.state.value.seats : [];
  return (
    <Screen where={c.whereRecord} title={c.record} loaded={state}>
      {(rec) => (
        <>
          <div className={s.stack}>
            {people.length > 0 && (
              <Choice label={w.person} options={[{ value: 'all', label: w.everyone }, ...people.map((x) => ({ value: x.memberId, label: x.name }))]}
                value={memberId} onChange={setMemberId} />
            )}
            <DayFilter p={p} day={day} onDay={setDay} />
          </div>
          <Entries p={p} rec={rec} />
          <Verify p={p} rec={rec} />
          <Note>{w.limit}</Note>
        </>
      )}
    </Screen>
  );
}

function DayFilter({ p, day, onDay }: { p: P; day: string | null; onDay: (day: string | null) => void }) {
  const w = words(RECORD, p.language);
  const [typed, setTyped] = useState(day ?? '');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const d = typed.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { setProblem(w.badDay); return; }
    setProblem(undefined); onDay(d);
  };
  return (
    <form className={s.form} onSubmit={submit}>
      <Field label={w.dayField} value={typed} onChange={(e) => setTyped(e.currentTarget.value)} inputMode="numeric" problem={problem} />
      <Button submit>{w.showDay}</Button>
      {day !== null && <Button variant="link" onClick={() => { setTyped(''); onDay(null); }}>{w.allDays}</Button>}
    </form>
  );
}

function Entries({ p, rec }: { p: P; rec: RecordView }) {
  const w = words(RECORD, p.language);
  if (rec.items.length === 0) return <p className={s.quiet}>{w.none}</p>;
  const rows: RowItem[] = rec.items.map((x) => ({
    id: String(x.seq), mark: 'you', what: x.what,
    note: [x.who, ...(x.rule === null ? [] : [x.rule]), dayText(x.at, p.language), x.computer, ...(p.view === 'books' ? [fill(w.entry, { n: countText(x.seq) }), x.at] : [])].join(' · '),
  }));
  return (
    <>
      <RowList rows={rows} onReceipt={p.openReceipt} />
      {rec.limit !== null && rec.items.length >= rec.limit && <p className={s.quiet}>{fill(w.partial, { n: countText(rec.limit) })}</p>}
    </>
  );
}

function Verify({ p, rec }: { p: P; rec: RecordView }) {
  const w = words(RECORD, p.language);
  const { sent, send } = useSend(p.rpc, validateVerify);
  return (
    <Group title={fill(w.head, { code: rec.head.short })}>
      {p.view === 'books' && <p className={s.mono}>{rec.head.hash}</p>}
      <span><Button variant="quiet" onClick={() => void send('trustx.verifyRecord', {})} disabled={sent.kind === 'sending'}>{w.verify}</Button></span>
      {sent.kind === 'done' && (
        <p className={sent.value.verified ? s.status : s.problem} role="status">
          {sent.value.verified ? w.verified : fill(w.broken, { n: countText(sent.value.brokenAt ?? 0) })}
        </p>
      )}
      {sent.kind === 'refused' && <Refusal code={sent.code} language={p.language} />}
    </Group>
  );
}
