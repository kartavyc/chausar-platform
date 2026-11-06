import { useT } from '../text';
import { Brand } from '../parts/Brand';
import s from '../parts/Entry.module.css';

/**
 * One-shot C4 task 42 (138.b1, 138.w2, 138.f1): a browser that is not paired, or whose session ended, sees this in place
 * of the places: the logo, what to do, and how. No rail, no business switcher and no read of the engine, so no error
 * repeats the problem. C5 task 3 moves pairing to Connections and rewrites `shell.pair.how`, its one key.
 */
export function PairScreen() {
  const t = useT();
  return (
    <div className={s.first}>
      <main id="main" tabIndex={-1} className={s.firstMain}>
        <div className={s.alone}>
          <Brand />
          <h1 className={s.question}>{t('shell.pair.title')}</h1>
          <p className={s.sentence}>{t('shell.pair.how')}</p>
        </div>
      </main>
    </div>
  );
}
