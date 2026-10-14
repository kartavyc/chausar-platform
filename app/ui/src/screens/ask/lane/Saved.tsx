import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function SavedScreen(_props: { view: Extract<AskView, { kind: 'saved' }> }) {
  return <AskPage title="Saved">{() => null}</AskPage>;
}
