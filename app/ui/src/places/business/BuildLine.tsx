import { useT } from '../../text';
import { useDay } from '../../parts/when';
import { APP_VERSION, BUILT_AT } from '../../parts/build-info';
import s from './Business.module.css';

/**
 * One-shot C4 task 41: "Chausar 0.1.0-preview.1, built 5 Nov 2026". Seam: C3's This app page takes this line when it
 * lands; until then it sits at the foot of Business > About you.
 */
export function BuildLine() {
  const t = useT();
  const day = useDay();
  return <p className={s.note} data-build-line="">{t('business.buildLine', { version: APP_VERSION, day: day(BUILT_AT) })}</p>;
}
