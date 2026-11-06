import { useState } from 'react';
import { useLanguage, useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { ModelEstimate } from '../../parts/ModelEstimate';
import type { DrillRunView, ImprovementRunLite } from '../../engine/types';
import { TileSection, dayOf, messageOf } from './shared';
import s from './Business.module.css';

/** The newest drill run in one line: passed or failed, how many were stopped, and the playbook version it ran on. */
function summaryOf(run: DrillRunView, t: T): string {
  const total = run.results.length;
  const stopped = run.results.filter((item) => item.stopped).length;
  const twins = run.results.filter((item) => item.twinPassed).length;
  const word = t(run.passed ? 'business.practice.drills.passed' : 'business.practice.drills.failed');
  const counts = twins === total
    ? t('business.practice.drills.counts', { stopped, total })
    : t('business.practice.drills.countsTwins', { stopped, total, twins });
  const version = run.version === null ? t('business.practice.drills.versionGone') : t('business.practice.drills.version', { version: run.version });
  return `${word}: ${counts} ${version}`;
}

/**
 * Drills on Business > Practice (W4 4J22a, from 4J15's venture.drills.*; catalogue Q9): each guard tried with practice
 * cases against the playbook version in use (a payment at auto, a send without approval, an older version's approval,
 * an unpriced model, instructions planted in an email and a ledger note), with a harmless twin that must go through.
 * The newest run in one line, any drill that got through named at rest, and every result in the engine's words one
 * step away. No result line names an amount (the ledger drill says only that the totals agree).
 */
export function Drills() {
  const t = useT();
  const language = useLanguage();
  const client = useEngine();
  const list = useResource('venture.drills.list', {});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setProblem(null);
    try { await client.request('venture.drills.run', {}); } catch (error) {
      setProblem(t('business.practice.drills.runFailed', { message: messageOf(error) }));
    } finally { setBusy(false); list.reload(); }
  }

  const newest = list.data?.runs[0];
  const failed = newest?.results.filter((item) => !item.stopped || !item.twinPassed) ?? [];
  return (
    <TileSection title={t('business.practice.drills')}>
      <p className={s.line}>{t('business.practice.drills.lead')}</p>
      {list.error && !list.data && <p className={s.problem} role="alert">{t('business.failed', { message: list.error.message })}</p>}
      {list.data && !newest && <p className={s.note}>{t('business.practice.drills.none')}</p>}
      {newest && (
        <div className={s.foldBody} data-drill-run={newest.id}>
          <p className={s.strong} data-drill-summary="">{summaryOf(newest, t)}</p>
          <p className={s.note}>{t('business.practice.drills.when', { day: dayOf(newest.at, language) })}</p>
          {failed.map((item, i) => <p key={i} className={s.problem} data-drill-failed="">{t('business.practice.drills.item', { drill: item.drill, line: item.line })}</p>)}
          <details className={s.fold} data-fold="drills">
            <summary>{t('business.practice.drills.each')}</summary>
            <ul className={s.log}>
              {newest.results.map((item, i) => <li key={i}>{t('business.practice.drills.item', { drill: item.drill, line: item.line })}</li>)}
            </ul>
          </details>
        </div>
      )}
      <div className={s.buttons}>
        <Button disabled={busy} aria-busy={busy || undefined} onClick={() => void run()}>{busy ? t('business.practice.drills.running') : t('business.practice.drills.run')}</Button>
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </TileSection>
  );
}

/**
 * Each change the improvement loop tried on its newest run, as an experiment (W4 4J22a, from 4J16; catalogue Q16): the
 * idea in the model's own words (quoted), the change, and what the control showed, in the engine's words after the
 * screen's word for the kind of result. The budget the engine sends has no receipt, so it is not shown here.
 */
export function Experiments({ run }: { run: ImprovementRunLite | null }) {
  const t = useT();
  const tried = (run?.rounds ?? []).flatMap((round) => (round.experiment ? [{ round: round.round, experiment: round.experiment }] : []));
  if (tried.length === 0) return null;
  return (
    <details className={s.fold} data-fold="experiments">
      <summary>{t('business.practice.tried')}</summary>
      <ul className={s.log}>
        {tried.map(({ round, experiment }) => (
          <li key={round} data-experiment="">
            <q data-content="">{experiment.hypothesis}</q>{' '}
            {/* The change once: a kept version already lists it under what the new version changes. */}
            {!run!.changes.includes(experiment.change) && <><span>{experiment.change}</span>{' '}</>}
            <span>{t('business.practice.tried.result', { word: t(`business.practice.tried.${experiment.result.kind}`), line: experiment.result.line })}</span>
            {/* 4J15's lift on the same paired cases, in the engine's words; a model judged the cases, so a conclusion is a model estimate. */}
            {experiment.lift && (
              <>
                {' '}
                <span data-lift="">{t('business.practice.tried.lift', { line: experiment.lift.line })}{experiment.lift.estimate && experiment.lift.reachable && <>{' '}<ModelEstimate /></>}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
