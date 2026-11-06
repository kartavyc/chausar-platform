import { useT } from '../text';
import type { QuestionCard as QuestionCardData } from '../engine/types';
import { Button } from './Button';
import { Icon } from './Icon';
import s from './QuestionCard.module.css';

export interface QuestionCardProps {
  card: QuestionCardData;
  /**
   * Use an answer: the card puts the short form ("1 B") in the owner's own answer box, which sends nothing until they
   * send it. Left out, the options are shown to read only.
   */
  onPick?: ((answer: string) => void) | undefined;
  disabled?: boolean | undefined;
}

/**
 * W4 4J19: an agent's question card (4J17, A14), as the engine sends it on a Today row's choice preview and on the
 * run's question: the round, the agent's lead, each question with its best guess, and each answer with what it gains
 * and what it costs, the recommended one first and marked. Free text always stays open: the example and the escape say
 * how. Everything here is the agent's own words, so it is quoted content; nothing on it is a figure.
 */
export function QuestionCardView({ card, onPick, disabled }: QuestionCardProps) {
  const t = useT();
  return (
    <div className={s.card} data-question-card="" data-content="">
      <p className={s.lead}>
        <span className={s.round}>{t('question.round', { n: String(card.round) })}</span>
        {card.lead}
      </p>
      <ol className={s.items}>
        {card.items.map((item) => (
          <li key={item.number} className={s.item}>
            <p className={s.text}>
              <span className={s.number}>{item.number}</span>
              {item.text}
            </p>
            {item.guess && <p className={s.guess}>{t('question.guess', { guess: item.guess })}</p>}
            <ul className={s.options}>
              {item.options.map((option) => (
                <li key={option.label} className={s.option} data-recommended={option.recommended ? '' : undefined}>
                  <p className={s.optionHead}>
                    <span className={s.optionLabel}>{option.label}</span>
                    <span className={s.optionText}>{option.text}</span>
                    {option.recommended && (
                      <span className={s.recommended} data-recommended-chip="">
                        <Icon name="check" size={12} />
                        {t('question.recommended')}
                      </span>
                    )}
                  </p>
                  {option.gains && <p className={s.gains}><span className={s.mark}>{t('question.gains')}</span> {option.gains}</p>}
                  {option.costs && <p className={s.costs}><span className={s.mark}>{t('question.costs')}</span> {option.costs}</p>}
                  {onPick && (
                    <Button variant="quiet" size="sm" disabled={disabled} onClick={() => onPick(`${item.number} ${option.label}`)}>
                      {t('question.use', { answer: `${item.number} ${option.label}` })}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p className={s.free}>{t('question.free', { example: card.example })}</p>
      {card.escape && <p className={s.free}>{card.escape}</p>}
    </div>
  );
}
