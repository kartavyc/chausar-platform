import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { useOwnerZone } from '../../shell/clock';
import { formatClock, formatDay, formatTime } from '../../../../../platform/runtime/owner-format';
import { Button } from '../../parts/Button';
import { Confirm } from '../../parts/Confirm';
import { Field } from '../../parts/Field';
import { InlineError } from '../../parts/InlineError';
import { stateText } from '../../parts/states';
import { EngineError, type AgentView, type RoutineSchedule, type RoutineSuggestion, type RoutineView } from '../../engine/types';
import { Tile, TileHead } from '../../parts/Tile';
import { dayOf, messageOf } from './shared';
import { ModelReceipt } from '../../parts/ModelReceipt';
import { ResultLine } from '../../parts/ResultLine';
import { EventTriggers } from './EventTriggers';
import s from './Business.module.css';
import r from './RoutinesView.module.css';
import { Fold } from '../../parts/Fold';
import { Select } from '../../parts/Select';
import { LoadingPlace } from '../../parts/Skeleton';

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
  return t('business.routines.when', { days, time: formatClock(schedule.time), zone: schedule.timeZone });
}

/**
 * The routine's next run in the reader's language, from the engine's codes (routine.on and routine.next), in the
 * routine's own time zone: "Next run 26 Oct, 9:00 am", "Off. Nothing runs." or "No more times to run." A zone the computer
 * cannot read falls back to the owner's zone (B2), never to the raw ISO text.
 */
function nextOf(routine: RoutineView, t: T, ownerZone: string): string {
  if (!routine.on) return t('business.routines.offLine');
  if (!routine.next) return t('business.routines.noMore');
  const timeZone = routine.schedule.kind === 'calendar' || routine.schedule.kind === 'monthly' ? routine.schedule.timeZone : FIRST_ZONE;
  const at = new Date(routine.next);
  try {
    return t('business.routines.nextRun', { day: formatDay(at, timeZone, 'short'), time: formatTime(at, timeZone) });
  } catch {
    return t('business.routines.nextRun', { day: formatDay(at, ownerZone, 'short'), time: formatTime(at, ownerZone) });
  }
}

function listOf(items: string[], t: T): string {
  return items.length <= 1 ? items.join('') : t('business.routines.and', { first: items.slice(0, -1).join(', '), last: items.at(-1)! });
}

/**
 * A routine's refusal, in the slot of what failed (B4 task 4). "Check your AI first" carries Check now, which runs the
 * Connections check: the line clears on the press, says Checking..., and the same routine goes again.
 */
function useRoutineProblem() {
  const t = useT();
  const client = useEngine();
  const [problem, setProblem] = useState<{ line: string; again?: () => void } | null>(null);
  const [checking, setChecking] = useState(false);
  function refused(key: 'business.routines.failed' | 'business.routines.saveFailed', error: unknown, again: () => void) {
    const line = t(key, { message: messageOf(error) });
    setProblem(error instanceof EngineError && error.code === 'ROUTINE_NEEDS_CHECK' ? { line, again } : { line });
  }
  async function checkNow(again: () => void) {
    setProblem(null);
    setChecking(true);
    try {
      await client.request('venture.connectors.check', {});
      setChecking(false);
      again();
    } catch (error) {
      setChecking(false);
      setProblem({ line: t('business.routines.saveFailed', { message: messageOf(error) }) });
    }
  }
  const again = problem?.again;
  const node = checking ? <p className={s.note} role="status">{t('business.routines.checking')}</p>
    : problem ? <InlineError tone={again ? 'expected' : 'failure'} fix={again ? { label: t('business.routines.checkNow'), onSelect: () => void checkNow(again) } : undefined}>{problem.line}</InlineError>
      : null;
  return { node, refused, clear: () => setProblem(null) };
}

