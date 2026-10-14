import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function WhatIfScreen(_props: { view: Extract<AskView, { kind: 'whatif' }> }) {
  return <AskPage title="WhatIf">{() => null}</AskPage>;
}
