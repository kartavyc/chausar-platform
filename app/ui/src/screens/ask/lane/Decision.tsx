import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function DecisionScreen(_props: { view: Extract<AskView, { kind: 'decision' }> }) {
  return <AskPage title="Decision">{() => null}</AskPage>;
}