/** A second ask under a button: the question, Cancel (focused first) and the action again. */
function Ask({ ask, label, busy, onYes, onNo }: { ask: string; label: string; busy: boolean; onYes: () => void; onNo: () => void }) {
  return <div className={s.foldBody}><Confirm action={label} busy={busy} onCancel={onNo} onConfirm={onYes}><p className={s.line}>{ask}</p></Confirm></div>;
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
  const readyId = useId();
  const agents = (team.data?.agents ?? []).filter((agent) => agent.kind !== 'code' && agent.chat !== false);
  const routines = list.data?.routines ?? [];
  const zone = routines.find((one) => one.schedule.kind === 'calendar')?.schedule;
  const firstZone = zone?.kind === 'calendar' ? zone.timeZone : FIRST_ZONE;
  const changed = (line?: string) => { setSaid(line ?? null); setPrefill(null); list.reload(); };
  // C4 task 32: with no routine yet, up to two ready ones the plan names; Add fills the form, the owner still saves.
  const ready = useResource('venture.routines.suggestions', {}, { skip: !list.data || routines.length > 0 });
  const suggestions = routines.length === 0 ? ready.data?.suggestions ?? [] : [];
  const [prefill, setPrefill] = useState<{ key: number; routine: RoutineSuggestion } | null>(null);
  return (
    <div className={s.page}>
      <p className={s.lead}>{t('business.routines.lead')}</p>
      {list.error && !list.data && <p className={s.problem} role="alert">{t('business.failed', { message: list.error.message })}</p>}
      {!list.data && !list.error && <LoadingPlace shape="settings" />}
      {list.data && routines.length === 0 && <p className={s.line}>{t('business.routines.none')}</p>}
      {suggestions.length > 0 && (
        <>
          <p id={readyId} className={s.note}>{t('business.routines.ready')}</p>
          <ul aria-labelledby={readyId} className={r.list}>
            {suggestions.map((one) => (
              <li key={one.name} className={s.line} data-suggestion="">
                <span className={s.strong} data-suggestion-name="">{one.name}</span>{' '}
                <span className={s.note}>{one.when}</span>{' '}
                <Button size="sm" onClick={() => setPrefill((now) => ({ key: (now?.key ?? 0) + 1, routine: one }))}>{t('business.routines.addReady')}</Button>
              </li>
            ))}
          </ul>
        </>
      )}
      <ResultLine>{said}</ResultLine>
      {routines.length > 0 && (
        <div className={r.list}>
          {routines.map((routine) => <RoutineCard key={routine.id} routine={routine} agents={agents} zone={firstZone} onChanged={changed} />)}
        </div>
      )}
      <AddRoutine agents={agents} zone={firstZone} prefill={prefill} onAdded={() => changed()} />
      <EventTriggers agents={agents} onSaved={() => changed()} />
      <PlanPause />
      <BackupAi />
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
  const problem = useRoutineProblem();
  const who = routine.agent === null ? t('business.routines.chausar') : agents.find((agent) => agent.id === routine.agent)?.name ?? routine.agent;

  async function act(work: () => Promise<string | undefined>) {
    setBusy(true);
    problem.clear();
    try { onChanged(await work()); } catch (error) {
      problem.refused('business.routines.failed', error, () => void act(work));
    } finally { setBusy(false); setAsking(null); }
  }

  // Off or on sends the routine back in its own words (venture.routines.list carries the prompt), only on changed.
  const toggle = () => act(async () => {
    const { id, name, agent, prompt, schedule,recordReport } = routine;
    await client.request('venture.routines.set', { routine: { id, name, agent, prompt: prompt ?? '', schedule, on: !routine.on,...(recordReport?{recordReport}:{}) } });
    return undefined;
  });
  const remove = () => act(async () => (await client.request('venture.routines.remove', { id: routine.id })).line);
  const offOrOn = routine.on ? 'business.routines.off' : 'business.routines.on';
  const ownerZone = useOwnerZone();
  // A role that may not change routines reads no prompt (the engine leaves it out), so it gets no way to change one.
  const mayChange = routine.prompt !== undefined;

  return (
    <Tile as="article" labelledBy={titleId} className={r.card}>
      <TileHead id={titleId} title={routine.name} />
      <p className={s.strong} data-when="">{whenOf(routine, t)}</p>
      <p className={s.note} data-asks="">{t('business.routines.asks', { who })}</p>
      <p className={s.line} data-routine-line="">{nextOf(routine, t, ownerZone)}</p>
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
          <Button variant="quiet" onClick={() => { problem.clear(); setChanging(true); }}>{t('business.routines.change')}</Button>
          <Button onClick={() => { problem.clear(); setAsking('toggle'); }}>{t(offOrOn)}</Button>
        </div>
      )}
      {problem.node}
    </Tile>
  );
}

