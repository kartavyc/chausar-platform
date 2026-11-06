import { useT } from '../../text';
import s from './Onboarding.module.css';

/** "How starting works" as one line (B4 task 12); it says "Describe or pick" only when there is a gallery. */
export function HowStarting({ picking }: { picking: boolean }) {
  const t = useT();
  return <p className={s.howLine} data-how-line="">{t(picking ? 'onboarding.how.linePick' : 'onboarding.how.lineDescribe')}</p>;
}
