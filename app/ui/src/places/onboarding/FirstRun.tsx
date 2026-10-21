import type { ReactNode } from 'react';
import { Start } from './Start';
import s from './Onboarding.module.css';

/** The first run: the status line, then only the name, the box, the country and Start. No rail, no wizard. */
export function FirstRun({ status, onStarted }: { status: ReactNode; onStarted: () => void }) {
  return (
    <div className={s.first}>
      <div>{status}</div>
      <main id="main" tabIndex={-1} className={s.firstMain}>
        <Start variant="first-run" onStarted={onStarted} />
      </main>
    </div>
  );
}
