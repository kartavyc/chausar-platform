import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function SentScreen(_props: { view: Extract<AskView, { kind: 'sent' }> }) {
  return <AskPage title="Sent">{() => null}</AskPage>;
}
