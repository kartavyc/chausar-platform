/**
 * The trusted host's unlock control (SH-02), placed into LockScreen's `unlockControl` slot.
 * LockScreen itself never sees what is typed; this control is the one place that does, and
 * it keeps nothing: the field is uncontrolled (no React state holds the passphrase), its
 * value is read once on Unlock, the field is cleared at once, and the value goes straight
 * to the supplied `unlock` callback, which is called once per press. While that call is on
 * its way a second press does nothing.
 *
 * Wrong passphrase: the words say so, with no count of tries. Too many tries: the time to
 * try again, already formatted by the host, and the field waits. "Forgot it? Use your
 * recovery kit." opens the recovery flow (callback). Windows Hello or Touch ID is offered
 * only when the host says this computer supports it. The line about what is paused while
 * locked is LockScreen's own; pass `pausedLine` only when this control is used elsewhere.
 */

import { useId, useRef, useState, type FormEvent } from 'react';
import { useT } from '../app/text';
import { Button } from '../parts/Button';
import s from './UnlockControl.module.css';

export type UnlockResult = { readonly kind: 'wrong' } | { readonly kind: 'wait'; readonly until: string };

export interface UnlockControlProps {
  /** `vault.unlock`. Receives the typed value once; may return a promise. */
  unlock: (passphrase: string) => void | Promise<unknown>;
  /** How the last try went, from the host. */
  result?: UnlockResult | null | undefined;
  /** The computer's own check. Shown only when `supported` is true. */
  device?: { readonly name: string; readonly supported: boolean; readonly onUnlock: () => void } | undefined;
  /** The recovery kit flow. Absent: no link. */
  onRecoveryKit?: (() => void) | undefined;
  /** Show the paused-while-locked line here too (LockScreen already shows it). */
  pausedLine?: boolean | undefined;
}

export function UnlockControl({ unlock, result = null, device, onRecoveryKit, pausedLine = false }: UnlockControlProps) {
  const t = useT();
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const waiting = result?.kind === 'wait';
  const problemId = `${id}-problem`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input = field.current;
    if (!input || pending.current || waiting) {
      if (input) input.value = '';
      return;
    }
    const value = input.value;
    input.value = '';
    if (value.length === 0) return;
    pending.current = true;
    setBusy(true);
    const done = () => {
      pending.current = false;
      setBusy(false);
      field.current?.focus();
    };
    let returned: void | Promise<unknown>;
    try {
      returned = unlock(value);
    } catch {
      done();
      return;
    }
    if (returned instanceof Promise) returned.then(done, done);
    else done();
  };

  const problem = result === null ? undefined : result.kind === 'wait' ? t('SH-02.wait', { time: result.until }) : t('SH-02.wrong');

  return (
    <form className={s.form} onSubmit={submit} autoComplete="off">
      <label htmlFor={id} className={s.label}>
        {t('SH-02.field')}
      </label>
      <div className={s.line}>
        <input
          ref={field}
          id={id}
          className={s.input}
          type="password"
          name="unlock"
          autoComplete="current-password"
          spellCheck={false}
          autoCapitalize="off"
          disabled={waiting}
          aria-invalid={result?.kind === 'wrong' ? true : undefined}
          aria-describedby={problem !== undefined ? problemId : undefined}
        />
        <Button variant="filled" submit disabled={waiting} aria-busy={busy || undefined}>
          {t('SH-02.unlock')}
        </Button>
      </div>
      {problem !== undefined && (
        <p id={problemId} className={s.problem} role="alert">
          {problem}
        </p>
      )}
      {device?.supported === true && (
        <p className={s.links}>
          <Button variant="link" onClick={device.onUnlock} disabled={waiting}>
            {t('SH-02.device', { device: device.name })}
          </Button>
        </p>
      )}
      {onRecoveryKit && (
        <p className={s.links}>
          <Button variant="link" onClick={onRecoveryKit}>
            {t('SH-02.recovery')}
          </Button>
        </p>
      )}
      {pausedLine && <p className={s.note}>{t('SH-02.paused')}</p>}
    </form>
  );
}
