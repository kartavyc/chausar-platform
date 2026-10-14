/**
 * The round-2 parts of a job's sheet: a person's step with Done (WK-16), the schedule and the
 * missed-run rule (WK-11), Edit (budget, most runs, missed-run rule) and Delete with a confirm
 * (WK-07, WK-08). Each change goes through `approvals.*`; the engine routes it to job
 * extensions or the core, and a change waits for a new approval.
 */
import { useState, type FormEvent } from 'react';
import type { Language } from '../../app/presentation.ts';
import { dayTime } from './kit/format.ts';
import { useAct } from './kit/reply.ts';
import { Actions, Button, Note, Refusal } from './kit/Page';
import { rupeesToPaise, paiseToRupees } from './StartJob.tsx';
import { deleted, edited, missedSet, stepDone, type Manage, type PersonStep, type Schedule } from './contract-jobs.ts';
import type { JobCard } from './contract.ts';
import { sayJob, type JobWords } from './text-jobs.ts';
import type { WorkWords } from './text.ts';
import type { PlaceRpc } from '../../places/types.ts';
import s from './work.module.css';

type Missed = JobCard['missedRun'];

export function PersonStepRow({ step, jobId, j, language, rpc, way, onDone }: { step: PersonStep; jobId: string; j: JobWords; language: Language; rpc: PlaceRpc; way: Manage['personStep'] | undefined; onDone: () => void }) {
  const act = useAct(rpc);
  const who = step.who.kind === 'you' ? j['person.you'] : step.who.name;
  const doneLine = step.done && step.doneAt !== null
    ? step.doneBy !== null ? sayJob(j, 'person.doneOn', { when: dayTime(step.doneAt, language), by: step.doneBy }) : sayJob(j, 'person.doneOnly', { when: dayTime(step.doneAt, language) })
    : null;
  const mark = async () => { const out = await act.run('approvals.personStepDone', { jobId, stepId: step.stepId }, stepDone); if (out.ok) onDone(); };
  return (
    <li className={s.item} data-person-step={step.stepId}>
      <div>
        <span>{step.what}</span>
        <p className={s.meta}>{[who, doneLine ?? (step.done ? j['person.done'] : j['person.waits'])].join(' · ')}</p>
        {!step.done && !step.canDone && step.who.kind === 'person' && <p className={s.meta}>{sayJob(j, 'person.notYours', { name: step.who.name })}</p>}
        {!step.done && step.canDone && way === 'not-built' && <p className={s.meta}>{j['person.notBuilt']}</p>}
        <Refusal code={act.refusal} language={language} />
      </div>
      {!step.done && step.canDone && way !== 'not-built' && <Button variant="quiet" disabled={act.busy} onClick={() => void mark()}>{j['person.done']}</Button>}
    </li>
  );
}

export function scheduleText(sc: Schedule, j: JobWords): string {
  if (sc.kind === 'interval') return sc.everyDays === null ? j['schedule.everyMs'] : sayJob(j, 'schedule.every', { n: sc.everyDays });
  const line = sayJob(j, sc.rule === 'month-end' ? 'schedule.monthEnd' : 'schedule.calendar', { at: sc.at ?? '', zone: sc.timeZone });
  return sc.paused ? `${line} · ${j['schedule.paused']}` : line;
}

function MissedRule({ id, current, rpc, w, j, language, onChanged }: { id: string; current: Missed; rpc: PlaceRpc; w: WorkWords; j: JobWords; language: Language; onChanged: () => void }) {
  const [rule, setRule] = useState<Missed>(current);
  const [saved, setSaved] = useState(false);
  const act = useAct(rpc);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const out = await act.run('approvals.setMissedRule', { id, rule }, missedSet);
    if (out.ok) { setSaved(true); onChanged(); }
  };
  return (
    <form className={s.form} onSubmit={e => void save(e)} aria-label={j['missed.change']}>
      <fieldset className={s.form}>
        <legend>{j['missed.change']}</legend>
        {(['run-once-on-wake', 'skip'] as const).map(m => (
          <label key={m}><span><input type="radio" name={`missed-rule-${id}`} checked={rule === m} onChange={() => setRule(m)} /> {w[`missed.${m}`]}</span></label>
        ))}
      </fieldset>
      <Actions><Button submit variant="quiet" disabled={act.busy || rule === current}>{j['missed.save']}</Button></Actions>
      {saved && <Note>{j['missed.after']}</Note>}
      <Refusal code={act.refusal} language={language} />
    </form>
  );
}

