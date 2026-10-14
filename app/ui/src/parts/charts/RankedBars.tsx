/**
 * Ranked bars inside rows: a breakdown, largest first ("an answer by customer"). The
 * engine sends the rows in their order; nothing here sorts or ranks them. The bars share
 * one zero, so a value below zero runs left of it and a known zero has no length. The
 * thing the chart is about (`emphasis`) is ink; the rest is grey, and every row carries
 * its written label and value. Every known value is a mark that opens its receipt.
 */

import type { RankedBarsChart } from './types.ts';
import { BarRows } from './rows';
import { NoChart, emptyReason } from './marks';

export interface RankedBarsProps {
  chart: RankedBarsChart;
  onReceipt: (receiptId: string) => void;
  width?: number | undefined;
  className?: string | undefined;
}

export function RankedBars({ chart, onReceipt, width = 320, className }: RankedBarsProps) {
  const reason = emptyReason(chart.values);
  if (reason !== null) return <NoChart reason={reason} sentence={chart.sentence} values={chart.values} className={className} />;
  return (
    <div className={className}>
      <BarRows sentence={chart.sentence} values={chart.values} shadeOf={(v) => (v.emphasis === true ? 'ink' : 'r3')} onReceipt={onReceipt} width={width} />
    </div>
  );
}
