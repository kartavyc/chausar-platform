import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function NotYetScreen(_props: { view: Extract<AskView, { kind: 'notyet' }> }) {
  return <AskPage title="NotYet">{() => null}</AskPage>;
}
