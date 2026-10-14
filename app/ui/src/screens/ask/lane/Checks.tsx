import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function ChecksScreen(_props: { view: Extract<AskView, { kind: 'checks' }> }) {
  return <AskPage title="Checks">{() => null}</AskPage>;
}
