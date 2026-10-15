/**
 * Proposing a job (WK-09): a sheet of ready-made jobs, each shown as its card (goal, how
 * you will know it is met, budget, stop rule, missed-run rule, actions, no AI model, this
 * computer). The person may change the budget, the most runs and the missed-run rule, then
 * Propose. Proposing does not start the job: the engine creates it waiting for approval and
 * the screen opens its approval sheet. "From one sentence" works only when installed.
 *
 * The budget is typed in rupees and turned into whole paise by text alone: no floats.
 */
import { useState, type FormEvent } from 'react';
import { State } from '../../patterns/States';
import { Sheet } from '../../parts/Sheet';
import { KeyValue, type Pair } from '../../parts/KeyValue';
import { useAct, useReply } from './kit/reply.ts';
import { amountText } from './kit/format.ts';
import { Actions, Button, Note, Refusal } from './kit/Page';
import { proposed, sheetOf, type JobTemplate } from './contract.ts';
import type { TemplateWithSchedule } from './contract-jobs.ts';
import { jobWords } from './text-jobs.ts';
import { say, type WorkProps } from './shared.tsx';
import type { WorkWords } from './text.ts';
import type { Language } from '../../app/presentation.ts';
import { Label } from '../../parts/Label';
import { templatesR4, type LaneList, type LaneTemplate } from './contract-r4.ts';
import { codeWords, r4Words, sayR4, type R4Words } from './text-r4.ts';
import type { MissedRun } from './contract-jobs.ts';
import s from './work.module.css';

/** Rupees as typed ("50", "50.5", "50.25") to whole paise as text. Null when it is not that shape or is zero. */
export function rupeesToPaise(typed: string): string | null {
  const match = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(typed.trim());
  if (!match) return null;
  const paise = `${match[1]}${(match[2] ?? '').padEnd(2, '0')}`.replace(/^0+/, '');
  return paise === '' ? null : paise;
}
/** Whole paise as text to rupees as text, for the field's first value ("5000" → "50", "5025" → "50.25"). */
export function paiseToRupees(minor: string): string {
  const padded = minor.padStart(3, '0');
  const rupees = padded.slice(0, -2).replace(/^0+(?=\d)/, ''); const paise = padded.slice(-2);
  return paise === '00' ? rupees : `${rupees}.${paise}`;
}

export function templatePairs(t: TemplateWithSchedule, w: WorkWords, language: Language): Pair[] {
  return [
    { name: w['f.goal'], value: t.goal },
    { name: w['f.doneWhen'], value: t.doneWhen },
    { name: w['start.every'], value: t.schedule === 'month-end' ? jobWords(language)['start.monthEnd'] : w[`every.${t.every}`] },
    { name: w['f.budget'], value: amountText(t.budget, language), mono: true },
    { name: w['f.stops'], value: say(w, 'start.stops', { runs: t.maxRuns, days: t.days }) },
    { name: w['f.missed'], value: w[`missed.${t.missedRun}`] },
    { name: w['f.actions'], value: t.actions.length > 0 ? t.actions.join(', ') : w['start.readsOnly'] },
    { name: w['f.runsOn'], value: `${w['start.noModel']}; ${w['start.runsHere']}` },
  ];
}

/** WK-09: one of jobs-ext's ready-made jobs as its card: goal, how you will know, budget, rounds, missed rule, actions, its steps. */
export function laneTemplatePairs(t: LaneTemplate, w: WorkWords, r: R4Words, language: Language): Pair[] {
  const j = jobWords(language);
  return [
    { name: w['f.goal'], value: t.goal },
    { name: w['f.doneWhen'], value: t.doneWhen },
    { name: w['start.every'], value: t.every === null ? r['lane.everyOther'] : w[`every.${t.every}`] },
    { name: w['f.budget'], value: amountText(t.budget, language), mono: true },
    { name: w['f.stops'], value: t.stepsPerDelivery > 1 ? sayR4(r, 'lane.rounds', { n: t.stepsPerDelivery }) : r['lane.round'] },
    { name: w['f.missed'], value: t.missedRun === 'run-all' ? j['missed.run-all'] : w[`missed.${t.missedRun}`] },
    { name: w['f.actions'], value: t.actions.length > 0 ? t.actions.join(', ') : w['start.readsOnly'] },
    { name: w['f.runsOn'], value: `${t.needsModel ? r['lane.needsModel'] : r['lane.noModel']}; ${w['start.runsHere']}` },
  ];
}

