/**
 * Jobs (WK-07): what runs on its own, proposed jobs first. A job (WK-08) opens to its four
 * facts, its card (WK-09, with the missed-run rule of WK-11), its time line with the cost
 * of each step, and its result (WK-10): Accept, or Send back with a sentence. Changes go
 * through the core jobs.* methods.
 */
import { useState, type FormEvent } from 'react';
import type { RowItem } from '../../app/presentation.ts';
import { State } from '../../patterns/States';
import { Sheet, type SheetPrimary } from '../../parts/Sheet';
import { KeyValue, type Pair } from '../../parts/KeyValue';
import { RowList } from '../../parts/RowList';
import { useAct, useReply } from './kit/reply.ts';
import { amountText, dayTime } from './kit/format.ts';
import { Actions, Button, Note, Refusal, pageStyles } from './kit/Page';
import { accepted, jobs, type JobMeters, type JobRow } from './contract.ts';
import { StartJobSheet } from './StartJob.tsx';
import type { Language } from '../../app/presentation.ts';
import type { WorkWords } from './text.ts';
import { missingWord } from './kit/words.ts';
import { JobCardView, jobFacts } from './JobCard.tsx';
import { useSheet } from './Actions.tsx';
import { Frame, money, say, type WorkProps } from './shared.tsx';
import { isPersonStep, jobSheet } from './contract-jobs.ts';
import { jobWords } from './text-jobs.ts';
import { JobManage, PersonStepRow } from './JobManage.tsx';
import { MeasureChart } from './parts/MeasureChart.tsx';
import s from './work.module.css';

/** Proposed jobs first; the engine's order is kept otherwise. */
export function proposedFirst(rows: readonly JobRow[]): JobRow[] {
  return [...rows.filter(r => r.state === 'proposed'), ...rows.filter(r => r.state !== 'proposed')];
}

/** The address sheet that opens the Start a job sheet. Engine job ids never take this form. */
export const START_SHEET = 'start';

/** WK-08: model use with its route (or no model), clock time, effect exposure. Missing is words. */
export function meterPairs(m: JobMeters, w: WorkWords, language: Language): Pair[] {
  const spent = amountText(m.model.spent, language), budget = amountText(m.model.budget, language);
  const model = m.model.route === null ? say(w, 'm.noModel', { spent, budget }) : say(w, 'm.modelLine', { spent, budget, route: m.model.route });
  return [
    { name: w['m.model'], value: m.model.estimate ? `${model} (${w['m.estimate']})` : model, mono: true },
    { name: w['m.clock'], value: 'minutes' in m.clock ? say(w, 'm.minutes', { n: m.clock.minutes }) : missingWord(m.clock.missing, language), mono: true },
    { name: w['m.exposure'], value: amountText(m.exposure, language), mono: true },
  ];
}

