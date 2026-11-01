// The lesson desk on Work (wave 6, package 6E2): batches, learners with their parent consent, classes and attendance,
// quizzes scored by the engine, fees through the existing invoices, and parent messages the owner approves word for word
// and sends from their own app. Every count and amount is the engine's; the screen computes nothing.
import { useState } from 'react';
import { useT } from '../../../text';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError, type DeskActView } from '../../../engine/types';
import type { OutreachHandoff } from '../../../engine/types';
import { Button } from '../../../parts/Button';
import { Figure } from '../../../parts/Figure';
import { Tile, TileHead } from '../../../parts/Tile';
import { performHandoff } from '../../clients/handoff';
import { reserveTab } from '../../connections/external';
import s from './LessonBooking.module.css';

type Mark = 'present' | 'late' | 'absent';
type Fee = { invoiceId: string; number: string | null; status: string; total: string; receiptId: string };
type LearnerView = {
  id: string; name: string; minor: boolean; guardianName: string | null; orderId: string | null;
  consent: { state: string; line: string }; attendance: { line: string }; scores: { workId: string; title: string; line: string }[]; fees: Fee[];
};
type MessageView = { id: string; learnerId: string; channel: 'email' | 'whatsapp'; text: string; handedOffAt: string | null };
type BatchView = {
  id: string; name: string; subject: string; line: string; learners: LearnerView[];
  sessions: { id: string; on: string; topic: string; marks: Record<string, Mark> }[];
  works: { id: string; kind: 'quiz' | 'worksheet'; title: string; topic: string }[];
  messages: MessageView[];
};
type Act = (action: string, payload: unknown, id?: string) => Promise<DeskActView | null>;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const desk = { playbook: 'lesson-desk' as const, kind: 'batch' };

export function LessonDeskDesk() {
  const t = useT(), w = (key: string, values?: Record<string, string>) => t('pb-lesson.' + key, values);
  const engine = useEngine();
  const refreshOn = (event: { type: string }) => event.type === 'desk.changed';
  const list = useResource('venture.desk.list', desk, { refreshOn });
  const [selected, setSelected] = useState('');
  const detail = useResource('venture.desk.get', { ...desk, id: selected }, { skip: !selected, refreshOn });
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const batch = selected && detail.data?.item ? detail.data.item as BatchView : null;
  const rows = (list.data?.rows ?? []) as { id: string; name: string }[];

  const act: Act = async (action, payload, id = selected) => {
    if (busy) return null;
    setBusy(true); setError('');
    try {
      const digest = id === 'new' ? undefined : detail.data?.digest;
      const result = await engine.request('venture.desk.act', { ...desk, id, action, payload: payload as never, ...(digest ? { digest } : {}) });
      list.reload(); if (id !== 'new') detail.reload();
      return result;
    } catch (e) {
      const key = 'pb-lesson.error.' + (e instanceof EngineError ? e.code : 'REQUEST_FAILED'), known = t(key);
      setError(known !== key ? known : e instanceof EngineError ? e.message : w('error.REQUEST_FAILED'));
      return null;
    } finally { setBusy(false); }
  };

  return (
    <section className={s.stack} aria-label={w('title')}>
      <Tile as="section" label={w('title')}>
        <TileHead title={w('title')} end={<Button onClick={() => setCreating(open => !open)}>{w('new')}</Button>} />
        <p className={s.line}>{w('intro')}</p>
        {error && <p role="alert" className={s.error}>{error}</p>}
        {creating && <NewBatch busy={busy} w={w} make={async payload => { const made = await act('create', payload, 'new'); if (made) { setSelected(made.id); setCreating(false); } }} />}
        {rows.length > 0 && <ul className={s.list} aria-label={w('batches')}>{rows.map(row => <li key={row.id}><Button onClick={() => setSelected(row.id)}><span data-content>{row.name}</span></Button></li>)}</ul>}
      </Tile>
      {batch && <Batch key={batch.id} batch={batch} busy={busy} act={act} w={w} />}
    </section>
  );
}
LessonDeskDesk.ready = true;

