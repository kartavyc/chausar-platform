import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function DecisionsScreen(_props: { view: Extract<AskView, { kind: 'decisions' }> }) {
  return <AskPage title="Decisions">{() => null}</AskPage>;
}
