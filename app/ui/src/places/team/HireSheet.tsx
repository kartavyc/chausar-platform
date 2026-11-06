import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Sheet } from '../../parts/Sheet';
import { Field } from '../../parts/Field';
import { Button } from '../../parts/Button';
import { EngineError, type HireViewLite } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { Fold } from '../../parts/Fold';
import { Select } from '../../parts/Select';
import s from './Team.module.css';

const DEPT_KEY: Readonly<Record<string, string>> = { sales: 'dept.sales', marketing: 'dept.mkt', production: 'dept.prod', money: 'dept.money', operations: 'dept.ops' };


/**
 * Team > Hire one more agent (C7 task 16; REPORT row 56): the sentence, then one step at a time, each showing only its own
 * fields for the owner to change, then the card of what it does, what it reads and what it never does, with one primary:
 * Hire. A refusal (a hard stop, a duty that acts without the owner) shows the engine's words beside the field. The engine
 * checks every edit again; whatever a hired agent's duties say, anything outward still waits for the owner's approval.
 */
export function HireSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const client = useEngine();
  const [sentence, setSentence] = useState('');
  const [hire, setHire] = useState<HireViewLite | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [hiredName, setHiredName] = useState<string | null>(null);

  async function run(work: () => Promise<HireViewLite>) {
    setBusy(true); setProblem(null);
    try { setHire(await work()); setEdits({}); } catch (error) { setProblem(error instanceof EngineError ? error.message : messageOf(error)); } finally { setBusy(false); }
  }
  function roleEdits() {
    const out: Record<string, unknown> = {};
    if (edits.name !== undefined) out.name = edits.name;
    if (edits.job !== undefined) out.job = edits.job;
    if (edits.duties !== undefined) out.duties = edits.duties.split('\n').map((line) => line.trim()).filter(Boolean);
    return out;
  }
  const answer = (changes: Record<string, unknown>) => run(() => client.request('venture.agents.hire.answer', { hireId: hire!.id, phase: hire!.phase, edits: changes }));
  async function confirm() {
    setBusy(true); setProblem(null);
    try { const done = await client.request('venture.agents.hire.confirm', { hireId: hire!.id, digest: hire!.digest }); setHiredName(done.role?.name ?? ''); }
    catch (error) { setProblem(messageOf(error)); } finally { setBusy(false); }
  }
  const submitSentence = (event: FormEvent) => { event.preventDefault(); void run(() => client.request('venture.agents.hire.start', { sentence: sentence.trim() })); };
  const problemLine = problem && <p className={s.hireProblem} role="alert" data-hire-problem="">{problem}</p>;

  let body;
  if (hiredName !== null) {
    body = <p role="status" className={s.hireLine}>{t('team.hire.done', { name: hiredName })}</p>;
  } else if (!hire) {
    body = (
      <form className={s.hireForm} onSubmit={submitSentence} data-hire-step="sentence">
        <Field multiline rows={3} label={t('team.hire.sentence')} hint={t('team.hire.sentenceHint')} value={sentence} maxLength={400} onChange={(event) => setSentence(event.currentTarget.value)} />
        {problemLine}
        <div><Button type="submit" variant="primary" disabled={busy || sentence.trim().length < 3}>{t('team.hire.next')}</Button></div>
      </form>
    );
  } else if (hire.phase === 'role') {
    body = (
      <div className={s.hireForm} data-hire-step="role">
        <Field label={t('team.hire.name')} value={edits.name ?? hire.role?.name ?? ''} maxLength={40} onChange={(event) => setEdits({ ...edits, name: event.currentTarget.value })} />
        <Field label={t('team.hire.job')} value={edits.job ?? hire.role?.job ?? ''} maxLength={120} onChange={(event) => setEdits({ ...edits, job: event.currentTarget.value })} />
        <Field multiline rows={4} label={t('team.hire.duties')} hint={t('team.hire.dutiesHint')} value={edits.duties ?? (hire.role?.duties ?? []).join('\n')} onChange={(event) => setEdits({ ...edits, duties: event.currentTarget.value })} />
        {problemLine}
        <div><Button variant="primary" disabled={busy} onClick={() => void answer(roleEdits())}>{t('team.hire.next')}</Button></div>
      </div>
    );
  } else if (hire.phase === 'reads') {
    const chosen = new Set(hire.reads.map((item) => item.read));
    const toggle = (read: string) => setHire({ ...hire, reads: chosen.has(read) ? hire.reads.filter((item) => item.read !== read) : [...hire.reads, { read, why: '' }] });
    body = (
      <div className={s.hireForm} data-hire-step="reads">
        <fieldset className={s.hireReads}>
          <legend>{t('team.hire.reads')}</legend>
          {hire.choices.map((read) => (
            <label key={read}><input type="checkbox" checked={chosen.has(read)} onChange={() => toggle(read)} /> {t(`team.hire.read.${read}`)}</label>
          ))}
        </fieldset>
        <label className={s.hireSelect}>{t('team.hire.department')}
          <Select value={edits.department ?? hire.department} onChange={(event) => setEdits({ ...edits, department: event.currentTarget.value })}>
            {hire.departments.map((id) => <option key={id} value={id}>{t(DEPT_KEY[id] ?? 'dept.ops')}</option>)}
          </Select>
        </label>
        {problemLine}
        <div><Button variant="primary" disabled={busy} onClick={() => void answer({ reads: hire.reads, department: edits.department ?? hire.department })}>{t('team.hire.next')}</Button></div>
      </div>
    );
  } else if (hire.phase === 'voice') {
    body = (
      <div className={s.hireForm} data-hire-step="voice">
        <Field label={t('team.hire.tone')} value={edits.tone ?? hire.voice?.tone ?? ''} maxLength={160} onChange={(event) => setEdits({ ...edits, tone: event.currentTarget.value })} />
        {problemLine}
        <div><Button variant="primary" disabled={busy} onClick={() => void answer(edits.tone !== undefined ? { voice: { ...hire.voice, tone: edits.tone } } : {})}>{t('team.hire.next')}</Button></div>
      </div>
    );
  } else {
    body = (
      <div className={s.hireForm} data-hire-step="review">
        <h3 className={s.hireHead}>{hire.role?.name}</h3>
        <p className={s.hireLine}>{hire.role?.job}</p>
        <h4 className={s.hireHead}>{t('team.hire.does')}</h4>
        <ul className={s.hireList}>{hire.card?.does.map((line) => <li key={line} data-content="">{line}</li>)}</ul>
        <h4 className={s.hireHead}>{t('team.hire.readsCard')}</h4>
        <ul className={s.hireList}>{hire.card?.reads.map((item) => <li key={item.read}>{t(`team.hire.read.${item.read}`)}</li>)}</ul>
        <Fold summary={t('team.hire.never')} className={s.hireFold}>
          <ul className={s.hireList}>{hire.card?.never.map((line) => <li key={line}>{line}</li>)}</ul>
        </Fold>
        <p className={s.hireLine}>{hire.card?.asks}</p>
        {problemLine}
        <div><Button variant="primary" disabled={busy} onClick={() => void confirm()}>{t('team.hire.hire')}</Button></div>
      </div>
    );
  }
  return <Sheet label={t('team.hire.label')} title={t('team.addAgent')} onClose={onClose} returnFocus={returnFocus}>{body}</Sheet>;
}
