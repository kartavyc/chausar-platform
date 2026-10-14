import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function CheckScreen(_props: { view: Extract<AskView, { kind: 'check' }> }) {
  return <AskPage title="Check">{() => null}</AskPage>;
}
