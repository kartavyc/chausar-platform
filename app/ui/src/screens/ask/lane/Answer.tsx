import type { AskView } from './kit';
import { AskPage } from './kit';

/** Placeholder until the screen lands. */
export function AnswerScreen(_props: { view: Extract<AskView, { kind: 'answer' }> }) {
  return <AskPage title="Answer">{() => null}</AskPage>;
}
