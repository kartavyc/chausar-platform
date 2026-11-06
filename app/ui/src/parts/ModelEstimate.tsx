import { useT } from '../text';
import s from './ModelEstimate.module.css';

export interface ModelEstimateProps {
  /** The model-written number or line. Left out, it is just the label, for use beside a value shown elsewhere (the
   *  `Figure` part uses it that way). */
  value?: string | undefined;
  /** `dark`: on the dark goal card, in the goal card's own grey and line, so the label still reads there. */
  tone?: 'dark' | undefined;
}

/**
 * A number a model wrote, labelled as such. It never carries a receipt: receipted figures come from code only.
 * The label is D's dashed `.est` chip and carries `data-estimate`; with a value, the value and its chip are wrapped
 * together and the wrapper carries `data-estimate` too, so the model's words count as labelled.
 */
export function ModelEstimate({ value, tone }: ModelEstimateProps) {
  const t = useT();
  const chip = <span className={s.chip} data-estimate="" data-tone={tone}>{t('estimate.label')}</span>;
  if (value === undefined) return chip;
  return (
    <span className={s.estimate} data-estimate="">
      <span className="mono">{value}</span>
      {' '}
      {chip}
    </span>
  );
}
