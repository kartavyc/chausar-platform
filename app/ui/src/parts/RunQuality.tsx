import { Fragment, useEffect, useId, useState, type ReactNode } from 'react';
import { useT, type T } from '../text';
import { useClock } from '../shell/clock';
import { Count } from './Figure';
import { StateChip } from './Chip';
import { stateText } from './states';
import type { CoverageView, DeliverableReport, ReportItem, RunDetail } from '../engine/types';
import s from './RunQuality.module.css';

/**
 * The run sheet's quality lines (W4 4J22a, from 4J13 and 4J14; catalogue Q6, Q7, Q8, A13, H34), each drawn only from
 * what the engine sends and worded by the screen from its codes: coverage as a fraction counted by code, the checks
 * that could not run, the outcome of a run that acted outside, the draft's three-column report in a fold, a question's
 * expiry, and a run Chausar was interrupted in. The engine's own lines show beside the words as its words.
 */

/** A count as the app writes counts (Indian grouping, the same in both languages). */
const counted = (n: number) => n.toLocaleString('en-IN');
const MARK_DONE = '\u0001';
const MARK_TOTAL = '\u0002';

/**
 * What was counted and what was done to it ("lines matched"). An items count names the units it adds up (CoverageView.units),
 * so it reads "rows and pages read", never a bare "items".
 */
function whatOf(t: T, cover: CoverageView): string {
  const units = cover.unit === 'items' ? cover.units ?? [] : [];
  if (units.length === 0) return t(`runsheet.what.${cover.unit}.${cover.verb}`);
  const named = units.map((unit) => t(`runsheet.unit.${unit}`));
  const list = named.length === 1 ? named[0]! : t('runsheet.and', { first: named.slice(0, -1).join(', '), last: named.at(-1)! });
  return t('runsheet.whatOf', { units: list, verb: t(`runsheet.verb.${cover.verb}`) });
}

