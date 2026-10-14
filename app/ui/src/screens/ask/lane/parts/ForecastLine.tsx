/**
 * ForecastLine: the past as a line in ink, the forecast as a lighter line with a pale band
 * for its range, and the simple baseline as a thin grey line, all on one scale. Every known
 * point is a mark that opens its receipt; a missing point breaks its line and is never
 * drawn as zero. A short written key under the chart names the three lines, so they are
 * never told apart by tone alone. Positions are exact (BigInt) until normalised.
 */
import type { Figure } from '../../../../app/presentation.ts';
import { Mark, Target } from '../../../../parts/charts/marks';
import { exactExtent, exactLinear, linear, toExact } from '../../../../parts/charts/scale.ts';
import { fill } from '../kit';
import s from './ForecastLine.module.css';

export type Series = ReadonlyArray<Figure | null>;
export interface ForecastLineProps {
  sentence: string;
  /** One label per position along the page, as words. */
  labels: ReadonlyArray<string>;
  past: Series;
  forecast: Series;
  baseline: Series;
  /** The forecast's range at one position: the centre and how far it spreads each way. */
  band: { index: number; centre: string; spread: string } | null;
  /** `point` is one complete template with {month} and {series} slots. */
  words: { past: string; forecast: string; baseline: string; range: string; point: string };
  onReceipt: (receiptId: string) => void;
  width?: number | undefined;
  height?: number | undefined;
}

const PAD = 8, LABEL_H = 18;

export function ForecastLine({ sentence, labels, past, forecast, baseline, band, words, onReceipt, width = 560, height = 120 }: ForecastLineProps) {
  const n = Math.max(labels.length, 1);
  const exact = (series: Series) => series.map(f => (f === null ? null : toExact(f.exact)));
  const lines = { past: exact(past), forecast: exact(forecast), baseline: exact(baseline) };
  const centre = band ? toExact(band.centre) : null, spread = band ? toExact(band.spread) : null;
  const ends = centre !== null && spread !== null ? [centre - (spread < 0n ? -spread : spread), centre + (spread < 0n ? -spread : spread)] : [];
  const domain = exactExtent([...lines.past, ...lines.forecast, ...lines.baseline, ...ends]);
  if (domain === null) return null;
  const y = exactLinear(domain.min, domain.max, height - PAD, PAD);
  const x = linear(0, Math.max(n - 1, 1), PAD, width - PAD);

  const path = (values: ReadonlyArray<bigint | null>) => {
    let d = '', pen = false;
    values.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  /* The band opens from the last past point to the range at its own position. */
  const lastPast = lines.past.reduce<number>((at, v, i) => (v === null ? at : i), -1);
  let bandPath: string | null = null;
  if (band && ends.length === 2 && lastPast >= 0) {
    const from = lines.past[lastPast]!;
    bandPath = `M${x(lastPast).toFixed(1)} ${y(from).toFixed(1)} L${x(band.index).toFixed(1)} ${y(ends[1]!).toFixed(1)} L${x(band.index).toFixed(1)} ${y(ends[0]!).toFixed(1)} Z`;
  }
  const marks = (series: Series, kind: 'past' | 'forecast' | 'baseline') => series.map((f, i) => {
    if (f === null) return null;
    const v = toExact(f.exact);
    return (
      <Mark key={`${kind}-${i}`} label={fill(words.point, { month: labels[i] ?? '', series: words[kind] })} display={f.display} spoken={f.spoken} receiptId={f.receiptId} onReceipt={onReceipt}>
        <Target cx={x(i)} cy={v === null ? height - PAD : y(v)} />
      </Mark>
    );
  });
  const total = height + LABEL_H;
  return (
    <figure className={s.figure}>
      <svg className={s.svg} viewBox={`0 0 ${width} ${total}`} role="group" aria-label={sentence}>
        {bandPath !== null && <path className={s.band} d={bandPath} data-forecast-band="" />}
        <path className={s.baseline} d={path(lines.baseline)} data-forecast-line="baseline" />
        <path className={s.forecast} d={path(lines.forecast)} data-forecast-line="forecast" />
        <path className={s.past} d={path(lines.past)} data-forecast-line="past" />
        {marks(past, 'past')}{marks(forecast, 'forecast')}{marks(baseline, 'baseline')}
        <text className={s.label} x={PAD} y={total - 4} textAnchor="start">{labels[0] ?? ''}</text>
        <text className={s.label} x={width - PAD} y={total - 4} textAnchor="end">{labels[labels.length - 1] ?? ''}</text>
      </svg>
      <figcaption className={s.key}>
        <span className={s.keyItem}><span className={[s.swatch, s.swPast].join(' ')} aria-hidden="true" />{words.past}</span>
        <span className={s.keyItem}><span className={[s.swatch, s.swForecast].join(' ')} aria-hidden="true" />{words.forecast}</span>
        {bandPath !== null && <span className={s.keyItem}><span className={[s.swatch, s.swBand].join(' ')} aria-hidden="true" />{words.range}</span>}
        <span className={s.keyItem}><span className={[s.swatch, s.swBaseline].join(' ')} aria-hidden="true" />{words.baseline}</span>
      </figcaption>
    </figure>
  );
}
