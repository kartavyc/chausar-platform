import { useId } from 'react';
import { useT } from '../../text';
import { Receipt } from '../Receipt';
import { ChartData, ChartFoot, ChartValue, chartRoot } from './ChartData';
import { FLIP, PLOT, PLOT_UP, svgId } from './plot';
import { Gutter } from './Ticks';
import type { CashData, CashPoint } from './types';
import s from './Charts.module.css';

export interface CashLineProps {
  data: CashData;
  onReceipt?: ((id: string) => void) | undefined;
  /** false (W4 4J20, Money's headline tile): no hover line per week; the chart's table still holds every value. */
  tips?: boolean | undefined;
}

/** A week's place across the chart: the middle of its column, so the axis words below sit under it. */
const at = (i: number) => i * 100 + 50;

/** The unbroken runs of points that have a value, as SVG point lists. A gap in the data stays a gap in the line;
 *  a run of one point draws no line. */
function runs(points: CashPoint[], value: (point: CashPoint) => number | null): string[] {
  const out: string[][] = [];
  let run: string[] = [];
  points.forEach((point, i) => {
    const v = value(point);
    if (v === null) {
      if (run.length) out.push(run);
      run = [];
    } else run.push(`${at(i)},${v}`);
  });
  if (run.length) out.push(run);
  return out.filter((r) => r.length > 1).map((r) => r.join(' '));
}

/**
 * Cash in the bank, week by week (D's "Cash, next 13 weeks"). The forecast is a dashed grey line and is said in
 * words, with the engine's assumptions listed under the chart; actual figures are a solid ink line; today's dot sits
 * on the last week with an actual figure, where the forecast takes over. Values stay per mille in a 1000-tall viewBox stretched to the tile, the lines keep their
 * width at any size (non-scaling strokes), and the words are HTML, so they never shrink below 12 px.
 */
export function CashLine({ data, onReceipt, tips = true }: CashLineProps) {
  const t = useT();
  const assumesId = svgId(useId(), 'assumes');
  const { points } = data;
  if (points.length === 0) return null;
  const width = points.length * 100;
  const actual = runs(points, (point) => point.actualPermille);
  const forecast = runs(points, (point) => point.forecastPermille);
  const todayAt = points.findLastIndex((point) => point.actualPermille !== null);
  const today = points[todayAt];
  const endAt = points.findLastIndex((point) => point.forecastPermille !== null);
  const end = points[endAt];
  const ticks = data.ticks ?? [];
  const { proof } = data;
  // W4 4J20: each week its own receipt, listed in the table (the chart's proof is then `each`).
  const receipted = points.some((point) => point.receiptId);
  const tip = (point: CashPoint) =>
    t('chart.tip', {
      label: point.label,
      value: [
        point.actual !== null ? t('chart.tipPart', { name: t('chart.cash.actual'), value: point.actual }) : '',
        point.forecast !== null ? t('chart.tipPart', { name: t('chart.cash.forecast'), value: point.forecast }) : '',
      ].filter(Boolean).join(', ') || t('chart.none'),
    });

  return (
    <div className={s.chart} {...chartRoot(proof, { 'data-layout': 'line' })}>
      <ul className={s.legend} data-legend="">
        {today && <li className={s.key}><span className={s.todayKey} aria-hidden="true" />{t('chart.cash.today')}</li>}
        {actual.length > 0 && <li className={s.key}><span className={s.lineKey} aria-hidden="true" />{t('chart.cash.actual')}</li>}
        {forecast.length > 0 && <li className={s.key}><span className={s.lineKey} data-dashed="" aria-hidden="true" />{t('chart.cash.forecast')}</li>}
      </ul>
      <div className={s.linePlot} role="img" aria-label={data.label}>
        {ticks.length > 0 && <Gutter ticks={ticks} height={PLOT} up={PLOT_UP} />}
        <div className={s.lineMain}>
          <svg className={s.lineSvg} viewBox={`0 0 ${width} 1000`} preserveAspectRatio="none" width="100%" height={PLOT} focusable="false">
            <g transform={FLIP}>
              {points.map((point, i) => (
                <rect key={point.key} className={s.hit} x={i * 100} y="0" width="100" height="1000">
                  {tips && <title>{tip(point)}</title>}
                </rect>
              ))}
              {ticks.map((tick) => (
                <line key={tick.permille} className={tick.permille === 0 ? s.baseline : s.grid} x1="0" x2={width} y1={tick.permille} y2={tick.permille} strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              {!ticks.some((tick) => tick.permille === 0) && (
                <line className={s.baseline} x1="0" x2={width} y1="0" y2="0" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              )}
              {forecast.map((line) => (
                <polyline key={line} className={s.forecast} data-line="forecast" points={line} strokeWidth="1.75" strokeDasharray="4 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              ))}
              {actual.map((line) => (
                <polyline key={line} className={s.actual} data-line="actual" points={line} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              ))}
              {end && endAt !== todayAt && (
                <>
                  <line className={s.endRing} x1={at(endAt)} x2={at(endAt)} y1={end.forecastPermille!} y2={end.forecastPermille!} strokeWidth="12" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  <line className={s.endHole} x1={at(endAt)} x2={at(endAt)} y1={end.forecastPermille!} y2={end.forecastPermille!} strokeWidth="7" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </>
              )}
              {today && (
                <>
                  <line className={s.todayRing} x1={at(todayAt)} x2={at(todayAt)} y1={today.actualPermille!} y2={today.actualPermille!} strokeWidth="15" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  <line className={s.today} data-part="today" x1={at(todayAt)} x2={at(todayAt)} y1={today.actualPermille!} y2={today.actualPermille!} strokeWidth="11" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </>
              )}
            </g>
          </svg>
          <div className={s.axis} data-axis="">
            {data.axis.map((word, i) => <span key={i} data-current={i === todayAt ? '' : undefined}>{word}</span>)}
          </div>
        </div>
      </div>
      {data.assumptions.length > 0 && (
        <div className={s.notes}>
          <p id={assumesId} className={s.notesHead}>{t('chart.cash.assumes')}</p>
          <ul className={s.notesList} aria-labelledby={assumesId}>
            {data.assumptions.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}
      <ChartFoot proof={proof} onReceipt={onReceipt}>
        <ChartData
          caption={data.label}
          columns={[t('chart.cash.actual'), t('chart.cash.forecast'), ...(receipted ? [t('chart.data.receipt')] : [])]}
          rows={points.map((point) => ({
            key: point.key,
            heading: point.label,
            cells: [
              <ChartValue money value={point.actual} />,
              <ChartValue money value={point.forecast} />,
              ...(receipted ? [point.receiptId ? <Receipt id={point.receiptId} onOpen={onReceipt} /> : <ChartValue money value={null} />] : []),
            ],
          }))}
        />
      </ChartFoot>
    </div>
  );
}