type W = (key: string, values?: Record<string, string>) => string;

function NewBatch({ busy, w, make }: { busy: boolean; w: W; make: (payload: unknown) => Promise<void> }) {
  const [name, setName] = useState(''), [subject, setSubject] = useState(''), [days, setDays] = useState<string[]>([]), [time, setTime] = useState('17:00'), [minutes, setMinutes] = useState('60');
  return (
    <form className={s.form} onSubmit={event => { event.preventDefault(); void make({ name, subject, days, time, minutes: Number(minutes) }); }}>
      <label className={s.label}>{w('name')}<input value={name} onChange={e => setName(e.target.value)} /></label>
      <label className={s.label}>{w('subject')}<input value={subject} onChange={e => setSubject(e.target.value)} /></label>
      <fieldset className={s.days}><legend className={s.line}>{w('days')}</legend>
        {DAYS.map(day => <label key={day} className={s.check}><input type="checkbox" checked={days.includes(day)} onChange={e => setDays(now => e.target.checked ? [...now, day] : now.filter(item => item !== day))} />{w('day.' + day)}</label>)}
      </fieldset>
      <label className={s.label}>{w('time')}<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
      <label className={s.label}>{w('minutes')}<input inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
      <div className={s.row}><Button type="submit" disabled={busy}>{w('make')}</Button></div>
    </form>
  );
}