/** "1,204 of 1,210 lines matched": the template in the reader's language, the two counts as Counts. */
function fraction(t: T, cover: CoverageView): ReactNode {
  const what = whatOf(t, cover);
  if (cover.done === null || cover.total === null) {
    const words = t('runsheet.coverage.none', { what });
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  const done = counted(cover.done), total = counted(cover.total);
  return t('runsheet.coverage', { done: MARK_DONE, total: MARK_TOTAL, what }).split(/([\u0001\u0002])/).map((part, i) => (
    part === MARK_DONE ? <Count key={i} value={done} /> : part === MARK_TOTAL ? <Count key={i} value={total} /> : <Fragment key={i}>{part}</Fragment>
  ));
}

/** Coverage on the run's steps, fraction first; partial unless code saw it complete. */
export function RunCoverage({ run }: { run: RunDetail }) {
  const t = useT();
  const notRunId = useId();
  const covers = run.steps.flatMap((step) => (step.coverage ? [step.coverage] : []));
  const notRun = run.steps.flatMap((step) => step.notRun ?? []);
  if (covers.length === 0 && notRun.length === 0) return null;
  return (
    <div className={s.block}>
      {covers.map((cover, i) => (
        <p key={i} className={s.coverage} data-coverage="">
          {fraction(t, cover)}
          {!cover.complete && <>{' · '}<span className={s.partial}>{t('runsheet.partial')}</span></>}
        </p>
      ))}
      {notRun.length > 0 && (
        <section aria-labelledby={notRunId}>
          <h3 id={notRunId} className={s.small}>{t('runsheet.notRun')}</h3>
          <ul className={s.list}>{notRun.map((item) => <li key={item.id}>{item.line}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

/** A run that acted outside: Success only when a code check of the real result passed (the engine decides). */
export function RunOutcome({ run }: { run: RunDetail }) {
  if (!run.outcome) return null;
  return (
    <p className={s.outcome} data-outcome="">
      <StateChip kind="outcome" value={run.outcome.outcome} />
      <span className={s.sep} aria-hidden="true">{' · '}</span>
      <span>{run.outcome.line}</span>
    </p>
  );
}

/** One report item: the screen's word for its outcome (or the judgment, for a judged rule), then the engine detail. */
function itemWords(t: T, item: ReportItem, judged: boolean): string {
  const word = judged && item.judgment ? stateText(t, 'judgment', item.judgment) : stateText(t, 'check', item.outcome);
  const said = t('runsheet.report.item', { word, detail: item.detail });
  return item.drop ? `${said} ${item.drop}` : said;
}

/** The draft's report in a fold: the verdict in the summary, then measured, looked at and needs you. */
export function RunReport({ report }: { report: DeliverableReport }) {
  const t = useT();
  const verdict = report.verdict ? stateText(t, 'verdict', report.verdict) : t('runsheet.report.incomplete');
  const columns: { id: string; title: string; items: string[] }[] = [
    { id: 'measured', title: t('runsheet.report.measured'), items: report.measured.map((item) => itemWords(t, item, false)) },
    { id: 'looked-at', title: t('runsheet.report.lookedAt'), items: report.lookedAt.map((item) => itemWords(t, item, true)) },
    { id: 'needs-you', title: t('runsheet.report.needsYou'), items: report.needsHuman.map((item) => item.line) },
  ];
  return (
    <details className={s.fold} data-fold="report">
      <summary>{t('runsheet.report', { verdict })}</summary>
      {!report.review.complete && <p className={s.note} data-review="">{t('runsheet.report.reviewIncomplete')}</p>}
      {report.stale && <p className={s.note} data-stale="">{t('runsheet.report.stale')}</p>}
      <div className={s.columns} data-report="">
        {columns.map((column) => (
          <section key={column.id} className={s.column} data-column={column.id}>
            <h3 className={s.small}>{column.title}</h3>
            {column.items.length === 0 ? <p className={s.quiet}>{t('runsheet.report.none')}</p> : (
              <ul className={s.list}>{column.items.map((words, i) => <li key={i}>{words}</li>)}</ul>
            )}
          </section>
        ))}
      </div>
      {report.findings.length > 0 && (
        <ul className={s.list}>
          {report.findings.map((finding) => (
            <li key={`${finding.class}:${finding.id}`} data-finding="">{t('runsheet.report.item', { word: stateText(t, 'finding', finding.class), detail: finding.line })}</li>
          ))}
        </ul>
      )}
      <p className={s.quiet}>{t(report.generatedBy.includes('judge') ? 'runsheet.report.byBoth' : 'runsheet.report.byCode')}</p>
    </details>
  );
}

/** "Expires in 3 h" from the question's own end (Today's row meta), read against the app's clock. */
export function QuestionExpiry({ at }: { at: string | undefined }) {
  const t = useT();
  const clock = useClock();
  // Read again on the minute while the sheet is open, so the hours and minutes left stay true (a timer, not motion).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!at) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, [at]);
  if (!at) return null;
  const left = Date.parse(at) - clock().getTime();
  if (Number.isNaN(left)) return null;
  const minutes = Math.ceil(left / 60_000);
  const words = left <= 0 ? t('runsheet.expired') : minutes < 60 ? t('runsheet.expiresMin', { n: minutes }) : t('runsheet.expires', { n: Math.round(minutes / 60) });
  return <p className={s.expiry} data-expiry="">{words}</p>;
}

/** A run Chausar stopped while a step was out (4J13 leases): nothing went out twice. A stopped run's note says it. */
export function RunInterrupted({ run }: { run: RunDetail }) {
  const t = useT();
  if (!run.interrupted || run.stop) return null;
  return <p className={s.interrupted} data-interrupted="">{t('runsheet.interrupted')}</p>;
}

/** Everything above in the run sheet's order, after the Delivered card. */
export function RunQuality({ run }: { run: RunDetail }) {
  return (
    <>
      <RunInterrupted run={run} />
      <RunCoverage run={run} />
      <RunOutcome run={run} />
      {run.report && <RunReport report={run.report} />}
    </>
  );
}
