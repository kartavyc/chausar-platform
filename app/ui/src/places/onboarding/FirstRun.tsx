import type { ReactNode } from 'react';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import { Start } from './Start';
import s from './Onboarding.module.css';

/**
 * The first run: the status line, then only the name, the box, the country and Start. No rail, no wizard. Reached from
 * Welcome back, it also offers the way back to the businesses on this computer.
 */
export function FirstRun({ status, onStarted, onBack }: { status: ReactNode; onStarted: () => void; onBack?: (() => void) | undefined }) {
  const t = useT();
  return (
    <div className={s.first}>
      <div>{status}</div>
      <main id="main" tabIndex={-1} className={s.firstMain}>
        <Start variant="first-run" onStarted={onStarted} />
        {onBack && <Button variant="quiet" className={s.back} onClick={onBack}>{t('onboarding.welcome.back')}</Button>}
      </main>
    </div>
  );
}
