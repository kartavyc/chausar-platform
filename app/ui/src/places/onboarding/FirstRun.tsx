import type { ReactNode } from 'react';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import { Start } from './Start';
import s from './Onboarding.module.css';

/**
 * The first run: the status line, then only the name, the box, the country and Start. No rail, no wizard. Reached from
 * Welcome back, it also offers the way back to the businesses on this computer. On a computer with no business yet it
 * offers one quiet way to a business that already exists: moved from another computer, from a backup, or by its code.
 */
export function FirstRun({ status, onStarted, onBack, onExisting }: {
  status: ReactNode; onStarted: () => void; onBack?: (() => void) | undefined; onExisting?: (() => void) | undefined;
}) {
  const t = useT();
  return (
    <div className={s.first}>
      <div>{status}</div>
      <main id="main" tabIndex={-1} className={s.firstMain}>
        <Start variant="first-run" onStarted={onStarted} />
        {onBack && <Button variant="quiet" className={s.back} onClick={onBack}>{t('onboarding.welcome.back')}</Button>}
        {onExisting && <Button variant="quiet" className={s.back} onClick={onExisting}>{t('onboarding.welcome.existing')}</Button>}
      </main>
    </div>
  );
}
