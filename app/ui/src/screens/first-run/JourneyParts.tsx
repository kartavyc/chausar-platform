/**
 * Small pieces the journey's steps share. Every word comes from the layered first-run
 * catalogue through `useT`; button labels are the `.btn` keys of that catalogue (each at
 * most 22 characters, checked by the journey's own test).
 */

import type { ReactNode } from 'react';
import { PageHeader } from '../../app/PageHeader';
import { useT } from '../../app/text';
import { Button, type ButtonProps } from '../../parts/Button';
import type { JourneyFailure } from './journey-contracts.ts';
import s from './Journey.module.css';

/** A button whose label is one catalogue key. */
export function Act({ label, values, ...rest }: Omit<ButtonProps, 'children'> & { label: string; values?: Record<string, string> | undefined }) {
  const t = useT();
  return <Button {...rest}>{t(label, values)}</Button>;
}

export function StepHeader({ step, title, lede }: { step: number; title: string; lede?: string | undefined }) {
  const t = useT();
  return (
    <>
      <PageHeader where={t('FR.step', { step: String(step), of: '6' })} title={t(title)} />
      {lede !== undefined && <p className={s.lede}>{t(lede)}</p>}
    </>
  );
}

export function Note({ k, values, role }: { k: string; values?: Record<string, string> | undefined; role?: 'status' | 'alert' | undefined }) {
  const t = useT();
  return <p className={s.note} role={role}>{t(k, values)}</p>;
}

export function Status({ k, values }: { k: string; values?: Record<string, string> | undefined }) {
  const t = useT();
  return <p className={s.status} role="status">{t(k, values)}</p>;
}

/** A failure in words: "not built yet" for a missing method, else the step's sentence with the fixed code. */
export function FailureLine({ failure, notBuilt, refused }: { failure: JourneyFailure; notBuilt: string; refused: string }) {
  const t = useT();
  return failure.kind === 'not-built'
    ? <p className={s.status} role="status" data-first-run-not-built="">{t(notBuilt)}</p>
    : <p className={s.problem} role="alert">{t(refused, { code: failure.code })}</p>;
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className={s.actions}>{children}</div>;
}