/** The routine's runs, newest first, read when the fold opens: the state word (Delivered, never Done) and the engine line. */
function History({ id }: { id: string }) {
  const t = useT();
  const zone = useOwnerZone();
  const [open, setOpen] = useState(false);
  const runs = useResource('venture.routines.runs', { id }, { skip: !open });
  return (
    <Fold summary={t('business.routines.history')} className={s.fold} data-fold="history" onToggle={(event) => setOpen(event.currentTarget.open)}>
      {runs.data && runs.data.runs.length === 0 && <p className={s.note}>{t('business.routines.noRuns')}</p>}
      {runs.data && runs.data.runs.length > 0 && (
        <ul className={s.log}>
          {runs.data.runs.map((run) => (
            // A finished run says Delivered once, with its day; any other says its word and the engine's reason.
            <li key={run.id}>{run.state === 'completed'
              ? t('business.routines.delivered', { word: stateText(t, 'routine', run.state), day: dayOf(run.dueAt, zone) })
              : t('business.routines.run', { word: stateText(t, 'routine', run.state), line: run.line, day: dayOf(run.dueAt, zone) })}
              {/* C7: a run that went to the backup AI says which and why, in the engine's words. */}
              {run.ranOn && <span className={s.note} data-ran-on=""> {run.ranOn}</span>}
              {/* W6 6G5 (D44): the model receipt of a run that asked an AI. */}
              <ModelReceipt receipt={run.receipt} /></li>
          ))}
        </ul>
      )}
    </Fold>
  );
}

/** "Add a routine", folded until opened, with the same form a routine's Change opens. */
function AddRoutine({ agents, zone, prefill, onAdded }: { agents: AgentView[]; zone: string; prefill: { key: number; routine: RoutineSuggestion } | null; onAdded: () => void }) {
  const t = useT();
  const fold = useRef<HTMLDetailsElement>(null);
  // C4 task 32: a ready routine's Add opens the fold with the form filled.
  useEffect(() => { if (prefill && fold.current) fold.current.open = true; }, [prefill]);
  return (
    <Fold ref={fold} summary={t('business.routines.add')} className={s.fold} data-fold="add-routine">
      <RoutineForm key={prefill?.key ?? 0} agents={agents} zone={zone} prefill={prefill?.routine} onSaved={onAdded} />
    </Fold>
  );
}

/**
 * A routine's form: its name, who it asks, what to ask in full, the days, the time and the time zone. A routine set
 * once or every so many minutes keeps its schedule (the engine's words show) and changes only the rest. Save asks a
 * second time: a routine is standing configuration. initial: the routine being changed, sent back with its id.
 */
