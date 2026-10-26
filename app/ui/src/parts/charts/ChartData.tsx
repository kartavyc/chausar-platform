import type { ReactNode } from 'react';
import { useT } from '../../text';
import { cx } from '../cx';
import type { FigureProof } from '../Figure';
import { Icon } from '../Icon';
import { ModelEstimate } from '../ModelEstimate';
import { Receipt } from '../Receipt';
import s from './Charts.module.css';

export interface ChartDataRow {
  key: string;
  /** The row's own words (a month, a bucket, a department): the row header. */
  heading: string;
  /** One cell per column, in the engine's own text. */
  cells: ReactNode[];
}

export interface ChartDataProps {
  /** Names the table for screen readers (the chart's title or label). */
  caption: string;
  columns: string[];
  rows: ChartDataRow[];
}

/**
 * Every chart's text equivalent: "View chart data", a closed `details` holding a plain table of the engine strings
 * the chart drew. Nothing in it is hover-only and nothing is computed.
 */
export function ChartData({ caption, columns, rows }: ChartDataProps) {
  const t = useT();
  return (
    <details className={s.data}>
      <summary className={s.dataSummary}>
        <Icon name="chevron-right" size={14} className={s.dataChevron} />
        {t('chart.data.view')}
      </summary>
      <table className={s.table}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <td />
            {columns.map((column) => <th key={column} scope="col">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.heading}</th>
              {row.cells.map((cell, i) => <td key={columns[i] ?? i}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * How a chart's proof is shown: the one receipt (or the "model estimate" label) that proves every amount it writes, or
 * `each` when every point's amount carries its own receipt (listed in the chart's table) and no one receipt covers them
 * all (W4 4A2: a department's spend week by week).
 */
export type ChartProof = FigureProof | 'each';

export interface ChartProofProps {
  proof?: ChartProof | undefined;
  onReceipt?: ((id: string) => void) | undefined;
}

/**
 * What a chart's values are, as a discriminant the type checks: a money chart cannot be built without its proof.
 * - `money`: the values are amounts, proved by `proof`; a `noteLabel` names an optional second string per point. Proof
 *   `each` (W4 4J20: in and out by month) when every point's amount has its own receipt, listed in the chart's table.
 * - `count`: the values are counts (jobs, runs) and need no proof.
 * - `count` with a money note beside each value (D-Team's jobs and spend): the notes are amounts, so `proof` is needed:
 *   one receipt, or `each` when each point's `receiptId` proves its own note (the table lists them).
 */
export type ChartValues =
  | { kind: 'money'; proof: ChartProof; noteLabel?: string | undefined; onReceipt?: ((id: string) => void) | undefined }
  | { kind: 'count'; proof?: undefined; noteLabel?: undefined; onReceipt?: undefined }
  | { kind: 'count'; proof: FigureProof; noteLabel: string; onReceipt?: ((id: string) => void) | undefined }
  | { kind: 'count'; proof: 'each'; noteLabel: string; onReceipt?: ((id: string) => void) | undefined };

/** The attributes of a chart's outer element: a `data-figure-group` when it holds money, so its one proof covers
 *  every amount written inside it (tests/helpers/ink-rules.ts). */
export function chartRoot(proof: ChartProof | undefined, extra?: Record<string, string | undefined>) {
  return { 'data-chart': '', 'data-figure-group': proof ? '' : undefined, ...extra };
}

/** A chart's last line: its data table, and its proof on the right. */
export function ChartFoot({ proof, onReceipt, children }: ChartProofProps & { children: ReactNode }) {
  return (
    <div className={s.foot}>
      {children}
      {proof && proof !== 'each' && (
        <span className={s.proof}>
          {proof.estimate ? <ModelEstimate /> : <Receipt id={proof.receiptId} onOpen={onReceipt} />}
        </span>
      )}
    </div>
  );
}

/** A value in a chart's table or row: money in DM Mono (proved by the chart's group), or a count. A missing value
 *  says N/A in words, never 0. */
export function ChartValue({ money, value, className }: { money: boolean; value: string | null; className?: string | undefined }) {
  const t = useT();
  if (value === null) return <span className={cx(s.none, className)}>{t('chart.none')}</span>;
  return money ? <span className={cx('mono', s.num, className)}>{value}</span> : <span className={cx('mono', s.num, className)} data-count="">{value}</span>;
}
