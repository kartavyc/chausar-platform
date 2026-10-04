/**
 * RetainedScenario (AS-11 on Ask, Saved; A9.1 one column per option): one saved what-if,
 * drawn only from the fresh checked `scenarios.reopen` view the host read for an exact
 * trusted pin. The label "What if" sits by the title; each column is a branch with its
 * assumption as before and after; each ready analysis shows the figures its embedded
 * receipt states, unchanged, and every figure opens that embedded receipt as its proof.
 * Rules kept here.
 * - Nothing is listed, searched, persisted or recomputed. With no host pin the page says
 *   plainly that saved what-ifs cannot be listed or opened here yet.
 * - A job that is pending, stale or running shows its state in words and no figure. Earlier
 *   retained runs are cued once for the whole view, in a few words, never drawn as a current
 *   figure; each exact run identity and explanation is in the provenance sheet. Missing is
 *   never zero.
 * - A historical revision stays historical: the current head is named beside it.
 * - The chart draws only the issued scenario outcome of each root analysis, with the
 *   receipt's own display string; nothing is derived. Without a comparable issued outcome
 *   there is no chart, in words. A mark names a receipt identity that belongs to exactly
 *   one embedded result, so it resolves to one exact run.
 * - At rest the page holds short revision, readiness, no-action and comparison cues (about
 *   forty words). Exact identities, dates, explanations, job, digest and comparison
 *   provenance open in the one sheet (`ScenarioProvenanceBody`).
 * - Every figure and provenance control names the exact checked view it was rendered for;
 *   a newer view published before React commits cannot be substituted into an old press.
 * - A refusal replaces the whole view; this screen keeps no copy of an earlier read.
 */

import { useId, type ReactNode } from 'react';
import type { ColumnsChart, ChartValue, Figure as AppFigure, FigureLabel } from '../../app/presentation.ts';
import { useT, type TextValues } from '../../app/text';
import { PageHeader } from '../../app/PageHeader';
import type { CalculationReceiptEvidence, EngineFigureEvidence } from '../../bridge/presentation.ts';
import type { RetainedScenarioState } from '../../host/retained-controller.ts';
import { isTransportUnavailable, scenarioColumns, scenarioOutcomeFigure } from '../../host/retained-contracts.ts';
import type { RetainedScenarioJobStatus, RetainedScenarioView, ScenarioColumn, ScenarioColumnEntry } from '../../host/retained-contracts.ts';
import { Button } from '../../parts/Button';
import { Label } from '../../parts/Label';
import { MissingWords } from '../../parts/Figure';
import { Square } from '../../parts/Square';
import { Columns } from '../../parts/charts/Columns';
import { State } from '../../patterns/States';
import s from './RetainedScenario.module.css';

export interface RetainedScenarioProps {
  state: RetainedScenarioState;
  /** Whether the trusted host supplied an exact scenario pin for this mount at all. */
  selectionSupplied: boolean;
  onRead: () => void;
  /** Opens the proof behind a figure: the embedded receipt of this exact run of this exact rendered view, after a fresh confirming read. */
  onProof: (runId: string, origin: HTMLElement | null, view: RetainedScenarioView) => void;
  /** Opens the exact provenance of this exact rendered view in the sheet, after a fresh confirming read. */
  onProvenance: (origin: HTMLElement | null, view: RetainedScenarioView) => void;
  /** The existing return to the previous interface, kept under this surface. */
  legacy?: ReactNode;
}

const JOB_MARK = { pending: 'busy', running: 'busy', stale: 'unsure', ready: 'cha' } as const;

function Pair({ name, mono = false, children }: { name: string; mono?: boolean | undefined; children: ReactNode }) {
  return (
    <div className={s.pair}>
      <dt className={s.name}>{name}</dt>
      <dd className={[s.value, mono ? 'fig' : ''].filter(Boolean).join(' ')}>{children}</dd>
    </div>
  );
}