function Batch({ batch, busy, act, w }: { batch: BatchView; busy: boolean; act: Act; w: W }) {
  const clients = useResource('venture.client.list', {});
  const orders = useResource('venture.order.list', {});
  const [name, setName] = useState(''), [minor, setMinor] = useState(false), [guardian, setGuardian] = useState(''), [order, setOrder] = useState('');
  const [on, setOn] = useState(''), [topic, setTopic] = useState('');
  const guardians = (clients.data ?? []).filter(client => !client.self);
  const feeOrders = (orders.data ?? []).filter(row => row.clientId === guardian && row.status !== 'cancelled');
  return (
    <div className={s.stack}>
      <Tile as="section" label={w('learners')}>
        <TileHead title={batch.name} meta={batch.subject} />
        <p className={s.line} data-engine-line>{batch.line}</p>
        <ul className={s.list} aria-label={w('learners')}>
          {batch.learners.map(learner => (
            <li key={learner.id} className={s.stack} data-row>
              <strong data-content>{learner.name}</strong>
              <span className={s.line} data-engine-line>{learner.consent.line}</span>
              <span className={s.line} data-engine-line>{learner.attendance.line}</span>
              {learner.scores.map(score => <span key={score.workId} className={s.line}><span data-content>{score.title}</span> {score.line}</span>)}
              {learner.fees.map(fee => <span key={fee.invoiceId} className={s.row}><span className={s.line}>{fee.number ?? w('draftInvoice')}</span><Figure value={fee.total} receiptId={fee.receiptId} /></span>)}
              <div className={s.row}>
                {learner.orderId && <Button disabled={busy} onClick={() => void act('fee', { learnerId: learner.id })}>{w('fee')}</Button>}
                <Button variant="quiet" disabled={busy} onClick={() => void act('remove-learner', { learnerId: learner.id })}>{w('remove')}</Button>
              </div>
            </li>
          ))}
        </ul>
        <form className={s.form} onSubmit={async event => { event.preventDefault(); const done = await act('add-learner', { name, minor, guardianClientId: guardian, ...(order ? { orderId: order } : {}) }); if (done) { setName(''); setMinor(false); setOrder(''); } }}>
          <label className={s.label}>{w('learnerName')}<input value={name} onChange={e => setName(e.target.value)} /></label>
          <label className={s.check}><input type="checkbox" checked={minor} onChange={e => setMinor(e.target.checked)} />{w('minor')}</label>
          <label className={s.label}>{w('guardian')}<select value={guardian} onChange={e => { setGuardian(e.target.value); setOrder(''); }}><option value="">{w('none')}</option>{guardians.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          <label className={s.label}>{w('order')}<select value={order} onChange={e => setOrder(e.target.value)}><option value="">{w('none')}</option>{feeOrders.map(row => <option key={row.id} value={row.id}>{row.request.slice(0, 60)}</option>)}</select></label>
          <div className={s.row}><Button type="submit" disabled={busy}>{w('addLearner')}</Button></div>
        </form>
      </Tile>
      <Tile as="section" label={w('classes')}>
        <TileHead title={w('classes')} />
        <ul className={s.list}>
          {batch.sessions.map(session => (
            <li key={session.id} className={s.stack} data-row>
              <span><span className={s.line}>{session.on}</span> <span data-content>{session.topic}</span></span>
              {batch.learners.map(learner => (
                <label key={learner.id} className={s.label}>{w('markFor', { name: learner.name, date: session.on })}
                  <select value={session.marks[learner.id] ?? ''} disabled={busy} onChange={e => { if (e.target.value) void act('attendance', { sessionId: session.id, marks: { [learner.id]: e.target.value } }); }}>
                    <option value="">{w('mark.none')}</option>
                    {(['present', 'late', 'absent'] as const).map(mark => <option key={mark} value={mark}>{w('mark.' + mark)}</option>)}
                  </select>
                </label>
              ))}
            </li>
          ))}
        </ul>
        <form className={s.form} onSubmit={async event => { event.preventDefault(); if (await act('session', { on, topic })) setTopic(''); }}>
          <label className={s.label}>{w('classDate')}<input type="date" value={on} onChange={e => setOn(e.target.value)} /></label>
          <label className={s.label}>{w('topic')}<input value={topic} onChange={e => setTopic(e.target.value)} /></label>
          <div className={s.row}><Button type="submit" disabled={busy}>{w('addClass')}</Button></div>
        </form>
      </Tile>
      <Work batch={batch} busy={busy} act={act} w={w} />
      <Messages batch={batch} busy={busy} act={act} w={w} />
    </div>
  );
}

function Work({ batch, busy, act, w }: { batch: BatchView; busy: boolean; act: Act; w: W }) {
  const [kind, setKind] = useState<'quiz' | 'worksheet'>('quiz'), [title, setTitle] = useState(''), [topic, setTopic] = useState(''), [questions, setQuestions] = useState('');
  const [quiz, setQuiz] = useState(''), [learner, setLearner] = useState(''), [answers, setAnswers] = useState('');
  const items = () => questions.split('\n').filter(text => text.trim()).map(text => { const [prompt, ...rest] = text.split('|'); return { prompt: prompt!.trim(), answer: rest.join('|').trim() }; });
  return (
    <Tile as="section" label={w('work')}>
      <TileHead title={w('work')} />
      <ul className={s.list}>{batch.works.map(work => <li key={work.id} className={s.line}><span data-content>{work.title}</span> {w('kind.' + work.kind)}</li>)}</ul>
      <form className={s.form} onSubmit={async event => { event.preventDefault(); if (await act('work', { kind, title, topic, items: items() })) { setTitle(''); setQuestions(''); } }}>
        <label className={s.label}>{w('workKind')}<select value={kind} onChange={e => setKind(e.target.value as 'quiz' | 'worksheet')}><option value="quiz">{w('kind.quiz')}</option><option value="worksheet">{w('kind.worksheet')}</option></select></label>
        <label className={s.label}>{w('workTitle')}<input value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label className={s.label}>{w('workTopic')}<input value={topic} onChange={e => setTopic(e.target.value)} /></label>
        <label className={s.label}>{w('questions')}<textarea rows={4} value={questions} onChange={e => setQuestions(e.target.value)} /></label>
        <div className={s.row}><Button type="submit" disabled={busy}>{w('addWork')}</Button></div>
      </form>
      {batch.works.some(work => work.kind === 'quiz') && (
        <form className={s.form} onSubmit={async event => { event.preventDefault(); if (await act('scores', { workId: quiz, answers: { [learner]: answers.split('\n') } })) setAnswers(''); }}>
          <label className={s.label}>{w('scoreQuiz')}<select value={quiz} onChange={e => setQuiz(e.target.value)}><option value="">{w('none')}</option>{batch.works.filter(work => work.kind === 'quiz').map(work => <option key={work.id} value={work.id}>{work.title}</option>)}</select></label>
          <label className={s.label}>{w('learner')}<select value={learner} onChange={e => setLearner(e.target.value)}><option value="">{w('none')}</option>{batch.learners.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className={s.label}>{w('answers')}<textarea rows={3} value={answers} onChange={e => setAnswers(e.target.value)} /></label>
          <div className={s.row}><Button type="submit" disabled={busy}>{w('score')}</Button></div>
        </form>
      )}
    </Tile>
  );
}

function Messages({ batch, busy, act, w }: { batch: BatchView; busy: boolean; act: Act; w: W }) {
  const [learner, setLearner] = useState(''), [channel, setChannel] = useState<'email' | 'whatsapp'>('email'), [phone, setPhone] = useState(''), [note, setNote] = useState('');
  const [openError, setOpenError] = useState('');
  const base = () => ({ learnerId: learner, channel, ...(channel === 'whatsapp' && phone ? { phone } : {}) });
  const open = async (message: MessageView) => {
    setOpenError('');
    let tab: Window | null = null;
    if (message.channel === 'whatsapp') { try { tab = reserveTab(); } catch { tab = null; } }
    const done = await act('handoff', { messageId: message.id });
    const handoff = (done?.result as { handoff?: OutreachHandoff } | undefined)?.handoff;
    if (!handoff) { tab?.close(); return; }
    try { await performHandoff(handoff, tab); } catch { setOpenError(w('error.POPUP_BLOCKED')); }
  };
  return (
    <Tile as="section" label={w('messages')}>
      <TileHead title={w('messages')} />
      <form className={s.form} onSubmit={event => event.preventDefault()}>
        <label className={s.label}>{w('learner')}<select value={learner} onChange={e => setLearner(e.target.value)}><option value="">{w('none')}</option>{batch.learners.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className={s.label}>{w('channel')}<select value={channel} onChange={e => setChannel(e.target.value as 'email' | 'whatsapp')}><option value="email">{w('channel.email')}</option><option value="whatsapp">{w('channel.whatsapp')}</option></select></label>
        {channel === 'whatsapp' && <label className={s.label}>{w('phone')}<input type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></label>}
        <label className={s.label}>{w('note')}<textarea rows={3} value={note} onChange={e => setNote(e.target.value)} /></label>
        <div className={s.row}>
          <Button disabled={busy} onClick={async () => { if (await act('progress', { ...base(), ...(note ? { note } : {}) })) setNote(''); }}>{w('progress')}</Button>
          <Button disabled={busy} onClick={async () => { if (await act('update', { ...base(), text: note })) setNote(''); }}>{w('update')}</Button>
        </div>
      </form>
      {openError && <p role="alert" className={s.error}>{openError}</p>}
      <ul className={s.list}>
        {batch.messages.map(message => (
          <li key={message.id} className={s.stack} data-row>
            <pre className={s.quote} data-content>{message.text}</pre>
            {message.handedOffAt
              ? <div className={s.row}><span className={s.line}>{w('handed')}</span><Button variant="quiet" disabled={busy} onClick={() => void open(message)}>{w('openAgain')}</Button></div>
              : <div className={s.row}><Button variant="primary" disabled={busy} onClick={() => void open(message)}>{w('approve')}</Button></div>}
          </li>
        ))}
      </ul>
    </Tile>
  );
}
