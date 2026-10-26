import { useLanguage, useT } from '../../text';
import s from './Onboarding.module.css';

/**
 * The examples under the one-sentence box (D-Start's `.ex`), in a fixed order. Each label is short; the sentence it
 * puts in the box is a little fuller. The last one is always Hindi, to show the box takes either language, so in the
 * English app it carries `lang="hi"`.
 */
const EXAMPLES = [
  { id: 'onboarding.examples.wedding', hindi: false },
  { id: 'onboarding.examples.gst', hindi: false },
  { id: 'onboarding.examples.tuition', hindi: true },
] as const;
/** W4 4J21: with "Add this to {business}" chosen, examples of things to add to a business, the last one Hindi too. */
const ADD_EXAMPLES = [
  { id: 'onboarding.ways.ex.reels', hindi: false },
  { id: 'onboarding.ways.ex.report', hindi: false },
  { id: 'onboarding.ways.ex.weekly', hindi: true },
] as const;

/**
 * "Try" and three examples. A press fills the box through `onPick` and nothing else: it asks the engine nothing and
 * sends nothing. They never cycle or change by themselves (the motion rule), and stand still (`disabled`) once the
 * sentence is kept for Try again.
 */
export function Examples({ onPick, disabled = false, adding = false }: { onPick: (text: string) => void; disabled?: boolean | undefined; adding?: boolean | undefined }) {
  const t = useT();
  const language = useLanguage();
  return (
    <div className={s.examples} role="group" aria-label={t('onboarding.examples.label')}>
      <span className={s.examplesTry} aria-hidden="true">{t('onboarding.examples.try')}</span>
      {(adding ? ADD_EXAMPLES : EXAMPLES).map((example) => (
        <button
          key={example.id}
          type="button"
          className={s.example}
          lang={example.hindi && language !== 'hi' ? 'hi' : undefined}
          disabled={disabled}
          onClick={() => onPick(t(`${example.id}.text`))}
        >
          {t(`${example.id}.label`)}
        </button>
      ))}
    </div>
  );
}
