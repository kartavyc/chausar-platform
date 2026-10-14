import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function ForecastScreen(_props: { view: Extract<AskView, { kind: 'forecast' }> }) {
  return <AskPage title="Forecast">{() => null}</AskPage>;
}
