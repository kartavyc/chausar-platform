import { useEffect, useId, useState } from 'react';
import { useT } from '../text';
import { useEngine, useResource } from '../engine/context';
import type { FeedbackAnswerInput, FeedbackView } from '../engine/types';
import { Button } from './Button';
import { Tile, TileHead } from './Tile';
import s from './FeedbackQuestion.module.css';

/**
 * W6 6J2 (D47): one short question after a milestone ("How easy was your first invoice?"), only while the owner has
 * usage reports on. Fixed answers (Easy, Okay, Hard) or Not now; never free text. The answer waits in the next report's
 * preview; nothing is sent from here.
 */
export function FeedbackQuestionCard({ question, onView }: { question: NonNullable<FeedbackView['question']>; onView: (view: FeedbackView) => void }) {
  const t = useT();
  const client = useEngine();
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function answer(choice: string) {
    setBusy(true);
    setProblem(null);
    try { onView(await client.request('venture.feedback.answer', { questionId: question.id, answer: choice as FeedbackAnswerInput['answer'] })); }
    catch (error) { setProblem(t('feedback.failed', { message: error instanceof Error ? error.message : String(error) })); }
    finally { setBusy(false); }
  }
  return (
    <Tile as="section" labelledBy={headingId}>
      <TileHead id={headingId} title={t('feedback.question')} />
      <div className={s.body}>
        <p className={s.line}>{question.text}</p>
        <div className={s.buttons}>
          {question.choices.map((choice) => <Button key={choice.id} disabled={busy} onClick={() => void answer(choice.id)}>{choice.label}</Button>)}
          <Button variant="quiet" disabled={busy} onClick={() => void answer('skip')}>{t('feedback.skip')}</Button>
        </div>
        {problem && <p className={s.problem} role="alert">{problem}</p>}
      </div>
    </Tile>
  );
}

/** Today's place for the question: nothing at all unless the engine has one open. */
export function FeedbackQuestion() {
  const resource = useResource('venture.feedback.get', {});
  const [view, setView] = useState<FeedbackView | null>(null);
  useEffect(() => { if (resource.data) setView(resource.data); }, [resource.data]);
  const question = (view ?? resource.data)?.question ?? null;
  if (!question) return null;
  return <FeedbackQuestionCard question={question} onView={setView} />;
}