function LaneTemplateForm({ p, t, onProposed }: { p: WorkProps; t: LaneTemplate; onProposed: (id: string) => void }) {
  const { w, language } = p;
  const j = jobWords(language);
  const [budget, setBudget] = useState(paiseToRupees(t.budget.minor));
  const [missed, setMissed] = useState<MissedRun>(t.missedRun);
  const [problem, setProblem] = useState<string | null>(null);
  const act = useAct(p.rpc);
  // "Run every missed one" only for a job that delivers every run; daily rounds cannot all be caught up on one day.
  const choices: readonly MissedRun[] = t.stepsPerDelivery === 1 ? ['run-once-on-wake', 'skip', 'run-all'] : ['run-once-on-wake', 'skip'];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const budgetMinor = rupeesToPaise(budget);
    if (budgetMinor === null) { setProblem(w['start.budgetBad']); return; }
    setProblem(null);
    const out = await act.run('approvals.proposeJob', { laneTemplate: t.id, budgetMinor, missedRun: missed }, proposed);
    if (out.ok) onProposed(out.value.id);
  };
  return (
    <form className={s.form} onSubmit={e => void submit(e)} aria-label={t.title}>
      <label>{w['start.budget']}<input inputMode="decimal" value={budget} onChange={e => setBudget(e.currentTarget.value)} /></label>
      <p className={s.meta}>{say(w, 'start.budgetHint', { budget: amountText(t.budget, language) })}</p>
      <fieldset className={s.form}>
        <legend>{w['start.missed']}</legend>
        {choices.map(m => <label key={m}><span><input type="radio" name={`lane-missed-${t.id}`} checked={missed === m} onChange={() => setMissed(m)} /> {m === 'run-all' ? j['missed.run-all'] : w[`missed.${m}`]}</span></label>)}
      </fieldset>
      {problem !== null && <p role="alert">{problem}</p>}
      <Actions><Button submit variant="filled" disabled={act.busy}>{w['start.propose']}</Button></Actions>
      <Refusal code={act.refusal} language={language} />
    </form>
  );
}

