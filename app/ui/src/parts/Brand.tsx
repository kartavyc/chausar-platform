import { Logo } from './Logo';
import { useT } from '../text';
import s from './Entry.module.css';

/** The logo at the top of the first run and Welcome back: the mark and wordmark for the eye, "Chausar" said once. */
export function Brand() {
  const t = useT();
  return (
    <p className={s.brand}>
      <span aria-hidden="true"><Logo wordmark size={24} /></span>
      <span className="sr-only">{t('app.name')}</span>
    </p>
  );
}