function JobSheet({ p, row, id, origin, onClose, onChanged }: { p: WorkProps; row: JobRow | undefined; id: string; origin: HTMLElement | null; onClose: () => void; onChanged: () => void }) {
  const { w, language, view } = p;
  const [tick, setTick] = useState(0);
  const { loaded, reload } = useReply(p.host, 'approvals.job', { id }, jobSheet, String(tick));
  const jw = jobWords(language);
  const owns = !p.viewer && (p.member.role === 'owner' || p.member.role === 'cofounder');
  const act = useAct(p.rpc);
  const [reason, setReason] = useState('');
  if (loaded.phase !== 'ready') {
    return (
      <Sheet kind={w['job.kind']} title={row?.goal ?? w['job.kind']} onClose={onClose} origin={origin}>
        <State state={loaded.phase === 'refused' ? loaded.state : { kind: 'loading' }} action={loaded.phase === 'refused' ? { label: w.checkAgain, onPress: reload } : undefined} />
      </Sheet>
    );
  }
  const j = loaded.value;
  const can = (what: JobRow['can'][number]) => !p.viewer && row !== undefined && row.can.includes(what);
  const run = async (method: string, payload: Record<string, unknown>) => {
    const out = await act.run(method, payload, accepted);
    if (out.ok) { setTick(n => n + 1); onChanged(); }
  };
  const sendBack = (event: FormEvent) => { event.preventDefault(); if (reason.trim().length > 0) void run('jobs.reject', { id: j.id, reason }); };
  const primary: SheetPrimary | undefined = can('approve') ? { label: w.approveJob, onPress: () => void run('jobs.approve', { id: j.id, digest: j.digest }), disabled: act.busy }
    : can('accept') && j.result !== null ? { label: w.accept, onPress: () => void run('jobs.accept', { id: j.id }), disabled: act.busy } : undefined;
  const stateWord = row === undefined ? '' : w[`job.${row.state}`];

  return (
    <Sheet kind={w['job.kind']} title={j.goal} onClose={onClose} origin={origin} primary={primary}
      actions={<>
        {can('pause') && <Button variant="quiet" disabled={act.busy} onClick={() => void run('jobs.pause', { id: j.id })}>{w.pause}</Button>}
        {can('resume') && <Button variant="quiet" disabled={act.busy} onClick={() => void run('jobs.resume', { id: j.id })}>{w.resume}</Button>}
        {can('cancel') && <Button variant="link" danger disabled={act.busy} onClick={() => void run('jobs.cancel', { id: j.id })}>{w.cancelJob}</Button>}
      </>}>
      <KeyValue pairs={jobFacts(j, stateWord, w, language)} onReceipt={p.openReceipt} />
      {row?.reason != null && <Note>{row.reason}</Note>}
      {row?.resumesAt != null && <Note>{say(w, 'job.resumes', { when: dayTime(row.resumesAt, language) })}</Note>}
      {j.meters !== undefined && (
        <div className={s.block}>
          <h3 className={s.h}>{w.meters}</h3>
          <KeyValue pairs={meterPairs(j.meters, w, language)} onReceipt={p.openReceipt} />
        </div>
      )}
      <JobCardView card={j} w={w} language={language} onReceipt={p.openReceipt} simple={view === 'simple'} />
      {j.measure !== undefined && (
        <div className={s.block}>
          <h3 className={s.h}>{jw['measure.title']}</h3>
          {j.measure === null ? <Note>{jw['measure.none']}</Note> : <MeasureChart measure={j.measure} j={jw} language={language} onReceipt={p.openReceipt} />}
        </div>
      )}
      <JobManage card={j} schedule={j.schedule} manage={j.manage} canChange={owns && row !== undefined && !['cancelled', 'stopped', 'accepted'].includes(row.state)}
        rpc={p.rpc} w={w} j={jw} language={language} onChanged={() => { setTick(n => n + 1); onChanged(); }} />
      <div className={s.block}>
        <h3 className={s.h}>{w.timeline}</h3>
        {j.timeline.length === 0 ? <Note>{w['timeline.empty']}</Note> : (
          <ol className={s.list}>
            {j.timeline.map((st, i) => {
              if (isPersonStep(st)) {
                return <PersonStepRow key={`person-${st.stepId}`} step={st} jobId={j.id} j={jw} language={language} rpc={p.rpc} way={j.manage?.personStep} onDone={() => { setTick(n => n + 1); onChanged(); }} />;
              }
              const cost = money(st.amount, language);
              const meta = [dayTime(st.at, language), cost, st.needsModel === null ? null : st.needsModel ? w['needsModel.yes'] : w['needsModel.no'], st.reason];
              return (
                <li key={`${st.at}-${i}`} className={s.item}>
                  <div><span>{st.event}</span><p className={s.meta}>{meta.filter((m): m is string => m !== null).join(' · ')}</p></div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {j.result !== null && (
        <div className={s.block}>
          <h3 className={s.h}>{w.result}</h3>
          <p className={s.meta}>{w['result.done']}</p>
          <ul>{j.result.done.map((line, i) => <li key={i}>{line}</li>)}</ul>
          <p className={s.meta}>{w['result.open']}</p>
          <ul>{j.result.open.map((line, i) => <li key={i}>{line}</li>)}</ul>
          <Actions>{j.result.receiptIds.map((rid, i) => <Button key={rid} variant="link" onClick={() => p.openReceipt(rid)}>{say(w, 'result.receipt', { n: String(i + 1) })}</Button>)}</Actions>
          {can('reject') && (
            <form className={s.form} onSubmit={sendBack}>
              <label>{w['sendBack.field']}<input value={reason} onChange={e => setReason(e.currentTarget.value)} /></label>
              <Actions><Button submit variant="quiet" disabled={act.busy}>{w.sendBack}</Button></Actions>
            </form>
          )}
          <Note>{w.finishedNote}</Note>
        </div>
      )}
      <Refusal code={act.refusal} language={language} />
    </Sheet>
  );
}

export function JobsPage({ p }: { p: WorkProps }) {
  const { w, language, view } = p;
  const [tick, setTick] = useState(0);
  const { loaded, reload } = useReply(p.host, 'approvals.jobs', {}, jobs, String(tick));
  const sheet = useSheet(p, 'jobs');
  // Proposing a job creates it, which core allows only an owner or a cofounder.
  const canStart = !p.viewer && (p.member.role === 'owner' || p.member.role === 'cofounder');
  const starting = sheet.openId === START_SHEET;
  const cost = (r: JobRow) => say(w, 'job.cost', { spent: amountText(r.spent, language), budget: amountText(r.budget, language) });
  const when = (r: JobRow) => (r.nextRunAt === null ? null : say(w, 'job.next', { when: dayTime(r.nextRunAt, language) }));
  const toRow = (r: JobRow): RowItem => {
    const parts = view === 'simple' ? [w[`job.${r.state}`]]
      : [w[`job.${r.state}`], when(r), r.resumesAt === null ? null : say(w, 'job.resumes', { when: dayTime(r.resumesAt, language) }), r.reason];
    return { id: r.id, mark: r.state === 'proposed' || r.state === 'awaiting-acceptance' ? 'wait' : r.state === 'running' ? 'busy' : r.state === 'stopped-by-rule' || r.state === 'set-aside' || r.state === 'missed' ? 'unsure' : 'off',
      what: r.goal, note: parts.filter((x): x is string => x !== null).join(' · '), asWritten: cost(r) };
  };
  return (
    <Frame p={p} title={w['jobs.title']} loaded={loaded} reload={reload} count={j => String(j.items.length)}>
      {j => {
        const rows = proposedFirst(j.items);
        return (
          <div className={s.split} data-open={sheet.openId !== null ? '' : undefined}>
            <div className={s.pane}>
              {canStart && <Actions><Button variant="filled" onClick={e => sheet.open(START_SHEET, e.currentTarget)}>{w['jobs.start']}</Button></Actions>}
              {rows.length === 0 && <Note>{w['jobs.empty']}</Note>}
              {rows.length > 0 && view === 'books' && (
                <table className={[pageStyles.table, s.dense].join(' ')}>
                  <thead><tr>{(['col.job', 'col.state', 'col.nextRun', 'col.cost'] as const).map(k => <th key={k} scope="col">{w[k]}</th>)}</tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id}>
                        <td><button type="button" className={s.open} onClick={e => sheet.open(r.id, e.currentTarget)}>{r.goal}</button></td>
                        <td>{w[`job.${r.state}`]}{r.reason === null ? '' : ` · ${r.reason}`}</td>
                        <td className={s.fig}>{r.nextRunAt === null ? '' : dayTime(r.nextRunAt, language)}</td>
                        <td className={pageStyles.num}>{cost(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {rows.length > 0 && view !== 'books' && <RowList rows={rows.map(toRow)} selectedId={sheet.openId ?? undefined} onOpen={(id, el) => sheet.open(id, el)} onReceipt={p.openReceipt} />}
              <Note>{say(w, j.active >= j.limit ? 'jobs.atLimit' : 'jobs.active', { active: j.active, limit: j.limit })}</Note>
              {!j.proposals.available && <Note>{w['jobs.proposalsMissing']}</Note>}
            </div>
            {starting && canStart && <StartJobSheet p={p} origin={sheet.origin.current} onClose={sheet.close} />}
            {sheet.openId !== null && !starting && (
              <JobSheet key={sheet.openId} p={p} id={sheet.openId} row={j.items.find(r => r.id === sheet.openId)} origin={sheet.origin.current} onClose={sheet.close} onChanged={() => setTick(n => n + 1)} />
            )}
          </div>
        );
      }}
    </Frame>
  );
}
