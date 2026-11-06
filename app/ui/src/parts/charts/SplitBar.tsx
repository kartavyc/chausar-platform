import { useT } from '../../text';
import { ChartData, ChartFoot, chartRoot } from './ChartData';
import { Stack } from './Stack';
import type { DeptId } from '../icons';
import type { SplitData } from './types';
import s from './Charts.module.css';

/** The order the bar and the legend always take, whatever order the engine sends. It keeps the departments whose
 *  colours are closest (Production and Money, Marketing and Sales) apart. */
const SPLIT_ORDER: readonly DeptId[] = ['sales', 'money', 'ops', 'mkt', 'prod'];

export interface SplitBarProps {
  data: SplitData;
  onReceipt?: ((id: string) => void) | undefined;
}

/**
 * A total split by department (D's `.sbar` and `.sleg`, AI spend by department): a thin bar in the department solids
 * and a legend naming each department with its amount, both in one fixed order (departments with nothing come last
 * in the legend and draw no segment). The department colours are close to each other, so the legend's words, the
 * fixed order and the 2 px gaps carry the reading, never colour alone. One proof (a receipt or "model estimate")
 * covers the split.
 */
export function SplitBar({ data, onReceipt }: SplitBarProps) {
  const t = useT();
  const { proof } = data;
  const name = (dept: string) => t(`dept.${dept}`);
  const ordered = SPLIT_ORDER.flatMap((dept) => data.parts.filter((part) => part.dept === dept));
  const legend = [...ordered.filter((part) => part.permille > 0), ...ordered.filter((part) => part.permille <= 0)];
  return (
    <div className={s.chart} {...chartRoot(proof)}>
      <Stack
        thin
        label={data.label}
        segments={ordered.map((part) => ({
          id: part.dept,
          permille: part.permille,
          attrs: { 'data-dept': part.dept },
          title: t('chart.tip', { label: name(part.dept), value: part.amount }),
        }))}
      />
      <ul className={s.splitList}>
        {legend.map((part) => (
          <li key={part.dept} className={s.splitItem} data-dept={part.dept}>
            <span className={s.splitName}>
              <span className={s.swatch} data-swatch="" data-dept={part.dept} data-zero={part.permille > 0 ? undefined : ''} aria-hidden="true" />
              {name(part.dept)}
            </span>
            <span className={`${s.splitAmount} mono`}>{part.amount}</span>
          </li>
        ))}
      </ul>
      <ChartFoot proof={proof} onReceipt={onReceipt}>
        <ChartData
          caption={data.label}
          columns={[t('chart.data.amount')]}
          rows={legend.map((part) => ({ key: part.dept, heading: name(part.dept), cells: [<span className="mono">{part.amount}</span>] }))}
        />
      </ChartFoot>
    </div>
  );
}
