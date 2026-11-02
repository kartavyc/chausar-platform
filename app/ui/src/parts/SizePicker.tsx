import { useId } from 'react';
import type { SizeAnswersLite, SizeAskLite } from '../engine/types';
import s from './SizePicker.module.css';

/** The saved range ids of a size question, by measure (a measure with none saved is left out). */
export function savedSize(ask: SizeAskLite): SizeAnswersLite {
  const saved: SizeAnswersLite = {};
  for (const question of ask.questions) if (question.answer) saved[question.measure] = question.answer;
  return saved;
}

/**
 * The business-size ranges (W6, founder decisions of 3 November 2026), shown only when the engine sends a size question:
 * one radio group per measure, labelled by the engine's question, with the engine's ranges and "I'd rather not say",
 * then the engine's line on why it is asked. Native radios, so arrow keys move within a group. Every word is the engine's.
 */
export function SizePicker({ ask, value, onChange, disabled = false }: {
  ask: SizeAskLite; value: SizeAnswersLite; onChange: (next: SizeAnswersLite) => void; disabled?: boolean;
}) {
  const base = useId();
  return (
    <div className={s.picker} data-business-size="">
      {ask.questions.map((question) => {
        const legend = `${base}-${question.measure}`;
        return (
          <fieldset key={question.measure} className={s.group} role="radiogroup" aria-labelledby={legend}>
            <legend id={legend} className={s.question}>{question.question}</legend>
            {question.choices.map((choice) => (
              <label key={choice.id} className={s.choice}>
                <input type="radio" name={legend} value={choice.id} checked={value[question.measure] === choice.id} disabled={disabled}
                  onChange={() => onChange({ ...value, [question.measure]: choice.id })} /> {choice.label}
              </label>
            ))}
          </fieldset>
        );
      })}
      <p className={s.note}>{ask.line}</p>
    </div>
  );
}
