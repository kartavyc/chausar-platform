import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useLanguage, useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { stateText } from '../../parts/states';
import type { AgentView, RoutineSchedule, RoutineView } from '../../engine/types';
import { Tile, TileHead } from '../../parts/Tile';
import { dayOf, messageOf } from './shared';
import s from './Business.module.css';
import r from './RoutinesView.module.css';

/** Days as the engine numbers them: 1 Monday to 7 Sunday. */
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
/** The time zone a new routine starts in when the business has none on a routine yet (India first). */
const FIRST_ZONE = 'Asia/Kolkata';

/** A calendar schedule in the reader's language from its codes; once and interval read as the engine wrote them. */
function whenOf(routine: RoutineView, t: T): string {
  const { schedule } = routine;
  if (schedule.kind !== 'calendar') return routine.when;
  const days = schedule.weekdays.length === 7 ? t('business.routines.everyDay')
    : schedule.weekdays.join() === '1,2,3,4,5' ? t('business.routines.weekdays')
      : listOf(schedule.weekdays.map((day) => t(`business.routines.day.${day}`)), t);
  return t('business.routines.when', { days, time: schedule.time, zone: schedule.timeZone });
}

/**
 * The routine's next run in the reader's language, from the engine's codes (routine.on and routine.next), in the
 * routine's own time zone: "Next run 26 Oct, 09:00", "Off. Nothing runs." or "No more times to run."
 */
function nextOf(routine: RoutineView, t: T, language: string): string {
  if (!routine.on) return t('business.routines.offLine');
  if (!routine.next) return t('business.routines.noMore');
  const timeZone = routine.schedule.kind === 'calendar' ? routine.schedule.timeZone : FIRST_ZONE;
  const locale = language === 'hi' ? 'hi-IN' : 'en-IN';
  const at = new Date(routine.next);
  try {
    const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(at);
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(at);
    return t('business.routines.nextRun', { day, time });
  } catch {
    return t('business.routines.nextRun', { day: routine.next.slice(0, 10), time: routine.next.slice(11, 16) });
  }
}

function listOf(items: string[], t: T): string {
  return items.length <= 1 ? items.join('') : t('business.routines.and', { first: items.slice(0, -1).join(', '), last: items.at(-1)! });
}

/** A second ask under a button: the question, Not now (focused first) and the action again. */
function Ask({ ask, label, busy, onYes, onNo }: { ask: string; label: string; busy: boolean; onYes: () => void; onNo: () => void }) {
  const t = useT();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  return (
    <div className={s.foldBody} data-second-ask="">
      <p className={s.line}>{ask}</p>
      <div className={s.buttons}>
        <Button ref={cancel} variant="quiet" disabled={busy} onClick={onNo}>{t('approval.cancel')}</Button>
        <Button variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={onYes}>{label}</Button>
      </div>
    </div>
  );
}

/**
 * Business > Routines (#/business/routines; W4 4J22a, from 4J13's venture.routines.*; catalogue A12): each routine as a
 * card with its schedule in words and its time zone, never cron, who it asks, the engine's line on its next run, and its
 * history one step away, where a finished run says Delivered. A routine never approves anything: each run waits on
 * Today. Adding, changing, turning off or on and removing each ask a second time (standing configuration; the engine
 * keeps no undo for routines); the engine's refusals (a prompt that leans on a chat, a connection not checked yet)
 * show in its words.
 */
export function RoutinesView() {
  const t = useT();
  const list = useResource('venture.routines.list', {});
  const team = useResource('venture.team.list', {});
  const [said, setSaid] = useState<string | null>(null);
  const agents = (team.data?.agents ?? []).filter((agent) => agent.kind !== 'code' && agent.chat !== false);
  const routines = list.data?.routines ?? [];
  const zone = routines.find((one) => one.schedule.kind === 'calendar')?.schedule;
  const firstZone = zone?.kind === 'calendar' ? zone.timeZone : FIRST_ZONE;
  const changed = (line?: string) => { setSaid(line ?? null); list.reload(); };
  return (
    <div className={s.page}>
      <p className={s.lead}>{t('business.routines.lead')}</p>
      {list.error && !list.data && <p className={s.problem} role="alert">{t('business.failed', { message: list.error.message })}</p>}
      {!list.data && !list.error && <p className={s.note}>{t('business.loading')}</p>}
      {list.data && routines.length === 0 && <p className={s.line}>{t('business.routines.none')}</p>}
      {said && <p className={s.note} role="status">{said}</p>}
      {routines.length > 0 && (
        <div className={r.list}>
          {routines.map((routine) => <RoutineCard key={routine.id} routine={routine} agents={agents} zone={firstZone} onChanged={changed} />)}
        </div>
      )}
      <AddRoutine agents={agents} zone={firstZone} onAdded={() => changed()} />
    </div>
  );
}

