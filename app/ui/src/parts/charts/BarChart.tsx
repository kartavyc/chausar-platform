import { useT } from '../../text';
import type { DeptId } from '../icons';
import { Receipt } from '../Receipt';
import { ChartData, ChartFoot, ChartValue, chartRoot, type ChartValues } from './ChartData';
import { BASE, COLUMN, COLUMN_UP, UPRIGHT, raise } from './plot';
import { Gutter } from './Ticks';
import type { BarPoint, BarSeries, ChartTick } from './types';
import s from './Charts.module.css';

export type BarChartProps = ChartValues & {
  /** One series, or two drawn side by side (In and Out). Both carry the same keys in the same order. */
  series: [BarSeries] | [BarSeries, BarSeries];
  /** The engine's sentence that reads the numbers; the chart is one image with this name. */
  label: string;
  /** `series`: columns over time (the default). `ranked`: one row per item with its bar and value (one series). */
  layout?: 'series' | 'ranked' | undefined;
  /** The key of the point that is "now" (bold label, darker bar). Left out, the last point. */
  current?: string | undefined;
  /** A single series that belongs to a department takes its colours. */
  dept?: DeptId | undefined;
  /** Level lines on the bars' scale, with the engine's words, so a narrow tile keeps a scale when the values over the
   *  bars are folded away. Column charts only. */
  ticks?: ChartTick[] | undefined;
};

/**
 * Bar charts (D's in and out by month, the department's spend and jobs, Team's jobs by department). Bars are drawn at
 * their per mille heights and the values written over them are the engine's own strings. A point with no value draws
 * no bar: in a series it shows nothing, in ranked bars it says N/A, never 0. An empty series renders nothing at all,
 * and the caller says why in words. A chart that writes money is one `data-figure-group` proved by its receipt or
 * "model estimate"; a count chart carries no proof unless it writes a money note beside the counts.
 *
 * Columns: each column is its own pixel-wide SVG. The bars are placed by percentages of the column (so twelve months
 * fit a phone), which CSS keeps at D's widths on wide tiles; only the data end of a bar is rounded.
 * Ranked rows: each bar is a `meter` from 0 to 1000, so the browser draws its length and rounds its data end.
 */