/** WK-09: jobs-ext's ready-made jobs beside the core briefs. One that cannot start here says why. */
function LaneTemplates({ p, lane, chosen, onChoose, onProposed }: { p: WorkProps; lane: LaneList; chosen: string | null; onChoose: (id: string) => void; onProposed: (id: string) => void }) {
  const { w, language } = p;
  const r = r4Words(language);
  const j = jobWords(language);
  return (
    <div className={s.block} data-part="lane-templates">
      <h3 className={s.h}>{r['lane.title']}</h3>
      {!lane.available ? <Note>{r['lane.notBuilt']}</Note> : (
        <>
          <Note>{r['lane.note']}</Note>
          {lane.activeJobs !== null && lane.activeJobCap !== null && <p className={s.meta}>{sayR4(r, 'lane.active', { n: lane.activeJobs, cap: lane.activeJobCap })}</p>}
          {lane.templates.map(t => (
            <div key={t.id} className={s.block} data-lane-template={t.id}>
              <h4 className={s.h}>{t.title} {t.experimental && <Label kind="experimental" />}</h4>
              <KeyValue pairs={laneTemplatePairs(t, w, r, language)} onReceipt={p.openReceipt} />
              {p.view !== 'simple' && t.steps.length > 0 && (
                <ol className={s.list} aria-label={j['lane.steps']}>{t.steps.map((st, i) => <li key={`${i}-${st.title}`} className={s.item}><span>{st.title}</span><span className={s.meta}>{st.needsModel ? r['lane.needsModel'] : r['lane.noModel']}</span></li>)}</ol>
              )}
              {!t.available ? <Note>{`${r['lane.cannot']} ${codeWords(r, t.code ?? 'TEMPLATE_NOT_AVAILABLE')}`}</Note>
                : chosen === `lane:${t.id}` ? <LaneTemplateForm p={p} t={t} onProposed={onProposed} />
                  : <Actions><Button variant="quiet" onClick={() => onChoose(`lane:${t.id}`)}>{say(w, 'start.choose', { title: t.title })}</Button></Actions>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

type Schedule = 'month-end' | 'every-30-days';
function TemplateForm({ p, t, monthEnd, onProposed }: { p: WorkProps; t: TemplateWithSchedule; monthEnd: boolean; onProposed: (id: string) => void }) {
  const { w, language } = p;
  const jw = jobWords(language);
  const chooses = t.schedule === 'month-end';
  // Every 30 days is never chosen for the person: with no calendar, nothing is picked until they pick it.
  const [schedule, setSchedule] = useState<Schedule | null>(chooses && monthEnd ? 'month-end' : null);
  const [budget, setBudget] = useState(paiseToRupees(t.budget.minor));
  const [runs, setRuns] = useState(String(t.maxRuns));
  const [missed, setMissed] = useState<JobTemplate['missedRun']>(t.missedRun);
  const [problem, setProblem] = useState<string | null>(null);
  const act = useAct(p.rpc);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const budgetMinor = rupeesToPaise(budget);
    if (budgetMinor === null) { setProblem(w['start.budgetBad']); return; }
    if (!/^[1-9]\d{0,2}$/.test(runs.trim()) || Number(runs.trim()) > 366) { setProblem(w['start.runsBad']); return; }
    if (chooses && schedule === null) { setProblem(jw['start.monthEndMissing']); return; }
    setProblem(null);
    const out = await act.run('approvals.proposeJob', { templateId: t.id, budgetMinor, maxRuns: Number(runs.trim()), missedRun: missed, ...(chooses && schedule !== null ? { schedule } : {}) }, proposed);
    if (out.ok) onProposed(out.value.id);
  };
  return (
    <form className={s.form} onSubmit={e => void submit(e)} aria-label={t.title}>
      <label>{w['start.budget']}<input inputMode="decimal" value={budget} onChange={e => setBudget(e.currentTarget.value)} /></label>
      <p className={s.meta}>{say(w, 'start.budgetHint', { budget: amountText(t.budget, language) })}</p>
      {chooses && (
        <fieldset className={s.form}>
          <legend>{jw['start.schedule']}</legend>
          <label><span><input type="radio" name={`schedule-${t.id}`} disabled={!monthEnd} checked={schedule === 'month-end'} onChange={() => setSchedule('month-end')} /> {jw['start.monthEnd']}</span></label>
          <label><span><input type="radio" name={`schedule-${t.id}`} checked={schedule === 'every-30-days'} onChange={() => setSchedule('every-30-days')} /> {jw['start.every30']}</span></label>
          <p className={s.meta}>{monthEnd ? jw['start.monthEndNote'] : jw['start.monthEndMissing']}</p>
        </fieldset>
      )}
      <label>{w['start.maxRuns']}<input inputMode="numeric" value={runs} onChange={e => setRuns(e.currentTarget.value)} /></label>
      <fieldset className={s.form}>
        <legend>{w['start.missed']}</legend>
        {(['run-once-on-wake', 'skip'] as const).map(m => (
          <label key={m}><span><input type="radio" name={`missed-${t.id}`} checked={missed === m} onChange={() => setMissed(m)} /> {w[`missed.${m}`]}</span></label>
        ))}
      </fieldset>
      {problem !== null && <p role="alert">{problem}</p>}
      <Actions><Button submit variant="filled" disabled={act.busy}>{w['start.propose']}</Button></Actions>
      <Refusal code={act.refusal} language={language} />
    </form>
  );
}

function SentenceForm({ p, onProposed }: { p: WorkProps; onProposed: (id: string) => void }) {
  const [sentence, setSentence] = useState('');
  const act = useAct(p.rpc);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sentence.trim().length < 5) return;
    const out = await act.run('approvals.proposeJob', { sentence: sentence.trim() }, proposed);
    if (out.ok) onProposed(out.value.id);
  };
  return (
    <form className={s.form} onSubmit={e => void submit(e)}>
      <label>{p.w['start.sentenceField']}<input value={sentence} maxLength={500} onChange={e => setSentence(e.currentTarget.value)} /></label>
      <Actions><Button submit variant="quiet" disabled={act.busy}>{p.w['start.sentenceGo']}</Button></Actions>
      <Refusal code={act.refusal} language={p.language} />
    </form>
  );
}

export function StartJobSheet({ p, origin, onClose }: { p: WorkProps; origin: HTMLElement | null; onClose: () => void }) {
  const { w, language } = p;
  const { loaded, reload } = useReply(p.host, 'approvals.jobTemplates', {}, templatesR4);
  const [chosen, setChosen] = useState<string | null>(null);
  const open = (id: string) => p.navigate({ place: 'work', sub: 'approvals', sheet: sheetOf(id) });
  if (loaded.phase !== 'ready') {
    return (
      <Sheet kind={w['start.kind']} title={w['start.title']} onClose={onClose} origin={origin}>
        <State state={loaded.phase === 'refused' ? loaded.state : { kind: 'loading' }} action={loaded.phase === 'refused' ? { label: w.checkAgain, onPress: reload } : undefined} />
      </Sheet>
    );
  }
  const { templates, fromSentence, monthEnd, lane } = loaded.value;
  return (
    <Sheet kind={w['start.kind']} title={w['start.title']} onClose={onClose} origin={origin}>
      <Note>{w['start.note']}</Note>
      {templates.map(t => (
        <div key={t.id} className={s.block} data-template={t.id}>
          <h3 className={s.h}>{t.title}</h3>
          <KeyValue pairs={templatePairs(t, w, language)} onReceipt={p.openReceipt} />
          {chosen === t.id
            ? <TemplateForm p={p} t={t} monthEnd={monthEnd.available} onProposed={open} />
            : <Actions><Button variant="quiet" onClick={() => setChosen(t.id)}>{say(w, 'start.choose', { title: t.title })}</Button></Actions>}
        </div>
      ))}
      <LaneTemplates p={p} lane={lane} chosen={chosen} onChoose={setChosen} onProposed={open} />
      <div className={s.block}>
        <h3 className={s.h}>{w['start.sentence']}</h3>
        {fromSentence.available ? <SentenceForm p={p} onProposed={open} /> : <Note>{w['jobs.proposalsMissing']}</Note>}
      </div>
    </Sheet>
  );
}
