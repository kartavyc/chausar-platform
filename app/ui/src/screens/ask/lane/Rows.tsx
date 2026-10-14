import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function RowsScreen(_props: { view: Extract<AskView, { kind: 'rows' }> }) {
  return <AskPage title="Rows">{() => null}</AskPage>;
}
