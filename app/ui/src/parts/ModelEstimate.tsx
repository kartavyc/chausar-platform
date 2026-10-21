import { useT } from '../text';
import s from './ModelEstimate.module.css';

/**
 * A number a model wrote, labelled as such. It never carries a receipt: receipted figures come from code only.
 * Without `value` it is just the label, for use beside a value shown elsewhere.
 */
export function ModelEstimate({ value }: { value?: string | undefined }) {
  const t = useT();
  return (
    <span className={s.estimate}>
      {value !== undefined && <span className="mono">{value}</span>}
      {value !== undefined && ' '}
      <span className={s.word}>{t('estimate.label')}</span>
    </span>
  );
}