function RoutineCard({ routine, agents, zone, onChanged }: { routine: RoutineView; agents: AgentView[]; zone: string; onChanged: (line?: string) => void }) {
  const t = useT();
  const client = useEngine();
  const titleId = useId();
  const [asking, setAsking] = useState<'toggle' | 'remove' | null>(null);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const who = routine.agent === null ? t('business.routines.chausar') : agents.find((agent) => agent.id === routine.agent)?.name ?? routine.agent;

  async function act(work: () => Promise<string | undefined>) {
    setBusy(true);
    setProblem(null);
    try { onChanged(await work()); } catch (error) {
      setProblem(t('business.routines.failed', { message: messageOf(error) }));
    } finally { setBusy(false); setAsking(null); }
  }

  // Off or on sends the routine back in its own words (venture.routines.list carries the prompt), only on changed.
  const toggle = () => act(async () => {
    const { id, name, agent, prompt, schedule } = routine;
    await client.request('venture.routines.set', { routine: { id, name, agent, prompt: prompt ?? '', schedule, on: !routine.on } });
    return undefined;
  });
  const remove = () => act(async () => (await client.request('venture.routines.remove', { id: routine.id })).line);
  const offOrOn = routine.on ? 'business.routines.off' : 'business.routines.on';
  const language = useLanguage();
  // A role that may not change routines reads no prompt (the engine leaves it out), so it gets no way to change one.
  const mayChange = routine.prompt !== undefined;

  return (
    <Tile as="article" labelledBy={titleId} className={r.card}>
      <TileHead id={titleId} title={routine.name} />
      <p className={s.strong} data-when="">{whenOf(routine, t)}</p>
      <p className={s.note} data-asks="">{t('business.routines.asks', { who })}</p>
      <p className={s.line} data-routine-line="">{nextOf(routine, t, language)}</p>
      <History id={routine.id} />
      {changing ? (
        <RoutineForm agents={agents} zone={zone} initial={routine} onSaved={() => { setChanging(false); onChanged(); }} onCancel={() => setChanging(false)} />
      ) : asking === 'toggle' ? (
        <Ask ask={t(routine.on ? 'business.routines.offAsk' : 'business.routines.onAsk')} label={t(offOrOn)} busy={busy} onNo={() => setAsking(null)} onYes={() => void toggle()} />
      ) : asking === 'remove' ? (
        <Ask ask={t('business.routines.removeAsk', { name: routine.name })} label={t('business.routines.remove')} busy={busy} onNo={() => setAsking(null)} onYes={() => void remove()} />
      ) : (
        mayChange && <div className={s.buttons}>
          <Button variant="quiet" onClick={() => setAsking('remove')}>{t('business.routines.remove')}</Button>
          <Button variant="quiet" onClick={() => { setProblem(null); setChanging(true); }}>{t('business.routines.change')}</Button>
          <Button onClick={() => { setProblem(null); setAsking('toggle'); }}>{t(offOrOn)}</Button>
        </div>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </Tile>
  );
}

/** The routine's runs, newest first, read when the fold opens: the state word (Delivered, never Done) and the engine line. */
function History({ id }: { id: string }) {
  const t = useT();
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const runs = useResource('venture.routines.runs', { id }, { skip: !open });
  return (
    <details className={s.fold} data-fold="history" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t('business.routines.history')}</summary>
      {runs.data && runs.data.runs.length === 0 && <p className={s.note}>{t('business.routines.noRuns')}</p>}
      {runs.data && runs.data.runs.length > 0 && (
        <ul className={s.log}>
          {runs.data.runs.map((run) => (
            // A finished run says Delivered once, with its day; any other says its word and the engine's reason.
            <li key={run.id}>{run.state === 'completed'
              ? t('business.routines.delivered', { word: stateText(t, 'routine', run.state), day: dayOf(run.dueAt, language) })
              : t('business.routines.run', { word: stateText(t, 'routine', run.state), line: run.line, day: dayOf(run.dueAt, language) })}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** "Add a routine", folded until opened, with the same form a routine's Change opens. */
function AddRoutine({ agents, zone, onAdded }: { agents: AgentView[]; zone: string; onAdded: () => void }) {
  const t = useT();
  return (
    <details className={s.fold} data-fold="add-routine">
      <summary>{t('business.routines.add')}</summary>
      <RoutineForm agents={agents} zone={zone} onSaved={onAdded} />
    </details>
  );
}

/**
 * A routine's form: its name, who it asks, what to ask in full, the days, the time and the time zone. A routine set
 * once or every so many minutes keeps its schedule (the engine's words show) and changes only the rest. Save asks a
 * second time: a routine is standing configuration. initial: the routine being changed, sent back with its id.
 */
function RoutineForm({ agents, zone, initial, onSaved, onCancel }: { agents: AgentView[]; zone: string; initial?: RoutineView; onSaved: () => void; onCancel?: () => void }) {
  const t = useT();
  const client = useEngine();
  const calendar = initial?.schedule.kind === 'calendar' ? initial.schedule : null;
  const [name, setName] = useState(initial?.name ?? '');
  const [agent, setAgent] = useState(initial?.agent ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [days, setDays] = useState<number[]>(calendar ? [...calendar.weekdays] : []);
  const [time, setTime] = useState(calendar?.time ?? '09:00');
  const [timeZone, setTimeZone] = useState(calendar?.timeZone ?? zone);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { if (!initial) setTimeZone(zone); }, [zone, initial]);
  const keeps = initial !== undefined && calendar === null;
  const ready = name.trim() !== '' && prompt.trim() !== '' && (keeps || (days.length > 0 && time !== '' && timeZone.trim() !== ''));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setProblem(null);
    setAsking(true);
  }

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const schedule: RoutineSchedule = keeps ? initial!.schedule : { kind: 'calendar', weekdays: [...days].sort((a, b) => a - b), time, timeZone: timeZone.trim() };
      await client.request('venture.routines.set', { routine: {
        ...(initial ? { id: initial.id } : {}), name: name.trim(), agent: agent === '' ? null : agent, prompt: prompt.trim(), on: initial?.on ?? true, schedule,
      } });
      if (!initial) { setName(''); setPrompt(''); setDays([]); }
      onSaved();
    } catch (error) {
      setProblem(t('business.routines.saveFailed', { message: messageOf(error) }));
    } finally { setBusy(false); setAsking(false); }
  }

  const toggleDay = (day: number) => setDays((now) => (now.includes(day) ? now.filter((d) => d !== day) : [...now, day]));
  return (
    <form aria-label={initial ? t('business.routines.changeOf', { name: initial.name }) : t('business.routines.add')} className={r.form} onSubmit={submit}>
      <Field label={t('business.routines.name')} value={name} maxLength={80} onChange={(event) => setName(event.currentTarget.value)} />
      <label className={r.select}>
        <span className={r.legend}>{t('business.routines.who')}</span>
        <select value={agent} onChange={(event) => setAgent(event.currentTarget.value)}>
          <option value="">{t('business.routines.chausar')}</option>
          {agents.map((one) => <option key={one.id} value={one.id}>{one.name}</option>)}
        </select>
      </label>
      <Field multiline rows={3} label={t('business.routines.prompt')} hint={t('business.routines.promptHint')} value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.currentTarget.value)} />
      {keeps ? <p className={s.note}>{initial!.when}</p> : (
        <>
          <fieldset className={r.days}>
            <legend className={r.legend}>{t('business.routines.days')}</legend>
            {DAYS.map((day) => (
              <label key={day} className={r.day}>
                <input type="checkbox" checked={days.includes(day)} onChange={() => toggleDay(day)} />
                <span>{t(`business.routines.day.${day}`)}</span>
              </label>
            ))}
          </fieldset>
          <div className={r.pair}>
            <Field type="time" label={t('business.routines.time')} value={time} onChange={(event) => setTime(event.currentTarget.value)} />
            <Field label={t('business.routines.zone')} value={timeZone} onChange={(event) => setTimeZone(event.currentTarget.value)} />
          </div>
        </>
      )}
      {asking ? (
        <Ask ask={t('business.routines.saveAsk')} label={t('business.routines.save')} busy={busy} onNo={() => setAsking(false)} onYes={() => void save()} />
      ) : (
        <div className={s.buttons}>
          {onCancel && <Button variant="quiet" onClick={onCancel}>{t('approval.cancel')}</Button>}
          <Button type="submit" disabled={!ready}>{t('business.routines.saveRoutine')}</Button>
        </div>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </form>
  );
}
