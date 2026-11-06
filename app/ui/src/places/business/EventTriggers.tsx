import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useState, type FormEvent } from 'react';
import { useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { AgentView, RoutineSchedule } from '../../engine/types';

import s from './Business.module.css';
import { Select } from '../../parts/Select';
import { Fold } from '../../parts/Fold';
import r from './RoutinesView.module.css';

type EventSchedule = Extract<RoutineSchedule, { kind: 'event' }>;
const EVENTS: readonly EventSchedule[] = [
  { kind: 'event', source: 'razorpay', event: 'payment' },
  { kind: 'event', source: 'cal-com', event: 'booking' },
  { kind: 'event', source: 'cal-com', event: 'booking-cancelled' },
];
const factWord = (t: T, blank: string) => t(`business.triggers.fact.${blank}`);

/**
 * Routines > When something happens (C7 task 12): routines that start on a payment or a booking and only draft. The relay
 * address and the Cal.com key go to protected storage; the page shows only the relay's host and says nothing fires while
 * Chausar is closed. Saving a trigger shows the facts each event sends, and a second ask, since it is the owner's approval
 * of exactly those facts. Recent events show with their state, and a refused one says why. Fixture-tested until run live.
 */
export function EventTriggers({ agents, onSaved }: { agents: AgentView[]; onSaved: () => void }) {
  const t = useT();
  const client = useEngine();
  const [open, setOpen] = useState(false);
  const events = useResource('venture.events.get', {}, { skip: !open });
  const [address, setAddress] = useState('');
  const [calKey, setCalKey] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const data = events.data;
  async function act(work: () => Promise<unknown>) {
    setProblem(null);
    try { await work(); events.reload(); } catch (error) { setProblem(messageOf(error)); }
  }
  const saveRelay = (event: FormEvent) => { event.preventDefault(); void act(() => client.request('venture.events.relay.set', { address: address.trim() })).then(() => setAddress('')); };
  const saveKey = (event: FormEvent) => { event.preventDefault(); void act(() => client.request('venture.events.calKey.set', { key: calKey.trim() })).then(() => setCalKey('')); };
  return (
    <Fold summary={t('business.triggers.title')} className={s.fold} data-fold="event-triggers" onToggle={(event) => setOpen(event.currentTarget.open)}>
      {data && (
        <div className={r.list}>
          <p className={s.line} data-closed-line="">{data.line}</p>
          <p className={s.note}>{data.label}</p>
          {data.relay
            ? <p className={s.note} data-relay-host="">{t('business.triggers.relayIs', { host: data.relay })} <Button size="sm" variant="quiet" onClick={() => void act(() => client.request('venture.events.relay.set', { address: null }))}>{t('business.triggers.forget')}</Button></p>
            : (
              <form className={r.form} onSubmit={saveRelay}>
                <Field label={t('business.triggers.relay')} hint={t('business.triggers.relayHint')} value={address} onChange={(event) => setAddress(event.currentTarget.value)} />
                <div className={s.buttons}><Button type="submit" disabled={!address.trim()}>{t('business.routines.save')}</Button></div>
              </form>
            )}
          {data.relay && !data.calKey && (
            <form className={r.form} onSubmit={saveKey}>
              <Field type="password" label={t('business.triggers.calKey')} value={calKey} onChange={(event) => setCalKey(event.currentTarget.value)} />
              <div className={s.buttons}><Button type="submit" disabled={!calKey.trim()}>{t('business.routines.save')}</Button></div>
            </form>
          )}
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          {data.relay && <AddTrigger agents={agents} blanks={data.blanks} onSaved={onSaved} />}
          {data.events.length > 0 && (
            <ul className={s.log} aria-label={t('business.triggers.recent')}>
              {data.events.map((event) => <li key={event.id} data-event-state={event.state}>{t(`business.triggers.state.${event.state}`)}: {event.line}</li>)}
            </ul>
          )}
        </div>
      )}
    </Fold>
  );
}

function AddTrigger({ agents, blanks, onSaved }: { agents: AgentView[]; blanks: Readonly<Record<string, readonly string[]>>; onSaved: () => void }) {
  const t = useT();
  const client = useEngine();
  const [which, setWhich] = useState(0);
  const [agent, setAgent] = useState('');
  const [prompt, setPrompt] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const schedule = EVENTS[which]!;
  const allowed = blanks[schedule.event] ?? [];
  const used = allowed.filter((blank) => prompt.includes(`{${blank}}`));
  const name = t(`business.triggers.when.${schedule.event}`);
  async function save() {
    setBusy(true); setProblem(null);
    try {
      await client.request('venture.routines.set', { routine: { name, agent: agent === '' ? null : agent, prompt: prompt.trim(), on: true, schedule } });
      setPrompt(''); setAsking(false); onSaved();
    } catch (error) { setProblem(messageOf(error)); } finally { setBusy(false); }
  }
  return (
    <form className={r.form} aria-label={t('business.triggers.add')} onSubmit={(event) => { event.preventDefault(); if (prompt.trim()) setAsking(true); }}>
      <label className={r.select}>
        <span className={r.legend}>{t('business.triggers.event')}</span>
        <Select value={which} onChange={(event) => { setWhich(Number(event.currentTarget.value)); setAsking(false); }}>
          {EVENTS.map((item, index) => <option key={item.event} value={index}>{t(`business.triggers.when.${item.event}`)}</option>)}
        </Select>
      </label>
      <label className={r.select}>
        <span className={r.legend}>{t('business.routines.who')}</span>
        <Select value={agent} onChange={(event) => setAgent(event.currentTarget.value)}>
          <option value="">{t('business.routines.chausar')}</option>
          {agents.map((one) => <option key={one.id} value={one.id}>{one.name}</option>)}
        </Select>
      </label>
      <Field multiline rows={3} label={t('business.triggers.prompt')} hint={t('business.triggers.promptHint', { blanks: allowed.map((blank) => `{${blank}}`).join(', ') })} value={prompt} maxLength={2000} onChange={(event) => { setPrompt(event.currentTarget.value); setAsking(false); }} />
      {asking ? (
        <div className={s.foldBody} data-second-ask="" data-trigger-facts="">
          <p className={s.line}>{used.length ? t('business.triggers.sends', { facts: used.map((blank) => factWord(t, blank)).join(', ') }) : t('business.triggers.sendsNone')}</p>
          <div className={s.buttons}>
            <Button variant="quiet" disabled={busy} onClick={() => setAsking(false)}>{t('approval.cancel')}</Button>
            <Button variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={() => void save()}>{t('business.routines.save')}</Button>
          </div>
        </div>
      ) : <div className={s.buttons}><Button type="submit" disabled={!prompt.trim()}>{t('business.routines.saveRoutine')}</Button></div>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </form>
  );
}
