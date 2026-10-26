import { useLanguage, useT } from '../../text';
import s from './Onboarding.module.css';

/**
 * The examples under the one-sentence box (D-Start's `.ex`), in a fixed order. Each label is short; the sentence it
 * puts in the box is a little fuller. The last one is always Hindi, to show the box takes either language, so in the
 * English app it carries `lang="hi"`.
 */
const EXAMPLES = [
  { id: 'wedding', hindi: false },
  { id: 'gst', hindi: false },
  { id: 'tuition', hindi: true },
] as const;

/**
 * "Try" and three examples. A press fills the box through `onPick` and nothing else: it asks the engine nothing and
 * sends nothing. They never cycle or change by themselves (the motion rule), and stand still (`disabled`) once the
 * sentence is kept for Try again.
 */
export function Examples({ onPick, disabled = false }: { onPick: (text: string) => void; disabled?: boolean | undefined }) {
  const t = useT();
  const language = useLanguage();
  return (
    <div className={s.examples} role="group" aria-label={t('onboarding.examples.label')}>
      <span className={s.examplesTry} aria-hidden="true">{t('onboarding.examples.try')}</span>
      {EXAMPLES.map((example) => (
        <button
          key={example.id}
          type="button"
          className={s.example}
          lang={example.hindi && language !== 'hi' ? 'hi' : undefined}
          disabled={disabled}
          onClick={() => onPick(t(`onboarding.examples.${example.id}.text`))}
        >
          {t(`onboarding.examples.${example.id}.label`)}
        </button>
      ))}
    </div>
  );
}
