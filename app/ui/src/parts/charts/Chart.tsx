/** Draws any of the chart forms from its typed description. A form outside these never
 *  reaches here: its stat carries an explicit unavailable state. */

import type { Chart as ChartData } from '../../app/presentation.ts';
import type { MoreChart } from './types.ts';
import { Columns } from './Columns';
import { Line } from './Line';
import { OrderedBar } from './OrderedBar';
import { RankedBars } from './RankedBars';
import { Bridge } from './Bridge';
import { GoalLine } from './GoalLine';
import { StepLine } from './StepLine';
import { PairBars } from './PairBars';
import { Spark } from './Spark';
import { RuleBar } from './RuleBar';
import { Strip } from '../Strip';

export interface ChartProps {
  chart: ChartData | MoreChart;
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
    case 'ranked-bars':
      return <RankedBars chart={chart} onReceipt={onReceipt} width={width} className={className} />;
    case 'bridge':
      return <Bridge chart={chart} onReceipt={onReceipt} width={width} height={height} className={className} />;
    case 'goal-line':
      return <GoalLine chart={chart} onReceipt={onReceipt} width={width} height={height} className={className} />;
    case 'step-line':
      return <StepLine chart={chart} onReceipt={onReceipt} width={width} height={height} className={className} />;
    case 'pair-bars':
      return <PairBars chart={chart} onReceipt={onReceipt} width={width} className={className} />;
    case 'strip':
      return <Strip cells={chart.cells} sentence={chart.sentence} onReceipt={onReceipt} className={className} />;
    case 'spark':
      return <Spark chart={chart} onReceipt={onReceipt} width={width} height={height} className={className} />;
    case 'rule-bar':
      return <RuleBar chart={chart} onReceipt={onReceipt} width={width} className={className} />;
  }
}
