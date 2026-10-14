/**
 * TR-06 People and TR-07 Machines and the pen: each person with their square (yours is
 * ink), the seat and what it allows; Invite in a sheet, with the one-time code shown once
 * and the accountant's guide as text; Remove with a confirmation; this computer's role
 * from the core `sync.status`.
 */
import { useState, type FormEvent } from 'react';
import { withSheet } from '../../app/routes.ts';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import { Square } from '../../parts/Square';
import { useEngine, useSend } from './kit/engine.ts';
import { Note, Screen } from './kit/Screen';
import { AskTwice, InviteShown, Loads, Outcome, Pending, Tag, dayText, powers, useClose, type P } from './common';
import { validateChange, validateInvite, validateSeats, validateSync, type InviteResult, type SeatRow } from './validate.ts';
import { COMMON, PEOPLE, SEAT_WORDS, fill } from './words.ts';
import s from './Trust.module.css';

export function PeopleScreen(p: P) {
  const c = words(COMMON, p.language), w = words(PEOPLE, p.language);
  const { state, reload } = useEngine(p.rpc, 'trustx.seats', {}, validateSeats);
  const sync = useEngine(p.rpc, 'sync.status', {}, validateSync);
  const [round, setRound] = useState(0);
  const { admin } = powers(p);
  const enterprise = p.address.sub === 'access';
  return (
    <>
      <Screen where={enterprise ? c.whereAccess : c.wherePeople} title={enterprise ? c.access : c.people} loaded={state}
        aside={admin ? <Button variant="quiet" onClick={() => p.navigate(withSheet(p.address, 'invite'))}>{w.invite}</Button> : undefined}>
        {(seats) => (
          <>
            <SeatList p={p} rows={seats.seats} onChange={(waiting) => (waiting ? setRound((n) => n + 1) : reload())} />
            {!admin && <Note>{c.adminOnly}</Note>}
            <Pending p={p} what={['seats']} round={round} onConfirmed={reload} />
            <Loads title={w.machinesTitle} loaded={sync.state}>
              {(st) => (
                <div className={s.stack}>
                  <p className={s.text}>{st.writer === null ? w.penUnknown : st.writer ? w.writer : w.reader}</p>
                  <p className={s.text}>{w.oneWriter}</p>
                  <p className={s.quiet}>{st.enabled ? w.syncOn : w.syncOff} {st.experimental && <Tag>{c.experimental}</Tag>}</p>
                </div>
              )}
            </Loads>
          </>
        )}
      </Screen>
      {p.address.sheet === 'invite' && <InviteSheet p={p} onDone={(waiting) => (waiting ? setRound((n) => n + 1) : reload())} />}
    </>
  );
}

function SeatList({ p, rows, onChange }: { p: P; rows: SeatRow[]; onChange: (waiting: boolean) => void }) {
  const w = words(PEOPLE, p.language), seatW = words(SEAT_WORDS, p.language);
  const { admin } = powers(p);
  const { sent, send } = useSend(p.rpc, validateChange);
  if (rows.length === 0) return <p className={s.quiet}>{w.peopleNone}</p>;
  const remove = async (memberId: string) => {
    const done = await send('trustx.removeSeat', { memberId });
    if (done !== null && p.live(p.address)) onChange(done.state === 'waiting-for-second');
  };
  return (
    <>
      <ul className={s.list}>
        {rows.map((row) => (
          <li key={row.memberId} className={s.item} data-member={row.memberId}>
            <span className={s.itemHead}>
              <Square mark={row.you ? 'you' : row.seat === 'assistant' ? 'cha' : 'off'} />
              <span className={s.name}>{row.name}</span>
              {row.you && <span className={s.quiet}>{w.you}</span>}
              <span>{seatW[row.seat]}</span>
            </span>
            {row.limits.length > 0 && <span className={s.quiet}>{row.limits.join(' · ')}</span>}
            {row.removedOn !== null ? <span className={s.quiet}>{fill(w.removed, { date: dayText(row.removedOn, p.language) })}</span>
              : row.ended && row.endsOn !== null ? <span className={s.quiet}>{fill(w.ended, { date: dayText(row.endsOn, p.language) })}</span>
                : row.endsOn !== null && <span className={s.quiet}>{fill(w.endsOn, { date: dayText(row.endsOn, p.language) })}</span>}
            {p.view === 'books' && <span className={s.mono}>{row.memberId}</span>}
            {admin && !row.you && row.active && row.removedOn === null && row.seat !== 'owner' && (
              <span><AskTwice label={w.remove} ask={fill(w.removeAsk, { name: row.name })} confirmLabel={fill(w.removeConfirm, { name: row.name })}
                onConfirm={() => void remove(row.memberId)} language={p.language} disabled={sent.kind === 'sending'} /></span>
            )}
          </li>
        ))}
      </ul>
      <Outcome sent={sent} language={p.language} />
    </>
  );
}

const INVITE_SEATS = ['cofounder', 'accountant', 'ca', 'staff'] as const;
type InviteSeat = (typeof INVITE_SEATS)[number];

function InviteSheet({ p, onDone }: { p: P; onDone: (waiting: boolean) => void }) {
  const c = words(COMMON, p.language), w = words(PEOPLE, p.language), seatW = words(SEAT_WORDS, p.language);
  const close = useClose(p);
  const { admin } = powers(p);
  const [seat, setSeat] = useState<InviteSeat>('accountant');
  const [name, setName] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [problem, setProblem] = useState<{ name?: string; endsOn?: string }>({});
  const [shown, setShown] = useState<InviteResult | null>(null);
  const { sent, send } = useSend(p.rpc, validateInvite);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const typedName = name.trim();
    const next: { name?: string; endsOn?: string } = {};
    if (typedName.length === 0 || typedName.length > 200) next.name = w.needName;
    if (seat === 'ca' && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn.trim())) next.endsOn = w.needEnd;
    setProblem(next);
    if (next.name !== undefined || next.endsOn !== undefined) return;
    const done = await send('trustx.invite', seat === 'ca' ? { seat, name: typedName, endsOn: endsOn.trim() } : { seat, name: typedName });
    if (done === null || !p.live(p.address)) return;
    setShown(done); setName(''); setEndsOn('');
    onDone(done.state === 'waiting-for-second');
  };
  return (
    <Sheet kind={c.sheetDetail} title={w.inviteTitle} onClose={close} origin={null}>
      {!admin ? <p className={s.quiet}>{c.adminOnly}</p> : (
        <div className={s.stack}>
          <form className={s.stack} onSubmit={(e) => void submit(e)}>
            <Choice label={w.seatChoice} options={INVITE_SEATS.map((value) => ({ value, label: seatW[value] }))} value={seat} onChange={setSeat} />
            <Field label={w.nameField} value={name} onChange={(e) => setName(e.currentTarget.value)} problem={problem.name} autoComplete="off" />
            {seat === 'ca' && <Field label={w.endsField} value={endsOn} onChange={(e) => setEndsOn(e.currentTarget.value)} problem={problem.endsOn} inputMode="numeric" />}
            <span><Button submit disabled={sent.kind === 'sending'}>{w.sendInvite}</Button></span>
          </form>
          <Outcome sent={sent} language={p.language} />
          {shown !== null && <InviteShown p={p} shown={shown} />}
        </div>
      )}
    </Sheet>
  );
}