export function BarChart(props: BarChartProps) {
  const t = useT();
  const { series, label, layout = 'series', kind, proof, onReceipt, noteLabel, dept, ticks = [] } = props;
  const [first, second] = series;
  if (first.points.length === 0) return null;
  const money = kind === 'money';
  const none = t('chart.none');
  const valueOf = (point: BarPoint | undefined) => (point && point.valuePermille !== null ? point.value : null);
  const shown = (point: BarPoint | undefined) => valueOf(point) ?? none;
  const pairOf = (point: BarPoint) => second?.points.find((other) => other.key === point.key);
  const noted = noteLabel !== undefined && first.points.some((point) => point.note !== undefined);
  const note = (point: BarPoint) => (point.note === undefined ? null : <span className={`${s.note} mono`} data-note="">{point.note}</span>);

  const receipted = series.some((one) => one.points.some((point) => point.receiptId));
  const table = (
    <ChartData
      caption={label}
      columns={[...series.map((one) => one.label), ...(noted && noteLabel ? [noteLabel] : []), ...(receipted ? [t('chart.data.receipt')] : [])]}
      rows={first.points.map((point) => {
        const pair = pairOf(point);
        const ids = [point.receiptId, pair?.receiptId].filter((id): id is string => Boolean(id));
        return {
          key: point.key,
          heading: point.label,
          cells: [
            <ChartValue money={money} value={valueOf(point)} />,
            ...(second ? [<ChartValue money={money} value={valueOf(pair)} />] : []),
            ...(noted ? [point.note === undefined ? <ChartValue money value={null} /> : <span className="mono">{point.note}</span>] : []),
            ...(receipted ? [<span className={s.receipts}>{ids.map((id) => <Receipt key={id} id={id} onOpen={onReceipt} />)}</span>] : []),
          ],
        };
      })}
    />
  );

  if (layout === 'ranked') {
    return (
      <div className={s.chart} {...chartRoot(proof, { 'data-layout': 'ranked', 'data-noted': noted ? '' : undefined })}>
        <div className={s.ranked} role="img" aria-label={label}>
          {first.points.map((point) => (
            <div key={point.key} className={s.rankRow} data-key={point.key} data-dept={point.dept}>
              <span className={s.rankName}>
                {point.dept && <span className={s.swatch} data-swatch="" data-dept={point.dept} />}
                {point.label}
              </span>
              <span className={s.rankTrack}>
                {point.valuePermille !== null && (
                  <meter className={s.rankMeter} data-bar="" min={0} max={1000} value={point.valuePermille} aria-hidden="true" />
                )}
              </span>
              <ChartValue money={money} value={valueOf(point)} className={s.rankValue} />
              {noted && (note(point) ?? <span className={s.note} />)}
            </div>
          ))}
        </div>
        <ChartFoot proof={proof} onReceipt={onReceipt}>{table}</ChartFoot>
      </div>
    );
  }

  const current = props.current ?? first.points[first.points.length - 1]!.key;
  const grid = ticks.filter((tick) => tick.permille !== 0);
  return (
    <div className={s.chart} {...chartRoot(proof, { 'data-layout': 'series', 'data-dept': second ? undefined : dept, 'data-paired': second ? '' : undefined })}>
      {second && (
        <ul className={s.legend} data-legend="">
          <li className={s.key}><span className={s.swatch} data-series="0" aria-hidden="true" />{first.label}</li>
          <li className={s.key}><span className={s.swatch} data-series="1" aria-hidden="true" />{second.label}</li>
        </ul>
      )}
      <div className={s.columnsPlot} role="img" aria-label={label}>
        {ticks.length > 0 && <Gutter ticks={ticks} height={COLUMN} up={COLUMN_UP} />}
        <div className={s.columns}>
          {first.points.map((point) => {
            const pair = pairOf(point);
            const now = point.key === current ? '' : undefined;
            const tip = second
              ? t('chart.tipPair', { label: point.label, first: first.label, firstValue: shown(point), second: second.label, secondValue: shown(pair) })
              : t('chart.tip', { label: point.label, value: shown(point) });
            return (
              <div key={point.key} className={s.column} data-key={point.key} data-current={now}>
                <svg className={s.columnPlot} width="100%" height={COLUMN} focusable="false">
                  <rect className={s.hit} x="0" y="0" width="100%" height={COLUMN}>
                    <title>{tip}</title>
                  </rect>
                  <g transform={COLUMN_UP}>
                    {grid.map((tick) => (
                      <line key={tick.permille} className={s.grid} data-grid="" x1="0" x2="100%" y1={tick.permille} y2={tick.permille} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    ))}
                  </g>
                  <line className={s.baseline} x1="0" x2="100%" y1={BASE + 0.5} y2={BASE + 0.5} />
                  <g transform={COLUMN_UP}>
                    {point.valuePermille !== null && (
                      <rect className={s.bar} data-bar="" data-series="0" data-current={second ? undefined : now} x={second ? '24%' : '22%'} y="0" width={second ? '24%' : '56%'} height={point.valuePermille} />
                    )}
                    {second && pair && pair.valuePermille !== null && (
                      <rect className={s.bar} data-bar="" data-series="1" x="52%" y="0" width="24%" height={pair.valuePermille} />
                    )}
                    {point.valuePermille !== null && (
                      <g className={s.capAt} transform={raise(point.valuePermille)}>
                        <text
                          className={s.cap}
                          data-cap=""
                          data-count={money ? undefined : ''}
                          data-current={now}
                          transform={UPRIGHT}
                          x={second ? '36%' : '50%'}
                          y="-6"
                          textAnchor="middle"
                        >
                          {point.value}
                        </text>
                      </g>
                    )}
                  </g>
                </svg>
                <span className={s.xLabel}>{point.label}</span>
                {noted && note(point)}
              </div>
            );
          })}
        </div>
      </div>
      <ChartFoot proof={proof} onReceipt={onReceipt}>{table}</ChartFoot>
    </div>
  );
}
