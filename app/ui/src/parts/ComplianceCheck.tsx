import { useRef, useState } from 'react';
import { useT } from '../text';
import { useEngine, useResource } from '../engine/context';
import { Button } from './Button';
import { SizePicker, savedSize } from './SizePicker';
import type { ComplianceLite, SizeAnswersLite } from '../engine/types';
import s from './ComplianceCheck.module.css';
import { OptionRows } from './OptionRows';

export type SideWorkAnswer = 'allowed' | 'not-allowed' | 'not-sure';
/**
 * What the check hands back: the profession, the owner's answer, the digest of the words shown, whether it was recorded,
 * and the size ranges the owner picked (left out when the engine asked none, or none was picked).
 */
export type ComplianceAnswer = { profession: string; sideWork: SideWorkAnswer; digest: string; recorded: boolean; size?: SizeAnswersLite };

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
 *
 * W6 (founder, 3 November 2026): when a rule of the profession counts the business's size, the engine sends a size
 * question and the check shows its ranges (SizePicker) above the rules. Each sized rule carries the engine's verdict at
 * that size; a picked range is sent to venture.compliance.get as a preview, so the verdict follows the pick. The size is
 * optional, and Continue records (or hands back) the picked ranges with the side-work answer.
 */
export function ComplianceCheck({ profession, record = true, onDone, headingLevel = 3 }: {
  profession: string; record?: boolean; onDone?: (answer: ComplianceAnswer) => void;
  /** A5: the level of its one sub-heading, one below the page's (onboarding's step title is an h1, a Business tile's an h2). */
  headingLevel?: 2 | 3;
}) {
  const t = useT();
  const client = useEngine();
  const [picked, setPicked] = useState<SizeAnswersLite | null>(null);
  const view = useResource('venture.compliance.get', picked ? { profession, size: picked } : { profession });
  const [answer, setAnswer] = useState<SideWorkAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const data: ComplianceLite | undefined = view.data;

  /** A5 fix round 2: a second press while the first is on its way sends nothing. */
  const sending = useRef(false);
  async function done() {
    if (!data || !answer || sending.current) return;
    sending.current = true;
    setBusy(true);
    setProblem(null);
    const size = data.size && picked ? { size: picked } : {};
    try {
      if (record) await client.request('venture.compliance.set', { profession: data.profession.id, sideWork: answer, digest: data.digest, ...size });
      onDone?.({ profession: data.profession.id, sideWork: answer, digest: data.digest, recorded: record, ...size });
    } catch (error) {
      setProblem(t('compliance.failed', { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (view.error && !data) return <p className={s.problem} role="alert">{t('compliance.failed', { message: view.error.message })}</p>;
  if (!data) return <p className={s.note}>{t('compliance.loading')}</p>;
  const own = data.hardStops;
  return (
    <section className={s.check} aria-label={t('compliance.title')} data-compliance={data.profession.id}>
      <OptionRows legend={data.question} legendClassName={s.question} value={answer} options={ANSWERS.map((value) => ({ id: value, label: t(`compliance.answer.${value}`) }))} onChange={setAnswer} />
      <p className={s.note}>{data.responsibility}</p>
      {data.size && <SizePicker ask={data.size} value={picked ?? savedSize(data.size)} disabled={busy} onChange={setPicked} />}
      {data.rules.length > 0 && (
        <ul className={s.list} aria-label={t('compliance.rules')}>
          {data.rules.map((rule) => (
            <li key={rule.id} data-profession-rule={rule.id}>
              {rule.line}
              {!rule.checked && <> <span className={s.tag}>{t('compliance.unchecked')}</span></>}
              {/* W6 6E6: a statute read on its official page links that page, with the day it was read. */}
              {rule.checked && rule.source && rule.checkedDay && <> <a className={s.source} href={rule.source.url} target="_blank" rel="noopener noreferrer">{t('compliance.source', { day: rule.checkedDay })}</a></>}
              {/* W6 F4: what the statute's size counts (turnover, headcount or both) with its figure, in the engine's words. */}
              {rule.size && <span className={s.size} data-statute-size="">{rule.size}</span>}
              {/* W6 (3 November 2026): what applies at the owner's size, or how to find out, in the engine's words. */}
              {rule.verdict && <span className={s.verdict} data-size-verdict="">{rule.verdict}</span>}
            </li>
          ))}
        </ul>
      )}
      {data.switchedOff.length > 0 && (
        <>
          {headingLevel === 2 ? <h2 className={s.subheading}>{t('compliance.off')}</h2> : <h3 className={s.subheading}>{t('compliance.off')}</h3>}
          <ul className={s.list}>{data.switchedOff.map((item) => <li key={item.tool} data-switched-off={item.tool}>{item.line}</li>)}</ul>
        </>
      )}
      {own.length > 0 && <ul className={s.list} aria-label={t('compliance.stops')}>{own.map((stop) => <li key={stop.id}>{stop.line}</li>)}</ul>}
      <div className={s.buttons}>
        <Button variant="primary" disabled={busy} locked={!answer} lockedReason={t('compliance.answerFirst')} onClick={() => void done()}>{t('compliance.continue')}</Button>
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </section>
  );
}

