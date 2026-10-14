/**
 * WK-08: a job's measure against its goal, drawn with the shared GoalLine part. Each point is
 * the engine's figure with its receipt and opens it; a point with no figure is a gap, written
 * in words under the chart. Nothing is worked out here: values are placed as given. A goal
 * without a receipt is not drawn as a rule; it is written beside the chart as set on the job.
 */
import type { ChartValue, FigureOrMissing } from '../../../app/presentation.ts';
import { GoalLine } from '../../../parts/charts/GoalLine';
import type { GoalLineChart } from '../../../parts/charts/types.ts';
import type { Language } from '../../../app/presentation.ts';
import { amountText, day, paise } from '../kit/format.ts';
import type { Amount } from '../kit/validate.ts';
import type { Measure } from '../contract-jobs.ts';
import { sayJob, type JobWords } from '../text-jobs.ts';

const figure = (value: Amount, receiptId: string | null): FigureOrMissing =>
  'minor' in value
    ? receiptId === null ? { kind: 'missing', missing: 'not-applicable' } : { kind: 'money', exact: value.minor, display: paise(value.minor), receiptId, labels: [] }
    : { kind: 'missing', missing: value.missing };

/** The chart description: one value per point, in the engine's order, and the goal. */
export function measureChart(m: Measure, j: JobWords, language: Language): GoalLineChart {
  const values: ChartValue[] = m.points.map((p, i) => ({ id: `${p.receiptId}-${i}`, label: day(p.at, language), value: figure(p.value, p.receiptId), emphasis: i === m.points.length - 1 }));
  return {
    form: 'goal-line', sentence: sayJob(j, 'measure.sentence', { name: m.name }), values,
    goal: { id: 'goal', label: j['measure.goal'], value: figure(m.goal, m.goalReceiptId) },
    from: m.points.length > 0 ? day(m.points[0]!.at, language) : '', to: m.points.length > 0 ? day(m.points[m.points.length - 1]!.at, language) : '',
  };
}

export function MeasureChart({ measure, j, language, onReceipt }: { measure: Measure; j: JobWords; language: Language; onReceipt: (id: string) => void }) {
  const gaps = measure.points.filter(p => !('minor' in p.value)).length;
  const goalWritten = 'minor' in measure.goal && measure.goalReceiptId === null;
  return (
    <div data-measure="">
      <GoalLine chart={measureChart(measure, j, language)} onReceipt={onReceipt} width={280} />
      {goalWritten && <p>{sayJob(j, 'measure.goalWritten', { amount: amountText(measure.goal, language) })}</p>}
      {gaps > 0 && <p>{sayJob(j, 'measure.gaps', { n: gaps })}</p>}
    </div>
  );
}
