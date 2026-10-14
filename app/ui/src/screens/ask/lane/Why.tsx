import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function WhyScreen(_props: { view: Extract<AskView, { kind: 'why' }> }) {
  return <AskPage title="Why">{() => null}</AskPage>;
}
