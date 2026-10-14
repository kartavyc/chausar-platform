import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function Gst2bScreen(_props: { view: Extract<AskView, { kind: 'gst2b' }> }) {
  return <AskPage title="Gst2b">{() => null}</AskPage>;
}
