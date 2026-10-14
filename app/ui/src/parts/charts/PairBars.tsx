/**
 * Two thin bars, grey then ink: before and after ("a meaning tried on a copy"). Both bars
 * share one zero and one scale. Each carries its written label and value and opens its
 * own receipt. The difference between them is never worked out or shown here.
 */

import type { PairBarsChart } from './types.ts';
import { BarRows } from './rows';
import { NoChart, emptyReason } from './marks';

export interface PairBarsProps {
  chart: PairBarsChart;
  onReceipt: (receiptId: string) => void;
  width?: number | undefined;
  className?: string | undefined;
}

export function PairBars({ chart, onReceipt, width = 320, className }: PairBarsProps) {
  const values = [chart.before, chart.after];
  const reason = emptyReason(values);
  if (reason !== null) return <NoChart reason={reason} sentence={chart.sentence} values={values} className={className} />;
  return (
    <div className={className}>
      <BarRows sentence={chart.sentence} values={values} shadeOf={(_, i) => (i === 0 ? 'r3' : 'ink')} onReceipt={onReceipt} width={width} />
    </div>
  );
}
