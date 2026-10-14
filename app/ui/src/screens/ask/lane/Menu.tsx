import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function MenuScreen(_props: { view: Extract<AskView, { kind: 'menu' }> }) {
  return <AskPage title="Menu">{() => null}</AskPage>;
}