function RoutineForm({ agents, zone, initial, prefill, onSaved, onCancel }: { agents: AgentView[]; zone: string; initial?: RoutineView; prefill?: RoutineSuggestion; onSaved: () => void; onCancel?: () => void }) {
  const t = useT();
  const client = useEngine();
  // prefill (C4 task 32): a ready routine from the plan; a monthly one keeps its schedule as the engine wrote it.
  const start = initial ?? prefill;
  const calendar = start?.schedule.kind === 'calendar' ? start.schedule : null;
  const fixed = start && calendar === null ? start.schedule : null;
  const [name, setName] = useState(start?.name ?? '');
  const [agent, setAgent] = useState(start?.agent ?? '');
  const [prompt, setPrompt] = useState(start?.prompt ?? '');
  const [days, setDays] = useState<number[]>(calendar ? [...calendar.weekdays] : []);
  const [time, setTime] = useState(calendar?.time ?? '09:00');
  const [timeZone, setTimeZone] = useState(calendar?.timeZone ?? zone);
  const [busy, setBusy] = useState(false);
  const problem = useRoutineProblem();
  useEffect(() => { if (!initial && !calendar) setTimeZone(zone); }, [zone, initial, calendar]);
  const keeps = fixed !== null;
  const ready = name.trim() !== '' && prompt.trim() !== '' && (keeps || (days.length > 0 && time !== '' && timeZone.trim() !== ''));
  /** The first thing still missing, said under Save routine (B4). */
  const missing = ready ? undefined
    : name.trim() === '' ? t('business.routines.needName')
      : prompt.trim() === '' ? t('business.routines.needPrompt')
        : days.length === 0 ? t('business.routines.needDay')
          : t('business.routines.needTime');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    void save();
  }

  async function save() {
    setBusy(true);
    problem.clear();
    try {
      const schedule: RoutineSchedule = fixed ?? { kind: 'calendar', weekdays: [...days].sort((a, b) => a - b), time, timeZone: timeZone.trim() };
      await client.request('venture.routines.set', { routine: {
        ...(initial ? { id: initial.id,...(initial.recordReport?{recordReport:initial.recordReport}:{}) } : {}), name: name.trim(), agent: agent === '' ? null : agent, prompt: prompt.trim(), on: initial?.on ?? true, schedule,
      } });
      if (!initial) { setName(''); setPrompt(''); setDays([]); }
      onSaved();
    } catch (error) {
      problem.refused('business.routines.saveFailed', error, () => void save());
    } finally { setBusy(false); }
  }

  const toggleDay = (day: number) => setDays((now) => (now.includes(day) ? now.filter((d) => d !== day) : [...now, day]));
  return (
    <form aria-label={initial ? t('business.routines.changeOf', { name: initial.name }) : t('business.routines.add')} className={r.form} onSubmit={submit}>
      <Field label={t('business.routines.name')} value={name} maxLength={80} onChange={(event) => setName(event.currentTarget.value)} />
      <Select label={t('business.routines.who')} value={agent} onChange={(event) => setAgent(event.currentTarget.value)}>
          <option value="">{t('business.routines.chausar')}</option>
          {agents.map((one) => <option key={one.id} value={one.id}>{one.name}</option>)}
        </Select>
      <Field multiline rows={3} label={t('business.routines.prompt')} hint={t('business.routines.promptHint')} value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.currentTarget.value)} />
      {keeps ? <p className={s.note}>{start!.when}</p> : (
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
      {/* B4 (192.d1): saved on one press. The page's lead already says each run waits for approval on Today. */}
      <div className={s.buttons}>
        {onCancel && <Button onClick={onCancel}>{t('approval.cancel')}</Button>}
        <Button type="submit" disabled={busy} disabledReason={missing}>{t('business.routines.saveRoutine')}</Button>
      </div>
      {problem.node}
    </form>
  );
}

/** C7: the pause points an owner may choose; none means only a used-up plan holds a routine. */
const PAUSE_POINTS = [50, 60, 70, 80, 90, 95] as const;

/**
 * C7: "If your AI plan runs low", folded at rest. Routines wait once the plan meter reads the chosen percent or more of
 * the owner's Codex or Claude Code plan (as the tool reported it); with none, only a used-up plan holds them. Saved
 * through the AI settings after a second ask, since it is standing configuration.
 */