function exactWords(t: (key: string, values?: TextValues) => string, figure: EngineFigureEvidence): string {
  if (figure.unit === 'money') return figure.currency !== undefined ? t('ASK.answer.figure.money.currency', { exact: figure.minor, currency: figure.currency }) : t('ASK.answer.figure.money', { exact: figure.minor });
  return figure.currency !== undefined ? t('ASK.answer.figure.points.currency', { exact: figure.minor, currency: figure.currency }) : t('ASK.answer.figure.points', { exact: figure.minor });
}

/** The engine's own meaning of an unknown figure: nothing was counted. */
function figureUnknown(receipt: CalculationReceiptEvidence): boolean {
  return receipt.coverage.completeness === 'empty' || (receipt.coverage.completeness === 'partial' && receipt.coverage.countedRows === 0);
}

/** The figures of one ready analysis, each the receipt's own display string and a control that opens the proof. */
function ResultFigures({ entry, view, checking, onProof }: { entry: ScenarioColumnEntry; view: RetainedScenarioView; checking: boolean; onProof: RetainedScenarioProps['onProof'] }) {
  const t = useT();
  const result = entry.result;
  if (result === null) return null;
  const receipt = result.receipt;
  if (figureUnknown(receipt)) {
    return (
      <dl className={s.figures}>
        <div className={s.pair}>
          <dt>{t('ASK.answer.calculation.figure')}</dt>
          <dd className={s.value}><MissingWords missing="unknown" /></dd>
        </div>
      </dl>
    );
  }
  if (receipt.figures.length === 0) return <p className={s.note}>{t('ASK.answer.calculation.noFigures')}</p>;
  return (
    <dl className={s.figures}>
      {receipt.figures.map((figure) => (
        <div className={s.pair} key={figure.key}>
          <dt>{figure.label}</dt>
          <dd className={s.value}>
            <Button
              variant="link"
              className={s.figure}
              disabled={checking}
              title={t('FIGURE.title', { exact: figure.minor, receipt: receipt.id })}
              aria-label={t('ASK.answer.figure.open', { label: figure.label, display: figure.display, exact: exactWords(t, figure), receipt: receipt.id })}
              onClick={(event) => onProof(result.runId, event.currentTarget, view)}
            >
              {figure.display}
            </Button>
            <Label kind="what-if" className={s.label} />
            {receipt.stale && <Label kind="stale" className={s.label} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One analysis in a column: its words, its state and, when ready, its figures. A retained earlier
 * run is not repeated here; the view cues it once, and the sheet names the exact run. */
function JobEntry({ entry, view, checking, onProof }: { entry: ScenarioColumnEntry; view: RetainedScenarioView; checking: boolean; onProof: RetainedScenarioProps['onProof'] }) {
  const t = useT();
  const status: RetainedScenarioJobStatus = entry.state.status;
  return (
    <li className={s.job}>
      <p className={s.jobTitle}>{entry.job.label}</p>
      <p className={s.state}>
        <Square mark={JOB_MARK[status]} wordsKey={`RETAINED.scenario.job.${status}`} showWords />
      </p>
      {entry.state.reusedFromRevisionId !== undefined && <p className={s.note}>{t('RETAINED.scenario.job.reused', { revision: entry.state.reusedFromRevisionId })}</p>}
      <ResultFigures entry={entry} view={view} checking={checking} onProof={onProof} />
    </li>
  );
}

/**
 * The issued scenario outcome of each option's root analysis, as a columns chart on the exact
 * engine values and display strings. Only the price-scenario calculator's own `scenario` figure
 * is charted, and only when every ready root issued it in one unit and currency; otherwise the
 * chart is unavailable in words. A branch without a ready outcome is a gap with words, never a
 * zero. Nothing is summed, differenced or relabelled here.
 */
export function comparisonChart(columns: readonly ScenarioColumn[], sentence: (figure: string) => string): ColumnsChart | null {
  if (!columns.some((column) => column.branch.role === 'baseline')) return null;
  const roots = columns.map((column) => ({ column, entry: column.entries.find((entry) => entry.job.id === column.branch.rootJobId) }));
  const ready = roots.filter((root) => root.entry !== undefined && root.entry.result !== null);
  if (roots.some((root) => root.entry === undefined) || ready.length === 0) return null;
  const outcomes = ready.map((root) => (root.entry === undefined ? null : scenarioOutcomeFigure(root.entry)));
  const first = outcomes[0];
  if (first === null || first === undefined || first.unit !== 'money') return null;
  const currency = first.currency ?? ready[0]?.entry?.result?.receipt.currency;
  if (outcomes.some((outcome, index) => outcome === null || outcome.unit !== 'money' || (outcome.currency ?? ready[index]?.entry?.result?.receipt.currency) !== currency)) return null;
  const values: ChartValue[] = roots.map(({ column, entry }) => {
    const result = entry?.result ?? null;
    if (entry === undefined || result === null) {
      return { id: column.branch.id, label: column.branch.label, value: { kind: 'missing', missing: entry?.state.status === 'stale' ? 'unknown' : 'not-loaded-yet' } };
    }
    const figure = scenarioOutcomeFigure(entry);
    if (figure === null || figureUnknown(result.receipt)) return { id: column.branch.id, label: column.branch.label, value: { kind: 'missing', missing: 'unknown' } };
    const labels: FigureLabel[] = result.receipt.stale ? ['what-if', 'stale'] : ['what-if'];
    const value: AppFigure = { kind: 'money', exact: figure.minor, display: figure.display, receiptId: result.receipt.id, labels };
    return { id: column.branch.id, label: column.branch.label, value, emphasis: column.branch.role === 'alternative' };
  });
  return { form: 'columns', sentence: sentence(first.label), values };
}

/** The exact provenance of a displayed view: revision, head, evidence, each analysis with its
 * run identities, and each finalized comparison with its dates, required pins and limitations.
 * It opens in the sheet; nothing here is at rest on the page. */
export function ScenarioProvenanceBody({ view, historical }: { view: RetainedScenarioView; historical: boolean }) {
  const t = useT();
  return (
    <div className={s.group}>
      <p className={s.note}>{historical ? t('RETAINED.scenario.historicalDetail', { head: view.headRevisionId }) : t('RETAINED.scenario.currentDetail')}</p>
      <p className={s.note}>{t(view.status === 'complete' ? 'RETAINED.scenario.completeDetail' : 'RETAINED.scenario.partialDetail')}</p>
      <p className={s.note}>{t('RETAINED.scenario.noActionDetail')}</p>
      <dl className={s.pairs}>
        <Pair name={t('RETAINED.proof.revision')} mono>{view.revision.id}</Pair>
        <Pair name={t('RETAINED.scenario.revisionMode')}>{view.revision.mode}</Pair>
        <Pair name={t('RETAINED.scenario.parentRevision')} mono>{view.revision.parentRevisionId ?? t('ASK.answer.notSpecified')}</Pair>
        <Pair name={t('RETAINED.scenario.headRevision')} mono>{view.headRevisionId}</Pair>
        <Pair name={t('RETAINED.scenario.revisionDigest')} mono>{view.revision.digest}</Pair>
        <Pair name={t('RETAINED.proof.evidence')} mono>{view.revision.evidenceId}</Pair>
        <Pair name={t('RETAINED.scenario.evidenceDigest')} mono>{view.revision.evidenceDigest}</Pair>
      </dl>
      <h3 className={s.heading}>{t('RETAINED.scenario.comparisons')}</h3>
      {view.comparisons.length === 0 ? <p className={s.note}>{t('RETAINED.scenario.comparisonNone')}</p> : view.comparisons.map((comparison) => (
        <div key={comparison.id} className={s.group}>
          <p className={[s.text, 'fig'].join(' ')}>{t('RETAINED.scenario.comparison', { id: comparison.id, createdAt: comparison.createdAt })}</p>
          <dl className={s.pairs}><Pair name={t('RETAINED.scenario.comparisonDigest')} mono>{comparison.digest}</Pair></dl>
          <h4 className={s.heading}>{t('RETAINED.scenario.limitations')}</h4>
          <ul className={s.list}>{comparison.limitations.map((limitation, index) => <li key={index} className={s.text}>{limitation}</li>)}</ul>
          <h4 className={s.heading}>{t('RETAINED.scenario.requiredJobs')}</h4>
          <ul className={s.list}>
            {comparison.requiredJobs.map((required) => (
              <li key={required.jobId} className={s.text}>
                <dl className={s.pairs}>
                  <Pair name={t('RETAINED.proof.job')} mono>{required.jobId}</Pair>
                  <Pair name={t('RETAINED.proof.run')} mono>{required.runId}</Pair>
                  <Pair name={t('RETAINED.scenario.runRevision')} mono>{required.runRevisionId}</Pair>
                  <Pair name={t('RETAINED.scenario.reusedFrom')} mono>{required.reusedFromRevisionId ?? t('ASK.answer.notSpecified')}</Pair>
                  <Pair name={t('RETAINED.scenario.receiptId')} mono>{required.receiptId}</Pair>
                  <Pair name={t('RETAINED.proof.receiptDigest')} mono>{required.receiptDigest}</Pair>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <h3 className={s.heading}>{t('RETAINED.scenario.jobsHeading')}</h3>
      <ul className={s.list}>
        {view.revision.jobs.map((job) => {
          const state = view.jobs.find((item) => item.jobId === job.id);
          return (
            <li key={job.id} className={s.text}>
              <dl className={s.pairs}>
                <Pair name={t('RETAINED.proof.jobLabel')}>{job.label}</Pair>
                <Pair name={t('RETAINED.proof.job')} mono>{job.id}</Pair>
                <Pair name={t('RETAINED.proof.branch')} mono>{job.branchId}</Pair>
                <Pair name={t('ASK.answer.calculation.operation')} mono>{job.request.operation}</Pair>
                <Pair name={t('RETAINED.scenario.requestDigest')} mono>{job.requestDigest}</Pair>
                <Pair name={t('RETAINED.scenario.inputDigest')} mono>{job.inputDigest}</Pair>
                <Pair name={t('RETAINED.scenario.dependsOn')} mono>{job.dependsOn.length === 0 ? t('MISSING.none') : job.dependsOn.join(', ')}</Pair>
                {state !== undefined && <Pair name={t('RETAINED.scenario.jobState')}>{t(`RETAINED.scenario.job.${state.status}`)}</Pair>}
                {state?.runId !== undefined && <Pair name={t('RETAINED.proof.run')} mono>{state.runId}</Pair>}
                {state?.activeRunId !== undefined && <Pair name={t('RETAINED.scenario.activeRun')} mono>{state.activeRunId}</Pair>}
                {state?.retainedRunId !== undefined && <Pair name={t('RETAINED.scenario.retainedRunId')} mono>{state.retainedRunId}</Pair>}
                {state?.reusedFromRevisionId !== undefined && <Pair name={t('RETAINED.scenario.reusedFrom')} mono>{state.reusedFromRevisionId}</Pair>}
              </dl>
              {state !== undefined && state.status !== 'ready' && state.retainedRunId !== undefined && (
                <p className={s.note}>{t('RETAINED.scenario.retainedRunDetail', { run: state.retainedRunId })}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Comparison({ view, historical, checking, onProof, onProvenance, onRead }: {
  view: RetainedScenarioView; historical: boolean; checking: boolean;
  onProof: RetainedScenarioProps['onProof']; onProvenance: RetainedScenarioProps['onProvenance']; onRead: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const columns = scenarioColumns(view);
  const baseline = columns.find((column) => column.branch.role === 'baseline');
  const chart = comparisonChart(columns, (figure) => t('RETAINED.scenario.chartSentence', { figure }));
  // Whether any analysis that is not ready keeps an earlier run: cued once for the whole view, however many there are.
  const retainedEarlier = view.jobs.some((job) => job.status !== 'ready' && job.retainedRunId !== undefined);
  const openByReceipt = (receiptId: string) => {
    if (checking) return;
    // A checked view holds one embedded result per receipt identity; anything else resolves no run.
    const matches = view.results.filter((item) => item.receipt.id === receiptId);
    const result = matches.length === 1 ? matches[0] : undefined;
    if (result !== undefined) onProof(result.runId, document.activeElement instanceof HTMLElement ? document.activeElement : null, view);
  };
  return (
    <section className={s.scenario} aria-labelledby={titleId}>
      <h2 id={titleId} className={s.title}>
        <Label kind="what-if" /> {t('RETAINED.scenario.title')}
      </h2>
      <p className={[s.identity, 'fig'].join(' ')}>{t('RETAINED.scenario.revisionCue', { revision: view.revision.id, createdAt: view.revision.createdAt })}</p>
      <p className={s.note}>{historical ? t('RETAINED.scenario.historical', { head: view.headRevisionId }) : t('RETAINED.scenario.current')}</p>
      <p className={s.note}>{t(view.status === 'complete' ? 'RETAINED.scenario.complete' : 'RETAINED.scenario.partial')}</p>
      {retainedEarlier && (
        // One short honest cue at rest for every retained earlier run; each job keeps its own state word in
        // its column, and the exact retained runs with their explanations are in the provenance sheet.
        <p className={s.note}>{t('RETAINED.scenario.job.retainedRun')}</p>
      )}
      <p className={s.note}>{t('RETAINED.scenario.noAction')}</p>
      {checking && <p role="status" className={s.note}>{t('RETAINED.scenario.checking')}</p>}

      {chart !== null ? <Columns chart={chart} onReceipt={openByReceipt} width={Math.max(120, columns.length * 72)} /> : <p className={s.note}>{t('RETAINED.scenario.chartUnavailable')}</p>}

      <table className={s.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column.branch.id} className={s.head}>
                <div className={s.column}>
                  <span className={s.columnLabel}>{column.branch.label}</span>
                  <span className={s.note}>{t(column.branch.role === 'baseline' ? 'RETAINED.scenario.columnBaseline' : 'RETAINED.scenario.columnAlternative')}</span>
                  <span className={[s.note, 'fig'].join(' ')}>
                    {column.branch.role === 'baseline' || baseline === undefined
                      ? t('RETAINED.scenario.assumption', { bps: column.branch.priceChangeBps })
                      : t('RETAINED.scenario.assumptionChange', { before: baseline.branch.priceChangeBps, after: column.branch.priceChangeBps })}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {columns.map((column) => (
              <td key={column.branch.id} className={s.cell}>
                <ul className={s.jobs}>
                  {column.entries.map((entry) => <JobEntry key={entry.job.id} entry={entry} view={view} checking={checking} onProof={onProof} />)}
                </ul>
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      <p className={s.note}>{t(view.comparisons.length === 0 ? 'RETAINED.scenario.comparisonNone' : 'RETAINED.scenario.comparisonCue')}</p>
      <div className={s.actions}>
        <Button variant="quiet" disabled={checking} onClick={(event) => onProvenance(event.currentTarget, view)}>{t('RETAINED.scenario.provenance')}</Button>
        <Button variant="link" onClick={onRead}>{t('RETAINED.readAgain')}</Button>
      </div>
    </section>
  );
}

export function RetainedScenario({ state, selectionSupplied, onRead, onProof, onProvenance, legacy }: RetainedScenarioProps) {
  const t = useT();
  let body: ReactNode;
  if (!selectionSupplied) {
    body = (
      <>
        <p role="status" className={s.text}>{t('RETAINED.scenario.noDiscovery')}</p>
        <p className={s.note}>{t('RETAINED.scenario.readbackNote')}</p>
      </>
    );
  } else if (state.kind === 'ready') {
    body = <Comparison view={state.view} historical={state.historical} checking={state.checking} onProof={onProof} onProvenance={onProvenance} onRead={onRead} />;
  } else if (state.kind === 'unavailable') {
    const what = state.code === 'SCENARIO_VIEW_CHANGED' ? 'RETAINED.scenario.changed'
      : isTransportUnavailable(state.code) ? 'RETAINED.scenario.transport' : 'RETAINED.scenario.unavailable';
    body = <State state={{ kind: 'failed', code: state.code, what: t(what) }} action={{ label: t('RETAINED.readAgain'), onPress: onRead }} />;
  } else {
    body = <p role="status" className={s.text}>{t('RETAINED.scenario.loading')}</p>;
  }
  return (
    <section className={s.page} aria-label={t('SH-01.sub.ask.saved')}>
      <PageHeader where={t('SH-01.place.ask')} title={t('SH-01.sub.ask.saved')} />
      {body}
      {legacy}
    </section>
  );
}
