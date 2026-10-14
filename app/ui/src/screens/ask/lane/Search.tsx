import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function SearchScreen(_props: { view: Extract<AskView, { kind: 'search' }> }) {
  return <AskPage title="Search">{() => null}</AskPage>;
}
