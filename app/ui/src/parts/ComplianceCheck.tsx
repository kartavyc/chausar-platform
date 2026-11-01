import { useId, useState } from 'react';
import { useT } from '../text';
import { useEngine, useResource } from '../engine/context';
import { Button } from './Button';
import type { ComplianceLite } from '../engine/types';
import s from './ComplianceCheck.module.css';

export type SideWorkAnswer = 'allowed' | 'not-allowed' | 'not-sure';
/** What the check hands back: the profession, the owner's answer, the digest of the words shown, and whether it was recorded. */
export type ComplianceAnswer = { profession: string; sideWork: SideWorkAnswer; digest: string; recorded: boolean };

const ANSWERS: readonly SideWorkAnswer[] = ['allowed', 'not-allowed', 'not-sure'];

/**
 * The day-job and compliance check (wave 6, 6C6 / D5, D21), for onboarding to mount when the profession is picked.
 * It reads venture.compliance.get { profession } (answered before any business exists too): the side-work question,
 * the line that this is the owner's responsibility, the profession's rules (each marked when it is not yet checked
 * against its official page), what its regulator switches off, and the profession's own hard stops (all of them are on
 * Business > Your rules). Continue stays
 * locked until the owner answers. With record (the default) and a business open, Continue records the answer through
 * venture.compliance.set; with record false (before the business exists) it only hands the answer back, and onboarding
 * records it once the business is created. Every line is the engine's.
 */
export function ComplianceCheck({ profession, record = true, onDone }: { profession: string; record?: boolean; onDone?: (answer: ComplianceAnswer) => void }) {
  const t = useT();
  const client = useEngine();
  const view = useResource('venture.compliance.get', { profession });
  const [answer, setAnswer] = useState<SideWorkAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const name = useId();
  const noteId = useId();
  const data: ComplianceLite | undefined = view.data;

  async function done() {
    if (!data || !answer) return;
    setBusy(true);
    setProblem(null);
    try {
      if (record) await client.request('venture.compliance.set', { profession: data.profession.id, sideWork: answer, digest: data.digest });
      onDone?.({ profession: data.profession.id, sideWork: answer, digest: data.digest, recorded: record });
    } catch (error) {
      setProblem(t('compliance.failed', { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  }

  if (view.error && !data) return <p className={s.problem} role="alert">{t('compliance.failed', { message: view.error.message })}</p>;
  if (!data) return <p className={s.note}>{t('compliance.loading')}</p>;
  const own = data.hardStops;
  return (
    <section className={s.check} aria-label={t('compliance.title')} data-compliance={data.profession.id}>
      <fieldset className={s.choices}>
        <legend className={s.question}>{data.question}</legend>
        {ANSWERS.map((value) => (
          <label key={value} className={s.choice}>
            <input type="radio" name={name} value={value} checked={answer === value} onChange={() => setAnswer(value)} /> {t(`compliance.answer.${value}`)}
          </label>
        ))}
      </fieldset>
      <p className={s.note}>{data.responsibility}</p>
      {data.rules.length > 0 && (
        <ul className={s.list} aria-label={t('compliance.rules')}>
          {data.rules.map((rule) => (
            <li key={rule.id} data-profession-rule={rule.id}>
              {rule.line}
              {!rule.checked && <> <span className={s.tag}>{t('compliance.unchecked')}</span></>}
            </li>
          ))}
        </ul>
      )}
      {data.switchedOff.length > 0 && (
        <>
          <h3 className={s.subheading}>{t('compliance.off')}</h3>
          <ul className={s.list}>{data.switchedOff.map((item) => <li key={item.tool} data-switched-off={item.tool}>{item.line}</li>)}</ul>
        </>
      )}
      {own.length > 0 && <ul className={s.list} aria-label={t('compliance.stops')}>{own.map((stop) => <li key={stop.id}>{stop.line}</li>)}</ul>}
      <div className={s.buttons}>
        <Button variant="primary" disabled={busy} locked={!answer} lockedReason={t('compliance.answerFirst')} lockedNoteId={noteId} onClick={() => void done()}>{t('compliance.continue')}</Button>
      </div>
      {!answer && <p className={s.note} id={noteId}>{t('compliance.answerFirst')}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </section>
  );
}