function PlanPause() {
  const t = useT();
  const client = useEngine();
  const id = useId();
  const [open, setOpen] = useState(false);
  const current = useResource('venture.agentSettings.get', {}, { skip: !open });
  const saved = current.data?.settings.planPause ?? null;
  const [choice, setChoice] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const value = choice ?? (saved === null ? 'none' : String(saved));
  async function save() {
    if (!current.data) return;
    setBusy(true); setProblem(null);
    try {
      const planPause = value === 'none' ? null : Number(value);
      await client.request('venture.agentSettings.set', { settings: { ...current.data.settings, planPause } });
      setSaid(planPause === null ? t('business.routines.plan.savedNone') : t('business.routines.plan.saved', { percent: planPause }));
      setChoice(null); current.reload();
    } catch (error) {
      setProblem(t('business.routines.saveFailed', { message: messageOf(error) }));
    } finally { setBusy(false); setAsking(false); }
  }
  return (
    <Fold summary={t('business.routines.plan.title')} className={s.fold} data-fold="plan-pause" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <p className={s.note}>{t('business.routines.plan.line')}</p>
      <label className={r.select} htmlFor={id}>
        <span className={r.legend}>{t('business.routines.plan.at')}</span>
        <Select id={id} value={value} disabled={!current.data} onChange={(event) => { setChoice(event.currentTarget.value); setSaid(null); }}>
          <option value="none">{t('business.routines.plan.none')}</option>
          {PAUSE_POINTS.map((point) => <option key={point} value={String(point)}>{t('business.routines.plan.percent', { percent: point })}</option>)}
        </Select>
      </label>
      {asking
        ? <Ask ask={t('business.routines.plan.ask')} label={t('business.routines.save')} busy={busy} onNo={() => setAsking(false)} onYes={() => void save()} />
        : <div className={s.buttons}><Button disabled={!current.data || choice === null} onClick={() => setAsking(true)}>{t('business.routines.save')}</Button></div>}
      {said && <p className={s.note} role="status">{said}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </Fold>
  );
}

/**
 * C7: "If your AI can't run", folded at rest. Off by default. The owner picks up to two other AIs connected to this
 * business, in order (Move up, Move down); each one's consent text shows before the switch saves, and saving sends what
 * the owner read. A routine falls back only when its main AI refused before anything reached it.
 */
function BackupAi() {
  const t = useT();
  const client = useEngine();
  const [open, setOpen] = useState(false);
  const view = useResource('venture.routines.backup.get', {}, { skip: !open });
  const [order, setOrder] = useState<string[] | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const data = view.data;
  const chosen = order ?? data?.order ?? [];
  const isOn = on ?? data?.on ?? false;
  const changed = data !== undefined && (isOn !== data.on || chosen.join() !== data.order.join());
  const choice = (id: string) => data?.choices.find((item) => item.presetId === id);
  const toggle = (id: string) => setOrder(chosen.includes(id) ? chosen.filter((one) => one !== id) : [...chosen, id].slice(0, 2));
  const move = (index: number, by: number) => {
    const next = [...chosen];
    const [one] = next.splice(index, 1);
    next.splice(index + by, 0, one!);
    setOrder(next);
  };
  async function save() {
    setBusy(true); setProblem(null);
    try {
      const digests = isOn ? chosen.map((id) => choice(id)!.digest) : undefined;
      await client.request('venture.routines.backup.set', { on: isOn, order: chosen, ...(digests ? { digests } : {}) });
      setSaid(isOn ? t('business.routines.backup.savedOn') : t('business.routines.backup.savedOff'));
      setOrder(null); setOn(null); view.reload();
    } catch (error) {
      setProblem(t('business.routines.saveFailed', { message: messageOf(error) }));
    } finally { setBusy(false); setAsking(false); }
  }
  return (
    <Fold summary={t('business.routines.backup.title')} className={s.fold} data-fold="backup-ai" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <p className={s.note}>{t('business.routines.backup.line')}</p>
      {data && data.choices.length === 0 && <p className={s.line}>{t('business.routines.backup.none')}</p>}
      {data && data.choices.length > 0 && (
        <>
          <label className={r.day}>
            <input type="checkbox" checked={isOn} onChange={() => { setOn(!isOn); setSaid(null); }} />
            <span>{t('business.routines.backup.switch')}</span>
          </label>
          <ul className={s.log} aria-label={t('business.routines.backup.order')}>
            {data.choices.map((item) => {
              const index = chosen.indexOf(item.presetId);
              return (
                <li key={item.presetId} data-backup={item.presetId}>
                  <label className={r.day}>
                    <input type="checkbox" checked={index >= 0} onChange={() => toggle(item.presetId)} />
                    <span>{index >= 0 ? t('business.routines.backup.nth', { n: index + 1, name: item.label }) : item.label}</span>
                  </label>
                  {index >= 0 && chosen.length > 1 && (
                    <span className={s.buttons}>
                      <Button size="sm" variant="quiet" disabled={index === 0} onClick={() => move(index, -1)}>{t('business.routines.backup.up')}</Button>
                      <Button size="sm" variant="quiet" disabled={index === chosen.length - 1} onClick={() => move(index, 1)}>{t('business.routines.backup.down')}</Button>
                    </span>
                  )}
                  {/* What this AI is sent, in the engine's words, read before the switch saves. */}
                  {isOn && index >= 0 && <p className={s.note} data-content="" data-backup-consent="">{item.text}</p>}
                </li>
              );
            })}
          </ul>
          {asking
            ? <Ask ask={isOn ? t('business.routines.backup.askOn') : t('business.routines.backup.askOff')} label={t('business.routines.save')} busy={busy} onNo={() => setAsking(false)} onYes={() => void save()} />
            : <div className={s.buttons}><Button disabled={!changed || (isOn && chosen.length === 0)} onClick={() => setAsking(true)}>{t('business.routines.save')}</Button></div>}
        </>
      )}
      {said && <p className={s.note} role="status">{said}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </Fold>
  );
}
