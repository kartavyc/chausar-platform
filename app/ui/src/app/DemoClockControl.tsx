/**
 * The demo clock control (SH-03), opened from the Demo clock banner. In a demo workspace
 * the start date is set once; after that the clock only moves forward, by a day or a week.
 * There is no control that moves it back. A real workspace gets one sentence instead:
 * "This workspace is real. The demo clock is not available."
 *
 * A sheet body: the host places it in a Sheet. Every change is a callback intent
 * (`todayx.clock.set`, `todayx.clock.advance`); the new date arrives in the next shell reply.
 */

import { useState, type FormEvent } from 'react';
import type { ClockAdvance } from '../bridge/todayx-contract.ts';
import { startDate, type DemoClockState } from './shell-banners.ts';
import { useT } from './text';
import { Button } from '../parts/Button';
import { Field } from '../parts/Field';
import s from './ShellSheets.module.css';

export interface DemoClockControlProps {
  /** From demoClockState(reply, language). */
  state: DemoClockState;
  /** Set the start date once (`todayx.clock.set`). */
  onSet: (isoDate: string) => void;
  /** Move forward (`todayx.clock.advance`). Never back. */
  onAdvance: (by: ClockAdvance) => void;
  /** A request is on its way; the buttons wait for the reply. */
  busy?: boolean | undefined;
}

export function DemoClockControl({ state, onSet, onAdvance, busy = false }: DemoClockControlProps) {
  const t = useT();
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState(false);

  if (state.kind === 'real') {
    return <p className={s.p}>{t('SH-03.clock.real')}</p>;
  }

  if (state.kind === 'not-set') {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      const value = startDate(typed);
      if (value === null) {
        setProblem(true);
        return;
      }
      setProblem(false);
      onSet(value);
    };
    return (
      <form className={s.stack} onSubmit={submit}>
        <p className={s.p}>{t('SH-03.clock.once')}</p>
        <Field
          label={t('SH-03.clock.start')}
          type="date"
          value={typed}
          onChange={(e) => setTyped(e.currentTarget.value)}
          problem={problem ? t('SH-03.clock.invalid') : undefined}
        />
        <div className={s.actions}>
          <Button variant="filled" submit disabled={busy}>
            {t('SH-03.clock.set')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className={s.stack}>
      <p className={s.p}>{t('SH-03.demo-clock', { date: state.display })}</p>
      <p className={s.note}>{t('SH-03.clock.forward')}</p>
      <div className={s.actions}>
        <Button onClick={() => onAdvance('day')} disabled={busy}>
          {t('SH-03.clock.day')}
        </Button>
        <Button onClick={() => onAdvance('week')} disabled={busy}>
          {t('SH-03.clock.week')}
        </Button>
      </div>
    </div>
  );
}
