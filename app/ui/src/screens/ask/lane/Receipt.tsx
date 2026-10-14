import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function ReceiptScreen(_props: { view: Extract<AskView, { kind: 'receipt' }> }) {
  return <AskPage title="Receipt">{() => null}</AskPage>;
}
