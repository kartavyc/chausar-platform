import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function PlanScreen(_props: { view: Extract<AskView, { kind: 'plan' }> }) {
  return <AskPage title="Plan">{() => null}</AskPage>;
}