function EditForm({ card, rpc, w, j, language, onChanged }: { card: JobCard; rpc: PlaceRpc; w: WorkWords; j: JobWords; language: Language; onChanged: () => void }) {
  const first = 'minor' in card.budget ? paiseToRupees(card.budget.minor) : '';
  const [budget, setBudget] = useState(first);
  const [runs, setRuns] = useState(String(card.stopRule.maxRuns));
  const [missed, setMissed] = useState<Missed>(card.missedRun);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const act = useAct(rpc);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const config: Record<string, unknown> = {};
    if (budget.trim() !== first) { const minor = rupeesToPaise(budget); if (minor === null) { setProblem(w['start.budgetBad']); return; } config.budgetMinor = minor; }
    if (runs.trim() !== String(card.stopRule.maxRuns)) { if (!/^[1-9]\d{0,2}$/.test(runs.trim()) || Number(runs.trim()) > 366) { setProblem(w['start.runsBad']); return; } config.maxRuns = Number(runs.trim()); }
    if (missed !== card.missedRun) config.missedRun = missed;
    if (Object.keys(config).length === 0) { setProblem(j['edit.nothing']); return; }
    setProblem(null);
    const out = await act.run('approvals.editJob', { id: card.id, config }, edited);
    if (out.ok) { setDone(true); onChanged(); }
  };
  return (
    <form className={s.form} onSubmit={e => void submit(e)} aria-label={j['edit.title']}>
      <label>{w['start.budget']}<input inputMode="decimal" value={budget} onChange={e => setBudget(e.currentTarget.value)} /></label>
      <label>{w['start.maxRuns']}<input inputMode="numeric" value={runs} onChange={e => setRuns(e.currentTarget.value)} /></label>
      <fieldset className={s.form}>
        <legend>{w['start.missed']}</legend>
        {(['run-once-on-wake', 'skip'] as const).map(m => (
          <label key={m}><span><input type="radio" name={`edit-missed-${card.id}`} checked={missed === m} onChange={() => setMissed(m)} /> {w[`missed.${m}`]}</span></label>
        ))}
      </fieldset>
      <Note>{j['edit.note']}</Note>
      {problem !== null && <p role="alert">{problem}</p>}
      <Actions><Button submit variant="filled" disabled={act.busy}>{j['edit.save']}</Button></Actions>
      {done && <Note>{j['edit.done']}</Note>}
      <Refusal code={act.refusal} language={language} />
    </form>
  );
}

function DeleteJob({ id, way, rpc, j, language, onChanged }: { id: string; way: Manage['delete']; rpc: PlaceRpc; j: JobWords; language: Language; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const act = useAct(rpc);
  const yes = async () => {
    const out = await act.run('approvals.deleteJob', { id }, deleted);
    if (out.ok) { setAsking(false); setResult(out.value.state === 'deleted' ? j['delete.deleted'] : j['delete.cancelled']); onChanged(); }
  };
  if (result !== null) return <Note>{result}</Note>;
  return (
    <div className={s.form}>
      {!asking && <Actions><Button variant="link" danger onClick={() => setAsking(true)}>{j['delete.open']}</Button></Actions>}
      {asking && (
        <div role="alertdialog" aria-label={j['delete.ask']} className={s.form}>
          <p>{j['delete.ask']}</p>
          {way === 'cancel' && <Note>{j['delete.cancelNote']}</Note>}
          <Actions>
            <Button variant="filled" danger disabled={act.busy} onClick={() => void yes()}>{j['delete.yes']}</Button>
            <Button variant="quiet" onClick={() => setAsking(false)}>{j['delete.keep']}</Button>
          </Actions>
        </div>
      )}
      <Refusal code={act.refusal} language={language} />
    </div>
  );
}

/** Schedule, missed-run rule, Edit and Delete. Hidden controls for a seat that cannot change jobs. */
export function JobManage({ card, schedule, manage, canChange, rpc, w, j, language, onChanged }: {
  card: JobCard; schedule: Schedule | undefined; manage: Manage | undefined; canChange: boolean; rpc: PlaceRpc; w: WorkWords; j: JobWords; language: Language; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={s.block} data-job-manage="">
      <h3 className={s.h}>{j['schedule.title']}</h3>
      {schedule !== undefined && <p className={s.meta}>{scheduleText(schedule, j)}</p>}
      {canChange && manage !== undefined && (
        <>
          {manage.missedRule === 'not-built' ? <Note>{j['missed.notBuilt']}</Note>
            : <MissedRule id={card.id} current={card.missedRun} rpc={rpc} w={w} j={j} language={language} onChanged={onChanged} />}
          <h3 className={s.h}>{j['edit.title']}</h3>
          {manage.edit === 'not-built' ? <Note>{j['edit.notBuilt']}</Note>
            : editing ? <EditForm card={card} rpc={rpc} w={w} j={j} language={language} onChanged={onChanged} />
              : <Actions><Button variant="quiet" onClick={() => setEditing(true)}>{j['edit.open']}</Button></Actions>}
          <DeleteJob id={card.id} way={manage.delete} rpc={rpc} j={j} language={language} onChanged={onChanged} />
        </>
      )}
    </div>
  );
}
