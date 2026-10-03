/** Draws any of the chart forms in this slice from its typed description. A form outside
 *  this slice never reaches here: its stat carries an explicit unavailable state. */

import type { Chart as ChartData } from '../../app/presentation.ts';
import { Columns } from './Columns';
import { Line } from './Line';
import { OrderedBar } from './OrderedBar';

export interface ChartProps {
  chart: ChartData;
  onReceipt: (receiptId: string) => void;
  width?: number | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

export function Chart({ chart, onReceipt, width, height, className }: ChartProps) {
  switch (chart.form) {
    case 'columns':
      return <Columns chart={chart} onReceipt={onReceipt} width={width} height={height} className={className} />;
    case 'line':
      return <Line chart={chart} onReceipt={onReceipt} width={width} height={height} className={className} />;
    case 'ordered-bar':
      return <OrderedBar chart={chart} onReceipt={onReceipt} width={width} className={className} />;
  }
}
