import { useT } from '../../text';
import { ChartData, ChartFoot, chartRoot } from './ChartData';
import { Stack } from './Stack';
import type { AgingBucketId, AgingData } from './types';
import s from './Charts.module.css';

/** Oldest last: the order the bar and the legend always take, whatever order the engine sends. */
const AGE_ORDER: readonly AgingBucketId[] = ['not-due', '1-30', '31-60', '61-90', 'over-90'];

export interface AgingBarProps {
  data: AgingData;
  onReceipt?: ((id: string) => void) | undefined;
  /**
   * 'all' (the default) lists every age; 'held' (W4 4J20, Money's Owed tile at rest) lists only the ages that hold money,
   * each in words with its count and amount, so colour is still never the only way to read the bar. The empty ages stay
   * in the chart's own table one step away.
   */
  legend?: 'all' | 'held' | undefined;
}

/**
 * Who owes you, by age (D's `.aging` and `.ag-l`): one thin bar in five ages, not due in chart ink and each later age
 * in its own chart colour (`--age-30` to `--age-over`, amber into red); the legend says each age in words with its
 * count and amount, so colour is never the only way to read it. An empty age draws no segment and a hollow square.
 * One proof (a receipt or "model estimate") covers the tile.
 */
export function AgingBar({ data, onReceipt, legend = 'all' }: AgingBarProps) {
  const t = useT();
  const buckets = AGE_ORDER.flatMap((id) => data.buckets.filter((bucket) => bucket.id === id));
  const { proof } = data;
  return (
    <div className={s.chart} {...chartRoot(proof)}>
      <Stack
        label={data.label}
        segments={buckets.map((bucket) => ({
          id: bucket.id,
          permille: bucket.permille,
          attrs: { 'data-bucket': bucket.id },
          title: t('chart.tip', { label: bucket.label, value: bucket.amount }),
        }))}
      />
      <ul className={s.ageList}>
        {buckets.filter((bucket) => legend === 'all' || bucket.permille > 0).map((bucket) => (
          <li key={bucket.id} className={s.ageRow} data-bucket={bucket.id}>
            <span className={s.swatch} data-swatch="" data-bucket={bucket.id} data-zero={bucket.permille > 0 ? undefined : ''} aria-hidden="true" />
            <span className={s.ageName}>{bucket.label}</span>
            <span className={s.ageCount}>{bucket.count}</span>
            <span className={`${s.ageAmount} mono`}>{bucket.amount}</span>
          </li>
        ))}
      </ul>
      <ChartFoot proof={proof} onReceipt={onReceipt}>
        <ChartData
          caption={data.label}
          columns={[t('chart.data.invoices'), t('chart.data.amount')]}
          rows={buckets.map((bucket) => ({ key: bucket.id, heading: bucket.label, cells: [bucket.count, <span className="mono">{bucket.amount}</span>] }))}
        />
      </ChartFoot>
    </div>
  );
}
