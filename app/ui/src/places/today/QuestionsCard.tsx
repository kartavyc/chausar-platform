import { useCallback } from 'react';
import { useT } from '../../text';
import type { QueueRow } from '../../engine/types';
import { readReply, restated } from './reply';

/**
 * W4 4J22b: an agent's questions on a Today card (4J17, catalogue A14). The card itself is the engine's question card,
 * drawn by the preview (parts/QuestionCard: the round, each question with its best guess, each answer with what it
 * gains and costs, the recommended first, free words always open); the card's actions stay the engine's Answer and
 * Later, so no approval ever rides inside it. This gives the answer box its send words: the owner's one line ("1 yes,
 * 2 no", "ok", "1 B") read as the engine reads it and said back ("Send: 1 yes, 2 no"), their own words as "Send your
 * answer". A row with no question card keeps the plain words.
 */
export function useAnswerLabel(row: QueueRow): ((answer: string) => string) | undefined {
  const t = useT();
  const card = row.preview?.kind === 'choice' ? row.preview.card : undefined;
  const label = useCallback((answer: string) => {
    if (!card) return t('approval.answerSend');
    const read = readReply(card, answer);
    if (!read.answers.length) return t('today.questions.sendOwn');
    return t(read.free ? 'today.questions.sendNote' : 'today.questions.send', { answers: restated(read) });
  }, [card, t]);
  return card ? label : undefined;
}
